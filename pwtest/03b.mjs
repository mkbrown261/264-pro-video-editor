import { launch, store, snapshotClips, asset } from "./harness.mjs";
const { browser, page } = await launch();
await store(page, (s, api, a) => { s.importAssets([a.red, a.blue]); api.getState().appendAssetToTimeline("blue"); }, { red: asset("red","red.webm"), blue: asset("blue","blue.webm") });
await page.waitForTimeout(400);
const snap = await snapshotClips(page);
const res = await page.evaluate((id) => {
  const el = document.querySelector(`[data-clip-id="${id}"]`);
  const r = el.getBoundingClientRect();
  const stack = (x, y) => document.elementsFromPoint(x, y).slice(0, 5).map(e => { const cs = getComputedStyle(e); return `${e.className || e.tagName}[z=${cs.zIndex},pe=${cs.pointerEvents}]`; });
  const kids = [...el.children].map(k => { const kr = k.getBoundingClientRect(); const cs = getComputedStyle(k); return `${k.className}: x=${(kr.left - r.left).toFixed(0)} w=${kr.width.toFixed(0)} h=${kr.height.toFixed(0)} z=${cs.zIndex} pe=${cs.pointerEvents} disp=${cs.display}`; });
  return { left3: stack(r.left + 3, r.top + r.height/2), right3: stack(r.right - 3, r.top + r.height/2), kids };
}, snap.clips[0].id);
console.log(JSON.stringify(res, null, 1));
await browser.close();
