import { launch, store, snapshotClips, asset } from "./harness.mjs";
const { browser, page } = await launch();
await store(page, (s, api, a) => { s.importAssets([a.red]); }, { red: asset("red","red.webm") });
await page.waitForTimeout(400);
const snap = await snapshotClips(page);
const res = await page.evaluate((id) => {
  const el = document.querySelector(`[data-clip-id="${id}"]`);
  const h = el.querySelector(".timeline-clip-handle.end");
  const cs = getComputedStyle(h);
  const rules = [];
  for (const sheet of document.styleSheets) { try { for (const r of sheet.cssRules) { if (r.selectorText && h.matches(r.selectorText) && /position|top|bottom|height|display/.test(r.cssText)) rules.push(r.cssText.slice(0, 200)); } } catch {} }
  return { pos: cs.position, top: cs.top, bottom: cs.bottom, height: cs.height, display: cs.display, rules };
}, snap.clips[0].id);
console.log(JSON.stringify(res, null, 1));
await browser.close();
