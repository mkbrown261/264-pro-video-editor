# 264 Pro Video Editor

Professional AI-powered modular video editor for macOS and Windows.  
Built with Electron + Vite + React + TypeScript + FFmpeg.

---

## ✅ Completed Features (Latest)

### Project Persistence (.264proj)
- JSON-based versioned schema with full project metadata, media pool, timeline, history
- Serialize/deserialize entire editor state; v1→v2 migration; `sanitizeProject` safety net
- IPC: `project:save`, `project:open`, `project:save-as` in Electron main + preload
- localStorage fallback for non-Electron environments
- `⌘S` save, `⌘O` open keyboard shortcuts

### Undo / Redo (Command Pattern)
- `withUndo(label, mutate)` captures before/after snapshots; LIFO undoStack + redoStack capped at 50
- `⌘Z` / `⌘⇧Z` shortcuts; Undo/Redo buttons in menu bar — disabled when empty
- Covers: import, clip move/trim/split/remove, transitions, effects, color grade, volume/speed, masks

### Effects System
- 13 effects: Blur, Sharpen, Brightness/Contrast, Hue/Saturation, Film Grain, Vignette, Glow/Bloom, Chroma Key, Pixelate, Edge Detect, B&W/Sepia, Exposure, RGB Split
- Real-time CSS filter rendering (`computeCssFilterFromEffects`)
- Per-effect: toggle (animated pip switch), expand/collapse params, reset to defaults
- Drag-and-drop + ↑↓ buttons to reorder effect stack
- 5 built-in presets + user presets saved to localStorage; preset delete

### Hover Preview System
- 2.5-second hover delay before showing effect preview on library items
- CSS filter applied to icon thumbnail; `previewing` badge shown
- Auto-cancelled on mouseleave; only one active preview at a time

### Transitions (complete rebuild)
- In / Out edge tabs — independent control per edge
- Duration slider showing frames + seconds
- Category tabs: Basic / Dissolve / Wipe / Push / Zoom / Stylized
- 22 transition types in grid with icon + label
- Applied transitions shown with clear buttons
- Transitions draggable (dataTransfer for future timeline drop)

### Button System
- All interactive buttons: 180ms ease transitions, proper hover/active/disabled states
- No misleading gray buttons — `disabled` properly prevents interaction
- `cursor: not-allowed` on disabled elements; `cursor: grab` on drag handles
- Primary, muted, danger, tool-button.active all fully styled

---

## 🚀 Quick Start — Local Development

### Prerequisites
- Node.js 20+
- npm 9+

### Setup
```bash
git clone https://github.com/mkbrown261/264-pro-video-editor.git
cd 264-pro-video-editor
npm install
```

### Run in dev mode
```bash
npm run dev
```

This single command starts **four concurrent processes** automatically:

| Label | Script | What it does |
|-------|--------|--------------|
| `RENDERER` | `dev:renderer` | Vite dev server with **instant HMR** at `http://localhost:5173` |
| `MAIN` | `dev:main` | TypeScript watch for `electron/main.ts` → `dist-electron/` |
| `PRELOAD` | `dev:preload` | TypeScript watch for `electron/preload.cts` → `dist-electron/` |
| `ELECTRON` | `dev:electron` | Watcher script — auto-restarts Electron when compiled output changes |

**Workflow:**
1. Edit any **renderer file** (React components, CSS) → Vite HMR applies instantly, no restart.
2. Edit **`electron/main.ts`** → `tsc --watch` recompiles in ~1s → Electron restarts automatically.
3. Edit **`electron/preload.cts`** → `tsc --watch` recompiles → Electron restarts automatically.
4. No GitHub push needed. No CI. No manual rebuild. Just `npm run dev`.

### How the watcher works (`scripts/dev-electron.mjs`)
- Waits for `dist-electron/electron/main.js` and `preload.cjs` to exist (created by `dev:init`).
- Watches `dist-electron/` recursively for `.js` / `.cjs` changes.
- Debounces 400ms (waits for the tsc burst to finish) then kills and relaunches Electron.
- Sets `VITE_DEV_SERVER_URL=http://localhost:5173` so `main.ts` calls `loadURL()` instead of `loadFile()`.
- Dev Tools open automatically in detached mode.

---

## 📦 Production Build

```bash
npm run build
```

Outputs:
- `dist/` — compiled renderer (Vite, `base: "./"` so paths work under `file://`)
- `dist-electron/` — compiled main process and preload

## 🏗 Package installers

```bash
npm run dist:mac   # macOS universal (arm64 + x64)
npm run dist:win   # Windows x64 NSIS installer
npm run dist:all   # Both platforms
```

---

## 🤖 CI/CD — Automated Releases

**Every push to `main` automatically:**
1. Reads current `package.json` version (e.g. `1.0.37`)
2. Increments the patch number → `1.0.38`
3. Commits `chore: bump version to 1.0.38 [skip ci]` + creates tag `v1.0.38`
4. Builds in parallel:
   - macOS arm64 (`macos-15`)
   - macOS x64 (`macos-15`)
   - Windows x64 (`windows-latest`)
5. Publishes a GitHub Release with all installers + `latest.yml` / `latest-mac.yml` for the auto-updater

**No manual tagging required.** For minor/major bumps, manually edit `version` in `package.json` before pushing.

---

## 📁 Project Structure

```
264-pro-video-editor/
├── electron/
│   ├── main.ts          # Electron main process (ESM)
│   ├── preload.cts      # Preload script (CommonJS — required by Electron)
│   └── ffmpeg.ts        # FFmpeg/FFprobe helpers
├── src/
│   ├── renderer/        # React app (App.tsx, panels, styles)
│   └── shared/          # Types shared between renderer and main
├── scripts/
│   └── dev-electron.mjs # Dev watcher — relaunches Electron on tsc output changes
├── build-assets/        # App icon and resources for electron-builder
├── dist/                # Compiled renderer (Vite output)
├── dist-electron/       # Compiled main process (tsc output)
├── release/             # electron-builder output (installers)
├── vite.config.ts       # base="/" dev, base="./" production
├── tsconfig.json        # Renderer TypeScript config
├── tsconfig.node.json   # Main process TypeScript config (ESM, NodeNext)
├── tsconfig.preload.json# Preload TypeScript config (CommonJS)
├── electron-builder.json# Packaging config (mac zip + win NSIS)
└── .github/workflows/
    └── build.yml        # CI: auto-bump + parallel build + publish release
```

---

## 🔄 Dev vs Production Modes

| Aspect | Dev (`npm run dev`) | Production (built app) |
|--------|--------------------|-----------------------|
| Renderer | Vite dev server HMR | Compiled `dist/` (file://) |
| Asset paths | Absolute `/assets/…` | Relative `./assets/…` |
| Main reload | Auto (watcher script) | N/A |
| Preload reload | Auto (watcher script) | N/A |
| Auto-updater | Disabled | Enabled |
| Dev Tools | Auto-open (detached) | Closed |

---

## 🌐 Landing Page

https://264pro-landing.pages.dev — auto-detects OS and highlights the correct download.

---

## 📋 Key Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Full dev mode (all watchers + Electron) |
| `npm run dev:init` | One-shot compile of main + preload (run before `dev`) |
| `npm run build` | Production build (renderer + main + preload) |
| `npm run dist:mac` | Package macOS universal installer |
| `npm run dist:win` | Package Windows NSIS installer |
| `npm run typecheck` | Run TypeScript type checks (no emit) |

---

## 📝 Notes

- **`electron/preload.cts`** must be CommonJS (`.cts` extension) because Electron's `contextBridge` context doesn't support ESM preloads.
- **`electron/main.ts`** is ESM (`"type":"module"` in package.json) — uses `import.meta.url` for `__dirname`.
- **`electron-updater`** is CJS — imported as `import pkg from 'electron-updater'; const { autoUpdater } = pkg;`.
- The dev watcher script (`scripts/dev-electron.mjs`) is pure Node.js with no extra dependencies.

---

## 🏷 Latest Release

**v1.0.37** — https://github.com/mkbrown261/264-pro-video-editor/releases/tag/v1.0.37

| Platform | File |
|----------|------|
| macOS Apple Silicon | `264-Pro-1.0.37-arm64-mac.zip` |
| macOS Intel | `264-Pro-1.0.37-x64-mac.zip` |
| Windows | `264-Pro-Setup-1.0.37.exe` |
