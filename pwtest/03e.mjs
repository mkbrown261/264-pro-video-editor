import { chromium } from "playwright";
import { asset, BASE } from "./harness.mjs";
for (const mode of ["shell", "new"]) {
  const browser = await chromium.launch({ headless: true, channel: mode === "new" ? "chromium" : undefined, args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--ignore-gpu-blocklist"] }).catch(e => (console.log(mode, "launch failed", e.message.split("\n")[0]), null));
  if (!browser) continue;
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  await page.setContent(`<body style="margin:0;background:#000"><video id=v src="${BASE}test-media/red.webm" muted style="width:400px;height:225px;opacity:0.1"></video></body>`);
  await page.waitForFunction(() => document.getElementById("v").readyState >= 2);
  await page.evaluate(() => { document.getElementById("v").currentTime = 1; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `shots/03e_${mode}.png` });
  await browser.close();
}
