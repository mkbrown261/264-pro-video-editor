import type {
  EnvironmentStatus,
  ExportCodec,
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
    electronAPI?: {
      openExternal: (url: string) => void;
      getAppVersion: () => Promise<string>;
      startAuthFlow: (state: string) => void;
      submitDevKey: (key: string) => Promise<{ success: boolean; error?: string }>;
      onAuthResult: (cb: (success: boolean, error?: string) => void) => () => void;
      /** Phase 9: Generate publish metadata (title, description, tags) */
      generatePublishMetadata?: (params: {
        projectName: string;
        durationSeconds: number;
        platforms: string[];
      }) => Promise<{ title: string; description: string; tags: string[]; platforms: string[] }>;
      /** Phase 9: Upload to YouTube */
      uploadToYouTube?: (params: unknown) => Promise<{ ok: boolean; error?: string }>;
      /** Phase 9: Upload to TikTok */
      uploadToTikTok?: (params: unknown) => Promise<{ ok: boolean; error?: string }>;
      /** Whisper AI transcription via Groq */
      transcribeAudio?: (args: { filePath: string; language?: string }) => Promise<{ success: boolean; segments?: Array<{ startMs: number; endMs: number; text: string }>; error?: string }>;
      exportLut?: (args: { grade: Record<string, number>; name: string }) => Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>;
      // ── Render Cache ────────────────────────────────────────────────────
      renderCacheSegment?: (args: {
        projectId: string;
        segmentHash: string;
        inputPath: string;
        startSeconds: number;
        durationSeconds: number;
        grade: Record<string, number>;
        speed: number;
      }) => Promise<{ success: boolean; filePath?: string; cached?: boolean; error?: string }>;
      getCacheDir?: (projectId: string) => Promise<string>;
      clearRenderCache?: (projectId: string) => Promise<{ success: boolean; error?: string }>;
      detectHWEncoder?: () => Promise<{ success: boolean; encoder: string | null }>;
      // ── EDL / FCP XML Exchange Formats ──────────────────────────────────
      exportEDL?: (project: unknown) => Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>;
      exportFCPXML?: (project: unknown) => Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>;
      /** Export audio stems (Dialogue / Music / SFX / Full Mix) as WAV/AIFF/MP3/AAC */
      exportStems?: (args: {
        project: unknown;
        format: string;
        sampleRate: number;
        stems: string[];
      }) => Promise<{
        success: boolean;
        files?: Array<{ stem: string; path: string }>;
        canceled?: boolean;
        error?: string;
      }>;
    };
    editorApi: {
      openMediaFiles: () => Promise<MediaAsset[]>;
      chooseExportFile: (suggestedName: string) => Promise<string | null>;
      exportSequence: (request: ExportRequest) => Promise<ExportResponse>;
      getEnvironmentStatus: () => Promise<EnvironmentStatus>;
      onUpdaterStatus: (callback: (status: UpdaterStatus) => void) => () => void;
      /** Called by main process when a background proxy finishes encoding */
      onProxyReady: (callback: (assetId: string, previewUrl: string) => void) => () => void;
      /** Export render progress 0-100 */
      onExportProgress: (callback: (pct: number) => void) => () => void;
      // Project persistence
      saveProject: (json: string, suggestedName: string) => Promise<string | null>;
      openProject: () => Promise<OpenProjectResult | null>;
      saveProjectAs: (json: string, filePath: string) => Promise<string>;
      // App lifecycle
      confirmClose: () => Promise<void>;
      installUpdate: () => Promise<void>;
      onBeforeClose: (callback: () => void) => () => void;
      /** Signal to the main process that the renderer is mounted and ready */
      notifyAppReady?: () => void;
      /** Reveal a file in Finder/Explorer (optional — may not be implemented) */
      showInFolder?: (filePath: string) => void;
    };
  }
}

export {};
