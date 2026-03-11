import JSZip from "jszip";
import type { XMindData, XMindNode, XMindContentJsonTopic } from "./types";

/**
 * Serialize XMindData back to a .xmind file (ArrayBuffer).
 *
 * Always writes content.json (XMind 8+ format).
 */
export async function serializeXMind(data: XMindData): Promise<ArrayBuffer> {
  const zip = new JSZip();

  const contentJson = buildContentJson(data);
  zip.file("content.json", JSON.stringify(contentJson, null, 2));

  // Write minimal metadata.json
  const metadata = {
    creator: {
      name: "obsidian-xminder",
      version: "1.0.0",
    },
  };
  zip.file("metadata.json", JSON.stringify(metadata));

  const buffer = await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return buffer;
}

// ---------------------------------------------------------------------------
// Build content.json array (one sheet)
// ---------------------------------------------------------------------------

function buildContentJson(data: XMindData): object[] {
  return [
    {
      id: generateId(),
      class: "sheet",
      title: data.title ?? "Sheet 1",
      rootTopic: mapNodeToJsonTopic(data.rootTopic),
    },
  ];
}

function mapNodeToJsonTopic(node: XMindNode): XMindContentJsonTopic {
  const topic: XMindContentJsonTopic = {
    id: node.id,
    title: node.title,
  };

  // Children
  if (node.children && node.children.length > 0) {
    topic.children = {
      attached: node.children.map(mapNodeToJsonTopic),
    };
  }

  // Notes
  if (node.notes) {
    topic.notes = {
      plain: { content: node.notes },
    };
  }

  // Labels
  if (node.labels && node.labels.length > 0) {
    topic.labels = node.labels;
  }

  // Markers
  if (node.markers && node.markers.length > 0) {
    topic.markers = node.markers.map((id) => ({ markerId: id }));
  }

  // Hyperlink
  if (node.href) {
    topic.href = node.href;
  }

  // Branch state
  if (node.branch === "folded") {
    topic.branch = "folded";
  }

  // Style
  if (node.style) {
    const props: Record<string, string> = {};
    if (node.style.background) props["background-color"] = node.style.background;
    if (node.style.color) props["color"] = node.style.color;
    if (node.style.fontSize) props["font-size"] = `${node.style.fontSize}pt`;
    if (node.style.fontWeight) props["font-weight"] = node.style.fontWeight;
    if (node.style.fontStyle) props["font-style"] = node.style.fontStyle;
    if (node.style.border) props["border-color"] = node.style.border;

    if (Object.keys(props).length > 0) {
      topic.style = { properties: props };
    }
  }

  return topic;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}
