import { launch, store, snapshotClips, asset } from "./harness.mjs";
const { browser, page } = await launch();
await store(page, (s, api, a) => { s.importAssets([a.red, a.blue]); api.getState().appendAssetToTimeline("blue"); }, { red: asset("red","red.webm"), blue: asset("blue","blue.webm") });
await page.waitForTimeout(400);
const snap = await snapshotClips(page);
const red = snap.clips[0];
const res = await page.evaluate((id) => {
  const el = document.querySelector(`[data-clip-id="${id}"]`);
  const r = el.getBoundingClientRect();
  const probe = (x, y) => { const e = document.elementFromPoint(x, y); return `${e?.className}`.slice(0, 60); };
  const out = {};
  for (const dx of [1, 3, 5, 8, 12, 17, 22]) {
    out[`left+${dx}`] = probe(r.left + dx, r.top + r.height / 2);
    out[`right-${dx}`] = probe(r.right - dx, r.top + r.height / 2);
  }
  out.topRight = probe(r.right - 3, r.top + 4);
  out.bottomRight = probe(r.right - 3, r.bottom - 4);
  return out;
}, red.id);
console.log(JSON.stringify(res, null, 1));
await browser.close();
