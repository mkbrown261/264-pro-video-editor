import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import pkg from "electron-updater";
const { autoUpdater } = pkg;
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import type { ExportRequest } from "../src/shared/models.js";
import {
  exportSequence,
  generateProxiesInBackground,
  getEnvironmentStatus,
  killAllActiveProcesses,
  probeMediaFiles
} from "./ffmpeg.js";

// ── FlowState Integration Constants ──────────────────────────────────────────
const DEV_BYPASS_KEY  = 'DEV-FS264-MKBROWN-2026-BYPASS';
const FS_BASE_URL     = 'https://flowstate-67g.pages.dev';
const FS_VERIFY_URL   = `${FS_BASE_URL}/api/264pro/verify-token`;
const LS_TOKEN_KEY    = 'fs_link_token';
const LS_USER_KEY     = 'fs_user';

// In-memory state for the current auth flow
let pendingAuthState: string | null = null;
let gateWindow: BrowserWindow | null = null;

// ── Close-confirmation state (module-scoped so the IPC handler can set it) ───
let mainWindow: BrowserWindow | null = null;
let closeConfirmedGlobal = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VIDEO_FILE_EXTENSIONS = [
  "mp4",
  "mov",
  "m4v",
  "mkv",
  "avi",
  "webm",
  "mxf",
  "mts",
  "m2ts",
  "ts",
  "mpg",
  "mpeg",
  "wmv",
  "3gp",
  "flv"
];
const MEDIA_CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mxf": "application/mxf",
  ".ts": "video/mp2t",
  ".m2ts": "video/mp2t",
  ".mts": "video/mp2t",
  ".mpg": "video/mpeg",
  ".mpeg": "video/mpeg",
  ".wmv": "video/x-ms-wmv",
  ".3gp": "video/3gpp",
  ".flv": "video/x-flv",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png"
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: "media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
]);

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// ── Branding: ensure app name shows everywhere (dock, taskbar, About dialog) ──
app.setName("264 Pro Video Editor");
// macOS About panel
if (process.platform === "darwin") {
  app.setAboutPanelOptions({
    applicationName: "264 Pro Video Editor",
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    credits: "© 2025 264 Pro. All rights reserved.",
    iconPath: join(app.getAppPath(), "build-assets/icon.png")
  });
}

function getContentType(sourcePath: string): string {
  return MEDIA_CONTENT_TYPES[extname(sourcePath).toLowerCase()] ?? "application/octet-stream";
}

function parseRangeHeader(
  rangeHeader: string | null,
  fileSize: number
): { start: number; end: number } | null {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());

  if (!match) {
    return null;
  }

  const [, startText, endText] = match;

  if (!startText && !endText) {
    return null;
  }

  let start = startText ? Number(startText) : 0;
  let end = endText ? Number(endText) : fileSize - 1;

  if (!startText && endText) {
    const suffixLength = Number(endText);

    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }

    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  start = Math.max(0, Math.floor(start));
  end = Math.min(fileSize - 1, Math.floor(end));

  if (start > end || start >= fileSize) {
    return null;
  }

  return {
    start,
    end
  };
}

async function createMediaResponse(request: Request): Promise<Response> {
  const requestedUrl = new URL(request.url);
  const sourcePath = requestedUrl.searchParams.get("path");

  if (!sourcePath) {
    return new Response("Missing media path.", {
      status: 400
    });
  }

  try {
    const fileStats = await stat(sourcePath);

    if (!fileStats.isFile()) {
      return new Response("Media source is unavailable.", {
        status: 404
      });
    }

    const range = parseRangeHeader(request.headers.get("range"), fileStats.size);
    const start = range?.start ?? 0;
    const end = range?.end ?? fileStats.size - 1;
    const stream = createReadStream(sourcePath, {
      start,
      end
    });
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Length": String(end - start + 1),
      "Content-Type": getContentType(sourcePath)
    });

    if (range) {
      headers.set("Content-Range", `bytes ${start}-${end}/${fileStats.size}`);
    }

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: range ? 206 : 200,
      headers
    });
  } catch {
    return new Response("Failed to open media source.", {
      status: 500
    });
  }
}

// ── Splash screen ─────────────────────────────────────────────────────────────

function createSplashWindow(): BrowserWindow {
  const splashPath = join(__dirname, "../../build-assets/splash.png");

  const splash = new BrowserWindow({
    width: 960,
    height: 540,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Build a minimal self-contained HTML splash page
  const splashHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:100%; height:100%; background:transparent; overflow:hidden; }
  .wrap {
    width:100%; height:100%;
    display:flex; flex-direction:column;
    align-items:center; justify-content:center;
    animation: fadeIn 0.45s ease forwards;
  }
  @keyframes fadeIn { from { opacity:0; transform:scale(0.97); } to { opacity:1; transform:scale(1); } }
  img {
    width:100%; height:100%;
    object-fit:cover;
    border-radius:12px;
    -webkit-user-drag:none;
    pointer-events:none;
  }
  .bar-wrap {
    position:absolute; bottom:28px; left:50%; transform:translateX(-50%);
    width:260px; display:flex; flex-direction:column; align-items:center; gap:8px;
  }
  .bar-track {
    width:100%; height:3px;
    background:rgba(255,255,255,0.18);
    border-radius:99px; overflow:hidden;
  }
  .bar-fill {
    height:100%; width:0%;
    background:linear-gradient(90deg,#e0a800,#ffcc40);
    border-radius:99px;
    animation: loadBar 1.8s cubic-bezier(0.4,0,0.2,1) forwards;
  }
  @keyframes loadBar {
    0%   { width:0%; }
    40%  { width:55%; }
    75%  { width:80%; }
    95%  { width:92%; }
    100% { width:100%; }
  }
  .tag {
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    font-size:11px; font-weight:500; letter-spacing:0.12em;
    color:rgba(255,255,255,0.5);
    text-transform:uppercase;
  }
</style>
</head>
<body>
<div class="wrap">
  <img src="file://${splashPath.replace(/\\/g, "/")}" alt="264 Pro Video Editor"/>
  <div class="bar-wrap">
    <div class="bar-track"><div class="bar-fill"></div></div>
    <span class="tag">Loading…</span>
  </div>
</div>
</body>
</html>`;

  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`);

  splash.once("ready-to-show", () => {
    splash.show();
  });

  return splash;
}

// ── Main window ───────────────────────────────────────────────────────────────

function createMainWindow(splashWindow: BrowserWindow | null): BrowserWindow {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: "#091017",
    title: "264 Pro Video Editor",
    icon: join(__dirname, "../../build-assets/icon.png"),
    show: false,          // hidden until splash dismisses
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadFile(join(__dirname, "../../dist/index.html"));
  }

  // Ensure title is set even after content loads (prevents Electron default title)
  window.webContents.on("did-finish-load", () => {
    window.setTitle("264 Pro Video Editor");
  });

  // ── Dismiss splash and reveal main window ─────────────────────────────────
  // Called when the renderer explicitly signals it's ready, OR automatically
  // after did-finish-load as a fallback (covers dev-server mode).
  let splashDismissed = false;

  function dismissSplash(delay = 0) {
    if (splashDismissed) return;
    splashDismissed = true;
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
      }
      if (!window.isDestroyed()) {
        window.show();
        window.focus();
      }
    }, delay);
  }

  // Renderer calls window.editorApi.notifyAppReady() once mounted
  ipcMain.once("app:renderer-ready", () => {
    // Short grace period so the first paint is complete
    dismissSplash(200);
  });

  // Fallback: dismiss 1.2s after DOM is loaded even if no IPC signal arrives
  window.webContents.once("did-finish-load", () => {
    setTimeout(() => dismissSplash(0), 1200);
  });

  // ── Close guard: ask renderer if there are unsaved changes ───────────────
  // closeConfirmedGlobal is module-scoped so the IPC handler can set it.
  closeConfirmedGlobal = false;
  mainWindow = window;
  window.on("close", (e) => {
    if (closeConfirmedGlobal) return;
    e.preventDefault();
    window.webContents.send("app:before-close");
  });

  window.on("closed", () => {
    mainWindow = null;
    closeConfirmedGlobal = false;
  });

  return window;
}

// ── FlowState Gate: verify token on launch ────────────────────────────────────
async function verifyStoredToken(token: string): Promise<{
  valid: boolean; user?: { name: string; email: string; picture: string }; tier?: string;
}> {
  try {
    const res = await fetch(FS_VERIFY_URL, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    return res.json() as any;
  } catch {
    return { valid: false };
  }
}

function createGateWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 600, height: 500,
    resizable: false, center: true,
    frame: false, transparent: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f1a',
    webPreferences: {
      preload:          join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
    title: '264 Pro — Sign In',
  });
  win.loadFile(join(__dirname, 'gate.html'));
  return win;
}

async function launchWithGate(): Promise<void> {
  // ── 264 Pro opens freely — no gate blocking startup ───────────────────
  // AI tools are gated at click-time inside the renderer via AuthGateModal.
  // Sign-in is prompted only when the user actually tries to use a paid tool.
  launchEditor();

  // Silently verify token in background — warms auth state for instant
  // response when user clicks an AI tool, no UI shown on failure.
  const tokenPath = join(app.getPath('userData'), 'fs_token.txt');
  try {
    const storedToken = (await readFile(tokenPath, 'utf8')).trim();
    if (storedToken && storedToken !== DEV_BYPASS_KEY) {
      const result = await verifyStoredToken(storedToken);
      if (!result.valid) {
        // Token expired — clear silently, renderer will handle prompt at tool-click
        await writeFile(tokenPath, '').catch(() => {});
      }
    }
  } catch { /* no stored token — fine, user will sign in when needed */ }
}

function launchEditor(): void {
  const splashWindow = createSplashWindow();
  const mainWindow   = createMainWindow(splashWindow);
  wireUpdaterToWindow(mainWindow);
}

// ── Auto-updater ──────────────────────────────────────────────────────────────
// initAutoUpdater() runs immediately from app.whenReady() — it starts silently
// checking for updates right away, before the gate or editor opens.
// wireUpdaterToWindow() is called once the editor window exists so IPC events
// can be forwarded to the renderer.
//
// This ensures:
//  1. Updates are checked even if the gate is showing (old installs without a
//     token will still get notified and can update to the gated version).
//  2. The "checking-for-update" / "update-available" etc. events are always
//     forwarded to whichever BrowserWindow is the main editor window.

let pendingUpdaterStatus: object | null = null;  // buffer events before window exists

function initAutoUpdater(): void {
  if (process.env.VITE_DEV_SERVER_URL) return; // skip in dev

  // ── ASK before downloading — user controls when updates happen ──────────
  autoUpdater.autoDownload = false;       // we'll prompt first
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null; // suppress console noise in prod

  function broadcast(payload: object) {
    pendingUpdaterStatus = payload;
    // Send to every open window (gate + editor)
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send("updater:status", payload);
    });
  }

  autoUpdater.on("checking-for-update", () =>
    broadcast({ state: "checking" }));

  // ── "Update available" — ask the user before downloading ────────────────
  autoUpdater.on("update-available", async (info) => {
    broadcast({ state: "available", version: info.version });

    // Find the most appropriate window to show the dialog on
    const targetWin = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!targetWin || targetWin.isDestroyed()) {
      // No window yet — auto-download silently so it's ready when they open
      void autoUpdater.downloadUpdate();
      return;
    }

    const { response } = await dialog.showMessageBox(targetWin, {
      type: "info",
      title: "264 Pro Update Available",
      message: `v${info.version} is available`,
      detail: `A new version of 264 Pro is ready to download.\n\nWhat's new in v${info.version}:\n• Bug fixes and performance improvements\n\nDownload size is small and the app will restart automatically when done.`,
      buttons: ["Download & Install", "Remind Me Later"],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) {
      broadcast({ state: "downloading", percent: 0 });
      void autoUpdater.downloadUpdate();
    } else {
      broadcast({ state: "up-to-date" }); // treat "later" as up-to-date for banner purposes
    }
  });

  autoUpdater.on("update-not-available", () =>
    broadcast({ state: "up-to-date" }));

  autoUpdater.on("download-progress", (progress) =>
    broadcast({
      state: "downloading",
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    }));

  autoUpdater.on("update-downloaded", async (info) => {
    broadcast({ state: "ready", version: info.version });
    // Show native dialog — update is ready, confirm restart
    const focusedWin = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!focusedWin || focusedWin.isDestroyed()) {
      // No window — install on next quit (already enabled via autoInstallOnAppQuit)
      return;
    }
    const { response } = await dialog.showMessageBox(focusedWin, {
      type: "info",
      title: "264 Pro Ready to Update",
      message: `v${info.version} downloaded and ready`,
      detail: "Restart 264 Pro now to apply the update. Your project will be saved automatically before restarting.",
      buttons: ["Restart & Install", "Install on Next Launch"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall(false, true);
  });

  autoUpdater.on("error", (err) =>
    broadcast({ state: "error", message: err.message }));

  // Check 5 s after launch, then every 2 h
  setTimeout(() => { void autoUpdater.checkForUpdates(); }, 5_000);
  setInterval(() => { void autoUpdater.checkForUpdates(); }, 2 * 60 * 60 * 1_000);
}

function wireUpdaterToWindow(mainWindow: BrowserWindow): void {
  // Replay any status that arrived before the window existed
  if (pendingUpdaterStatus) {
    mainWindow.webContents.send("updater:status", pendingUpdaterStatus);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(null);
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("system:environment", () => {
  return getEnvironmentStatus();
});

ipcMain.handle("media:open-files", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = win
    ? await dialog.showOpenDialog(win, {
        title: "Import Media",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Video Files",
            extensions: VIDEO_FILE_EXTENSIONS
          },
          {
            name: "All Files",
            extensions: ["*"]
          }
        ]
      })
    : await dialog.showOpenDialog({
        title: "Import Media",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Video Files",
            extensions: VIDEO_FILE_EXTENSIONS
          },
          {
            name: "All Files",
            extensions: ["*"]
          }
        ]
      });

  if (result.canceled || !result.filePaths.length) {
    return [];
  }

  // Fast probe: metadata + thumbnail only, returns immediately
  let assets;
  try {
    assets = await probeMediaFiles(result.filePaths);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: message };
  }

  // Kick off proxy generation in the background (non-blocking).
  // When each proxy is ready, notify the renderer to swap the previewUrl.
  void generateProxiesInBackground(assets, (assetId, previewUrl) => {
    const targetWin = BrowserWindow.fromWebContents(event.sender);
    if (targetWin && !targetWin.isDestroyed()) {
      targetWin.webContents.send("media:proxy-ready", { assetId, previewUrl });
    }
  });

  return assets;
});

// ── AI Tools: pick a single local media file ─────────────────────────────────
// Returns { filePath, mediaUrl } where mediaUrl is the media:// protocol URL
// the renderer can pass to the Replicate API via the FlowState backend proxy.
ipcMain.handle("ai:pick-media-file", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = win
    ? await dialog.showOpenDialog(win, {
        title: "Select Media for AI Tool",
        properties: ["openFile"],
        filters: [
          { name: "Video & Image Files", extensions: [...VIDEO_FILE_EXTENSIONS, "png", "jpg", "jpeg", "webp", "gif"] },
          { name: "All Files", extensions: ["*"] },
        ],
      })
    : await dialog.showOpenDialog({
        title: "Select Media for AI Tool",
        properties: ["openFile"],
        filters: [
          { name: "Video & Image Files", extensions: [...VIDEO_FILE_EXTENSIONS, "png", "jpg", "jpeg", "webp", "gif"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  // Return local path — renderer will convert to media:// URL
  return { filePath, name: basename(filePath) };
});

ipcMain.handle("export:choose-file", async (event, suggestedName: string) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const result = window
    ? await dialog.showSaveDialog(window, {
        title: "Export MP4",
        defaultPath: suggestedName.endsWith(".mp4")
          ? suggestedName
          : `${suggestedName}.mp4`,
        filters: [
          {
            name: "MP4 Video",
            extensions: ["mp4"]
          }
        ]
      })
    : await dialog.showSaveDialog({
        title: "Export MP4",
        defaultPath: suggestedName.endsWith(".mp4")
          ? suggestedName
          : `${suggestedName}.mp4`,
        filters: [
          {
            name: "MP4 Video",
            extensions: ["mp4"]
          }
        ]
      });

  return result.canceled ? null : result.filePath ?? null;
});

ipcMain.handle("export:render", async (event, request: ExportRequest) => {
  try {
    return exportSequence(request, (pct) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("export:progress", pct);
      }
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: message };
  }
});

// ── Project persistence (.264proj) ───────────────────────────────────────────

ipcMain.handle("project:save", async (event, json: string, suggestedName: string) => {
  try {
    const window = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = {
      title: "Save Project",
      defaultPath: suggestedName.endsWith(".264proj") ? suggestedName : `${suggestedName}.264proj`,
      filters: [
        { name: "264 Pro Project", extensions: ["264proj"] },
        { name: "All Files", extensions: ["*"] }
      ]
    };
    const result = window
      ? await dialog.showSaveDialog(window, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, json, "utf-8");
    return result.filePath;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: message };
  }
});

ipcMain.handle("project:open", async (event) => {
  try {
    const window = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = {
      title: "Open Project",
      properties: ["openFile"] as ("openFile" | "openDirectory" | "multiSelections")[],
      filters: [
        { name: "264 Pro Project", extensions: ["264proj"] },
        { name: "All Files", extensions: ["*"] }
      ]
    };
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || !result.filePaths[0]) return null;
    const json = await readFile(result.filePaths[0], "utf-8");
    return { json, filePath: result.filePaths[0] };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: message };
  }
});

ipcMain.handle("project:save-as", async (_event, json: string, filePath: string) => {
  try {
    await writeFile(filePath, json, "utf-8");
    return filePath;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: message };
  }
});

// ── App lifecycle IPC ─────────────────────────────────────────────────────────

// renderer calls this when user says "yes close" (Save or Don't Save)
// Uses the module-scoped closeConfirmedGlobal flag so the close guard
// in createMainWindow() sees it and lets the close through.
ipcMain.handle("app:confirm-close", () => {
  closeConfirmedGlobal = true;
  const win = mainWindow ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (win && !win.isDestroyed()) {
    win.close();
  }
});

ipcMain.handle("updater:install-now", () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle("app:open-external", (_event, url: string) => {
  void shell.openExternal(url);
});

// ── Gate / Auth IPC ───────────────────────────────────────────────────────────

ipcMain.handle("gate:get-version", () => app.getVersion());

ipcMain.handle("gate:open-external", (_event, url: string) => {
  void shell.openExternal(url);
});

// Kick off OAuth in system browser, register deep-link handler
ipcMain.handle("gate:start-auth", (_event, state: string) => {
  pendingAuthState = state;
  const authUrl = `${FS_BASE_URL}/api/264pro/auth?state=${encodeURIComponent(state)}&redirect=264pro://auth`;
  void shell.openExternal(authUrl);
});

// Dev bypass key submitted from gate
ipcMain.handle("gate:submit-dev-key", async (_event, key: string) => {
  if (key !== DEV_BYPASS_KEY) {
    return { success: false, error: 'Invalid key' };
  }
  const tokenPath = join(app.getPath('userData'), 'fs_token.txt');
  await writeFile(tokenPath, DEV_BYPASS_KEY, 'utf8');
  // Close gate and open editor
  if (gateWindow && !gateWindow.isDestroyed()) {
    gateWindow.close();
    gateWindow = null;
  }
  launchEditor();
  return { success: true };
});

// ── FlowState Panel IPC (called from renderer after editor is open) ───────────

ipcMain.handle("flowstate:get-token", async () => {
  const tokenPath = join(app.getPath('userData'), 'fs_token.txt');
  try { return (await readFile(tokenPath, 'utf8')).trim(); } catch { return null; }
});

ipcMain.handle("flowstate:get-user", async () => {
  const tokenPath = join(app.getPath('userData'), 'fs_token.txt');
  try {
    const token = (await readFile(tokenPath, 'utf8')).trim();
    if (!token || token === DEV_BYPASS_KEY) {
      return token === DEV_BYPASS_KEY
        ? { name: 'Dev User', email: 'dev@264pro.local', tier: 'team_growth', picture: '' }
        : null;
    }
    const res = await fetch(FS_VERIFY_URL, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json() as any;
    return data.valid ? { ...data.user, tier: data.tier } : null;
  } catch { return null; }
});

ipcMain.handle("flowstate:api-call", async (_event, path: string, method: string, body: unknown) => {
  const tokenPath = join(app.getPath('userData'), 'fs_token.txt');
  try {
    const token = (await readFile(tokenPath, 'utf8')).trim();
    const res = await fetch(`${FS_BASE_URL}${path}`, {
      method: method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
});

// ── AI Tool IPC — runs a 264 Pro AI tool via FlowState backend ────────────────
ipcMain.handle("flowstate:ai-tool", async (_event, tool: string, options: {
  imageUrl?: string;
  videoUrl?: string;
  params?: Record<string, unknown>;
}) => {
  const tokenPath = join(app.getPath('userData'), 'fs_token.txt');
  try {
    const token = (await readFile(tokenPath, 'utf8')).trim();
    const res = await fetch(`${FS_BASE_URL}/api/264pro/ai-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ tool, ...options }),
    });
    return res.json();
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
});

// ── Poll AI Tool prediction status ────────────────────────────────────────────
ipcMain.handle("flowstate:ai-tool-poll", async (_event, predictionId: string) => {
  const tokenPath = join(app.getPath('userData'), 'fs_token.txt');
  try {
    const token = (await readFile(tokenPath, 'utf8')).trim();
    const res = await fetch(`${FS_BASE_URL}/api/264pro/ai-tool/poll/${predictionId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    return res.json();
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
});

// ── AI Video Generation — Seedance 2.0 / Higgsfield / Nano Banana ─────────────
ipcMain.handle("flowstate:video-gen", async (_event, params: {
  model: string;
  prompt: string;
  imageUrl?: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  quality?: string;
  cameraMotion?: string;
  style?: string;
  negativePrompt?: string;
}) => {
  const tokenPath = join(app.getPath('userData'), 'fs_token.txt');
  try {
    const token = (await readFile(tokenPath, 'utf8')).trim();
    const res = await fetch(`${FS_BASE_URL}/api/264pro/video-gen`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });
    return res.json();
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
});

// ── Poll AI Video Generation status ───────────────────────────────────────────
ipcMain.handle("flowstate:video-gen-poll", async (_event, requestId: string, provider: string) => {
  const tokenPath = join(app.getPath('userData'), 'fs_token.txt');
  try {
    const token = (await readFile(tokenPath, 'utf8')).trim();
    const url = `${FS_BASE_URL}/api/264pro/video-gen/poll/${requestId}?provider=${encodeURIComponent(provider || 'fal')}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    return res.json();
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
});

// ── FlowState sign-out ────────────────────────────────────────────────────────
ipcMain.handle("flowstate:sign-out", async () => {
  const tokenPath = join(app.getPath('userData'), 'fs_token.txt');
  try {
    await writeFile(tokenPath, '', 'utf8');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

// ── R2 Cloud Storage IPC ──────────────────────────────────────────────────────
// Saves 264 Pro project files and AI exports to Cloudflare R2 via FlowState

async function get264Token(): Promise<string | null> {
  const tokenPath = join(app.getPath('userData'), 'fs_token.txt');
  try { return (await readFile(tokenPath, 'utf8')).trim() || null; } catch { return null; }
}

ipcMain.handle('cloud:save', async (_event, projectData: unknown) => {
  try {
    const token = await get264Token();
    if (!token) return { ok: false, error: 'Not authenticated' };

    const projectJson = JSON.stringify(projectData);
    const projectName = (projectData as any)?.name || 'Untitled Project';
    const filename = projectName.replace(/[^a-z0-9]/gi, '_') + '.264pro';

    // Use Node.js FormData + Blob for multipart upload
    const { FormData } = await import('node:form-data' as any).catch(() => ({ FormData: undefined }));
    // Fall back to flowstate:api-call pattern with JSON body if FormData unavailable
    const form = new (globalThis.FormData || FormData)();
    const blob = new Blob([Buffer.from(projectJson, 'utf8')], { type: 'application/json' });
    form.append('file', blob, filename);
    form.append('app', '264pro');

    const res = await fetch(`${FS_BASE_URL}/api/r2/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: form as any,
    });
    const data = await res.json() as any;
    return data.ok ? { ok: true, key: data.key, url: `${FS_BASE_URL}${data.url}` } : { ok: false, error: data.error || 'Upload failed' };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle('cloud:list', async () => {
  try {
    const token = await get264Token();
    if (!token) return { ok: false, error: 'Not authenticated', files: [] };
    const res = await fetch(`${FS_BASE_URL}/api/r2/list?app=264pro`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json() as any;
    return { ok: true, files: data.files ?? [] };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), files: [] };
  }
});

ipcMain.handle('cloud:load', async (_event, key: string) => {
  try {
    const token = await get264Token();
    if (!token) return { ok: false, error: 'Not authenticated' };
    const res = await fetch(`${FS_BASE_URL}/api/r2/file/${encodeURIComponent(key)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, error: `Download failed: ${res.status}` };
    const text = await res.text();
    return { ok: true, data: JSON.parse(text) };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle('cloud:delete', async (_event, key: string) => {
  try {
    const token = await get264Token();
    if (!token) return { ok: false, error: 'Not authenticated' };
    const res = await fetch(`${FS_BASE_URL}/api/r2/file/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json() as any;
    return { ok: data.ok };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

// ── Publish IPC handlers ───────────────────────────────────────────────────────
ipcMain.handle('publish:generate-metadata', async (_ev, info: { name: string; duration: number }) => {
  try {
    return { success: true, title: `${info.name} — You Won't Believe This 🎬`, description: `An amazing video: ${info.name}. Watch till the end!`, tags: ['vlog', 'video', 'content', 'creator'] };
  } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) }; }
});
ipcMain.handle('publish:upload-youtube', async () => {
  return { success: false, error: 'Connect your YouTube account in Settings → Publishing' };
});
ipcMain.handle('publish:upload-tiktok', async () => {
  return { success: false, error: 'Connect your TikTok account in Settings → Publishing' };
});

// ── Deep-link handler (264pro://auth?token=...&state=...) ─────────────────────
// Register custom protocol on macOS/Linux; on Windows use second-instance
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('264pro', process.execPath, [process.argv[1]]);
  }
} else {
  app.setAsDefaultProtocolClient('264pro');
}

// ── Phase 9: Publish IPC (stub — returns mock metadata) ──────────────────────
ipcMain.handle('publish:generate-metadata', async (_event, params: {
  projectName: string;
  durationSeconds: number;
  platforms: string[];
}) => {
  // Stub: generate mock metadata for the publish wizard
  const { projectName, durationSeconds, platforms } = params;
  const dur = Math.round(durationSeconds);
  return {
    title: `${projectName} — ${dur}s Edit`,
    description: `A ${dur}-second video project created with 264 Pro.\n\nEdited with ClawFlow Intelligence.\n\n#264Pro #VideoEditing`,
    tags: ['264pro', 'videoediting', 'clawflow', 'edit', projectName.toLowerCase().replace(/\s+/g, '')],
    platforms,
  };
});

ipcMain.handle('publish:upload-youtube', async (_event, _params: unknown) => {
  // Stub: connect to YouTube upload flow
  return { ok: false, error: 'YouTube upload requires OAuth setup. Connect your account in Settings.' };
});

ipcMain.handle('publish:upload-tiktok', async (_event, _params: unknown) => {
  // Stub: connect to TikTok upload flow
  return { ok: false, error: 'TikTok upload requires OAuth setup. Connect your account in Settings.' };
});

function handleDeepLink(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'auth') {
      const token = parsed.searchParams.get('token');
      const state = parsed.searchParams.get('state');
      if (!token || state !== pendingAuthState) {
        // Notify gate of failure
        if (gateWindow && !gateWindow.isDestroyed()) {
          gateWindow.webContents.send('gate:auth-result', false, 'State mismatch — please try again.');
        }
        return;
      }
      // Persist token
      const tokenPath = join(app.getPath('userData'), 'fs_token.txt');
      void writeFile(tokenPath, token, 'utf8').then(async () => {
        // Verify token once more
        const result = await verifyStoredToken(token);
        if (result.valid) {
          if (gateWindow && !gateWindow.isDestroyed()) {
            gateWindow.close();
            gateWindow = null;
          }
          launchEditor();
        } else {
          if (gateWindow && !gateWindow.isDestroyed()) {
            gateWindow.webContents.send('gate:auth-result', false, 'Token rejected by FlowState.');
          }
        }
      });
    }
  } catch {
    // ignore malformed URLs
  }
}

// macOS: open-url event
app.on('open-url', (_event, url) => {
  handleDeepLink(url);
});

// Windows/Linux: second-instance argv
app.on('second-instance', (_event, argv) => {
  const url = argv.find(a => a.startsWith('264pro://'));
  if (url) handleDeepLink(url);
  // Focus gate or main window
  const wins = BrowserWindow.getAllWindows();
  if (wins[0]) { if (wins[0].isMinimized()) wins[0].restore(); wins[0].focus(); }
});

// ── Kill active FFmpeg processes on quit ──────────────────────────────────────
app.on("will-quit", () => {
  killAllActiveProcesses();
});

// ── Entry point ───────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Register media:// protocol handler
  protocol.handle("media", createMediaResponse);

  // Start auto-updater immediately — before gate or editor opens.
  // This means even users stuck on the gate screen get notified of updates.
  initAutoUpdater();

  void launchWithGate();
});
