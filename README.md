# obsidian-xminder

An [Obsidian](https://obsidian.md) plugin for reading, writing, and embedding [XMind](https://www.xmind.net) files directly inside your vault.

## Features

- **File Explorer integration** — `.xmind` files appear in Obsidian's navigation tree; double-click to open
- **Interactive mind map editor** — powered by [mind-elixir](https://github.com/SSShooter/mind-elixir-core), with drag-and-drop, node editing, undo/redo, right-click context menu, and toolbar
- **Auto-save** — changes are written back to the `.xmind` file automatically after a configurable debounce delay (default 500 ms); set to `0` to disable
- **Manual save** — `Ctrl/Cmd + S` saves immediately at any time
- **Markdown embed** — use `![[diagram.xmind]]` to render a read-only interactive preview inline in any note; click the preview to open the full editor
- **Markdown link** — use `[[diagram.xmind]]` to create a clickable link that opens the XMind view
- **XMind format compatibility** — supports both `content.json` (XMind 8 / ZEN, preferred) and legacy `content.xml` formats
- **Theme follow** — the mind map theme automatically switches between light and dark when Obsidian's theme changes
- **Export to Markdown** — export the current mind map as a Markdown outline; result is copied to the clipboard
- **Cross-platform** — works on macOS, Windows, Linux, and Obsidian for Mobile (no native dependencies)

## Usage

### Opening an XMind file

- **Double-click** any `.xmind` file in the file explorer
- **Right-click** a `.xmind` file → *Open as Mind Map*
- Run the command palette command: `XMinder: Create new XMind file`

### Embedding in a Markdown note

```markdown
# Inline read-only preview (click to open full editor)
![[my-diagram.xmind]]

# Clickable link that opens the XMind view
[[my-diagram.xmind]]
```

### Commands (Command Palette)

| Command | Description |
|---------|-------------|
| `XMinder: Create new XMind file` | Creates a new blank `.xmind` file in the vault root and opens it |
| `XMinder: Export XMind as Markdown outline` | Exports the active mind map as a Markdown outline and copies it to the clipboard |
| `XMinder: Fit XMind diagram to view` | Resets zoom and centers the diagram |
| `XMinder: Save XMind file` | Saves the active XMind file immediately |

### Settings

Open *Settings → Community Plugins → XMinder* to configure:

| Setting | Default | Description |
|---------|---------|-------------|
| Auto-save delay | `500` ms | Debounce delay after the last edit before auto-saving. Set to `0` to disable auto-save entirely. |
| Embed preview height | `320` px | Height of the `![[]]` inline preview block. |
| Default branch direction | Both sides | Layout direction for newly created XMind files. |

---

## Development

### Prerequisites

| Tool | Minimum version |
|------|----------------|
| Node.js | 16.x |
| npm | 7.x |

### Project structure

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
│   │   └── XMindView.ts         # ItemView with mind-elixir renderer
│   └── markdown/
│       └── EmbedProcessor.ts    # ![[]] / [[]] post-processor
├── dist/                        # Production build output (git-ignored)
│   ├── main.js
│   ├── manifest.json
│   └── styles.css
├── styles.css                   # Source stylesheet
├── manifest.json                # Obsidian plugin manifest
├── package.json
├── tsconfig.json
└── esbuild.config.mjs           # Build configuration
```

### Install dependencies

```bash
npm install
```

### Development build (watch mode)

Outputs `main.js` to the **project root** with inline source maps and watches for file changes:

```bash
npm run dev
```

To test with Obsidian during development, symlink or copy the plugin folder into your vault's plugin directory:

```bash
# macOS / Linux example
ln -s /path/to/obsidian-xminder \
  "/path/to/your/vault/.obsidian/plugins/obsidian-xminder"
```

Then enable the plugin in *Settings → Community Plugins*. After each saved change, run *Reload app without saving* (or use the [Hot Reload](https://github.com/pjeby/hot-reload) community plugin) to pick up the new `main.js`.

### Production build

Runs TypeScript type checking first, then bundles everything into `dist/`:

```bash
npm run build
```

Output files in `dist/`:

```
dist/
├── main.js        # Bundled plugin (~457 KB, all dependencies inlined)
├── manifest.json  # Copied from project root
└── styles.css     # Copied from project root
```

To do a clean build (removes `dist/` first):

```bash
npm run build:clean
```

### Type checking only

```bash
npm run typecheck
```

### Key dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| [mind-elixir](https://github.com/SSShooter/mind-elixir-core) | 4.6.2 | Interactive mind map renderer |
| [jszip](https://stuk.github.io/jszip/) | 3.10.1 | Read/write `.xmind` ZIP archives (pure JS, cross-platform) |
| [obsidian](https://github.com/obsidianmd/obsidian-api) | latest | Obsidian plugin API type declarations |
| [esbuild](https://esbuild.github.io/) | 0.21.5 | Bundler |
| [typescript](https://www.typescriptlang.org/) | 5.4.5 | Type checking |

> **Note — Yarn Plug'n'Play environments**: If your system has a global Yarn PnP manifest (`.pnp.cjs`) that intercepts Node module resolution, the `localResolvePlugin` in `esbuild.config.mjs` automatically forces esbuild to resolve all packages from the local `node_modules/` directory, bypassing the PnP layer. No manual action is required.

---

## Deployment (manual install)

Copy the three files from `dist/` into a new folder inside your vault's plugin directory, then enable the plugin in Obsidian.

### Step-by-step

1. **Build the plugin** (or download a release):

   ```bash
   npm install
   npm run build
   ```

2. **Locate your vault's plugin directory**:

   ```
   <your-vault>/.obsidian/plugins/
   ```

3. **Create the plugin folder**:

   ```bash
   mkdir "<your-vault>/.obsidian/plugins/obsidian-xminder"
   ```

4. **Copy the build artifacts**:

   ```bash
   cp dist/main.js      "<your-vault>/.obsidian/plugins/obsidian-xminder/"
   cp dist/manifest.json "<your-vault>/.obsidian/plugins/obsidian-xminder/"
   cp dist/styles.css   "<your-vault>/.obsidian/plugins/obsidian-xminder/"
   ```

   Or as a one-liner:

   ```bash
   cp dist/{main.js,manifest.json,styles.css} \
     "<your-vault>/.obsidian/plugins/obsidian-xminder/"
   ```

5. **Enable the plugin** in Obsidian:
   - Open *Settings → Community Plugins*
   - Disable *Safe mode* if prompted
   - Find **XMinder** in the installed plugins list and toggle it on

### Updating

Repeat steps 1 and 4 above. Obsidian will pick up the new `main.js` after you reload the plugin (toggle it off and on in settings, or restart Obsidian).

### Platform notes

| Platform | Notes |
|----------|-------|
| macOS | Fully supported |
| Windows | Fully supported; the plugin uses `normalizePath()` for all paths |
| Linux | Fully supported |
| Obsidian Mobile (iOS / Android) | Supported; no native Node.js dependencies are used |

---

## XMind file format notes

`.xmind` files are ZIP archives. This plugin reads and writes the following entries:

| Entry | Format | Version |
|-------|--------|---------|
| `content.json` | JSON array of sheets | XMind 8+ / ZEN (preferred) |
| `content.xml` | XML document | XMind legacy (read-only support) |
| `metadata.json` | JSON | Written on save |

When saving, the plugin always writes `content.json` (XMind 8+ format). Files originally in `content.xml` format will be upgraded to `content.json` on first save.

---

## License

MIT
