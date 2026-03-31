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
    // Return a cleanup function the renderer can call on unmount
    return () => {
      ipcRenderer.removeListener("updater:status", listener);
    };
  }
};

contextBridge.exposeInMainWorld("editorApi", editorApi);
