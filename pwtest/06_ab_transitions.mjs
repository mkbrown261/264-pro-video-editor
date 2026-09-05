// A/B transition pixel test.
// Timeline: red (0-120) | blue (120-240) | green (240-360) at 30 fps.
// For each transition type applied on the red|blue cut (30 frames, centred:
// frames 105..134), sample the viewer's mean colour at several frames while
// PAUSED (scrubbing) and assert:
//   • before the window: pure red;  after: pure blue
//   • at the cut frame (progress≈0.5) the picture is a real A/B mix — for
//     dissolves both red and blue channels are present; for wipes/pushes the
//     left half and right half differ.
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

async function stageBox() {
  return page.evaluate(() => {
    const r = document.querySelector(".viewer-stage").getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}
function mean(file, crop = "") {
  return execSync(`convert ${file} ${crop} -resize 10% -format "%[fx:int(255*mean.r)] %[fx:int(255*mean.g)] %[fx:int(255*mean.b)]" info:`)
    .toString().trim().split(" ").map(Number);
}
async function sample(name, frame) {
  await store(page, (s, api, f) => api.getState().setPlayheadFrame(f), frame);
  // wait for both slots to settle (seek + paint)
  await page.waitForFunction(() => {
    const vids = [...document.querySelectorAll("video.viewer-video")];
    return vids.every((v) => !v.seeking && v.style.visibility !== "hidden");
  }, null, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(250);
  const box = await stageBox();
  const p = `shots/06_${name}_${frame}.png`;
  await page.screenshot({ path: p, clip: box });
  // the video is letterboxed inside the stage — measure the central band only
  const w = Math.round(box.width), h = Math.round(box.height);
  const inner = `-gravity center -crop ${Math.round(w * 0.6)}x${Math.round(h * 0.4)}+0+0 +repage`;
  const left = `-crop ${Math.round(w * 0.25)}x${Math.round(h * 0.3)}+${Math.round(w * 0.15)}+${Math.round(h * 0.35)} +repage`;
  const right = `-crop ${Math.round(w * 0.25)}x${Math.round(h * 0.3)}+${Math.round(w * 0.60)}+${Math.round(h * 0.35)} +repage`;
  // WebGL path introspection: is the canvas shown, and does it have non-black content?
  const gl = await page.evaluate(() => {
    const c = document.querySelector(".viewer-webgl-canvas");
    if (!c) return "nocanvas";
    const shown = getComputedStyle(c).display !== "none";
    if (!shown) return "css";
    // When the GL canvas is active both <video> layers are hidden (opacity 0), so
    // any colour in the screenshot can only have come from the shader output.
    // (The drawing buffer is not preserved after compositing, so a drawImage
    // read-back would always be black — the screenshot is the reliable probe.)
    const vids = [...document.querySelectorAll("video.viewer-video")].map((v) => getComputedStyle(v.parentElement).opacity);
    return `canvas:${c.width}x${c.height}:layers=${vids.join("/")}`;
  });
  return { all: mean(p, inner), left: mean(p, left), right: mean(p, right), gl };
}
// Measured test media (after VP9 encode + swiftshader): red ≈ (254,51,52), blue ≈ (55,84,253).
const isRed = ([r, g, b]) => r > 150 && g < 110 && b < 110;
const isBlue = ([r, g, b]) => b > 150 && r < 110 && g < 110;
const isMix = ([r, g, b]) => r > 40 && b > 40 && Math.abs(r - b) < 120 && g < 110;
const fmt = (c) => `(${c.join(",")})`;

const results = [];
async function runType(type, check) {
  await store(page, (s, api, a) => {
    api.getState().selectClip(a.id);
    api.getState().setSelectedClipTransitionType("out", a.t);
    api.getState().setSelectedClipTransitionDuration("out", 30);
  }, { id: redId, t: type });
  const snap = await snapshotClips(page);
  const red = snap.clips.find((c) => c.asset === "red"), blue = snap.clips.find((c) => c.asset === "blue");
  const before = await sample(type, 100);
  const mid = await sample(type, 119);   // progress = (119-105+1)/31 ≈ 0.48
  const after = await sample(type, 140);
  const ok = isRed(before.all) && isBlue(after.all) && check(mid);
  results.push({ type, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${type.padEnd(16)} tOut=${red.tOut} tIn(blue)=${blue.tIn}  f100=${fmt(before.all)} f119=${fmt(mid.all)} L=${fmt(mid.left)} R=${fmt(mid.right)} f140=${fmt(after.all)}${mid.gl ? `  gl=${mid.gl}` : ""}`);
}

// Dissolve family → blend everywhere
for (const t of ["crossDissolve", "fade", "filmDissolve", "blurDissolve"]) await runType(t, (m) => isMix(m.all));
// Wipe left: A (red) removed from the left → left is blue, right is red at mid
await runType("wipeLeft", (m) => isBlue(m.left) && isRed(m.right));
// Wipe right: A removed from the right → left red, right blue
await runType("wipeRight", (m) => isRed(m.left) && isBlue(m.right));
// Push left: A slides out left, B comes in from right → left red, right blue
await runType("pushLeft", (m) => isRed(m.left) && isBlue(m.right));
// Iris: B grows from centre → centre blue, but corners still red: the inner band
// is 60%x40% so it should read mostly blue with red edges → mix or blue
await runType("irisCircle", (m) => isBlue(m.all) || isMix(m.all));
// Dip to black → dark at mid
await runType("dipBlack", (m) => m.all[0] < 60 && m.all[2] < 60);
// WebGL types — real A/B textures now
for (const t of ["pixelate", "ripple", "zoomCross", "glitch", "luminanceDissolve"])
  await runType(t, (m) => (isMix(m.all) || (m.all[0] > 40 && m.all[2] > 40)) && /^canvas:\d+x\d+:layers=0\/0$/.test(m.gl));

// Sanity: no per-clip double application — blue must NOT carry its own transitionIn
const snap = await snapshotClips(page);
console.log("blue.tIn =", snap.clips.find((c) => c.asset === "blue").tIn, "(expected null under junction model)");

const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} transition types render a real A/B blend at the cut`);
if (logs.length) console.log("console:", logs.slice(0, 10).join("\n"));
await browser.close();
process.exit(fails.length ? 1 : 0);
