import type { MindElixirInstance, NodeObj } from "mind-elixir";

// Horizontal gap between adjacent levels (px)
export const H_GAP = 100;
// Minimum vertical gap between sibling node boxes (px)
export const V_GAP = 24;
// Horizontal padding inside the canvas before the root node
export const CANVAS_CENTER = 10000;
// Padding around content inside the nodes container
export const PAD = 60;

export interface LayoutNode {
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

// Minimal local types to satisfy ESLint
export interface LocalNodeObj {
  id: string;
  topic: string;
  children?: LocalNodeObj[];
  parent?: LocalNodeObj;
  [key: string]: unknown;
}

export interface LocalMindElixirData {
  nodeData: LocalNodeObj;
}

export function buildLayoutTree(
  nodesEl: HTMLElement,
  nodeData: NodeObj,
  lastRootWidth?: { value: number }
): { lhs: LayoutNode[]; rhs: LayoutNode[]; root: { tpc: HTMLElement; meRoot: HTMLElement; width: number; height: number } } {
  const meRootEl = nodesEl.querySelector("me-root") as HTMLElement;
  const rootTpc = meRootEl.querySelector("me-tpc") as HTMLElement;
  
  const savedPos = meRootEl.style.position;
  const savedWidth = meRootEl.style.width;
  meRootEl.setCssStyles({ position: "absolute", width: "max-content" });
  void meRootEl.offsetHeight;
  const rootW = meRootEl.offsetWidth;
  const rootH = meRootEl.offsetHeight;
  meRootEl.setCssStyles({ position: savedPos || "", width: savedWidth || "" });

  if (lastRootWidth && lastRootWidth.value !== rootW) {
    lastRootWidth.value = rootW;
  } else if (lastRootWidth) {
    lastRootWidth.value = rootW;
  }

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
      
      const id = tpc.dataset.nodeid?.replace(/^me/, "") ?? "";
      const obj = findNodeById(parentObj, id) ?? (tpc as { nodeObj?: NodeObj }).nodeObj as NodeObj;

      const w = tpc.offsetWidth;
      const h = tpc.offsetHeight;

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

function findNodeById(root: NodeObj, id: string): NodeObj | null {
  if (root.id === id) return root;
  const children = root.children;
  if (children) {
    for (const child of children) {
      const found = findNodeById(child, id);
      if (found) return found;
    }
  }
  return null;
}

export function computeSubtreeHeights(nodes: LayoutNode[]): void {
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
  node.subtreeH = Math.max(node.height, totalChildH);
}

export function assignPositions(
  nodes: LayoutNode[],
  dir: "lhs" | "rhs",
  parentCentreY: number,
  anchorX: number
): void {
  if (nodes.length === 0) return;

  const totalH = nodes.reduce((s, n) => s + n.subtreeH, 0)
    + (nodes.length - 1) * V_GAP;
  let curY = parentCentreY - totalH / 2;

  for (const node of nodes) {
    const slotTop = curY;
    const slotH = node.subtreeH;
    node.y = slotTop + (slotH - node.height) / 2;

    if (dir === "rhs") {
      node.x = anchorX;
    } else {
      node.x = anchorX - node.width;
    }

    if (node.children.length > 0) {
      const childCentreY = node.y + node.height / 2;
      let childAnchorX: number;
      if (dir === "rhs") {
        childAnchorX = node.x + node.width + H_GAP;
      } else {
        childAnchorX = node.x - H_GAP;
      }
      assignPositions(node.children, dir, childCentreY, childAnchorX);
    }
    curY += slotH + V_GAP;
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function makeSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("overflow", "visible");
  svg.setCssStyles({
    position: "absolute",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "-1",
  });
  return svg;
}

export function makePath(d: string, color: string, width: string): SVGPathElement {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("stroke", color);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-width", width);
  path.setAttribute("stroke-linecap", "round");
  return path;
}

export function drawConnectors(
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
  const rootLeft = localRootX + offsetX;
  const rootTop = localRootY + offsetY;
  const rootCY = rootTop + rootH / 2;

  let colorIdx = 0;

  function drawBranch(node: LayoutNode, parentCY: number, parentRight: number, parentLeft: number, color: string, isRoot: boolean): void {
    const nLeft = node.x + offsetX;
    const nTop = node.y + offsetY;
    const nW = node.width;
    const nH = node.height;
    const nCY = nTop + nH / 2;

    let d: string;
    if (node.direction === "rhs") {
      const startX = isRoot ? rootLeft + rootW : parentRight;
      const endX = nLeft;
      const cp = (startX + endX) / 2;
      d = `M ${startX} ${parentCY} C ${cp} ${parentCY} ${cp} ${nCY} ${endX} ${nCY}`;
    } else {
      const startX = isRoot ? rootLeft : parentLeft;
      const endX = nLeft + nW;
      const cp = (startX + endX) / 2;
      d = `M ${startX} ${parentCY} C ${cp} ${parentCY} ${cp} ${nCY} ${endX} ${nCY}`;
    }

    const strokeW = isRoot ? "3" : "2";
    svg.appendChild(makePath(d, color, strokeW));
    node.tpc.setCssStyles({ borderColor: color });

    const childRight = nLeft + nW;
    const childLeft = nLeft;
    for (const child of node.children) {
      drawBranch(child, nCY, childRight, childLeft, color, false);
    }
  }

  for (const node of lhsNodes) {
    const color = (node.nodeObj as NodeObj & { branchColor?: string }).branchColor || palette[colorIdx % palette.length];
    colorIdx++;
    drawBranch(node, rootCY, rootLeft, rootLeft, color, true);
  }

  for (const node of rhsNodes) {
    const color = (node.nodeObj as NodeObj & { branchColor?: string }).branchColor || palette[colorIdx % palette.length];
    colorIdx++;
    drawBranch(node, rootCY, rootLeft + rootW, rootLeft + rootW, color, true);
  }
}

export function customLinkDiv(this: MindElixirInstance & { nodeData: NodeObj; _rootWidthCache?: number }): void {
  const nodesEl = this.nodes;
  if (!(nodesEl instanceof HTMLElement)) return;

  const oldCustomSvg = nodesEl.querySelector("svg[data-xmind-custom]");
  if (oldCustomSvg) oldCustomSvg.remove();

  nodesEl.querySelectorAll("me-main").forEach((el) => {
    (el as HTMLElement).setCssStyles({ display: "" });
  });
  nodesEl.querySelectorAll("me-wrapper").forEach((el) => {
    (el as HTMLElement).setCssStyles({ display: "" });
  });
  nodesEl.querySelectorAll("me-children").forEach((el) => {
    (el as HTMLElement).setCssStyles({ display: "" });
  });
  nodesEl.querySelectorAll("me-parent").forEach((el) => {
    const e = el as HTMLElement;
    e.setCssStyles({
      position: "", left: "", top: "", padding: "", margin: "", direction: "",
    });
  });
  const meRootReset = nodesEl.querySelector("me-root") as HTMLElement;
  if (meRootReset) {
    meRootReset.setCssStyles({ position: "", left: "", top: "" });
  }
  nodesEl.removeAttribute("style");

  nodesEl.querySelectorAll("me-epd").forEach((el) => {
    (el as HTMLElement).setCssStyles({ position: "", top: "", left: "", right: "" });
  });

  void nodesEl.offsetHeight;

  const rootTpc = nodesEl.querySelector("me-root > me-tpc") as HTMLElement;
  if (rootTpc) {
    void rootTpc.offsetHeight;
  }

  // Use instance-bound cache instead of global
  const { lhs, rhs, root } = buildLayoutTree(nodesEl, this.nodeData, { value: this._rootWidthCache ?? 0 });

  computeSubtreeHeights(lhs);
  computeSubtreeHeights(rhs);

  const rootW = root.width;
  const rootH = root.height;
  this._rootWidthCache = rootW;
  
  const lrootX = 0;
  const lrootY = 0;
  const lrootCY = lrootY + rootH / 2;

  assignPositions(rhs, "rhs", lrootCY, lrootX + rootW + H_GAP);
  assignPositions(lhs, "lhs", lrootCY, lrootX - H_GAP);

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

  const offsetX = -minX + PAD;
  const offsetY = -minY + PAD;

  const tRootX = lrootX + offsetX;
  const tRootY = lrootY + offsetY;

  nodesEl.querySelectorAll("me-main").forEach((el) => {
    (el as HTMLElement).setCssStyles({ display: "contents" });
  });
  nodesEl.querySelectorAll("me-wrapper").forEach((el) => {
    (el as HTMLElement).setCssStyles({ display: "contents" });
  });
  nodesEl.querySelectorAll("me-children").forEach((el) => {
    (el as HTMLElement).setCssStyles({ display: "contents" });
  });

  const meRootEl = root.meRoot;
  meRootEl.setCssStyles({
    position: "absolute",
    left: `${Math.round(tRootX)}px`,
    top: `${Math.round(tRootY)}px`,
  });

  function applyAll(nodes: LayoutNode[]): void {
    for (const node of nodes) {
      const tx = node.x + offsetX;
      const ty = node.y + offsetY;
      const meParent = node.parent;
      meParent.setCssStyles({
        position: "absolute",
        left: `${Math.round(tx)}px`,
        top: `${Math.round(ty)}px`,
        padding: "0", margin: "0", direction: "ltr",
      });
      const epd = meParent.querySelector("me-epd");
      if (epd instanceof HTMLElement) {
        epd.setCssStyles({
          position: "absolute",
          top: `${(node.height - 18) / 2}px`,
          left: "", right: "",
        });
        if (node.direction === "lhs") {
          epd.setCssStyles({ left: "-10px", right: "" });
        } else {
          epd.setCssStyles({ left: "", right: "-10px" });
        }
      }
      applyAll(node.children);
    }
  }
  applyAll(lhs);
  applyAll(rhs);

  const contentW = maxX - minX;
  const contentH = maxY - minY;

  const rootCXInNodes = offsetX + lrootX + rootW / 2;
  const rootCYInNodes = offsetY + lrootY + rootH / 2;
  const nodesLeft = CANVAS_CENTER - rootCXInNodes;
  const nodesTop = CANVAS_CENTER - rootCYInNodes;

  nodesEl.setCssStyles({
    position: "absolute",
    left: `${Math.round(nodesLeft)}px`,
    top: `${Math.round(nodesTop)}px`,
    width: `${Math.round(contentW + PAD * 2)}px`,
    height: `${Math.round(contentH + PAD * 2)}px`,
  });

  void meRootEl.offsetHeight;
  const actualRootW = meRootEl.offsetWidth;
  const actualRootH = meRootEl.offsetHeight;

  const linesEl = nodesEl.querySelector("svg.lines");
  if (linesEl instanceof SVGSVGElement) linesEl.replaceChildren();
  nodesEl.querySelectorAll("svg.subLines").forEach((s) => s.remove());

  const svg = makeSvg();
  svg.setAttribute("data-xmind-custom", "true");
  nodesEl.appendChild(svg);

  const palette: string[] = (this.theme as { palette?: string[] })?.palette ?? [
    "#4c4f69", "#7287fd", "#1e66f5", "#04a5e5", "#179299",
    "#40a02b", "#df8e1d", "#fe640b", "#e64553",
  ];
  drawConnectors(svg, lhs, rhs, lrootX, lrootY, actualRootW, actualRootH, offsetX, offsetY, palette);

  this.bus.fire("linkDiv");
}
