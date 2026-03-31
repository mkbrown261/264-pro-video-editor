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
};

contextBridge.exposeInMainWorld("editorApi", editorApi);
