// ─────────────────────────────────────────────────────────────────────────────
// 264 Pro Video Editor – Shared Data Models
// ─────────────────────────────────────────────────────────────────────────────

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

// ── Transitions ───────────────────────────────────────────────────────────────

export type ClipTransitionType =
  | "cut"
  | "fade"
  | "dipBlack"
  | "dipWhite"
  | "crossDissolve"
  | "wipe"
  | "wipeLeft"
  | "wipeRight"
  | "wipeUp"
  | "wipeDown"
  | "push"
  | "pushLeft"
  | "pushRight"
  | "zoom"
  | "zoomIn"
  | "zoomOut"
  | "blur"
  | "shake"
  | "rumble"
  | "glitch"
  | "filmBurn"
  | "lensFlare";

export interface ClipTransition {
  type: ClipTransitionType;
  durationFrames: number;
  easingIn?: EasingType;
  easingOut?: EasingType;
}

export type EasingType = "linear" | "easeIn" | "easeOut" | "easeInOut";

// ── Keyframing ────────────────────────────────────────────────────────────────

export interface Keyframe<T> {
  frame: number;   // timeline-absolute frame
  value: T;
  easing?: EasingType;
}

export interface KeyframeTrack<T> {
  property: string;
  keyframes: Keyframe<T>[];
}

// ── Masks ─────────────────────────────────────────────────────────────────────

export type MaskType = "rectangle" | "ellipse" | "bezier";

export interface Vec2 {
  x: number;
  y: number;
}

export interface BezierPoint {
  point: Vec2;
  handleIn: Vec2;
  handleOut: Vec2;
}

export interface MaskShape {
  type: MaskType;
  // Rectangle / Ellipse
  x: number;        // 0-1 normalized
  y: number;        // 0-1 normalized
  width: number;    // 0-1 normalized
  height: number;   // 0-1 normalized
  rotation: number; // degrees
  // Bezier
  points: BezierPoint[];
}

export interface ClipMask {
  id: string;
  name: string;
  shape: MaskShape;
  feather: number;      // 0-100
  opacity: number;      // 0-1
  inverted: boolean;
  expansion: number;    // px, can be negative (contract)
  trackingEnabled: boolean;
  trackingData: TrackingKeyframe[];
  // Keyframe tracks for mask properties
  keyframes: {
    x?: Keyframe<number>[];
    y?: Keyframe<number>[];
    width?: Keyframe<number>[];
    height?: Keyframe<number>[];
    rotation?: Keyframe<number>[];
    feather?: Keyframe<number>[];
    opacity?: Keyframe<number>[];
    expansion?: Keyframe<number>[];
  };
}

export interface TrackingKeyframe {
  frame: number;
  dx: number;   // delta position from original
  dy: number;
}

// ── Color Grade ───────────────────────────────────────────────────────────────

export interface ColorWheelValue {
  lift: number;    // -1 to 1
  gamma: number;   // -1 to 1
  gain: number;    // -1 to 1
  offset: number;  // -1 to 1
}

export interface RGBValue {
  r: number;  // -1 to 1
  g: number;  // -1 to 1
  b: number;  // -1 to 1
}

export interface CurvePoint {
  x: number;  // 0-1
  y: number;  // 0-1
}

export interface ColorCurves {
  master: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
  hueVsHue: CurvePoint[];
  hueVsSat: CurvePoint[];
}

export interface ColorGrade {
  // Primary wheels
  lift: RGBValue;
  gamma: RGBValue;
  gain: RGBValue;
  offset: RGBValue;
  // Sliders
  exposure: number;     // -3 to 3 stops
  contrast: number;     // -1 to 1
  saturation: number;   // 0 to 3 (1 = neutral)
  temperature: number;  // -100 to 100 (0 = neutral)
  tint: number;         // -100 to 100
  // Curves
  curves: ColorCurves;
  // LUT
  lutPath: string | null;
  lutIntensity: number;  // 0-1
  // Masks (which masks are color-grade targets)
  maskIds: string[];
  // Keyframe tracks
  keyframes: {
    exposure?: Keyframe<number>[];
    contrast?: Keyframe<number>[];
    saturation?: Keyframe<number>[];
    temperature?: Keyframe<number>[];
    tint?: Keyframe<number>[];
  };
}

// ── Effects ───────────────────────────────────────────────────────────────────

export type EffectType =
  | "blur"
  | "sharpen"
  | "glow"
  | "brightness"
  | "contrast"
  | "noise"
  | "vignette"
  | "chromaKey"
  | "backgroundRemoval"
  | "colorReplace"
  | "hueShift"
  | "pixelate"
  | "edgeDetect";

export interface ClipEffect {
  id: string;
  type: EffectType;
  enabled: boolean;
  order: number;  // lower = applied first
  params: Record<string, number | string | boolean>;
  maskIds: string[];  // apply only inside these masks
  keyframes: Record<string, Keyframe<number>[]>;
}

// ── Beat Sync ─────────────────────────────────────────────────────────────────

export interface BeatSyncConfig {
  bpm: number;
  beatsPerMeasure: number;
  offset: number;   // frame offset for beat grid
  detectedBeats: number[];  // frame positions
  syncMode: "everyBeat" | "every2" | "every4" | "manual";
  sensitivity: number;  // 0-1
}

// ── Timeline Clip (extended) ──────────────────────────────────────────────────

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
  // Advanced features
  masks: ClipMask[];
  effects: ClipEffect[];
  colorGrade: ColorGrade | null;
  volume: number;  // 0-2
  speed: number;   // 0.1-4.0 (1=normal)
  aiBackgroundRemoval: BackgroundRemovalConfig | null;
  beatSync: BeatSyncConfig | null;
}

// ── Background Removal ────────────────────────────────────────────────────────

export type BackgroundType = "transparent" | "solidColor" | "blur" | "image" | "video";

export interface BackgroundRemovalConfig {
  enabled: boolean;
  edgeRefinement: number;    // 0-1
  spillSuppression: number;  // 0-1
  backgroundType: BackgroundType;
  backgroundColor: string;   // css color for solidColor
  backgroundAssetId: string | null;  // for image/video
  threshold: number;         // 0-1 segmentation threshold
}

// ── Timeline Track ────────────────────────────────────────────────────────────

export interface TimelineTrack {
  id: string;
  name: string;
  kind: TimelineTrackKind;
  muted: boolean;
  locked: boolean;
  solo: boolean;
  height: number;  // px, user-resizable
  color: string;
}

export type TimelineTrackKind = "video" | "audio";

// ── Sequence & Project ────────────────────────────────────────────────────────

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
  beatSync: BeatSyncConfig | null;
  markers: TimelineMarker[];
}

export interface TimelineMarker {
  id: string;
  frame: number;
  label: string;
  color: string;
}

export interface EditorProject {
  id: string;
  name: string;
  assets: MediaAsset[];
  sequence: TimelineSequence;
}

// ── Playback & Editor State ───────────────────────────────────────────────────

export interface PlaybackState {
  isPlaying: boolean;
  playheadFrame: number;
}

export type EditorTool = "select" | "blade";

export type EditorPage = "edit" | "color" | "effects" | "audio";

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

// ── Default Values & Factories ────────────────────────────────────────────────

export const DEFAULT_SEQUENCE_SETTINGS: SequenceSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  audioSampleRate: 48000
};

export function createDefaultColorGrade(): ColorGrade {
  return {
    lift: { r: 0, g: 0, b: 0 },
    gamma: { r: 0, g: 0, b: 0 },
    gain: { r: 0, g: 0, b: 0 },
    offset: { r: 0, g: 0, b: 0 },
    exposure: 0,
    contrast: 0,
    saturation: 1,
    temperature: 0,
    tint: 0,
    curves: {
      master: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      hueVsHue: [],
      hueVsSat: []
    },
    lutPath: null,
    lutIntensity: 1,
    maskIds: [],
    keyframes: {}
  };
}

export function isColorGradeDefault(grade: ColorGrade): boolean {
  return (
    grade.exposure === 0 &&
    grade.contrast === 0 &&
    grade.saturation === 1 &&
    grade.temperature === 0 &&
    grade.tint === 0 &&
    grade.lift.r === 0 && grade.lift.g === 0 && grade.lift.b === 0 &&
    grade.gamma.r === 0 && grade.gamma.g === 0 && grade.gamma.b === 0 &&
    grade.gain.r === 0 && grade.gain.g === 0 && grade.gain.b === 0 &&
    grade.lutPath === null
  );
}

export function createId(): string {
  if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultTracks(): TimelineTrack[] {
  return [
    { id: createId(), name: "V1", kind: "video", muted: false, locked: false, solo: false, height: 56, color: "#4f8ef7" },
    { id: createId(), name: "V2", kind: "video", muted: false, locked: false, solo: false, height: 56, color: "#4f8ef7" },
    { id: createId(), name: "A1", kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#2fc77a" },
    { id: createId(), name: "A2", kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#2fc77a" }
  ];
}

export function createEmptyClip(
  assetId: string,
  trackId: string,
  startFrame: number,
  options: { linkedGroupId?: string | null; isEnabled?: boolean } = {}
): TimelineClip {
  return {
    id: createId(),
    assetId,
    trackId,
    startFrame,
    trimStartFrames: 0,
    trimEndFrames: 0,
    linkedGroupId: options.linkedGroupId ?? null,
    isEnabled: options.isEnabled ?? true,
    transitionIn: null,
    transitionOut: null,
    masks: [],
    effects: [],
    colorGrade: null,
    volume: 1,
    speed: 1,
    aiBackgroundRemoval: null,
    beatSync: null
  };
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
      settings: DEFAULT_SEQUENCE_SETTINGS,
      beatSync: null,
      markers: []
    }
  };
}

export const ALL_TRANSITION_TYPES: Array<{ label: string; value: ClipTransitionType; category: string }> = [
  { label: "Cut", value: "cut", category: "Basic" },
  { label: "Fade", value: "fade", category: "Basic" },
  { label: "Dip to Black", value: "dipBlack", category: "Basic" },
  { label: "Dip to White", value: "dipWhite", category: "Basic" },
  { label: "Cross Dissolve", value: "crossDissolve", category: "Dissolve" },
  { label: "Wipe", value: "wipe", category: "Wipe" },
  { label: "Wipe Left", value: "wipeLeft", category: "Wipe" },
  { label: "Wipe Right", value: "wipeRight", category: "Wipe" },
  { label: "Wipe Up", value: "wipeUp", category: "Wipe" },
  { label: "Wipe Down", value: "wipeDown", category: "Wipe" },
  { label: "Push Left", value: "pushLeft", category: "Push" },
  { label: "Push Right", value: "pushRight", category: "Push" },
  { label: "Zoom In", value: "zoomIn", category: "Zoom" },
  { label: "Zoom Out", value: "zoomOut", category: "Zoom" },
  { label: "Blur", value: "blur", category: "Stylized" },
  { label: "Shake", value: "shake", category: "Stylized" },
  { label: "Rumble", value: "rumble", category: "Stylized" },
  { label: "Glitch", value: "glitch", category: "Stylized" },
  { label: "Film Burn", value: "filmBurn", category: "Stylized" },
  { label: "Lens Flare", value: "lensFlare", category: "Stylized" }
];
