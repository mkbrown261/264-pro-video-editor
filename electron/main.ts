import { app, BrowserWindow, dialog, ipcMain, nativeImage, protocol, shell } from "electron";

// Set app name immediately — fixes dock tooltip showing "Electron" in dev mode
app.name = "264 Pro";
process.title = "264 Pro";
import pkg from "electron-updater";
const { autoUpdater } = pkg;
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import type { ExportRequest, MediaAsset } from "../src/shared/models.js";
import {
  detectBestHWEncoder,
  exportSequence,
  generateProxiesInBackground,
  getEnvironmentStatus,
  killAllActiveProcesses,
  probeMediaFiles
} from "./ffmpeg.js";

// In-memory token store (survives app session, cleared on quit)
const oauthTokens: Record<string, { accessToken: string; refreshToken?: string; expiresAt: number }> = {};

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

// ── Platform-aware icon resolution ───────────────────────────────────────────
// In dev: __dirname = dist-electron/electron/, so ../../build-assets/ = project root
// Icon path resolution:
// Use app.getAppPath() which always returns the project root in dev,
// and the app bundle root when packaged — no __dirname path gymnastics needed.
function getAppIcon(): string {
  if (app.isPackaged) {
    if (process.platform === "win32") return join(process.resourcesPath, "build-assets", "icon.ico");
    return join(process.resourcesPath, "build-assets", "icon.png");
  }
  // Dev mode: app.getAppPath() = project root on all platforms
  const base = join(app.getAppPath(), "build-assets");
  if (process.platform === "win32") return join(base, "icon.ico");
  return join(base, "icon.png");
}
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
    iconPath: join(app.getAppPath(), "build-assets/icon.png")  // .icns used automatically when packaged
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
    icon: getAppIcon(),
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
  let assets: MediaAsset[];
  try {
    assets = await probeMediaFiles(result.filePaths);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    // Show error to user instead of silently returning nothing
    dialog.showErrorBox("Import Failed", `Could not read media files:\n\n${message}`);
    return [];
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

// ── Deep-link handler (264pro://auth?token=...&state=...) ─────────────────────
// Register custom protocol on macOS/Linux; on Windows use second-instance
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('264pro', process.execPath, [process.argv[1]]);
  }
} else {
  app.setAsDefaultProtocolClient('264pro');
}

// ── YouTube OAuth + Upload ─────────────────────────────────────────────────────
ipcMain.handle('publish:connect-youtube', async (_ev) => {
  try {
    const { shell: shellM, app: appM } = await import('electron');
    void appM; // unused but satisfies import
    const clientId = process.env.YOUTUBE_CLIENT_ID ?? '264pro-youtube-oauth';
    const redirectUri = 'http://localhost:8642/oauth/youtube';
    const scope = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`;

    const http = await import('http');
    const urlModule = await import('url');

    const code = await new Promise<string | null>((resolve) => {
      let resolved = false;
      const done = (val: string | null) => { if (!resolved) { resolved = true; resolve(val); } };
      const server = http.createServer((req, res) => {
        const parsed = urlModule.parse(req.url ?? '', true);
        const code = parsed.query.code as string;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family:sans-serif;padding:40px;background:#0f172a;color:#e2e8f0"><h2>✅ Connected to YouTube!</h2><p>You can close this window and return to 264 Pro.</p></body></html>');
        server.close();
        done(code ?? null);
      });
      server.on('error', (err) => {
        done(null);
        return void err; // port-in-use or other server error
      });
      server.listen(8642, 'localhost');
      const timer = setTimeout(() => { server.close(); done(null); }, 120000);
      server.once('close', () => clearTimeout(timer));
      void shellM.openExternal(authUrl);
    });

    if (!code) return { success: false, error: 'OAuth cancelled or timed out' };

    if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
      oauthTokens['youtube'] = { accessToken: 'demo_token_' + Date.now(), expiresAt: Date.now() + 3600000 };
      return { success: true, demo: true, message: 'Connected (demo mode — add YOUTUBE_CLIENT_ID/SECRET for real uploads)' };
    }

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: process.env.YOUTUBE_CLIENT_ID,
        client_secret: process.env.YOUTUBE_CLIENT_SECRET,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      }).toString(),
    });
    const tokenData = await tokenResp.json() as any;
    if (!tokenData.access_token) return { success: false, error: tokenData.error_description ?? 'Token exchange failed' };
    oauthTokens['youtube'] = { accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token, expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000 };
    return { success: true };
  } catch(e) { return { success: false, error: e instanceof Error ? e.message : String(e) }; }
});

ipcMain.handle('publish:upload-youtube', async (_ev, args: {
  videoPath: string;
  title: string;
  description: string;
  tags: string[];
  privacyStatus?: 'public' | 'private' | 'unlisted';
}) => {
  try {
    const token = oauthTokens['youtube'];
    if (!token) return { success: false, error: 'Not connected to YouTube. Click "Connect YouTube" first.' };

    if (token.accessToken.startsWith('demo_token_')) {
      return { success: false, error: 'Demo mode: add YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET environment variables for real uploads.' };
    }

    const fsM = await import('fs');

    if (!fsM.existsSync(args.videoPath)) return { success: false, error: `Video file not found: ${args.videoPath}` };

    // Warn if file is very large (readFileSync will load it all into RAM)
    const fileStat = fsM.statSync(args.videoPath);
    const fileSizeMB = fileStat.size / (1024 * 1024);
    if (fileSizeMB > 500) {
      return { success: false, error: `File is ${Math.round(fileSizeMB)}MB. Files larger than 500MB require chunked upload (not yet supported). Please export a smaller file or use the YouTube Studio website.` };
    }

    const initResp = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/mp4',
        },
        body: JSON.stringify({
          snippet: { title: args.title, description: args.description, tags: args.tags },
          status: { privacyStatus: args.privacyStatus ?? 'private' },
        }),
      }
    );
    if (!initResp.ok) {
      const err = await initResp.text();
      return { success: false, error: `YouTube init error ${initResp.status}: ${err.slice(0, 200)}` };
    }
    const uploadUrl = initResp.headers.get('location');
    if (!uploadUrl) return { success: false, error: 'No upload URL returned' };

    const videoData = fsM.readFileSync(args.videoPath);
    const uploadResp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'video/mp4',
        'Content-Length': String(videoData.length),
      },
      body: videoData,
    });
    if (!uploadResp.ok) {
      const err = await uploadResp.text();
      return { success: false, error: `Upload failed ${uploadResp.status}: ${err.slice(0, 200)}` };
    }
    const videoData2 = await uploadResp.json() as any;
    return { success: true, videoId: videoData2.id, url: `https://youtube.com/watch?v=${videoData2.id}` };
  } catch(e) { return { success: false, error: e instanceof Error ? e.message : String(e) }; }
});

// ── TikTok OAuth + Upload ──────────────────────────────────────────────────────
ipcMain.handle('publish:connect-tiktok', async () => {
  try {
    const { shell: shellM } = await import('electron');
    const http = await import('http');
    const urlModule = await import('url');

    const clientKey = process.env.TIKTOK_CLIENT_KEY ?? '264pro-tiktok';
    const redirectUri = 'http://localhost:8643/oauth/tiktok';
    const scope = 'video.upload,video.publish';
    const csrfState = Math.random().toString(36).slice(2);
    const authUrl = `https://www.tiktok.com/v2/auth/authorize?client_key=${encodeURIComponent(clientKey)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${csrfState}`;

    const code = await new Promise<string | null>((resolve) => {
      let resolved = false;
      const done = (val: string | null) => { if (!resolved) { resolved = true; resolve(val); } };
      const server = http.createServer((req, res) => {
        const parsed = urlModule.parse(req.url ?? '', true);
        const code = parsed.query.code as string;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family:sans-serif;padding:40px;background:#0f172a;color:#e2e8f0"><h2>✅ Connected to TikTok!</h2><p>You can close this window and return to 264 Pro.</p></body></html>');
        server.close();
        done(code ?? null);
      });
      server.on('error', (err) => {
        done(null);
        return void err; // port-in-use or other server error
      });
      server.listen(8643, 'localhost');
      const timer = setTimeout(() => { server.close(); done(null); }, 120000);
      server.once('close', () => clearTimeout(timer));
      void shellM.openExternal(authUrl);
    });

    if (!code) return { success: false, error: 'OAuth cancelled or timed out' };
    if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) {
      oauthTokens['tiktok'] = { accessToken: 'demo_token_' + Date.now(), expiresAt: Date.now() + 3600000 };
      return { success: true, demo: true, message: 'Connected (demo mode — add TIKTOK_CLIENT_KEY/SECRET for real uploads)' };
    }
    const tokenResp = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString(),
    });
    const td = await tokenResp.json() as any;
    if (!td.access_token) return { success: false, error: td.error_description ?? 'Token exchange failed' };
    oauthTokens['tiktok'] = { accessToken: td.access_token, expiresAt: Date.now() + (td.expires_in ?? 86400) * 1000 };
    return { success: true };
  } catch(e) { return { success: false, error: e instanceof Error ? e.message : String(e) }; }
});

ipcMain.handle('publish:upload-tiktok', async (_ev, args: { videoPath: string; title: string; privacyLevel?: string }) => {
  try {
    const token = oauthTokens['tiktok'];
    if (!token) return { success: false, error: 'Not connected to TikTok. Click "Connect TikTok" first.' };
    if (token.accessToken.startsWith('demo_token_')) {
      return { success: false, error: 'Demo mode: add TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET for real uploads.' };
    }
    const fsM = await import('fs');
    if (!fsM.existsSync(args.videoPath)) return { success: false, error: `File not found: ${args.videoPath}` };
    const fileSize = fsM.statSync(args.videoPath).size;
    const fileSizeMB = fileSize / (1024 * 1024);
    if (fileSizeMB > 500) {
      return { success: false, error: `File is ${Math.round(fileSizeMB)}MB. Files larger than 500MB require chunked upload (not yet supported). Please export a smaller file.` };
    }
    const initResp = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ post_info: { title: args.title, privacy_level: args.privacyLevel ?? 'SELF_ONLY', disable_duet: false, disable_stitch: false, disable_comment: false, video_cover_timestamp_ms: 1000 }, source_info: { source: 'FILE_UPLOAD', video_size: fileSize, chunk_size: fileSize, total_chunk_count: 1 } }),
    });
    const initData = await initResp.json() as any;
    if (!initData.data?.upload_url) return { success: false, error: JSON.stringify(initData).slice(0, 200) };
    const videoBuffer = fsM.readFileSync(args.videoPath);
    const uploadResp = await fetch(initData.data.upload_url, { method: 'PUT', headers: { 'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`, 'Content-Type': 'video/mp4' }, body: videoBuffer });
    if (!uploadResp.ok) return { success: false, error: `TikTok upload failed: ${uploadResp.status}` };
    return { success: true, publishId: initData.data.publish_id };
  } catch(e) { return { success: false, error: e instanceof Error ? e.message : String(e) }; }
});

ipcMain.handle('publish:check-connection', async (_ev, platform: string) => {
  const token = oauthTokens[platform];
  if (!token) return { connected: false, demo: false };
  const expiresAt = token.expiresAt ?? 0;
  return { connected: expiresAt > Date.now(), demo: token.accessToken?.startsWith('demo_token_') ?? false };
});

ipcMain.handle('publish:disconnect', async (_ev, platform: string) => {
  delete oauthTokens[platform];
  return { success: true };
});

// ── Whisper AI Transcription via Groq ─────────────────────────────────────────
ipcMain.handle('ai:transcribe', async (_ev, args: { filePath: string; language?: string }) => {
  try {
    const groqKey = process.env.GROQ_API_KEY || '';
    if (!groqKey) {
      return { success: false, error: 'Add GROQ_API_KEY in Settings → AI to enable transcription' };
    }

    const fs = await import('fs');
    const path = await import('path');
    const FormData = (await import('form-data')).default;

    if (!fs.existsSync(args.filePath)) {
      return { success: false, error: `File not found: ${args.filePath}` };
    }

    const form = new FormData();
    form.append('file', fs.readFileSync(args.filePath), {
      filename: path.basename(args.filePath),
      contentType: 'audio/mpeg',
    });
    form.append('model', 'whisper-large-v3');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    if (args.language) form.append('language', args.language);

    const formBuffer = form.getBuffer();
    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqKey}`, ...form.getHeaders() },
      body: formBuffer,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { success: false, error: `Groq API error ${resp.status}: ${errText.slice(0, 200)}` };
    }

    const data = await resp.json() as Record<string, unknown>;

    // Convert word-level timestamps to subtitle segments
    const rawWords = (data.words ?? []) as Array<{ word: string; start: number; end: number }>;
    const fullText = (data.text as string) ?? '';

    if (rawWords.length === 0 && fullText) {
      // No word timestamps — return as single segment + single word spanning whole clip
      return {
        success: true,
        transcript: fullText,
        words: [{ word: fullText, start: 0, end: 5 }],
        segments: [{ startMs: 0, endMs: 5000, text: fullText }],
      };
    }

    // Group words into ~6-word subtitle lines (for subtitle overlays)
    const segments: Array<{ startMs: number; endMs: number; text: string }> = [];
    const GROUP_SIZE = 6;
    for (let i = 0; i < rawWords.length; i += GROUP_SIZE) {
      const group = rawWords.slice(i, i + GROUP_SIZE);
      segments.push({
        startMs: Math.round(group[0].start * 1000),
        endMs: Math.round(group[group.length - 1].end * 1000),
        text: group.map(w => w.word).join(' ').trim(),
      });
    }
    return {
      success: true,
      transcript: fullText,
      words: rawWords,   // raw word-level data: { word, start, end } (seconds)
      segments,
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle('lut:export', async (_ev, args: { grade: Record<string, number>; name: string }) => {
  try {
    const { dialog } = await import('electron');
    const fsM = await import('fs');
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export LUT',
      defaultPath: `${((args.name ?? '') || 'grade').replace(/[^a-zA-Z0-9_-]/g,'_')}.cube`,
      filters: [{ name: 'LUT Files', extensions: ['cube'] }],
    });
    if (canceled || !filePath) return { success: false, canceled: true };
    const SIZE = 17;
    const g = args.grade;
    const exposure = g.exposure ?? 0;
    const contrast = g.contrast ?? 0;
    const saturation = g.saturation ?? 1;
    const temperature = g.temperature ?? 0;
    const tint = g.tint ?? 0;
    const shadows = g.shadows ?? 0;
    const highlights = g.highlights ?? 0;
    const vibrance = g.vibrance ?? 0;
    const lines = [`# 264 Pro LUT export`, `TITLE "${args.name}"`, `LUT_3D_SIZE ${SIZE}`, ''];
    for (let b = 0; b < SIZE; b++) {
      for (let g2 = 0; g2 < SIZE; g2++) {
        for (let r = 0; r < SIZE; r++) {
          let R = r/(SIZE-1), G = g2/(SIZE-1), B = b/(SIZE-1);
          const em = Math.pow(2, exposure); R*=em; G*=em; B*=em;
          const cf = 1+contrast; R=(R-.5)*cf+.5; G=(G-.5)*cf+.5; B=(B-.5)*cf+.5;
          const tf=temperature/500; R+=tf; B-=tf;
          const tif=tint/500; G+=tif;
          if(shadows){const s=shadows*.1; R+=s*(1-R); G+=s*(1-G); B+=s*(1-B);}
          if(highlights){const h=highlights*.1; R+=h*R; G+=h*G; B+=h*B;}
          if(saturation!==1){const l=.2126*R+.7152*G+.0722*B; R=l+(R-l)*saturation; G=l+(G-l)*saturation; B=l+(B-l)*saturation;}
          if(vibrance){const l=.2126*R+.7152*G+.0722*B; const sat=Math.max(R,G,B)-Math.min(R,G,B); const vf=1+(vibrance*.01)*(1-sat); R=l+(R-l)*vf; G=l+(G-l)*vf; B=l+(B-l)*vf;}
          R=Math.max(0,Math.min(1,R)); G=Math.max(0,Math.min(1,G)); B=Math.max(0,Math.min(1,B));
          lines.push(`${R.toFixed(6)} ${G.toFixed(6)} ${B.toFixed(6)}`);
        }
      }
    }
    fsM.writeFileSync(filePath, lines.join('\n'));
    return { success: true, filePath };
  } catch(e) { return { success: false, error: e instanceof Error ? e.message : String(e) }; }
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

// ── Render Cache IPC ──────────────────────────────────────────────────────────

ipcMain.handle('render-cache:render-segment', async (_ev, args: {
  projectId: string;
  segmentHash: string;
  inputPath: string;
  startSeconds: number;
  durationSeconds: number;
  grade: Record<string, number>;
  speed: number;
}) => {
  try {
    const fsM = await import('fs');
    const pathM = await import('path');
    const { spawn } = await import('child_process');

    const cacheDir = pathM.join(app.getPath('userData'), 'render-cache', args.projectId);
    fsM.mkdirSync(cacheDir, { recursive: true });
    const outPath = pathM.join(cacheDir, `${args.segmentHash}.mp4`);

    if (fsM.existsSync(outPath)) return { success: true, filePath: outPath, cached: true };

    // Build grade filter
    const g = args.grade;
    const exposure = g.exposure ?? 0;
    const contrast = g.contrast ?? 0;
    const brightness = 1 + exposure * 0.3;
    const contrastVal = 1 + contrast * 0.5;
    const saturation = g.saturation ?? 1;
    const temperature = (g.temperature ?? 0) / 200;

    const filters: string[] = [];

    // Speed ramp
    if (args.speed !== 1) filters.push(`setpts=${(1 / args.speed).toFixed(4)}*PTS`);

    // Color grade via eq + colorchannelmixer
    filters.push(`eq=brightness=${(brightness - 1).toFixed(3)}:contrast=${contrastVal.toFixed(3)}:saturation=${saturation.toFixed(3)}`);
    if (Math.abs(temperature) > 0.001) {
      const rBoost = (1 + temperature).toFixed(3);
      const bBoost = (1 - temperature).toFixed(3);
      filters.push(`colorchannelmixer=rr=${rBoost}:bb=${bBoost}`);
    }

    // Find ffmpeg — same logic as getFfmpegPath() in ffmpeg.ts
    let ffmpegBin: string;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ffmpegStaticMod: any = await import('ffmpeg-static');
      const resolved: string | null =
        process.env.FFMPEG_PATH ||
        (typeof ffmpegStaticMod === 'string' ? ffmpegStaticMod : null) ||
        (typeof ffmpegStaticMod?.default === 'string' ? ffmpegStaticMod.default : null);
      ffmpegBin = resolved ?? 'ffmpeg';
    } catch {
      ffmpegBin = 'ffmpeg';
    }

    const spawnArgs: string[] = [
      '-y',
      '-ss', args.startSeconds.toFixed(3),
      '-i', args.inputPath,
      '-t', args.durationSeconds.toFixed(3),
      ...(filters.length ? ['-vf', filters.join(',')] : []),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outPath,
    ];

    return new Promise<{ success: boolean; filePath?: string; cached?: boolean; error?: string }>((resolve) => {
      const proc = spawn(ffmpegBin, spawnArgs);
      let stderr = '';
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('close', (code: number) => {
        if (code === 0) resolve({ success: true, filePath: outPath });
        else resolve({ success: false, error: stderr.slice(-300) });
      });
      proc.on('error', (e: Error) => resolve({ success: false, error: e.message }));
    });
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle('render-cache:get-cache-dir', (_ev, projectId: string) => {
  const pathM = require('path') as typeof import('path');
  return pathM.join(app.getPath('userData'), 'render-cache', projectId);
});

ipcMain.handle('render-cache:clear', async (_ev, projectId: string) => {
  try {
    const fsM = await import('fs');
    const pathM = await import('path');
    const dir = pathM.join(app.getPath('userData'), 'render-cache', projectId);
    if (fsM.existsSync(dir)) fsM.rmSync(dir, { recursive: true, force: true });
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
});

// ── Hardware encoder detection ────────────────────────────────────────────────
ipcMain.handle('export:detect-hw-encoder', async () => {
  try {
    const encoder = await detectBestHWEncoder();
    return { success: true, encoder: encoder ?? null };
  } catch {
    return { success: true, encoder: null };
  }
});

// ── EDL Export ────────────────────────────────────────────────────────────────
ipcMain.handle('export:edl', async (_ev, project: unknown) => {
  try {
    const fsM   = await import('fs');
    const pathM = await import('path');
    const { generateEDL } = await import('./edl-export.js');

    const proj = project as { name?: string };
    const defaultName = `${(proj.name ?? 'Untitled').replace(/[^a-zA-Z0-9_-]/g, '_')}.edl`;
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export EDL',
      defaultPath: pathM.join(app.getPath('documents'), defaultName),
      filters: [{ name: 'EDL Files', extensions: ['edl'] }],
    });
    if (canceled || !filePath) return { success: false, canceled: true };

    const edl = generateEDL(project as Parameters<typeof generateEDL>[0]);
    fsM.writeFileSync(filePath, edl, 'utf8');
    return { success: true, filePath };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
});

// ── FCP XML Export ────────────────────────────────────────────────────────────
ipcMain.handle('export:fcpxml', async (_ev, project: unknown) => {
  try {
    const fsM   = await import('fs');
    const pathM = await import('path');
    const { generateFCPXML } = await import('./edl-export.js');

    const proj = project as { name?: string };
    const defaultName = `${(proj.name ?? 'Untitled').replace(/[^a-zA-Z0-9_-]/g, '_')}.fcpxml`;
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export FCP XML',
      defaultPath: pathM.join(app.getPath('documents'), defaultName),
      filters: [{ name: 'FCP XML', extensions: ['fcpxml', 'xml'] }],
    });
    if (canceled || !filePath) return { success: false, canceled: true };

    const xml = generateFCPXML(project as Parameters<typeof generateFCPXML>[0]);
    fsM.writeFileSync(filePath, xml, 'utf8');
    return { success: true, filePath };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
});

// ── Multicam Audio Sync ───────────────────────────────────────────────────────
ipcMain.handle('multicam:sync-by-audio', async (_ev, args: {
  clips: Array<{ clipId: string; assetPath: string; trimStartSeconds: number; durationSeconds: number }>;
}) => {
  let pcmFiles: string[] | undefined;
  try {
    const fsM = await import('fs');
    const pathM = await import('path');
    const osM = await import('os');
    const { spawn } = await import('child_process');

    // Get ffmpeg path
    let ffmpegBin = 'ffmpeg';
    try {
      const ffmpegStatic = require('ffmpeg-static');
      const p = (ffmpegStatic as { default?: string }).default ?? (ffmpegStatic as string);
      if (typeof p === 'string' && p) ffmpegBin = p;
    } catch { /* use system ffmpeg */ }

    const tmpDir = pathM.join(osM.tmpdir(), '264pro-multicam-sync');
    fsM.mkdirSync(tmpDir, { recursive: true });

    // Step 1: Extract mono 8kHz audio PCM for each clip (fast, low memory)
    pcmFiles = [];
    for (let i = 0; i < args.clips.length; i++) {
      const clip = args.clips[i];
      const outPcm = pathM.join(tmpDir, `clip_${i}.pcm`);
      pcmFiles.push(outPcm);

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpegBin, [
          '-y',
          '-ss', clip.trimStartSeconds.toFixed(3),
          '-i', clip.assetPath,
          '-t', Math.min(clip.durationSeconds, 60).toFixed(3), // max 60s for correlation
          '-vn',
          '-ac', '1',        // mono
          '-ar', '8000',     // 8kHz — enough for correlation
          '-f', 'f32le',     // raw 32-bit float PCM
          outPcm,
        ]);
        proc.on('close', (code: number) => code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}`)));
        proc.on('error', reject);
        setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 30000);
      });
    }

    if (pcmFiles.length < 2) {
      return { success: false, error: 'Need at least 2 clips to sync' };
    }

    // Step 2: Read PCM data
    const sampleRate = 8000;
    const waveforms: Float32Array[] = pcmFiles.map(f => {
      const buf = fsM.readFileSync(f);
      const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      return arr;
    });

    // Step 3: Cross-correlate each clip against the reference (clip 0)
    // Find the lag that maximizes correlation → that's the sync offset
    const reference = waveforms[0];
    const offsets: number[] = [0]; // reference is 0 offset

    for (let i = 1; i < waveforms.length; i++) {
      const target = waveforms[i];
      const maxLagSamples = sampleRate * 30; // search up to ±30 seconds
      const refLen = Math.min(reference.length, sampleRate * 30);
      const tgtLen = Math.min(target.length, sampleRate * 30);

      let bestLag = 0;
      let bestScore = -Infinity;

      // Normalized cross-correlation via sliding window
      // Use step size of 100 samples (12.5ms at 8kHz) for speed, then refine
      const step = 100;
      for (let lag = -maxLagSamples; lag <= maxLagSamples; lag += step) {
        let score = 0;
        const samples = Math.min(refLen, tgtLen, 4000); // use 0.5s window
        for (let j = 0; j < samples; j++) {
          const ri = j;
          const ti = j + lag;
          if (ti < 0 || ti >= target.length || ri >= reference.length) continue;
          score += reference[ri] * target[ti];
        }
        if (score > bestScore) {
          bestScore = score;
          bestLag = lag;
        }
      }

      // Refine around best lag with step 1
      for (let lag = bestLag - step; lag <= bestLag + step; lag++) {
        let score = 0;
        const samples = Math.min(refLen, tgtLen, 8000);
        for (let j = 0; j < samples; j++) {
          const ri = j;
          const ti = j + lag;
          if (ti < 0 || ti >= target.length || ri >= reference.length) continue;
          score += reference[ri] * target[ti];
        }
        if (score > bestScore) {
          bestScore = score;
          bestLag = lag;
        }
      }

      // Convert lag in samples to seconds
      offsets.push(bestLag / sampleRate);
    }

    return {
      success: true,
      offsets, // offsets[i] = seconds to shift clip i relative to clip 0
      // Positive offset = clip i starts later than reference
      // Negative offset = clip i starts earlier than reference
    };
  } catch(e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    // Clean up temp files regardless of success or failure
    if (pcmFiles) {
      try {
        const fsClean = require('fs') as typeof import('fs');
        pcmFiles.forEach(f => { try { fsClean.unlinkSync(f); } catch { /* ignore */ } });
      } catch { /* ignore */ }
    }
  }
});

// ── Audio Stems Export ────────────────────────────────────────────────────────
ipcMain.handle('export:stems', async (_ev, args: {
  project: unknown;
  format: 'wav' | 'aiff' | 'mp3' | 'aac';
  sampleRate: number;
  stems: string[];
}) => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Choose Output Folder for Stems',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths || filePaths.length === 0 || !filePaths[0]) return { success: false, canceled: true, files: [] };

    // Guard against empty stems array
    if (!args.stems || args.stems.length === 0) return { success: false, error: 'No stems selected', files: [] };

    const { exportStems } = await import('./stems-export.js');
    const result = await exportStems({
      project: args.project as Parameters<typeof exportStems>[0]['project'],
      outputDir: filePaths[0],
      format: args.format,
      sampleRate: args.sampleRate || 48000,
      stems: args.stems as ('dialogue' | 'music' | 'sfx' | 'mix')[],
    });

    return result;
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e), files: [] };
  }
});

// ── Auto-Reframe: AI crop to target aspect ratio via FFmpeg ───────────────────
ipcMain.handle('reframe:analyze-and-export', async (_ev, args: {
  sourcePath: string;
  targetAspect: '9:16' | '1:1' | '4:5' | '16:9' | '4:3';
  outputPath: string;
  trackingMode: 'center' | 'face' | 'motion';
}) => {
  try {
    const { spawn } = await import('child_process');

    // Resolve ffmpeg/ffprobe paths using the same approach as other handlers
    let ffmpegBin = 'ffmpeg';
    let ffprobeBin = 'ffprobe';
    try {
      const ffmpegStatic = require('ffmpeg-static');
      const p = (ffmpegStatic as { default?: string }).default ?? (ffmpegStatic as string);
      if (typeof p === 'string' && p) {
        ffmpegBin = p;
        ffprobeBin = p.replace(/ffmpeg([^/\\]*)$/, 'ffprobe$1');
      }
    } catch { /* use system ffmpeg/ffprobe */ }

    // Step 1: Probe source dimensions
    const probeResult = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const proc = spawn(ffprobeBin, [
        '-v', 'quiet', '-print_format', 'json', '-show_streams', args.sourcePath
      ]);
      let out = '';
      proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
      proc.on('close', (code: number) => {
        if (code !== 0) { reject(new Error('ffprobe failed')); return; }
        try {
          const data = JSON.parse(out);
          const vs = data.streams?.find((s: { codec_type: string }) => s.codec_type === 'video') as { width?: number; height?: number } | undefined;
          resolve({ width: vs?.width ?? 1920, height: vs?.height ?? 1080 });
        } catch { reject(new Error('ffprobe parse failed')); }
      });
      proc.on('error', reject);
    });

    const { width: srcW, height: srcH } = probeResult;

    // Step 2: Compute crop dimensions for target aspect ratio
    const aspectMap: Record<string, [number, number]> = {
      '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5], '16:9': [16, 9], '4:3': [4, 3]
    };
    const [aw, ah] = aspectMap[args.targetAspect] ?? [9, 16];

    let cropW: number, cropH: number;
    if (srcW / srcH > aw / ah) {
      cropH = srcH;
      cropW = Math.round(srcH * aw / ah);
    } else {
      cropW = srcW;
      cropH = Math.round(srcW * ah / aw);
    }
    // Ensure even dimensions (H.264 requirement)
    cropW = cropW % 2 === 0 ? cropW : cropW - 1;
    cropH = cropH % 2 === 0 ? cropH : cropH - 1;

    // Step 3: Build crop filter for tracking mode
    let cropFilter: string;
    if (args.trackingMode === 'center') {
      const x = Math.round((srcW - cropW) / 2);
      const y = Math.round((srcH - cropH) / 2);
      cropFilter = `crop=${cropW}:${cropH}:${x}:${y}`;
    } else if (args.trackingMode === 'motion') {
      // Slightly above-center bias — action tends to be in the middle third
      const x = Math.round((srcW - cropW) / 2);
      const y = Math.round((srcH - cropH) * 0.35);
      cropFilter = `crop=${cropW}:${cropH}:${x}:${y}`;
    } else {
      // face mode — upper-center heuristic (faces occupy upper ~40% of frame)
      const x = Math.round((srcW - cropW) / 2);
      const y = Math.round((srcH - cropH) * 0.25);
      cropFilter = `crop=${cropW}:${cropH}:${x}:${y}`;
    }

    // Step 4: Run FFmpeg crop + scale pass
    const filterChain = `${cropFilter},scale=${cropW}:${cropH}:flags=lanczos`;

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegBin, [
        '-i', args.sourcePath,
        '-vf', filterChain,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
        '-c:a', 'copy',
        '-y', args.outputPath
      ]);
      let errOut = '';
      proc.stderr.on('data', (d: Buffer) => { errOut += d.toString(); });
      proc.on('close', (code: number) => {
        if (code !== 0) reject(new Error(`FFmpeg reframe failed: ${errOut.slice(-400)}`));
        else resolve();
      });
      proc.on('error', reject);
    });

    return { success: true, outputPath: args.outputPath, cropW, cropH };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
});

// ── Proxy workflow IPC handlers ───────────────────────────────────────────────

ipcMain.handle('proxy:generate', async (_ev, args: {
  assetId: string;
  sourcePath: string;
  proxyDir: string;
}) => {
  try {
    const { spawn } = await import('child_process');
    const { getEnvironmentStatus } = await import('./ffmpeg.js');
    const fs = await import('fs');
    const path = await import('path');

    const ffmpeg = getEnvironmentStatus().ffmpegPath;

    // Create proxy dir if needed
    fs.mkdirSync(args.proxyDir, { recursive: true });

    // Proxy filename: assetId + _proxy.mp4
    const proxyFilename = `${args.assetId.replace(/[^a-zA-Z0-9]/g, '_')}_proxy.mp4`;
    const proxyPath = path.join(args.proxyDir, proxyFilename);

    // Already exists? Return immediately
    if (fs.existsSync(proxyPath)) {
      return { success: true, proxyPath };
    }

    // Generate: scale to max 1280px wide, H.264 ultrafast, 23 CRF
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpeg, [
        '-i', args.sourcePath,
        '-vf', 'scale=1280:-2:flags=fast_bilinear',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-y', proxyPath,
      ]);
      let errOut = '';
      proc.stderr.on('data', (d: Buffer) => { errOut += d.toString(); });
      proc.on('close', (code: number) => {
        if (code !== 0) reject(new Error(`Proxy gen failed: ${errOut.slice(-200)}`));
        else resolve();
      });
    });

    return { success: true, proxyPath };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle('proxy:get-dir', async () => {
  const path = await import('path');
  return path.join(app.getPath('userData'), 'proxies');
});

ipcMain.handle('proxy:delete', async (_ev, proxyPath: string) => {
  try {
    const fs = await import('fs');
    if (fs.existsSync(proxyPath)) fs.unlinkSync(proxyPath);
    return { success: true };
  } catch (e) {
    return { success: false };
  }
});

// ── Kill active FFmpeg processes on quit ──────────────────────────────────────
app.on("will-quit", () => {
  killAllActiveProcesses();
});

// ── Entry point ───────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Register media:// protocol handler
  protocol.handle("media", createMediaResponse);

  // Set dock icon explicitly on Mac — works in both dev and packaged builds
  if (process.platform === "darwin" && app.dock) {
    try {
      const iconPath = app.isPackaged
        ? join(process.resourcesPath, "build-assets", "icon.png")
        : join(process.cwd(), "build-assets", "icon.png");
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) app.dock.setIcon(img);
    } catch { /* non-critical */ }
  }

  // Start auto-updater immediately — before gate or editor opens.
  // This means even users stuck on the gate screen get notified of updates.
  initAutoUpdater();

  void launchWithGate();
});
