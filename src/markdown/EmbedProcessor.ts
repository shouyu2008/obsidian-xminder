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
 * Three complementary mechanisms are used:
 *
 * 1. **registerMarkdownPostProcessor** — Obsidian invokes this for every
 *    rendered chunk in both Reading View and Live Preview. It works well when
 *    Obsidian creates `<span class="internal-embed" src="…">` elements.
 *
 * 2. **MutationObserver on the workspace** — For custom / unknown file types
 *    Obsidian often renders `![[file.xmind]]` as a generic "file-embed" widget
 *    (icon + filename) that may *not* go through the post-processor pipeline,
 *    especially in Live Preview (CM6). The observer watches for these elements
 *    appearing in the DOM and replaces them with our mind-map preview.
 *
 * 3. **Workspace leaf event handler** — For Reading View, we listen to the
 *    "changed" event on markdown leaves to ensure xmind embeds are processed
 *    even when the view is initially rendered.
 */
export function registerEmbedProcessor(plugin: XMindPlugin): void {
  // --- Mechanism 1: MarkdownPostProcessor ---
  plugin.registerMarkdownPostProcessor(
    async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      void processEmbedsInElement(el, ctx.sourcePath, plugin);
      processLinks(el, plugin);
    }
  );

  // --- Mechanism 2: MutationObserver (fallback for Live Preview) ---
  startEmbedObserver(plugin);

  // --- Mechanism 3: Listen for Reading View changes ---
  startReadingViewObserver(plugin);
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
 * Scans existing Reading View leaves for xmind embeds that may have been
 * missed during initial plugin load. Reading View renders content directly
 * to HTML without triggering the post-processor on view switch.
 */
function startReadingViewObserver(plugin: XMindPlugin): void {
  // Function to scan a specific leaf's view content
  const scanLeafForEmbeds = (leaf: any) => {
    if (!leaf || !leaf.view) return;
    
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const viewContent = leaf.view.containerEl?.querySelector?.(".markdown-reading-view");
    if (viewContent instanceof HTMLElement) {
      const file = (leaf.view as { file?: TFile }).file;
      if (file) {
        void processEmbedsInElement(viewContent, file.path, plugin);
      }
    }
  };

  // Scan all existing markdown leaves
  const scanExistingLeaves = () => {
    for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
      scanLeafForEmbeds(leaf);
    }
  };

  // Initial scan when plugin loads
  plugin.app.workspace.onLayoutReady(() => {
    scanExistingLeaves();
  });

  // Listen for changes to markdown leaves (when view is opened/switched)
  plugin.registerEvent(
    plugin.app.workspace.on("active-leaf-change", () => {
      scanExistingLeaves();
    })
  );

  // Also listen for file open events
  plugin.registerEvent(
    plugin.app.workspace.on("file-open", () => {
      scanExistingLeaves();
    })
  );
}

/** Check if an element is an xmind embed that we should process */
function isXMindEmbed(el: HTMLElement): boolean {
  if (el.hasAttribute(PROCESSED_ATTR)) return false;
  if (
    !el.classList.contains("internal-embed") &&
    !el.classList.contains("file-embed")
  )
    return false;

  const src = getEmbedSrc(el);
  return src.toLowerCase().endsWith(".xmind");
}

/** Extract file reference from an embed element */
function getEmbedSrc(el: HTMLElement): string {
  // Obsidian stores the reference in "src", sometimes also in "alt"
  return el.getAttribute("src") ?? el.getAttribute("alt") ?? "";
}

/** Try to determine the source markdown file path from the DOM context */
function findSourcePath(el: HTMLElement, plugin: XMindPlugin): string {
  // Walk up to find a .markdown-reading-view or .markdown-source-view
  // that has a data-path or is associated with a known leaf
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
  return "";
}

// ---------------------------------------------------------------------------
// ![[file.xmind]] — embedded preview (shared logic)
// ---------------------------------------------------------------------------

/**
 * Scan an element for xmind embeds and replace them with mind-map previews.
 * Used by both the MarkdownPostProcessor and the MutationObserver.
 */
async function processEmbedsInElement(
  el: HTMLElement,
  sourcePath: string,
  plugin: XMindPlugin
): Promise<void> {
  // Broad selector to catch all embed variants:
  //   span.internal-embed  — standard embed (images, known types)
  //   div.internal-embed   — file embed for custom/unknown types
  //   .file-embed          — generic file embed wrapper
  const embeds = el.querySelectorAll<HTMLElement>(
    ".internal-embed, .file-embed"
  );

  for (const embed of Array.from(embeds)) {
    if (embed.hasAttribute(PROCESSED_ATTR)) continue;

    const src = getEmbedSrc(embed);
    if (!src.toLowerCase().endsWith(".xmind")) continue;

    await replaceEmbedWithPreview(embed, sourcePath, plugin);
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
