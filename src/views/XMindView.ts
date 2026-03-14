import {
  FileView,
  WorkspaceLeaf,
  TFile,
  Notice,
  normalizePath,
  Scope,
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

// Type for mind-elixir instance with custom properties
interface ExtendedMindElixirInstance {
  linkDiv?: (this: MindElixirInstance) => void;
  nodeData?: NodeObj & { parent?: boolean };
}

// ---------------------------------------------------------------------------
// Custom absolute-position layout engine
// ---------------------------------------------------------------------------

// Horizontal gap between adjacent levels (px)
const H_GAP = 60;
// Minimum vertical gap between sibling node boxes (px)
const V_GAP = 16;
// Horizontal padding inside the canvas before the root node
const CANVAS_CENTER = 10000;

interface LayoutNode {
  nodeObj: NodeObj;
  tpc: HTMLElement;      // me-tpc element
  parent: HTMLElement;   // me-parent element
  width: number;
  height: number;
  children: LayoutNode[];
  // Computed by layout pass
  x: number;            // left edge of me-tpc
  y: number;            // top edge of me-tpc (centre-aligned to subtree)
  subtreeH: number;     // total height this subtree occupies vertically
  direction: "lhs" | "rhs";
  depth: number;        // 1 = direct child of root
}

/**
 * Build the LayoutNode tree from mind-elixir's DOM.
 * We walk me-main.lhs / me-main.rhs and collect me-tpc nodes along with
 * their natural dimensions.
 */
function buildLayoutTree(
  nodesEl: HTMLElement,
  nodeData: NodeObj
): { lhs: LayoutNode[]; rhs: LayoutNode[]; root: { tpc: HTMLElement; meRoot: HTMLElement; width: number; height: number } } {
  const meRootEl = nodesEl.querySelector("me-root") as HTMLElement;
  const rootTpc = meRootEl.querySelector("me-tpc") as HTMLElement;
  // Temporarily force intrinsic sizing on root tpc to avoid flex stretching.
  // In mind-elixir's flex layout, me-root can be stretched vertically by
  // align-items, causing me-tpc (display:block) to fill the stretched height.
  const savedRootTpcW = rootTpc.style.width;
  const savedRootTpcH = rootTpc.style.height;
  rootTpc.addClass("xmind-fit-content");
  void rootTpc.offsetHeight; // force reflow
  const rootW = rootTpc.offsetWidth;
  const rootH = rootTpc.offsetHeight;
  rootTpc.removeClass("xmind-fit-content");
  if (savedRootTpcW) rootTpc.style.width = savedRootTpcW;
  if (savedRootTpcH) rootTpc.style.height = savedRootTpcH;

  function buildChildren(
    meChildren: HTMLElement,
    parentObj: NodeObj,
    dir: "lhs" | "rhs",
    depth: number
  ): LayoutNode[] {
    const result: LayoutNode[] = [];
    const wrappers = Array.from(meChildren.children);
    for (const wrapper of wrappers) {
      const meParent = wrapper.querySelector(":scope > me-parent");
      if (!(meParent instanceof HTMLElement)) continue;
      const tpc = meParent.querySelector("me-tpc");
      if (!(tpc instanceof HTMLElement)) continue;
      // Find the matching nodeObj
      const id = tpc.dataset.nodeid?.replace(/^me/, "") ?? "";
      const obj = findNodeById(parentObj, id) ?? (tpc as { nodeObj?: NodeObj }).nodeObj as NodeObj;

      const w = tpc.offsetWidth;
      const h = tpc.offsetHeight;

      // Recurse into children
      const meChildrenEl = wrapper.querySelector(":scope > me-children");
      const childNodes = meChildrenEl instanceof HTMLElement && (obj.expanded !== false)
        ? buildChildren(meChildrenEl, obj, dir, depth + 1)
        : [];

      result.push({
        nodeObj: obj,
        tpc,
        parent: meParent,
        width: w,
        height: h,
        children: childNodes,
        x: 0,
        y: 0,
        subtreeH: 0,
        direction: dir,
        depth,
      });
    }
    return result;
  }

  const lhsMain = nodesEl.querySelector("me-main.lhs") as HTMLElement;
  const rhsMain = nodesEl.querySelector("me-main.rhs") as HTMLElement;

  const lhsNodes: LayoutNode[] = [];
  const rhsNodes: LayoutNode[] = [];

  if (lhsMain) {
    const wrappers = Array.from(lhsMain.children);
    for (const wrapper of wrappers) {
      const meParent = wrapper.querySelector(":scope > me-parent");
      if (!(meParent instanceof HTMLElement)) continue;
      const tpc = meParent.querySelector("me-tpc");
      if (!(tpc instanceof HTMLElement)) continue;
      const id = tpc.dataset.nodeid?.replace(/^me/, "") ?? "";
      const obj = findNodeById(nodeData, id) ?? (tpc as { nodeObj?: NodeObj }).nodeObj as NodeObj;
      const w = tpc.offsetWidth;
      const h = tpc.offsetHeight;
      const meChildrenEl = wrapper.querySelector(":scope > me-children");
      const children = meChildrenEl instanceof HTMLElement && (obj.expanded !== false)
        ? buildChildren(meChildrenEl, obj, "lhs", 2)
        : [];
      lhsNodes.push({ nodeObj: obj, tpc, parent: meParent, width: w, height: h, children, x: 0, y: 0, subtreeH: 0, direction: "lhs", depth: 1 });
    }
  }

  if (rhsMain) {
    const wrappers = Array.from(rhsMain.children);
    for (const wrapper of wrappers) {
      const meParent = wrapper.querySelector(":scope > me-parent");
      if (!(meParent instanceof HTMLElement)) continue;
      const tpc = meParent.querySelector("me-tpc");
      if (!(tpc instanceof HTMLElement)) continue;
      const id = tpc.dataset.nodeid?.replace(/^me/, "") ?? "";
      const obj = findNodeById(nodeData, id) ?? (tpc as { nodeObj?: NodeObj }).nodeObj as NodeObj;
      const w = tpc.offsetWidth;
      const h = tpc.offsetHeight;
      const meChildrenEl = wrapper.querySelector(":scope > me-children");
      const children = meChildrenEl instanceof HTMLElement && (obj.expanded !== false)
        ? buildChildren(meChildrenEl, obj, "rhs", 2)
        : [];
      rhsNodes.push({ nodeObj: obj, tpc, parent: meParent, width: w, height: h, children, x: 0, y: 0, subtreeH: 0, direction: "rhs", depth: 1 });
    }
  }

  return { lhs: lhsNodes, rhs: rhsNodes, root: { tpc: rootTpc, meRoot: meRootEl, width: rootW, height: rootH } };
}

/** Recursively search nodeData tree for a node by id */
function findNodeById(root: NodeObj, id: string): NodeObj | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * Compute subtreeH for every node bottom-up.
 * subtreeH = total vertical span this node + its descendants require.
 */
function computeSubtreeHeights(nodes: LayoutNode[]): void {
  for (const node of nodes) {
    computeSubtreeHeight(node);
  }
}

function computeSubtreeHeight(node: LayoutNode): void {
  if (node.children.length === 0) {
    node.subtreeH = node.height;
    return;
  }
  for (const child of node.children) {
    computeSubtreeHeight(child);
  }
  const totalChildH = node.children.reduce((s, c) => s + c.subtreeH, 0)
    + Math.max(0, node.children.length - 1) * V_GAP;
  // The node itself must be at least as tall as its children block
  node.subtreeH = Math.max(node.height, totalChildH);
}

/**
 * Assign x, y positions top-down.
 *
 * RHS: Nodes expand rightward from root's right edge.
 *      Level-1 left edge = rootRight + H_GAP, level-N left edge = parent right + H_GAP.
 *
 * LHS: Nodes expand leftward from root's left edge.
 *      Level-1 right edge = rootLeft - H_GAP, level-N right edge = parent left - H_GAP.
 *
 * Vertically: all sibling nodes (children of the same parent) are evenly distributed
 * around the parent's vertical centre (or the root centre for level-1 nodes).
 *
 * @param nodes       — sibling nodes to position at this level
 * @param dir         — "lhs" or "rhs"
 * @param parentCentreY — vertical centre of the parent node (root centre for L1)
 * @param anchorX     — RHS: left edge for this level; LHS: right edge for this level
 */
function assignPositions(
  nodes: LayoutNode[],
  dir: "lhs" | "rhs",
  parentCentreY: number,
  anchorX: number
): void {
  if (nodes.length === 0) return;

  // Total vertical space needed by all siblings + gaps between them
  const totalH = nodes.reduce((s, n) => s + n.subtreeH, 0)
    + (nodes.length - 1) * V_GAP;
  let curY = parentCentreY - totalH / 2;

  for (const node of nodes) {
    // --- Y: centre this node's box within its subtree slot ---
    const slotTop = curY;
    const slotH = node.subtreeH;
    node.y = slotTop + (slotH - node.height) / 2;

    // --- X: position based on direction ---
    if (dir === "rhs") {
      // anchorX is the left edge for this level
      node.x = anchorX;
    } else {
      // anchorX is the right boundary for this level; node grows leftward
      node.x = anchorX - node.width;
    }

    // --- Recurse into children ---
    if (node.children.length > 0) {
      const childCentreY = node.y + node.height / 2;
      let childAnchorX: number;
      if (dir === "rhs") {
        // Children start to the right of this node
        childAnchorX = node.x + node.width + H_GAP;
      } else {
        // Children start to the left of this node
        childAnchorX = node.x - H_GAP;
      }
      assignPositions(node.children, dir, childCentreY, childAnchorX);
    }

    curY += slotH + V_GAP;
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

function makeSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("overflow", "visible");
  svg.style.position = "absolute";
  svg.style.top = "0";
  svg.style.left = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.pointerEvents = "none";
  svg.style.zIndex = "-1";
  return svg;
}

function makePath(d: string, color: string, width: string): SVGPathElement {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("stroke", color);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-width", width);
  path.setAttribute("stroke-linecap", "round");
  return path;
}

/**
 * Draw SVG connectors.
 * Root → L1: cubic bezier from root centre to left/right edge of L1 node.
 * L1+ → children: cubic bezier from parent right/left edge midpoint to child.
 *
 * All coordinates in LayoutNode are LOCAL (root at 0,0). We apply offsetX/offsetY
 * to translate into the me-nodes coordinate system before drawing.
 */
function drawConnectors(
  svg: SVGSVGElement,
  lhsNodes: LayoutNode[],
  rhsNodes: LayoutNode[],
  localRootX: number,
  localRootY: number,
  rootW: number,
  rootH: number,
  offsetX: number,
  offsetY: number,
  palette: string[]
): void {
  // Translated root
  const rootLeft = localRootX + offsetX;
  const rootTop = localRootY + offsetY;
  const rootCY = rootTop + rootH / 2;

  let colorIdx = 0;

  // Draw L1 branches and their sub-branches
  function drawBranch(node: LayoutNode, parentCY: number, parentRight: number, parentLeft: number, color: string, isRoot: boolean): void {
    // Translate node position
    const nLeft = node.x + offsetX;
    const nTop = node.y + offsetY;
    const nW = node.width;
    const nH = node.height;
    const nCY = nTop + nH / 2;

    let d: string;
    if (node.direction === "rhs") {
      // Root → L1: start from root RIGHT edge; Parent → child: start from parent right edge
      const startX = isRoot ? rootLeft + rootW : parentRight;
      const endX = nLeft;
      const cp = (startX + endX) / 2;
      d = `M ${startX} ${parentCY} C ${cp} ${parentCY} ${cp} ${nCY} ${endX} ${nCY}`;
    } else {
      // Root → L1: start from root LEFT edge; Parent → child: start from parent left edge
      const startX = isRoot ? rootLeft : parentLeft;
      const endX = nLeft + nW;
      const cp = (startX + endX) / 2;
      d = `M ${startX} ${parentCY} C ${cp} ${parentCY} ${cp} ${nCY} ${endX} ${nCY}`;
    }

    const strokeW = isRoot ? "3" : "2";
    svg.appendChild(makePath(d, color, strokeW));

    // Set branch color on tpc
    node.tpc.style.borderColor = color;

    // Recurse
    const childRight = nLeft + nW;
    const childLeft = nLeft;
    for (const child of node.children) {
      drawBranch(child, nCY, childRight, childLeft, color, false);
    }
  }

  // LHS branches
  for (const node of lhsNodes) {
    const color = (node.nodeObj as NodeObj & { branchColor?: string }).branchColor || palette[colorIdx % palette.length];
    colorIdx++;
    drawBranch(node, rootCY, rootLeft, rootLeft, color, true);
  }

  // RHS branches
  for (const node of rhsNodes) {
    const color = (node.nodeObj as NodeObj & { branchColor?: string }).branchColor || palette[colorIdx % palette.length];
    colorIdx++;
    drawBranch(node, rootCY, rootLeft + rootW, rootLeft + rootW, color, true);
  }
}

/**
 * Main entry: custom linkDiv override.
 * Called with `this` = MindElixirInstance.
 *
 * Strategy:
 *   1. Reset all custom styles so mind-elixir's native flex layout is restored.
 *   2. Measure node dimensions from the natural DOM layout.
 *   3. Compute absolute positions in a local coordinate system where root = (0, 0).
 *   4. Translate local coords into the me-nodes coordinate system by adding an offset
 *      so that the root sits at CANVAS_CENTER within the 20000×20000 canvas.
 *   5. Apply absolute positions to each me-parent and me-root.
 *   6. Draw SVG connectors using the translated coordinates.
 */
function customLinkDiv(this: MindElixirInstance & { nodeData: NodeObj }): void {
  const nodesEl = this.nodes;
  if (!(nodesEl instanceof HTMLElement)) return;

  // -----------------------------------------------------------------------
  // 0. Reset all previous custom styles
  // -----------------------------------------------------------------------
  const oldCustomSvg = nodesEl.querySelector("svg[data-xmind-custom]");
  if (oldCustomSvg) oldCustomSvg.remove();

  nodesEl.querySelectorAll("me-main").forEach((el) => {
    (el as HTMLElement).style.display = "";
  });
  nodesEl.querySelectorAll("me-wrapper").forEach((el) => {
    (el as HTMLElement).style.display = "";
  });
  nodesEl.querySelectorAll("me-children").forEach((el) => {
    (el as HTMLElement).style.display = "";
  });
  nodesEl.querySelectorAll("me-parent").forEach((el) => {
    const e = el as HTMLElement;
    e.style.position = "";
    e.style.left = "";
    e.style.top = "";
    e.style.padding = "";
    e.style.margin = "";
    e.style.direction = "";
  });
  const meRootReset = nodesEl.querySelector("me-root") as HTMLElement;
  if (meRootReset) {
    meRootReset.style.position = "";
    meRootReset.style.left = "";
    meRootReset.style.top = "";
  }
  // Reset me-nodes to its original CSS state (flex layout for measurement)
  nodesEl.style.cssText = "";

  // Also reset me-epd elements that may have been styled
  nodesEl.querySelectorAll("me-epd").forEach((el) => {
    const e = el as HTMLElement;
    e.style.position = "";
    e.style.top = "";
    e.style.left = "";
    e.style.right = "";
  });

  // Force synchronous reflow so DOM measurements are accurate
  void nodesEl.offsetHeight;

  // -----------------------------------------------------------------------
  // 1. Measure node dimensions
  // -----------------------------------------------------------------------
  const { lhs, rhs, root } = buildLayoutTree(nodesEl, this.nodeData);

  // 2. Compute subtree heights
  computeSubtreeHeights(lhs);
  computeSubtreeHeights(rhs);

  // -----------------------------------------------------------------------
  // 3. Compute positions in LOCAL coordinate system (root at 0,0)
  // -----------------------------------------------------------------------
  const rootW = root.width;
  const rootH = root.height;
  // Local root position
  const lrootX = 0;
  const lrootY = 0;
  const lrootCY = lrootY + rootH / 2;

  assignPositions(rhs, "rhs", lrootCY, lrootX + rootW + H_GAP);
  assignPositions(lhs, "lhs", lrootCY, lrootX - H_GAP);

  // -----------------------------------------------------------------------
  // 4. Compute bounding box in local coords
  // -----------------------------------------------------------------------
  let minX = lrootX, maxX = lrootX + rootW;
  let minY = lrootY, maxY = lrootY + rootH;
  function collectBounds(nodes: LayoutNode[]): void {
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.x + n.width > maxX) maxX = n.x + n.width;
      if (n.y < minY) minY = n.y;
      if (n.y + n.height > maxY) maxY = n.y + n.height;
      collectBounds(n.children);
    }
  }
  collectBounds(lhs);
  collectBounds(rhs);

  // Offset to translate local coordinates into me-nodes coordinates.
  // We shift so that the leftmost/topmost content starts at PAD pixels
  // inside me-nodes. This keeps me-nodes tightly sized around the content.
  const PAD = 60; // padding around content inside me-nodes
  const offsetX = -minX + PAD;
  const offsetY = -minY + PAD;

  // Translated root position
  const tRootX = lrootX + offsetX;
  const tRootY = lrootY + offsetY;

  // -----------------------------------------------------------------------
  // 5. Collapse layout containers & apply absolute positions
  // -----------------------------------------------------------------------
  nodesEl.querySelectorAll("me-main").forEach((el) => {
    (el as HTMLElement).style.display = "contents";
  });
  nodesEl.querySelectorAll("me-wrapper").forEach((el) => {
    (el as HTMLElement).style.display = "contents";
  });
  nodesEl.querySelectorAll("me-children").forEach((el) => {
    (el as HTMLElement).style.display = "contents";
  });

  // Position me-root at the translated root position.
  // rootW/rootH are measured from me-root (not me-tpc), so we position
  // me-root directly — no tpc offset adjustment needed.
  const meRootEl = root.meRoot;
  meRootEl.style.position = "absolute";
  meRootEl.style.left = `${Math.round(tRootX)}px`;
  meRootEl.style.top = `${Math.round(tRootY)}px`;

  // Position all branch nodes
  function applyAll(nodes: LayoutNode[]): void {
    for (const node of nodes) {
      const tx = node.x + offsetX;
      const ty = node.y + offsetY;
      const meParent = node.parent;
      meParent.style.position = "absolute";
      meParent.style.left = `${Math.round(tx)}px`;
      meParent.style.top = `${Math.round(ty)}px`;
      meParent.style.padding = "0";
      meParent.style.margin = "0";
      meParent.style.direction = "ltr";
      // expand button positioning
      const epd = meParent.querySelector("me-epd");
      if (epd instanceof HTMLElement) {
        epd.style.position = "absolute";
        epd.style.top = `${(node.height - 18) / 2}px`;
        epd.style.left = "";
        epd.style.right = "";
        if (node.direction === "lhs") {
          epd.style.left = "-10px";
        } else {
          epd.style.right = "-10px";
        }
      }
      applyAll(node.children);
    }
  }
  applyAll(lhs);
  applyAll(rhs);

  // Position me-nodes within map-canvas.
  // me-nodes size = content bounding box + padding, so scaleFit() works well.
  // me-nodes is placed so that root centre sits at CANVAS_CENTER in the
  // 20000x20000 map-canvas (for correct scrollTo in toCenter).
  const contentW = maxX - minX;
  const contentH = maxY - minY;

  // Root centre in me-nodes coords = (offsetX + lrootX + rootW/2, offsetY + lrootY + rootH/2)
  //                                 = (PAD - minX + rootW/2,      PAD - minY + rootH/2)
  // We want root centre in map-canvas coords = CANVAS_CENTER.
  // map-canvas coord = me-nodes.left + me-nodes-internal coord
  // So me-nodes.left = CANVAS_CENTER - (PAD - minX + rootW/2)
  const rootCXInNodes = offsetX + lrootX + rootW / 2;
  const rootCYInNodes = offsetY + lrootY + rootH / 2;
  const nodesLeft = CANVAS_CENTER - rootCXInNodes;
  const nodesTop = CANVAS_CENTER - rootCYInNodes;

  nodesEl.style.position = "absolute";
  nodesEl.style.left = `${Math.round(nodesLeft)}px`;
  nodesEl.style.top = `${Math.round(nodesTop)}px`;
  nodesEl.style.width = `${Math.round(contentW + PAD * 2)}px`;
  nodesEl.style.height = `${Math.round(contentH + PAD * 2)}px`;

  // -----------------------------------------------------------------------
  // 6. Re-measure root after absolute positioning (flex stretching is gone)
  // -----------------------------------------------------------------------
  void meRootEl.offsetHeight; // force reflow
  const actualRootW = meRootEl.offsetWidth;
  const actualRootH = meRootEl.offsetHeight;

  // -----------------------------------------------------------------------
  // 7. Draw SVG connectors using TRANSLATED coordinates
  // -----------------------------------------------------------------------
  const linesEl = nodesEl.querySelector("svg.lines");
  if (linesEl instanceof SVGSVGElement) linesEl.innerHTML = "";
  nodesEl.querySelectorAll("svg.subLines").forEach((s) => s.remove());

  const svg = makeSvg();
  svg.setAttribute("data-xmind-custom", "true");
  nodesEl.appendChild(svg);

  const palette: string[] = (this.theme as { palette?: string[] })?.palette ?? [
    "#4c4f69", "#7287fd", "#1e66f5", "#04a5e5", "#179299",
    "#40a02b", "#df8e1d", "#fe640b", "#e64553",
  ];
  // Use actual measured root size for connector drawing (not the flex-stretched size)
  drawConnectors(svg, lhs, rhs, lrootX, lrootY, actualRootW, actualRootH, offsetX, offsetY, palette);

  this.bus.fire("linkDiv");
}

// ---------------------------------------------------------------------------

export class XMindView extends FileView {
  private plugin: XMindPlugin;
  private mind: MindElixirInstance | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _resizeTimer: ReturnType<typeof setTimeout> | null = null;
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
      title: xmindData.title ?? this.allSheets[this.activeSheetIndex].title,
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
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment
    wrapper.style.width = "100%";
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment
    wrapper.style.height = "100%";
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
      extendedMind.linkDiv = customLinkDiv.bind(this.mind);

      this.mind.init(data);

      // Patch: Fix node editing text display issue
      // When editing a node, the original text element should be hidden
      // to avoid showing "new node" alongside the input box
      // NOTE: Disabled for now due to potential conflicts with mind-elixir internals
      // this.patchNodeEditingDisplay();

      // Patch: allow dropping nodes onto root.
      // mind-elixir's drag validation rejects root as a drop target
      // because root.nodeObj.parent is undefined. We fix this by directly
      // setting parent=true on the root node. This is simpler and more reliable
      // than using a Proxy which can cause state inconsistencies.
      if (extendedMind.nodeData) {
        const nodeData = extendedMind.nodeData as unknown as Record<string, unknown>;
        nodeData.parent = true;
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

        const makeBtn = (icon: string, title: string): HTMLButtonElement => {
          const btn = document.createElement("button");
          btn.className = "xmind-toolbar-btn";
          btn.title = title;
          const iconWrapper = document.createElement("div");
          iconWrapper.innerHTML = icon;
          btn.appendChild(iconWrapper);
          return btn;
        };

        // ===================== LEFT TOOLBAR =====================
        const leftBar = document.createElement("div");
        leftBar.className = "xmind-toolbar-left";

        // 1) Drag/pan toggle
        const dragBtn = makeBtn(ICON_HAND, "拖动画布");
        leftBar.appendChild(dragBtn);

        // 2) Center / focus root
        const centerBtn = makeBtn(ICON_CENTER, "聚焦根节点");
        centerBtn.addEventListener("click", () => {
          mind.toCenter();
        });
        leftBar.appendChild(centerBtn);

        // 3) Help — keyboard shortcuts
        const helpBtn = makeBtn(ICON_HELP, "快捷键帮助");
        helpBtn.addEventListener("click", () => {
          const helpEl = container.querySelector(".xmind-help-panel");
          if (helpEl instanceof HTMLElement) {
            helpEl.style.display = helpEl.style.display === "none" ? "block" : "none";
          }
        });
        leftBar.appendChild(helpBtn);

        container.appendChild(leftBar);

        // Help panel
        const helpPanel = document.createElement("div");
        helpPanel.className = "xmind-help-panel";
        helpPanel.style.display = "none";
        
        const helpTitle = document.createElement("div");
        helpTitle.className = "xmind-help-title";
        helpTitle.textContent = "Keyboard Shortcuts";
        helpPanel.appendChild(helpTitle);
        
        const helpTable = document.createElement("table");
        helpTable.className = "xmind-help-table";
        const shortcuts = [
          ["Tab", "Add child node"],
          ["Enter", "Add sibling node"],
          ["Ctrl+C", "Copy"],
          ["Ctrl+V", "Paste"],
          ["Ctrl+Z", "Undo"],
          ["Ctrl+S", "Save"],
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
        document.addEventListener("mousedown", (e: MouseEvent) => {
          if (helpPanel.style.display === "none") return;
          const target = e.target as HTMLElement;
          if (!helpPanel.contains(target) && target !== helpBtn && !helpBtn.contains(target)) {
            // eslint-disable-next-line obsidianmd/no-static-styles-assignment
            helpPanel.style.display = "none";
          }
        });

        // ===================== RIGHT-BOTTOM TOOLBAR =====================
        const ICON_FULLSCREEN = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;

        const rbBar = document.createElement("div");
        rbBar.className = "xmind-toolbar-rb";

        // Zoom out
        const zoomOutBtn = makeBtn(ICON_ZOOMOUT, "缩小");
        zoomOutBtn.addEventListener("click", () => {
          if (mind.scaleVal > 0.6) mind.scale(mind.scaleVal - mind.scaleSensitivity);
        });
        rbBar.appendChild(zoomOutBtn);

        // Zoom in
        const zoomInBtn = makeBtn(ICON_ZOOMIN, "放大");
        zoomInBtn.addEventListener("click", () => {
          if (mind.scaleVal < 1.6) mind.scale(mind.scaleVal + mind.scaleSensitivity);
        });
        rbBar.appendChild(zoomInBtn);

        // Reset (scaleFit + toCenter)
        const resetBtn = makeBtn(ICON_RESET, "重置画布大小");
        resetBtn.addEventListener("click", () => {
          mind.scaleFit();
          mind.toCenter();
        });
        rbBar.appendChild(resetBtn);

        // Fullscreen
        const fullscreenBtn = makeBtn(ICON_FULLSCREEN, "全屏");
        fullscreenBtn.addEventListener("click", () => {
          if (document.fullscreenElement === mind.el) {
            void document.exitFullscreen();
          } else {
            void mind.el.requestFullscreen();
          }
        });
        rbBar.appendChild(fullscreenBtn);

        container.appendChild(rbBar);

        // ===================== SHEET SELECTOR (right-top) =====================
        if (this.allSheets.length > 1) {
          const sheetSelector = document.createElement("div");
          sheetSelector.className = "xmind-sheet-selector";

          const select = document.createElement("select");
          select.className = "xmind-sheet-select";
          this.allSheets.forEach((sheet, i) => {
            const option = document.createElement("option");
            option.value = String(i);
            option.textContent = sheet.title || `画布 ${i + 1}`;
            if (i === this.activeSheetIndex) option.selected = true;
            select.appendChild(option);
          });
          select.addEventListener("change", () => {
            this.switchSheet(Number(select.value));
          });
          sheetSelector.appendChild(select);
          container.appendChild(sheetSelector);
        }

        // ===================== DRAG/PAN LOGIC =====================
        let panEnabled = false;
        let isPanning = false;
        let startX = 0;
        let startY = 0;
        let scrollX = 0;
        let scrollY = 0;

        dragBtn.addEventListener("click", () => {
          panEnabled = !panEnabled;
          dragBtn.innerHTML = "";
          const iconWrapper = document.createElement("div");
          iconWrapper.innerHTML = panEnabled ? ICON_POINTER : ICON_HAND;
          dragBtn.appendChild(iconWrapper);
          dragBtn.title = panEnabled ? "切换为指针模式" : "切换为拖动画布";
          mapEl.style.cursor = panEnabled ? "grab" : "";
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
           mapEl.style.cursor = "grabbing";
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
            mapEl.style.cursor = panEnabled ? "grab" : "";
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
    this.mind.bus.addListener("operation", (_info) => {
      // CRITICAL: Ensure root node still has parent=true for drag-to-root support
      // mind-elixir's drag validation may reset or check this during operations
      if (this.mind?.nodeData) {
        const nodeData = this.mind.nodeData as unknown as Record<string, unknown>;
        nodeData.parent = true;
      }
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
                   textSpan.style.visibility = "hidden";
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
                 textSpan.style.visibility = "visible";
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
      new Notice(
        `XMinder: Failed to save "${this.file?.name}": ${
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
  // Helpers
  // -------------------------------------------------------------------------

  private showError(msg: string): void {
    this.contentEl.empty();
    const el = document.createElement("div");
    el.className = "xmind-error";
    el.textContent = `XMinder Error: ${msg}`;
    this.contentEl.appendChild(el);
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
