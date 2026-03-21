import type { App } from "obsidian";

export type Locale = "zh" | "en";

interface I18nStrings {
  commands: {
    createNewXMind: string;
    exportAsMarkdown: string;
    fitToView: string;
    saveFile: string;
  };
  menus: {
    openWithXMind: string;
    exportAsMarkdown: string;
    createNewXMind: string;
  };
  defaults: {
    newMindMap: string;
    centralTopic: string;
    mainTopic1: string;
    mainTopic2: string;
    mainTopic3: string;
    mainTopic4: string;
    canvas: string;
    mindMap: string;
  };
  notices: {
    created: string;
    createFailed: string;
    exportFailed: string;
    copiedToClipboard: string;
    copyFailed: string;
    saved: string;
    saveFailed: string;
    loadFailed: string;
    error: string;
  };
  settings: {
    title: string;
    autoSaveDelay: string;
    autoSaveDelayDesc: string;
    resetDefault: string;
    resetDefaultMs: string;
    embedHeight: string;
    embedHeightDesc: string;
    resetDefaultPx: string;
    showOpenWithXMind: string;
    showOpenWithXMindDesc: string;
    usage: string;
    usageDesc: string;
    embedInteractivePreview: string;
    linkToOpenXMind: string;
    doubleClickTip: string;
  };
  view: {
    dragCanvas: string;
    focusRoot: string;
    shortcutsHelp: string;
    shortcuts: string;
    addChildNode: string;
    addSiblingNode: string;
    copy: string;
    paste: string;
    undo: string;
    save: string;
    zoomOut: string;
    zoomIn: string;
    resetCanvas: string;
    fullscreen: string;
    switchToPointer: string;
    switchToDrag: string;
  };
  embed: {
    loadingXMind: string;
    clickToOpen: string;
    loadFailed: string;
  };
  parser: {
    parseContentJsonFailed: string;
    noSheetInContentJson: string;
    parseContentXmlFailed: string;
    contentXmlInvalid: string;
  };
}

const zhStrings: I18nStrings = {
  commands: {
    createNewXMind: "新建 XMind 文件",
    exportAsMarkdown: "导出 XMind 为 Mermaid 脑图",
    fitToView: "适配 XMind 视图",
    saveFile: "保存 XMind 文件",
  },
  menus: {
    openWithXMind: "用 XMind 打开",
    exportAsMarkdown: "导出为 Mermaid 脑图",
    createNewXMind: "新建 XMind 脑图",
  },
  defaults: {
    newMindMap: "新建思维导图",
    centralTopic: "中心主题",
    mainTopic1: "主主题 1",
    mainTopic2: "主主题 2",
    mainTopic3: "主主题 3",
    mainTopic4: "主主题 4",
    canvas: "画布",
    mindMap: "思维导图",
  },
  notices: {
    created: "XMinder：已创建 {name}.xmind",
    createFailed: "XMinder：创建文件失败：{error}",
    exportFailed: 'XMinder：导出"{name}"失败：{error}',
    copiedToClipboard: "XMinder：Mermaid 脑图已复制到剪贴板。",
    copyFailed: "XMinder：复制到剪贴板失败：{error}",
    saved: "XMinder：已保存。",
    saveFailed: "XMinder：保存失败：{error}",
    loadFailed: "XMinder：加载失败：{error}",
    error: "XMinder 错误：{error}",
  },
  settings: {
    title: "XMinder 设置",
    autoSaveDelay: "自动保存延迟",
    autoSaveDelayDesc: "在最后一次编辑后等待的时间（毫秒），到期后自动保存 .xmind 文件。设为 0 可关闭自动保存。",
    resetDefault: "恢复默认值",
    resetDefaultMs: "恢复默认值（{ms} 毫秒）",
    embedHeight: "嵌入预览高度",
    embedHeightDesc: "在笔记中使用 ![[file.xmind]] 时，内嵌思维导图预览的高度（像素）。",
    resetDefaultPx: "恢复默认值（{px} 像素）",
    showOpenWithXMind: '显示"用 XMind 打开"菜单',
    showOpenWithXMindDesc: '在文件右键菜单中显示"用 XMind 打开"，用外部 XMind 应用打开 .xmind 文件。已安装 XMind 应用时建议开启。',
    usage: "用法",
    usageDesc: "Markdown 笔记中支持的语法：",
    embedInteractivePreview: "— 嵌入交互式预览",
    linkToOpenXMind: "— 打开 XMind 视图的链接",
    doubleClickTip: "在文件管理器中双击 .xmind 文件即可打开交互式思维导图编辑器。",
  },
  view: {
    dragCanvas: "拖动画布",
    focusRoot: "聚焦根节点",
    shortcutsHelp: "快捷键帮助",
    shortcuts: "快捷键",
    addChildNode: "添加子节点",
    addSiblingNode: "添加同级节点",
    copy: "复制",
    paste: "粘贴",
    undo: "撤销",
    save: "保存",
    zoomOut: "缩小",
    zoomIn: "放大",
    resetCanvas: "重置画布大小",
    fullscreen: "全屏",
    switchToPointer: "切换为指针模式",
    switchToDrag: "切换为拖动画布",
  },
  embed: {
    loadingXMind: "正在加载 XMind...",
    clickToOpen: "点击打开 {name}",
    loadFailed: '加载"{name}"失败：{error}',
  },
  parser: {
    parseContentJsonFailed: "解析 content.json 失败：JSON 无效。",
    noSheetInContentJson: "content.json 中未包含画布。",
    parseContentXmlFailed: "解析 content.xml 失败。",
    contentXmlInvalid: "content.xml 无效：{error}",
  },
};

const enStrings: I18nStrings = {
  commands: {
    createNewXMind: "Create New XMind File",
    exportAsMarkdown: "Export XMind as Mermaid Mindmap",
    fitToView: "Fit XMind View",
    saveFile: "Save XMind File",
  },
  menus: {
    openWithXMind: "Open with XMind",
    exportAsMarkdown: "Export as Mermaid Mindmap",
    createNewXMind: "Create New XMind Mindmap",
  },
  defaults: {
    newMindMap: "New Mind Map",
    centralTopic: "Central Topic",
    mainTopic1: "Main Topic 1",
    mainTopic2: "Main Topic 2",
    mainTopic3: "Main Topic 3",
    mainTopic4: "Main Topic 4",
    canvas: "Canvas",
    mindMap: "Mind Map",
  },
  notices: {
    created: "XMinder: Created {name}.xmind",
    createFailed: "XMinder: Failed to create file: {error}",
    exportFailed: 'XMinder: Failed to export "{name}": {error}',
    copiedToClipboard: "XMinder: Mermaid mindmap copied to clipboard.",
    copyFailed: "XMinder: Failed to copy to clipboard: {error}",
    saved: "XMinder: Saved.",
    saveFailed: "XMinder: Failed to save: {error}",
    loadFailed: "XMinder: Failed to load: {error}",
    error: "XMinder Error: {error}",
  },
  settings: {
    title: "XMinder Settings",
    autoSaveDelay: "Auto-save Delay",
    autoSaveDelayDesc: "Time to wait after the last edit (milliseconds) before auto-saving the .xmind file. Set to 0 to disable auto-save.",
    resetDefault: "Reset to default",
    resetDefaultMs: "Reset to default ({ms} ms)",
    embedHeight: "Embed Preview Height",
    embedHeightDesc: "Height of embedded mind map previews (in pixels) when using ![[file.xmind]] in notes.",
    resetDefaultPx: "Reset to default ({px} px)",
    showOpenWithXMind: 'Show "Open with XMind" menu',
    showOpenWithXMindDesc: 'Show "Open with XMind" in the file context menu to open .xmind files with the external XMind application. Recommended if XMind app is installed.',
    usage: "Usage",
    usageDesc: "Supported syntax in Markdown notes:",
    embedInteractivePreview: "— Embed interactive preview",
    linkToOpenXMind: "— Link to open XMind view",
    doubleClickTip: "Double-click a .xmind file in the file explorer to open the interactive mind map editor.",
  },
  view: {
    dragCanvas: "Drag Canvas",
    focusRoot: "Focus Root Node",
    shortcutsHelp: "Shortcuts Help",
    shortcuts: "Shortcuts",
    addChildNode: "Add Child Node",
    addSiblingNode: "Add Sibling Node",
    copy: "Copy",
    paste: "Paste",
    undo: "Undo",
    save: "Save",
    zoomOut: "Zoom Out",
    zoomIn: "Zoom In",
    resetCanvas: "Reset Canvas Size",
    fullscreen: "Fullscreen",
    switchToPointer: "Switch to Pointer Mode",
    switchToDrag: "Switch to Drag Canvas",
  },
  embed: {
    loadingXMind: "Loading XMind...",
    clickToOpen: "Click to open {name}",
    loadFailed: 'Failed to load "{name}": {error}',
  },
  parser: {
    parseContentJsonFailed: "Failed to parse content.json: Invalid JSON.",
    noSheetInContentJson: "No sheet found in content.json.",
    parseContentXmlFailed: "Failed to parse content.xml.",
    contentXmlInvalid: "Invalid content.xml: {error}",
  },
};

function getObsidianLocale(app: App): Locale {
  if (typeof window !== "undefined" && window.localStorage) {
    const storedLang = window.localStorage.getItem("language");
    if (storedLang) return storedLang.startsWith("zh") ? "zh" : "en";
  }
  const lang = (app.vault as unknown as { config?: { locale?: string } }).config?.locale ?? "en";
  return lang.startsWith("zh") ? "zh" : "en";
}

class I18n {
  private locale: Locale = "en";
  private strings: I18nStrings = enStrings;

  init(app: App): void {
    this.locale = getObsidianLocale(app);
    this.strings = this.locale === "zh" ? zhStrings : enStrings;
  }

  getLocale(): Locale {
    return this.locale;
  }

  t(): I18nStrings {
    return this.strings;
  }
}

export const i18n = new I18n();
