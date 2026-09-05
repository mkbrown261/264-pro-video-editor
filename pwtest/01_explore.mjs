import { launch, store, snapshotClips, shot, asset, FPS } from "./harness.mjs";

const { browser, page, logs } = await launch();

await store(page, (s, api, a) => {
  s.importAssets([a.red, a.blue, a.green]);
  // first import auto-places red; append blue after it
  api.getState().appendAssetToTimeline("blue");
}, { red: asset("red", "red.webm"), blue: asset("blue", "blue.webm"), green: asset("green", "green.webm") });

await page.waitForTimeout(800);
console.log("AFTER IMPORT:", JSON.stringify(await snapshotClips(page), null, 1));
await shot(page, "01_imported");

// Describe the viewer DOM
const dom = await page.evaluate(() => {
  const vids = [...document.querySelectorAll("video")].map((v) => ({
    cls: v.className, src: v.currentSrc?.split("/").pop(), t: v.currentTime, paused: v.paused,
    display: getComputedStyle(v).display, vis: getComputedStyle(v).visibility, op: getComputedStyle(v).opacity,
    w: v.getBoundingClientRect().width,
  }));
  const canvases = [...document.querySelectorAll("canvas")].map((c) => ({ cls: c.className, w: c.width, h: c.height, display: getComputedStyle(c).display }));
  return { vids, canvases };
});
console.log("VIEWER DOM:", JSON.stringify(dom, null, 1));

// Apply crossDissolve out on red (clip 1) — same way the UI does it via TransitionsPanel
const clipIds = (await snapshotClips(page)).clips.map((c) => c.id);
await store(page, (s, api, a) => {
  api.getState().selectClip(a.red);
  api.getState().setSelectedClipTransitionType("out", "crossDissolve");
  api.getState().setSelectedClipTransitionDuration("out", 30);
}, { red: clipIds[0] });
await page.waitForTimeout(300);
console.log("AFTER TRANSITION APPLY:", JSON.stringify(await snapshotClips(page), null, 1));

// Scrub across the seam (red ends at frame 120; 30f transition → 90..120)
for (const f of [80, 95, 105, 112, 118, 119, 120, 121, 125]) {
  await store(page, (s, api, a) => api.getState().setPlayheadFrame(a), f);
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const v = document.querySelector("video.viewer-video");
    const wrap = document.querySelector(".viewer-video-wrapper");
    const ov = document.querySelector(".viewer-transition-overlay");
    const cv = document.querySelector(".viewer-webgl-canvas");
    const cs = (el) => el ? { op: getComputedStyle(el).opacity, clip: getComputedStyle(el).clipPath, tf: getComputedStyle(el).transform, filter: getComputedStyle(el).filter, bg: getComputedStyle(el).backgroundColor, display: getComputedStyle(el).display, vis: getComputedStyle(el).visibility } : null;
    return { src: v?.currentSrc?.split("/").pop(), t: v?.currentTime?.toFixed(3), video: cs(v), wrap: cs(wrap), overlay: cs(ov), canvas: cs(cv) };
  });
  console.log(`FRAME ${f}:`, JSON.stringify(info));
  await shot(page, `01_xdissolve_f${f}`);
}

console.log("LOGS:", logs.slice(0, 20));
await browser.close();
