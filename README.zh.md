# XMinder

一个 [Obsidian](https://obsidian.md) 插件，用于在笔记库中直接读取、编辑和嵌入 [XMind](https://www.xmind.net) 思维导图文件。基于 [mind-elixir](https://github.com/SSShooter/mind-elixir-core) 渲染引擎。

**[English](README.md)**

### 简介

XMinder 为 Obsidian 带来完整的 XMind 思维导图支持。无需离开笔记工作流，即可打开 `.xmind` 文件进行交互式编辑。修改会自动保存回原始 `.xmind` 格式，与 XMind 桌面应用完全兼容。

### 功能介绍

- **文件管理器集成** — `.xmind` 文件显示在 Obsidian 文件树中，点击即可打开
- **交互式思维导图编辑器** — 支持添加、编辑、删除、拖拽节点，完整的撤销/重做支持
- **多画布支持** — 通过右上角下拉菜单在单个 `.xmind` 文件的多个画布之间切换
- **画布拖拽** — 左侧工具栏切换拖拽模式，左键拖动画布平移
- **自动保存** — 编辑后自动保存到 `.xmind` 文件（默认延迟 500ms，可配置）
- **手动保存** — `Ctrl/Cmd + S` 立即保存
- **Markdown 嵌入** — 使用 `![[diagram.xmind]]` 在笔记中渲染只读交互式预览
- **Markdown 链接** — 使用 `[[diagram.xmind]]` 创建点击即可打开的链接
- **导出为 Mermaid 脑图** — 将思维导图导出为 Mermaid 格式，复制到剪贴板（可直接粘贴到笔记中渲染）
- **外部应用打开** — 右键菜单支持使用外部 XMind 应用打开文件（可在设置中配置）
- **主题跟随** — 自动跟随 Obsidian 的亮色/暗色主题切换
- **响应式布局** — 分屏或调整面板大小时自动重新适配视图
- **XMind 格式兼容** — 支持 `content.json`（XMind 8+ / ZEN）和旧版 `content.xml` 格式
- **跨平台** — 支持 macOS、Windows、Linux 和 Obsidian 移动端

### 使用方法

#### 打开 XMind 文件

- **点击**文件管理器中的 `.xmind` 文件
- **右键** `.xmind` 文件 → *Open as XMind*（使用外部 XMind 应用打开，可配置）
- **右键**文件夹 → *新建 XMind 脑图*（在指定文件夹中创建新的 XMind 文件）
- 运行命令：`XMinder: Create new XMind file`

#### 在 Markdown 笔记中嵌入

```markdown
# 内嵌只读预览（点击打开完整编辑器）
![[my-diagram.xmind]]

# 可点击链接
[[my-diagram.xmind]]
```

#### 导出为 Mermaid 脑图

导出的 Mermaid 脑图格式可以直接粘贴到笔记中，Mermaid 插件会自动渲染为可视化脑图：

```markdown
mindmap
  root(("中心主题"))
    主主题 1
      子主题 1
      子主题 2
    主主题 2
      子主题 3
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
| `XMinder: 新建 XMind 文件` | 创建新的空白 `.xmind` 文件并打开 |
| `XMinder: 导出 XMind 为 Mermaid 脑图` | 导出为 Mermaid 脑图到剪贴板（可直接粘贴到笔记中渲染） |
| `XMinder: 适配 XMind 视图` | 重置缩放并居中 |
| `XMinder: 保存 XMind 文件` | 立即保存 |

#### 插件设置

打开 *设置 → 第三方插件 → XMinder*：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 自动保存延迟 | `500` ms | 编辑后自动保存延迟。设为 `0` 禁用自动保存。 |
| 嵌入预览高度 | `320` px | `![[]]` 内嵌预览的高度。 |
| 显示"用 XMind 打开"菜单 | 开启 | 在文件右键菜单中显示"用 XMind 打开"，用外部 XMind 应用打开 .xmind 文件。已安装 XMind 应用时建议开启。 |

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
