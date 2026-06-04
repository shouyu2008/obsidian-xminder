# XMinder

> An [Obsidian](https://obsidian.md) plugin for reading, writing, and embedding [XMind](https://www.xmind.net) mind maps directly inside your vault.

**[English](README.md) · [中文](README.zh.md)**

---

## Introduction

XMinder brings full XMind mind map support to Obsidian. Open `.xmind` files as interactive, editable mind maps without leaving your note-taking workflow. Changes are auto-saved back to the original `.xmind` format, keeping your files compatible with the XMind desktop application.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **File Explorer integration** | `.xmind` files appear in Obsidian's file tree — click to open |
| **Interactive editor** | Add, edit, delete, and drag-and-drop nodes with full undo/redo support |
| **Multi-sheet support** | Switch between multiple canvases within a single `.xmind` file |
| **Canvas panning** | Toggle drag mode from the left toolbar to pan with left-click |
| **Auto-save** | Changes are written back to the `.xmind` file after a configurable debounce (default 500ms) |
| **Manual save** | `Ctrl/Cmd + S` saves immediately |
| **Markdown embed** | Use `![[diagram.xmind]]` to render a read-only interactive preview inline (Reading & Live Preview modes) |
| **Markdown link** | Use `[[diagram.xmind]]` to create a clickable link that opens the XMind view |
| **Export to Mermaid** | Export mind map as Mermaid format to clipboard (paste directly into notes for rendering) |
| **Open with XMind app** | Right-click menu option to open `.xmind` files with external XMind application |
| **Theme following** | Automatically switches between light and dark themes with Obsidian |
| **Responsive layout** | Auto re-fits the view when splitting or resizing panes |
| **Internationalization** | Full support for English and Chinese (auto-detected from Obsidian settings) |
| **Format compatibility** | Supports both `content.json` (XMind 8+ / ZEN) and legacy `content.xml` formats |
| **Cross-platform** | Works on macOS, Windows, Linux, and Obsidian Mobile |

---

## User Guide

### Opening an XMind File

| Method | How |
|--------|-----|
| Click | Click any `.xmind` file in the file explorer |
| Context menu | Right-click a `.xmind` file → *Open with XMind App* (opens in external app) |
| Context menu | Right-click a folder → *Create New XMind Mindmap* |
| Command | Run `XMinder: Create new XMind file` |

### Embedding in a Markdown Note

```markdown
# Inline read-only preview (click to open full editor)
![[my-diagram.xmind]]

# Clickable link that opens the XMind view
[[my-diagram.xmind]]
```

### Exporting to Mermaid Mindmap

The exported Mermaid format can be pasted directly into notes where the Mermaid plugin renders it as a visual mind map:

```markdown
mindmap
  root(("Central Topic"))
    Main Topic 1
      Subtopic 1
      Subtopic 2
    Main Topic 2
      Subtopic 3
```

---

## Features & Shortcuts

### Toolbar

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

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Tab` | Add child node |
| `Enter` | Add sibling node |
| `Ctrl/Cmd + C` | Copy |
| `Ctrl/Cmd + V` | Paste |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + S` | Save immediately |

### Command Palette

| Command | Description |
|---------|-------------|
| `XMinder: Create New XMind File` | Creates a new blank `.xmind` file and opens it |
| `XMinder: Export XMind as Mermaid Mindmap` | Exports as Mermaid mindmap to clipboard |
| `XMinder: Fit XMind View` | Resets zoom and centers the diagram |
| `XMinder: Save XMind File` | Saves immediately |

---

## Settings

Open *Settings → Community Plugins → XMinder*:

| Setting | Default | Description |
|---------|---------|-------------|
| Auto-save Delay | `500` ms | Time to wait after the last edit before auto-saving. Set to `0` to disable. |
| Embed Preview Height | `320` px | Height of embedded mind map previews when using `![[file.xmind]]`. |
| Show "Open with XMind App" menu | On | Show "Open with XMind App" in file context menu. |
| Enable Clipboard Export | On | Enable copying mind map as Mermaid format to clipboard. Disable to remove clipboard access. |

---

## Project Info

### Project Structure

```
obsidian-xminder/
├── src/
│   ├── main.ts                        # Plugin entry point & lifecycle
│   ├── settings.ts                    # Settings definition and UI tab
│   ├── i18n.ts                        # Internationalization (en/zh)
│   ├── xmind/
│   │   ├── types.ts                   # Internal type definitions
│   │   ├── parser.ts                  # .xmind → XMindData (ZIP + JSON/XML)
│   │   ├── serializer.ts              # XMindData → .xmind (ZIP)
│   │   └── canvas.ts                  # Export to Obsidian Canvas format
│   ├── views/
│   │   ├── XMindView.ts               # FileView with mind-elixir renderer
│   │   └── LayoutEngine.ts            # Custom layout engine for node positioning
│   └── markdown/
│       ├── EmbedProcessor.ts          # ![[]] / [[]] post-processor (Reading mode)
│       └── LivePreviewProcessor.ts    # CodeMirror extension (Live Preview mode)
├── .github/
│   └── workflows/
│       └── release.yml                # CI/CD workflow with artifact attestation
├── styles.css                         # Source stylesheet
├── manifest.json                      # Obsidian plugin manifest
├── package.json
├── tsconfig.json
└── esbuild.config.mjs                 # Build configuration with dependency bundling
```

### Environment Requirements

| Tool | Minimum Version |
|------|----------------|
| Node.js | 16.x |
| npm | 7.x |

### Install Dependencies

```bash
npm install
```

### Development Build (watch mode)

```bash
npm run dev
```

To test with Obsidian, symlink the plugin folder into your vault:

```bash
ln -s /path/to/obsidian-xminder \
  "/path/to/your/vault/.obsidian/plugins/obsidian-xminder"
```

Then enable the plugin in *Settings → Community Plugins* and reload Obsidian after each change (`Cmd+R` / `Ctrl+R`).

### Production Build

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

### Manual Deployment

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

### GitHub Actions CI/CD

The repository includes a [release workflow](.github/workflows/release.yml) that:

- Triggers on any git tag push
- Builds the plugin with `npm run build`
- Generates GitHub artifact attestations for build provenance
- Creates a GitHub Release with `main.js`, `styles.css`, and `manifest.json`

To publish a release:

```bash
git tag -a v1.0.8 -m "Release v1.0.8"
git push origin v1.0.8
```

### Key Dependencies

| Package | Purpose |
|---------|---------|
| [mind-elixir](https://github.com/SSShooter/mind-elixir-core) | Interactive mind map renderer |
| [jszip](https://stuk.github.io/jszip/) | Read/write `.xmind` ZIP archives |
| [obsidian](https://github.com/obsidianmd/obsidian-api) | Obsidian plugin API |
| [esbuild](https://esbuild.github.io/) | Bundler |
| [typescript](https://www.typescriptlang.org/) | Type checking |

### Platform Support

| Platform | Status |
|----------|--------|
| macOS | ✅ Fully supported |
| Windows | ✅ Fully supported |
| Linux | ✅ Fully supported |
| Obsidian Mobile (iOS / Android) | ✅ Supported |

---

## XMind File Format

`.xmind` files are ZIP archives. This plugin reads and writes:

| Entry | Format | Version |
|-------|--------|---------|
| `content.json` | JSON array of sheets | XMind 8+ / ZEN (preferred) |
| `content.xml` | XML document | Legacy (read-only) |
| `metadata.json` | JSON | Written on save |

Files in `content.xml` format are upgraded to `content.json` on first save.

---

## License

MIT
