import React, { useState, useRef, useCallback, useEffect } from "react";
import type {
  BackgroundRemovalConfig,
  ClipEffect,
  ClipMask,
  ClipTransitionType,
  ColorGrade,
  EnvironmentStatus,
  ExportCodec,
  MediaAsset
} from "../../shared/models";
import { ALL_TRANSITION_TYPES, EXPORT_RESOLUTION_PRESETS } from "../../shared/models";
import type { TimelineSegment } from "../../shared/timeline";
import { formatDuration, formatTimecode } from "../lib/format";
import { MaskInspector, type MaskTool } from "./MaskingCanvas";
import { EffectsPanel } from "./EffectsPanel";

type InspectorTab = "clip" | "transform" | "masks" | "effects" | "audio" | "voice" | "export";

// ── ClipTransform (local UI type — persisted via onSetClipTransform) ──────────
export interface ClipTransformValues {
  posX: number;       // -1 to 1 (fraction of canvas width)
  posY: number;       // -1 to 1 (fraction of canvas height)
  scaleX: number;     // 0.1 to 4
  scaleY: number;     // 0.1 to 4
  rotation: number;   // degrees, -180 to 180
  opacity: number;    // 0 to 1
  anchorX: number;    // 0 to 1 (normalized, 0.5 = center)
  anchorY: number;    // 0 to 1 (normalized, 0.5 = center)
}

export const DEFAULT_TRANSFORM: ClipTransformValues = {
  posX: 0, posY: 0,
  scaleX: 1, scaleY: 1,
  rotation: 0,
  opacity: 1,
  anchorX: 0.5, anchorY: 0.5,
};

interface InspectorPanelProps {
  // State
  selectedAsset: MediaAsset | null;
  selectedSegment: TimelineSegment | null;
  environment: EnvironmentStatus | null;
  exportBusy: boolean;
  exportMessage: string | null;
  clipMessage: string | null;
  sequenceSettings: { width: number; height: number; fps: number; audioSampleRate: number };

  // Voice Chop AI
  voiceListening: boolean;
  voiceStatus: string;
  voiceTranscript: string;
  voiceLastCommand: string | null;
  voiceSuggestedCutFrames: number[];
  voiceMarkInFrame: number | null;
  voiceMarkOutFrame: number | null;
  voiceBpm: number;
  voiceGridFrames: number;
  detectedBpm: number | null;
  detectedBeatFrames: number[];

  // Masks
  activeMaskTool: MaskTool;
  selectedMaskId: string | null;
  onSetActiveMaskTool: (tool: MaskTool) => void;
  onSelectMask: (id: string | null) => void;
  onAddMask: (mask: ClipMask) => void;
  onUpdateMask: (maskId: string, updates: Partial<ClipMask>) => void;
  onRemoveMask: (maskId: string) => void;

  // Effects
  onAddEffect: (effect: ClipEffect) => void;
  onUpdateEffect: (effectId: string, updates: Partial<ClipEffect>) => void;
  onRemoveEffect: (effectId: string) => void;
  onToggleEffect: (effectId: string) => void;
  onReorderEffects: (from: number, to: number) => void;
  onToggleBackgroundRemoval: () => void;
  onSetBackgroundRemoval: (config: Partial<BackgroundRemovalConfig>) => void;
  /** Phase 8: add keyframe for an effect parameter */
  onAddEffectKeyframe?: (effectId: string, paramKey: string, frame: number, value: number) => void;
  /** Bezier curve editor: replace all keyframes for an effect param */
  onUpdateEffectKeyframes?: (effectId: string, paramName: string, keyframes: import("./KeyframeCurveEditor").CurveKeyframe[]) => void;
  /** Phase 8: current playhead frame (for effect keyframing) */
  currentPlayheadFrame?: number;
  /** Total timeline frames (for curve editor) */
  totalFrames?: number;

  // Clip actions
  onToggleClipEnabled: (clipId: string) => void;
  onDetachLinkedClips: (clipId: string) => void;
  onRelinkClips?: (clipId: string) => void;
  onSetTransitionType: (edge: "in" | "out", type: ClipTransitionType) => void;
  onSetTransitionDuration: (edge: "in" | "out", durationFrames: number) => void;
  onExtractAudio: () => void;
  onRippleDelete: () => void;
  onSetClipVolume: (volume: number) => void;
  onSetClipSpeed: (speed: number) => void;
  // Speed Ramp
  onSetSpeedRampKeyframes?: (kf: Array<{ frame: number; speed: number }>) => void;
  onSetOpticalFlow?: (enabled: boolean) => void;
  onSetOpticalFlowQuality?: (quality: 'draft' | 'good' | 'best') => void;

  // Transform
  clipTransform?: ClipTransformValues | null;
  onSetClipTransform?: (transform: Partial<ClipTransformValues>) => void;

  // Voice Chop AI
  onToggleVoiceListening: () => void;
  onAnalyzeVoiceChops: () => void;
  onDetectBpm: () => void;
  onBeatSync: (mode: "everyBeat" | "every2" | "every4") => void;
  onAcceptVoiceCuts: () => void;
  onClearVoiceCuts: () => void;
  onQuantizeVoiceCutsToBeat: () => void;
  onQuantizeVoiceCutsToGrid: () => void;
  onSetVoiceBpm: (bpm: number) => void;
  onSetVoiceGridFrames: (gridFrames: number) => void;

  // Export
  onExport: (opts?: { codec?: ExportCodec; outputWidth?: number; outputHeight?: number }) => Promise<void>;
  onAddToQueue?: (opts: { codec: ExportCodec; outputWidth: number; outputHeight: number; label: string }) => void;
  exportProgress?: number;

  // Color grade (for effects page display)
  colorGrade?: ColorGrade | null;

  // Video ref for motion tracking in masks
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

// ── Complete TRANSITION_ICONS ─────────────────────────────────────────────────
const TRANSITION_ICONS: Record<ClipTransitionType, string> = {
  // Basic
  cut:              "│",
  fade:             "↔",
  dipBlack:         "▼",
  dipWhite:         "▽",
  dipColor:         "◈",
  additiveDissolve: "⊕",
  // Dissolve
  crossDissolve:    "✕",
  luminanceDissolve:"◑",
  filmDissolve:     "⊛",
  // Wipe (generic + directional)
  wipe:             "→",
  wipeLeft:         "◀",
  wipeRight:        "▶",
  wipeUp:           "▲",
  wipeDown:         "▼",
  wipeDiagTL:       "◢",
  wipeDiagTR:       "◣",
  wipeRadial:       "◎",
  wipeClock:        "⏱",
  wipeStar:         "★",
  wipeBlinds:       "≡",
  wipeSplit:        "⇔",
  // Push / Cover / Slide (generic + directional)
  push:             "⇒",
  pushLeft:         "⇐",
  pushRight:        "⇒",
  pushUp:           "⇑",
  pushDown:         "⇓",
  cover:            "▣",
  uncover:          "▢",
  slideLeft:        "←",
  slideRight:       "→",
  // Zoom / Rotation
  zoom:             "⊕",
  zoomIn:           "⊕",
  zoomOut:          "⊖",
  zoomCross:        "⊗",
  whipPan:          "⟹",
  spinCW:           "↻",
  spinCCW:          "↺",
  // Stylized
  blur:             "◎",
  blurDissolve:     "⊙",
  pixelate:         "⊞",
  shake:            "≋",
  rumble:           "〰",
  glitch:           "▣",
  glitchRgb:        "▤",
  filmBurn:         "🎞",
  lensFlare:        "✦",
  lightLeak:        "☀",
  staticNoise:      "░",
  ripple:           "≈",
  prism:            "◁",
  vhsStatic:        "▒",
  // Shape Reveals
  irisCircle:       "◉",
  irisStar:         "★",
  irisHeart:        "♥",
  diamond:          "◆",
  revealSplitH:     "⇕",
  revealSplitV:     "⇔",
  // Film / Cinematic
  whiteFlash:       "□",
  blackFlash:       "■",
  filmFlash:        "⚡",
  exposure:         "☼",
  oldFilm:          "📽",
  vhsRewind:        "⏪",
  chromaShift:      "⧖",
  // Phase 3+ transitions
  whip_smear:           "⟹",
  light_leak_dissolve:  "☀",
  digital_shatter:      "⊞",
};

// Fallback icon for any unknown transition (safety)
function transIcon(type: ClipTransitionType): string {
  return TRANSITION_ICONS[type] ?? "→";
}

const TRANSITION_CATEGORIES = Array.from(new Set(ALL_TRANSITION_TYPES.map((t) => t.category)));

// ── Collapsible section (Fix 9: persists open/closed state per section label) ─
function CollapsibleCard({
  label,
  defaultOpen = true,
  children,
  badge,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: string | number | null;
}) {
  // Persist each section's open/closed state in localStorage keyed by label
  const storageKey = `264pro_insp_${label.toLowerCase().replace(/\s+/g, "_")}`;
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? stored === "true" : defaultOpen;
    } catch {
      return defaultOpen;
    }
  });

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      try { localStorage.setItem(storageKey, String(next)); } catch { /* noop */ }
      return next;
    });
  };

  return (
    <div className={`inspector-card collapsible${open ? " open" : " closed"}`}>
      <button
        className="collapsible-header"
        onClick={toggle}
        type="button"
      >
        <span className="collapsible-arrow">{open ? "▾" : "▸"}</span>
        <span className="collapsible-label">{label}</span>
        {badge != null && badge !== "" && (
          <span className="collapsible-badge">{badge}</span>
        )}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

// ── Volume control ─────────────────────────────────────────────────────────────
function VolumeControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = Math.round(value * 100);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="field">
      <label className="field-header">
        <span>Volume</span>
        <div className="field-value-row">
          <input
            ref={inputRef}
            className="numeric-input"
            type="number"
            min={0} max={200} step={1}
            value={pct}
            onChange={(e) => {
              const v = Math.min(200, Math.max(0, Number(e.target.value)));
              onChange(v / 100);
            }}
          />
          <span className="field-unit">%</span>
        </div>
      </label>
      <input
        type="range" min={0} max={2} step={0.01}
        value={value}
        onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="range-labels">
        <span>0%</span><span>100%</span><span>200%</span>
      </div>
    </div>
  );
}

// ── Speed control ─────────────────────────────────────────────────────────────
function SpeedControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="field">
      <label className="field-header">
        <span>Speed</span>
        <div className="field-value-row">
          <input
            ref={inputRef}
            className="numeric-input"
            type="number"
            min={0.25} max={4} step={0.05}
            value={value.toFixed(2)}
            onChange={(e) => {
              const v = Math.min(4, Math.max(0.25, Number(e.target.value)));
              onChange(v);
            }}
          />
          <span className="field-unit">×</span>
        </div>
      </label>
      <input
        type="range" min={0.25} max={4} step={0.05}
        value={value}
        onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="range-labels">
        <span>0.25×</span><span>1×</span><span>2×</span><span>4×</span>
      </div>
    </div>
  );
}

// ── Speed Ramp ────────────────────────────────────────────────────────────────

const SPEED_PRESETS = {
  smash:     [{ f: 0, s: 2 }, { f: 0.25, s: 0.25 }, { f: 0.5, s: 0.25 }, { f: 1, s: 1 }],
  wave:      [{ f: 0, s: 0.5 }, { f: 0.5, s: 2 }, { f: 1, s: 0.5 }],
  cinematic: [{ f: 0, s: 1 }, { f: 0.6, s: 1 }, { f: 1, s: 0.3 }],
  rampUp:    [{ f: 0, s: 0.3 }, { f: 1, s: 2 }],
} as const;

type SpeedPresetKey = keyof typeof SPEED_PRESETS;

function presetToKeyframes(
  preset: ReadonlyArray<{ f: number; s: number }>,
  clipDurationFrames: number
): Array<{ frame: number; speed: number }> {
  return preset.map(p => ({ frame: Math.round(p.f * clipDurationFrames), speed: p.s }));
}

// Canvas constants
const CANVAS_W = 280;
const CANVAS_H = 80;
const SPEED_MIN = 0.1;
const SPEED_MAX = 4;
// Total frame range used for X-axis mapping (matches existing convention)
const CANVAS_TOTAL_FRAMES = 300;
const HIT_RADIUS = 8; // px distance to detect a keyframe for drag/right-click

function speedToY(speed: number, H: number): number {
  return H - ((speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * H;
}

function yToSpeed(y: number, H: number): number {
  return SPEED_MIN + ((H - y) / H) * (SPEED_MAX - SPEED_MIN);
}

function frameToX(frame: number, W: number): number {
  return (frame / CANVAS_TOTAL_FRAMES) * W;
}

function xToFrame(x: number, W: number): number {
  return Math.round((x / W) * CANVAS_TOTAL_FRAMES);
}

/** Ease-in-out cubic interpolation between two values */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Interpolate speed at a given frame position between two keyframes */
function interpolateSpeed(
  frame: number,
  kfA: { frame: number; speed: number },
  kfB: { frame: number; speed: number },
  easing: "linear" | "ease"
): number {
  if (kfB.frame === kfA.frame) return kfA.speed;
  const t = (frame - kfA.frame) / (kfB.frame - kfA.frame);
  const tEased = easing === "ease" ? easeInOut(t) : t;
  return kfA.speed + (kfB.speed - kfA.speed) * tEased;
}

function drawSpeedRampCanvas(
  canvas: HTMLCanvasElement,
  keyframes: Array<{ frame: number; speed: number }>,
  easing: "linear" | "ease",
  dragIndex: number | null
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;

  // Background
  ctx.fillStyle = "#0a0f1a";
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 0.5;
  [0.25, 0.5, 0.75].forEach(frac => {
    ctx.beginPath();
    ctx.moveTo(0, frac * H);
    ctx.lineTo(W, frac * H);
    ctx.stroke();
  });
  [0.25, 0.5, 0.75].forEach(frac => {
    ctx.beginPath();
    ctx.moveTo(frac * W, 0);
    ctx.lineTo(frac * W, H);
    ctx.stroke();
  });

  // 1× speed reference line (purple dashed)
  const oneY = speedToY(1, H);
  ctx.strokeStyle = "rgba(168,85,247,0.35)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, oneY);
  ctx.lineTo(W, oneY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Curve
  if (keyframes.length >= 2) {
    const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);

    // Draw filled area under curve
    ctx.beginPath();
    const firstX = frameToX(sorted[0].frame, W);
    const firstY = speedToY(sorted[0].speed, H);
    ctx.moveTo(firstX, H);
    ctx.lineTo(firstX, firstY);

    const STEPS = 120;
    for (let s = 0; s <= STEPS; s++) {
      const frame = sorted[0].frame + (s / STEPS) * (sorted[sorted.length - 1].frame - sorted[0].frame);
      // Find segment
      let segIdx = 0;
      for (let k = 0; k < sorted.length - 1; k++) {
        if (frame >= sorted[k].frame) segIdx = k;
      }
      const speed = interpolateSpeed(frame, sorted[segIdx], sorted[Math.min(segIdx + 1, sorted.length - 1)], easing);
      const cx = frameToX(frame, W);
      const cy = speedToY(speed, H);
      ctx.lineTo(cx, cy);
    }
    const lastX = frameToX(sorted[sorted.length - 1].frame, W);
    ctx.lineTo(lastX, H);
    ctx.closePath();
    ctx.fillStyle = "rgba(168,85,247,0.08)";
    ctx.fill();

    // Draw the curve line
    ctx.beginPath();
    ctx.moveTo(firstX, firstY);
    for (let s = 1; s <= STEPS; s++) {
      const frame = sorted[0].frame + (s / STEPS) * (sorted[sorted.length - 1].frame - sorted[0].frame);
      let segIdx = 0;
      for (let k = 0; k < sorted.length - 1; k++) {
        if (frame >= sorted[k].frame) segIdx = k;
      }
      const speed = interpolateSpeed(frame, sorted[segIdx], sorted[Math.min(segIdx + 1, sorted.length - 1)], easing);
      ctx.lineTo(frameToX(frame, W), speedToY(speed, H));
    }
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Keyframe diamond dots
    sorted.forEach((kf, idx) => {
      const kx = frameToX(kf.frame, W);
      const ky = speedToY(kf.speed, H);
      const isDragging = dragIndex === keyframes.indexOf(kf) || dragIndex === idx;

      // Outer glow when dragging
      if (isDragging) {
        ctx.beginPath();
        ctx.arc(kx, ky, 7, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(168,85,247,0.3)";
        ctx.fill();
      }

      // Diamond shape
      ctx.save();
      ctx.translate(kx, ky);
      ctx.rotate(Math.PI / 4);
      const ds = isDragging ? 5 : 4;
      ctx.beginPath();
      ctx.rect(-ds, -ds, ds * 2, ds * 2);
      ctx.fillStyle = isDragging ? "#e9d5ff" : "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#a855f7";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      // Speed label
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = "bold 8px system-ui";
      const label = `${kf.speed.toFixed(2)}×`;
      const lx = Math.min(W - 24, Math.max(2, kx - 10));
      const ly = ky < 14 ? ky + 14 : ky - 5;
      ctx.fillText(label, lx, ly);
    });
  } else if (keyframes.length === 1) {
    // Single keyframe dot
    const kf = keyframes[0];
    const kx = frameToX(kf.frame, W);
    const ky = speedToY(kf.speed, H);
    ctx.beginPath();
    ctx.arc(kx, ky, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#a855f7";
    ctx.fill();
  }

  // Axis labels
  ctx.fillStyle = "rgba(100,116,139,0.9)";
  ctx.font = "8px system-ui";
  ctx.fillText("4×", 2, 9);
  ctx.fillText("1×", 2, oneY - 2);
  ctx.fillText("0.1×", 2, H - 2);
}

function SpeedRampSection({
  clip,
  onSetSpeedRampKeyframes,
  onSetOpticalFlow,
  onSetOpticalFlowQuality,
}: {
  clip: import("../../shared/models").TimelineClip;
  onSetSpeedRampKeyframes: (kf: Array<{ frame: number; speed: number }>) => void;
  onSetOpticalFlow: (enabled: boolean) => void;
  onSetOpticalFlowQuality?: (quality: 'draft' | 'good' | 'best') => void;
}) {
  const speedRampCanvasRef = useRef<HTMLCanvasElement>(null);
  const [easing, setEasing] = useState<"linear" | "ease">("linear");
  const opticalFlowEnabled = clip.opticalFlow ?? false;
  const keyframes = clip.speedRampKeyframes ?? [];

  // Drag state (ref to avoid stale closures in event handlers)
  const dragIndexRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Clip duration frames for preset scaling
  const clipDurationFrames = CANVAS_TOTAL_FRAMES;

  // Redraw canvas whenever keyframes, easing, or drag state changes
  useEffect(() => {
    const canvas = speedRampCanvasRef.current;
    if (!canvas) return;
    drawSpeedRampCanvas(canvas, keyframes, easing, dragIndex);
  }, [keyframes, easing, dragIndex]);

  // Find nearest keyframe index within hit radius
  const findNearestKf = useCallback((
    cx: number, cy: number, W: number, H: number
  ): number => {
    let nearest = -1;
    let nearestDist = HIT_RADIUS;
    keyframes.forEach((kf, idx) => {
      const kx = frameToX(kf.frame, W);
      const ky = speedToY(kf.speed, H);
      const dist = Math.sqrt((cx - kx) ** 2 + (cy - ky) ** 2);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = idx;
      }
    });
    return nearest;
  }, [keyframes]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return; // left button only
    const canvas = speedRampCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const W = canvas.width;
    const H = canvas.height;

    const nearestIdx = findNearestKf(cx, cy, W, H);
    if (nearestIdx >= 0) {
      // Start dragging existing keyframe
      dragIndexRef.current = nearestIdx;
      isDraggingRef.current = true;
      setDragIndex(nearestIdx);
    } else {
      // Add new keyframe at click position
      const frame = xToFrame(cx, W);
      const speed = Math.max(SPEED_MIN, Math.min(SPEED_MAX, yToSpeed(cy, H)));
      const newKfs = [
        ...keyframes.filter(k => Math.abs(k.frame - frame) > 5),
        { frame, speed },
      ].sort((a, b) => a.frame - b.frame);
      onSetSpeedRampKeyframes(newKfs);
    }
  }, [keyframes, findNearestKf, onSetSpeedRampKeyframes]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current || dragIndexRef.current === null) return;
    const canvas = speedRampCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const W = canvas.width;
    const H = canvas.height;

    const idx = dragIndexRef.current;
    const newFrame = Math.max(0, Math.min(CANVAS_TOTAL_FRAMES, xToFrame(cx, W)));
    const newSpeed = Math.max(SPEED_MIN, Math.min(SPEED_MAX, yToSpeed(cy, H)));

    const updated = keyframes.map((kf, i) =>
      i === idx ? { frame: newFrame, speed: newSpeed } : kf
    );
    onSetSpeedRampKeyframes(updated);
  }, [keyframes, onSetSpeedRampKeyframes]);

  const handleMouseUp = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      dragIndexRef.current = null;
      setDragIndex(null);
    }
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = speedRampCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const W = canvas.width;
    const H = canvas.height;

    const nearestIdx = findNearestKf(cx, cy, W, H);
    if (nearestIdx >= 0) {
      onSetSpeedRampKeyframes(keyframes.filter((_, i) => i !== nearestIdx));
    }
  }, [keyframes, findNearestKf, onSetSpeedRampKeyframes]);

  const applyPreset = useCallback((key: SpeedPresetKey) => {
    const kfs = presetToKeyframes(SPEED_PRESETS[key], clipDurationFrames);
    onSetSpeedRampKeyframes(kfs);
  }, [clipDurationFrames, onSetSpeedRampKeyframes]);

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
        Speed Ramp
      </div>

      {/* Preset buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4, marginBottom: 8 }}>
        {([
          { key: "smash",     label: "⚡ Smash" },
          { key: "wave",      label: "🌊 Wave" },
          { key: "cinematic", label: "🎬 Cinematic" },
          { key: "rampUp",    label: "🔥 Ramp Up" },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => applyPreset(key)}
            style={{
              padding: "4px 2px", borderRadius: 5, border: "1px solid rgba(168,85,247,0.25)",
              background: "rgba(168,85,247,0.08)", color: "#c4b5fd",
              fontSize: 9, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis",
            }}
            title={label}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <canvas
        ref={speedRampCanvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        style={{
          width: "100%", height: CANVAS_H,
          borderRadius: 6, background: "#0a0f1a",
          cursor: isDraggingRef.current ? "grabbing" : "crosshair",
          display: "block", userSelect: "none",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleContextMenu}
        title="Click to add keyframe · Drag to move · Right-click to remove"
      />
      <div style={{ fontSize: 9, color: "#475569", marginTop: 3, textAlign: "center" }}>
        Click to add · Drag to move · Right-click to remove
      </div>

      {/* Easing mode */}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <span style={{ fontSize: 10, color: "#64748b", alignSelf: "center", marginRight: 2 }}>Easing:</span>
        {(["linear", "ease"] as const).map(mode => (
          <button key={mode} onClick={() => setEasing(mode)} style={{
            flex: 1, padding: "4px 0", borderRadius: 5, border: "none",
            background: easing === mode ? "#7c3aed" : "rgba(255,255,255,0.07)",
            color: "white", fontSize: 10, fontWeight: 600, cursor: "pointer",
            textTransform: "capitalize" as const,
          }}>
            {mode === "linear" ? "Linear" : "Ease"}
          </button>
        ))}
      </div>

      {/* Clear button */}
      {keyframes.length > 0 && (
        <button
          onClick={() => onSetSpeedRampKeyframes([])}
          style={{
            marginTop: 6, width: "100%", padding: "4px", borderRadius: 5,
            border: "none", background: "rgba(239,68,68,0.12)",
            color: "#f87171", fontSize: 10, fontWeight: 600, cursor: "pointer",
          }}
        >
          Clear Keyframes ({keyframes.length})
        </button>
      )}
      {/* ── Optical Flow / FlowWarp ─────────────────────────────────── */}
      <div style={{
        marginTop: 12,
        padding: 12,
        background: opticalFlowEnabled ? 'rgba(124,58,237,0.12)' : 'rgba(15,23,42,0.8)',
        border: `1px solid ${opticalFlowEnabled ? '#4c1d95' : '#1e293b'}`,
        borderRadius: 8,
        transition: 'all 0.2s',
      }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: opticalFlowEnabled ? 10 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Toggle */}
            <div
              onClick={() => onSetOpticalFlow(!opticalFlowEnabled)}
              style={{
                width: 36, height: 20, borderRadius: 10, cursor: 'pointer', position: 'relative',
                background: opticalFlowEnabled ? '#7c3aed' : '#334155',
                transition: 'background 0.2s',
              }}
            >
              <div style={{
                position: 'absolute', top: 2, left: opticalFlowEnabled ? 18 : 2,
                width: 16, height: 16, borderRadius: '50%', background: 'white',
                transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
              }} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: opticalFlowEnabled ? '#c4b5fd' : '#94a3b8' }}>
                ✨ FlowWarp
              </div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>
                {opticalFlowEnabled ? 'Optical flow frame synthesis active' : 'AI-powered slow motion'}
              </div>
            </div>
          </div>
          {/* Speed indicator badge */}
          {(clip.speed ?? 1) < 1 && (
            <div style={{
              padding: '2px 8px', borderRadius: 12,
              background: opticalFlowEnabled ? '#4c1d95' : '#1e293b',
              fontSize: 11, fontWeight: 700,
              color: opticalFlowEnabled ? '#c4b5fd' : '#64748b',
            }}>
              {Math.round((clip.speed ?? 1) * 100)}%
            </div>
          )}
        </div>

        {/* Quality selector — only show when enabled AND speed < 1 */}
        {opticalFlowEnabled && (clip.speed ?? 1) < 1 && (
          <div>
            <div style={{ fontSize: 10, color: '#475569', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Quality
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              {([
                { key: 'draft', label: 'Draft', desc: 'Fast preview', icon: '⚡' },
                { key: 'good',  label: 'Good',  desc: 'Balanced',    icon: '✦' },
                { key: 'best',  label: 'Best',  desc: 'Cinematic',   icon: '✨' },
              ] as const).map(({ key, label, desc, icon }) => {
                const active = (clip.opticalFlowQuality ?? 'good') === key;
                return (
                  <div
                    key={key}
                    onClick={() => onSetOpticalFlowQuality?.(key)}
                    style={{
                      padding: '8px 6px',
                      borderRadius: 6,
                      border: `1px solid ${active ? '#7c3aed' : '#1e293b'}`,
                      background: active ? 'rgba(124,58,237,0.2)' : '#0f172a',
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontSize: 14, marginBottom: 3 }}>{icon}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: active ? '#c4b5fd' : '#94a3b8' }}>{label}</div>
                    <div style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>{desc}</div>
                  </div>
                );
              })}
            </div>

            {/* Warning if speed > 0.5 */}
            {(clip.speed ?? 1) > 0.5 && (
              <div style={{ marginTop: 8, fontSize: 10, color: '#f59e0b', display: 'flex', gap: 4, alignItems: 'center' }}>
                ⚠ Best results at 50% speed or slower
              </div>
            )}

            {/* Best quality warning */}
            {(clip.opticalFlowQuality ?? 'good') === 'best' && (
              <div style={{ marginTop: 6, fontSize: 10, color: '#94a3b8', lineHeight: 1.4 }}>
                🎬 Best quality increases export time. Renders at {Math.min(120, Math.round(30 / (clip.speed ?? 0.5)))}fps → downsampled to {30}fps.
              </div>
            )}
          </div>
        )}

        {/* Show hint when enabled but speed >= 1 */}
        {opticalFlowEnabled && (clip.speed ?? 1) >= 1 && (
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 6 }}>
            Set clip speed below 100% to activate frame synthesis
          </div>
        )}
      </div>
    </div>
  );
}

// ── Transform numeric row ─────────────────────────────────────────────────────
function TransformRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
  onReset?: () => void;
}) {
  return (
    <div className="transform-row">
      <span className="transform-label">{label}</span>
      <input
        className="numeric-input transform-numeric"
        type="number"
        min={min} max={max} step={step}
        value={step < 0.01 ? value.toFixed(3) : step < 0.1 ? value.toFixed(2) : value.toFixed(1)}
        onChange={(e) => {
          const v = Math.min(max, Math.max(min, Number(e.target.value)));
          onChange(v);
        }}
      />
      {unit && <span className="field-unit">{unit}</span>}
      {onReset && (
        <button className="transform-reset-btn" onClick={onReset} type="button" title="Reset to default">
          ↺
        </button>
      )}
    </div>
  );
}

// ── Transform tab body ────────────────────────────────────────────────────────
function TransformTab({
  transform,
  onSet,
}: {
  transform: ClipTransformValues;
  onSet: (updates: Partial<ClipTransformValues>) => void;
}) {
  const resetAll = useCallback(() => onSet({ ...DEFAULT_TRANSFORM }), [onSet]);

  return (
    <div className="inspector-stack">
      <CollapsibleCard label="Position" defaultOpen>
        <TransformRow
          label="X"
          value={transform.posX}
          min={-2} max={2} step={0.001}
          unit="rel"
          onChange={(v) => onSet({ posX: v })}
          onReset={() => onSet({ posX: 0 })}
        />
        <TransformRow
          label="Y"
          value={transform.posY}
          min={-2} max={2} step={0.001}
          unit="rel"
          onChange={(v) => onSet({ posY: v })}
          onReset={() => onSet({ posY: 0 })}
        />
      </CollapsibleCard>

      <CollapsibleCard label="Scale" defaultOpen>
        <TransformRow
          label="W"
          value={transform.scaleX}
          min={0.05} max={4} step={0.01}
          unit="×"
          onChange={(v) => onSet({ scaleX: v })}
          onReset={() => onSet({ scaleX: 1 })}
        />
        <TransformRow
          label="H"
          value={transform.scaleY}
          min={0.05} max={4} step={0.01}
          unit="×"
          onChange={(v) => onSet({ scaleY: v })}
          onReset={() => onSet({ scaleY: 1 })}
        />
        <button
          className="panel-action muted scale-uniform-btn"
          type="button"
          onClick={() => onSet({ scaleY: transform.scaleX })}
          title="Set H scale equal to W scale"
        >
          ⇅ Uniform Scale
        </button>
      </CollapsibleCard>

      <CollapsibleCard label="Rotation" defaultOpen>
        <TransformRow
          label="°"
          value={transform.rotation}
          min={-180} max={180} step={0.1}
          unit="deg"
          onChange={(v) => onSet({ rotation: v })}
          onReset={() => onSet({ rotation: 0 })}
        />
        <div className="field">
          <input
            type="range" min={-180} max={180} step={0.5}
            value={transform.rotation}
            onInput={(e) => onSet({ rotation: Number((e.target as HTMLInputElement).value) })}
            onChange={(e) => onSet({ rotation: Number(e.target.value) })}
          />
          <div className="range-labels"><span>-180°</span><span>0°</span><span>180°</span></div>
        </div>
      </CollapsibleCard>

      <CollapsibleCard label="Opacity" defaultOpen>
        <TransformRow
          label="%"
          value={Math.round(transform.opacity * 100)}
          min={0} max={100} step={1}
          unit="%"
          onChange={(v) => onSet({ opacity: v / 100 })}
          onReset={() => onSet({ opacity: 1 })}
        />
        <div className="field">
          <input
            type="range" min={0} max={1} step={0.01}
            value={transform.opacity}
            onInput={(e) => onSet({ opacity: Number((e.target as HTMLInputElement).value) })}
            onChange={(e) => onSet({ opacity: Number(e.target.value) })}
          />
          <div className="range-labels"><span>0%</span><span>50%</span><span>100%</span></div>
        </div>
      </CollapsibleCard>

      <CollapsibleCard label="Anchor Point" defaultOpen={false}>
        <TransformRow
          label="X"
          value={transform.anchorX}
          min={0} max={1} step={0.01}
          unit="norm"
          onChange={(v) => onSet({ anchorX: v })}
          onReset={() => onSet({ anchorX: 0.5 })}
        />
        <TransformRow
          label="Y"
          value={transform.anchorY}
          min={0} max={1} step={0.01}
          unit="norm"
          onChange={(v) => onSet({ anchorY: v })}
          onReset={() => onSet({ anchorY: 0.5 })}
        />
        <div className="anchor-presets">
          {[
            ["↖", 0, 0], ["↑", 0.5, 0], ["↗", 1, 0],
            ["←", 0, 0.5], ["✛", 0.5, 0.5], ["→", 1, 0.5],
            ["↙", 0, 1], ["↓", 0.5, 1], ["↘", 1, 1],
          ].map(([icon, ax, ay]) => (
            <button
              key={`${ax}-${ay}`}
              className={`anchor-preset-btn${transform.anchorX === ax && transform.anchorY === ay ? " active" : ""}`}
              onClick={() => onSet({ anchorX: ax as number, anchorY: ay as number })}
              type="button"
              title={`Anchor ${icon}`}
            >
              {icon}
            </button>
          ))}
        </div>
      </CollapsibleCard>

      <div className="inspector-card">
        <button className="panel-action muted" onClick={resetAll} type="button">
          ↺ Reset All Transform
        </button>
      </div>
    </div>
  );
}

// ── Fix 10: Export Preset Panel ──────────────────────────────────────────────

interface ExportPreset {
  id: string;
  label: string;
  icon: string;
  description: string;
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: string;
  audioCodec: string;
  audioBitrate: string;
  container: string;
}

// ── User-saved export presets (Feature 5) ─────────────────────────────────────

interface UserExportPreset {
  id: string;
  name: string;
  codec: ExportCodec;
  outputWidth: number;
  outputHeight: number;
  fps: number;
  audioSampleRate: number;
  createdAt: number;
}

const USER_PRESETS_KEY = '264pro_export_presets';

function loadUserPresets(): UserExportPreset[] {
  try {
    const raw = localStorage.getItem(USER_PRESETS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as UserExportPreset[];
  } catch {
    return [];
  }
}

function saveUserPresets(presets: UserExportPreset[]): void {
  try {
    localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets));
  } catch { /* ignore */ }
}

// Built-in presets for save/load system
const BUILTIN_SAVE_PRESETS: UserExportPreset[] = [
  { id: 'yt-4k',      name: 'YouTube 4K',          codec: 'libx264',   outputWidth: 3840, outputHeight: 2160, fps: 30, audioSampleRate: 48000, createdAt: 0 },
  { id: 'yt-1080',    name: 'YouTube 1080p',        codec: 'libx264',   outputWidth: 1920, outputHeight: 1080, fps: 30, audioSampleRate: 48000, createdAt: 0 },
  { id: 'ig-reel',    name: 'Instagram Reel',       codec: 'libx264',   outputWidth: 1080, outputHeight: 1920, fps: 30, audioSampleRate: 44100, createdAt: 0 },
  { id: 'tiktok-bi',  name: 'TikTok',               codec: 'libx264',   outputWidth: 1080, outputHeight: 1920, fps: 30, audioSampleRate: 44100, createdAt: 0 },
  { id: 'twitter',    name: 'Twitter/X',            codec: 'libx264',   outputWidth: 1280, outputHeight: 720,  fps: 30, audioSampleRate: 44100, createdAt: 0 },
  { id: 'prores-422', name: 'ProRes 422 Master',    codec: 'prores_ks', outputWidth: 1920, outputHeight: 1080, fps: 24, audioSampleRate: 48000, createdAt: 0 },
  { id: 'web-265',    name: 'Web H.265',            codec: 'libx265',   outputWidth: 1920, outputHeight: 1080, fps: 30, audioSampleRate: 44100, createdAt: 0 },
];

const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: "youtube",
    label: "YouTube",
    icon: "▶",
    description: "YouTube HD – H.264 / AAC",
    width: 1920, height: 1080, fps: 30,
    codec: "H.264", bitrate: "8 Mbps", audioCodec: "AAC", audioBitrate: "192 kbps", container: "MP4",
  },
  {
    id: "instagram_reel",
    label: "Instagram Reel",
    icon: "📱",
    description: "Vertical 9:16 – H.264 / AAC",
    width: 1080, height: 1920, fps: 30,
    codec: "H.264", bitrate: "6 Mbps", audioCodec: "AAC", audioBitrate: "192 kbps", container: "MP4",
  },
  {
    id: "tiktok",
    label: "TikTok",
    icon: "🎵",
    description: "TikTok – H.264 / AAC",
    width: 1080, height: 1920, fps: 60,
    codec: "H.264", bitrate: "6 Mbps", audioCodec: "AAC", audioBitrate: "256 kbps", container: "MP4",
  },
  {
    id: "prores422",
    label: "ProRes 422",
    icon: "🎬",
    description: "ProRes 422 HQ – Archive quality",
    width: 1920, height: 1080, fps: 24,
    codec: "ProRes 422", bitrate: "~220 Mbps", audioCodec: "PCM 24-bit", audioBitrate: "Lossless", container: "MOV",
  },
];

function ExportPresetPanel({
  sequenceSettings,
  exportBusy,
  exportMessage,
  exportProgress,
  environment,
  onExport,
  onAddToQueue,
}: {
  sequenceSettings: { width: number; height: number; fps: number; audioSampleRate: number };
  exportBusy: boolean;
  exportMessage: string | null;
  exportProgress?: number;
  environment: EnvironmentStatus | null;
  onExport: (opts?: { codec?: ExportCodec; outputWidth?: number; outputHeight?: number }) => Promise<void>;
  onAddToQueue?: (opts: { codec: ExportCodec; outputWidth: number; outputHeight: number; label: string }) => void;
}) {
  const [selectedPreset, setSelectedPreset] = useState<string>("youtube");
  const [selectedCodec, setSelectedCodec] = useState<ExportCodec>("libx264");
  const [selectedResIdx, setSelectedResIdx] = useState<number>(0); // 0 = Original
  const preset = EXPORT_PRESETS.find((p) => p.id === selectedPreset) ?? EXPORT_PRESETS[0];
  const resPre = EXPORT_RESOLUTION_PRESETS[selectedResIdx] ?? EXPORT_RESOLUTION_PRESETS[0];
  const pct = exportProgress ?? 0;

  // ── User preset save/load state ────────────────────────────────────────────
  const [userPresets, setUserPresets] = useState<UserExportPreset[]>(loadUserPresets);
  const [saveNameInput, setSaveNameInput] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [selectedBuiltinId, setSelectedBuiltinId] = useState<string | null>(null);

  const applyBuiltinPreset = useCallback((p: UserExportPreset) => {
    setSelectedBuiltinId(p.id);
    setSelectedCodec(p.codec);
    // Find matching resolution index or fall back to 0
    const resIdx = EXPORT_RESOLUTION_PRESETS.findIndex(r => r.width === p.outputWidth && r.height === p.outputHeight);
    if (resIdx >= 0) setSelectedResIdx(resIdx);
    setSaveNameInput(p.name);
  }, []);

  const applyUserPreset = useCallback((p: UserExportPreset) => {
    setSelectedCodec(p.codec);
    const resIdx = EXPORT_RESOLUTION_PRESETS.findIndex(r => r.width === p.outputWidth && r.height === p.outputHeight);
    if (resIdx >= 0) setSelectedResIdx(resIdx);
    setSelectedBuiltinId(null);
  }, []);

  const handleSavePreset = useCallback(() => {
    const name = saveNameInput.trim();
    if (!name) return;
    const newPreset: UserExportPreset = {
      id: `user_${Date.now()}`,
      name,
      codec: selectedCodec,
      outputWidth: resPre.width,
      outputHeight: resPre.height,
      fps: sequenceSettings.fps,
      audioSampleRate: sequenceSettings.audioSampleRate,
      createdAt: Date.now(),
    };
    const updated = [...userPresets, newPreset];
    setUserPresets(updated);
    saveUserPresets(updated);
    setShowSaveInput(false);
    setSaveNameInput("");
  }, [saveNameInput, selectedCodec, resPre, sequenceSettings, userPresets]);

  const handleDeleteUserPreset = useCallback((id: string) => {
    const updated = userPresets.filter(p => p.id !== id);
    setUserPresets(updated);
    saveUserPresets(updated);
  }, [userPresets]);

  const CODEC_OPTIONS: Array<{ value: ExportCodec; label: string }> = [
    { value: "libx264", label: "H.264 (libx264)" },
    { value: "libx265", label: "H.265 (libx265)" },
    { value: "prores_ks", label: "ProRes (prores_ks)" },
    { value: "libvpx-vp9", label: "WebM (VP9)" },
  ];

  const containerLabel = selectedCodec === "libvpx-vp9" ? "WebM" : selectedCodec === "prores_ks" ? "MOV" : "MP4";

  return (
    <div className="inspector-stack">
      <CollapsibleCard label="Export Presets" defaultOpen>
        <div className="export-preset-grid">
          {EXPORT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`export-preset-btn${selectedPreset === p.id ? " active" : ""}`}
              onClick={() => setSelectedPreset(p.id)}
              title={p.description}
            >
              <span className="export-preset-icon">{p.icon}</span>
              <span className="export-preset-label">{p.label}</span>
            </button>
          ))}
        </div>
      </CollapsibleCard>

      {/* ── Save/Load Presets (Feature 5) ── */}
      <CollapsibleCard label="Save/Load Presets" defaultOpen>
        {/* Built-in presets selector */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Built-in</div>
          <select
            value={selectedBuiltinId ?? ''}
            onChange={(e) => {
              const p = BUILTIN_SAVE_PRESETS.find(b => b.id === e.target.value);
              if (p) applyBuiltinPreset(p);
            }}
            style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, color: '#e8e8e8', fontSize: 11, padding: '4px 6px' }}
          >
            <option value="">— Select built-in preset —</option>
            {BUILTIN_SAVE_PRESETS.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        {/* User presets */}
        {userPresets.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Your Presets</div>
            {userPresets.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <button
                  type="button"
                  onClick={() => applyUserPreset(p)}
                  style={{ flex: 1, textAlign: 'left', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, color: '#e8e8e8', fontSize: 11, padding: '3px 7px', cursor: 'pointer' }}
                  title={`${p.codec} · ${p.outputWidth}×${p.outputHeight}`}
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteUserPreset(p.id)}
                  style={{ background: 'none', border: 'none', color: 'rgba(255,80,80,0.6)', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '2px 4px' }}
                  title="Delete preset"
                >🗑</button>
              </div>
            ))}
          </div>
        )}
        {/* Save as preset */}
        {showSaveInput ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              type="text"
              value={saveNameInput}
              onChange={(e) => setSaveNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(); if (e.key === 'Escape') setShowSaveInput(false); }}
              placeholder="Preset name…"
              autoFocus
              style={{ flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4, color: '#e8e8e8', fontSize: 11, padding: '4px 6px' }}
            />
            <button type="button" onClick={handleSavePreset} style={{ background: 'rgba(124,58,237,0.3)', border: '1px solid rgba(124,58,237,0.5)', borderRadius: 4, color: '#e8e8e8', fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>Save</button>
            <button type="button" onClick={() => setShowSaveInput(false)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, color: 'rgba(255,255,255,0.5)', fontSize: 11, padding: '3px 6px', cursor: 'pointer' }}>✕</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowSaveInput(true)}
            style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 4, color: 'rgba(255,255,255,0.5)', fontSize: 11, padding: '5px', cursor: 'pointer', textAlign: 'center' }}
          >
            + Save Current Settings as Preset
          </button>
        )}
      </CollapsibleCard>

      <CollapsibleCard label="Codec &amp; Resolution" defaultOpen>
        <div className="clip-meta-grid">
          <span>Video Codec</span>
          <select
            value={selectedCodec}
            onChange={(e) => setSelectedCodec(e.target.value as ExportCodec)}
            style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, color: "#e8e8e8", fontSize: 11, padding: "3px 5px" }}
          >
            {CODEC_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <span>Resolution</span>
          <select
            value={selectedResIdx}
            onChange={(e) => setSelectedResIdx(Number(e.target.value))}
            style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, color: "#e8e8e8", fontSize: 11, padding: "3px 5px" }}
          >
            {EXPORT_RESOLUTION_PRESETS.map((r, i) => (
              <option key={i} value={i}>{r.label}</option>
            ))}
          </select>
        </div>
      </CollapsibleCard>

      <CollapsibleCard label="Render Settings" defaultOpen>
        <div className="clip-meta-grid">
          <span>Platform</span><strong>{preset.label}</strong>
          <span>Resolution</span><strong>{resPre.width > 0 ? `${resPre.width}×${resPre.height}` : `${sequenceSettings.width}×${sequenceSettings.height} (seq)`}</strong>
          <span>Frame Rate</span><strong>{preset.fps} fps</strong>
          <span>Video Codec</span><strong>{CODEC_OPTIONS.find(c => c.value === selectedCodec)?.label ?? selectedCodec}</strong>
          <span>Audio Codec</span><strong>{preset.audioCodec}</strong>
          <span>Audio Bitrate</span><strong>{preset.audioBitrate}</strong>
          <span>Container</span><strong>{containerLabel}</strong>
        </div>
      </CollapsibleCard>

      <CollapsibleCard label="Sequence Info" defaultOpen={false}>
        <div className="clip-meta-grid">
          <span>Sequence Resolution</span><strong>{sequenceSettings.width}×{sequenceSettings.height}</strong>
          <span>Sequence FPS</span><strong>{sequenceSettings.fps} fps</strong>
          <span>Audio Sample Rate</span><strong>{sequenceSettings.audioSampleRate / 1000} kHz</strong>
        </div>
      </CollapsibleCard>

      <CollapsibleCard label="Render" defaultOpen>
        <button
          className="panel-action primary export-btn"
          disabled={exportBusy}
          onClick={() => void onExport({ codec: selectedCodec, outputWidth: resPre.width, outputHeight: resPre.height })}
          type="button"
        >
          {exportBusy ? "⏳ Rendering…" : `▶ Export ${containerLabel}`}
        </button>
        {onAddToQueue && (
          <button
            className="panel-action export-btn"
            style={{ marginTop: 4, background: "rgba(59,138,247,0.12)", borderColor: "rgba(59,138,247,0.35)", color: "#3b8af7" }}
            disabled={exportBusy}
            onClick={() => {
              const codecLabel = CODEC_OPTIONS.find((c) => c.value === selectedCodec)?.label ?? selectedCodec;
              const resLabel = resPre.width > 0 ? `${resPre.width}×${resPre.height}` : "Original";
              onAddToQueue({ codec: selectedCodec, outputWidth: resPre.width, outputHeight: resPre.height, label: `${preset.label} · ${codecLabel} · ${resLabel}` });
            }}
            type="button"
            title="Add this render configuration to the render queue"
          >
            + Add to Queue
          </button>
        )}
        {exportBusy && (
          <div className="export-progress-row">
            <div className="export-progress-bar">
              <div className="export-progress-fill" style={{ width: `${pct}%`, transition: "width 0.3s ease" }} />
            </div>
            <span className="export-eta">{pct}%</span>
          </div>
        )}
        {exportMessage && (
          <span className={`export-message${exportMessage.startsWith("✓") ? " success" : " error"}`}>
            {exportMessage}
          </span>
        )}
      </CollapsibleCard>

      <CollapsibleCard label="Environment" defaultOpen={false}>
        <strong className={environment?.ffmpegAvailable ? "text-success" : "text-warning"}>
          {environment?.ffmpegAvailable ? "✓ FFmpeg Ready" : "⚠ FFmpeg Unavailable"}
        </strong>
        <span>FFmpeg: {environment?.ffmpegPath ?? "not found"}</span>
        <span>FFprobe: {environment?.ffprobePath ?? "not found"}</span>
        {environment?.warnings.map((w) => (
          <span key={w} className="warning-text">{w}</span>
        ))}
      </CollapsibleCard>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function InspectorPanel({
  selectedAsset,
  selectedSegment,
  environment,
  exportBusy,
  exportMessage,
  exportProgress,
  clipMessage,
  sequenceSettings,
  voiceListening,
  voiceStatus,
  voiceTranscript,
  voiceLastCommand,
  voiceSuggestedCutFrames,
  voiceMarkInFrame,
  voiceMarkOutFrame,
  voiceBpm,
  voiceGridFrames,
  detectedBpm,
  detectedBeatFrames,
  activeMaskTool,
  selectedMaskId,
  onSetActiveMaskTool,
  onSelectMask,
  onAddMask,
  onUpdateMask,
  onRemoveMask,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  onToggleEffect,
  onReorderEffects,
  onToggleBackgroundRemoval,
  onSetBackgroundRemoval,
  onToggleClipEnabled,
  onDetachLinkedClips,
  onRelinkClips,
  onSetTransitionType,
  onSetTransitionDuration,
  onExtractAudio,
  onRippleDelete,
  onSetClipVolume,
  onSetClipSpeed,
  onSetSpeedRampKeyframes,
  onSetOpticalFlow,
  onSetOpticalFlowQuality,
  clipTransform,
  onSetClipTransform,
  onToggleVoiceListening,
  onAnalyzeVoiceChops,
  onDetectBpm,
  onBeatSync,
  onAcceptVoiceCuts,
  onClearVoiceCuts,
  onQuantizeVoiceCutsToBeat,
  onQuantizeVoiceCutsToGrid,
  onSetVoiceBpm,
  onSetVoiceGridFrames,
  onExport,
  onAddToQueue,
  videoRef,
  onAddEffectKeyframe,
  onUpdateEffectKeyframes,
  currentPlayheadFrame,
  totalFrames,
}: InspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("clip");
  const [transitionCategory, setTransitionCategory] = useState("Basic");
  const [transitionEdge, setTransitionEdge] = useState<"in" | "out">("in");

  const fps = sequenceSettings.fps;
  const maxFadeFrames = selectedSegment
    ? Math.max(0, Math.min(Math.round(fps * 2), selectedSegment.durationFrames - 1))
    : 0;
  const fadeInFrames  = selectedSegment?.clip.transitionIn?.durationFrames  ?? 0;
  const fadeOutFrames = selectedSegment?.clip.transitionOut?.durationFrames ?? 0;
  const fadeInType    = selectedSegment?.clip.transitionIn?.type  ?? null;
  const fadeOutType   = selectedSegment?.clip.transitionOut?.type ?? null;
  const activeTransType   = transitionEdge === "in" ? fadeInType   : fadeOutType;
  const activeTransFrames = transitionEdge === "in" ? fadeInFrames : fadeOutFrames;

  // Merge stored transform with defaults so all fields are always present
  const xform: ClipTransformValues = { ...DEFAULT_TRANSFORM, ...(clipTransform ?? {}) };

  const TABS: Array<{ id: InspectorTab; label: string; icon: string }> = [
    { id: "clip",      label: "Clip",      icon: "📋" },
    { id: "transform", label: "Transform", icon: "⊹" },
    { id: "masks",     label: "Masks",     icon: "⬡" },
    { id: "effects",   label: "Effects",   icon: "✦" },
    { id: "audio",     label: "Audio",     icon: "🎵" },
    { id: "voice",     label: "Voice AI",  icon: "🎤" },
    { id: "export",    label: "Export",    icon: "📤" },
  ];

  return (
    <section className="panel inspector-panel">
      {/* Tabs */}
      <div className="inspector-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`inspector-tab${activeTab === tab.id ? " active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
            type="button"
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="inspector-body">

        {/* ── CLIP TAB ── */}
        {activeTab === "clip" && (
          <div className="inspector-stack">
            {/* Sequence info */}
            <CollapsibleCard label="Sequence" defaultOpen={false}>
              <strong>{sequenceSettings.width}×{sequenceSettings.height} / {fps}fps</strong>
              <span>{sequenceSettings.audioSampleRate / 1000}kHz audio</span>
            </CollapsibleCard>

            {selectedSegment ? (
              <>
                {/* Clip info */}
                <CollapsibleCard label="Selected Clip" defaultOpen>
                  <strong>{selectedSegment.asset.name}</strong>
                  <div className="clip-meta-grid">
                    <span>Track</span><strong>{selectedSegment.track.name}</strong>
                    <span>In</span><strong>{formatTimecode(selectedSegment.startFrame, fps)}</strong>
                    <span>Duration</span><strong>{formatDuration(selectedSegment.durationSeconds)}</strong>
                    <span>Status</span>
                    <strong className={selectedSegment.clip.isEnabled ? "text-success" : "text-muted"}>
                      {selectedSegment.clip.isEnabled ? "Active" : "Disabled"}
                    </strong>
                    <span>Linked</span><strong>{selectedSegment.clip.linkedGroupId ? "Yes" : "No"}</strong>
                    {(selectedSegment.clip.effects?.length ?? 0) > 0 && (
                      <>
                        <span>Effects</span>
                        <strong>
                          {selectedSegment.clip.effects.filter((e) => e.enabled).length}/{selectedSegment.clip.effects.length} active
                        </strong>
                      </>
                    )}
                  </div>
                </CollapsibleCard>

                {/* Transitions */}
                <CollapsibleCard
                  label="Transitions"
                  defaultOpen
                  badge={fadeInType || fadeOutType ? "●" : null}
                >
                  {/* In/Out edge selector */}
                  <div className="transition-edge-tabs">
                    <button
                      className={`transition-edge-btn${transitionEdge === "in" ? " active" : ""}`}
                      onClick={() => setTransitionEdge("in")}
                      type="button"
                    >
                      <span>▶ Transition In</span>
                      {fadeInType && <span className="trans-edge-badge">{transIcon(fadeInType)}</span>}
                    </button>
                    <button
                      className={`transition-edge-btn${transitionEdge === "out" ? " active" : ""}`}
                      onClick={() => setTransitionEdge("out")}
                      type="button"
                    >
                      <span>◀ Transition Out</span>
                      {fadeOutType && <span className="trans-edge-badge">{transIcon(fadeOutType)}</span>}
                    </button>
                  </div>

                  {/* Duration */}
                  <div className="field">
                    <label className="field-header">
                      <span>{transitionEdge === "in" ? "In Duration" : "Out Duration"}</span>
                      <strong>{(activeTransFrames / fps).toFixed(2)}s ({activeTransFrames}f)</strong>
                    </label>
                    <input
                      disabled={maxFadeFrames === 0}
                      max={maxFadeFrames} min={0} step={1}
                      type="range"
                      className="transition-duration-range"
                      value={Math.min(activeTransFrames, maxFadeFrames)}
                      onInput={(e) => onSetTransitionDuration(transitionEdge, Number((e.target as HTMLInputElement).value))}
                      onChange={(e) => onSetTransitionDuration(transitionEdge, Number(e.target.value))}
                    />
                  </div>

                  {/* Category tabs */}
                  <div className="transition-category-tabs">
                    {TRANSITION_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        className={`trans-cat-btn${transitionCategory === cat ? " active" : ""}`}
                        onClick={() => setTransitionCategory(cat)}
                        type="button"
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  {/* Transition grid */}
                  <div className="transition-grid">
                    {ALL_TRANSITION_TYPES
                      .filter((t) => t.category === transitionCategory)
                      .map((t) => {
                        const isActive = activeTransType === t.value;
                        return (
                          <button
                            key={t.value}
                            className={`transition-btn${isActive ? " active" : ""}`}
                            onClick={() => onSetTransitionType(transitionEdge, t.value)}
                            title={`Apply ${t.label} to ${transitionEdge === "in" ? "in" : "out"} point${t.webgl ? " (WebGL)" : ""}`}
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("transition/type", t.value);
                              e.dataTransfer.setData("transition/edge", transitionEdge);
                            }}
                          >
                            <span className="trans-btn-icon">{transIcon(t.value)}</span>
                            <span className="trans-btn-label">{t.label}</span>
                            {t.webgl && <span className="trans-webgl-dot" title="WebGL accelerated">•</span>}
                          </button>
                        );
                      })}
                  </div>

                  {/* Current transitions display */}
                  {(fadeInType || fadeOutType) && (
                    <div className="transition-current-row">
                      {fadeInType && (
                        <div className="transition-current-item">
                          <span className="trans-cur-label">In:</span>
                          <span className="trans-cur-name">{ALL_TRANSITION_TYPES.find((t) => t.value === fadeInType)?.label ?? fadeInType}</span>
                          <span className="trans-cur-dur">{(fadeInFrames / fps).toFixed(1)}s</span>
                          <button
                            className="trans-clear-btn"
                            onClick={() => { onSetTransitionDuration("in", 0); onSetTransitionType("in", "cut"); }}
                            type="button" title="Clear transition in"
                          >✕</button>
                        </div>
                      )}
                      {fadeOutType && (
                        <div className="transition-current-item">
                          <span className="trans-cur-label">Out:</span>
                          <span className="trans-cur-name">{ALL_TRANSITION_TYPES.find((t) => t.value === fadeOutType)?.label ?? fadeOutType}</span>
                          <span className="trans-cur-dur">{(fadeOutFrames / fps).toFixed(1)}s</span>
                          <button
                            className="trans-clear-btn"
                            onClick={() => { onSetTransitionDuration("out", 0); onSetTransitionType("out", "cut"); }}
                            type="button" title="Clear transition out"
                          >✕</button>
                        </div>
                      )}
                    </div>
                  )}

                  {clipMessage && <span className="clip-message">{clipMessage}</span>}
                </CollapsibleCard>

                {/* Actions */}
                <CollapsibleCard label="Clip Actions" defaultOpen>
                  <div className="inline-actions">
                    <button
                      className={`panel-action${!selectedSegment.clip.isEnabled ? " primary" : ""}`}
                      onClick={() => onToggleClipEnabled(selectedSegment.clip.id)}
                      type="button"
                    >
                      {selectedSegment.clip.isEnabled ? "Disable" : "Enable"}
                    </button>
                    {selectedSegment.clip.linkedGroupId ? (
                      <button
                        className="panel-action muted"
                        onClick={() => onDetachLinkedClips(selectedSegment.clip.id)}
                        title="Unlink audio from video — allows independent movement"
                        type="button"
                      >
                        🔗 Unlink A/V
                      </button>
                    ) : (
                      <button
                        className="panel-action muted"
                        onClick={() => onRelinkClips?.(selectedSegment.clip.id)}
                        title="Relink to matching audio/video clip at same time position"
                        type="button"
                      >
                        🔗 Relink A/V
                      </button>
                    )}
                    {selectedSegment.asset.hasAudio && (
                      <button className="panel-action muted" onClick={onExtractAudio} type="button">
                        Extract Audio
                      </button>
                    )}
                    <button className="panel-action danger" onClick={onRippleDelete} type="button">
                      Ripple Delete
                    </button>
                  </div>
                </CollapsibleCard>
              </>
            ) : (
              <div className="inspector-card">
                <p className="inspector-label">No Clip Selected</p>
                <span>Click a clip in the timeline to inspect and edit it.</span>
              </div>
            )}

            {/* Asset info */}
            {selectedAsset && (
              <CollapsibleCard label="Source Media" defaultOpen={false}>
                <strong>{selectedAsset.name}</strong>
                <div className="clip-meta-grid">
                  <span>Duration</span><strong>{formatDuration(selectedAsset.durationSeconds)}</strong>
                  <span>Size</span><strong>{selectedAsset.width}×{selectedAsset.height}</strong>
                  <span>FPS</span><strong>{selectedAsset.nativeFps.toFixed(2)}</strong>
                  <span>Audio</span><strong>{selectedAsset.hasAudio ? "Yes" : "No"}</strong>
                </div>
              </CollapsibleCard>
            )}
          </div>
        )}

        {/* ── TRANSFORM TAB ── */}
        {activeTab === "transform" && (
          selectedSegment ? (
            onSetClipTransform ? (
              <TransformTab transform={xform} onSet={onSetClipTransform} />
            ) : (
              <div className="inspector-stack">
                <div className="inspector-card">
                  <p className="inspector-label">Transform</p>
                  <span className="hint-text">Transform callbacks not yet wired in App.tsx.<br/>
                  Add <code>clipTransform</code> and <code>onSetClipTransform</code> props.</span>
                </div>
              </div>
            )
          ) : (
            <div className="inspector-stack">
              <div className="inspector-card">
                <p className="inspector-label">No Clip Selected</p>
                <span>Select a video clip to adjust its transform.</span>
              </div>
            </div>
          )
        )}

        {/* ── MASKS TAB ── */}
        {activeTab === "masks" && (
          <div className="inspector-stack">
            {selectedSegment ? (
              <div className="inspector-card">
                <p className="inspector-label">Masking Tools</p>
                <MaskInspector
                  clipId={selectedSegment.clip.id}
                  masks={selectedSegment.clip.masks}
                  selectedMaskId={selectedMaskId}
                  activeTool={activeMaskTool}
                  playheadFrame={selectedSegment.startFrame}
                  videoRef={videoRef}
                  onSelectMask={onSelectMask}
                  onSetActiveTool={onSetActiveMaskTool}
                  onAddMask={onAddMask}
                  onUpdateMask={onUpdateMask}
                  onRemoveMask={onRemoveMask}
                />
                <p className="hint-text">
                  Select a mask tool above, then draw on the viewer canvas.<br />
                  Masks apply to color grading and effects.
                </p>
              </div>
            ) : (
              <div className="inspector-card">
                <p className="inspector-label">No Clip Selected</p>
                <span>Select a video clip to add and edit masks.</span>
              </div>
            )}
          </div>
        )}

        {/* ── EFFECTS TAB ── */}
        {activeTab === "effects" && (
          <div className="inspector-stack effects-tab-body">
            <EffectsPanel
              selectedSegment={selectedSegment}
              effects={selectedSegment?.clip.effects ?? []}
              aiBackgroundRemoval={selectedSegment?.clip.aiBackgroundRemoval ?? null}
              onAddEffect={onAddEffect}
              onUpdateEffect={onUpdateEffect}
              onRemoveEffect={onRemoveEffect}
              onToggleEffect={onToggleEffect}
              onReorderEffects={onReorderEffects}
              onToggleBackgroundRemoval={onToggleBackgroundRemoval}
              onSetBackgroundRemoval={onSetBackgroundRemoval}
              currentFrame={currentPlayheadFrame}
              onAddEffectKeyframe={onAddEffectKeyframe}
              onUpdateEffectKeyframes={onUpdateEffectKeyframes}
              totalFrames={totalFrames}
              fps={sequenceSettings.fps}
            />
          </div>
        )}

        {/* ── AUDIO TAB ── */}
        {activeTab === "audio" && (
          <div className="inspector-stack">
            {selectedSegment ? (
              <CollapsibleCard label="Audio Controls" defaultOpen>
                <VolumeControl
                  value={selectedSegment.clip.volume ?? 1}
                  onChange={onSetClipVolume}
                />
                <SpeedControl
                  value={selectedSegment.clip.speed ?? 1}
                  onChange={onSetClipSpeed}
                />
                {onSetSpeedRampKeyframes && onSetOpticalFlow && (
                  <SpeedRampSection
                    clip={selectedSegment.clip}
                    onSetSpeedRampKeyframes={onSetSpeedRampKeyframes}
                    onSetOpticalFlow={onSetOpticalFlow}
                    onSetOpticalFlowQuality={onSetOpticalFlowQuality}
                  />
                )}
                {selectedSegment.asset.hasAudio && (
                  <button className="panel-action muted" onClick={onExtractAudio} type="button">
                    Extract Audio to Track
                  </button>
                )}
              </CollapsibleCard>
            ) : (
              <div className="inspector-card">
                <p className="inspector-label">No Clip Selected</p>
                <span>Select a clip to adjust audio settings.</span>
              </div>
            )}
          </div>
        )}

        {/* ── VOICE AI TAB ── */}
        {activeTab === "voice" && (
          <div className="inspector-stack">
            <CollapsibleCard label="Voice Chop AI" defaultOpen>
              <div className="voice-status-row">
                <span className={`status-pill${voiceListening ? " live" : ""}`}>
                  {voiceListening ? "🔴 Listening" : "● Ready"}
                </span>
              </div>
              <span className="voice-status-text">{voiceStatus}</span>
              {voiceTranscript && <span className="voice-transcript">"{voiceTranscript}"</span>}
              {voiceLastCommand && <span className="voice-last-cmd">Last: {voiceLastCommand}</span>}
              <div className="inline-actions">
                <button
                  className={`panel-action${voiceListening ? " primary" : ""}`}
                  onClick={onToggleVoiceListening}
                  type="button"
                >
                  {voiceListening ? "⏹ Stop Mic" : "🎤 Start Mic"}
                </button>
                <button className="panel-action muted" onClick={onAnalyzeVoiceChops} type="button">
                  Chop For Me
                </button>
              </div>
            </CollapsibleCard>

            <CollapsibleCard label="BPM & Beat Sync" defaultOpen>
              {detectedBpm !== null && (
                <div className="bpm-display">
                  <span className="bpm-value">{detectedBpm}</span>
                  <span className="bpm-unit">BPM</span>
                  <span className="bpm-beats">{detectedBeatFrames.length} beats detected</span>
                </div>
              )}
              <div className="field">
                <label className="field-header">
                  <span>Manual BPM</span>
                  <strong>{voiceBpm}</strong>
                </label>
                <input
                  type="range" min={40} max={240} step={1}
                  value={voiceBpm}
                  onInput={(e) => onSetVoiceBpm(Number((e.target as HTMLInputElement).value))}
                  onChange={(e) => onSetVoiceBpm(Number(e.target.value))}
                />
              </div>
              <div className="field">
                <label className="field-header">
                  <span>Grid Frames</span>
                  <strong>{voiceGridFrames}fr</strong>
                </label>
                <input
                  type="range" min={1} max={Math.max(fps * 2, 24)} step={1}
                  value={voiceGridFrames}
                  onInput={(e) => onSetVoiceGridFrames(Number((e.target as HTMLInputElement).value))}
                  onChange={(e) => onSetVoiceGridFrames(Number(e.target.value))}
                />
              </div>
              <div className="inline-actions">
                <button className="panel-action" onClick={onDetectBpm} type="button">Detect BPM</button>
                <button className="panel-action muted" onClick={() => onBeatSync("everyBeat")} type="button">Every Beat</button>
                <button className="panel-action muted" onClick={() => onBeatSync("every2")} type="button">Every 2</button>
                <button className="panel-action muted" onClick={() => onBeatSync("every4")} type="button">Every 4</button>
              </div>
            </CollapsibleCard>

            <CollapsibleCard label="Cut Suggestions" defaultOpen>
              <span>
                {voiceSuggestedCutFrames.length
                  ? `${voiceSuggestedCutFrames.length} suggested cut${voiceSuggestedCutFrames.length === 1 ? "" : "s"}`
                  : "No suggestions yet"}
              </span>
              <div className="inline-actions">
                <button className="panel-action" disabled={!voiceSuggestedCutFrames.length} onClick={onAcceptVoiceCuts} type="button">Apply Cuts</button>
                <button className="panel-action muted" disabled={!voiceSuggestedCutFrames.length} onClick={onClearVoiceCuts} type="button">Clear</button>
                <button className="panel-action muted" disabled={!voiceSuggestedCutFrames.length} onClick={onQuantizeVoiceCutsToBeat} type="button">⌀ Beat</button>
                <button className="panel-action muted" disabled={!voiceSuggestedCutFrames.length} onClick={onQuantizeVoiceCutsToGrid} type="button">⌀ Grid</button>
              </div>
              <span className="marks-display">
                Mark In: {voiceMarkInFrame !== null ? formatTimecode(voiceMarkInFrame, fps) : "—"}
                {" · "}
                Mark Out: {voiceMarkOutFrame !== null ? formatTimecode(voiceMarkOutFrame, fps) : "—"}
              </span>
              <p className="hint-text">
                Say: "cut here" · "mark start/end" · "chop for me" · "detect bpm" · "apply cuts"
              </p>
            </CollapsibleCard>
          </div>
        )}

        {/* ── EXPORT TAB ── */}
        {activeTab === "export" && (
          <ExportPresetPanel
            sequenceSettings={sequenceSettings}
            exportBusy={exportBusy}
            exportMessage={exportMessage}
            exportProgress={exportProgress}
            environment={environment}
            onExport={onExport}
            onAddToQueue={onAddToQueue}
          />
        )}
      </div>
    </section>
  );
}
