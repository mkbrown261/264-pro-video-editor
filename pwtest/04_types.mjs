import { launch, store, snapshotClips, asset } from "./harness.mjs";
import { execSync } from "node:child_process";
const { browser, page } = await launch();
await store(page, (s, api, a) => { s.importAssets([a.red, a.blue]); api.getState().appendAssetToTimeline("blue"); }, { red: asset("red","red.webm"), blue: asset("blue","blue.webm") });
await page.waitForTimeout(400);
const id = (await snapshotClips(page)).clips[0].id;
const types = ["wipeLeft", "pushLeft", "dipBlack", "zoomIn", "irisCircle", "glitch", "whiteFlash"];
for (const t of types) {
  await store(page, (s, api, a) => { api.getState().selectClip(a.id); api.getState().setSelectedClipTransitionType("out", a.t); api.getState().setSelectedClipTransitionDuration("out", 30); }, { id, t });
  const row = [];
  for (const f of [96, 105, 114, 119, 120, 122]) {
    await store(page, (s, api, f) => api.getState().setPlayheadFrame(f), f);
    await page.waitForTimeout(350);
    const box = await page.evaluate(() => { const r = document.querySelector(".viewer-stage").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const p = `shots/04_${t}_${f}.png`;
    await page.screenshot({ path: p, clip: box });
    const c = execSync(`convert ${p} -resize 10% -format "%[fx:int(255*mean.r)],%[fx:int(255*mean.g)],%[fx:int(255*mean.b)]" info:`).toString();
    row.push(`f${f}=(${c})`);
  }
  console.log(t.padEnd(12), row.join(" "));
}
await browser.close();
