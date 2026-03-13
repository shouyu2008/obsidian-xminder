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
  // This runs for every markdown block rendered
  plugin.registerMarkdownPostProcessor(
    async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      void processEmbedsInElement(el, ctx.sourcePath, plugin);
      processLinks(el, plugin);
    }
  );

  // --- Mechanism 2: MutationObserver on document.body ---
  // This catches embeds appearing anywhere in the DOM
  startAggresiveEmbedObserver(plugin);
}

// ---------------------------------------------------------------------------
// MutationObserver — watches for .file-embed / .internal-embed elements
// appearing anywhere in the workspace and replaces xmind ones with previews.
// ---------------------------------------------------------------------------

/**
 * Check if an element is inside a markdown content area (not a menu/UI element)
 */
function isInMarkdownContent(el: HTMLElement): boolean {
  // Check if it's inside a markdown-reading-view (Reading View)
  if (el.closest(".markdown-reading-view")) {
    return true;
  }

  // Check if it's inside cm-editor (Live Preview editor)
  if (el.closest(".cm-editor")) {
    return true;
  }

  // Check if it's inside a workspace view content
  if (el.closest(".view-content")) {
    return true;
  }

  // Check if it's inside markdown-source-view
  if (el.closest(".markdown-source-view")) {
    return true;
  }

  return false;
}

/**
 * Aggressive mutation observer that catches xmind embeds in markdown content areas.
 * Only processes embeds within markdown views, not UI menus/dropdowns.
 */
function startAggresiveEmbedObserver(plugin: XMindPlugin): void {
  let processingQueue: Set<HTMLElement> = new Set();
  let processTimeout: number | null = null;

  const processQueue = () => {
    if (processTimeout !== null) {
      clearTimeout(processTimeout);
      processTimeout = null;
    }

    for (const element of processingQueue) {
      // Only process if still in DOM
      if (!element.isConnected) {
        processingQueue.delete(element);
        continue;
      }

      // Skip if already processed
      if (element.hasAttribute(PROCESSED_ATTR)) {
        processingQueue.delete(element);
        continue;
      }

      // CRITICAL: Only process if in markdown content area
      // This prevents processing UI elements like file picker menus
      if (!isInMarkdownContent(element)) {
        processingQueue.delete(element);
        continue;
      }

      // Get the source path
      const sourcePath = findSourcePath(element, plugin);

      // Process as embed
      void replaceEmbedWithPreview(element, sourcePath, plugin);
      processingQueue.delete(element);
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // Process added nodes
      for (const node of Array.from(mutation.addedNodes)) {
        if (!(node instanceof HTMLElement)) continue;

        // Only check nodes that are in markdown content areas
        if (!isInMarkdownContent(node)) {
          continue;
        }

        // Check if node itself is an embed
        const src = getEmbedSrc(node);
        if (src.toLowerCase().endsWith(".xmind") && !node.hasAttribute(PROCESSED_ATTR)) {
          processingQueue.add(node);
        }

        // Also recursively check children that are in markdown content
        const allNodes = node.querySelectorAll<HTMLElement>("*");
        for (const child of Array.from(allNodes)) {
          // Double-check child is in markdown content
          if (!isInMarkdownContent(child)) {
            continue;
          }
          const childSrc = getEmbedSrc(child);
          if (childSrc.toLowerCase().endsWith(".xmind") && !child.hasAttribute(PROCESSED_ATTR)) {
            processingQueue.add(child);
          }
        }
      }
    }

    // Debounce processing
    if (processTimeout !== null) {
      clearTimeout(processTimeout);
    }
    processTimeout = window.setTimeout(processQueue, 100);
  });

  // Start observing the entire document
  const target = typeof document !== 'undefined' ? document.body : null;
  if (target) {
    observer.observe(target, {
      childList: true,
      subtree: true,
    });
  }

  // Also do an initial scan when plugin loads
  plugin.app.workspace.onLayoutReady(() => {
    const allElements = document.querySelectorAll<HTMLElement>("*");
    for (const el of Array.from(allElements)) {
      // Only process markdown content
      if (!isInMarkdownContent(el)) {
        continue;
      }
      const src = getEmbedSrc(el);
      if (src.toLowerCase().endsWith(".xmind") && !el.hasAttribute(PROCESSED_ATTR)) {
        processingQueue.add(el);
      }
    }
    processQueue();
  });

  // Clean up on unload
  plugin.register(() => {
    observer.disconnect();
    if (processTimeout !== null) {
      clearTimeout(processTimeout);
    }
  });
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
  // Strategy 1: Look for standard embed elements (.internal-embed, .file-embed)
  const embeds = el.querySelectorAll<HTMLElement>(
    ".internal-embed, .file-embed, .embed-container"
  );

  for (const embed of Array.from(embeds)) {
    if (embed.hasAttribute(PROCESSED_ATTR)) continue;

    const src = getEmbedSrc(embed);
    if (!src.toLowerCase().endsWith(".xmind")) continue;

    await replaceEmbedWithPreview(embed, sourcePath, plugin);
  }

  // Strategy 2: Look for anchor tags that reference .xmind files
  // For unknown file types, Obsidian may render ![[file.xmind]] as a link
  const allAnchors = el.querySelectorAll<HTMLAnchorElement>("a[href]");
  for (const link of Array.from(allAnchors)) {
    // Skip if already processed
    if (link.hasAttribute(PROCESSED_ATTR)) continue;
    
    const href = link.getAttribute("href") ?? "";
    
    // Must be a .xmind file reference
    if (!href.toLowerCase().endsWith(".xmind")) continue;
    
    // Skip regular links and only process embed-like contexts
    // Check if parent looks like an embed container
    let container: HTMLElement | null = null;
    
    // Check immediate parent classes
    const parent = link.parentElement;
    if (parent) {
      // If parent has embed-related classes, use it or find the container
      if (parent.classList.contains("embed-title") ||
          parent.classList.contains("embed-container") ||
          parent.classList.contains("internal-embed")) {
        container = parent.closest(".embed-container") ?? parent;
      }
      // Also check if we should process block-level embeds in markdown
      // (Obsidian may render ![[file.xmind]] as a link within a paragraph)
      else if (parent.tagName === "P") {
        // Check if this is the only content (or main content) of the paragraph
        // This heuristic detects ![[file.xmind]] rendered as link inside <p>
        const textContent = (parent.textContent ?? "").trim();
        const linkText = (link.textContent ?? "").trim();
        const fileName = href.split('/').pop() ?? "";
        
        // If the paragraph mainly contains just this link/filename, treat as embed
        if (linkText === fileName || textContent === linkText || textContent.includes(fileName)) {
          // Wrap the link in a container to process as embed
          container = parent;
        }
      }
    }
    
    if (container instanceof HTMLElement) {
      await replaceEmbedWithPreview(container, sourcePath, plugin);
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

  // Clear the embed completely first, removing any old containers or loading states
  embed.empty();

  // Also ensure no stale loading messages are left
  const oldContainers = embed.querySelectorAll(".xmind-embed-container, .xmind-embed-loading");
  for (const oldContainer of Array.from(oldContainers)) {
    oldContainer.remove();
  }
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
        
        // IMPORTANT: Remove PROCESSED_ATTR from the parent embed when container is removed
        // This allows the embed to be reprocessed when mode switches back
        // (e.g., from Source Mode back to Live Preview)
        if (embed instanceof HTMLElement && embed.hasAttribute(PROCESSED_ATTR)) {
          embed.removeAttribute(PROCESSED_ATTR);
        }
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
