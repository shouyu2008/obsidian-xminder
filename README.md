# XMinder

**[English](#english) | [中文](#中文)**

---

<a id="english"></a>

## English

An [Obsidian](https://obsidian.md) plugin for reading, writing, and embedding [XMind](https://www.xmind.net) files directly inside your vault. Powered by [mind-elixir](https://github.com/SSShooter/mind-elixir-core).

### Introduction

XMinder brings full XMind mind map support to Obsidian. Open `.xmind` files as interactive, editable mind maps without leaving your note-taking workflow. Changes are auto-saved back to the original `.xmind` format, keeping your files compatible with the XMind desktop application.

### Features

- **File Explorer integration** — `.xmind` files appear in Obsidian's file tree; double-click to open
- **Interactive mind map editor** — add, edit, delete, and drag-and-drop nodes with full undo/redo support
- **Multi-sheet support** — switch between multiple canvases within a single `.xmind` file via a dropdown selector
- **Canvas panning** — toggle drag mode from the left toolbar to pan the canvas with left-click
- **Auto-save** — changes are written back to the `.xmind` file after a configurable debounce delay (default 500 ms)
- **Manual save** — `Ctrl/Cmd + S` saves immediately
- **Markdown embed** — use `![[diagram.xmind]]` to render a read-only interactive preview inline in any note
- **Markdown link** — use `[[diagram.xmind]]` to create a clickable link that opens the XMind view
- **Export to Markdown** — export the mind map as a Markdown outline copied to the clipboard
- **Open with XMind app** — right-click menu option to open `.xmind` files with the external XMind application (configurable in settings)
- **Theme follow** — automatically switches between light and dark themes with Obsidian
- **Responsive layout** — automatically re-fits the view when splitting or resizing panes
- **XMind format compatibility** — supports both `content.json` (XMind 8+ / ZEN) and legacy `content.xml` formats
- **Cross-platform** — works on macOS, Windows, Linux, and Obsidian Mobile

### Usage

#### Opening an XMind file

- **Double-click** any `.xmind` file in the file explorer
- **Right-click** a `.xmind` file → *Open as XMind* (opens with external XMind app, configurable)
- Run the command: `XMinder: Create new XMind file`

#### Embedding in a Markdown note

```markdown
# Inline read-only preview (click to open full editor)
![[my-diagram.xmind]]

# Clickable link that opens the XMind view
[[my-diagram.xmind]]
```

#### Toolbar

**Left toolbar** (top-left corner):

| Button | Description |
|--------|-------------|
| Hand / Pointer | Toggle canvas drag mode |
| Crosshair | Center and focus on root node |
| Question mark | Show keyboard shortcuts |

**Right-bottom toolbar**:

| Button | Description |
|--------|-------------|
| Zoom out | Decrease zoom level |
| Zoom in | Increase zoom level |
| Reset | Fit diagram to view and center |
| Fullscreen | Toggle fullscreen mode |

#### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Tab` | Add child node |
| `Enter` | Add sibling node |
| `Ctrl+C` | Copy |
| `Ctrl+V` | Paste |
| `Ctrl+Z` | Undo |
| `Ctrl+S` | Save |

#### Commands (Command Palette)

| Command | Description |
|---------|-------------|
| `XMinder: Create new XMind file` | Creates a new blank `.xmind` file and opens it |
| `XMinder: Export XMind as Markdown outline` | Exports as Markdown outline to clipboard |
| `XMinder: Fit XMind diagram to view` | Resets zoom and centers the diagram |
| `XMinder: Save XMind file` | Saves immediately |

#### Settings

Open *Settings → Community Plugins → XMinder*:

| Setting | Default | Description |
|---------|---------|-------------|
| Auto-save delay | `500` ms | Debounce delay before auto-saving. Set to `0` to disable. |
| Embed preview height | `320` px | Height of the `![[]]` inline preview block. |
| Show "Open as XMind" menu | On | Show the "Open as XMind" option in the file context menu. |

---

### Build & Deployment

#### Prerequisites

| Tool | Minimum version |
|------|----------------|
| Node.js | 16.x |
| npm | 7.x |

#### Project Structure

```
obsidian-xminder/
├── src/
│   ├── main.ts                  # Plugin entry point
│   ├── settings.ts              # Settings definition and UI tab
│   ├── xmind/
│   │   ├── types.ts             # Internal type definitions
│   │   ├── parser.ts            # .xmind → XMindData (ZIP + JSON/XML)
│   │   └── serializer.ts        # XMindData → .xmind (ZIP)
│   ├── views/
│   │   └── XMindView.ts         # FileView with mind-elixir renderer + custom layout
│   └── markdown/
│       └── EmbedProcessor.ts    # ![[]] / [[]] post-processor
├── dist/                        # Production build output
│   ├── main.js
│   ├── manifest.json
│   └── styles.css
├── styles.css                   # Source stylesheet
├── manifest.json                # Obsidian plugin manifest
├── package.json
├── tsconfig.json
└── esbuild.config.mjs           # Build configuration
```

#### Install Dependencies

```bash
npm install
```

#### Development Build (watch mode)

```bash
npm run dev
```

To test with Obsidian, symlink the plugin folder into your vault:

```bash
ln -s /path/to/obsidian-xminder \
  "/path/to/your/vault/.obsidian/plugins/obsidian-xminder"
```

Then enable the plugin in *Settings → Community Plugins* and reload Obsidian after each change (`Cmd+R` / `Ctrl+R`).

#### Production Build

```bash
npm run build
```

Output in `dist/`:

```
dist/
├── main.js        # Bundled plugin (all dependencies inlined)
├── manifest.json
└── styles.css
```

Clean build (removes `dist/` first):

```bash
npm run build:clean
```

#### Deployment (Manual Install)

1. **Build the plugin**:

   ```bash
   npm install && npm run build
   ```

2. **Copy to your vault**:

   ```bash
   mkdir -p "<your-vault>/.obsidian/plugins/obsidian-xminder"
   cp dist/{main.js,manifest.json,styles.css} \
     "<your-vault>/.obsidian/plugins/obsidian-xminder/"
   ```

3. **Enable the plugin** in *Settings → Community Plugins*

#### Key Dependencies

| Package | Purpose |
|---------|---------|
| [mind-elixir](https://github.com/SSShooter/mind-elixir-core) | Interactive mind map renderer |
| [jszip](https://stuk.github.io/jszip/) | Read/write `.xmind` ZIP archives |
| [obsidian](https://github.com/obsidianmd/obsidian-api) | Obsidian plugin API |
| [esbuild](https://esbuild.github.io/) | Bundler |
| [typescript](https://www.typescriptlang.org/) | Type checking |

#### Platform Support

| Platform | Status |
|----------|--------|
| macOS | ✅ Fully supported |
| Windows | ✅ Fully supported |
| Linux | ✅ Fully supported |
| Obsidian Mobile (iOS / Android) | ✅ Supported |

---

### XMind File Format

`.xmind` files are ZIP archives. This plugin reads and writes:

| Entry | Format | Version |
|-------|--------|---------|
| `content.json` | JSON array of sheets | XMind 8+ / ZEN (preferred) |
| `content.xml` | XML document | Legacy (read-only) |
| `metadata.json` | JSON | Written on save |

Files in `content.xml` format are upgraded to `content.json` on first save.

### License

MIT

---

<a id="中文"></a>

## 中文

一个 [Obsidian](https://obsidian.md) 插件，用于在笔记库中直接读取、编辑和嵌入 [XMind](https://www.xmind.net) 思维导图文件。基于 [mind-elixir](https://github.com/SSShooter/mind-elixir-core) 渲染引擎。

### 简介

XMinder 为 Obsidian 带来完整的 XMind 思维导图支持。无需离开笔记工作流，即可打开 `.xmind` 文件进行交互式编辑。修改会自动保存回原始 `.xmind` 格式，与 XMind 桌面应用完全兼容。

### 功能介绍

- **文件管理器集成** — `.xmind` 文件显示在 Obsidian 文件树中，双击即可打开
- **交互式思维导图编辑器** — 支持添加、编辑、删除、拖拽节点，完整的撤销/重做支持
- **多画布支持** — 通过右上角下拉菜单在单个 `.xmind` 文件的多个画布之间切换
- **画布拖拽** — 左侧工具栏切换拖拽模式，左键拖动画布平移
- **自动保存** — 编辑后自动保存到 `.xmind` 文件（默认延迟 500ms，可配置）
- **手动保存** — `Ctrl/Cmd + S` 立即保存
- **Markdown 嵌入** — 使用 `![[diagram.xmind]]` 在笔记中渲染只读交互式预览
- **Markdown 链接** — 使用 `[[diagram.xmind]]` 创建点击即可打开的链接
- **导出为 Markdown** — 将思维导图导出为 Markdown 大纲，复制到剪贴板
- **外部应用打开** — 右键菜单支持使用外部 XMind 应用打开文件（可在设置中配置）
- **主题跟随** — 自动跟随 Obsidian 的亮色/暗色主题切换
- **响应式布局** — 分屏或调整面板大小时自动重新适配视图
- **XMind 格式兼容** — 支持 `content.json`（XMind 8+ / ZEN）和旧版 `content.xml` 格式
- **跨平台** — 支持 macOS、Windows、Linux 和 Obsidian 移动端

### 使用方法

#### 打开 XMind 文件

- **双击**文件管理器中的 `.xmind` 文件
- **右键** `.xmind` 文件 → *Open as XMind*（使用外部 XMind 应用打开，可配置）
- 运行命令：`XMinder: Create new XMind file`

#### 在 Markdown 笔记中嵌入

```markdown
# 内嵌只读预览（点击打开完整编辑器）
![[my-diagram.xmind]]

# 可点击链接
[[my-diagram.xmind]]
```

#### 工具栏

**左侧工具栏**（左上角）：

| 按钮 | 功能 |
|------|------|
| 手掌 / 指针 | 切换画布拖拽模式 |
| 十字准星 | 聚焦根节点并居中 |
| 问号 | 显示快捷键说明 |

**右下角工具栏**：

| 按钮 | 功能 |
|------|------|
| 缩小 | 缩小画布 |
| 放大 | 放大画布 |
| 重置 | 恢复初始大小并居中 |
| 全屏 | 切换全屏模式 |

#### 快捷键

| 快捷键 | 操作 |
|--------|------|
| `Tab` | 添加子节点 |
| `Enter` | 添加同级节点 |
| `Ctrl+C` | 复制 |
| `Ctrl+V` | 粘贴 |
| `Ctrl+Z` | 撤销 |
| `Ctrl+S` | 保存 |

#### 命令面板

| 命令 | 说明 |
|------|------|
| `XMinder: Create new XMind file` | 创建新的空白 `.xmind` 文件并打开 |
| `XMinder: Export XMind as Markdown outline` | 导出为 Markdown 大纲到剪贴板 |
| `XMinder: Fit XMind diagram to view` | 重置缩放并居中 |
| `XMinder: Save XMind file` | 立即保存 |

#### 插件设置

打开 *设置 → 第三方插件 → XMinder*：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| Auto-save delay | `500` ms | 编辑后自动保存延迟。设为 `0` 禁用自动保存。 |
| Embed preview height | `320` px | `![[]]` 内嵌预览的高度。 |
| Show "Open as XMind" menu | 开启 | 在右键菜单中显示"Open as XMind"选项。 |

---

### 项目构建及部署

#### 环境要求

| 工具 | 最低版本 |
|------|---------|
| Node.js | 16.x |
| npm | 7.x |

#### 项目结构

```
obsidian-xminder/
├── src/
│   ├── main.ts                  # 插件入口
│   ├── settings.ts              # 设置定义及 UI
│   ├── xmind/
│   │   ├── types.ts             # 内部类型定义
│   │   ├── parser.ts            # .xmind → XMindData（ZIP + JSON/XML）
│   │   └── serializer.ts        # XMindData → .xmind（ZIP）
│   ├── views/
│   │   └── XMindView.ts         # FileView + mind-elixir 渲染 + 自定义布局引擎
│   └── markdown/
│       └── EmbedProcessor.ts    # ![[]] / [[]] 后处理器
├── dist/                        # 构建产物
│   ├── main.js
│   ├── manifest.json
│   └── styles.css
├── styles.css                   # 源样式表
├── manifest.json                # Obsidian 插件清单
├── package.json
├── tsconfig.json
└── esbuild.config.mjs           # 构建配置
```

#### 安装依赖

```bash
npm install
```

#### 开发构建（监听模式）

```bash
npm run dev
```

测试时，将插件目录软链接到 Obsidian 笔记库：

```bash
ln -s /path/to/obsidian-xminder \
  "/path/to/your/vault/.obsidian/plugins/obsidian-xminder"
```

在 *设置 → 第三方插件* 中启用插件，修改代码后按 `Cmd+R` / `Ctrl+R` 重新加载。

#### 生产构建

```bash
npm run build
```

产物在 `dist/` 目录：

```
dist/
├── main.js        # 打包后的插件（所有依赖已内联）
├── manifest.json
└── styles.css
```

清理构建：

```bash
npm run build:clean
```

#### 部署（手动安装）

1. **构建插件**：

   ```bash
   npm install && npm run build
   ```

2. **复制到笔记库**：

   ```bash
   mkdir -p "<your-vault>/.obsidian/plugins/obsidian-xminder"
   cp dist/{main.js,manifest.json,styles.css} \
     "<your-vault>/.obsidian/plugins/obsidian-xminder/"
   ```

3. **启用插件**：打开 *设置 → 第三方插件*，找到 XMinder 并启用

#### 主要依赖

| 包 | 用途 |
|---|------|
| [mind-elixir](https://github.com/SSShooter/mind-elixir-core) | 交互式思维导图渲染引擎 |
| [jszip](https://stuk.github.io/jszip/) | 读写 `.xmind` ZIP 压缩包 |
| [obsidian](https://github.com/obsidianmd/obsidian-api) | Obsidian 插件 API |
| [esbuild](https://esbuild.github.io/) | 打包工具 |
| [typescript](https://www.typescriptlang.org/) | 类型检查 |

#### 平台支持

| 平台 | 状态 |
|------|------|
| macOS | ✅ 完全支持 |
| Windows | ✅ 完全支持 |
| Linux | ✅ 完全支持 |
| Obsidian 移动端（iOS / Android） | ✅ 支持 |

---

### XMind 文件格式

`.xmind` 文件是 ZIP 压缩包，本插件读写以下内容：

| 文件 | 格式 | 版本 |
|------|------|------|
| `content.json` | JSON sheet 数组 | XMind 8+ / ZEN（首选） |
| `content.xml` | XML 文档 | 旧版（只读） |
| `metadata.json` | JSON | 保存时写入 |

旧版 `content.xml` 格式的文件在首次保存时会自动升级为 `content.json` 格式。

### 许可证

MIT
