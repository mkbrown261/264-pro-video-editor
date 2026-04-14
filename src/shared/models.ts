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
  /** Normalised peak amplitudes [0..1], one value per ~100ms of source audio. */
  waveformPeaks?: number[];
  /**
   * Fix 6: Filmstrip thumbnail data URLs, one frame every ~2 s of source media.
   * Used to tile a repeating background across clips in the timeline.
   */
  filmstripThumbs?: string[];

  // ── Extended metadata (populated via ffprobe) ─────────────────────────────
  /** File size in bytes */
  fileSize?: number;
  /** Video codec, e.g. "h264", "prores", "hevc" */
  videoCodec?: string;
  /** Audio codec, e.g. "aac", "pcm_s16le" */
  audioCodec?: string;
  /** Number of audio channels */
  audioChannels?: number;
  /** Total bitrate in kbps */
  bitrate?: number;
  /** Color space, e.g. "bt709", "bt2020" */
  colorSpace?: string;
  /** True if asset has HDR metadata (bt2020/pq/hlg) */
  isHDR?: boolean;
  /** Camera rotation in degrees (0, 90, 180, 270) */
  rotation?: number;
  /** Pixel aspect ratio, e.g. "1:1" */
  pixelAspect?: string;
}

// ── Transitions ───────────────────────────────────────────────────────────────

export type ClipTransitionType =
  // Basic
  | "cut"             // Hard cut — no transition
  | "fade"            // Fade to transparent
  | "dipBlack"        // Fade through black
  | "dipWhite"        // Fade through white
  | "dipColor"        // Fade through custom color
  | "additiveDissolve"// Additive blend dissolve
  // Dissolve
  | "crossDissolve"   // A and B blend together (WebGL)
  | "luminanceDissolve" // Dissolve driven by luminance (WebGL)
  | "filmDissolve"    // Film-like organic dissolve
  // Wipe
  | "wipe"            // Generic wipe (left)
  | "wipeLeft"        // Reveal new clip from right
  | "wipeRight"       // Reveal new clip from left
  | "wipeUp"          // Reveal new clip from bottom
  | "wipeDown"        // Reveal new clip from top
  | "wipeDiagTL"      // Diagonal wipe top-left to bottom-right
  | "wipeDiagTR"      // Diagonal wipe top-right to bottom-left
  | "wipeRadial"      // Circular reveal from center
  | "wipeClock"       // Clockhand sweep reveal
  | "wipeStar"        // Star-shaped reveal
  | "wipeBlinds"      // Venetian blinds effect
  | "wipeSplit"       // Split wipe from center
  // Push / Cover / Slide
  | "push"            // Generic push (left)
  | "pushLeft"        // B pushes A out to the left
  | "pushRight"       // B pushes A out to the right
  | "pushUp"          // B pushes A upward
  | "pushDown"        // B pushes A downward
  | "cover"           // B slides over A (A stays)
  | "uncover"         // A slides away revealing B (B stays)
  | "slideLeft"       // A slides left, B fades in
  | "slideRight"      // A slides right, B fades in
  // Zoom / Rotation
  | "zoom"            // Generic zoom in
  | "zoomIn"          // Zoom into cut point
  | "zoomOut"         // Zoom out from cut point
  | "zoomCross"       // A zooms out as B zooms in (WebGL)
  | "whipPan"         // Fast blur pan (horizontal)
  | "spinCW"          // Clockwise spin transition
  | "spinCCW"         // Counter-clockwise spin transition
  // Stylized
  | "blur"            // Blur dissolve (CSS blur)
  | "blurDissolve"    // Blur + opacity dissolve
  | "pixelate"        // Pixelate out then in (WebGL)
  | "shake"           // Camera shake cut
  | "rumble"          // Low-frequency camera rumble
  | "glitch"          // Digital glitch artifact (WebGL)
  | "glitchRgb"       // Intense RGB glitch (WebGL)
  | "filmBurn"        // Light leak organic burn (WebGL)
  | "lensFlare"       // Lens flare sweep
  | "lightLeak"       // Light leak overlay (WebGL)
  | "staticNoise"     // Static noise hit
  | "ripple"          // Water ripple distortion (WebGL)
  | "prism"           // RGB color split diverge
  | "vhsStatic"       // VHS static noise (WebGL alias of vhsRewind)
  // Shape Reveals
  | "irisCircle"      // Circle mask expand (revealCircle)
  | "irisStar"        // Star-shaped reveal
  | "irisHeart"       // Heart-shaped reveal (revealHeart)
  | "diamond"         // Diamond mask expand (revealDiamond)
  | "revealSplitH"    // Split open horizontally
  | "revealSplitV"    // Split open vertically
  // Film / Cinematic
  | "whiteFlash"      // Single white flash frame (WebGL)
  | "blackFlash"      // Single black flash frame (WebGL)
  | "filmFlash"       // Film exposure flash (alias of whiteFlash)
  | "exposure"        // Overexpose then cut
  | "oldFilm"         // Flicker + grain + cut (WebGL)
  | "vhsRewind"       // VHS rewind effect (WebGL)
  | "chromaShift"     // Chromatic aberration sweep
  // Phase 6: Signature transitions
  | "whip_smear"      // Whip pan motion blur smear
  | "light_leak_dissolve" // Light bloom dissolve
  | "digital_shatter";    // Tile shatter reveal

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

export type MaskType = "rectangle" | "ellipse" | "bezier" | "freehand";

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

// ── ColorSlice — six-vector grading ──────────────────────────────────────────

export interface VectorAdjustment {
  hue:        number;  // -180 to +180 degrees
  saturation: number;  // -1 to +1
  luminance:  number;  // -1 to +1
  softness:   number;  // 0-1 (range of color selection)
}

export interface ColorSliceState {
  vectors: {
    red:     VectorAdjustment;
    yellow:  VectorAdjustment;
    green:   VectorAdjustment;
    cyan:    VectorAdjustment;
    blue:    VectorAdjustment;
    magenta: VectorAdjustment;
  };
}

export function createDefaultVectorAdjustment(): VectorAdjustment {
  return { hue: 0, saturation: 0, luminance: 0, softness: 0.5 };
}

export function createDefaultColorSlice(): ColorSliceState {
  return {
    vectors: {
      red:     createDefaultVectorAdjustment(),
      yellow:  createDefaultVectorAdjustment(),
      green:   createDefaultVectorAdjustment(),
      cyan:    createDefaultVectorAdjustment(),
      blue:    createDefaultVectorAdjustment(),
      magenta: createDefaultVectorAdjustment(),
    }
  };
}

// ── Color Still (Gallery) ─────────────────────────────────────────────────────

export interface ColorStill {
  id: string;
  label: string;
  thumbnail: string;       // base64 data URL of viewer frame
  grade: ColorGrade;       // the full grade at time of capture
  capturedAt: number;
  clipId: string;
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
  lutName?: string;      // display name for built-in LUTs
  // ColorSlice six-vector grading
  colorSlice?: ColorSliceState;
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
  /** When true the grade is stored but not applied to the viewer */
  bypass?: boolean;
}

// ── Effects ───────────────────────────────────────────────────────────────────

export type EffectType =
  // Color
  | "blur"
  | "sharpen"
  | "brightness"
  | "contrast"
  | "hueShift"
  | "curves"
  | "colorBalance"
  | "colorTemperature"
  | "vibrance"
  | "shadows"
  // Texture / Film
  | "noise"
  | "filmGrain"
  | "halftone"
  | "oldFilmEffect"
  | "scanlines"
  // Stylized
  | "glow"
  | "vignette"
  | "rgbSplit"
  | "glowWarp"
  | "pixelate"
  | "edgeDetect"
  | "posterize"
  | "solarize"
  | "duotone"
  | "nightVision"
  | "infrared"
  // Distortion
  | "lensDistort"
  | "fishEye"
  | "tiltShift"
  | "motionBlur"
  | "radialBlur"
  | "depthOfField"
  // Keying
  | "chromaKey"
  | "backgroundRemoval"
  | "colorReplace"
  | "lumaKey"
  // Transform
  | "mirror"
  | "kaleidoscope"
  | "vhsEffect"
  | "glitchEffect"
  | "painterly"
  // AI effects
  | "ai_upscale"
  | "ai_denoise"
  | "ai_stabilize"
  | "ai_face_enhance"
  | "ai_color_match"
  | "filmnoise"
  | "chromatic_aberration"
  // DaVinci-parity professional effects
  | "noise_reduction"
  | "sharpening"
  | "film_grain"
  | "lens_distortion"
  | "film_look_creator"
  // Phase 6: Signature effects
  | "glitch_storm"
  | "analog_dream"
  | "clawflow_style"
  // Phase 8: AI-powered effects
  | "face_refinement"
  | "defocus_background";

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

// ── Clip Transform ───────────────────────────────────────────────────────────

export interface ClipTransform {
  posX: number;     // -1 to 1 (fraction of canvas width, 0 = center)
  posY: number;     // -1 to 1 (fraction of canvas height, 0 = center)
  scaleX: number;   // 0.05 to 4  (1 = native size)
  scaleY: number;   // 0.05 to 4  (1 = native size)
  rotation: number; // degrees, -180 to 180
  opacity: number;  // 0 to 1
  anchorX: number;  // 0 to 1 (0.5 = center)
  anchorY: number;  // 0 to 1 (0.5 = center)
}

export const DEFAULT_CLIP_TRANSFORM: ClipTransform = {
  posX: 0, posY: 0,
  scaleX: 1, scaleY: 1,
  rotation: 0,
  opacity: 1,
  anchorX: 0.5, anchorY: 0.5,
};

// ── Adjustment Layer / Clip Type ─────────────────────────────────────────────

export type ClipType = 'media' | 'adjustment' | 'title' | 'nested';

// ── Audio Ducking ─────────────────────────────────────────────────────────────

export interface DuckingSettings {
  enabled: boolean;
  triggerTrackId: string;   // dialogue track that triggers ducking
  targetTrackId: string;    // music/bed track that gets ducked
  threshold: number;        // -60 to 0 dB
  reduction: number;        // 0-1 (how much to reduce target)
  attackMs: number;         // 10-500 ms
  releaseMs: number;        // 100-2000 ms
}

// ── Timeline Clip (extended) ──────────────────────────────────────────────────

export interface TimelineClip {
  id: string;
  assetId: string;
  trackId: string;
  /** 'media' (default) | 'adjustment' | 'title' | 'nested' */
  clipType?: ClipType;
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
  transform: ClipTransform | null;  // null = use default (identity)
  compGraph: import("./compositing.js").CompGraph | null;  // Fusion node graph
  aiBackgroundRemoval: BackgroundRemovalConfig | null;
  beatSync: BeatSyncConfig | null;
  // Keyframe animation tracks
  keyframes?: {
    opacity?: KeyframeTrack<number>;
    volume?: KeyframeTrack<number>;
    posX?: KeyframeTrack<number>;
    posY?: KeyframeTrack<number>;
    scaleX?: KeyframeTrack<number>;
    scaleY?: KeyframeTrack<number>;
    rotation?: KeyframeTrack<number>;
  };
  // Speed ramp (DaVinci Speed Warp)
  speedRampKeyframes?: Array<{ frame: number; speed: number }>;
  opticalFlow?: boolean;
  // Title generator
  titleConfig?: TitleClipConfig;
  // Clip History (UX 3) — up to 5 snapshots
  clipHistory?: ClipHistorySnapshot[];
  // Nested sequence reference (GAP E)
  nestedSequenceId?: string;
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

export interface EQBand {
  id: string;
  type: 'highpass' | 'lowshelf' | 'peak' | 'highshelf' | 'lowpass' | 'notch';
  frequency: number;       // 20-20000 Hz
  gain: number;            // -18 to +18 dB
  q: number;               // 0.1-10
  enabled: boolean;
}

export interface CompressorSettings {
  enabled: boolean;
  threshold: number;   // -60 to 0 dB
  ratio: number;       // 1:1 to 20:1
  attack: number;      // ms
  release: number;     // ms
  makeupGain: number;  // 0 to 24 dB
  knee: number;        // 0 to 10 dB soft knee
}

export interface TimelineTrack {
  id: string;
  name: string;
  kind: TimelineTrackKind;
  muted: boolean;
  locked: boolean;
  solo: boolean;
  height: number;  // px, user-resizable
  color: string;
  volume?: number;  // 0-2, track-level gain (1 = unity)
  eq?: EQBand[];
  compressor?: CompressorSettings;
}

export type TimelineTrackKind = "video" | "audio";

// ── Sequence & Project ────────────────────────────────────────────────────────

export interface SequenceSettings {
  width: number;
  height: number;
  fps: number;
  audioSampleRate: number;
  masterVolume?: number;  // 0-2, master output gain (1 = unity)
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

// ── Render Cache ──────────────────────────────────────────────────────────────

export interface RenderCacheEntry {
  segmentHash: string;    // hash of clipId + grade + effects + trim
  filePath: string;       // absolute path to cached .mp4
  startFrame: number;
  endFrame: number;
  fps: number;
  createdAt: number;      // Date.now()
  valid: boolean;
}

// ── Subtitles ─────────────────────────────────────────────────────────────────

export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
  backgroundColor: string;
  backgroundOpacity: number;
  position: 'bottom' | 'top' | 'center';
  alignment: 'left' | 'center' | 'right';
  outlineWidth: number;
  outlineColor: string;
  shadowOffset: number;
}

export interface SubtitleCue {
  id: string;
  startFrame: number;
  endFrame: number;
  text: string;
  style: SubtitleStyle;
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: 'Arial', fontSize: 42, bold: false, italic: false,
  color: '#ffffff', backgroundColor: 'transparent', backgroundOpacity: 0.6,
  position: 'bottom', alignment: 'center', outlineWidth: 2, outlineColor: '#000000',
  shadowOffset: 2,
};

// ── Title Generator ───────────────────────────────────────────────────────────

export type TitlePreset =
  | 'lower_third'
  | 'full_screen'
  | 'kinetic_text'
  | 'minimal'
  | 'broadcast'
  | 'credits';

export interface TitleClipConfig {
  preset: TitlePreset;
  mainText: string;
  subText?: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  bgColor: string;
  bgOpacity: number;
  animationIn: 'fade' | 'slide_up' | 'slide_right' | 'typewriter' | 'none';
  animationOut: 'fade' | 'slide_down' | 'slide_left' | 'none';
  durationFrames: number;
  posX: number;
  posY: number;
}

// ── Text-Based Editing ────────────────────────────────────────────────────────

export interface TranscriptWord {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
  selected: boolean;
}

export interface Transcript {
  assetId: string;
  words: TranscriptWord[];
  language: string;
  generatedAt: number;
}

// ── Project Metadata (GAP B) ──────────────────────────────────────────────────

export interface ProjectMetadata {
  director?: string;
  dp?: string;
  editor?: string;
  client?: string;
  deadline?: string;
  notes?: string;
}

// ── Clip History Snapshot (UX 3) ──────────────────────────────────────────────

export interface ClipHistorySnapshot {
  id: string;
  label: string;
  capturedAt: number;
  trimStartFrames: number;
  trimEndFrames: number;
  colorGrade: ColorGrade | null;
  effects: ClipEffect[];
  volume: number;
  speed: number;
}

// ── Nested Sequences (GAP E) ──────────────────────────────────────────────────

export type EditorSequence = TimelineSequence;

// ── EditorProject ─────────────────────────────────────────────────────────────

export interface EditorProject {
  id: string;
  name: string;
  assets: MediaAsset[];
  sequence: TimelineSequence;
  subtitleCues?: SubtitleCue[];
  transcripts?: Record<string, Transcript>;   // keyed by assetId
  colorStills?: ColorStill[];
  metadata?: ProjectMetadata;
  nestedSequences?: Record<string, EditorSequence>;
  compoundNodes?: Array<{ id: string; label: string; nodeIds: string[] }>;
  /** Phase 8: Audio ducking configurations */
  duckingSettings?: DuckingSettings[];
  /** Render cache — pre-rendered segments baked with grades + effects */
  renderCacheEnabled?: boolean;
  renderCacheEntries?: Record<string, RenderCacheEntry>; // key = segmentHash
}

// ── Playback & Editor State ───────────────────────────────────────────────────

export interface PlaybackState {
  isPlaying: boolean;
  playheadFrame: number;
}

export type EditorTool = "select" | "blade";

export type EditorPage = "edit" | "color" | "effects" | "audio" | "fusion";

export interface EnvironmentStatus {
  ffmpegAvailable: boolean;
  ffprobeAvailable: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  warnings: string[];
}

export type ExportCodec = "libx264" | "libx265" | "prores_ks" | "libvpx-vp9";

export interface ExportResolutionPreset {
  label: string;
  width: number;
  height: number;
}

export const EXPORT_RESOLUTION_PRESETS: ExportResolutionPreset[] = [
  { label: "Original", width: 0, height: 0 },
  { label: "4K (3840×2160)", width: 3840, height: 2160 },
  { label: "1080p (1920×1080)", width: 1920, height: 1080 },
  { label: "720p (1280×720)", width: 1280, height: 720 },
  { label: "Vertical 1080p (1080×1920)", width: 1080, height: 1920 },
  { label: "Square (1080×1080)", width: 1080, height: 1080 },
];

export interface ExportRequest {
  outputPath: string;
  project: EditorProject;
  /** Video codec to use. Defaults to libx264 if omitted. */
  codec?: ExportCodec;
  /** Override output resolution. 0×0 means use sequence settings. */
  outputWidth?: number;
  outputHeight?: number;
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
    keyframes: {},
    bypass: false,
    colorSlice: createDefaultColorSlice()
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
    transform: null,
    compGraph: null,
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

export const TRANSITION_CATEGORIES = ["Basic", "Dissolve", "Wipe", "Push", "Zoom", "Stylized", "Shape", "Cinematic"] as const;
export type TransitionCategory = typeof TRANSITION_CATEGORIES[number];

export const ALL_TRANSITION_TYPES: Array<{ label: string; value: ClipTransitionType; category: TransitionCategory; webgl?: boolean }> = [
  // Basic
  { label: "Cut",               value: "cut",              category: "Basic" },
  { label: "Fade",              value: "fade",             category: "Basic" },
  { label: "Dip to Black",      value: "dipBlack",         category: "Basic" },
  { label: "Dip to White",      value: "dipWhite",         category: "Basic" },
  { label: "Dip to Color",      value: "dipColor",         category: "Basic" },
  { label: "Additive Dissolve", value: "additiveDissolve", category: "Basic", webgl: true },
  // Dissolve
  { label: "Cross Dissolve",    value: "crossDissolve",    category: "Dissolve", webgl: true },
  { label: "Luminance Dissolve",value: "luminanceDissolve",category: "Dissolve", webgl: true },
  { label: "Film Dissolve",     value: "filmDissolve",     category: "Dissolve", webgl: true },
  // Wipe
  { label: "Wipe Left",         value: "wipeLeft",         category: "Wipe" },
  { label: "Wipe Right",        value: "wipeRight",        category: "Wipe" },
  { label: "Wipe Up",           value: "wipeUp",           category: "Wipe" },
  { label: "Wipe Down",         value: "wipeDown",         category: "Wipe" },
  { label: "Diagonal Wipe ↘",   value: "wipeDiagTL",       category: "Wipe" },
  { label: "Diagonal Wipe ↙",   value: "wipeDiagTR",       category: "Wipe" },
  { label: "Radial Wipe",       value: "wipeRadial",       category: "Wipe" },
  { label: "Clock Wipe",        value: "wipeClock",        category: "Wipe" },
  { label: "Star Wipe",         value: "wipeStar",         category: "Wipe" },
  { label: "Blinds",            value: "wipeBlinds",       category: "Wipe" },
  { label: "Split Wipe",        value: "wipeSplit",        category: "Wipe" },
  // Push / Cover / Slide
  { label: "Push Left",         value: "pushLeft",         category: "Push" },
  { label: "Push Right",        value: "pushRight",        category: "Push" },
  { label: "Push Up",           value: "pushUp",           category: "Push" },
  { label: "Push Down",         value: "pushDown",         category: "Push" },
  { label: "Cover",             value: "cover",            category: "Push" },
  { label: "Uncover",           value: "uncover",          category: "Push" },
  { label: "Slide Left",        value: "slideLeft",        category: "Push" },
  { label: "Slide Right",       value: "slideRight",       category: "Push" },
  // Zoom / Rotation
  { label: "Zoom In",           value: "zoomIn",           category: "Zoom" },
  { label: "Zoom Out",          value: "zoomOut",          category: "Zoom" },
  { label: "Zoom Cross",        value: "zoomCross",        category: "Zoom", webgl: true },
  { label: "Whip Pan",          value: "whipPan",          category: "Zoom" },
  { label: "Spin CW",           value: "spinCW",           category: "Zoom" },
  { label: "Spin CCW",          value: "spinCCW",          category: "Zoom" },
  // Stylized
  { label: "Blur",              value: "blur",             category: "Stylized" },
  { label: "Blur Dissolve",     value: "blurDissolve",     category: "Stylized" },
  { label: "Pixelate",          value: "pixelate",         category: "Stylized", webgl: true },
  { label: "Ripple",            value: "ripple",           category: "Stylized", webgl: true },
  { label: "Glitch",            value: "glitch",           category: "Stylized", webgl: true },
  { label: "Glitch RGB",        value: "glitchRgb",        category: "Stylized", webgl: true },
  { label: "Film Burn",         value: "filmBurn",         category: "Stylized", webgl: true },
  { label: "Lens Flare",        value: "lensFlare",        category: "Stylized" },
  { label: "Light Leak",        value: "lightLeak",        category: "Stylized", webgl: true },
  { label: "Static Noise",      value: "staticNoise",      category: "Stylized" },
  { label: "Shake",             value: "shake",            category: "Stylized" },
  { label: "Rumble",            value: "rumble",           category: "Stylized" },
  { label: "Prism",             value: "prism",            category: "Stylized" },
  { label: "VHS Static",        value: "vhsStatic",        category: "Stylized", webgl: true },
  // Shape Reveals
  { label: "Iris Circle",       value: "irisCircle",       category: "Shape" },
  { label: "Iris Star",         value: "irisStar",         category: "Shape" },
  { label: "Iris Heart",        value: "irisHeart",        category: "Shape" },
  { label: "Diamond",           value: "diamond",          category: "Shape" },
  { label: "Split Horizontal",  value: "revealSplitH",     category: "Shape" },
  { label: "Split Vertical",    value: "revealSplitV",     category: "Shape" },
  // Film / Cinematic
  { label: "White Flash",       value: "whiteFlash",       category: "Cinematic", webgl: true },
  { label: "Black Flash",       value: "blackFlash",       category: "Cinematic", webgl: true },
  { label: "Film Flash",        value: "filmFlash",        category: "Cinematic", webgl: true },
  { label: "Exposure",          value: "exposure",         category: "Cinematic" },
  { label: "Old Film",          value: "oldFilm",          category: "Cinematic", webgl: true },
  { label: "VHS Rewind",        value: "vhsRewind",        category: "Cinematic", webgl: true },
  { label: "Chroma Shift",      value: "chromaShift",      category: "Cinematic" },
  // Phase 6: Signature transitions
  { label: "Whip Smear",        value: "whip_smear",       category: "Stylized" },
  { label: "Light Leak Dissolve",value: "light_leak_dissolve", category: "Cinematic" },
  { label: "Digital Shatter",   value: "digital_shatter",  category: "Stylized" },
];
