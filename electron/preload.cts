import { contextBridge, ipcRenderer } from "electron";
import type {
  EnvironmentStatus,
  ExportRequest,
  ExportResponse,
  MediaAsset
} from "../src/shared/models.js";

const editorApi = {
  openMediaFiles: (): Promise<MediaAsset[]> =>
    ipcRenderer.invoke("media:open-files"),
  chooseExportFile: (suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke("export:choose-file", suggestedName),
  exportSequence: (request: ExportRequest): Promise<ExportResponse> =>
    ipcRenderer.invoke("export:render", request),
  getEnvironmentStatus: (): Promise<EnvironmentStatus> =>
    ipcRenderer.invoke("system:environment")
};

contextBridge.exposeInMainWorld("editorApi", editorApi);
