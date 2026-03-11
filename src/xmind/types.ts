/**
 * Internal representation of an XMind node.
 * Acts as the intermediate layer between XMind format and mind-elixir format.
 */
export interface XMindNode {
  id: string;
  title: string;
  children?: XMindNode[];
  notes?: string;
  labels?: string[];
  /** XMind marker icon IDs */
  markers?: string[];
  /** External hyperlink */
  href?: string;
  /** Whether this branch is folded */
  branch?: "folded";
  /** Background color (hex) */
  style?: {
    background?: string;
    color?: string;
    fontSize?: number;
    fontWeight?: "bold" | "normal";
    fontStyle?: "italic" | "normal";
    border?: string;
  };
}

/**
 * Top-level XMind document data.
 */
export interface XMindData {
  /** Main root topic */
  rootTopic: XMindNode;
  /** Sheet title */
  title?: string;
  /** Theme name from original file */
  theme?: string;
}

/**
 * Raw content.json structure from XMind 8+
 */
export interface XMindContentJsonSheet {
  id: string;
  title?: string;
  rootTopic: XMindContentJsonTopic;
  theme?: Record<string, unknown>;
}

export interface XMindContentJsonTopic {
  id: string;
  title?: string;
  children?: {
    attached?: XMindContentJsonTopic[];
    [key: string]: XMindContentJsonTopic[] | undefined;
  };
  notes?: {
    plain?: { content?: string };
    realHTML?: { content?: string };
  };
  labels?: string[];
  markers?: Array<{ markerId: string }>;
  href?: string;
  branch?: string;
  style?: {
    properties?: Record<string, string>;
  };
}

/**
 * mind-elixir node data structure (subset used by this plugin).
 */
export interface MindElixirNodeData {
  id: string;
  topic: string;
  style?: {
    background?: string;
    color?: string;
    fontSize?: string;
    fontWeight?: string;
    fontStyle?: string;
    border?: string;
  };
  hyperLink?: string;
  expanded?: boolean;
  tags?: string[];
  icons?: string[];
}

export interface MindElixirData {
  nodeData: MindElixirNodeObj;
  linkData?: Record<string, unknown>;
}

export interface MindElixirNodeObj extends MindElixirNodeData {
  children?: MindElixirNodeObj[];
}
