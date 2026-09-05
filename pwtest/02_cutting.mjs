import { launch, store, snapshotClips, shot, asset } from "./harness.mjs";

const { browser, page, logs } = await launch();
const A = { red: asset("red", "red.webm"), blue: asset("blue", "blue.webm"), green: asset("green", "green.webm") };
await store(page, (s, api, a) => { s.importAssets([a.red, a.blue, a.green]); api.getState().appendAssetToTimeline("blue"); api.getState().appendAssetToTimeline("green"); }, A);
await page.waitForTimeout(500);

const brief = (snap) => snap.clips.filter((c) => true).map((c) => `${c.asset}@${c.start}[${c.trimS},${c.trimE}]${c.track.slice(0, 4)}`).join("  ");
console.log("START:", brief(await snapshotClips(page)));

// ── 1. Split via the store API at frame 60 (mid-red) ─────────────────────────
let snap = await snapshotClips(page);
const redV = snap.clips.find((c) => c.asset === "red");
await store(page, (s, api, a) => { api.getState().setPlayheadFrame(60); api.getState().selectClip(a); api.getState().splitSelectedClipAtPlayhead(); }, redV.id);
await page.waitForTimeout(300);
snap = await snapshotClips(page);
console.log("SPLIT@60:", brief(snap), "| selected:", snap.selected?.slice(0, 4));
await shot(page, "02_split60");

// ── 2. Blade tool: click on timeline clip via the real UI ────────────────────
await store(page, (s, api) => api.getState().setToolMode("blade"));
await page.waitForTimeout(200);
// Find blue clip element in the timeline
const clipEls = await page.$$(".timeline-clip, [data-clip-id]");
console.log("clip elements:", clipEls.length);
const blueEl = await page.evaluateHandle(() => {
  const els = [...document.querySelectorAll("[data-clip-id], .timeline-clip")];
  return els.find((e) => e.textContent?.includes("blue.webm") && e.getBoundingClientRect().top < 870) ?? null;
});
const box = await blueEl.asElement()?.boundingBox();
console.log("blue box:", box);
if (box) {
  // click at 25% into the blue clip -> expect split at frame 120 + 30 = 150
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
  await page.waitForTimeout(400);
  snap = await snapshotClips(page);
  console.log("BLADE 25% blue:", brief(snap), "| playhead:", snap.playhead);
  await shot(page, "02_blade_blue");
}
await store(page, (s, api) => api.getState().setToolMode("select"));

// ── 3. Trim: drag the right edge of the first (red) clip left by ~1 second ────
snap = await snapshotClips(page);
const first = snap.clips.filter((c) => c.asset === "red").sort((a, b) => a.start - b.start)[0];
const firstEl = await page.evaluateHandle((id) => document.querySelector(`[data-clip-id="${id}"]`), first.id);
let fbox = await firstEl.asElement()?.boundingBox();
console.log("first red box:", fbox);
if (fbox) {
  const ppf = fbox.width / 60; // 60 frames wide
  const x0 = fbox.x + fbox.width - 3;
  const y = fbox.y + fbox.height / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.mouse.move(x0 - ppf * 15, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  snap = await snapshotClips(page);
  console.log("TRIM END -15f:", brief(snap));
  await shot(page, "02_trim_end");
}

// ── 4. Delete the 2nd clip (magnetic on) -> expect ripple close ──────────────
snap = await snapshotClips(page);
const second = snap.clips.filter((c) => c.track === snap.clips[0].track).sort((a, b) => a.start - b.start)[1];
await store(page, (s, api, id) => api.getState().removeClipById(id), second.id);
await page.waitForTimeout(300);
snap = await snapshotClips(page);
console.log("DELETE 2nd (magnetic):", brief(snap), "| magnetic:", snap.magnetic);
await shot(page, "02_delete");

// ── 5. Undo twice ─────────────────────────────────────────────────────────────
await store(page, (s, api) => { api.getState().undo(); });
await page.waitForTimeout(200);
console.log("UNDO x1:", brief(await snapshotClips(page)));

// ── 6. Playback across a cut: check whether video src / time track correctly ──
await store(page, (s, api) => { api.getState().setPlayheadFrame(40); });
await page.waitForTimeout(400);
await page.keyboard.press("Space");
const samples = [];
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(250);
  samples.push(await page.evaluate(() => {
    const v = document.querySelector("video.viewer-video");
    const st = window.__editorStore.getState();
    return `${st.playback.playheadFrame}:${v?.currentSrc?.split("/").pop()?.[0]}${v?.currentTime.toFixed(2)}${v?.paused ? "P" : ""}`;
  }));
}
await page.keyboard.press("Space");
console.log("PLAYBACK samples (frame:srcInitial+time):", samples.join(" "));
await shot(page, "02_after_play");

console.log("ERRORS:", logs.filter((l) => !l.includes("WebGL") && !l.includes("GL Driver")).slice(0, 10));
await browser.close();
