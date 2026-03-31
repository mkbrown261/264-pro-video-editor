/**
 * scripts/dev-electron.mjs
 * Watches dist-electron/ for changes from tsc --watch and restarts Electron.
 */
import { spawn } from "node:child_process";
import { watch, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WATCH_DIR = join(ROOT, "dist-electron");
const MAIN_JS = join(ROOT, "dist-electron", "electron", "main.js");
const PRELOAD_CJS = join(ROOT, "dist-electron", "electron", "preload.cjs");
const VITE_URL = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";

// Use the same resolution logic as the official electron package
function getElectronBin() {
  try {
    const require = createRequire(import.meta.url);
    return require("electron");
  } catch {
    // fallback
    const pathTxt = join(ROOT, "node_modules", "electron", "path.txt");
    if (existsSync(pathTxt)) {
      const rel = readFileSync(pathTxt, "utf8").trim();
      return join(ROOT, "node_modules", "electron", "dist", rel);
    }
    return "electron";
  }
}

let electronProcess = null;
let restartTimeout = null;

function startElectron() {
  if (!existsSync(MAIN_JS) || !existsSync(PRELOAD_CJS)) {
    console.log("[dev] Waiting for dist-electron/electron/main.js and preload.cjs ...");
    return;
  }
  if (electronProcess) {
    console.log("[dev] Restarting Electron ...");
    electronProcess.kill("SIGTERM");
    electronProcess = null;
  } else {
    console.log("[dev] Starting Electron ...");
  }
  const bin = getElectronBin();
  console.log("[dev] Electron binary:", bin);
  electronProcess = spawn(bin, ["."], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, VITE_DEV_SERVER_URL: VITE_URL, ELECTRON_ENABLE_LOGGING: "1" },
  });
  electronProcess.on("exit", (code) => {
    if (code !== null && code !== 0) console.log(`[dev] Electron exited with code ${code}`);
    electronProcess = null;
  });
  electronProcess.on("error", (err) => {
    console.error("[dev] Failed to start Electron:", err.message);
    console.error("[dev] Binary path was:", bin);
    electronProcess = null;
  });
}

function scheduleRestart() {
  if (restartTimeout) clearTimeout(restartTimeout);
  restartTimeout = setTimeout(() => { restartTimeout = null; startElectron(); }, 400);
}

function watchDistElectron() {
  try {
    watch(WATCH_DIR, { recursive: true }, (_event, filename) => {
      if (filename && (filename.endsWith(".js") || filename.endsWith(".cjs"))) {
        console.log(`[dev] Changed: ${filename}`);
        scheduleRestart();
      }
    });
    console.log(`[dev] Watching ${WATCH_DIR} for changes ...`);
  } catch {
    for (const f of [MAIN_JS, PRELOAD_CJS]) {
      if (existsSync(f)) watch(f, () => scheduleRestart());
    }
  }
}

function startWatching() {
  if (!existsSync(MAIN_JS) || !existsSync(PRELOAD_CJS)) {
    console.log("[dev] Waiting for initial compile ...");
    const poll = setInterval(() => {
      if (existsSync(MAIN_JS) && existsSync(PRELOAD_CJS)) {
        clearInterval(poll);
        startElectron();
        watchDistElectron();
      }
    }, 500);
    return;
  }
  startElectron();
  watchDistElectron();
}

function shutdown() {
  if (electronProcess) { electronProcess.kill("SIGTERM"); electronProcess = null; }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => { if (electronProcess) electronProcess.kill("SIGTERM"); });

console.log(`[dev] Electron watcher starting (Vite URL: ${VITE_URL})`);
startWatching();
