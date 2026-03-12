import { MarkdownPostProcessorContext, TFile, normalizePath, App } from "obsidian";
import MindElixir from "mind-elixir";
import type { MindElixirInstance } from "mind-elixir";
import { parseXMind } from "../xmind/parser";
import { xmindDataToMindElixir, XMIND_VIEW_TYPE } from "../views/XMindView";
import type XMindPlugin from "../main";

/**
 * Registers a MarkdownPostProcessor that handles:
 *
 * 1. ![[file.xmind]]  — embedded read-only mind map preview
 * 2. [[file.xmind]]   — internal link that opens the XMind view on click
 *
 * Obsidian renders these as:
 *   ![[...]]  → <span class="internal-embed" src="file.xmind">
 *   [[...]]   → <a class="internal-link" href="file.xmind">
 */
export function registerEmbedProcessor(plugin: XMindPlugin): void {
  plugin.registerMarkdownPostProcessor(
    async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      await processEmbeds(el, ctx, plugin);
      processLinks(el, plugin);
    }
  );
}

// ---------------------------------------------------------------------------
// ![[file.xmind]] — embedded preview
// ---------------------------------------------------------------------------

async function processEmbeds(
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
  plugin: XMindPlugin
): Promise<void> {
  // Obsidian renders ![[...]] as <span class="internal-embed" src="...">
  const embeds = el.querySelectorAll<HTMLElement>("span.internal-embed");

  for (const embed of Array.from(embeds)) {
    const src = embed.getAttribute("src") ?? "";
    if (!src.toLowerCase().endsWith(".xmind")) continue;

    // Resolve file path relative to current note
    const sourcePath = ctx.sourcePath;
    const resolvedFile = plugin.app.metadataCache.getFirstLinkpathDest(
      src,
      sourcePath
    );

    if (!(resolvedFile instanceof TFile)) continue;

    // Replace the default embed placeholder with our rendered preview
    embed.empty();
    embed.addClass("xmind-embed-wrapper");

    // Use a plain div created via document.createElement so that
    // mind-elixir's [object HTMLDivElement] check passes reliably.
    const container = document.createElement("div");
    container.className = "xmind-embed-container";

    // Set height from settings
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
        mind.scaleFit();
        mind.toCenter();
      }, 200);

      // Clean up mind-elixir instance when the container is removed from DOM
      const observer = new MutationObserver(() => {
        if (!container.isConnected) {
          clearTimeout(fitTimer);
          mind.destroy?.();
          observer.disconnect();
        }
      });
      observer.observe(container.parentElement ?? document.body, {
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
}

// ---------------------------------------------------------------------------
// [[file.xmind]] — internal link
// ---------------------------------------------------------------------------

function processLinks(el: HTMLElement, plugin: XMindPlugin): void {
  // Obsidian renders [[...]] as <a class="internal-link" href="...">
  const links = el.querySelectorAll<HTMLAnchorElement>("a.internal-link");

  for (const link of Array.from(links)) {
    const href = link.getAttribute("href") ?? "";
    // Strip heading/block anchors, e.g. "file.xmind#section"
    const filePart = href.split("#")[0];
    if (!filePart.toLowerCase().endsWith(".xmind")) continue;

    // Override default link behavior
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const resolvedFile = plugin.app.metadataCache.getFirstLinkpathDest(
        filePart,
        "" // no source needed for direct resolution
      );

      if (resolvedFile instanceof TFile) {
        openXMindView(plugin.app, resolvedFile);
      } else {
        // File not found — let Obsidian handle it (e.g. create note prompt)
        plugin.app.workspace.openLinkText(filePart, "");
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Helper: open file in XMind view
// ---------------------------------------------------------------------------

async function openXMindView(app: App, file: TFile): Promise<void> {
  // Try to reuse an existing XMind leaf
  const existing = app.workspace.getLeavesOfType(XMIND_VIEW_TYPE).find(
    (leaf) => (leaf.view as { file?: TFile }).file?.path === file.path
  );

  if (existing) {
    app.workspace.revealLeaf(existing);
    return;
  }

  // Open in a new leaf
  const leaf = app.workspace.getLeaf("tab");
  await leaf.setViewState({
    type: XMIND_VIEW_TYPE,
    active: true,
    state: { filePath: file.path },
  });
  app.workspace.revealLeaf(leaf);
}
