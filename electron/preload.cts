import { contextBridge, ipcRenderer } from "electron";
import type {
  EnvironmentStatus,
  ExportRequest,
  ExportResponse,
  MediaAsset
} from "../src/shared/models.js";

export type UpdaterStatusState =
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "ready"
  | "error";

export interface UpdaterStatus {
  state: UpdaterStatusState;
  version?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  message?: string;
}

export interface OpenProjectResult {
  json: string;
  filePath: string;
}

const editorApi = {
  openMediaFiles: (): Promise<MediaAsset[]> =>
    ipcRenderer.invoke("media:open-files"),
  chooseExportFile: (suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke("export:choose-file", suggestedName),
  exportSequence: (request: ExportRequest): Promise<ExportResponse> =>
    ipcRenderer.invoke("export:render", request),
  getEnvironmentStatus: (): Promise<EnvironmentStatus> =>
    ipcRenderer.invoke("system:environment"),
  onUpdaterStatus: (callback: (status: UpdaterStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdaterStatus) => {
      callback(status);
    };
    ipcRenderer.on("updater:status", listener);
    return () => {
      ipcRenderer.removeListener("updater:status", listener);
    };
  },
  // ── Background proxy-ready notification ───────────────────────────────────
  // Called by the main process when a proxy video finishes encoding in the
  // background.  The renderer swaps the asset's previewUrl to the proxy.
  onProxyReady: (callback: (assetId: string, previewUrl: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { assetId: string; previewUrl: string }) => {
      callback(data.assetId, data.previewUrl);
    };
    ipcRenderer.on("media:proxy-ready", listener);
    return () => ipcRenderer.removeListener("media:proxy-ready", listener);
  },
  // ── Project persistence (.264proj) ────────────────────────────────────────
  saveProject: (json: string, suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke("project:save", json, suggestedName),
  openProject: (): Promise<OpenProjectResult | null> =>
    ipcRenderer.invoke("project:open"),
  saveProjectAs: (json: string, filePath: string): Promise<string> =>
    ipcRenderer.invoke("project:save-as", json, filePath),
  // ── App lifecycle ─────────────────────────────────────────────────────────
  confirmClose: (): Promise<void> =>
    ipcRenderer.invoke("app:confirm-close"),
  installUpdate: (): Promise<void> =>
    ipcRenderer.invoke("updater:install-now"),
  onBeforeClose: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("app:before-close", listener);
    return () => ipcRenderer.removeListener("app:before-close", listener);
  },
  // Called by the renderer once the UI has mounted and is ready to show
  notifyAppReady: (): void => {
    ipcRenderer.send("app:renderer-ready");
  },
};

contextBridge.exposeInMainWorld("editorApi", editorApi);

// ── Gate / Auth API (used by gate.html before main editor loads) ──────────────
const electronAPI = {
  openExternal: (url: string): void => { void ipcRenderer.invoke("gate:open-external", url); },
  getAppVersion: (): Promise<string> => ipcRenderer.invoke("gate:get-version"),
  startAuthFlow: (state: string): void => { void ipcRenderer.invoke("gate:start-auth", state); },
  submitDevKey: (key: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("gate:submit-dev-key", key),
  onAuthResult: (cb: (success: boolean, error?: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, success: boolean, error?: string) => cb(success, error);
    ipcRenderer.on("gate:auth-result", listener);
    return () => ipcRenderer.removeListener("gate:auth-result", listener);
  },
};
contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// ── FlowState Panel API (used by FlowStatePanel.tsx in the editor renderer) ───
const flowstateAPI = {
  getToken: (): Promise<string | null> => ipcRenderer.invoke("flowstate:get-token"),
  getUser: (): Promise<{ name: string; email: string; picture: string; tier: string } | null> =>
    ipcRenderer.invoke("flowstate:get-user"),
  apiCall: (path: string, method: string, body?: unknown): Promise<unknown> =>
    ipcRenderer.invoke("flowstate:api-call", path, method, body),
  // AI tools — run a 264 Pro AI tool via FlowState backend
  runAITool: (tool: string, options: {
    imageUrl?: string;
    videoUrl?: string;
    params?: Record<string, unknown>;
  }): Promise<unknown> => ipcRenderer.invoke("flowstate:ai-tool", tool, options),
  // Poll Replicate prediction status
  pollAITool: (predictionId: string): Promise<unknown> =>
    ipcRenderer.invoke("flowstate:ai-tool-poll", predictionId),
};
contextBridge.exposeInMainWorld("flowstateAPI", flowstateAPI);
