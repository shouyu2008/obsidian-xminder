import {
  Plugin,
  TFile,
  WorkspaceLeaf,
  normalizePath,
  Notice,
  addIcon,
} from "obsidian";
import { XMindView, XMIND_VIEW_TYPE } from "./views/XMindView";
import { registerEmbedProcessor } from "./markdown/EmbedProcessor";
import { XMindSettingTab, DEFAULT_SETTINGS } from "./settings";
import type { XMindPluginSettings } from "./settings";
import { serializeXMind } from "./xmind/serializer";
import { parseXMind } from "./xmind/parser";
import type { XMindData } from "./xmind/types";

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
    // Load settings first
    await this.loadSettings();

    // Register custom icon
    addIcon("xmind-icon", XMIND_ICON);

    // -------------------------------------------------------------------------
    // 1. Register .xmind file extension
    //    This makes .xmind files visible in the file explorer and opens them
    //    with our custom view when double-clicked.
    // -------------------------------------------------------------------------
    this.registerExtensions(["xmind"], XMIND_VIEW_TYPE);

    // -------------------------------------------------------------------------
    // 2. Register the XMind view
    // -------------------------------------------------------------------------
    this.registerView(
      XMIND_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new XMindView(leaf, this)
    );

    // -------------------------------------------------------------------------
    // 3. Register Markdown post processor for ![[]] and [[]] embeds
    // -------------------------------------------------------------------------
    registerEmbedProcessor(this);

    // -------------------------------------------------------------------------
    // 4. Register commands
    // -------------------------------------------------------------------------

    // Command: Create a new XMind file in the vault root
    this.addCommand({
      id: "create-new-xmind",
      name: "Create new XMind file",
      callback: async () => {
        await this.createNewXMindFile();
      },
    });

    // Command: Export current XMind view as Markdown outline
    this.addCommand({
      id: "export-xmind-as-markdown",
      name: "Export XMind as Markdown outline",
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

    // Command: Fit diagram to view
    this.addCommand({
      id: "xmind-fit-to-view",
      name: "Fit XMind diagram to view",
      checkCallback: (checking: boolean) => {
        const view = this.getActiveXMindView();
        if (!view) return false;
        if (!checking) {
          view.fitToView();
        }
        return true;
      },
    });

    // Command: Save current XMind file
    this.addCommand({
      id: "xmind-save",
      name: "Save XMind file",
      checkCallback: (checking: boolean) => {
        const view = this.getActiveXMindView();
        if (!view) return false;
        if (!checking) {
          void view.saveNow();
        }
        return true;
      },
    });

    // -------------------------------------------------------------------------
    // 5. File menu: right-click on .xmind files in explorer
    // -------------------------------------------------------------------------
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, abstractFile) => {
        if (!(abstractFile instanceof TFile)) return;
        if (abstractFile.extension.toLowerCase() !== "xmind") return;

        if (this.settings.showOpenAsXMind) {
          menu.addItem((item) => {
            item
              .setTitle("Open as XMind")
              .setIcon("xmind-icon")
              .onClick(() => {
                // Open with external XMind application
                const app = this.app as { openWithDefaultApp?: (path: string) => void };
                app.openWithDefaultApp?.(abstractFile.path);
              });
          });
        }

        menu.addItem((item) => {
          item
            .setTitle("Export as Markdown outline")
            .setIcon("file-text")
            .onClick(async () => {
              await this.exportFileAsMarkdown(abstractFile);
            });
        });
      })
    );

    // -------------------------------------------------------------------------
    // 6. Settings tab
    // -------------------------------------------------------------------------
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

  /** Create a new blank XMind file and open it */
  async createNewXMindFile(): Promise<void> {
    // Find a unique filename
    let name = "New Mind Map";
    let idx = 1;
    while (this.app.vault.getAbstractFileByPath(normalizePath(`${name}.xmind`))) {
      name = `New Mind Map ${idx++}`;
    }
    const path = normalizePath(`${name}.xmind`);

    const emptyData = {
      sheets: [{
        rootTopic: {
          id: Math.random().toString(36).slice(2, 10),
          title: "Central Topic",
          children: [
            {
              id: Math.random().toString(36).slice(2, 10),
              title: "Main Topic 1",
            },
            {
              id: Math.random().toString(36).slice(2, 10),
              title: "Main Topic 2",
            },
          ],
        },
        title: name,
      }],
    };

    try {
      const buffer = await serializeXMind(emptyData);
      await this.app.vault.adapter.writeBinary(path, buffer);

      // Trigger vault refresh so the file appears in explorer
      const newFile = this.app.vault.getAbstractFileByPath(path);
      if (newFile instanceof TFile) {
        await this.openXMindFile(newFile);
      } else {
        // Wait briefly for vault to index the new file
        // @ts-ignore - setTimeout is available in browser environment
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
        const setTimeoutFn = (typeof window !== 'undefined' && window.setTimeout) ? window.setTimeout.bind(window) : (fn: () => void, ms: number) => fn();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        setTimeoutFn(async () => {
          const f = this.app.vault.getAbstractFileByPath(path);
          if (f instanceof TFile) void this.openXMindFile(f);
        }, 200);
      }

      new Notice(`Created ${name}.xmind`);
    } catch (err) {
      new Notice(
        `XMinder: Failed to create file: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
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
      const md = multiSheet.sheets.map((sheet, i) => {
        const prefix = multiSheet.sheets.length > 1 ? `# ${sheet.title || `Sheet ${i + 1}`}\n\n` : "";
        return prefix + xmindNodeToMarkdown(sheet.rootTopic, 0);
      }).join("\n\n");
      this.exportMarkdownToClipboard(md);
    } catch (err) {
      new Notice(
        `XMinder: Failed to export "${file.name}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  /** Copy markdown text to clipboard and notify */
  private exportMarkdownToClipboard(md: string): void {
    // @ts-ignore - window and navigator are available in browser environment
    const navigator = typeof window !== 'undefined' ? window.navigator : null;
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(md).then(() => {
        new Notice("XMinder: Markdown outline copied to clipboard.");
      }).catch((err) => {
        new Notice(`XMinder: Failed to copy to clipboard: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

import type { XMindNode } from "./xmind/types";

/**
 * Convert an XMindNode tree to a Markdown outline (used for direct export
 * without an open view).
 */
function xmindNodeToMarkdown(node: XMindNode, depth: number): string {
  const indent = "  ".repeat(depth);
  const prefix = depth === 0 ? "# " : `${indent}- `;
  let result = `${prefix}${node.title}\n`;
  if (node.notes) {
    result += `${indent}  > ${node.notes.replace(/\n/g, `\n${indent}  > `)}\n`;
  }
  if (node.children) {
    for (const child of node.children) {
      result += xmindNodeToMarkdown(child, depth + 1);
    }
  }
  return result;
}
