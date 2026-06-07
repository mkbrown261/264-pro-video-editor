/**
 * scripts/fix-electron-binary.mjs
 * One-shot repair script: finds and fixes any Electron binary whose name
 * has stray whitespace/newline characters (e.g. "264 Pro\n" instead of "264 Pro").
 * Also re-runs the rename logic to ensure everything is correct.
 *
 * Run once from your project root:
 *   node scripts/fix-electron-binary.mjs
 */
import { existsSync, renameSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "node_modules", "electron", "dist");
const APP_NAME = "264 Pro";

if (!existsSync(DIST)) {
  console.error("[fix] node_modules/electron/dist not found. Run npm install first.");
  process.exit(1);
}

console.log("[fix] Scanning", DIST, "...");

// Step 1: Find the .app bundle (may be named anything including with trailing newline)
const distEntries = readdirSync(DIST);
console.log("[fix] dist/ entries:", distEntries.map(e => JSON.stringify(e)).join(", "));

let appBundle = null;
for (const entry of distEntries) {
  if (entry.trim().endsWith(".app")) {
    appBundle = entry;
    break;
  }
}

if (!appBundle) {
  console.error("[fix] No .app bundle found in dist/");
  process.exit(1);
}

console.log("[fix] Found .app bundle:", JSON.stringify(appBundle));

const appPath = join(DIST, appBundle);
const macosDir = join(appPath, "Contents", "MacOS");

if (!existsSync(macosDir)) {
  console.error("[fix] MacOS dir not found:", macosDir);
  process.exit(1);
}

// Step 2: Fix the binary name inside MacOS/
const bins = readdirSync(macosDir);
console.log("[fix] Binaries in MacOS/:", bins.map(b => JSON.stringify(b)).join(", "));

let fixed = false;
for (const bin of bins) {
  if (bin !== APP_NAME) {
    const cleanName = bin.trim();
    if (cleanName === APP_NAME) {
      // Binary has hidden whitespace — rename it to the clean name
      console.log(`[fix] Fixing binary with hidden whitespace: ${JSON.stringify(bin)} → "${APP_NAME}"`);
      renameSync(join(macosDir, bin), join(macosDir, APP_NAME));
      fixed = true;
    } else if (cleanName !== bin) {
      // Some other whitespace issue — clean it to APP_NAME anyway
      console.log(`[fix] Renaming "${cleanName}" → "${APP_NAME}"`);
      renameSync(join(macosDir, bin), join(macosDir, APP_NAME));
      fixed = true;
    } else {
      // Genuinely different name (e.g. still "Electron")
      console.log(`[fix] Renaming "${bin}" → "${APP_NAME}"`);
      renameSync(join(macosDir, bin), join(macosDir, APP_NAME));
      fixed = true;
    }
  } else {
    console.log(`[fix] Binary "${bin}" already has the correct name.`);
  }
}

// Step 3: Fix the .app bundle name if needed
const cleanAppBundle = appBundle.trim();
const expectedApp = `${APP_NAME}.app`;
if (cleanAppBundle !== expectedApp || appBundle !== cleanAppBundle) {
  const newAppPath = join(DIST, expectedApp);
  console.log(`[fix] Renaming .app bundle: ${JSON.stringify(appBundle)} → "${expectedApp}"`);
  renameSync(appPath, newAppPath);
  fixed = true;
} else {
  console.log(`[fix] .app bundle already has the correct name: "${appBundle}"`);
}

if (fixed) {
  console.log("\n[fix] ✅ Done! Binary paths have been repaired.");
  console.log("[fix] You can now run: npm run dev");
} else {
  console.log("\n[fix] ✅ Everything looks correct already — trying npm run dev should work.");
}

// Step 4: Verify
const finalBins = readdirSync(join(DIST, expectedApp, "Contents", "MacOS"));
console.log("[fix] Final MacOS/ contents:", finalBins.map(b => JSON.stringify(b)).join(", "));
