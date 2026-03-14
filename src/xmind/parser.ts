import JSZip from "jszip";
import type {
  XMindData,
  XMindMultiSheetData,
  XMindNode,
  XMindContentJsonSheet,
  XMindContentJsonTopic,
} from "./types";
import { i18n } from "../i18n";

/**
 * Parse a .xmind file (ArrayBuffer) into internal format with all sheets.
 *
 * .xmind files are ZIP archives containing:
 *   - content.json  (XMind 8+, preferred)
 *   - content.xml   (legacy XMind format)
 *   - metadata.json
 *   - resources/   (images etc.)
 */
export async function parseXMind(buffer: ArrayBuffer): Promise<XMindMultiSheetData> {
  const zip = await JSZip.loadAsync(buffer);

  // Try content.json first (XMind 8+ / ZEN format)
  const contentJsonFile = zip.file("content.json");
  if (contentJsonFile) {
    const raw = await contentJsonFile.async("string");
    return parseContentJson(raw);
  }

  // Fall back to content.xml (legacy format)
  const contentXmlFile = zip.file("content.xml");
  if (contentXmlFile) {
    const raw = await contentXmlFile.async("string");
    return parseContentXml(raw);
  }

  throw new Error(
    "Invalid .xmind file: neither content.json nor content.xml found."
  );
}

// ---------------------------------------------------------------------------
// content.json parser (XMind 8+ / ZEN format)
// ---------------------------------------------------------------------------

function parseContentJson(raw: string): XMindMultiSheetData {
  let rawSheets: XMindContentJsonSheet[];

  try {
    const parsed = JSON.parse(raw) as unknown;
    rawSheets = Array.isArray(parsed) ? (parsed as XMindContentJsonSheet[]) : [(parsed as XMindContentJsonSheet)];
  } catch {
    throw new Error(i18n.t().parser.parseContentJsonFailed);
  }

  if (rawSheets.length === 0) {
    throw new Error(i18n.t().parser.noSheetInContentJson);
  }

  const t = i18n.t();
  const sheets: XMindData[] = rawSheets.map((sheet) => ({
    rootTopic: mapJsonTopic(sheet.rootTopic),
    title: sheet.title ?? sheet.rootTopic?.title ?? t.defaults.mindMap,
    theme: extractThemeName(sheet.theme),
  }));

  return { sheets };
}

function mapJsonTopic(topic: XMindContentJsonTopic): XMindNode {
  if (!topic) {
    return { id: generateId(), title: "Untitled" };
  }

  const node: XMindNode = {
    id: topic.id ?? generateId(),
    title: topic.title ?? "",
  };

  // Children — XMind stores them under children.attached
  const attached = topic.children?.attached;
  if (attached && attached.length > 0) {
    node.children = attached.map(mapJsonTopic);
  }

  // Notes
  const notesContent =
    topic.notes?.plain?.content ?? topic.notes?.realHTML?.content;
  if (notesContent) {
    node.notes = notesContent;
  }

  // Labels
  if (topic.labels && topic.labels.length > 0) {
    node.labels = topic.labels;
  }

  // Markers
  if (topic.markers && topic.markers.length > 0) {
    node.markers = topic.markers.map((m) => m.markerId);
  }

  // Hyperlink
  if (topic.href) {
    node.href = topic.href;
  }

  // Branch state
  if (topic.branch === "folded") {
    node.branch = "folded";
  }

  // Style properties
  const props = topic.style?.properties;
  if (props) {
    node.style = {};
    if (props["background-color"]) node.style.background = props["background-color"];
    if (props["color"]) node.style.color = props["color"];
    if (props["font-size"]) node.style.fontSize = parseInt(props["font-size"], 10) || undefined;
    if (props["font-weight"] === "bold") node.style.fontWeight = "bold";
    if (props["font-style"] === "italic") node.style.fontStyle = "italic";
    if (props["border-color"]) node.style.border = props["border-color"];
  }

  return node;
}

function extractThemeName(theme?: Record<string, unknown>): string | undefined {
  if (!theme) return undefined;
  if (typeof theme["name"] === "string") return theme["name"];
  if (typeof theme["id"] === "string") return theme["id"];
  return undefined;
}

// ---------------------------------------------------------------------------
// content.xml parser (legacy XMind format)
// ---------------------------------------------------------------------------

function parseContentXml(raw: string): XMindMultiSheetData {
  let doc: Document;

  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(raw, "text/xml");
  } catch {
    throw new Error(i18n.t().parser.parseContentXmlFailed);
  }

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(i18n.t().parser.contentXmlInvalid.replace("{error}", parseError.textContent ?? ""));
  }

  // Find all sheet elements
  const sheetEls = doc.querySelectorAll("xmap-content > sheet, sheet");
  const sheets: XMindData[] = [];

  if (sheetEls.length > 0) {
    sheetEls.forEach((sheetEl) => {
      const sheetTitle =
        sheetEl.getAttribute("title") ??
        sheetEl.querySelector(":scope > title")?.textContent ??
        undefined;
      const rootTopicEl =
        sheetEl.querySelector(":scope > topic") ??
        sheetEl.querySelector("topic");
      if (rootTopicEl) {
        sheets.push({
          rootTopic: mapXmlTopic(rootTopicEl),
          title: sheetTitle,
        });
      }
    });
  }

  if (sheets.length === 0) {
    // Fallback: treat entire document as one sheet
    const rootTopicEl = doc.querySelector("topic");
    if (!rootTopicEl) {
      throw new Error("content.xml: no root topic found.");
    }
    sheets.push({
      rootTopic: mapXmlTopic(rootTopicEl),
    });
  }

  return { sheets };
}

function mapXmlTopic(el: Element): XMindNode {
  const node: XMindNode = {
    id: el.getAttribute("id") ?? generateId(),
    title:
      el.querySelector(":scope > title")?.textContent?.trim() ??
      el.getAttribute("title") ??
      "",
  };

  // Children
  const childrenEl = el.querySelector(":scope > children > topics[type='attached']");
  if (childrenEl) {
    const childTopics = Array.from(childrenEl.querySelectorAll(":scope > topic"));
    if (childTopics.length > 0) {
      node.children = childTopics.map(mapXmlTopic);
    }
  } else {
    // Some older formats put topics directly in children
    const directChildrenEl = el.querySelector(":scope > children");
    if (directChildrenEl) {
      const childTopics = Array.from(directChildrenEl.querySelectorAll(":scope > topic"));
      if (childTopics.length > 0) {
        node.children = childTopics.map(mapXmlTopic);
      }
    }
  }

  // Notes
  const notesEl = el.querySelector(":scope > notes > plain");
  if (notesEl?.textContent) {
    node.notes = notesEl.textContent.trim();
  }

  // Labels
  const labelEls = el.querySelectorAll(":scope > labels > label");
  if (labelEls.length > 0) {
    node.labels = Array.from(labelEls).map(
      (l) => l.textContent?.trim() ?? ""
    );
  }

  // Markers
  const markerEls = el.querySelectorAll(":scope > marker-refs > marker-ref");
  if (markerEls.length > 0) {
    node.markers = Array.from(markerEls).map(
      (m) => m.getAttribute("marker-id") ?? ""
    );
  }

  // Hyperlink
  const href = el.getAttribute("xlink:href");
  if (href) {
    node.href = href;
  }

  // Branch state
  if (el.getAttribute("branch") === "folded") {
    node.branch = "folded";
  }

  return node;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}
