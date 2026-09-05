import { launch, store, asset, snapshotClips } from "./harness.mjs";
const { browser, page } = await launch();
await store(page, (s, api, a) => { s.importAssets([a.red, a.blue]); api.getState().appendAssetToTimeline("blue"); }, { red: asset("red","red.webm"), blue: asset("blue","blue.webm") });
await page.waitForTimeout(400);
const id = (await snapshotClips(page)).clips[0].id;
await store(page, (s, api, a) => { api.getState().selectClip(a); api.getState().setSelectedClipTransitionType("out", "crossDissolve"); api.getState().setSelectedClipTransitionDuration("out", 30); api.getState().setPlayheadFrame(118); }, id);
await page.waitForTimeout(600);
const res = await page.evaluate(() => {
  const wrap = document.querySelector(".viewer-video-wrapper").getBoundingClientRect();
  const x = wrap.left + wrap.width/2, y = wrap.top + wrap.height/2;
  return document.elementsFromPoint(x, y).slice(0, 8).map(e => { const cs = getComputedStyle(e); return `${(e.className||e.tagName).toString().slice(0,40)} z=${cs.zIndex} op=${cs.opacity} bg=${cs.backgroundColor} disp=${cs.display}`; });
});
console.log(res.join("\n"));
const vid = await page.evaluate(() => { const v = document.querySelector("video.viewer-video"); return { style: v.getAttribute("style"), parentStyle: v.parentElement.getAttribute("style") }; });
console.log(vid);
await browser.close();
