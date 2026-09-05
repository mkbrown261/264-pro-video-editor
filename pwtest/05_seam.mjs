// Seamless playback across cuts.
// Timeline: red (0-120) | blue (120-240) | green (240-360) @ 30 fps.
// Scenario A: plain cut at 120.  Scenario B: 30-frame crossDissolve on the red|blue cut.
// While PLAYING from frame 100 we sample, every animation frame, the visible
// (primary) slot's state and the playhead; we also take periodic screenshots
// of the stage to check what is actually on screen.  Assertions:
//   • the playhead never stalls for more than ~6 RAF ticks (≈100 ms) around the cut
//   • the visible slot is never hidden / never shows a black frame during the cut
//   • after the cut the screen shows blue (and blends during the dissolve)
import { launch, store, snapshotClips, asset } from "./harness.mjs";
import { execSync } from "node:child_process";

const { browser, page, logs } = await launch();
await store(page, (s, api, a) => {
  s.importAssets([a.red, a.blue, a.green]);
  api.getState().appendAssetToTimeline("blue");
  api.getState().appendAssetToTimeline("green");
}, { red: asset("red", "red.webm"), blue: asset("blue", "blue.webm"), green: asset("green", "green.webm") });
await page.waitForTimeout(500);
const clips = (await snapshotClips(page)).clips;
const redId = clips.find((c) => c.asset === "red").id;

function mean(file, crop = "") {
  return execSync(`convert ${file} ${crop} -resize 10% -format "%[fx:int(255*mean.r)] %[fx:int(255*mean.g)] %[fx:int(255*mean.b)]" info:`)
    .toString().trim().split(" ").map(Number);
}
async function stageBox() {
  return page.evaluate(() => { const r = document.querySelector(".viewer-stage").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
}
const isRed = ([r, g, b]) => r > 150 && g < 110 && b < 110;
const isBlue = ([r, g, b]) => b > 150 && r < 110 && g < 110;
const isBlack = ([r, g, b]) => r + g + b < 30;

async function scenario(name, setup) {
  await setup();
  await store(page, (s, api) => api.getState().setPlayheadFrame(100));
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    window.__samples = [];
    const tick = () => {
      const st = window.__editorStore.getState();
      const prim = document.querySelector('.viewer-video-wrapper[data-role="primary"] video');
      const part = document.querySelector('.viewer-video-wrapper[data-role="partner"] video');
      const c = document.querySelector(".viewer-webgl-canvas");
      window.__samples.push({
        t: performance.now(), f: st.playback.playheadFrame, playing: st.playback.isPlaying,
        slot: prim?.parentElement.dataset.slot, src: prim?.currentSrc.split("/").pop()[0] ?? "-",
        ct: prim?.currentTime ?? -1, vis: prim?.style.visibility || "visible", rs: prim?.readyState ?? -1, paused: prim?.paused ?? true,
        pop: prim ? getComputedStyle(prim.parentElement).opacity : "-",
        psrc: part?.currentSrc.split("/").pop()[0] ?? "-", ppaused: part?.paused ?? true, gl: c ? getComputedStyle(c).display !== "none" : false
      });
      if (window.__samples.length < 900) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.keyboard.press("Space");
  // screenshot burst across the cut (frames ~100..150 ≈ 0..1.7 s)
  const box = await stageBox();
  const shots = [];
  const tStart = Date.now();
  for (let i = 0; i < 14; i++) {
    const p = `shots/05_${name}_${i}.png`;
    await page.screenshot({ path: p, clip: box });
    const f = await page.evaluate(() => window.__editorStore.getState().playback.playheadFrame);
    shots.push({ i, ms: Date.now() - tStart, f, c: mean(p, `-gravity center -crop ${Math.round(box.width * 0.6)}x${Math.round(box.height * 0.4)}+0+0 +repage`) });
  }
  await page.waitForTimeout(400);
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  const samples = await page.evaluate(() => window.__samples);

  const t0 = samples[0].t;
  const events = []; let prev = null;
  for (const s of samples) {
    if (!prev || s.src !== prev.src || s.vis !== prev.vis || s.paused !== prev.paused || s.slot !== prev.slot || s.gl !== prev.gl || s.pop !== prev.pop)
      events.push(`${(s.t - t0).toFixed(0).padStart(5)}ms f=${String(s.f).padStart(3)} slot=${s.slot} src=${s.src} ct=${s.ct.toFixed(2)} vis=${s.vis} op=${s.pop} rs=${s.rs} ${s.paused ? "PAUSED" : "playing"} gl=${s.gl} partner=${s.psrc}${s.ppaused ? "(paused)" : "(playing)"}`);
    prev = s;
  }
  console.log(`\n=== ${name} ===`);
  console.log(events.join("\n"));
  // stalls while the store says playing
  let stalls = [], run = 0, lastF = -1, worst = 0;
  for (const s of samples) {
    if (!s.playing) { run = 0; lastF = -1; continue; }
    if (s.f === lastF) { run++; worst = Math.max(worst, run); } else { if (run >= 6) stalls.push(`frame ${lastF} held ${run} ticks`); run = 0; lastF = s.f; }
  }
  const hiddenWhilePlaying = samples.filter((s) => s.playing && (s.vis === "hidden" || s.pop === "0" || s.rs < 2)).length;
  console.log("SHOTS:", shots.map((s) => `f${s.f}=(${s.c.join(",")})`).join(" "));
  console.log("STALLS(>=6 ticks):", stalls.join("; ") || "none", `| worst hold=${worst} ticks`);
  console.log("hidden/black-ready frames while playing:", hiddenWhilePlaying);
  const blackShots = shots.filter((s) => isBlack(s.c));
  const sawRedBefore = shots.some((s) => s.f < 105 && isRed(s.c));
  const sawBlueAfter = shots.some((s) => s.f >= 136 && isBlue(s.c));
  const ok = blackShots.length === 0 && worst < 6 && hiddenWhilePlaying === 0 && sawRedBefore && sawBlueAfter;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: black=${blackShots.length} worstHold=${worst} hidden=${hiddenWhilePlaying} redBefore=${sawRedBefore} blueAfter=${sawBlueAfter}`);
  return ok;
}

const okCut = await scenario("plainCut", async () => {
  await store(page, (s, api, id) => { api.getState().selectClip(id); api.getState().setSelectedClipTransitionType("out", "cut"); }, redId);
});
const okXfade = await scenario("crossDissolve", async () => {
  await store(page, (s, api, id) => { api.getState().selectClip(id); api.getState().setSelectedClipTransitionType("out", "crossDissolve"); api.getState().setSelectedClipTransitionDuration("out", 30); }, redId);
});
const okWipe = await scenario("wipeLeft", async () => {
  await store(page, (s, api, id) => { api.getState().selectClip(id); api.getState().setSelectedClipTransitionType("out", "wipeLeft"); api.getState().setSelectedClipTransitionDuration("out", 30); }, redId);
});
const errs = logs.filter((l) => l.startsWith("[error]"));
if (errs.length) console.log("ERRORS:", errs.slice(0, 5).join("\n"));
await browser.close();
process.exit(okCut && okXfade && okWipe && errs.length === 0 ? 0 : 1);
