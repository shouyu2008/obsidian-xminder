import { MarkdownPostProcessorContext, TFile, normalizePath, App } from "obsidian";
import MindElixir from "mind-elixir";
import type { MindElixirInstance } from "mind-elixir";
import { parseXMind } from "../xmind/parser";
import { xmindDataToMindElixir, XMIND_VIEW_TYPE } from "../views/XMindView";
import type XMindPlugin from "../main";

// Marker attribute to prevent double-processing
const PROCESSED_ATTR = "data-xmind-processed";

/**
 * Registers embed handling for ![[file.xmind]] and link handling for [[file.xmind]].
 *
 * Since .xmind is an unknown file type, Obsidian doesn't create standard
 * .internal-embed or .file-embed elements. Instead, it renders embeds as
 * links or inline elements. We use multiple strategies to detect and process them:
 *
 * 1. **MarkdownPostProcessor** — Scans rendered markdown for link patterns and
 *    replaces xmind embeds with previews.
 *
 * 2. **MutationObserver** — Watches for new elements appearing in the DOM and
 *    replaces xmind embeds wherever they appear.
 *
 * 3. **Periodic scanning** — Periodically scans all markdown views for unprocessed
 *    xmind embeds, especially important for Reading View which renders upfront.
 */
export function registerEmbedProcessor(plugin: XMindPlugin): void {
  // --- Mechanism 1: MarkdownPostProcessor ---
  plugin.registerMarkdownPostProcessor(
    async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      void processEmbedsInElement(el, ctx.sourcePath, plugin);
      processLinks(el, plugin);
    }
  );

  // --- Mechanism 2: MutationObserver (for Live Preview) ---
  startEmbedObserver(plugin);

  // --- Mechanism 3: Periodic scanner for Reading View ---
  startPeriodicEmbedScanner(plugin);
}

// ---------------------------------------------------------------------------
// MutationObserver — watches for .file-embed / .internal-embed elements
// appearing anywhere in the workspace and replaces xmind ones with previews.
// ---------------------------------------------------------------------------

function startEmbedObserver(plugin: XMindPlugin): void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (!(node instanceof HTMLElement)) continue;

        // The added node itself might be the embed, or it might contain embeds
        const candidates: HTMLElement[] = [];

        if (isXMindEmbed(node)) {
          candidates.push(node);
        }

        // Also check children
        const children = node.querySelectorAll<HTMLElement>(
          ".internal-embed, .file-embed"
        );
        for (const child of Array.from(children)) {
          if (isXMindEmbed(child)) {
            candidates.push(child);
          }
        }

        for (const embed of candidates) {
          // Find sourcePath from the closest markdown view context
          const sourcePath = findSourcePath(embed, plugin);
          void replaceEmbedWithPreview(embed, sourcePath, plugin);
        }
      }
    }
  });

  // Observe the entire workspace container
  // Use app.workspace.containerEl which is available after onload
  const target = typeof document !== 'undefined' ? document.body : null;
  if (target) {
    observer.observe(target, { childList: true, subtree: true });
  }

  // Clean up on plugin unload
  plugin.register(() => observer.disconnect());
}

/**
 * Periodic scanner to find and process xmind embeds that may have been missed.
 * This is essential for Reading View which renders all content upfront without
 * triggering processors for embed syntax.
 *
 * The scanner looks for:
 * 1. Unprocessed span/div elements containing .xmind links
 * 2. Elements inside markdown views that reference .xmind files
 * 3. Links to .xmind files that should be embedded
 */
function startPeriodicEmbedScanner(plugin: XMindPlugin): void {
  // Keep track of last scan to avoid redundant processing
  let lastScanTime = 0;
  const SCAN_INTERVAL = 1000; // Scan every 1 second

  // Scan all markdown leaves for unprocessed xmind embeds
  const scanMarkdownLeaves = () => {
    const now = Date.now();
    if (now - lastScanTime < SCAN_INTERVAL) return;
    lastScanTime = now;

    for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const file = (leaf.view as any)?.file as TFile | undefined;
      if (!file) continue;

      // For Reading View: scan the rendered markdown content
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const readingView = leaf.view.containerEl?.querySelector?.(".markdown-reading-view");
      if (readingView instanceof HTMLElement) {
        scanElementForXMindEmbeds(readingView, file.path, plugin);
      }

      // For Live Preview: scan the editor content
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const livePreview = leaf.view.containerEl?.querySelector?.(".cm-editor");
      if (livePreview instanceof HTMLElement) {
        scanElementForXMindEmbeds(livePreview, file.path, plugin);
      }
    }
  };

  // Scan when workspace layout is ready
  plugin.app.workspace.onLayoutReady(() => {
    scanMarkdownLeaves();
  });

  // Scan periodically
  const scanInterval = setInterval(scanMarkdownLeaves, SCAN_INTERVAL);
  plugin.register(() => clearInterval(scanInterval));

  // Scan on leaf change
  plugin.registerEvent(
    plugin.app.workspace.on("active-leaf-change", () => {
      scanMarkdownLeaves();
    })
  );

  // Scan on file open
  plugin.registerEvent(
    plugin.app.workspace.on("file-open", () => {
      scanMarkdownLeaves();
    })
  );
}

/**
 * Scans an element tree for elements that reference .xmind files and
 * processes them as embeds if they haven't been already.
 */
function scanElementForXMindEmbeds(
  el: HTMLElement,
  sourcePath: string,
  plugin: XMindPlugin
): void {
  // Find all elements that might be xmind embeds or links
  // Look for: links to .xmind files, inline embeds, or wrapper divs
  const candidates: HTMLElement[] = [];

  // Strategy 1: Find anchor tags pointing to .xmind files
  const links = el.querySelectorAll<HTMLAnchorElement>("a[href*='.xmind']");
  for (const link of Array.from(links)) {
    // Check if this link represents an embed (has specific styling or structure)
    const parent = link.parentElement;
    if (parent && parent.classList.contains("embed-title")) {
      // This is an embed container
      const container = parent.closest(".embed-container") ?? parent.parentElement;
      if (container instanceof HTMLElement && !container.hasAttribute(PROCESSED_ATTR)) {
        candidates.push(container);
      }
    }
  }

  // Strategy 2: Look for elements with data attributes or title that mention .xmind
  const allElements = el.querySelectorAll<HTMLElement>("[data-src*='.xmind'], [title*='.xmind']");
  for (const elem of Array.from(allElements)) {
    if (!elem.hasAttribute(PROCESSED_ATTR)) {
      candidates.push(elem);
    }
  }

  // Strategy 3: Look for inline-embed or file-embed class elements (fallback)
  const embeds = el.querySelectorAll<HTMLElement>(".internal-embed, .file-embed, .embed-container");
  for (const embed of Array.from(embeds)) {
    const src = getEmbedSrc(embed);
    if (src.toLowerCase().endsWith(".xmind") && !embed.hasAttribute(PROCESSED_ATTR)) {
      candidates.push(embed);
    }
  }

  // Process unique candidates
  const processed = new Set<HTMLElement>();
  for (const candidate of candidates) {
    if (!processed.has(candidate)) {
      processed.add(candidate);
      void replaceEmbedWithPreview(candidate, sourcePath, plugin);
    }
  }
}

/**
 * Check if an element is an xmind embed that we should process.
 * Supports multiple element types since unknown files render differently.
 */
function isXMindEmbed(el: HTMLElement): boolean {
  if (el.hasAttribute(PROCESSED_ATTR)) return false;

  // Check for standard embed classes
  if (el.classList.contains("internal-embed") ||
      el.classList.contains("file-embed") ||
      el.classList.contains("embed-container")) {
    const src = getEmbedSrc(el);
    return src.toLowerCase().endsWith(".xmind");
  }

  // Also check anchor tags that might be embeds
  if (el.tagName === "A") {
    const src = el.getAttribute("href") ?? "";
    if (src.toLowerCase().endsWith(".xmind")) {
      // Only consider it if it's styled as an embed
      const parent = el.parentElement;
      if (parent && (
        parent.classList.contains("embed-title") ||
        parent.classList.contains("embed-container") ||
        parent.classList.contains("internal-embed")
      )) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extract file reference from an embed element.
 * Tries multiple sources since unknown file types may render differently.
 */
function getEmbedSrc(el: HTMLElement): string {
  // Try various attributes where the file reference might be stored
  let src = el.getAttribute("src") ?? 
            el.getAttribute("alt") ?? 
            el.getAttribute("data-src") ?? 
            el.getAttribute("href") ??
            "";

  // If still not found, look in child elements
  if (!src) {
    const link = el.querySelector<HTMLAnchorElement>("a[href*='.xmind']");
    if (link) {
      src = link.getAttribute("href") ?? "";
    }
  }

  // If still not found, check the text content for filename patterns
  if (!src) {
    const text = el.textContent ?? "";
    const match = text.match(/([^\s/]+\.xmind)/i);
    if (match) {
      src = match[1];
    }
  }

  return src;
}

/**
 * Try to determine the source markdown file path from the DOM context or workspace.
 * Uses multiple strategies to find the file path.
 */
function findSourcePath(el: HTMLElement, plugin: XMindPlugin): string {
  // Strategy 1: Look for data-path attribute (most reliable)
  let current: HTMLElement | null = el;
  while (current) {
    const path = current.getAttribute("data-path");
    if (path) return path;

    // Check if this is a view-content within a workspace leaf
    if (current.classList.contains("view-content")) {
      // Try to find the leaf via Obsidian's workspace
      const leafEl = current.closest(".workspace-leaf");
      if (leafEl) {
        for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
          if (leaf.view.containerEl.contains(current)) {
            const file = (leaf.view as { file?: TFile }).file;
            if (file) return file.path;
          }
        }
      }
    }

    current = current.parentElement;
  }

  // Strategy 2: Check active leaf (fallback)
  const activeLeaf = plugin.app.workspace.activeLeaf;
  if (activeLeaf) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const file = (activeLeaf.view as any)?.file as TFile | undefined;
    if (file) return file.path;
  }

  // Strategy 3: Find any markdown leaf that contains the element
  for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
    if (leaf.view.containerEl.contains(el)) {
      const file = (leaf.view as { file?: TFile }).file;
      if (file) return file.path;
    }
  }

  return "";
}

// ---------------------------------------------------------------------------
// ![[file.xmind]] — embedded preview (shared logic)
// ---------------------------------------------------------------------------

/**
 * Scan an element for xmind embeds and replace them with mind-map previews.
 * Since .xmind is an unknown type, embeds may be rendered as links or generic containers.
 * This function tries multiple detection strategies.
 */
async function processEmbedsInElement(
  el: HTMLElement,
  sourcePath: string,
  plugin: XMindPlugin
): Promise<void> {
  // Strategy 1: Look for standard embed elements
  const embeds = el.querySelectorAll<HTMLElement>(
    ".internal-embed, .file-embed, .embed-container"
  );

  for (const embed of Array.from(embeds)) {
    if (embed.hasAttribute(PROCESSED_ATTR)) continue;

    const src = getEmbedSrc(embed);
    if (!src.toLowerCase().endsWith(".xmind")) continue;

    await replaceEmbedWithPreview(embed, sourcePath, plugin);
  }

  // Strategy 2: Look for links that might represent embeds
  // In some cases, embed syntax ![[file.xmind]] gets rendered as a link
  const links = el.querySelectorAll<HTMLAnchorElement>("a[href*='.xmind']");
  for (const link of Array.from(links)) {
    if (link.hasAttribute(PROCESSED_ATTR)) continue;
    
    // Only process if it looks like an embed link (not a regular link)
    // Check if it has embed-like styling or is wrapped in an embed container
    const parent = link.parentElement;
    if (parent && (
      parent.classList.contains("embed-title") ||
      parent.classList.contains("embed-container") ||
      parent.classList.contains("internal-embed")
    )) {
      const container = parent.closest(".embed-container") ?? parent.parentElement;
      if (container instanceof HTMLElement) {
        await replaceEmbedWithPreview(container, sourcePath, plugin);
      }
    }
  }
}

/**
 * Replace a single embed element with a rendered mind-map preview.
 */
async function replaceEmbedWithPreview(
  embed: HTMLElement,
  sourcePath: string,
  plugin: XMindPlugin
): Promise<void> {
  // Guard: already processed
  if (embed.hasAttribute(PROCESSED_ATTR)) return;
  embed.setAttribute(PROCESSED_ATTR, "true");

  const src = getEmbedSrc(embed);
  if (!src.toLowerCase().endsWith(".xmind")) return;

  // Resolve file path relative to current note
  const resolvedFile = plugin.app.metadataCache.getFirstLinkpathDest(
    src,
    sourcePath
  );

  if (!(resolvedFile instanceof TFile)) return;

  // Clear any existing mind-elixir instances in the embed
  const existingMindEl = embed.querySelector(".xmind-embed-container");
  if (existingMindEl instanceof HTMLElement) {
    // The existing mind-elixir instance should be destroyed by cleanupObserver,
    // but we also mark the embed as unprocessed to allow reprocessing
    embed.removeAttribute(PROCESSED_ATTR);
    return;
  }

  // Clear the default content (icon + filename) and replace with our preview
  embed.empty();
  embed.addClass("xmind-embed-wrapper");
  // Remove the generic file-embed styling so our container can fill it
  embed.removeClass("file-embed");
  embed.addClass("xmind-embed-block");

  const container = typeof document !== 'undefined' ? document.createElement("div") : null;
  if (!container) return;
  container.className = "xmind-embed-container";

  const height = plugin.settings.embedHeight ?? 300;
  container.style.height = `${height}px`;
  embed.appendChild(container);

  const loading = typeof document !== 'undefined' ? document.createElement("div") : null;
  if (!loading) return;
  loading.className = "xmind-embed-loading";
  loading.textContent = "Loading XMind...";
  container.appendChild(loading);

  try {
    const buffer = await plugin.app.vault.adapter.readBinary(
      normalizePath(resolvedFile.path)
    );
    const multiSheet = await parseXMind(buffer);
    const meData = xmindDataToMindElixir(multiSheet.sheets[0]);

    // If container was removed from DOM while we were loading, bail out
    if (!container.isConnected) return;

    loading.remove();

    const isDark = typeof document !== 'undefined' && document.body.classList.contains("theme-dark");

    const mind: MindElixirInstance = new MindElixir({
      el: container,
      direction: MindElixir.SIDE,
      draggable: false,
      editable: false,
      contextMenu: false,
      toolBar: false,
      keypress: false,
      theme: isDark ? MindElixir.DARK_THEME : MindElixir.THEME,
    });

    mind.init(meData);

    // Fit to container after render — use a longer delay to ensure the
    // embed container has been laid out and has non-zero dimensions.
    const setTimeoutFn = typeof setTimeout !== 'undefined' ? setTimeout : (fn: () => void, ms: number) => { fn(); return 1; };
    const clearTimeoutFn = typeof clearTimeout !== 'undefined' ? clearTimeout : (_id: number) => {};
    const fitTimer = setTimeoutFn(() => {
      if (container.isConnected) {
        mind.scaleFit();
        mind.toCenter();
      }
    }, 300);

    // Clean up mind-elixir instance when the container is removed from DOM
    // Watch from document.body to catch all removal events, not just immediate parent
    const cleanupObserver = new MutationObserver(() => {
      if (!container.isConnected) {
        clearTimeoutFn(fitTimer);
        mind.destroy?.();
        cleanupObserver.disconnect();
      }
    });
    const target = typeof document !== 'undefined' ? document.body : null;
    if (target) {
      cleanupObserver.observe(target, {
        childList: true,
        subtree: true,
      });
    }

    // Click on the preview → open in full XMind view
    container.addEventListener("click", (e) => {
      e.preventDefault();
      void openXMindView(plugin.app, resolvedFile);
    });
    container.addClass("xmind-embed-clickable");
    container.title = `Click to open ${resolvedFile.basename}`;
  } catch (err) {
    loading.remove();
    const errorEl = typeof document !== 'undefined' ? document.createElement("div") : null;
    if (!errorEl) return;
    errorEl.className = "xmind-embed-error";
    errorEl.textContent = `Failed to load "${resolvedFile.name}": ${
      err instanceof Error ? err.message : String(err)
    }`;
    container.appendChild(errorEl);
  }
}

// ---------------------------------------------------------------------------
// [[file.xmind]] — internal link
// ---------------------------------------------------------------------------

function processLinks(el: HTMLElement, plugin: XMindPlugin): void {
  const links = el.querySelectorAll<HTMLAnchorElement>("a.internal-link");

  for (const link of Array.from(links)) {
    const href = link.getAttribute("href") ?? "";
    const filePart = href.split("#")[0];
    if (!filePart.toLowerCase().endsWith(".xmind")) continue;

    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const resolvedFile = plugin.app.metadataCache.getFirstLinkpathDest(
        filePart,
        ""
      );

      if (resolvedFile instanceof TFile) {
        void openXMindView(plugin.app, resolvedFile);
      } else {
        void plugin.app.workspace.openLinkText(filePart, "");
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Helper: open file in XMind view
// ---------------------------------------------------------------------------

async function openXMindView(app: App, file: TFile): Promise<void> {
  const existing = app.workspace
    .getLeavesOfType(XMIND_VIEW_TYPE)
    .find(
      (leaf) => (leaf.view as { file?: TFile }).file?.path === file.path
    );

  if (existing) {
    void app.workspace.revealLeaf(existing);
    return;
  }

  const leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(file);
  void app.workspace.revealLeaf(leaf);
}
