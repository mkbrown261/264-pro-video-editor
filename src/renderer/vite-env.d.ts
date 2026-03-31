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

declare global {
  interface Window {
    editorApi: {
      openMediaFiles: () => Promise<MediaAsset[]>;
      chooseExportFile: (suggestedName: string) => Promise<string | null>;
      exportSequence: (request: ExportRequest) => Promise<ExportResponse>;
      getEnvironmentStatus: () => Promise<EnvironmentStatus>;
      onUpdaterStatus: (callback: (status: UpdaterStatus) => void) => () => void;
    };
  }
}

export {};
