import { useState, useRef, useCallback, useEffect } from "react";
import type { BackgroundRemovalConfig, ClipEffect, EffectType } from "../../shared/models";
import { createId } from "../../shared/models";
import type { TimelineSegment } from "../../shared/timeline";

interface EffectsPanelProps {
  selectedSegment: TimelineSegment | null;
  effects: ClipEffect[];
  aiBackgroundRemoval: BackgroundRemovalConfig | null;
  onAddEffect: (effect: ClipEffect) => void;
  onUpdateEffect: (effectId: string, updates: Partial<ClipEffect>) => void;
  onRemoveEffect: (effectId: string) => void;
  onToggleEffect: (effectId: string) => void;
  onReorderEffects: (fromIdx: number, toIdx: number) => void;
  onToggleBackgroundRemoval: () => void;
  onSetBackgroundRemoval: (config: Partial<BackgroundRemovalConfig>) => void;
}

// ─── Preset type ──────────────────────────────────────────────────────────────

interface EffectPreset {
  id: string;
  name: string;
  effects: Array<{
    type: EffectType;
    params: Record<string, number | string | boolean>;
  }>;
}

const DEFAULT_PRESETS: EffectPreset[] = [
  {
    id: "cinematic",
    name: "Cinematic Look",
    effects: [
      { type: "vignette", params: { intensity: 0.55, radius: 0.65, feather: 0.5 } },
      { type: "brightness", params: { brightness: -0.05, contrast: 0.15 } },
      { type: "hueShift", params: { hue: 0, saturation: 0.82, lightness: 0 } }
    ]
  },
  {
    id: "warm-film",
    name: "Warm Film",
    effects: [
      { type: "hueShift", params: { hue: 8, saturation: 1.1, lightness: 0.04 } },
      { type: "noise", params: { amount: 0.07, colorNoise: true } },
      { type: "vignette", params: { intensity: 0.35, radius: 0.7, feather: 0.6 } }
    ]
  },
  {
    id: "cold-blue",
    name: "Cold Blue",
    effects: [
      { type: "hueShift", params: { hue: -12, saturation: 0.9, lightness: -0.03 } },
      { type: "brightness", params: { brightness: 0.02, contrast: 0.1 } }
    ]
  },
  {
    id: "high-contrast",
    name: "High Contrast",
    effects: [
      { type: "brightness", params: { brightness: 0, contrast: 0.4 } },
      { type: "hueShift", params: { hue: 0, saturation: 1.2, lightness: 0 } }
    ]
  },
  {
    id: "vintage-film",
    name: "Vintage Film",
    effects: [
      { type: "hueShift", params: { hue: 5, saturation: 0.7, lightness: 0.06 } },
      { type: "noise", params: { amount: 0.12, colorNoise: false } },
      { type: "vignette", params: { intensity: 0.6, radius: 0.6, feather: 0.45 } },
      { type: "brightness", params: { brightness: 0.03, contrast: -0.05 } }
    ]
  }
];

const PRESETS_STORAGE_KEY = "264pro_effect_presets";

function loadSavedPresets(): EffectPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as EffectPreset[];
  } catch {
    return [];
  }
}

function savePresetsToStorage(presets: EffectPreset[]): void {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch { /* ignore */ }
}

// ─── CSS filter computation from effect stack ─────────────────────────────────

export function computeCssFilterFromEffects(effects: ClipEffect[]): string {
  const sorted = [...effects]
    .filter((e) => e.enabled)
    .sort((a, b) => a.order - b.order);

  const parts: string[] = [];

  for (const eff of sorted) {
    const p = eff.params;
    switch (eff.type) {
      case "blur":
        parts.push(`blur(${Number(p.radius ?? 5) * 0.5}px)`);
        break;
      case "sharpen":
        // Sharpness via contrast + brightness approximation
        parts.push(`contrast(${1 + Number(p.amount ?? 0.5) * 0.3})`);
        break;
      case "glow":
        parts.push(`brightness(${1 + Number(p.intensity ?? 0.5) * 0.25}) blur(${Number(p.radius ?? 10) * 0.05}px)`);
        break;
      case "brightness":
        parts.push(`brightness(${1 + Number(p.brightness ?? 0)})`);
        parts.push(`contrast(${1 + Number(p.contrast ?? 0)})`);
        break;
      case "hueShift":
        parts.push(`hue-rotate(${Number(p.hue ?? 0)}deg)`);
        parts.push(`saturate(${Number(p.saturation ?? 1)})`);
        parts.push(`brightness(${1 + Number(p.lightness ?? 0) * 0.5})`);
        break;
      case "noise":
        // Noise can't be done purely with CSS filter; approximate with contrast
        parts.push(`contrast(${1 + Number(p.amount ?? 0.1) * 0.12})`);
        break;
      case "vignette":
        // Vignette uses CSS, can't be done via filter; handled by overlay
        break;
      case "pixelate":
        // Pixelate: approximate with scale/blur
        parts.push(`blur(${Number(p.size ?? 8) * 0.15}px)`);
        break;
      case "edgeDetect":
        parts.push(`contrast(${Number(p.strength ?? 1) * 8}) invert(${Number(p.invert ?? 0) ? 1 : 0})`);
        break;
      case "chromaKey":
        // ChromaKey: no CSS equiv; skip
        break;
      case "contrast":
        parts.push(`contrast(${1 + Number(p.amount ?? 0)})`);
        break;
      default:
        break;
    }
  }

  return parts.length ? parts.join(" ") : "none";
}

// ─── Effect definitions ───────────────────────────────────────────────────────

interface EffectDef {
  type: EffectType;
  label: string;
  category: string;
  icon: string;
  defaultParams: Record<string, number | string | boolean>;
  paramDefs: EffectParamDef[];
  description: string;
}

interface EffectParamDef {
  key: string;
  label: string;
  type: "range" | "toggle" | "select" | "color";
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  unit?: string;
}

const EFFECT_LIBRARY: EffectDef[] = [
  {
    type: "blur",
    label: "Blur",
    category: "Spatial",
    icon: "◎",
    description: "Gaussian, motion, or radial blur",
    defaultParams: { radius: 5, type: "gaussian" },
    paramDefs: [
      { key: "radius", label: "Radius", type: "range", min: 0, max: 50, step: 0.5, unit: "px" },
      { key: "type", label: "Type", type: "select", options: ["gaussian", "motion", "radial"] }
    ]
  },
  {
    type: "sharpen",
    label: "Sharpen",
    category: "Spatial",
    icon: "◈",
    description: "Enhance edge clarity and detail",
    defaultParams: { amount: 0.5, radius: 1 },
    paramDefs: [
      { key: "amount", label: "Amount", type: "range", min: 0, max: 2, step: 0.05 },
      { key: "radius", label: "Radius", type: "range", min: 0.5, max: 5, step: 0.5, unit: "px" }
    ]
  },
  {
    type: "brightness",
    label: "Brightness / Contrast",
    category: "Color",
    icon: "☀",
    description: "Adjust luminance and tonal range",
    defaultParams: { brightness: 0, contrast: 0 },
    paramDefs: [
      { key: "brightness", label: "Brightness", type: "range", min: -1, max: 1, step: 0.01 },
      { key: "contrast", label: "Contrast", type: "range", min: -1, max: 1, step: 0.01 }
    ]
  },
  {
    type: "hueShift",
    label: "Hue / Saturation",
    category: "Color",
    icon: "◑",
    description: "Rotate hue and adjust saturation",
    defaultParams: { hue: 0, saturation: 1, lightness: 0 },
    paramDefs: [
      { key: "hue", label: "Hue Shift", type: "range", min: -180, max: 180, step: 1, unit: "°" },
      { key: "saturation", label: "Saturation", type: "range", min: 0, max: 3, step: 0.01 },
      { key: "lightness", label: "Lightness", type: "range", min: -1, max: 1, step: 0.01 }
    ]
  },
  {
    type: "noise",
    label: "Film Grain",
    category: "Texture",
    icon: "⬡",
    description: "Add analog film grain texture",
    defaultParams: { amount: 0.1, colorNoise: false },
    paramDefs: [
      { key: "amount", label: "Amount", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "colorNoise", label: "Color Grain", type: "toggle" }
    ]
  },
  {
    type: "vignette",
    label: "Vignette",
    category: "Stylized",
    icon: "⬭",
    description: "Darken image edges",
    defaultParams: { intensity: 0.5, radius: 0.7, feather: 0.5 },
    paramDefs: [
      { key: "intensity", label: "Intensity", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "radius", label: "Radius", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "feather", label: "Feather", type: "range", min: 0, max: 1, step: 0.01 }
    ]
  },
  {
    type: "glow",
    label: "Glow / Bloom",
    category: "Stylized",
    icon: "✦",
    description: "Add soft glow around bright areas",
    defaultParams: { intensity: 0.5, radius: 10, threshold: 0.7 },
    paramDefs: [
      { key: "intensity", label: "Intensity", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "radius", label: "Radius", type: "range", min: 1, max: 40, step: 1, unit: "px" },
      { key: "threshold", label: "Threshold", type: "range", min: 0, max: 1, step: 0.01 }
    ]
  },
  {
    type: "chromaKey",
    label: "Chroma Key",
    category: "Keying",
    icon: "⬜",
    description: "Remove a specific color background",
    defaultParams: { keyColor: "#00ff00", tolerance: 0.3, spill: 0.2 },
    paramDefs: [
      { key: "keyColor", label: "Key Color", type: "color" },
      { key: "tolerance", label: "Tolerance", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "spill", label: "Spill Suppress", type: "range", min: 0, max: 1, step: 0.01 }
    ]
  },
  {
    type: "pixelate",
    label: "Pixelate",
    category: "Stylized",
    icon: "⬛",
    description: "Mosaic / pixel art style",
    defaultParams: { size: 8 },
    paramDefs: [
      { key: "size", label: "Pixel Size", type: "range", min: 1, max: 64, step: 1, unit: "px" }
    ]
  },
  {
    type: "edgeDetect",
    label: "Edge Detect",
    category: "Stylized",
    icon: "◻",
    description: "Outline-only / sketch effect",
    defaultParams: { strength: 1, invert: false },
    paramDefs: [
      { key: "strength", label: "Strength", type: "range", min: 0, max: 5, step: 0.1 },
      { key: "invert", label: "Invert", type: "toggle" }
    ]
  },
  // Additional effects requested
  {
    type: "contrast",
    label: "B&W / Sepia",
    category: "Color",
    icon: "◧",
    description: "Convert to black & white or sepia",
    defaultParams: { amount: 1, sepia: 0 },
    paramDefs: [
      { key: "amount", label: "Desaturate", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "sepia", label: "Sepia", type: "range", min: 0, max: 1, step: 0.01 }
    ]
  },
  {
    type: "colorReplace",
    label: "Exposure",
    category: "Color",
    icon: "◉",
    description: "Adjust exposure like a camera stop",
    defaultParams: { stops: 0 },
    paramDefs: [
      { key: "stops", label: "Stops", type: "range", min: -3, max: 3, step: 0.05, unit: " EV" }
    ]
  },
  {
    type: "backgroundRemoval",
    label: "RGB Split",
    category: "Stylized",
    icon: "▣",
    description: "Chromatic aberration / RGB channel split",
    defaultParams: { amount: 4 },
    paramDefs: [
      { key: "amount", label: "Amount", type: "range", min: 0, max: 20, step: 0.5, unit: "px" }
    ]
  }
];

const EFFECT_CATEGORIES = Array.from(new Set(EFFECT_LIBRARY.map((e) => e.category)));

// ─── Individual Effect Card ───────────────────────────────────────────────────

interface EffectCardProps {
  effect: ClipEffect;
  def: EffectDef;
  index: number;
  totalCount: number;
  isExpanded: boolean;
  isDragging: boolean;
  onToggleExpand: () => void;
  onToggle: () => void;
  onUpdate: (params: Record<string, number | string | boolean>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: (idx: number) => void;
  onDragOver: (idx: number) => void;
  onDragEnd: () => void;
}

function EffectCard({
  effect,
  def,
  index,
  totalCount,
  isExpanded,
  isDragging,
  onToggleExpand,
  onToggle,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDragEnd
}: EffectCardProps) {
  return (
    <div
      className={`effect-card${!effect.enabled ? " effect-card-disabled" : ""}${isDragging ? " effect-card-dragging" : ""}`}
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(index); }}
      onDragEnd={onDragEnd}
    >
      <div className="effect-card-header" onClick={onToggleExpand}>
        <span className="effect-drag-handle" title="Drag to reorder">⠿</span>
        <span className="effect-icon">{def.icon}</span>
        <span className="effect-label">{def.label}</span>
        <div className="effect-controls">
          {/* Toggle enable/disable */}
          <button
            className={`effect-toggle-btn${effect.enabled ? " on" : ""}`}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            title={effect.enabled ? "Disable effect" : "Enable effect"}
            type="button"
          >
            <span className="effect-toggle-pip" />
          </button>
          <button
            className="effect-move-btn"
            disabled={index === 0}
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            title="Move up"
            type="button"
          >↑</button>
          <button
            className="effect-move-btn"
            disabled={index === totalCount - 1}
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            title="Move down"
            type="button"
          >↓</button>
          <button
            className="effect-remove-btn"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            title="Remove effect"
            type="button"
          >✕</button>
        </div>
        <span className={`effect-expand-arrow${isExpanded ? " open" : ""}`}>›</span>
      </div>

      {isExpanded && (
        <div className="effect-params">
          {def.description && <p className="effect-desc">{def.description}</p>}
          {def.paramDefs.map((pDef) => {
            const val = effect.params[pDef.key];
            const displayVal = typeof val === "number"
              ? (Number.isInteger(val) ? val.toString() : val.toFixed(pDef.step && pDef.step < 0.1 ? 2 : 1))
              : String(val);

            return (
              <div key={pDef.key} className="effect-param-row">
                <label className="effect-param-label">{pDef.label}</label>
                {pDef.type === "range" && (
                  <div className="effect-param-control">
                    <input
                      type="range"
                      className="effect-range"
                      min={pDef.min}
                      max={pDef.max}
                      step={pDef.step}
                      value={Number(val)}
                      onChange={(e) => onUpdate({ ...effect.params, [pDef.key]: Number(e.target.value) })}
                    />
                    <span className="effect-param-value">
                      {displayVal}{pDef.unit ?? ""}
                    </span>
                  </div>
                )}
                {pDef.type === "toggle" && (
                  <div className="effect-param-control">
                    <label className="effect-toggle-label">
                      <input
                        type="checkbox"
                        className="effect-checkbox"
                        checked={Boolean(val)}
                        onChange={(e) => onUpdate({ ...effect.params, [pDef.key]: e.target.checked })}
                      />
                      <span className="effect-checkbox-indicator" />
                    </label>
                  </div>
                )}
                {pDef.type === "select" && (
                  <div className="effect-param-control">
                    <select
                      className="field-select effect-select"
                      value={String(val)}
                      onChange={(e) => onUpdate({ ...effect.params, [pDef.key]: e.target.value })}
                    >
                      {pDef.options?.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                )}
                {pDef.type === "color" && (
                  <div className="effect-param-control">
                    <div className="effect-color-wrap">
                      <input
                        type="color"
                        className="effect-color-input"
                        value={String(val)}
                        onChange={(e) => onUpdate({ ...effect.params, [pDef.key]: e.target.value })}
                      />
                      <span className="effect-color-swatch" style={{ background: String(val) }} />
                      <span className="effect-param-value">{String(val)}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div className="effect-reset-row">
            <button
              className="effect-reset-btn"
              type="button"
              onClick={() => onUpdate({ ...def.defaultParams })}
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Background Removal Card ──────────────────────────────────────────────────

interface BGRemovalCardProps {
  config: BackgroundRemovalConfig | null;
  onToggle: () => void;
  onUpdate: (c: Partial<BackgroundRemovalConfig>) => void;
}

function BGRemovalCard({ config, onToggle, onUpdate }: BGRemovalCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`effect-card ai-card${config?.enabled ? " ai-active" : ""}`}>
      <div className="effect-card-header" onClick={() => setExpanded((x) => !x)}>
        <span className="effect-drag-handle" />
        <span className="effect-icon">🧠</span>
        <span className="effect-label">AI Background Removal</span>
        <div className="effect-controls">
          <button
            className={`effect-toggle-btn${config?.enabled ? " on" : ""}`}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            title="Toggle background removal"
            type="button"
          >
            <span className="effect-toggle-pip" />
          </button>
        </div>
        <span className={`effect-expand-arrow${expanded ? " open" : ""}`}>›</span>
      </div>

      {expanded && config && (
        <div className="effect-params">
          <div className="ai-status-row">
            {config.enabled
              ? <span className="ai-status on">🟢 Active — frames segmented at runtime</span>
              : <span className="ai-status off">⚫ Disabled</span>}
          </div>
          <div className="effect-param-row">
            <label className="effect-param-label">Threshold</label>
            <div className="effect-param-control">
              <input type="range" className="effect-range" min={0} max={1} step={0.01}
                value={config.threshold}
                onChange={(e) => onUpdate({ threshold: Number(e.target.value) })}
              />
              <span className="effect-param-value">{config.threshold.toFixed(2)}</span>
            </div>
          </div>
          <div className="effect-param-row">
            <label className="effect-param-label">Edge Refine</label>
            <div className="effect-param-control">
              <input type="range" className="effect-range" min={0} max={1} step={0.01}
                value={config.edgeRefinement}
                onChange={(e) => onUpdate({ edgeRefinement: Number(e.target.value) })}
              />
              <span className="effect-param-value">{config.edgeRefinement.toFixed(2)}</span>
            </div>
          </div>
          <div className="effect-param-row">
            <label className="effect-param-label">Spill Suppress</label>
            <div className="effect-param-control">
              <input type="range" className="effect-range" min={0} max={1} step={0.01}
                value={config.spillSuppression}
                onChange={(e) => onUpdate({ spillSuppression: Number(e.target.value) })}
              />
              <span className="effect-param-value">{config.spillSuppression.toFixed(2)}</span>
            </div>
          </div>
          <div className="effect-param-row">
            <label className="effect-param-label">Background</label>
            <div className="effect-param-control">
              <select
                className="field-select effect-select"
                value={config.backgroundType}
                onChange={(e) =>
                  onUpdate({ backgroundType: e.target.value as BackgroundRemovalConfig["backgroundType"] })
                }
              >
                <option value="transparent">Transparent</option>
                <option value="solidColor">Solid Color</option>
                <option value="blur">Blur Background</option>
              </select>
            </div>
          </div>
          {config.backgroundType === "solidColor" && (
            <div className="effect-param-row">
              <label className="effect-param-label">BG Color</label>
              <div className="effect-param-control">
                <div className="effect-color-wrap">
                  <input
                    type="color"
                    className="effect-color-input"
                    value={config.backgroundColor}
                    onChange={(e) => onUpdate({ backgroundColor: e.target.value })}
                  />
                  <span className="effect-color-swatch" style={{ background: config.backgroundColor }} />
                </div>
              </div>
            </div>
          )}
          <p className="ai-note">
            Uses MediaPipe Selfie Segmentation via Canvas API.
            Best with well-lit, clear subject footage.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Hover preview hook ───────────────────────────────────────────────────────

function useHoverPreview(delay = 2500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activePreview, setActivePreview] = useState<string | null>(null);

  const startPreview = useCallback((id: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setActivePreview(id);
    }, delay);
  }, [delay]);

  const cancelPreview = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setActivePreview(null);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return { activePreview, startPreview, cancelPreview };
}

// ─── Library item with hover preview ─────────────────────────────────────────

interface LibraryItemProps {
  def: EffectDef;
  isActivePreview: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
}

function LibraryItem({ def, isActivePreview, onMouseEnter, onMouseLeave, onClick }: LibraryItemProps) {
  const previewFilter = computeCssFilterFromEffects([{
    id: "preview",
    type: def.type,
    enabled: true,
    order: 0,
    params: def.defaultParams,
    maskIds: [],
    keyframes: {}
  }]);

  return (
    <button
      className={`effect-library-item${isActivePreview ? " previewing" : ""}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      type="button"
      title={def.description}
    >
      <div className="effect-library-item-preview" style={{ filter: previewFilter !== "none" ? previewFilter : undefined }}>
        <span className="effect-library-icon">{def.icon}</span>
      </div>
      <span className="effect-library-label">{def.label}</span>
      {isActivePreview && <span className="effect-preview-badge">Preview</span>}
    </button>
  );
}

// ─── Main EffectsPanel ────────────────────────────────────────────────────────

export function EffectsPanel({
  selectedSegment,
  effects,
  aiBackgroundRemoval,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  onToggleEffect,
  onReorderEffects,
  onToggleBackgroundRemoval,
  onSetBackgroundRemoval
}: EffectsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [libraryCategory, setLibraryCategory] = useState(EFFECT_CATEGORIES[0]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [savedPresets, setSavedPresets] = useState<EffectPreset[]>(loadSavedPresets);
  const [presetSaveName, setPresetSaveName] = useState("");

  const { activePreview, startPreview, cancelPreview } = useHoverPreview(2500);

  const allPresets = [...DEFAULT_PRESETS, ...savedPresets];

  function handleAddPreset(preset: EffectPreset) {
    preset.effects.forEach((pe, i) => {
      const def = EFFECT_LIBRARY.find((d) => d.type === pe.type);
      if (!def) return;
      onAddEffect({
        id: createId(),
        type: pe.type,
        enabled: true,
        order: effects.length + i,
        params: { ...pe.params },
        maskIds: [],
        keyframes: {}
      });
    });
    setShowPresets(false);
  }

  function handleSavePreset() {
    const name = presetSaveName.trim();
    if (!name || !effects.length) return;
    const preset: EffectPreset = {
      id: createId(),
      name,
      effects: effects.map((e) => ({ type: e.type, params: { ...e.params } }))
    };
    const next = [...savedPresets, preset];
    setSavedPresets(next);
    savePresetsToStorage(next);
    setPresetSaveName("");
  }

  function handleDeletePreset(id: string) {
    const next = savedPresets.filter((p) => p.id !== id);
    setSavedPresets(next);
    savePresetsToStorage(next);
  }

  if (!selectedSegment) {
    return (
      <div className="effects-panel-empty">
        <div className="effects-panel-empty-icon">✦</div>
        <p className="effects-panel-empty-title">No Clip Selected</p>
        <p className="effects-panel-empty-hint">Select a video clip to apply effects.</p>
      </div>
    );
  }

  const sorted = [...effects].sort((a, b) => a.order - b.order);

  return (
    <div className="effects-panel">
      {/* Toolbar row */}
      <div className="effects-panel-toolbar">
        <button
          className={`effects-toolbar-btn${showLibrary ? " active" : ""}`}
          onClick={() => { setShowLibrary((x) => !x); setShowPresets(false); }}
          type="button"
        >
          + Add Effect
        </button>
        <button
          className={`effects-toolbar-btn${showPresets ? " active" : ""}`}
          onClick={() => { setShowPresets((x) => !x); setShowLibrary(false); }}
          type="button"
        >
          ⚡ Presets
        </button>
        {effects.length > 0 && (
          <span className="effects-count-badge">{effects.filter((e) => e.enabled).length}/{effects.length}</span>
        )}
      </div>

      {/* Effect Library */}
      {showLibrary && (
        <div className="effect-library">
          <div className="effect-category-tabs">
            {EFFECT_CATEGORIES.map((cat) => (
              <button
                key={cat}
                className={`effect-cat-btn${libraryCategory === cat ? " active" : ""}`}
                onClick={() => setLibraryCategory(cat)}
                type="button"
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="effect-library-grid">
            {EFFECT_LIBRARY.filter((e) => e.category === libraryCategory).map((def) => (
              <LibraryItem
                key={def.type}
                def={def}
                isActivePreview={activePreview === def.type}
                onMouseEnter={() => startPreview(def.type)}
                onMouseLeave={() => cancelPreview()}
                onClick={() => {
                  const newEffect: ClipEffect = {
                    id: createId(),
                    type: def.type,
                    enabled: true,
                    order: effects.length,
                    params: { ...def.defaultParams },
                    maskIds: [],
                    keyframes: {}
                  };
                  onAddEffect(newEffect);
                  setShowLibrary(false);
                  setExpandedId(newEffect.id);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Presets Panel */}
      {showPresets && (
        <div className="effect-presets-panel">
          <p className="effect-presets-title">Effect Presets</p>

          <div className="effect-presets-grid">
            {allPresets.map((preset) => (
              <div key={preset.id} className="effect-preset-item">
                <button
                  className="effect-preset-apply-btn"
                  onClick={() => handleAddPreset(preset)}
                  type="button"
                >
                  <span className="effect-preset-name">{preset.name}</span>
                  <span className="effect-preset-count">{preset.effects.length} fx</span>
                </button>
                {!DEFAULT_PRESETS.find((p) => p.id === preset.id) && (
                  <button
                    className="effect-preset-delete-btn"
                    onClick={() => handleDeletePreset(preset.id)}
                    type="button"
                    title="Delete preset"
                  >✕</button>
                )}
              </div>
            ))}
          </div>

          {effects.length > 0 && (
            <div className="effect-preset-save-row">
              <input
                className="effect-preset-name-input"
                type="text"
                placeholder="New preset name…"
                value={presetSaveName}
                onChange={(e) => setPresetSaveName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSavePreset(); }}
              />
              <button
                className="effects-toolbar-btn"
                disabled={!presetSaveName.trim()}
                onClick={handleSavePreset}
                type="button"
              >
                Save Stack
              </button>
            </div>
          )}
        </div>
      )}

      {/* AI Background Removal always at top of stack */}
      <div className="effect-stack">
        <BGRemovalCard
          config={aiBackgroundRemoval}
          onToggle={onToggleBackgroundRemoval}
          onUpdate={onSetBackgroundRemoval}
        />

        {/* Effect stack */}
        {sorted.length === 0 && (
          <div className="effect-stack-empty">
            <p>No effects applied. Click <strong>+ Add Effect</strong> to start.</p>
          </div>
        )}
        {sorted.map((effect, idx) => {
          const def = EFFECT_LIBRARY.find((d) => d.type === effect.type);
          if (!def) return null;
          return (
            <EffectCard
              key={effect.id}
              effect={effect}
              def={def}
              index={idx}
              totalCount={sorted.length}
              isExpanded={expandedId === effect.id}
              isDragging={dragIdx === idx}
              onToggleExpand={() => setExpandedId((x) => (x === effect.id ? null : effect.id))}
              onToggle={() => onToggleEffect(effect.id)}
              onUpdate={(params) => onUpdateEffect(effect.id, { params })}
              onRemove={() => {
                onRemoveEffect(effect.id);
                if (expandedId === effect.id) setExpandedId(null);
              }}
              onMoveUp={() => { if (idx > 0) onReorderEffects(idx, idx - 1); }}
              onMoveDown={() => { if (idx < sorted.length - 1) onReorderEffects(idx, idx + 1); }}
              onDragStart={(i) => setDragIdx(i)}
              onDragOver={(targetIdx) => {
                if (dragIdx !== null && dragIdx !== targetIdx) {
                  onReorderEffects(dragIdx, targetIdx);
                  setDragIdx(targetIdx);
                }
              }}
              onDragEnd={() => setDragIdx(null)}
            />
          );
        })}
      </div>
    </div>
  );
}
