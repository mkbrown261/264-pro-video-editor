import React, { useState, useRef, useCallback } from "react";
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
}: {
  sequenceSettings: { width: number; height: number; fps: number; audioSampleRate: number };
  exportBusy: boolean;
  exportMessage: string | null;
  exportProgress?: number;
  environment: EnvironmentStatus | null;
  onExport: (opts?: { codec?: ExportCodec; outputWidth?: number; outputHeight?: number }) => Promise<void>;
}) {
  const [selectedPreset, setSelectedPreset] = useState<string>("youtube");
  const [selectedCodec, setSelectedCodec] = useState<ExportCodec>("libx264");
  const [selectedResIdx, setSelectedResIdx] = useState<number>(0); // 0 = Original
  const preset = EXPORT_PRESETS.find((p) => p.id === selectedPreset) ?? EXPORT_PRESETS[0];
  const resPre = EXPORT_RESOLUTION_PRESETS[selectedResIdx] ?? EXPORT_RESOLUTION_PRESETS[0];
  const pct = exportProgress ?? 0;

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
  videoRef,
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
          />
        )}
      </div>
    </section>
  );
}
