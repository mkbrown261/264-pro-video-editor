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
      /** Phase 9: Upload to YouTube (legacy stub alias) */
      uploadToYouTube?: (params: unknown) => Promise<{ ok: boolean; error?: string }>;
      /** Phase 9: Upload to TikTok (legacy stub alias) */
      uploadToTikTok?: (params: unknown) => Promise<{ ok: boolean; error?: string }>;
      /** Real YouTube OAuth2 connect flow */
      connectYouTube?: () => Promise<{ success: boolean; demo?: boolean; message?: string; error?: string }>;
      /** Real TikTok OAuth2 connect flow */
      connectTikTok?: () => Promise<{ success: boolean; demo?: boolean; message?: string; error?: string }>;
      /** Check if a platform is connected */
      checkPublishConnection?: (platform: string) => Promise<{ connected: boolean; demo?: boolean }>;
      /** Disconnect a platform */
      disconnectPublish?: (platform: string) => Promise<{ success: boolean }>;
      /** Real YouTube resumable upload */
      uploadYouTube?: (args: { videoPath: string; title: string; description: string; tags: string[]; privacyStatus?: string }) => Promise<{ success: boolean; videoId?: string; url?: string; error?: string }>;
      /** Real TikTok Content Posting API v2 upload */
      uploadTikTok?: (args: { videoPath: string; title: string; privacyLevel?: string }) => Promise<{ success: boolean; publishId?: string; error?: string }>;
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
      /** Multicam audio waveform sync — FFmpeg PCM extraction + cross-correlation */
      syncMulticamByAudio?: (args: { clips: Array<{ clipId: string; assetPath: string; trimStartSeconds: number; durationSeconds: number }> }) => Promise<{
        success: boolean;
        offsets?: number[];
        error?: string;
      }>;
      /** Auto-Reframe — AI crop to target aspect ratio (9:16, 1:1, 4:5, 16:9, 4:3) */
      reframeAnalyzeAndExport?: (args: {
        sourcePath: string;
        targetAspect: '9:16' | '1:1' | '4:5' | '16:9' | '4:3';
        outputPath: string;
        trackingMode: 'center' | 'face' | 'motion';
      }) => Promise<{ success: boolean; outputPath?: string; cropW?: number; cropH?: number; error?: string }>;
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
