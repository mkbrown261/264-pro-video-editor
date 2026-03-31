import { useState } from "react";
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

// ─── Effect definitions ───────────────────────────────────────────────────────

interface EffectDef {
  type: EffectType;
  label: string;
  category: string;
  icon: string;
  defaultParams: Record<string, number | string | boolean>;
  paramDefs: EffectParamDef[];
}

interface EffectParamDef {
  key: string;
  label: string;
  type: "range" | "toggle" | "select" | "color";
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

const EFFECT_LIBRARY: EffectDef[] = [
  {
    type: "blur",
    label: "Blur",
    category: "Spatial",
    icon: "◎",
    defaultParams: { radius: 5, type: "gaussian" },
    paramDefs: [
      { key: "radius", label: "Radius", type: "range", min: 0, max: 50, step: 0.5 },
      { key: "type", label: "Type", type: "select", options: ["gaussian", "motion", "radial"] }
    ]
  },
  {
    type: "sharpen",
    label: "Sharpen",
    category: "Spatial",
    icon: "◈",
    defaultParams: { amount: 0.5, radius: 1 },
    paramDefs: [
      { key: "amount", label: "Amount", type: "range", min: 0, max: 2, step: 0.05 },
      { key: "radius", label: "Radius", type: "range", min: 0.5, max: 5, step: 0.5 }
    ]
  },
  {
    type: "glow",
    label: "Glow",
    category: "Stylized",
    icon: "✦",
    defaultParams: { intensity: 0.5, radius: 10, threshold: 0.7 },
    paramDefs: [
      { key: "intensity", label: "Intensity", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "radius", label: "Radius", type: "range", min: 1, max: 40, step: 1 },
      { key: "threshold", label: "Threshold", type: "range", min: 0, max: 1, step: 0.01 }
    ]
  },
  {
    type: "brightness",
    label: "Brightness/Contrast",
    category: "Color",
    icon: "☀",
    defaultParams: { brightness: 0, contrast: 0 },
    paramDefs: [
      { key: "brightness", label: "Brightness", type: "range", min: -1, max: 1, step: 0.01 },
      { key: "contrast", label: "Contrast", type: "range", min: -1, max: 1, step: 0.01 }
    ]
  },
  {
    type: "hueShift",
    label: "Hue/Saturation",
    category: "Color",
    icon: "◑",
    defaultParams: { hue: 0, saturation: 1, lightness: 0 },
    paramDefs: [
      { key: "hue", label: "Hue Shift", type: "range", min: -180, max: 180, step: 1 },
      { key: "saturation", label: "Saturation", type: "range", min: 0, max: 3, step: 0.01 },
      { key: "lightness", label: "Lightness", type: "range", min: -1, max: 1, step: 0.01 }
    ]
  },
  {
    type: "noise",
    label: "Noise",
    category: "Texture",
    icon: "⬡",
    defaultParams: { amount: 0.1, colorNoise: false },
    paramDefs: [
      { key: "amount", label: "Amount", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "colorNoise", label: "Color Noise", type: "toggle" }
    ]
  },
  {
    type: "vignette",
    label: "Vignette",
    category: "Stylized",
    icon: "⬭",
    defaultParams: { intensity: 0.5, radius: 0.7, feather: 0.5 },
    paramDefs: [
      { key: "intensity", label: "Intensity", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "radius", label: "Radius", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "feather", label: "Feather", type: "range", min: 0, max: 1, step: 0.01 }
    ]
  },
  {
    type: "chromaKey",
    label: "Chroma Key",
    category: "Keying",
    icon: "⬜",
    defaultParams: { keyColor: "#00ff00", tolerance: 0.3, spill: 0.2 },
    paramDefs: [
      { key: "keyColor", label: "Key Color", type: "color" },
      { key: "tolerance", label: "Tolerance", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "spill", label: "Spill Suppression", type: "range", min: 0, max: 1, step: 0.01 }
    ]
  },
  {
    type: "pixelate",
    label: "Pixelate",
    category: "Stylized",
    icon: "⬛",
    defaultParams: { size: 8 },
    paramDefs: [
      { key: "size", label: "Pixel Size", type: "range", min: 1, max: 64, step: 1 }
    ]
  },
  {
    type: "edgeDetect",
    label: "Edge Detect",
    category: "Stylized",
    icon: "◻",
    defaultParams: { strength: 1, invert: false },
    paramDefs: [
      { key: "strength", label: "Strength", type: "range", min: 0, max: 5, step: 0.1 },
      { key: "invert", label: "Invert", type: "toggle" }
    ]
  }
];

const EFFECT_CATEGORIES = Array.from(new Set(EFFECT_LIBRARY.map((e) => e.category)));

// ─── Individual Effect Card ───────────────────────────────────────────────────

interface EffectCardProps {
  effect: ClipEffect;
  def: EffectDef;
  index: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggle: () => void;
  onUpdate: (params: Record<string, number | string | boolean>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function EffectCard({
  effect,
  def,
  index,
  isExpanded,
  onToggleExpand,
  onToggle,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown
}: EffectCardProps) {
  return (
    <div className={`effect-card${!effect.enabled ? " disabled" : ""}`}>
      <div className="effect-card-header" onClick={onToggleExpand}>
        <span className="effect-icon">{def.icon}</span>
        <span className="effect-label">{def.label}</span>
        <div className="effect-controls">
          <button
            className={`effect-toggle-btn${effect.enabled ? " on" : ""}`}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            title={effect.enabled ? "Disable effect" : "Enable effect"}
            type="button"
          >
            {effect.enabled ? "●" : "○"}
          </button>
          <button
            className="effect-move-btn"
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            title="Move up"
            type="button"
          >↑</button>
          <button
            className="effect-move-btn"
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            title="Move down"
            type="button"
          >↓</button>
          <button
            className="effect-remove-btn"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            title="Remove effect"
            type="button"
          >×</button>
        </div>
      </div>

      {isExpanded && (
        <div className="effect-params">
          {def.paramDefs.map((pDef) => {
            const val = effect.params[pDef.key];
            return (
              <div key={pDef.key} className="effect-param-row">
                <label>{pDef.label}</label>
                {pDef.type === "range" && (
                  <>
                    <input
                      type="range"
                      min={pDef.min}
                      max={pDef.max}
                      step={pDef.step}
                      value={Number(val)}
                      onChange={(e) => onUpdate({ ...effect.params, [pDef.key]: Number(e.target.value) })}
                    />
                    <span>{typeof val === "number" ? val.toFixed(2) : String(val)}</span>
                  </>
                )}
                {pDef.type === "toggle" && (
                  <input
                    type="checkbox"
                    checked={Boolean(val)}
                    onChange={(e) => onUpdate({ ...effect.params, [pDef.key]: e.target.checked })}
                  />
                )}
                {pDef.type === "select" && (
                  <select
                    className="field-select"
                    value={String(val)}
                    onChange={(e) => onUpdate({ ...effect.params, [pDef.key]: e.target.value })}
                  >
                    {pDef.options?.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                )}
                {pDef.type === "color" && (
                  <input
                    type="color"
                    value={String(val)}
                    onChange={(e) => onUpdate({ ...effect.params, [pDef.key]: e.target.value })}
                  />
                )}
              </div>
            );
          })}
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
        <span className="effect-icon">🧠</span>
        <span className="effect-label">AI Background Removal</span>
        <div className="effect-controls">
          <button
            className={`effect-toggle-btn${config?.enabled ? " on" : ""}`}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            title="Toggle background removal"
            type="button"
          >
            {config?.enabled ? "●" : "○"}
          </button>
        </div>
      </div>

      {expanded && config && (
        <div className="effect-params">
          <div className="ai-status-row">
            {config.enabled
              ? <span className="ai-status on">Active — frames segmented at runtime</span>
              : <span className="ai-status off">Disabled</span>}
          </div>
          <div className="effect-param-row">
            <label>Threshold</label>
            <input
              type="range" min={0} max={1} step={0.01}
              value={config.threshold}
              onChange={(e) => onUpdate({ threshold: Number(e.target.value) })}
            />
            <span>{config.threshold.toFixed(2)}</span>
          </div>
          <div className="effect-param-row">
            <label>Edge Refinement</label>
            <input
              type="range" min={0} max={1} step={0.01}
              value={config.edgeRefinement}
              onChange={(e) => onUpdate({ edgeRefinement: Number(e.target.value) })}
            />
            <span>{config.edgeRefinement.toFixed(2)}</span>
          </div>
          <div className="effect-param-row">
            <label>Spill Suppress</label>
            <input
              type="range" min={0} max={1} step={0.01}
              value={config.spillSuppression}
              onChange={(e) => onUpdate({ spillSuppression: Number(e.target.value) })}
            />
            <span>{config.spillSuppression.toFixed(2)}</span>
          </div>
          <div className="effect-param-row">
            <label>Background</label>
            <select
              className="field-select"
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
          {config.backgroundType === "solidColor" && (
            <div className="effect-param-row">
              <label>Color</label>
              <input
                type="color"
                value={config.backgroundColor}
                onChange={(e) => onUpdate({ backgroundColor: e.target.value })}
              />
            </div>
          )}
          <p className="ai-note">
            AI segmentation uses MediaPipe Selfie Segmentation via Canvas API.
            For best results use well-lit footage with clear subject separation.
          </p>
        </div>
      )}
    </div>
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
  const [libraryCategory, setLibraryCategory] = useState(EFFECT_CATEGORIES[0]);

  if (!selectedSegment) {
    return (
      <div className="effects-panel-empty">
        <p>Select a video clip to apply effects.</p>
      </div>
    );
  }

  const sorted = [...effects].sort((a, b) => a.order - b.order);

  return (
    <div className="effects-panel">
      {/* AI Background Removal always at top */}
      <BGRemovalCard
        config={aiBackgroundRemoval}
        onToggle={onToggleBackgroundRemoval}
        onUpdate={onSetBackgroundRemoval}
      />

      {/* Effect stack */}
      <div className="effect-stack">
        {sorted.map((effect, idx) => {
          const def = EFFECT_LIBRARY.find((d) => d.type === effect.type);
          if (!def) return null;
          return (
            <EffectCard
              key={effect.id}
              effect={effect}
              def={def}
              index={idx}
              isExpanded={expandedId === effect.id}
              onToggleExpand={() => setExpandedId((x) => (x === effect.id ? null : effect.id))}
              onToggle={() => onToggleEffect(effect.id)}
              onUpdate={(params) => onUpdateEffect(effect.id, { params })}
              onRemove={() => onRemoveEffect(effect.id)}
              onMoveUp={() => { if (idx > 0) onReorderEffects(idx, idx - 1); }}
              onMoveDown={() => { if (idx < sorted.length - 1) onReorderEffects(idx, idx + 1); }}
            />
          );
        })}
      </div>

      {/* Add Effect */}
      <button
        className="panel-action add-effect-btn"
        onClick={() => setShowLibrary((x) => !x)}
        type="button"
      >
        {showLibrary ? "Close Library" : "+ Add Effect"}
      </button>

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
              <button
                key={def.type}
                className="effect-library-item"
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
                type="button"
              >
                <span className="effect-icon">{def.icon}</span>
                <span>{def.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
