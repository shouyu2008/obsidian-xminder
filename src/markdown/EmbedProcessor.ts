import {
  MarkdownPostProcessorContext,
  TFile,
  normalizePath,
  App,
  FileView,
  MarkdownRenderChild,
} from "obsidian";
import MindElixir from "mind-elixir";
import type { MindElixirInstance } from "mind-elixir";
import { parseXMind } from "../xmind/parser";
import { xmindDataToMindElixir, XMIND_VIEW_TYPE } from "../views/XMindView";
import type XMindPlugin from "../main";
import { i18n } from "../i18n";
import { customLinkDiv } from "../views/LayoutEngine";

// Marker attribute to prevent double-processing on the same render pass
const PROCESSED_ATTR = "data-xmind-processed";

/**
 * Lifecycle-managed child for XMind embeds.
 * Ensures the mind map is rendered, resized, and cleaned up correctly.
 */
class XMindEmbedChild extends MarkdownRenderChild {
  private mind: MindElixirInstance | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private fitTimer: number | null = null;
  private hasLayouted = false;
  private contentEl: HTMLDivElement | null = null;

  constructor(
    containerEl: HTMLElement,
    private file: TFile,
    private plugin: XMindPlugin
  ) {
    super(containerEl);
  }

  onload() {
    void (async () => {
      this.containerEl.empty();
      this.containerEl.addClass("xmind-embed-wrapper");
      this.containerEl.addClass("xmind-embed-block");
      
      // Create inner container for MindElixir
      this.contentEl = this.containerEl.createDiv({ cls: "xmind-embed-container" });
      this.contentEl.addClass("xmind-embed-clickable");
      
      const height = this.plugin.settings.embedHeight ?? 400;
      this.contentEl.setCssStyles({
        width: "100%",
        height: `${height}px`,
        position: "relative",
      });

      const loading = this.contentEl.createDiv({ cls: "xmind-embed-loading" });
      loading.textContent = i18n.t().embed.loadingXMind;

      try {
        const buffer = await this.plugin.app.vault.adapter.readBinary(
          normalizePath(this.file.path)
        );
        
        const multiSheet = await parseXMind(buffer);
        const meData = xmindDataToMindElixir(multiSheet.sheets[0]);
        
        if (!this.containerEl.isConnected) return;
        loading.remove();

        const isDark = document.body.classList.contains("theme-dark");
        this.mind = new MindElixir({
          el: this.contentEl,
          direction: MindElixir.SIDE,
          draggable: false,
          editable: false,
          contextMenu: false,
          toolBar: false,
          keypress: false,
          theme: isDark ? MindElixir.DARK_THEME : MindElixir.THEME,
          selectionContainer: document.body,
        });

        // Inject shared layout engine
        (this.mind as unknown as { linkDiv: (this: MindElixirInstance) => void }).linkDiv = customLinkDiv;
        this.mind.init(meData);

        this.setupObservers();
        this.contentEl.addEventListener("click", this.onClick);

      } catch (err) {
        if (loading.parentElement) {
          loading.textContent = "Error: " + (err instanceof Error ? err.message : String(err));
        }
      }
    })();
  }

  private onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void openXMindView(this.plugin.app, this.file);
  };

  private setupObservers() {
    const performLayoutAndFit = () => {
      if (!this.containerEl.isConnected || !this.mind || !this.contentEl) return;
      
      const width = this.contentEl.offsetWidth;
      // Re-layout when width becomes real (e.g. tab becomes active)
      if (width > 0 && !this.hasLayouted) {
        this.hasLayouted = true;
        // Small delay to ensure styles are applied
        window.setTimeout(() => {
          if (!this.mind) return;
          this.mind.refresh();
          this.mind.scaleFit();
          this.mind.toCenter();
        }, 50);
      }
    };

    if (typeof ResizeObserver !== 'undefined' && this.contentEl) {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0) {
            performLayoutAndFit();
          } else {
            // Reset so it re-layouts when coming back from background
            this.hasLayouted = false;
          }
        }
      });
      this.resizeObserver.observe(this.contentEl);
    }

    this.fitTimer = window.setTimeout(performLayoutAndFit, 300);
  }

  onunload() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.fitTimer !== null) {
      window.clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
    if (this.contentEl) {
      this.contentEl.removeEventListener("click", this.onClick);
    }
    this.containerEl.empty();
    this.mind = null;
  }
}

/**
 * Registers embed handling for .xmind files.
 */
export function registerEmbedProcessor(plugin: XMindPlugin): void {
  plugin.registerMarkdownPostProcessor(
    (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      // Find all potential XMind embeds
      const targets = el.querySelectorAll<HTMLElement>(
        ".internal-embed, .file-embed, .embed-container, [data-src], [data-path]"
      );
      
      for (const target of Array.from(targets)) {
        // Skip if this specific DOM element was already handled in this render pass
        if (target.hasAttribute(PROCESSED_ATTR)) continue;
        
        // If there's already our wrapper sitting after it, it might be a stale one
        // or a correct one from a previous partial render.
        const next = target.nextElementSibling;
        if (next?.classList.contains("xmind-embed-wrapper")) {
             // In Reading mode, if the wrapper is empty or disconnected, we recreate.
             if (next.children.length > 0) {
                 target.setAttribute(PROCESSED_ATTR, "true");
                 target.setCssStyles({ display: "none" });
                 continue;
             }
             next.remove();
        }

        const src = getEmbedSrc(target);
        if (!src || !src.toLowerCase().endsWith(".xmind")) continue;
        
        const resolvedFile = plugin.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
        if (resolvedFile instanceof TFile) {
          target.setAttribute(PROCESSED_ATTR, "true");
          target.setCssStyles({ display: "none" });
          
          // Create wrapper and manage it via lifecycle
          const wrapper = document.createElement("div");
          target.parentElement?.insertBefore(wrapper, target.nextSibling);
          ctx.addChild(new XMindEmbedChild(wrapper, resolvedFile, plugin));
        }
      }

      // 2. Process regular links [[file.xmind]]
      const anchors = el.querySelectorAll<HTMLAnchorElement>("a.internal-link");
      for (const anchor of Array.from(anchors)) {
        if (anchor.hasAttribute(PROCESSED_ATTR)) continue;
        
        const href = anchor.getAttribute("data-href") || anchor.getAttribute("href") || "";
        if (!href.toLowerCase().endsWith(".xmind")) continue;

        anchor.setAttribute(PROCESSED_ATTR, "true");
        anchor.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const resolvedFile = plugin.app.metadataCache.getFirstLinkpathDest(href, ctx.sourcePath);
          if (resolvedFile instanceof TFile) {
            void openXMindView(plugin.app, resolvedFile);
          }
        });
      }
    }
  );
}

function getEmbedSrc(el: HTMLElement): string {
  let src = el.getAttribute("src") || el.getAttribute("data-src") || el.getAttribute("data-path") || "";
  
  if (!src) {
    const link = el.querySelector("a");
    if (link) {
      src = link.getAttribute("href") || link.getAttribute("data-href") || "";
    }
  }

  if (!src || !src.toLowerCase().endsWith(".xmind")) {
    const title = el.getAttribute("title") ?? "";
    if (title.toLowerCase().endsWith(".xmind")) src = title;
  }

  return src;
}

async function openXMindView(app: App, file: TFile): Promise<void> {
  const leaves = app.workspace.getLeavesOfType(XMIND_VIEW_TYPE);
  const existing = leaves.find((l) => (l.view as FileView).file?.path === file.path);

  if (existing) {
    void app.workspace.revealLeaf(existing);
    return;
  }

  const leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(file);
  void app.workspace.revealLeaf(leaf);
}
