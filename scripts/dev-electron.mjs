/**
 * scripts/dev-electron.mjs
 *
 * Watches dist-electron/ for changes produced by `tsc --watch` and
 * (re)starts Electron with the VITE_DEV_SERVER_URL env var set so the
 * main window loads from the Vite dev server instead of the built HTML.
 *
 * Usage (called by `npm run dev:electron`):
 *   node scripts/dev-electron.mjs
 *
 * It waits until both dist-electron/electron/main.js AND
 * dist-electron/electron/preload.cjs exist before first launch, then
 * restarts Electron automatically whenever either file is updated.
 *
 * The Vite dev server URL is passed via VITE_DEV_SERVER_URL so main.ts
 * knows to call window.loadURL(...) instead of window.loadFile(...).
 */

import { spawn } from "node:child_process";
import { watch, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WATCH_DIR = join(ROOT, "dist-electron");
const MAIN_JS = join(ROOT, "dist-electron", "electron", "main.js");
const PRELOAD_CJS = join(ROOT, "dist-electron", "electron", "preload.cjs");
const VITE_URL = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";

// ── helpers ────────────────────────────────────────────────────────────────

/** Resolve the `electron` binary from node_modules. */
function electronBin() {
  try {
    const { createRequire } = await import("node:module"); // dynamic to silence lint
    // Use the standard way to locate the electron binary
    const electronPath = join(ROOT, "node_modules", "electron", "index.js");
    if (existsSync(electronPath)) {
      // Read the path file that electron package provides
      const { readFileSync } = await import("node:fs");
      const pathFile = join(ROOT, "node_modules", "electron", "path.txt");
      if (existsSync(pathFile)) {
        const bin = readFileSync(pathFile, "utf8").trim();
        return join(ROOT, "node_modules", "electron", "dist", bin);
      }
    }
  } catch { /* fallback below */ }
  return "electron"; // hope it's on PATH
}

let electronProcess = null;
let restartTimeout = null;
let starting = false;

async function getElectronBin() {
  // The electron npm package includes a path.txt next to its index.js
  const pathTxt = join(ROOT, "node_modules", "electron", "path.txt");
  if (existsSync(pathTxt)) {
    const { readFileSync } = await import("node:fs");
    const rel = readFileSync(pathTxt, "utf8").trim();
    // path.txt contains e.g. "dist/Electron.app/Contents/MacOS/Electron"
    return join(ROOT, "node_modules", "electron", rel);
  }
  return "electron";
}

// ── process management ────────────────────────────────────────────────────

async function startElectron() {
  if (starting) return;
  if (!existsSync(MAIN_JS) || !existsSync(PRELOAD_CJS)) {
    console.log("[dev] Waiting for dist-electron/electron/main.js and preload.cjs …");
    return;
  }

  starting = true;
  if (electronProcess) {
    console.log("[dev] Restarting Electron …");
    electronProcess.kill("SIGTERM");
    electronProcess = null;
  } else {
    console.log("[dev] Starting Electron …");
  }

  const bin = await getElectronBin();
  electronProcess = spawn(bin, ["."], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: VITE_URL,
      ELECTRON_ENABLE_LOGGING: "1",
    },
  });

  electronProcess.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.log(`[dev] Electron exited with code ${code}`);
    }
    electronProcess = null;
    starting = false;
  });

  electronProcess.on("error", (err) => {
    console.error("[dev] Failed to start Electron:", err.message);
    electronProcess = null;
    starting = false;
  });

  starting = false;
}

function scheduleRestart() {
  if (restartTimeout) clearTimeout(restartTimeout);
  // Debounce: tsc emits multiple files in sequence; wait 400ms for the burst to settle
  restartTimeout = setTimeout(() => {
    restartTimeout = null;
    void startElectron();
  }, 400);
}

// ── file watching ─────────────────────────────────────────────────────────

function startWatching() {
  if (!existsSync(WATCH_DIR)) {
    // dist-electron doesn't exist yet — poll until it appears
    const poll = setInterval(() => {
      if (existsSync(MAIN_JS) && existsSync(PRELOAD_CJS)) {
        clearInterval(poll);
        console.log("[dev] dist-electron ready, launching Electron …");
        void startElectron();
        watchDistElectron();
      }
    }, 500);
    return;
  }
  void startElectron();
  watchDistElectron();
}

function watchDistElectron() {
  // Use Node's built-in fs.watch (recursive flag supported on macOS & Windows;
  // on Linux we watch individual files as a fallback).
  try {
    watch(WATCH_DIR, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      if (filename.endsWith(".js") || filename.endsWith(".cjs") || filename.endsWith(".mjs")) {
        console.log(`[dev] Changed: ${filename}`);
        scheduleRestart();
      }
    });
    console.log(`[dev] Watching ${WATCH_DIR} for changes …`);
  } catch {
    // Fallback: watch just main.js and preload.cjs directly
    for (const f of [MAIN_JS, PRELOAD_CJS]) {
      if (existsSync(f)) {
        watch(f, () => {
          console.log(`[dev] Changed: ${f}`);
          scheduleRestart();
        });
      }
    }
    console.log("[dev] Watching dist-electron/electron/main.js + preload.cjs …");
  }
}

// ── cleanup ───────────────────────────────────────────────────────────────

function shutdown() {
  if (electronProcess) {
    electronProcess.kill("SIGTERM");
    electronProcess = null;
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  if (electronProcess) electronProcess.kill("SIGTERM");
});

// ── entry point ───────────────────────────────────────────────────────────

console.log(`[dev] Electron watcher starting (Vite URL: ${VITE_URL})`);
startWatching();
