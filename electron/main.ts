import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import pkg from "electron-updater";
const { autoUpdater } = pkg;
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import type { ExportRequest } from "../src/shared/models.js";
import {
  exportSequence,
  getEnvironmentStatus,
  probeMediaFiles
} from "./ffmpeg.js";

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

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: "#091017",
    title: "264 Pro Video Editor",
    icon: join(__dirname, "../../build-assets/icon.png"),
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

  // ── Close guard: ask renderer if there are unsaved changes ───────────────
  // Use a flag so we can bypass the guard after user confirms.
  let closeConfirmed = false;
  window.on("close", (e) => {
    if (closeConfirmed) return; // already confirmed
    e.preventDefault();
    // Ask renderer to handle dirty-check modal
    window.webContents.send("app:before-close");
  });

  return window;
}

app.whenReady().then(() => {
  protocol.handle("media", (request) => createMediaResponse(request));

  const mainWindow = createMainWindow();

  // --- Auto-updater setup ---
  // Only run in production (not during dev server)
  if (!process.env.VITE_DEV_SERVER_URL) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => {
      mainWindow.webContents.send("updater:status", { state: "checking" });
    });

    autoUpdater.on("update-available", (info) => {
      mainWindow.webContents.send("updater:status", {
        state: "available",
        version: info.version
      });
    });

    autoUpdater.on("update-not-available", () => {
      mainWindow.webContents.send("updater:status", { state: "up-to-date" });
    });

    autoUpdater.on("download-progress", (progress) => {
      mainWindow.webContents.send("updater:status", {
        state: "downloading",
        percent: Math.round(progress.percent),
        transferred: progress.transferred,
        total: progress.total
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      mainWindow.webContents.send("updater:status", {
        state: "ready",
        version: info.version
      });
      // Show native dialog asking to restart and install now
      void dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Update Ready",
        message: `264 Pro v${info.version} has been downloaded.`,
        detail: "Restart now to install the update, or it will be installed automatically on next quit.",
        buttons: ["Restart & Install", "Later"],
        defaultId: 0,
        cancelId: 1
      }).then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall(false, true);
        }
      });
    });

    autoUpdater.on("error", (err) => {
      mainWindow.webContents.send("updater:status", {
        state: "error",
        message: err.message
      });
    });

    // Check for updates 5 seconds after launch, then every 2 hours
    setTimeout(() => { void autoUpdater.checkForUpdates(); }, 5000);
    setInterval(() => { void autoUpdater.checkForUpdates(); }, 2 * 60 * 60 * 1000);
  }
  // --- End auto-updater ---

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("system:environment", () => {
  return getEnvironmentStatus();
});

ipcMain.handle("media:open-files", async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const result = window
    ? await dialog.showOpenDialog(window, {
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

  return probeMediaFiles(result.filePaths);
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

ipcMain.handle("export:render", async (_event, request: ExportRequest) => {
  return exportSequence(request);
});

// ── Project persistence (.264proj) ───────────────────────────────────────────

ipcMain.handle("project:save", async (event, json: string, suggestedName: string) => {
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
});

ipcMain.handle("project:open", async (event) => {
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
});

ipcMain.handle("project:save-as", async (event, json: string, filePath: string) => {
  await writeFile(filePath, json, "utf-8");
  return filePath;
});

// ── App lifecycle IPC ─────────────────────────────────────────────────────────

// renderer calls this when user says "yes close"
// Uses ipcMain.handle so it works every time (not just once)
ipcMain.handle("app:confirm-close", () => {
  const wins = BrowserWindow.getAllWindows();
  if (wins[0]) {
    // Remove the close guard listeners then close
    wins[0].removeAllListeners("close");
    wins[0].close();
  }
});

ipcMain.handle("updater:install-now", () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle("app:open-external", (_event, url: string) => {
  void shell.openExternal(url);
});
