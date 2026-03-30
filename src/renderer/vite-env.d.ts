import type {
  EnvironmentStatus,
  ExportRequest,
  ExportResponse,
  MediaAsset
} from "../shared/models";

declare global {
  interface Window {
    editorApi: {
      openMediaFiles: () => Promise<MediaAsset[]>;
      chooseExportFile: (suggestedName: string) => Promise<string | null>;
      exportSequence: (request: ExportRequest) => Promise<ExportResponse>;
      getEnvironmentStatus: () => Promise<EnvironmentStatus>;
    };
  }
}

export {};
