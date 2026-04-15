/**
 * scripts/rename-electron-mac.mjs
 * Runs after npm install on Mac — renames the Electron binary and .app bundle
 * to "264 Pro" so the dock shows the correct name and icon.
 * No-op on Windows/Linux.
 */
import { existsSync, renameSync, readdirSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "node_modules", "electron", "dist");
const APP_NAME = "264 Pro";

// Find existing .app (could be Electron.app or already renamed)
const existing = existsSync(join(DIST, "Electron.app"))
  ? "Electron.app"
  : existsSync(join(DIST, `${APP_NAME}.app`))
  ? `${APP_NAME}.app`
  : null;

if (!existing) { console.log("[rename-electron] No .app found in dist/ — skipping"); process.exit(0); }

const appPath = join(DIST, existing);
const newAppPath = join(DIST, `${APP_NAME}.app`);
const macosDir = join(appPath, "Contents", "MacOS");

// Rename binary inside MacOS/
try {
  const bins = readdirSync(macosDir);
  for (const bin of bins) {
    if (bin !== APP_NAME) {
      renameSync(join(macosDir, bin), join(macosDir, APP_NAME));
      console.log(`[rename-electron] Renamed binary: ${bin} → ${APP_NAME}`);
    }
  }
} catch (e) { console.error("[rename-electron] Binary rename failed:", e.message); }

// Rename .app bundle
if (existing !== `${APP_NAME}.app`) {
  try {
    renameSync(appPath, newAppPath);
    console.log(`[rename-electron] Renamed bundle: ${existing} → ${APP_NAME}.app`);
  } catch (e) { console.error("[rename-electron] Bundle rename failed:", e.message); }
}

// Update Info.plist
const plist = join(newAppPath, "Contents", "Info.plist");
try {
  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleName '${APP_NAME}'" "${plist}"`);
  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName '${APP_NAME}'" "${plist}"`);
  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable '${APP_NAME}'" "${plist}"`);
  console.log("[rename-electron] Updated Info.plist");
} catch (e) { console.error("[rename-electron] Plist update failed:", e.message); }

// Replace electron.icns with our icon
const icnsTarget = join(newAppPath, "Contents", "Resources", "electron.icns");
const iconSrc = join(ROOT, "build-assets", "icon.png");
if (existsSync(iconSrc)) {
  try {
    // Build iconset using sips + iconutil
    execSync(`mkdir -p /tmp/264pro.iconset`);
    const sizes = [[16,16],[32,32,"@2x"],[32,32],[64,64,"@2x"],[128,128],[256,256,"@2x"],[256,256],[512,512,"@2x"],[512,512]];
    for (const [w, h, suffix] of sizes) {
      const name = suffix === "@2x"
        ? `icon_${w/2}x${h/2}@2x.png`
        : `icon_${w}x${h}.png`;
      execSync(`sips -z ${h} ${w} "${iconSrc}" --out /tmp/264pro.iconset/${name} 2>/dev/null`);
    }
    execSync(`cp "${iconSrc}" /tmp/264pro.iconset/icon_512x512@2x.png`);
    execSync(`iconutil -c icns /tmp/264pro.iconset -o "${icnsTarget}"`);
    console.log("[rename-electron] Replaced electron.icns with 264 Pro icon");
  } catch (e) { console.error("[rename-electron] Icon replacement failed:", e.message); }
}

// Clear dock cache
try {
  execSync(`rm -rf ~/Library/Application\\ Support/com.apple.dock.iconcache`);
  execSync(`killall Dock`);
  console.log("[rename-electron] Cleared dock cache");
} catch { /* non-critical */ }

console.log("[rename-electron] Done — 264 Pro is ready");
