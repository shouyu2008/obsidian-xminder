// eslint-disable-next-line import/no-extraneous-dependencies -- These are provided by Obsidian's environment
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
// eslint-disable-next-line import/no-extraneous-dependencies -- These are provided by Obsidian's environment
import { StateField, EditorState, Prec } from "@codemirror/state";
import { TFile, normalizePath, editorLivePreviewField } from "obsidian";
import MindElixir from "mind-elixir";
import type { MindElixirInstance } from "mind-elixir";
import { parseXMind } from "../xmind/parser";
import { xmindDataToMindElixir } from "../views/XMindView";
import type { XMindMultiSheetData } from "../xmind/types";
import { customLinkDiv } from "../views/LayoutEngine";
import type XMindPlugin from "../main";
import { i18n } from "../i18n";

class XMindWidget extends WidgetType {
  constructor(
    private readonly file: TFile,
    private readonly plugin: XMindPlugin,
    private readonly isBlockWidget: boolean = false
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "xmind-embed-wrapper xmind-lp-embed xmind-embed-block";
    if (this.isBlockWidget) {
      container.addClass("xmind-lp-active");
    }
    
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
      const multiSheet: XMindMultiSheetData = await parseXMind(buffer);
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
        void this.plugin.openXMindFile(this.file);
      });
      container.addClass("xmind-embed-clickable");
      
    } catch (err) {
      if (loading.parentElement) {
        loading.textContent = "Error: " + (err instanceof Error ? err.message : String(err));
      }
    }
  }

  eq(other: XMindWidget): boolean {
    return other.file.path === this.file.path && other.isBlockWidget === this.isBlockWidget;
  }
}

function buildDecorations(state: EditorState, plugin: XMindPlugin): DecorationSet {
  // 1. Safety Check: Only render in Live Preview mode
  // The official way is state.field(editorLivePreviewField), but let's also 
  // ensure we aren't in Source Mode.
  const isLivePreview = state.field(editorLivePreviewField, false) !== false;
  
  if (!isLivePreview) {
    return Decoration.none;
  }

  const builder: { from: number; to: number; decoration: Decoration }[] = [];
  const text = state.doc.toString();
  const regex = /!\[\[([^\]]+\.xmind)(?:\|[^\]]+)?\]\]/gi;
  const selection = state.selection.main;
  
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    const linkPath = match[1];
    
    const isEditing = selection.from <= to && selection.to >= from;
    
    let sourcePath = "";
    const activeFile = plugin.app.workspace.getActiveFile();
    if (activeFile) sourcePath = activeFile.path;
    
    const resolvedFile = plugin.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
    
    if (resolvedFile instanceof TFile) {
      if (isEditing) {
        const deco = Decoration.widget({
          widget: new XMindWidget(resolvedFile, plugin, true),
          block: true,
          side: 1,
        });
        builder.push({ from: to, to: to, decoration: deco });
      } else {
        const deco = Decoration.replace({
          widget: new XMindWidget(resolvedFile, plugin, false),
          block: true,
        });
        builder.push({ from: from, to: to, decoration: deco });
      }
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
      // Re-build if doc changed, selection changed, or the view was reconfigured (e.g., LP <-> Source Mode transition)
      if (tr.docChanged || tr.selection || tr.reconfigured) {
        return buildDecorations(tr.state, plugin);
      }
      return oldSet.map(tr.changes);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  return Prec.highest(xmindField);
}
