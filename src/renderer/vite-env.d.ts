import type {
  EnvironmentStatus,
  ExportRequest,
  ExportResponse,
  MediaAsset
} from "../shared/models";

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

declare global {
  interface Window {
    editorApi: {
      openMediaFiles: () => Promise<MediaAsset[]>;
      chooseExportFile: (suggestedName: string) => Promise<string | null>;
      exportSequence: (request: ExportRequest) => Promise<ExportResponse>;
      getEnvironmentStatus: () => Promise<EnvironmentStatus>;
      onUpdaterStatus: (callback: (status: UpdaterStatus) => void) => () => void;
      // Project persistence
      saveProject: (json: string, suggestedName: string) => Promise<string | null>;
      openProject: () => Promise<OpenProjectResult | null>;
      saveProjectAs: (json: string, filePath: string) => Promise<string>;
      // App lifecycle
      confirmClose: () => Promise<void>;
      installUpdate: () => Promise<void>;
      onBeforeClose: (callback: () => void) => () => void;
    };
  }
}

export {};
