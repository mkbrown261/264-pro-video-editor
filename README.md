# 264 Pro Video Editor

`264 Pro Video Editor` is a phased build of a professional desktop video editor inspired by DaVinci Resolve's workflow shape, but intentionally scoped to a real production roadmap instead of a one-shot imitation.

## 1. Architecture Overview

### System Shape

- Desktop shell: Electron hosts the application, owns filesystem access, window lifecycle, FFmpeg orchestration, and future background render jobs.
- UI client: React + TypeScript renders the editing workspace, tool panels, inspector, transport controls, and timeline interactions.
- Shared domain layer: TypeScript models in `src/shared` define assets, sequences, clips, timeline calculations, and export contracts used by both Electron and React.
- Media services: Electron-side FFprobe and FFmpeg services probe source media and render timelines to output files.
- Playback layer: Phase 1 uses HTML5 video decoding for preview playback while keeping the playback state and timeline math independent from the DOM video element.

### Why This Architecture

- Electron over Tauri: Phase 1 needs dependable Node process control, straightforward FFmpeg invocation, and low-friction desktop filesystem access. Electron is heavier, but it is still the pragmatic choice for a first professional editing MVP.
- React + TypeScript: The app will grow into panel-heavy, interaction-dense tooling. React supports composable editor surfaces well, and TypeScript is essential once timeline state, effects parameters, and export graphs become large.
- Shared domain package: Editors fail when UI logic and media logic drift apart. Shared types let the renderer, main process, and tests speak the same timeline language.
- FFmpeg/FFprobe: They are the right Phase 1 foundation for ingest, metadata probing, and export. Later phases can add a custom playback/render engine without rewriting the import/export contract.

## 2. Tech Stack Justification

### Frontend

- React 19 + TypeScript
- Zustand for editor state
- Vite for fast renderer builds

Why:

- React handles complex docked tooling well.
- Zustand keeps the editor store lightweight and slice-friendly; this matters for future panels like color, Fairlight-style audio, and Fusion-style compositing.
- Vite keeps local iteration fast while the Electron shell remains independent.

### Backend / Desktop Runtime

- Electron main process
- Secure preload bridge with `contextIsolation`

Why:

- A professional editor needs trusted local file access, subprocess control, background job execution, and later GPU/native integration points.
- Keeping Node access in Electron main prevents the renderer from owning unsafe capabilities.

### Rendering / Processing

- Phase 1 preview: HTML5 video playback in the renderer
- Phase 1 export: FFmpeg filter graph generation in Electron
- Future real-time engine: a dedicated playback/render service with GPU scheduling

Why:

- HTML5 playback is enough for single-track MVP review and scrubbing.
- FFmpeg is strong for deterministic export from trimmed clip segments.
- Real-time multi-layer compositing should not be faked in MVP; it belongs in later engine phases.

### GPU Acceleration Direction

- Phase 1: browser video decode and platform media acceleration where available
- Phase 2+: GPU effects/compositing via WebGPU for cross-platform rendering, with native acceleration adapters evaluated later for Metal and CUDA specific paths

Why:

- WebGPU provides a credible cross-platform route for GPU effects inside the desktop renderer without prematurely committing to a platform-specific native stack.
- Native Metal/CUDA optimization should arrive only after playback architecture and effect graph contracts stabilize.

## 3. Module Breakdown

### Media Pool

- Responsibilities: import assets, inspect source metadata, track project-local references, expose clips for timeline insertion
- Data flow: file dialog -> FFprobe ingest -> media asset model -> renderer media list -> timeline insertion
- Key challenges: reliable metadata extraction, relinking, proxy generation, media cache strategy

### Timeline Editor

- Responsibilities: sequence assembly, clip order, trim/cut/move operations, playhead and selection state
- Data flow: media pool asset -> timeline clip -> layout calculation -> viewer/playback/export
- Key challenges: non-destructive edits, multi-track layout, ripple/roll/slip operations, frame accuracy

### Playback Engine

- Responsibilities: preview timeline state, keep viewer in sync with playhead, manage clip boundary transitions
- Data flow: timeline layout -> active clip lookup -> viewer sync -> transport updates
- Key challenges: seamless clip transitions, A/V sync, dropped-frame handling, background caching

### Effects System

- Responsibilities: clip-level effects, future graph-based compositing, parameter automation
- Data flow: timeline clip/effect stack -> render graph -> playback/export
- Key challenges: deterministic evaluation order, GPU execution, serialization, plugin safety

### Color Grading System

- Responsibilities: node-based corrections, LUT management, scopes, color-managed pipeline
- Data flow: decoded frame -> color pipeline -> viewer/export
- Key challenges: color science accuracy, GPU throughput, scene-referred workflows, scope rendering

### Audio System

- Responsibilities: clip audio presence, future multi-track mixing, metering, automation
- Data flow: source audio -> timeline alignment -> monitoring/export mixdown
- Key challenges: sample-accurate sync, resampling, routing, effects latency compensation

### Export / Render System

- Responsibilities: encode timelines to deliverables, monitor render jobs, manage presets
- Data flow: sequence + assets -> render graph/FFmpeg command -> file output
- Key challenges: codec presets, mixed-source normalization, progress reporting, failure recovery

## 4. MVP Plan

### Phase 1 Scope

- Import local video files into a media bin
- Preview imported/timeline media in a central viewer
- Build a basic single-track timeline
- Perform cut, trim, reorder/move, and play/pause
- Export the assembled timeline to MP4 using FFmpeg

### Explicit Non-Goals For Phase 1

- Multi-track editing
- Real-time effects graph
- Advanced color tools
- Audio mixing console
- Collaborative project syncing

### Delivery Phases

1. Foundation
   - Desktop shell, IPC bridge, shared domain models, media probing
2. Editorial MVP
   - Media pool, viewer, timeline store, cut/trim/move, transport controls
3. Render MVP
   - Save dialog, FFmpeg export graph, environment status and error handling
4. Stabilization
   - Type checks, export validation, project save/load, regression tests

## 5. Code Implementation (Phase 1)

### Project Structure

```text
.
├── electron
│   ├── ffmpeg.ts
│   ├── main.ts
│   └── preload.ts
├── src
│   ├── renderer
│   │   ├── components
│   │   ├── hooks
│   │   ├── store
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── styles.css
│   └── shared
│       ├── models.ts
│       └── timeline.ts
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts
```

### How Phase 1 Works

- Imported media is probed in Electron and returned to the renderer as structured assets.
- The renderer manages an editor store with a single sequence and a single video track.
- Timeline layout is derived from clip trims instead of hard-coding positions.
- The viewer plays the current active clip and keeps the global playhead synced to timeline time.
- Export builds an FFmpeg filter graph from timeline trims and concatenates the result into an MP4.

## 6. Future Roadmap

### Phase 2

- Multi-track timeline with linked audio/video items
- Better scrubbing and clip boundary preloading
- Project persistence and relinking

### Phase 3

- Node-based compositing graph with reusable effect nodes
- Real-time GPU effects evaluation
- Effect/plugin SDK contract

### Phase 4

- Color page with scopes, LUTs, printer-light style controls, and color-managed pipeline
- Dedicated audio page with buses, automation, and monitoring

### Phase 5

- Background render queue
- Shared project database
- Multi-user collaboration and review workflows

## Running Locally

1. Install dependencies with `npm install`
2. Start the desktop app with `npm run dev`

If FFmpeg binaries are not available through `ffmpeg-static`, set `FFMPEG_PATH` and `FFPROBE_PATH` before launching the app.
# 264-pro-video-editor
