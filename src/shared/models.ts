export interface MediaAsset {
  id: string;
  name: string;
  sourcePath: string;
  previewUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
  nativeFps: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export type TimelineTrackKind = "video" | "audio";
export type ClipTransitionType =
  | "fade"
  | "dipBlack"
  | "wipe"
  | "shake"
  | "rumble"
  | "glitch";

export interface ClipTransition {
  type: ClipTransitionType;
  durationFrames: number;
}

export interface TimelineClip {
  id: string;
  assetId: string;
  trackId: string;
  startFrame: number;
  trimStartFrames: number;
  trimEndFrames: number;
  linkedGroupId: string | null;
  isEnabled: boolean;
  transitionIn: ClipTransition | null;
  transitionOut: ClipTransition | null;
}

export interface TimelineTrack {
  id: string;
  name: string;
  kind: TimelineTrackKind;
}

export interface SequenceSettings {
  width: number;
  height: number;
  fps: number;
  audioSampleRate: number;
}

export interface TimelineSequence {
  id: string;
  name: string;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  settings: SequenceSettings;
}

export interface EditorProject {
  id: string;
  name: string;
  assets: MediaAsset[];
  sequence: TimelineSequence;
}

export interface PlaybackState {
  isPlaying: boolean;
  playheadFrame: number;
}

export type EditorTool = "select" | "blade";

export interface EnvironmentStatus {
  ffmpegAvailable: boolean;
  ffprobeAvailable: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  warnings: string[];
}

export interface ExportRequest {
  outputPath: string;
  project: EditorProject;
}

export interface ExportResponse {
  outputPath: string;
  commandPreview: string;
}

export const DEFAULT_SEQUENCE_SETTINGS: SequenceSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  audioSampleRate: 48000
};

export function createId(): string {
  if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }

  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultTracks(): TimelineTrack[] {
  return [
    {
      id: createId(),
      name: "V1",
      kind: "video"
    },
    {
      id: createId(),
      name: "V2",
      kind: "video"
    },
    {
      id: createId(),
      name: "A1",
      kind: "audio"
    },
    {
      id: createId(),
      name: "A2",
      kind: "audio"
    }
  ];
}

export function createEmptyProject(): EditorProject {
  return {
    id: createId(),
    name: "264 Pro Project",
    assets: [],
    sequence: {
      id: createId(),
      name: "Main Timeline",
      tracks: createDefaultTracks(),
      clips: [],
      settings: DEFAULT_SEQUENCE_SETTINGS
    }
  };
}
