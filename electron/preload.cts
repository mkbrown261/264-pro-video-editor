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
  // Export progress (0-100) sent by main process during rendering
  onExportProgress: (callback: (pct: number) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, pct: number) => callback(pct);
    ipcRenderer.on("export:progress", listener);
    return () => ipcRenderer.removeListener("export:progress", listener);
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
  // ── Phase 9: Publish IPC ──────────────────────────────────────────────────
  generatePublishMetadata: (params: {
    projectName: string;
    durationSeconds: number;
    platforms: string[];
  }): Promise<{ title: string; description: string; tags: string[]; platforms: string[] }> =>
    ipcRenderer.invoke("publish:generate-metadata", params),
  uploadToYouTube: (params: unknown): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("publish:upload-youtube", params),
  uploadToTikTok: (params: unknown): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("publish:upload-tiktok", params),
  transcribeAudio: (args: { filePath: string; language?: string }) =>
    ipcRenderer.invoke('ai:transcribe', args),
  exportLut: (args: { grade: Record<string, number>; name: string }) => ipcRenderer.invoke('lut:export', args),
  // ── Render Cache ─────────────────────────────────────────────────────────
  renderCacheSegment: (args: {
    projectId: string;
    segmentHash: string;
    inputPath: string;
    startSeconds: number;
    durationSeconds: number;
    grade: Record<string, number>;
    speed: number;
  }) => ipcRenderer.invoke('render-cache:render-segment', args),
  getCacheDir: (projectId: string) => ipcRenderer.invoke('render-cache:get-cache-dir', projectId),
  clearRenderCache: (projectId: string) => ipcRenderer.invoke('render-cache:clear', projectId),
  detectHWEncoder: (): Promise<{ success: boolean; encoder: string | null }> =>
    ipcRenderer.invoke('export:detect-hw-encoder'),
  // ── EDL / FCP XML Exchange Formats ────────────────────────────────────────
  exportEDL: (project: unknown): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke('export:edl', project),
  exportFCPXML: (project: unknown): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke('export:fcpxml', project),
  // ── Audio Stems Export ────────────────────────────────────────────────────
  exportStems: (args: { project: unknown; format: string; sampleRate: number; stems: string[] }): Promise<{
    success: boolean;
    files?: Array<{ stem: string; path: string }>;
    canceled?: boolean;
    error?: string;
  }> =>
    ipcRenderer.invoke('export:stems', args),
  // ── Multicam Audio Sync ───────────────────────────────────────────────────
  syncMulticamByAudio: (args: { clips: Array<{ clipId: string; assetPath: string; trimStartSeconds: number; durationSeconds: number }> }) =>
    ipcRenderer.invoke('multicam:sync-by-audio', args),
  // ── Auto-Reframe ──────────────────────────────────────────────────────────
  reframeAnalyzeAndExport: (args: {
    sourcePath: string;
    targetAspect: '9:16' | '1:1' | '4:5' | '16:9' | '4:3';
    outputPath: string;
    trackingMode: 'center' | 'face' | 'motion';
  }): Promise<{ success: boolean; outputPath?: string; cropW?: number; cropH?: number; error?: string }> =>
    ipcRenderer.invoke('reframe:analyze-and-export', args),
  // ── Publish OAuth ─────────────────────────────────────────────────────────
  connectYouTube: () => ipcRenderer.invoke('publish:connect-youtube'),
  connectTikTok: () => ipcRenderer.invoke('publish:connect-tiktok'),
  checkPublishConnection: (platform: string) => ipcRenderer.invoke('publish:check-connection', platform),
  disconnectPublish: (platform: string) => ipcRenderer.invoke('publish:disconnect', platform),
  uploadYouTube: (args: { videoPath: string; title: string; description: string; tags: string[]; privacyStatus?: string }) =>
    ipcRenderer.invoke('publish:upload-youtube', args),
  uploadTikTok: (args: { videoPath: string; title: string; privacyLevel?: string }) =>
    ipcRenderer.invoke('publish:upload-tiktok', args),
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
  // ── AI Video Generation — Seedance 2.0 / Higgsfield / Nano Banana ──────────
  generateVideo: (params: {
    model: string;
    prompt: string;
    imageUrl?: string;
    duration?: number;
    resolution?: string;
    aspectRatio?: string;
    quality?: string;
    cameraMotion?: string;
    style?: string;
    negativePrompt?: string;
  }): Promise<unknown> => ipcRenderer.invoke("flowstate:video-gen", params),
  // Poll video generation job status
  pollVideoGen: (requestId: string, provider: string): Promise<unknown> =>
    ipcRenderer.invoke("flowstate:video-gen-poll", requestId, provider),
  // ── R2 Cloud Storage — persist projects & AI outputs ──────────────────────
  cloudSave: (projectData: unknown): Promise<{ ok: boolean; key?: string; url?: string; error?: string }> =>
    ipcRenderer.invoke("cloud:save", projectData),
  cloudList: (): Promise<{ ok: boolean; files: Array<{ key: string; name: string; size: number; uploaded: string; url: string }>; error?: string }> =>
    ipcRenderer.invoke("cloud:list"),
  cloudLoad: (key: string): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke("cloud:load", key),
  cloudDelete: (key: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("cloud:delete", key),
  // ── AI Tools: pick a local media file via native dialog ───────────────────
  pickMediaFile: (): Promise<{ filePath: string; name: string } | null> =>
    ipcRenderer.invoke("ai:pick-media-file"),
  // ── Sign out of FlowState ─────────────────────────────────────────────────
  signOut: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("flowstate:sign-out"),
};
contextBridge.exposeInMainWorld("flowstateAPI", flowstateAPI);
