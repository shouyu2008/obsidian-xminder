import {
  ItemView,
  WorkspaceLeaf,
  TFile,
  Notice,
  normalizePath,
  Scope,
  ViewStateResult,
} from "obsidian";
import MindElixir from "mind-elixir";
import type { MindElixirData, MindElixirInstance, NodeObj } from "mind-elixir";
import { parseXMind } from "../xmind/parser";
import { serializeXMind } from "../xmind/serializer";
import type { XMindNode, XMindData } from "../xmind/types";
import type XMindPlugin from "../main";

export const XMIND_VIEW_TYPE = "xmind-view";

// Debounce delay for auto-save (ms)
const AUTO_SAVE_DELAY = 500;

export class XMindView extends ItemView {
  private plugin: XMindPlugin;
  private file: TFile | null = null;
  private mind: MindElixirInstance | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private isDirty = false;
  private containerEl2: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: XMindPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.containerEl2 = this.contentEl;
  }

  getViewType(): string {
    return XMIND_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "XMind";
  }

  getIcon(): string {
    return "brain-circuit";
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async onOpen(): Promise<void> {
    this.containerEl2.addClass("xmind-view-container");

    // Initialize a scope so Ctrl/Cmd+S can be captured when this view is active
    this.scope = new Scope(this.app.scope);

    // Ctrl/Cmd + S to save immediately
    this.scope.register(["Mod"], "s", (e: KeyboardEvent) => {
      e.preventDefault();
      this.saveNow();
    });
  }

  async onClose(): Promise<void> {
    // Flush any pending auto-save before closing
    if (this.isDirty) {
      await this.saveNow();
    }
    this.destroyMind();
  }

  // -------------------------------------------------------------------------
  // File loading (called by main.ts after opening leaf)
  // -------------------------------------------------------------------------

  async loadFile(file: TFile): Promise<void> {
    this.file = file;
    // Refresh the tab title to show the file name
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.leaf as any).updateHeader?.();

    try {
      const buffer = await this.app.vault.adapter.readBinary(
        normalizePath(file.path)
      );
      const xmindData = await parseXMind(buffer);
      const meData = xmindDataToMindElixir(xmindData);
      this.renderMindElixir(meData);
    } catch (err) {
      this.showError(err instanceof Error ? err.message : String(err));
    }
  }

  // -------------------------------------------------------------------------
  // MindElixir rendering
  // -------------------------------------------------------------------------

  private renderMindElixir(data: MindElixirData): void {
    this.destroyMind();
    this.containerEl2.empty();

    // Wrapper div that mind-elixir mounts into
    const wrapper = this.containerEl2.createDiv({ cls: "xmind-mind-wrapper" });

    const isDark = document.body.classList.contains("theme-dark");

    const options = {
      el: wrapper,
      direction: MindElixir.SIDE,
      draggable: true,
      editable: true,
      contextMenu: true,
      toolBar: true,
      keypress: true,
      allowUndo: true,
      theme: isDark ? MindElixir.DARK_THEME : MindElixir.THEME,
    };

    this.mind = new MindElixir(options);
    this.mind.init(data);

    // Listen for any operation (edit/add/remove/move) → trigger auto-save
    this.mind.bus.addListener("operation", (_info) => {
      this.scheduleSave();
    });

    // React to Obsidian theme changes
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        if (!this.mind) return;
        const dark = document.body.classList.contains("theme-dark");
        this.mind.changeTheme(
          dark ? MindElixir.DARK_THEME : MindElixir.THEME,
          true
        );
      })
    );
  }

  private destroyMind(): void {
    if (this.mind) {
      this.mind.destroy?.();
      this.mind = null;
    }
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Save logic
  // -------------------------------------------------------------------------

  private scheduleSave(): void {
    this.isDirty = true;
    const delay = this.plugin.settings.autoSaveDelay ?? AUTO_SAVE_DELAY;

    // If delay is 0, auto-save is disabled; only Ctrl+S will save
    if (delay === 0) return;

    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, delay);
  }

  async saveNow(): Promise<void> {
    if (!this.file || !this.mind) return;

    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    try {
      const meData = this.mind.getData();
      const xmindData = mindElixirToXMindData(meData);
      const buffer = await serializeXMind(xmindData);
      await this.app.vault.adapter.writeBinary(
        normalizePath(this.file.path),
        buffer
      );
      this.isDirty = false;
    } catch (err) {
      new Notice(
        `XMinder: Failed to save "${this.file.name}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Commands exposed to main.ts
  // -------------------------------------------------------------------------

  /** Export current mind map data as Markdown outline */
  exportAsMarkdown(): string {
    if (!this.mind) return "";
    return this.mind.getDataMd();
  }

  /** Fit the diagram to the viewport */
  fitToView(): void {
    this.mind?.scaleFit();
    this.mind?.toCenter();
  }

  // -------------------------------------------------------------------------
  // State persistence (Obsidian calls these for workspace serialization)
  // -------------------------------------------------------------------------

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = state as { filePath?: string };
    if (s?.filePath) {
      const file = this.app.vault.getAbstractFileByPath(
        normalizePath(s.filePath)
      );
      if (file instanceof TFile) {
        await this.loadFile(file);
      }
    }
    await super.setState(state, result);
  }

  getState(): { filePath?: string } {
    return { filePath: this.file?.path };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private showError(msg: string): void {
    this.containerEl2.empty();
    this.containerEl2.createEl("div", {
      cls: "xmind-error",
      text: `XMinder Error: ${msg}`,
    });
    new Notice(`XMinder: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Data conversion: XMindData <-> MindElixirData
// ---------------------------------------------------------------------------

export function xmindDataToMindElixir(data: XMindData): MindElixirData {
  return {
    nodeData: mapXMindNodeToME(data.rootTopic),
  };
}

function mapXMindNodeToME(node: XMindNode): NodeObj {
  const obj: NodeObj = {
    id: node.id,
    topic: node.title,
    expanded: node.branch !== "folded",
  };

  if (node.href) obj.hyperLink = node.href;
  if (node.labels && node.labels.length > 0) obj.tags = node.labels;
  if (node.markers && node.markers.length > 0) obj.icons = node.markers;
  if (node.notes) obj.note = node.notes;

  if (node.style) {
    obj.style = {};
    if (node.style.background) obj.style.background = node.style.background;
    if (node.style.color) obj.style.color = node.style.color;
    if (node.style.fontSize) obj.style.fontSize = `${node.style.fontSize}px`;
    if (node.style.fontWeight) obj.style.fontWeight = node.style.fontWeight;
  }

  if (node.children && node.children.length > 0) {
    obj.children = node.children.map(mapXMindNodeToME);
  }

  return obj;
}

export function mindElixirToXMindData(meData: MindElixirData): XMindData {
  return {
    rootTopic: mapMENodeToXMind(meData.nodeData),
    title: meData.nodeData.topic,
  };
}

function mapMENodeToXMind(node: NodeObj): XMindNode {
  const xnode: XMindNode = {
    id: node.id,
    title: node.topic,
  };

  if (node.expanded === false) xnode.branch = "folded";
  if (node.hyperLink) xnode.href = node.hyperLink;
  if (node.tags && node.tags.length > 0) xnode.labels = node.tags;
  if (node.icons && node.icons.length > 0) xnode.markers = node.icons;
  if (node.note) xnode.notes = node.note;

  if (node.style) {
    xnode.style = {};
    if (node.style.background) xnode.style.background = node.style.background;
    if (node.style.color) xnode.style.color = node.style.color;
    if (node.style.fontSize) {
      const size = parseInt(node.style.fontSize, 10);
      if (!isNaN(size)) xnode.style.fontSize = size;
    }
    if (node.style.fontWeight) {
      xnode.style.fontWeight = node.style.fontWeight as "bold" | "normal";
    }
  }

  if (node.children && node.children.length > 0) {
    xnode.children = node.children.map(mapMENodeToXMind);
  }

  return xnode;
}
