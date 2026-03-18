import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { StateField, EditorState } from "@codemirror/state";
import { TFile, normalizePath } from "obsidian";
import MindElixir from "mind-elixir";
import type { MindElixirInstance } from "mind-elixir";
import { parseXMind } from "../xmind/parser";
import { xmindDataToMindElixir } from "../views/XMindView";
import { customLinkDiv } from "../views/LayoutEngine";
import type XMindPlugin from "../main";
import { i18n } from "../i18n";

class XMindWidget extends WidgetType {
  constructor(
    private readonly file: TFile,
    private readonly plugin: XMindPlugin
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "xmind-embed-wrapper xmind-lp-embed xmind-embed-block";
    
    const contentContainer = document.createElement("div");
    contentContainer.className = "xmind-embed-container";
    const height = this.plugin.settings.embedHeight ?? 400;
    contentContainer.setCssStyles({
      width: "100%",
      height: `${height}px`,
      position: "relative",
    });
    
    container.appendChild(contentContainer);
    
    const loading = document.createElement("div");
    loading.className = "xmind-embed-loading";
    loading.textContent = i18n.t().embed.loadingXMind;
    contentContainer.appendChild(loading);
    
    void this.renderMap(contentContainer, loading);
    
    return container;
  }

  private async renderMap(container: HTMLElement, loading: HTMLElement): Promise<void> {
    try {
      const buffer = await this.plugin.app.vault.adapter.readBinary(
        normalizePath(this.file.path)
      );
      const multiSheet = await parseXMind(buffer);
      const meData = xmindDataToMindElixir(multiSheet.sheets[0]);
      
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
        selectionContainer: document.body,
      });
      
      (mind as unknown as { linkDiv: (this: MindElixirInstance) => void }).linkDiv = customLinkDiv;
      mind.init(meData);
      
      // Auto-fit
      setTimeout(() => {
        if (container.isConnected) {
          mind.scaleFit();
          mind.toCenter();
        }
      }, 500);
      
      // Click to open in full view
      container.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.plugin.openXMindFile(this.file);
      });
      container.addClass("xmind-embed-clickable");
      
    } catch (err) {
      if (loading.parentElement) {
        loading.textContent = "Error: " + (err instanceof Error ? err.message : String(err));
      }
    }
  }

  eq(other: XMindWidget): boolean {
    return other.file.path === this.file.path;
  }
}

function buildDecorations(state: EditorState, plugin: XMindPlugin): DecorationSet {
  const builder: { from: number; to: number; decoration: Decoration }[] = [];
  
  // We process the whole document here, but EditorState.doc is efficient.
  // For larger files, this might need optimization using viewport info,
  // but StateField decorations are usually calculated for the whole doc.
  // CodeMirror handles the rendering efficiently.
  const text = state.doc.toString();
  const regex = /!\[\[([^\]]+\.xmind)(?:\|[^\]]+)?\]\]/gi;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    const linkPath = match[1];
    let sourcePath = "";
    const activeFile = plugin.app.workspace.getActiveFile();
    if (activeFile) sourcePath = activeFile.path;
    
    const resolvedFile = plugin.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
    
    if (resolvedFile instanceof TFile) {
      // To use block decoration, it's safer to ensure we match the whole line if possible,
      // or at least acknowledge this is a replacement.
      // However, the error was specifically about using block:true in a ViewPlugin.
      // Using StateField should resolve that core error.
      const deco = Decoration.replace({
        widget: new XMindWidget(resolvedFile, plugin),
        block: true,
      });
      
      builder.push({ 
        from: match.index, 
        to: match.index + match[0].length, 
        decoration: deco 
      });
    }
  }
  
  return Decoration.set(
    builder
      .sort((a, b) => a.from - b.from)
      .map((b) => b.decoration.range(b.from, b.to))
  );
}

export function xmindLivePreviewExtension(plugin: XMindPlugin) {
  const xmindField = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state, plugin);
    },
    update(oldSet, tr) {
      if (tr.docChanged) {
        return buildDecorations(tr.state, plugin);
      }
      return oldSet.map(tr.changes);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  return xmindField;
}
