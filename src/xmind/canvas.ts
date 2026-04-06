import type { XMindNode, XMindData } from "./types";

/**
 * Obsidian Canvas JSON format types
 */
export interface CanvasNode {
  id: string;
  type: "text" | "file" | "link" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  url?: string;
  label?: string;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: "top" | "right" | "bottom" | "left";
  toNode: string;
  toSide?: "top" | "right" | "bottom" | "left";
  fromEnd?: "none" | "arrow";
  toEnd?: "none" | "arrow";
  label?: string;
  color?: string;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * Configuration for the layout
 */
const CONFIG = {
  H_GAP: 120,
  V_GAP: 40,
  NODE_WIDTH_UNIT: 8, // Width per character (estimated)
  MIN_WIDTH: 80,
  MAX_WIDTH: 400,
  ROW_HEIGHT: 24,
  PADDING_X: 16,
  PADDING_Y: 12,
};

/**
 * Internal interface for layout calculation
 */
interface LayoutNode {
  id: string;
  xnode: XMindNode;
  width: number;
  height: number;
  subtreeHeight: number;
  children: LayoutNode[];
}

/**
 * Convert XMindData to Obsidian Canvas format
 */
export function convertToCanvas(data: XMindData): CanvasData {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  function getSafeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9]/g, "_");
  }

  /**
   * Pass 1: Build layout tree and calculate node sizes + subtree heights
   */
  function buildLayoutTree(xnode: XMindNode): LayoutNode {
    const topic = xnode.title || " ";
    const lines = topic.split("\n");
    const maxLineLen = Math.max(...lines.map(l => l.length));
    
    const width = Math.min(
      CONFIG.MAX_WIDTH,
      Math.max(CONFIG.MIN_WIDTH, maxLineLen * CONFIG.NODE_WIDTH_UNIT + CONFIG.PADDING_X * 2)
    );
    const height = lines.length * CONFIG.ROW_HEIGHT + CONFIG.PADDING_Y * 2;

    const children = (xnode.children || []).map(buildLayoutTree);
    
    let subtreeHeight = height;
    if (children.length > 0) {
      const childrenTotalHeight = children.reduce((sum, child) => sum + child.subtreeHeight, 0) 
        + (children.length - 1) * CONFIG.V_GAP;
      subtreeHeight = Math.max(height, childrenTotalHeight);
    }

    return {
      id: getSafeId(xnode.id),
      xnode,
      width,
      height,
      subtreeHeight,
      children,
    };
  }

  /**
   * Pass 2: Assign positions and build Canvas nodes/edges
   */
  function assignPositions(
    node: LayoutNode,
    x: number,
    centerY: number
  ): void {
    const nodeX = x;
    const nodeY = centerY - node.height / 2;

    const canvasNode: CanvasNode = {
      id: node.id,
      type: "text",
      x: nodeX,
      y: nodeY,
      width: node.width,
      height: node.height,
      text: node.xnode.title,
    };

    if (node.xnode.style?.background) {
      canvasNode.color = node.xnode.style.background;
    }

    nodes.push(canvasNode);

    if (node.children.length > 0) {
      const childX = x + node.width + CONFIG.H_GAP;
      let currentY = centerY - node.subtreeHeight / 2;

      for (const child of node.children) {
        const childCenterY = currentY + child.subtreeHeight / 2;
        assignPositions(child, childX, childCenterY);
        
        edges.push({
          id: `e_${node.id}_${child.id}`,
          fromNode: node.id,
          fromSide: "right",
          toNode: child.id,
          toSide: "left",
          toEnd: "arrow",
        });

        currentY += child.subtreeHeight + CONFIG.V_GAP;
      }
    }
  }

  // 1. Build layout tree
  const rootLayoutNode = buildLayoutTree(data.rootTopic);
  
  // 2. Assign positions (starting root at 0, 0)
  assignPositions(rootLayoutNode, 0, 0);

  return { nodes, edges };
}
