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
 * Two complementary mechanisms are used:
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
 */
export function registerEmbedProcessor(plugin: XMindPlugin): void {
  // --- Mechanism 1: MarkdownPostProcessor ---
  plugin.registerMarkdownPostProcessor(
    async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      await processEmbedsInElement(el, ctx.sourcePath, plugin);
      processLinks(el, plugin);
    }
  );

  // --- Mechanism 2: MutationObserver (fallback for Live Preview) ---
  startEmbedObserver(plugin);
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
          replaceEmbedWithPreview(embed, sourcePath, plugin);
        }
      }
    }
  });

  // Observe the entire workspace container
  // Use app.workspace.containerEl which is available after onload
  const target = document.body;
  observer.observe(target, { childList: true, subtree: true });

  // Clean up on plugin unload
  plugin.register(() => observer.disconnect());
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

  // Clear the default content (icon + filename) and replace with our preview
  embed.empty();
  embed.addClass("xmind-embed-wrapper");
  // Remove the generic file-embed styling so our container can fill it
  embed.removeClass("file-embed");
  embed.style.display = "block";

  const container = document.createElement("div");
  container.className = "xmind-embed-container";

  const height = plugin.settings.embedHeight ?? 300;
  container.style.height = `${height}px`;
  embed.appendChild(container);

  // Loading indicator
  const loading = document.createElement("div");
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

    const isDark = document.body.classList.contains("theme-dark");

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
    const fitTimer = setTimeout(() => {
      if (container.isConnected) {
        mind.scaleFit();
        mind.toCenter();
      }
    }, 300);

    // Clean up mind-elixir instance when the container is removed from DOM
    const cleanupObserver = new MutationObserver(() => {
      if (!container.isConnected) {
        clearTimeout(fitTimer);
        mind.destroy?.();
        cleanupObserver.disconnect();
      }
    });
    cleanupObserver.observe(container.parentElement ?? document.body, {
      childList: true,
      subtree: true,
    });

    // Click on the preview → open in full XMind view
    container.addEventListener("click", (e) => {
      e.preventDefault();
      openXMindView(plugin.app, resolvedFile);
    });
    container.style.cursor = "pointer";
    container.title = `Click to open ${resolvedFile.basename}`;
  } catch (err) {
    loading.remove();
    const errorEl = document.createElement("div");
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
        openXMindView(plugin.app, resolvedFile);
      } else {
        plugin.app.workspace.openLinkText(filePart, "");
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
    app.workspace.revealLeaf(existing);
    return;
  }

  const leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(file);
  app.workspace.revealLeaf(leaf);
}
