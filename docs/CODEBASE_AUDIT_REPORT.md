# 264 Pro — Codebase Audit Report
_Generated: 2026-05-14 | Audited against: messages.txt MASTER AI CODEBASE VALIDATION PROMPT_

---

## CRITICAL FINDINGS

### C1 — `shell.openExternal` called with unvalidated renderer-supplied URL
**File:** `electron/main.ts` lines 792–794, 800–802
**Code:**
```typescript
ipcMain.handle("app:open-external", (_event, url: string) => {
  void shell.openExternal(url);  // NO URL VALIDATION
});
ipcMain.handle("gate:open-external", (_event, url: string) => {
  void shell.openExternal(url);  // NO URL VALIDATION
});
```
**Risk:** Any code running in the renderer (including injected scripts via XSS or compromised dependencies) can call `shell.openExternal` with `file://`, `javascript:`, or a malicious deep link. This is a well-known Electron attack vector.
**Fix:**
```typescript
const ALLOWED_PROTOCOLS = ['https:', 'http:'];
ipcMain.handle("app:open-external", (_event, url: string) => {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) return;
    void shell.openExternal(url);
  } catch { /* invalid URL — ignore */ }
});
```
**Severity: CRITICAL**

---

### C2 — DEV_BYPASS_KEY hardcoded in compiled binary
**File:** `electron/main.ts` line 27
```typescript
const DEV_BYPASS_KEY = 'DEV-FS264-MKBROWN-2026-BYPASS';
```
This key bypasses the entire auth gate. It's compiled into the production binary and will be trivially extractable via `strings` on the .app bundle. Anyone can extract this key and unlock the paid app for free.
**Fix:** Remove from production build via `#ifdef`/env variable. In production (`IS_PACKAGED=true`), DEV_BYPASS_KEY should be `null` and the code path should be dead.
**Severity: CRITICAL**

---

### C3 — `flowstate:api-call` IPC: renderer can call ANY FlowState API endpoint
**File:** `electron/main.ts` lines 852–868
```typescript
ipcMain.handle("flowstate:api-call", async (_event, path: string, method: string, body: unknown) => {
  const res = await fetch(`${FS_BASE_URL}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, body });
```
The `path` parameter is renderer-supplied with no allowlist. A compromised renderer or malicious plugin could call `/api/admin/add-credits`, `/api/admin/user-tier`, or any authenticated FlowState endpoint including destructive admin operations.
**Fix:** Implement a strict allowlist of permitted paths/methods in the main process. Never accept arbitrary path strings from the renderer.
**Severity: CRITICAL**

---

## HIGH FINDINGS

### H1 — Color node graph is cosmetic (nodes don't chain grade operations)
**File:** `src/renderer/components/ColorGradingPanel.tsx`
The color grading uses `colorGradeRenderer.ts` (real WebGL) for primary/secondary operations, but the "node graph" UI in the Color page applies a flat grade to the whole clip — nodes don't execute in sequence. The node graph is a visual metaphor, not a functional pipeline.
**Impact:** When users connect a Corrector node → Color Wheel node → Effect node expecting the grade to accumulate through the chain, nothing changes. This will cause immediate credibility loss with any experienced colorist.
**Fix:** Wire the node graph — each node stores a delta grade; render sequentially by traversing the graph edges, accumulating transforms into the final shader uniforms. The WebGL infrastructure is already present.
**Severity: HIGH**

---

### H2 — No roll/ripple trim tools
**File:** `src/renderer/components/TimelinePanel.tsx`, `src/renderer/components/PrecisionTrimPanel.tsx`
Only extend-trim (drag clip end/start) is implemented. Roll trim (move edit point, both clips adjust), ripple trim (one clip adjusts, downstream shifts), and slip/slide are absent.
**Impact:** Any editor who's used any NLE will notice immediately. This is a baseline professional operation.
**Fix:** Add modifier key detection in trim drag handlers: Alt = ripple, Shift+Alt = roll. These share the existing drag infrastructure.
**Severity: HIGH**

---

### H3 — No per-track EQ/compressor/LUFS metering in AudioMixerPanel
**File:** `src/renderer/components/AudioMixerPanel.tsx` (referenced), `src/renderer/components/ClawSoundPanel.tsx`
Audio mixer has faders, mute, solo, VU metering but zero frequency/dynamics processing per track. No LUFS loudness normalization.
**Impact:** Every creator uploading to YouTube needs -14 LUFS normalization. Without EQ, vocal tracks from talking-head videos will sound muddy. This is table stakes.
**Fix:** Per-track Web Audio API chain: `GainNode → BiquadFilterNode (3-band EQ) → DynamicsCompressorNode`. LUFS: use OfflineAudioContext + integrate RMS to compute loudness, then apply a normalizing gain. Add "YouTube normalize" button in render settings that calls FFmpeg `loudnorm` filter.
**Severity: HIGH**

---

### H4 — Missing voice isolation / background noise removal
Not present anywhere in `AIToolsPanel.tsx` or ffmpeg.ts. DaVinci Resolve has this. Every interview/talking-head video creator needs this.
**Fix:** FFmpeg `arnndn` filter (RNNoise model) or call an AI API (ElevenLabs, Dolby.io) for higher quality.
**Severity: HIGH**

---

### H5 — No input validation on `proxy:generate`, `ai:transcribe`, `render-cache:render-segment` IPC handlers
**File:** `electron/main.ts` lines 1287, 1457, 1884
All three accept renderer-supplied file paths that are passed directly to FFmpeg `spawn`. No path sanitization, no verification the file is within expected directories.
**Impact:** Path traversal — a compromised renderer could read/write arbitrary files by crafting a path like `../../Library/Keychains/...`.
**Fix:** Validate all file paths using `path.resolve()` and confirm they're under expected directories (app data, project dir, temp). Reject any path that resolves outside.
**Severity: HIGH**

---

### H6 — `App.tsx` is a 4,348-line god component
**File:** `src/renderer/App.tsx`
Nearly half the app logic lives in one file. State management, routing, modal logic, panel rendering, keyboard shortcuts, auth, and UI event handlers are all entangled. No separation of concerns.
**Impact:** Any change to auth breaks color grading. Any UI refactor risks breaking keyboard shortcuts. Impossible to test individual concerns. Maintenance time scales exponentially.
**Fix (incremental):** Extract auth logic to `src/renderer/auth/` module, modal system to `src/renderer/modals/` module, keyboard shortcut definitions to `src/renderer/shortcuts/` module. Don't rewrite all at once — carve out bounded contexts one sprint at a time.
**Severity: HIGH**

---

## MEDIUM FINDINGS

### M1 — TypeScript `any` used in 8+ critical store locations
**File:** `src/renderer/store/editorStore.ts`
```typescript
// 8 occurrences of `: any` or `as any`
```
Unsafe casts propagate silent runtime errors — a malformed project JSON will crash the entire store with no type-safe recovery path.
**Fix:** Define proper discriminated union types for all store slices. Use `zod` schemas for project deserialization with `.safeParse()`.
**Severity: MEDIUM**

---

### M2 — No media bin folders / organization in MediaPool
Current MediaPool is a flat list. All clips, audio, and assets share a single level. On any real project (50+ clips), this becomes unusable.
**Fix:** Add `bins: Bin[]` to project model. Render as collapsible folder tree. Drag-to-bin. Estimated: 2-3 days.
**Severity: MEDIUM**

---

### M3 — No scene cut detection on import
DaVinci auto-detects cuts in long source clips. Useful for B-roll, stock footage, and screen recordings.
**Fix:** FFmpeg `select='gt(scene,0.4)'` filter on import. Auto-split into subclips. Flag threshold in preferences.
**Severity: MEDIUM**

---

### M4 — CompRenderer WebGL context not disposed on component unmount
**File:** `src/renderer/lib/CompRenderer.ts`
The `CompRenderer` class has `dispose()` methods for textures and FBOs (10 calls found), but it's unclear if `destroy()` is called when the FusionPage unmounts.
**Fix:** Verify the `CompRenderer` instance is destroyed in the `useEffect` cleanup in `NodeCanvas.tsx`. Add `gl.getExtension('WEBGL_lose_context')?.loseContext()` in dispose.
**Severity: MEDIUM**

---

### M5 — Hardcoded `FS_BASE_URL` in production binary
**File:** `electron/main.ts` line 28
```typescript
const FS_BASE_URL = 'https://flowstate-67g.pages.dev';
```
This is a pages.dev preview URL, not the canonical `flowst8.cc` domain. Any future Cloudflare migration, domain change, or CDN restructure requires a binary rebuild and re-release. Also exposes the internal project structure.
**Fix:** Read from `process.env.FS_BASE_URL` with a production default of `https://flowst8.cc`. Override in dev via `.env.development`.
**Severity: MEDIUM**

---

### M6 — Grade versioning not implemented per-clip
DaVinci lets you store A/B grade versions per clip. Currently only one grade state exists per clip in the store. No version toggle.
**Fix:** Add `gradeVersions: ColorGrade[]` and `activeGradeVersion: number` to the clip model. Add A/B toggle button in ColorGradingPanel.
**Severity: MEDIUM**

---

### M7 — No burn-in overlays (watermark / timecode)
Frequently requested. DaVinci has it. No implementation present in `electron/ffmpeg.ts` render pipeline.
**Fix:** Add optional `burnIn: { watermark?: string; timecode?: boolean; position?: string }` to `ExportRequest`. Prepend FFmpeg `drawtext` and `movie` filter args to the output chain.
**Severity: MEDIUM**

---

### M8 — Subtitle burn-in pipeline incomplete
SRT import exists. Subtitle style presets exist. But no evidence of FFmpeg subtitle burn-in (`-vf subtitles=`) being wired into the render pipeline for hard-coded subs.
**Severity: MEDIUM**

---

## LOW FINDINGS

### L1 — `console.log` / `console.error` in 6+ renderer locations
Leaves debug output in production. No structured logging system.
**Fix:** Use a centralized logger that's silenced in production builds via `IS_PACKAGED`.

### L2 — No Vimeo upload support
Competitor gap. YouTube and TikTok covered; Vimeo is the filmmaker/agency segment.
**Fix:** Vimeo API v3 — standard OAuth2 + chunked upload endpoint. ~1-2 days.

### L3 — Missing log color controls (S-Log2, C-Log3, Log-C)
Mirrorless cameras (Sony, Canon, Fuji, ARRI) shoot log footage. Without log controls, footage imported log looks flat and washed out with no way to transform it.
**Fix:** Add a "Log Transform" node/panel: input space (S-Log2/3, C-Log, C-Log3, Log-C, BMD Film) → REC.709 LUT transform. FFmpeg `lut3d` or custom WebGL transform.

### L4 — No real-time monitoring or error reporting in production
No Sentry, no crash reporting, no telemetry. When the app crashes in production, there's no signal.
**Fix:** Add Sentry Electron SDK. One-time setup, immediately actionable crash reports.

### L5 — Missing magnetic timeline / auto-ripple on delete
Deleting a clip in the middle of the timeline leaves a gap. No option to ripple-delete.
**Fix:** Add `Shift+Delete` as ripple-delete shortcut. Shift downstream clips left by the deleted clip's duration.

---

## AI HALLUCINATION INDICATORS

✅ **None found.** 

The codebase is genuine:
- `colorGradeRenderer.ts` has real GLSL shaders with documented bug fixes
- `CompRenderer.ts` has 17 compiled WebGL shader programs (chromakey, glow, blur, film grain, etc.)
- `ffmpeg.ts` uses real `spawn()` with proper arg construction
- `usePlaybackController.ts` uses proper `cancelAnimationFrame` cleanup
- All imports reference real, installed packages
- No placeholder `// TODO: implement` in critical paths
- IPC handlers actually do what they claim

The code was clearly written with real engineering intent, not generated blindly.

---

## SUMMARY TABLE

| Finding | File | Severity | Fix Effort |
|---|---|---|---|
| shell.openExternal — no URL allowlist | electron/main.ts:792-802 | CRITICAL | 1 hour |
| DEV_BYPASS_KEY in production binary | electron/main.ts:27 | CRITICAL | 2 hours |
| flowstate:api-call — open API proxy | electron/main.ts:852-868 | CRITICAL | 1 day |
| Color node graph is cosmetic | ColorGradingPanel.tsx | HIGH | 1 week |
| No roll/ripple trim | TimelinePanel.tsx | HIGH | 3 days |
| No per-track EQ/compressor/LUFS | AudioMixerPanel | HIGH | 1 week |
| No voice isolation | (missing feature) | HIGH | 2-3 days |
| Missing file path validation on IPC | electron/main.ts:1287,1457,1884 | HIGH | 1 day |
| App.tsx god component (4,348 lines) | App.tsx | HIGH | Ongoing |
| TypeScript `any` overuse in store | editorStore.ts | MEDIUM | 2 days |
| No media bin folders | MediaPool | MEDIUM | 2-3 days |
| No scene cut detection | (missing feature) | MEDIUM | 1 day |
| CompRenderer not disposed on unmount | CompRenderer.ts | MEDIUM | 2 hours |
| FS_BASE_URL hardcoded to pages.dev | electron/main.ts:28 | MEDIUM | 1 hour |
| No grade versioning per clip | (missing feature) | MEDIUM | 2 days |
| No burn-in overlays | ffmpeg.ts | MEDIUM | 1 day |
| Subtitle burn-in incomplete | ffmpeg.ts | MEDIUM | 1 day |
| No Vimeo upload | (missing feature) | LOW | 1-2 days |
| No log color controls | ColorGradingPanel | LOW | 3 days |
| No crash reporting/Sentry | (missing infra) | LOW | 2 hours |
| No ripple-delete shortcut | TimelinePanel | LOW | 2 hours |

---

## PRIORITY FIX ORDER

**This week (security):**
1. Fix `shell.openExternal` URL allowlist — 1 hour
2. Strip `DEV_BYPASS_KEY` from production build — 2 hours
3. Allowlist `flowstate:api-call` paths — 1 day
4. Validate file paths on IPC handlers — 1 day
5. Fix `FS_BASE_URL` to use `flowst8.cc` — 1 hour

**Next sprint (product):**
6. Wire color node graph execution
7. Per-track EQ + compressor + LUFS meter
8. Roll/ripple trim modifier keys
9. Burn-in watermark/timecode in export
10. Media bin folders

**Following sprint:**
11. Voice isolation (FFmpeg arnndn or AI API)
12. Scene cut detection on import
13. Grade versioning per clip (A/B toggle)
14. Vimeo upload
15. Sentry crash reporting
