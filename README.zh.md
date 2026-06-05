# XMinder

> 一个 [Obsidian](https://obsidian.md) 插件，用于在笔记库中直接新建、读取、编辑、嵌入思维导图，支持 xmind 格式。

**[English](README.md) · [中文](README.zh.md)**

---

## 简介

XMinder 为 Obsidian 带来完整的思维导图支持。无需离开笔记工作流，即可新建或打开 `.xmind` 文件进行交互式编辑。所有修改会自动保存回原始 `.xmind` 格式，与 XMind 桌面应用完全兼容。

---

## 主要特性

| 特性 | 说明 |
|------|------|
| **文件管理器集成** | `.xmind` 文件显示在 Obsidian 文件树中，点击即可打开 |
| **交互式编辑器** | 支持添加、编辑、删除、拖拽节点，完整的撤销/重做支持 |
| **多画布支持** | 在单个 `.xmind` 文件的多个画布之间自由切换 |
| **画布拖拽** | 左侧工具栏切换拖拽模式，左键拖动画布平移 |
| **自动保存** | 编辑后自动保存到 `.xmind` 文件（默认延迟 500ms，可配置） |
| **手动保存** | `Ctrl/Cmd + S` 立即保存 |
| **Markdown 嵌入** | 使用 `![[diagram.xmind]]` 在笔记中渲染只读交互式预览（支持阅读模式和实时预览） |
| **Markdown 链接** | 使用 `[[diagram.xmind]]` 创建点击即可打开的链接 |
| **导出为 Mermaid** | 将思维导图导出为 Mermaid 格式复制到剪贴板（可直接粘贴到笔记中渲染） |
| **外部应用打开** | 右键菜单支持使用外部 XMind 应用打开文件 |
| **主题跟随** | 自动跟随 Obsidian 的亮色/暗色主题切换 |
| **响应式布局** | 分屏或调整面板大小时自动重新适配视图 |
| **国际化支持** | 完整支持中文和英文界面（自动检测 Obsidian 语言设置） |
| **格式兼容** | 支持 `content.json`（XMind 8+ / ZEN）和旧版 `content.xml` 格式 |
| **跨平台** | 支持 macOS、Windows、Linux 和 Obsidian 移动端 |

---

## 新建及打开

| 方式 | 操作 |
|------|------|
| 点击 | 点击文件管理器中的 `.xmind` 文件 |
| 右键菜单 | 右键点击 `.xmind` 文件 → *Open with XMind App*（使用外部应用打开） |
| 右键菜单 | 右键点击文件夹 → *Create New XMind Mindmap*（新建文件） |
| 命令面板 | 运行 `XMinder: Create new XMind file` |

### 在 Markdown 笔记中嵌入

```markdown
# 内嵌只读预览（点击打开完整编辑器）
![[my-diagram.xmind]]

# 可点击链接
[[my-diagram.xmind]]
```

### 导出为 Mermaid 脑图

导出的 Mermaid 格式可以直接粘贴到笔记中，Mermaid 插件会自动渲染为可视化脑图：

```markdown
mindmap
  root(("中心主题"))
    主主题 1
      子主题 1
      子主题 2
    主主题 2
      子主题 3
```

---

## 功能和快捷键

### 工具栏

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

### 快捷键

| 快捷键 | 操作 |
|--------|------|
| `Tab` | 添加子节点 |
| `Enter` | 添加同级节点 |
| `Ctrl/Cmd + C` | 复制 |
| `Ctrl/Cmd + V` | 粘贴 |
| `Ctrl/Cmd + Z` | 撤销 |
| `Ctrl/Cmd + S` | 立即保存 |

### 命令面板

| 命令 | 说明 |
|------|------|
| `XMinder: Create New XMind File` | 创建新的空白 `.xmind` 文件并打开 |
| `XMinder: Export XMind as Mermaid Mindmap` | 导出为 Mermaid 脑图到剪贴板 |
| `XMinder: Fit XMind View` | 重置缩放并居中 |
| `XMinder: Save XMind File` | 立即保存 |

---

## 主要设置介绍

打开 *设置 → 第三方插件 → XMinder*：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 自动保存延迟 | `500` ms | 编辑后等待时间，到期后自动保存。设为 `0` 可禁用自动保存。 |
| 嵌入预览高度 | `320` px | 使用 `![[file.xmind]]` 时内嵌预览的高度。 |
| 显示"用 XMind App 打开"菜单 | 开启 | 在文件右键菜单中显示"用 XMind App 打开"。 |
| 启用剪贴板导出 | 开启 | 启用后将思维导图以 Mermaid 格式复制到系统剪贴板。关闭后可移除剪贴板访问权限。 |

---

## 项目介绍

### 项目结构

```
obsidian-xminder/
├── src/
│   ├── main.ts                        # 插件入口及生命周期管理
│   ├── settings.ts                    # 设置定义及 UI 界面
│   ├── i18n.ts                        # 国际化（中/英文）
│   ├── xmind/
│   │   ├── types.ts                   # 内部类型定义
│   │   ├── parser.ts                  # .xmind → XMindData（ZIP + JSON/XML 解析）
│   │   ├── serializer.ts             # XMindData → .xmind（ZIP 序列化）
│   │   └── canvas.ts                  # 导出为 Obsidian Canvas 格式
│   ├── views/
│   │   ├── XMindView.ts              # FileView + mind-elixir 渲染器
│   │   └── LayoutEngine.ts           # 自定义布局引擎，处理节点定位
│   └── markdown/
│       ├── EmbedProcessor.ts          # ![[]] / [[]] 后处理器（阅读模式）
│       └── LivePreviewProcessor.ts   # CodeMirror 扩展（实时预览模式）
├── .github/
│   └── workflows/
│       └── release.yml                # CI/CD 工作流，含 artifact 认证
├── styles.css                         # 源样式表
├── manifest.json                      # Obsidian 插件清单
├── package.json
├── tsconfig.json
└── esbuild.config.mjs                 # 构建配置，打包依赖
```

### 环境要求

| 工具 | 最低版本 |
|------|---------|
| Node.js | 16.x |
| npm | 7.x |

### 安装依赖

```bash
npm install
```

### 开发构建（监听模式）

```bash
npm run dev
```

测试时，将插件目录软链接到 Obsidian 笔记库：

```bash
ln -s /path/to/obsidian-xminder \
  "/path/to/your/vault/.obsidian/plugins/obsidian-xminder"
```

在 *设置 → 第三方插件* 中启用插件，修改代码后按 `Cmd+R` / `Ctrl+R` 重新加载。

### 生产构建

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

### 手动部署

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

### GitHub Actions 自动化部署

项目包含 [release 工作流](.github/workflows/release.yml)，功能包括：

- 推送任意 git tag 时自动触发
- 执行 `npm run build` 构建插件
- 生成 GitHub artifact 认证，确保构建来源可追溯
- 自动创建 GitHub Release，上传 `main.js`、`styles.css`、`manifest.json`

发布新版本：

```bash
git tag -a v1.0.8 -m "Release v1.0.8"
git push origin v1.0.8
```

### 主要依赖

| 包 | 用途 |
|---|------|
| [mind-elixir](https://github.com/SSShooter/mind-elixir-core) | 交互式思维导图渲染引擎 |
| [jszip](https://stuk.github.io/jszip/) | 读写 `.xmind` ZIP 压缩包 |
| [obsidian](https://github.com/obsidianmd/obsidian-api) | Obsidian 插件 API |
| [esbuild](https://esbuild.github.io/) | 打包工具 |
| [typescript](https://www.typescriptlang.org/) | 类型检查 |

### 平台支持

| 平台 | 状态 |
|------|------|
| macOS | ✅ 完全支持 |
| Windows | ✅ 完全支持 |
| Linux | ✅ 完全支持 |
| Obsidian 移动端（iOS / Android） | ✅ 支持 |

---

## XMind 文件格式

`.xmind` 文件是 ZIP 压缩包，本插件读写以下内容：

| 文件 | 格式 | 版本 |
|------|------|------|
| `content.json` | JSON sheet 数组 | XMind 8+ / ZEN（首选） |
| `content.xml` | XML 文档 | 旧版（只读） |
| `metadata.json` | JSON | 保存时写入 |

旧版 `content.xml` 格式的文件在首次保存时会自动升级为 `content.json` 格式。

---

## 许可证

MIT
