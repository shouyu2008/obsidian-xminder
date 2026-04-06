import {
  FileView,
  WorkspaceLeaf,
  TFile,
  Notice,
  normalizePath,
  Scope,
  Menu,
} from "obsidian";
import MindElixir from "mind-elixir";
import type { MindElixirData, MindElixirInstance, NodeObj, Topic } from "mind-elixir";
import { parseXMind } from "../xmind/parser";
import { serializeXMind } from "../xmind/serializer";
import { convertToCanvas } from "../xmind/canvas";
import type { XMindNode, XMindData } from "../xmind/types";
import type XMindPlugin from "../main";
import { i18n } from "../i18n";
import { customLinkDiv } from "./LayoutEngine";
import type { LocalMindElixirData, LocalNodeObj } from "./LayoutEngine";

export const XMIND_VIEW_TYPE = "xmind-view";

// Debounce delay for auto-save (ms)
const AUTO_SAVE_DELAY = 500;

interface ExtendedMindElixirInstance {
  linkDiv?: (this: MindElixirInstance) => void;
  nodeData: LocalNodeObj;
  refresh: (data?: LocalMindElixirData) => void;
  moveNodeBefore: (nodes: Topic[], target: Topic) => void | Promise<void>;
  moveNodeAfter: (nodes: Topic[], target: Topic) => void | Promise<void>;
  moveNodeIn: (nodes: Topic[], target: Topic) => void | Promise<void>;
  getData: () => LocalMindElixirData;
  bus: {
    addListener: (name: string, callback: (info: unknown) => void) => void;
    fire: (name: string, info?: unknown) => void;
  };
}

// ---------------------------------------------------------------------------

export class XMindView extends FileView {
  private plugin: XMindPlugin;
  private mind: MindElixirInstance | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private _rootUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  private isDirty = false;
  /** All sheets from the current .xmind file */
  private allSheets: XMindData[] = [];
  /** Index of the currently displayed sheet */
  private activeSheetIndex = 0;

  constructor(leaf: WorkspaceLeaf, plugin: XMindPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return XMIND_VIEW_TYPE;
  }

  onPaneMenu(menu: Menu, source: string): void {
    const t = i18n.t();
    
    if (this.plugin.settings.showOpenAsXMind) {
      menu.addItem((item) => {
        item
          .setTitle(t.menus.openWithXMind)
          .setIcon("xmind-icon")
          .setSection("xmind-actions")
          .onClick(() => {
            const app = this.app as any;
            app.openWithDefaultApp?.(this.file?.path);
          });
      });
    }

    menu.addItem((item) => {
      item
        .setTitle(t.menus.exportAsMarkdown)
        .setIcon("file-text")
        .setSection("xmind-actions")
        .onClick(() => {
          const md = this.exportAsMarkdown();
          if (md) {
            this.plugin.exportMarkdownToClipboard(md);
          }
        });
    });

    menu.addItem((item) => {
      item
        .setTitle(t.menus.exportAsCanvas)
        .setIcon("layout-dashboard")
        .setSection("xmind-actions")
        .onClick(async () => {
          const canvas = this.exportAsCanvas();
          if (canvas) {
            await this.plugin.saveCanvasFile(this.file!, canvas);
          }
        });
    });

    super.onPaneMenu(menu, source);
  }

  getDisplayText(): string {
    return this.file?.basename ?? "XMind";
  }

  getIcon(): string {
    return "brain-circuit";
  }

  // FileView requires this — return true since we handle .xmind only
  canAcceptExtension(extension: string): boolean {
    return extension === "xmind";
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async onOpen(): Promise<void> {
    this.contentEl.addClass("xmind-view-container");

    // Initialize a scope so Ctrl/Cmd+S can be captured when this view is active
    this.scope = new Scope(this.app.scope);

    // Ctrl/Cmd + S to save immediately
    this.scope.register(["Mod"], "s", (e: KeyboardEvent) => {
      e.preventDefault();
      void this.saveNow();
    });
    await Promise.resolve();
  }

  async onClose(): Promise<void> {
    // Flush any pending auto-save before closing
    if (this.isDirty) {
      await this.saveNow();
    }
    this.destroyMind();
  }

  // -------------------------------------------------------------------------
  // FileView entry point — called by Obsidian whenever a file is opened
  // -------------------------------------------------------------------------

  async onLoadFile(file: TFile): Promise<void> {
    try {
      const buffer = await this.app.vault.adapter.readBinary(
        normalizePath(file.path)
      );
      const multiSheet = await parseXMind(buffer);
      this.allSheets = multiSheet.sheets;
      this.activeSheetIndex = 0;
      this.renderActiveSheet();
    } catch (err) {
      this.showError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Render the currently active sheet */
  private renderActiveSheet(): void {
    if (this.allSheets.length === 0) return;
    const sheet = this.allSheets[this.activeSheetIndex];
    const meData = xmindDataToMindElixir(sheet);
    this.renderMindElixir(meData);
  }

  /** Switch to a different sheet by index */
  private switchSheet(index: number): void {
    if (index < 0 || index >= this.allSheets.length) return;
    if (index === this.activeSheetIndex && this.mind) return;
    // Save current sheet edits before switching
    this.syncCurrentSheetData();
    this.activeSheetIndex = index;
    this.renderActiveSheet();
  }

  /** Sync current mind-elixir data back into allSheets */
  private syncCurrentSheetData(): void {
    if (!this.mind) return;
    const meData = this.mind.getData();
    const xmindData = mindElixirToXMindData(meData);
    this.allSheets[this.activeSheetIndex] = {
      ...this.allSheets[this.activeSheetIndex],
      rootTopic: xmindData.rootTopic,
      // We don't overwrite the sheet title with the root topic name, 
      // but retain the original sheet title already spread from allSheets.
    };
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    if (this.isDirty) {
      await this.saveNow();
    }
    this.destroyMind();
    this.contentEl.empty();
  }

  // -------------------------------------------------------------------------
  // MindElixir rendering
  // -------------------------------------------------------------------------

  private renderMindElixir(data: MindElixirData): void {
    this.destroyMind();
    this.contentEl.empty();

    // Use document.createElement so the element passes mind-elixir's
    // [object HTMLDivElement] type check reliably in Electron/Obsidian.
    const wrapper = document.createElement("div");
    wrapper.className = "xmind-mind-wrapper";
    this.contentEl.appendChild(wrapper);

    const isDark = document.body.classList.contains("theme-dark");

    const options = {
      el: wrapper,
      direction: MindElixir.SIDE,
      draggable: true,
      editable: true,
      contextMenu: false,   // disable right-click context menu
      toolBar: false,       // we build our own toolbars
      keypress: true,
      allowUndo: true,
      theme: isDark ? MindElixir.DARK_THEME : MindElixir.THEME,
      selectionContainer: document.body,  // fix selection rect offset (avoid scroll/transform issues)
    };

    try {
      this.mind = new MindElixir(options);

      // Inject custom linkDiv before init() so every layout call uses it
      const extendedMind = this.mind as MindElixirInstance & ExtendedMindElixirInstance;
      const linkDiv = customLinkDiv.bind(this.mind) as (this: MindElixirInstance) => void;
      extendedMind.linkDiv = linkDiv;

      this.mind.init(data);

      // Patch: Fix node editing text display issue
      // When editing a node, the original text element should be hidden
      // to avoid showing "new node" alongside the input box
      // NOTE: Disabled for now due to potential conflicts with mind-elixir internals
      // this.patchNodeEditingDisplay();

      // Patch: allow dropping nodes onto root and fix drag-and-drop edge cases
      if (extendedMind.nodeData) {
        // 1. Root node parent patch: ensure it's always a valid drop target
        const applyParentPatch = (nd: Record<string, unknown>): void => {
          nd.parent = true;
          Object.defineProperty(nd, 'parent', {
            get: () => true,
            set: () => {}, // no-op: prevent overwrite by internal logic
            configurable: true,
            enumerable: true,
          });
        };

        applyParentPatch(extendedMind.nodeData as unknown as Record<string, unknown>);

        // Use unknown bridge to avoid pollution from potentially any-typed MindElixirInstance
        const mind = extendedMind as unknown as ExtendedMindElixirInstance;

        // 2. Patch refresh() so the parent patch survives undo/redo
        const originalRefresh = (mind.refresh.bind(mind) as unknown) as (data?: LocalMindElixirData) => void;
        mind.refresh = ((data?: LocalMindElixirData): void => {
          originalRefresh(data);
          if (mind.nodeData) applyParentPatch(mind.nodeData as unknown as Record<string, unknown>);
        }) as (data?: LocalMindElixirData) => void;

        // 3. Patch moveNodeBefore/After to redirect to moveNodeIn when the target is root.
        // This prevents the "node loss" bug where dropping on root edges removes nodes
        // from their parent but fails to attach them back because root has no siblings.
        const originalMoveBefore = (mind.moveNodeBefore.bind(mind) as unknown) as (nodes: Topic[], target: Topic) => void | Promise<void>;
        const originalMoveAfter = (mind.moveNodeAfter.bind(mind) as unknown) as (nodes: Topic[], target: Topic) => void | Promise<void>;

        mind.moveNodeBefore = ((nodes: Topic[], target: Topic): void | Promise<void> => {
          if (target?.tagName === 'ME-TPC' && target.parentElement?.tagName === 'ME-ROOT') {
            return mind.moveNodeIn(nodes, target);
          }
          return originalMoveBefore(nodes, target);
        }) as (nodes: Topic[], target: Topic) => void | Promise<void>;

        mind.moveNodeAfter = ((nodes: Topic[], target: Topic): void | Promise<void> => {
          if (target?.tagName === 'ME-TPC' && target.parentElement?.tagName === 'ME-ROOT') {
            return mind.moveNodeIn(nodes, target);
          }
          return originalMoveAfter(nodes, target);
        }) as (nodes: Topic[], target: Topic) => void | Promise<void>;

        // 4. Ensure getData() always includes parent=true for root topic in exports
        const originalGetData = (mind.getData.bind(mind) as unknown) as () => LocalMindElixirData;
        mind.getData = ((): LocalMindElixirData => {
          const data = originalGetData();
          if (data?.nodeData) {
            // Use Record cast to bypass type check safely for the parent boolean property
            const rootNode = data.nodeData as unknown as Record<string, unknown>;
            rootNode.parent = true;
          }
          return data;
        }) as () => LocalMindElixirData;

        // 5. Layout safety: Force refresh after any drag ends regardless of success.
        // This handles "release without snap" cases by resetting the absolute layout.
        const mapCanvas = wrapper.querySelector(".map-canvas");
        if (mapCanvas instanceof HTMLElement) {
          mapCanvas.addEventListener("dragend", () => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (this.mind) customLinkDiv.call(this.mind);
              });
            });
          }, { passive: true });
        }
      }
    } catch (initErr) {
      this.showError(initErr instanceof Error ? initErr.message : String(initErr));
      return;
    }

    // -----------------------------------------------------------------------
    // Custom toolbars
    // -----------------------------------------------------------------------
    {
      const container = wrapper.querySelector(".map-container");
      const mapEl = wrapper.querySelector(".map-canvas");
      const mind = this.mind;

      if (container instanceof HTMLElement && mapEl instanceof HTMLElement && mind) {
        // --- SVG icons ---
        const ICON_POINTER = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>`;
        const ICON_HAND = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8H12c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>`;
        const ICON_CENTER = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/></svg>`;
        const ICON_HELP = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
        const ICON_RESET = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
        const ICON_ZOOMIN = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`;
        const ICON_ZOOMOUT = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`;

        const renderSvg = (container: HTMLElement, svg: string): void => {
          const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
          const svgEl = parsed.documentElement;
          container.replaceChildren(svgEl);
        };

        const updateBtnIcon = (btn: HTMLButtonElement, icon: string): void => {
          const wrapper = btn.querySelector(".xmind-toolbar-icon");
          if (wrapper instanceof HTMLElement) {
            renderSvg(wrapper, icon);
            return;
          }
          const iconWrapper = document.createElement("div");
          iconWrapper.className = "xmind-toolbar-icon";
          renderSvg(iconWrapper, icon);
          btn.replaceChildren(iconWrapper);
        };

        const makeBtn = (icon: string, title: string): HTMLButtonElement => {
          const btn = document.createElement("button");
          btn.className = "xmind-toolbar-btn";
          btn.title = title;
          const iconWrapper = document.createElement("div");
          iconWrapper.className = "xmind-toolbar-icon";
          renderSvg(iconWrapper, icon);
          btn.appendChild(iconWrapper);
          return btn;
        };

        const t = i18n.t();

        const leftBar = document.createElement("div");
        leftBar.className = "xmind-toolbar-left";

        const dragBtn = makeBtn(ICON_HAND, t.view.dragCanvas);
        leftBar.appendChild(dragBtn);

        const centerBtn = makeBtn(ICON_CENTER, t.view.focusRoot);
        centerBtn.addEventListener("click", () => {
          mind.toCenter();
        });
        leftBar.appendChild(centerBtn);

        const helpBtn = makeBtn(ICON_HELP, t.view.shortcutsHelp);
        helpBtn.addEventListener("click", () => {
          const helpEl = container.querySelector(".xmind-help-panel");
          if (helpEl instanceof HTMLElement) {
            helpEl.setCssStyles({
              display: helpEl.style.display === "none" ? "block" : "none",
            });
          }
        });
        leftBar.appendChild(helpBtn);

        container.appendChild(leftBar);

        const helpPanel = document.createElement("div");
        helpPanel.className = "xmind-help-panel";
        helpPanel.setCssStyles({ display: "none" });
        
        const helpTitle = document.createElement("div");
        helpTitle.className = "xmind-help-title";
        helpTitle.textContent = t.view.shortcuts;
        helpPanel.appendChild(helpTitle);
        
        const helpTable = document.createElement("table");
        helpTable.className = "xmind-help-table";
        const shortcuts = [
          ["Tab", t.view.addChildNode],
          ["Enter", t.view.addSiblingNode],
          ["Ctrl+C", t.view.copy],
          ["Ctrl+V", t.view.paste],
          ["Ctrl+Z", t.view.undo],
          ["Ctrl+S", t.view.save],
        ];
        
        for (const [key, desc] of shortcuts) {
          const row = helpTable.insertRow();
          const keyCell = row.insertCell();
          const descCell = row.insertCell();
          const keybd = document.createElement("kbd");
          keybd.textContent = key;
          keyCell.appendChild(keybd);
          descCell.textContent = desc;
        }
        
        helpPanel.appendChild(helpTable);
        container.appendChild(helpPanel);

        // Click anywhere outside help panel to close it
        // Use capture phase to ensure this runs before pan mode's stopPropagation
        document.addEventListener("mousedown", (e: MouseEvent) => {
          if (helpPanel.style.display === "none") return;
          const target = e.target as HTMLElement;
          if (!helpPanel.contains(target) && target !== helpBtn && !helpBtn.contains(target)) {
            helpPanel.setCssStyles({ display: "none" });
          }
        }, true);

        const ICON_FULLSCREEN = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;

        const rbBar = document.createElement("div");
        rbBar.className = "xmind-toolbar-rb";

        const zoomOutBtn = makeBtn(ICON_ZOOMOUT, t.view.zoomOut);
        zoomOutBtn.addEventListener("click", () => {
          if (mind.scaleVal > 0.6) mind.scale(mind.scaleVal - mind.scaleSensitivity);
        });
        rbBar.appendChild(zoomOutBtn);

        const zoomInBtn = makeBtn(ICON_ZOOMIN, t.view.zoomIn);
        zoomInBtn.addEventListener("click", () => {
          if (mind.scaleVal < 1.6) mind.scale(mind.scaleVal + mind.scaleSensitivity);
        });
        rbBar.appendChild(zoomInBtn);

        const resetBtn = makeBtn(ICON_RESET, t.view.resetCanvas);
        resetBtn.addEventListener("click", () => {
          mind.scaleFit();
          mind.toCenter();
        });
        rbBar.appendChild(resetBtn);

        const fullscreenBtn = makeBtn(ICON_FULLSCREEN, t.view.fullscreen);
        fullscreenBtn.addEventListener("click", () => {
          if (document.fullscreenElement === mind.el) {
            void document.exitFullscreen();
          } else {
            void mind.el.requestFullscreen();
          }
        });
        rbBar.appendChild(fullscreenBtn);

        container.appendChild(rbBar);

        if (this.allSheets.length > 1) {
          const sheetSelector = document.createElement("div");
          sheetSelector.className = "xmind-sheet-selector";

          const select = document.createElement("select");
          select.className = "xmind-sheet-select";
          this.allSheets.forEach((sheet, i) => {
            const option = document.createElement("option");
            option.value = String(i);
            option.textContent = sheet.title || `${t.defaults.canvas} ${i + 1}`;
            if (i === this.activeSheetIndex) option.selected = true;
            select.appendChild(option);
          });
          select.addEventListener("change", () => {
            this.switchSheet(Number(select.value));
          });
          sheetSelector.appendChild(select);
          container.appendChild(sheetSelector);
        }

        let panEnabled = false;
        let isPanning = false;
        let startX = 0;
        let startY = 0;
        let scrollX = 0;
        let scrollY = 0;

        dragBtn.addEventListener("click", () => {
          panEnabled = !panEnabled;
          updateBtnIcon(dragBtn, panEnabled ? ICON_POINTER : ICON_HAND);
          dragBtn.title = panEnabled ? t.view.switchToPointer : t.view.switchToDrag;
          mapEl.setCssStyles({ cursor: panEnabled ? "grab" : "" });
        });

        mapEl.addEventListener("mousedown", (e: MouseEvent) => {
          if (!panEnabled || e.button !== 0) return;
          const target = e.target as HTMLElement;
          if (target.closest("me-tpc, me-epd, .xmind-toolbar-left, .xmind-toolbar-rb")) return;
          isPanning = true;
          startX = e.clientX;
          startY = e.clientY;
           scrollX = container.scrollLeft;
           scrollY = container.scrollTop;
           mapEl.setCssStyles({ cursor: "grabbing" });
          e.preventDefault();
          e.stopPropagation();
        }, true);

        window.addEventListener("mousemove", (e: MouseEvent) => {
          if (!isPanning) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          container.scrollTo(scrollX - dx, scrollY - dy);
        });

        window.addEventListener("mouseup", () => {
          if (isPanning) {
            isPanning = false;
            mapEl.setCssStyles({ cursor: panEnabled ? "grab" : "" });
          }
        });
      }
    }

    // -----------------------------------------------------------------------
    // Fix: Prevent mind-elixir from blocking Ctrl+H and other unhandled
    // key combos. mind-elixir calls preventDefault() on ALL keydown events
    // even when it does not handle them. We intercept at capture phase and
    // only let mind-elixir's handler run for keys it actually handles.
    // -----------------------------------------------------------------------
    const handledKeys = new Set([
      "Enter", "Tab", "F1", "F2",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "PageUp", "PageDown",
      "Delete", "Backspace",
      "c", "x", "v", "+", "-", "0", "z", "Z", "y",
    ]);
    const mapCanvas = wrapper.querySelector(".map-canvas");
    if (mapCanvas instanceof HTMLElement) {
      mapCanvas.addEventListener("keydown", (e: KeyboardEvent) => {
        // Let mind-elixir handle its known keys; stop propagation for all others
        // so that mind-elixir's blanket preventDefault() does not fire.
        if (!handledKeys.has(e.key)) {
          e.stopPropagation();
        }
      }, true); // capture phase — runs before mind-elixir's handler
    }

    // Re-center after DOM layout is complete
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!this.mind) return;
        this.mind.scaleFit();
        this.mind.toCenter();
      });
    });

    // Listen for any operation (edit/add/remove/move) → trigger auto-save
    this.mind.bus.addListener("operation", (info) => {
      this.scheduleSave();
    });

    // Listen for selectNode events to detect root node edits
    // This is triggered when a node is selected after editing
    this.mind.bus.addListener("selectNode", (node: NodeObj) => {
      // Check if the selected node is the root node
      if (node && (node.id === 'root' || node.id === this.mind?.nodeData?.id)) {
        // Force a layout update when root node is selected (after edit)
        requestAnimationFrame(() => {
          if (this.mind) {
            // Apply custom layout directly
            customLinkDiv.call(this.mind);
          }
        });
      }
    });

    // Listen for finishEdit events to detect when editing is complete
    // This is more reliable than selectNode for detecting text changes
    (this.mind.bus as { addListener?: (event: string, handler: (node: NodeObj) => void) => void }).addListener?.("finishEdit", (node: NodeObj) => {
      // Check if the edited node is the root node
      if (node && (node.id === 'root' || node.id === this.mind?.nodeData?.id)) {
        // Force a layout update when root node edit is finished
        requestAnimationFrame(() => {
          if (this.mind) {
            // Apply custom layout directly
            customLinkDiv.call(this.mind);
          }
        });
      }
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

    // Re-fit when container is resized (split pane, sidebar toggle, etc.)
    const resizeObserver = new ResizeObserver(() => {
      if (!this.mind) return;
      // Debounce to avoid excessive calls during animated resize
      if (this._resizeTimer !== null) clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => {
        this._resizeTimer = null;
        if (!this.mind) return;
        this.mind.scaleFit();
        this.mind.toCenter();
      }, 200);
    });
    resizeObserver.observe(wrapper);
    this.register(() => resizeObserver.disconnect());

    // Watch for root node text changes to trigger layout updates
    // This ensures right-side nodes move when root text increases
    const rootTpc = wrapper.querySelector("me-root > me-tpc") as HTMLElement;
    const meRoot = wrapper.querySelector("me-root") as HTMLElement;
    
    if (rootTpc && meRoot) {
      // Add ResizeObserver to monitor root node size changes
      // This is more reliable than MutationObserver for layout updates
      const rootResizeObserver = new ResizeObserver(() => {
        if (!this.mind) return;
        // Debounce to avoid excessive layout updates
        if (this._rootUpdateTimer !== null) clearTimeout(this._rootUpdateTimer);
        this._rootUpdateTimer = setTimeout(() => {
          this._rootUpdateTimer = null;
          if (!this.mind) return;
          // Apply custom layout directly
          customLinkDiv.call(this.mind);
        }, 50);
      });
      rootResizeObserver.observe(rootTpc);
      this.register(() => rootResizeObserver.disconnect());

      const rootObserver = new MutationObserver(() => {
        if (!this.mind) return;
        // Debounce to avoid excessive layout updates
        if (this._rootUpdateTimer !== null) clearTimeout(this._rootUpdateTimer);
        this._rootUpdateTimer = setTimeout(() => {
          this._rootUpdateTimer = null;
          if (!this.mind) return;
          // Apply custom layout directly
          customLinkDiv.call(this.mind);
        }, 100);
      });
      
      // Observe both the root tpc and its parent for comprehensive change detection
      rootObserver.observe(rootTpc, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
      
      rootObserver.observe(meRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
      
      this.register(() => rootObserver.disconnect());

      // Add direct event listeners for root node input box
      // This catches editing events that might not trigger mutation observer
      const setupInputListener = () => {
        const inputBox = rootTpc.querySelector("#input-box") as HTMLInputElement;
        if (inputBox) {
          // Listen for input changes
          inputBox.addEventListener("input", () => {
            if (!this.mind) return;
            if (this._rootUpdateTimer !== null) clearTimeout(this._rootUpdateTimer);
            this._rootUpdateTimer = setTimeout(() => {
              this._rootUpdateTimer = null;
              if (!this.mind) return;
              // Apply custom layout directly
              customLinkDiv.call(this.mind);
            }, 50);
          });

          // Listen for blur (when editing finishes)
          inputBox.addEventListener("blur", () => {
            if (!this.mind) return;
            requestAnimationFrame(() => {
              if (this.mind) {
                // Apply custom layout directly
                customLinkDiv.call(this.mind);
              }
            });
          });

          // Listen for keyboard events to catch Enter key
          inputBox.addEventListener("keydown", (e: KeyboardEvent) => {
            if (!this.mind) return;
            if (e.key === "Enter") {
              // Force layout update when Enter is pressed
              requestAnimationFrame(() => {
                if (this.mind) {
                  customLinkDiv.call(this.mind);
                }
              });
            }
          });
        }
      };

      // Set up listener immediately if input box exists
      setupInputListener();

      // Also watch for input box creation (when editing starts)
      const inputObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            for (const node of Array.from(mutation.addedNodes)) {
              if (node instanceof HTMLElement && node.id === 'input-box') {
                setupInputListener();
                break;
              }
            }
          }
        }
      });
      inputObserver.observe(rootTpc, { childList: true });
      this.register(() => inputObserver.disconnect());
    }
  }

  /**
   * Patch to fix the node editing display issue
   * When editing a node, the original text span should be hidden to prevent
   * showing "new node" alongside the input box, especially on deep nodes (level 3+)
   * We use visibility: hidden instead of display: none to preserve layout calculations
   */
  private patchNodeEditingDisplay(): void {
    if (!this.mind || !this.contentEl) return;

    const mapCanvas = this.contentEl.querySelector(".map-canvas");
    if (!(mapCanvas instanceof HTMLElement)) return;

    // Track which text spans are currently hidden due to editing
    const hiddenTextSpans = new WeakMap<HTMLElement, HTMLElement>();

    // Use MutationObserver with precise targeting: only observe direct children of map-canvas
    // and specifically look for input-box elements. This minimizes performance impact.
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          // Only process addedNodes/removedNodes, not all descendants
          for (const node of Array.from(mutation.addedNodes)) {
            if (node instanceof HTMLElement && node.id === "input-box") {
              // Found the input-box element, now hide the original text span
              const meParent = node.parentElement?.closest("me-parent");
              if (meParent instanceof HTMLElement) {
                const textSpan = meParent.querySelector("span.text");
                 if (textSpan instanceof HTMLElement) {
                   // Use visibility: hidden instead of display: none
                   // This keeps the element in the layout but makes it invisible
                   textSpan.setCssStyles({ visibility: "hidden" });
                   // Remember which text span we hid for this node
                   hiddenTextSpans.set(node, textSpan);
                 }
              }
            }
          }

          for (const node of Array.from(mutation.removedNodes)) {
            if (node instanceof HTMLElement && node.id === "input-box") {
              // Input-box removed, restore the text span
              const textSpan = hiddenTextSpans.get(node);
               if (textSpan instanceof HTMLElement) {
                 // Restore visibility
                 textSpan.setCssStyles({ visibility: "visible" });
               }
            }
          }
        }
      }
    });

    // Only observe me-tpc elements (node containers) for input-box additions
    // This is more targeted than observing the entire map-canvas
    const meRoot = mapCanvas.querySelector("me-root");
    if (meRoot instanceof HTMLElement) {
      // Observe me-tpc elements (the direct containers that will have input-box as child)
      observer.observe(meRoot, { childList: true, subtree: true });
    } else {
      // Fallback: observe map-canvas if me-root not found
      observer.observe(mapCanvas, { childList: true, subtree: true });
    }

    // Clean up observer when mind is destroyed
    this.register(() => observer.disconnect());
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
      void this.saveNow();
    }, delay);
  }

  async saveNow(): Promise<void> {
    if (!this.file || !this.mind) return;

    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    try {
      // Sync current sheet edits, then save all sheets
      this.syncCurrentSheetData();
      const buffer = await serializeXMind({ sheets: this.allSheets });
      await this.app.vault.adapter.writeBinary(
        normalizePath(this.file.path),
        buffer
      );
      this.isDirty = false;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      new Notice(i18n.t().notices.saveFailed.replace("{error}", errorMsg));
    }
  }

  // -------------------------------------------------------------------------
  // Commands exposed to main.ts
  // -------------------------------------------------------------------------

  /** Export current mind map data as Mermaid mindmap */
  exportAsMarkdown(): string {
    if (!this.mind) return "";
    const data = this.mind.getData();
    if (!data || !data.nodeData) return "";
    
    const rootNode = data.nodeData;
    const rootTopic = escapeMermaid(rootNode.topic || "Mind Map");
    // Use the escaped root topic in a circle shape
    let mermaidContent = `mindmap\n  ((${rootTopic}))\n`;
    
    if (rootNode.note) {
      mermaidContent += `    ::note(${escapeMermaid(rootNode.note)})\n`;
    }
    
    mermaidContent += mindElixirNodeToMermaid(rootNode, 0);
    return `\`\`\`mermaid\n${mermaidContent}\`\`\``;
  }

  /** Export current mind map data as Obsidian Canvas (.canvas) */
  exportAsCanvas(): string {
    if (!this.mind) return "";
    this.syncCurrentSheetData();
    const sheet = this.allSheets[this.activeSheetIndex];
    if (!sheet) return "";
    
    const canvasData = convertToCanvas(sheet);
    return JSON.stringify(canvasData, null, 2);
  }

  /** Fit the diagram to the viewport */
  fitToView(): void {
    this.mind?.scaleFit();
    this.mind?.toCenter();
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private showError(msg: string): void {
    this.contentEl.empty();
    const el = document.createElement("div");
    el.className = "xmind-error";
    el.textContent = i18n.t().notices.error.replace("{error}", msg);
    this.contentEl.appendChild(el);
    new Notice(i18n.t().notices.error.replace("{error}", msg));
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

export function escapeMermaid(text: string): string {
  if (!text) return "";
  return text
    .replace(/\n/g, " ")       // Mindmap nodes must be single line
    .replace(/"/g, "")         // Remove double quotes as they cause &quot; issues
    .replace(/[()\[\]{}]/g, "") // Remove shape delimiters
    .replace(/;/g, " ")        // Remove semicolons
    .trim();
}

function mindElixirNodeToMermaid(node: NodeObj, depth: number): string {
  const indent = "  ".repeat(depth + 2);
  let result = "";
  
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      const escapedTopic = escapeMermaid(child.topic);
      result += `${indent}${escapedTopic}\n`;
      if (child.note) {
        result += `${indent}  ::note(${escapeMermaid(child.note)})\n`;
      }
      if (child.children && child.children.length > 0) {
        result += mindElixirNodeToMermaid(child, depth + 1);
      }
    }
  }
  
  return result;
}
