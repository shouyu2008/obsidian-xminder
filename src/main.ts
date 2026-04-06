import {
  Plugin,
  TFile,
  TFolder,
  WorkspaceLeaf,
  normalizePath,
  Notice,
  addIcon,
} from "obsidian";
import { XMindView, XMIND_VIEW_TYPE, escapeMermaid } from "./views/XMindView";
import { registerEmbedProcessor } from "./markdown/EmbedProcessor";
import { xmindLivePreviewExtension } from "./markdown/LivePreviewProcessor";
import { XMindSettingTab, DEFAULT_SETTINGS } from "./settings";
import type { XMindPluginSettings } from "./settings";
import { serializeXMind } from "./xmind/serializer";
import { parseXMind } from "./xmind/parser";
import { i18n } from "./i18n";

// Register a custom icon for XMind files (SVG brain/mindmap icon)
const XMIND_ICON = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="10" fill="currentColor"/>
  <circle cx="20" cy="30" r="7" fill="currentColor"/>
  <circle cx="80" cy="30" r="7" fill="currentColor"/>
  <circle cx="20" cy="70" r="7" fill="currentColor"/>
  <circle cx="80" cy="70" r="7" fill="currentColor"/>
  <circle cx="50" cy="15" r="7" fill="currentColor"/>
  <circle cx="50" cy="85" r="7" fill="currentColor"/>
  <line x1="50" y1="50" x2="20" y2="30" stroke="currentColor" stroke-width="4"/>
  <line x1="50" y1="50" x2="80" y2="30" stroke="currentColor" stroke-width="4"/>
  <line x1="50" y1="50" x2="20" y2="70" stroke="currentColor" stroke-width="4"/>
  <line x1="50" y1="50" x2="80" y2="70" stroke="currentColor" stroke-width="4"/>
  <line x1="50" y1="50" x2="50" y2="15" stroke="currentColor" stroke-width="4"/>
  <line x1="50" y1="50" x2="50" y2="85" stroke="currentColor" stroke-width="4"/>
</svg>`;

export default class XMindPlugin extends Plugin {
  settings!: XMindPluginSettings;

  async onload(): Promise<void> {
    i18n.init(this.app);
    await this.loadSettings();

    addIcon("xmind-icon", XMIND_ICON);

    this.registerExtensions(["xmind"], XMIND_VIEW_TYPE);

    this.registerView(
      XMIND_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new XMindView(leaf, this)
    );

    registerEmbedProcessor(this);
    this.registerEditorExtension(xmindLivePreviewExtension(this));

    this.addCommand({
      id: "create-new-xmind",
      name: i18n.t().commands.createNewXMind,
      callback: async () => {
        await this.createNewXMindFile();
      },
    });

    this.addCommand({
      id: "export-xmind-as-markdown",
      name: i18n.t().commands.exportAsMarkdown,
      checkCallback: (checking: boolean) => {
        const view = this.getActiveXMindView();
        if (!view) return false;
        if (!checking) {
          const md = view.exportAsMarkdown();
          if (md) {
            void this.exportMarkdownToClipboard(md);
          }
        }
        return true;
      },
    });

    this.addCommand({
      id: "export-xmind-as-canvas",
      name: i18n.t().commands.exportAsCanvas || "Export to Canvas",
      checkCallback: (checking: boolean) => {
        const view = this.getActiveXMindView();
        if (!view) return false;
        if (!checking) {
          const canvas = view.exportAsCanvas();
          if (canvas) {
            void this.saveCanvasFile(view.file!, canvas);
          }
        }
        return true;
      },
    });

    this.addCommand({
      id: "xmind-fit-to-view",
      name: i18n.t().commands.fitToView,
      checkCallback: (checking: boolean) => {
        const view = this.getActiveXMindView();
        if (!view) return false;
        if (!checking) {
          view.fitToView();
        }
        return true;
      },
    });

    this.addCommand({
      id: "xmind-save",
      name: i18n.t().commands.saveFile,
      checkCallback: (checking: boolean) => {
        const view = this.getActiveXMindView();
        if (!view) return false;
        if (!checking) {
          void view.saveNow();
        }
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, abstractFile) => {
        if (abstractFile instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle(i18n.t().menus.createNewXMind)
              .setIcon("xmind-icon")
              .onClick(async () => {
                await this.createNewXMindFile(abstractFile);
              });
          });
          return;
        }

        if (!(abstractFile instanceof TFile)) return;
        if (abstractFile.extension.toLowerCase() !== "xmind") return;

        if (this.settings.showOpenAsXMind) {
          menu.addItem((item) => {
            item
              .setTitle(i18n.t().menus.openWithXMind)
              .setIcon("xmind-icon")
              .onClick(() => {
                const app = this.app as { openWithDefaultApp?: (path: string) => void };
                app.openWithDefaultApp?.(abstractFile.path);
              });
          });
        }

        menu.addItem((item) => {
          item
            .setTitle(i18n.t().menus.exportAsMarkdown)
            .setIcon("file-text")
            .onClick(async () => {
              await this.exportFileAsMarkdown(abstractFile);
            });
        });

        menu.addItem((item) => {
          item
            .setTitle(i18n.t().menus.exportAsCanvas || "Export to Canvas")
            .setIcon("layout-dashboard")
            .onClick(async () => {
              await this.exportFileAsCanvas(abstractFile);
            });
        });
      })
    );

    this.addSettingTab(new XMindSettingTab(this.app, this));
  }

  onunload(): void {
    // Close all open XMind views to ensure proper cleanup
    const leaves = this.app.workspace.getLeavesOfType(XMIND_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view as XMindView;
      void view.onClose?.();
      leaf.detach();
    }
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  async loadSettings(): Promise<void> {
    const loadedData = await this.loadData() as XMindPluginSettings | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(loadedData ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Open a TFile as XMind view */
  async openXMindFile(file: TFile): Promise<void> {
    // Reuse existing leaf for this file if open
    const existing = this.app.workspace
      .getLeavesOfType(XMIND_VIEW_TYPE)
      .find((leaf) => (leaf.view as XMindView).file?.path === file.path);

    if (existing) {
      void this.app.workspace.revealLeaf(existing);
      return;
    }

    // Use getLeaf + openFile so Obsidian calls onLoadFile correctly via FileView
    const leaf = this.app.workspace.getLeaf("tab" as "split");
    await leaf.openFile(file);
    void this.app.workspace.revealLeaf(leaf);
  }

  /** Get the currently active XMindView, if any */
  private getActiveXMindView(): XMindView | null {
    const activeView = this.app.workspace.getActiveViewOfType(XMindView);
    if (activeView) return activeView;
    return null;
  }

  async createNewXMindFile(folder?: TFolder): Promise<void> {
    const t = i18n.t();
    let name = t.defaults.newMindMap;
    let idx = 1;
    
    const basePath = folder ? folder.path : "";
    let fullPath = normalizePath(basePath ? `${basePath}/${name}.xmind` : `${name}.xmind`);
    
    while (this.app.vault.getAbstractFileByPath(fullPath)) {
      name = `${t.defaults.newMindMap} ${idx++}`;
      fullPath = normalizePath(basePath ? `${basePath}/${name}.xmind` : `${name}.xmind`);
    }
    const path = fullPath;

    const emptyData = {
      sheets: [{
        rootTopic: {
          id: Math.random().toString(36).slice(2, 10),
          title: t.defaults.centralTopic,
          children: [
            {
              id: Math.random().toString(36).slice(2, 10),
              title: t.defaults.mainTopic1,
            },
            {
              id: Math.random().toString(36).slice(2, 10),
              title: t.defaults.mainTopic2,
            },
          ],
        },
        title: name,
      }],
    };

    try {
      const buffer = await serializeXMind(emptyData);
      await this.app.vault.adapter.writeBinary(path, buffer);

      const newFile = this.app.vault.getAbstractFileByPath(path);
      if (newFile instanceof TFile) {
        await this.openXMindFile(newFile);
      } else {
        const setTimeoutFn = ((typeof window !== 'undefined' && window.setTimeout)
          ? window.setTimeout.bind(window)
          : (() => 0)) as ((fn: () => void, ms: number) => number);
        setTimeoutFn(() => {
          const f = this.app.vault.getAbstractFileByPath(path);
          if (f instanceof TFile) {
            void this.openXMindFile(f);
          }
        }, 200);
      }

      new Notice(t.notices.created.replace("{name}", name));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      new Notice(t.notices.createFailed.replace("{error}", errorMsg));
    }
  }

  /** Export a .xmind file as Markdown and copy to clipboard */
  private async exportFileAsMarkdown(file: TFile): Promise<void> {
    // If the file is already open in a view, use its live data
    const existing = this.app.workspace
      .getLeavesOfType(XMIND_VIEW_TYPE)
      .find((leaf) => (leaf.view as XMindView).file?.path === file.path);

    if (existing) {
      const md = (existing.view as XMindView).exportAsMarkdown();
      if (md) {
        this.exportMarkdownToClipboard(md);
        return;
      }
    }

    // Otherwise, parse the file directly and convert to Markdown
    try {
      const buffer = await this.app.vault.adapter.readBinary(
        normalizePath(file.path)
      );
      const multiSheet = await parseXMind(buffer);
      const t = i18n.t();
      const md = multiSheet.sheets.map((sheet, i) => {
        const sheetTitle = sheet.title || `${t.defaults.canvas} ${i + 1}`;
        const prefix = multiSheet.sheets.length > 1 ? `# ${sheetTitle}\n\n` : "";
        
        const rootNode = sheet.rootTopic;
        const rootTopic = escapeMermaid(rootNode.title || "Mind Map");
        let mermaidContent = `mindmap\n  ((${rootTopic}))\n`;
        
        if (rootNode.notes) {
          mermaidContent += `    ::note(${escapeMermaid(rootNode.notes)})\n`;
        }
        
        mermaidContent += xmindNodeToMarkdown(rootNode, 0);
        return prefix + `\`\`\`mermaid\n${mermaidContent}\`\`\``;
      }).join("\n\n");
      this.exportMarkdownToClipboard(md);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      new Notice(i18n.t().notices.exportFailed.replace("{name}", file.name).replace("{error}", errorMsg));
    }
  }

  public exportMarkdownToClipboard(md: string): void {
    const t = i18n.t();
    const navigator = typeof window !== 'undefined' ? window.navigator : null;
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(md).then(() => {
        new Notice(t.notices.copiedToClipboard);
      }).catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        new Notice(t.notices.copyFailed.replace("{error}", errorMsg));
      });
    }
  }

  /** Export a .xmind file as Canvas (.canvas) */
  private async exportFileAsCanvas(file: TFile): Promise<void> {
    const existing = this.app.workspace
      .getLeavesOfType(XMIND_VIEW_TYPE)
      .find((leaf) => (leaf.view as XMindView).file?.path === file.path);

    if (existing) {
      const canvas = (existing.view as XMindView).exportAsCanvas();
      if (canvas) {
        await this.saveCanvasFile(file, canvas);
        return;
      }
    }

    try {
      const buffer = await this.app.vault.adapter.readBinary(normalizePath(file.path));
      const multiSheet = await parseXMind(buffer);
      const firstSheet = multiSheet.sheets[0];
      if (!firstSheet) return;

      const { convertToCanvas } = await import("./xmind/canvas");
      const canvasData = convertToCanvas(firstSheet);
      await this.saveCanvasFile(file, canvasData);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      new Notice(i18n.t().notices.exportFailed.replace("{name}", file.name).replace("{error}", errorMsg));
    }
  }

  public async saveCanvasFile(sourceFile: TFile, canvasData: string | object): Promise<void> {
    const canvasContent = typeof canvasData === "string" ? canvasData : JSON.stringify(canvasData, null, 2);
    const canvasPath = sourceFile.path.replace(/\.xmind$/i, ".canvas");
    
    // Check if file exists and handle naming if it does
    let finalPath = canvasPath;
    let idx = 1;
    while (this.app.vault.getAbstractFileByPath(finalPath)) {
      finalPath = canvasPath.replace(/\.canvas$/, ` ${idx++}.canvas`);
    }

    await this.app.vault.create(finalPath, canvasContent);
    new Notice(i18n.t().notices.exportedToCanvas.replace("{path}", finalPath));
    
    // Optionally open the new canvas file
    const newFile = this.app.vault.getAbstractFileByPath(finalPath);
    if (newFile instanceof TFile) {
      await this.app.workspace.getLeaf("tab").openFile(newFile);
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

import type { XMindNode } from "./xmind/types";

/**
 * Convert an XMindNode tree to a Mermaid mindmap (used for direct export
 * without an open view).
 */
function xmindNodeToMarkdown(node: XMindNode, depth: number): string {
  const indent = "  ".repeat(depth + 2);
  let result = "";
  
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      const escapedTitle = escapeMermaid(child.title);
      result += `${indent}${escapedTitle}\n`;
      if (child.notes) {
        result += `${indent}  ::note(${escapeMermaid(child.notes)})\n`;
      }
      if (child.children && child.children.length > 0) {
        result += xmindNodeToMarkdown(child, depth + 1);
      }
    }
  }
  
  return result;
}
