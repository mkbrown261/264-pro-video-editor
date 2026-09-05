// Shared Playwright harness for driving the 264 Pro renderer in a real browser.
// Runs against `npx vite` on :5173 (no Electron). The Zustand store is exposed on
// window.__editorStore by src/renderer/store/editorStore.ts in dev builds.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

export const BASE = process.env.BASE_URL ?? "http://localhost:5173/";
export const OUT = new URL("./shots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

export const FPS = 30;

export function asset(id, file, seconds = 4) {
  return {
    id,
    name: `${id}.webm`,
    sourcePath: `/fake/${file}`,
    previewUrl: `${BASE}test-media/${file}`,
    thumbnailUrl: null,
    durationSeconds: seconds,
    nativeFps: FPS,
    width: 640,
    height: 360,
    hasAudio: true,
  };
}

export async function launch({ headless = true } = {}) {
  const browser = await chromium.launch({
    headless,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--use-gl=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const logs = [];
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error" || t === "warning") logs.push(`[${t}] ${m.text()}`);
  });
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  // Skip all first-run modals.
  await page.addInitScript(() => {
    localStorage.setItem("264pro_onboarded", "1");
    localStorage.setItem("264pro_claw_video_seen", "1");
    localStorage.setItem("264pro_follow_modal_shown", "1");
    localStorage.setItem("264pro_claw_guide", "false");
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__editorStore, null, { timeout: 20000 });
  return { browser, page, logs };
}

/** Run fn(store, api) inside the page with the store's current state + actions. */
export async function store(page, fn, arg) {
  return page.evaluate(
    ([src, a]) => {
      const s = window.__editorStore;
      // eslint-disable-next-line no-new-func
      const f = new Function("state", "api", "arg", `return (${src})(state, api, arg);`);
      return f(s.getState(), s, a);
    },
    [fn.toString(), arg ?? null]
  );
}

export async function snapshotClips(page) {
  return store(page, (state) => {
    const seq = state.project.sequence;
    return {
      playhead: state.playheadFrame,
      selected: state.selectedClipIds ?? state.selectedClipId,
      tool: state.toolMode,
      magnetic: state.magneticTimeline,
      clips: seq.clips.map((c) => ({
        id: c.id,
        track: c.trackId,
        asset: c.assetId,
        start: c.startFrame,
        trimS: c.trimStartFrames,
        trimE: c.trimEndFrames,
        speed: c.speed,
        tIn: c.transitionIn ? `${c.transitionIn.type}/${c.transitionIn.durationFrames}` : null,
        tOut: c.transitionOut ? `${c.transitionOut.type}/${c.transitionOut.durationFrames}` : null,
        link: c.linkedGroupId,
      })),
    };
  });
}

export async function shot(page, name) {
  const p = `${OUT}${name}.png`;
  await page.screenshot({ path: p });
  return p;
}

/** Average color of the rendered viewer area (what the user actually sees). */
export async function viewerColor(page) {
  return page.evaluate(async () => {
    const wrap = document.querySelector(".viewer-video-wrapper") ?? document.querySelector(".viewer-video");
    if (!wrap) return null;
    const r = wrap.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

export function avgColorFromPng(buf, region) {
  // lightweight PNG decode via sharp-less approach isn't available; use playwright clip instead
  return null;
}

export async function viewerPixels(page) {
  const box = await viewerColor(page);
  if (!box) return null;
  const buf = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  return { box, buf };
}
