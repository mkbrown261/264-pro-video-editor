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
  // ── Cinematic ──
  {
    id: "cinematic",
    name: "🎬 Cinematic",
    effects: [
      { type: "vignette", params: { intensity: 0.55, radius: 0.65, feather: 0.5 } },
      { type: "brightness", params: { brightness: -0.05, contrast: 0.15 } },
      { type: "hueShift", params: { hue: 0, saturation: 0.82, lightness: 0 } }
    ]
  },
  {
    id: "hollywood",
    name: "🎥 Hollywood Grade",
    effects: [
      { type: "colorTemperature", params: { temperature: 3, tint: 2 } },
      { type: "brightness", params: { brightness: -0.08, contrast: 0.22 } },
      { type: "hueShift", params: { hue: 0, saturation: 0.75, lightness: 0 } },
      { type: "vignette", params: { intensity: 0.65, radius: 0.6, feather: 0.55 } },
      { type: "noise", params: { amount: 0.04, colorNoise: false } }
    ]
  },
  {
    id: "teal-orange",
    name: "🔷 Teal & Orange",
    effects: [
      { type: "colorBalance", params: { shadowR: -8, shadowB: 12, highlightR: 10, highlightB: -8 } },
      { type: "brightness", params: { brightness: -0.03, contrast: 0.18 } },
      { type: "hueShift", params: { hue: 0, saturation: 1.1, lightness: 0 } }
    ]
  },
  {
    id: "anamorphic",
    name: "🎞 Anamorphic",
    effects: [
      { type: "vignette", params: { intensity: 0.5, radius: 0.55, feather: 0.7 } },
      { type: "rgbSplit", params: { amount: 2 } },
      { type: "brightness", params: { brightness: -0.04, contrast: 0.12 } }
    ]
  },
  // ── Lifestyle / Social ──
  {
    id: "warm-film",
    name: "☀️ Warm Film",
    effects: [
      { type: "hueShift", params: { hue: 8, saturation: 1.1, lightness: 0.04 } },
      { type: "noise", params: { amount: 0.07, colorNoise: true } },
      { type: "vignette", params: { intensity: 0.35, radius: 0.7, feather: 0.6 } }
    ]
  },
  {
    id: "golden-hour",
    name: "🌅 Golden Hour",
    effects: [
      { type: "colorTemperature", params: { temperature: 18, tint: 4 } },
      { type: "hueShift", params: { hue: 5, saturation: 1.25, lightness: 0.06 } },
      { type: "vignette", params: { intensity: 0.3, radius: 0.75, feather: 0.65 } }
    ]
  },
  {
    id: "lifestyle",
    name: "💛 Lifestyle Bright",
    effects: [
      { type: "brightness", params: { brightness: 0.08, contrast: -0.05 } },
      { type: "hueShift", params: { hue: 6, saturation: 1.15, lightness: 0.05 } },
      { type: "vibrance", params: { vibrance: 0.3 } }
    ]
  },
  {
    id: "summer-vibes",
    name: "🏖 Summer Vibes",
    effects: [
      { type: "colorTemperature", params: { temperature: 12, tint: 0 } },
      { type: "hueShift", params: { hue: 10, saturation: 1.2, lightness: 0.05 } },
      { type: "shadows", params: { shadows: 0.15, highlights: 0.05 } }
    ]
  },
  // ── Retro / Film ──
  {
    id: "vintage-film",
    name: "📷 Vintage Film",
    effects: [
      { type: "hueShift", params: { hue: 5, saturation: 0.7, lightness: 0.06 } },
      { type: "noise", params: { amount: 0.12, colorNoise: false } },
      { type: "vignette", params: { intensity: 0.6, radius: 0.6, feather: 0.45 } },
      { type: "brightness", params: { brightness: 0.03, contrast: -0.05 } }
    ]
  },
  {
    id: "kodachrome",
    name: "🎞 Kodachrome",
    effects: [
      { type: "hueShift", params: { hue: -5, saturation: 1.35, lightness: 0 } },
      { type: "brightness", params: { brightness: 0.05, contrast: 0.2 } },
      { type: "colorBalance", params: { shadowR: 5, shadowG: 0, shadowB: -5, highlightR: 5, highlightB: -3 } }
    ]
  },
  {
    id: "faded-analog",
    name: "📼 Faded Analog",
    effects: [
      { type: "hueShift", params: { hue: 8, saturation: 0.65, lightness: 0.08 } },
      { type: "noise", params: { amount: 0.15, colorNoise: true } },
      { type: "brightness", params: { brightness: 0.1, contrast: -0.15 } },
      { type: "vignette", params: { intensity: 0.4, radius: 0.65, feather: 0.55 } }
    ]
  },
  {
    id: "cross-process",
    name: "🌈 Cross Process",
    effects: [
      { type: "colorBalance", params: { shadowR: -15, shadowB: 20, highlightR: 15, highlightB: -10 } },
      { type: "brightness", params: { brightness: 0.05, contrast: 0.3 } },
      { type: "hueShift", params: { hue: 0, saturation: 1.4, lightness: 0 } }
    ]
  },
  // ── Cold / Blue ──
  {
    id: "cold-blue",
    name: "🧊 Cold Blue",
    effects: [
      { type: "colorTemperature", params: { temperature: -16, tint: 0 } },
      { type: "brightness", params: { brightness: 0.02, contrast: 0.1 } }
    ]
  },
  {
    id: "arctic",
    name: "❄️ Arctic Chill",
    effects: [
      { type: "colorTemperature", params: { temperature: -22, tint: -3 } },
      { type: "hueShift", params: { hue: -8, saturation: 0.8, lightness: 0.03 } },
      { type: "vignette", params: { intensity: 0.35, radius: 0.7, feather: 0.6 } }
    ]
  },
  // ── Contrast / Drama ──
  {
    id: "high-contrast",
    name: "⚡ High Contrast",
    effects: [
      { type: "brightness", params: { brightness: 0, contrast: 0.4 } },
      { type: "hueShift", params: { hue: 0, saturation: 1.2, lightness: 0 } }
    ]
  },
  {
    id: "noir",
    name: "🎭 Film Noir",
    effects: [
      { type: "contrast", params: { amount: 1, sepia: 0 } },
      { type: "brightness", params: { brightness: -0.1, contrast: 0.35 } },
      { type: "vignette", params: { intensity: 0.75, radius: 0.55, feather: 0.5 } }
    ]
  },
  {
    id: "moody-drama",
    name: "🌑 Moody Drama",
    effects: [
      { type: "shadows", params: { shadows: -0.2, highlights: 0.1 } },
      { type: "hueShift", params: { hue: 0, saturation: 0.9, lightness: 0 } },
      { type: "brightness", params: { brightness: -0.12, contrast: 0.25 } },
      { type: "vignette", params: { intensity: 0.7, radius: 0.58, feather: 0.5 } }
    ]
  },
  // ── Sepia / B&W ──
  {
    id: "bw-classic",
    name: "⬛ B&W Classic",
    effects: [
      { type: "contrast", params: { amount: 1, sepia: 0 } },
      { type: "brightness", params: { brightness: 0, contrast: 0.1 } }
    ]
  },
  {
    id: "sepia",
    name: "🟫 Sepia",
    effects: [
      { type: "contrast", params: { amount: 0.85, sepia: 0.95 } },
      { type: "noise", params: { amount: 0.08, colorNoise: false } }
    ]
  },
  // ── Genre ──
  {
    id: "horror",
    name: "💀 Horror",
    effects: [
      { type: "hueShift", params: { hue: -15, saturation: 0.6, lightness: -0.05 } },
      { type: "brightness", params: { brightness: -0.18, contrast: 0.4 } },
      { type: "vignette", params: { intensity: 0.85, radius: 0.5, feather: 0.4 } },
      { type: "noise", params: { amount: 0.08, colorNoise: false } }
    ]
  },
  {
    id: "sci-fi",
    name: "🤖 Sci-Fi",
    effects: [
      { type: "colorTemperature", params: { temperature: -8, tint: 12 } },
      { type: "hueShift", params: { hue: 180, saturation: 0.7, lightness: 0.02 } },
      { type: "rgbSplit", params: { amount: 3 } },
      { type: "scanlines", params: { intensity: 0.15, spacing: 4 } }
    ]
  },
  {
    id: "western",
    name: "🤠 Western",
    effects: [
      { type: "hueShift", params: { hue: 12, saturation: 0.75, lightness: 0.08 } },
      { type: "noise", params: { amount: 0.1, colorNoise: false } },
      { type: "brightness", params: { brightness: 0.05, contrast: 0.12 } },
      { type: "vignette", params: { intensity: 0.55, radius: 0.62, feather: 0.5 } }
    ]
  },
  // ── Social Media ──
  {
    id: "instagram-pop",
    name: "📱 Instagram Pop",
    effects: [
      { type: "brightness", params: { brightness: 0.06, contrast: 0.08 } },
      { type: "hueShift", params: { hue: 0, saturation: 1.3, lightness: 0.03 } },
      { type: "vibrance", params: { vibrance: 0.4 } }
    ]
  },
  {
    id: "tiktok-vivid",
    name: "🎵 TikTok Vivid",
    effects: [
      { type: "hueShift", params: { hue: 0, saturation: 1.5, lightness: 0.04 } },
      { type: "brightness", params: { brightness: 0.05, contrast: 0.1 } }
    ]
  },
  {
    id: "youtube-crisp",
    name: "▶️ YouTube Crisp",
    effects: [
      { type: "sharpen", params: { amount: 0.6, radius: 1 } },
      { type: "brightness", params: { brightness: 0.04, contrast: 0.12 } },
      { type: "hueShift", params: { hue: 0, saturation: 1.1, lightness: 0 } }
    ]
  },
  // ── Stylized ──
  {
    id: "dreamscape",
    name: "✨ Dreamscape",
    effects: [
      { type: "blur", params: { radius: 1.5, type: "gaussian" } },
      { type: "glow", params: { intensity: 0.4, radius: 15, threshold: 0.65 } },
      { type: "hueShift", params: { hue: 10, saturation: 1.15, lightness: 0.05 } }
    ]
  },
  {
    id: "pop-art",
    name: "🎨 Pop Art",
    effects: [
      { type: "posterize", params: { levels: 4 } },
      { type: "hueShift", params: { hue: 0, saturation: 2.5, lightness: 0 } },
      { type: "brightness", params: { brightness: 0.1, contrast: 0.3 } }
    ]
  },
  {
    id: "sketch",
    name: "✏️ Pencil Sketch",
    effects: [
      { type: "edgeDetect", params: { strength: 2, invert: true } }
    ]
  },
  {
    id: "watercolor",
    name: "🎨 Watercolor",
    effects: [
      { type: "blur", params: { radius: 2, type: "gaussian" } },
      { type: "hueShift", params: { hue: 0, saturation: 0.8, lightness: 0.05 } },
      { type: "painterly", params: { strength: 0.7 } }
    ]
  },
  // ── Technical ──
  {
    id: "expose-fix",
    name: "🔧 Exposure Fix",
    effects: [
      { type: "colorReplace", params: { stops: 1.2 } },
      { type: "brightness", params: { brightness: 0, contrast: 0.05 } }
    ]
  },
  {
    id: "shadow-lift",
    name: "⬆️ Shadow Lift",
    effects: [
      { type: "shadows", params: { shadows: 0.25, highlights: 0 } },
      { type: "brightness", params: { brightness: 0, contrast: -0.05 } }
    ]
  },
  {
    id: "highlight-roll",
    name: "⬇️ Highlight Roll-off",
    effects: [
      { type: "shadows", params: { shadows: 0, highlights: -0.25 } }
    ]
  },
  {
    id: "chroma-key-green",
    name: "💚 Green Screen",
    effects: [
      { type: "chromaKey", params: { keyColor: "#00ff00", tolerance: 0.3, spill: 0.2 } }
    ]
  },
  // ── VHS / Retro Digital ──
  {
    id: "vhs",
    name: "📼 VHS",
    effects: [
      { type: "vhsEffect", params: { noise: 0.12, scanlines: 0.3, colorShift: 4, tracking: 0.2 } }
    ]
  },
  {
    id: "glitch-art",
    name: "💥 Glitch Art",
    effects: [
      { type: "glitchEffect", params: { intensity: 0.4, frequency: 5 } },
      { type: "rgbSplit", params: { amount: 8 } }
    ]
  },
  {
    id: "crt-monitor",
    name: "🖥 CRT Monitor",
    effects: [
      { type: "scanlines", params: { intensity: 0.3, spacing: 3 } },
      { type: "brightness", params: { brightness: -0.05, contrast: 0.1 } },
      { type: "hueShift", params: { hue: 0, saturation: 1.1, lightness: 0 } }
    ]
  },
  {
    id: "lo-fi",
    name: "📻 Lo-Fi",
    effects: [
      { type: "noise", params: { amount: 0.2, colorNoise: true } },
      { type: "hueShift", params: { hue: 5, saturation: 0.75, lightness: 0.04 } },
      { type: "brightness", params: { brightness: 0, contrast: -0.1 } }
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
        // FIX 7: Increased multiplier so blur is clearly visible at default settings.
        // radius 5 → blur(5px), radius 10 → blur(10px).
        parts.push(`blur(${Number(p.radius ?? 5) * 1}px)`);
        break;
      case "sharpen":
        // FIX 7: Sharpen — high contrast is the closest CSS-filter approximation.
        // amount 0.5 → contrast(2.0), clearly visible.
        parts.push(`contrast(${1 + Number(p.amount ?? 0.5) * 2}) brightness(${1 + Number(p.amount ?? 0.5) * 0.06})`);
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
        // Noise: approximate with contrast
        parts.push(`contrast(${1 + Number(p.amount ?? 0.1) * 0.12})`);
        break;
      case "vignette":
        // Vignette handled via CSS overlay — not a CSS filter
        break;
      case "pixelate":
        parts.push(`blur(${Number(p.size ?? 8) * 0.15}px)`);
        break;
      case "edgeDetect":
        parts.push(`contrast(${Number(p.strength ?? 1) * 8}) invert(${Number(p.invert ?? 0) ? 1 : 0})`);
        break;
      case "chromaKey":
        // ChromaKey: no CSS equiv; skip
        break;
      case "contrast": {
        // B&W / Sepia: desaturate + optional sepia tint
        const desat = Number(p.amount ?? 0);
        const sep   = Number(p.sepia ?? 0);
        if (desat > 0)  parts.push(`grayscale(${desat})`);
        if (sep   > 0)  parts.push(`sepia(${sep})`);
        break;
      }
      case "colorReplace":
        // Exposure: approximate with brightness (1 stop ≈ 2× brightness)
        parts.push(`brightness(${Math.pow(2, Number(p.stops ?? 0))})`);
        break;
      case "backgroundRemoval": {
        // RGB Split / chromatic aberration — approximate with hue-rotate + saturate
        const amt = Number(p.amount ?? 4);
        if (amt > 0) parts.push(`hue-rotate(${amt * 1.5}deg) saturate(${1 + amt * 0.05})`);
        break;
      }
      case "rgbSplit": {
        const amt = Number(p.amount ?? 4);
        if (amt > 0) parts.push(`hue-rotate(${amt * 1.5}deg) saturate(${1 + amt * 0.06})`);
        break;
      }
      case "colorTemperature": {
        const temp = Number(p.temperature ?? 0);
        const tint = Number(p.tint ?? 0);
        // Warm → orange-ish hue, cool → blue hue
        if (temp !== 0) parts.push(`hue-rotate(${temp * 0.25}deg) saturate(${1 + Math.abs(temp) * 0.005})`);
        if (tint !== 0) parts.push(`hue-rotate(${tint * 0.15}deg)`);
        break;
      }
      case "colorBalance": {
        const sr = Number(p.shadowR ?? 0);
        const sb = Number(p.shadowB ?? 0);
        const hr = Number(p.highlightR ?? 0);
        const hb = Number(p.highlightB ?? 0);
        const netHue = (sr - sb + hr - hb) * 0.3;
        if (netHue !== 0) parts.push(`hue-rotate(${netHue}deg)`);
        break;
      }
      case "vibrance": {
        const v = Number(p.vibrance ?? 0);
        parts.push(`saturate(${1 + v * 0.8})`);
        break;
      }
      case "shadows": {
        const sh = Number(p.shadows ?? 0);
        const hl = Number(p.highlights ?? 0);
        parts.push(`brightness(${1 + sh * 0.3})`);
        parts.push(`contrast(${1 - hl * 0.2})`);
        break;
      }
      case "curves": {
        const g = Number(p.masterGamma ?? 1);
        if (g !== 1) parts.push(`contrast(${g}) brightness(${g * 0.1 + 0.9})`);
        break;
      }
      case "filmGrain":
        parts.push(`contrast(${1 + Number(p.amount ?? 0.18) * 0.1})`);
        break;
      case "halftone":
        parts.push(`contrast(${1.1}) saturate(${0.9})`);
        break;
      case "scanlines":
        parts.push(`brightness(${1 - Number(p.intensity ?? 0.25) * 0.08})`);
        break;
      case "oldFilmEffect": {
        const sep = Number(p.sepia ?? 0.4);
        parts.push(`sepia(${sep}) contrast(${1.05}) brightness(${0.96})`);
        break;
      }
      case "lumaKey":
        break;
      case "posterize": {
        const lv = Number(p.levels ?? 4);
        parts.push(`contrast(${lv * 0.3 + 1})`);
        break;
      }
      case "solarize": {
        const thr = Number(p.threshold ?? 0.5);
        parts.push(`invert(${thr}) contrast(${2})`);
        break;
      }
      case "duotone": {
        parts.push(`grayscale(1)`);
        break;
      }
      case "nightVision": {
        const nb = Number(p.brightness ?? 0.1);
        parts.push(`grayscale(1) hue-rotate(90deg) saturate(3) brightness(${1 + nb})`);
        break;
      }
      case "infrared": {
        const is = Number(p.shift ?? 120);
        const sat = Number(p.saturation ?? 0.6);
        parts.push(`hue-rotate(${is}deg) saturate(${sat})`);
        break;
      }
      case "painterly":
        parts.push(`blur(${Number(p.strength ?? 0.5) * 2}px) saturate(${1 + Number(p.strength ?? 0.5) * 0.3})`);
        break;
      case "motionBlur": {
        const mb = Number(p.amount ?? 10);
        parts.push(`blur(${mb * 0.3}px)`);
        break;
      }
      case "radialBlur": {
        const rb = Number(p.amount ?? 8);
        parts.push(`blur(${rb * 0.2}px)`);
        break;
      }
      case "tiltShift": {
        const tr = Number(p.blurRadius ?? 8);
        parts.push(`blur(${tr * 0.3}px)`);
        break;
      }
      case "lensDistort":
        break;
      case "fishEye":
        break;
      case "mirror":
        break;
      case "kaleidoscope":
        break;
      case "vhsEffect": {
        const vn = Number(p.noise ?? 0.1);
        const vc = Number(p.colorShift ?? 3);
        parts.push(`contrast(${1 + vn * 0.1}) hue-rotate(${vc}deg) saturate(${0.9})`);
        break;
      }
      case "glitchEffect": {
        const gi = Number(p.intensity ?? 0.3);
        parts.push(`contrast(${1 + gi * 0.2}) hue-rotate(${gi * 10}deg)`);
        break;
      }
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
  // ── Color ─────────────────────────────────────────────────────────────────
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
    type: "colorTemperature",
    label: "Color Temperature",
    category: "Color",
    icon: "🌡",
    description: "Warm or cool the image like a camera white balance",
    defaultParams: { temperature: 0, tint: 0 },
    paramDefs: [
      { key: "temperature", label: "Temperature", type: "range", min: -100, max: 100, step: 1, unit: "K" },
      { key: "tint", label: "Tint (G↔M)", type: "range", min: -50, max: 50, step: 1 }
    ]
  },
  {
    type: "colorBalance",
    label: "Color Balance",
    category: "Color",
    icon: "⚖",
    description: "Adjust RGB balance in shadows, mids, and highlights",
    defaultParams: { shadowR: 0, shadowG: 0, shadowB: 0, highlightR: 0, highlightB: 0 },
    paramDefs: [
      { key: "shadowR", label: "Shadow Red", type: "range", min: -30, max: 30, step: 1 },
      { key: "shadowG", label: "Shadow Green", type: "range", min: -30, max: 30, step: 1 },
      { key: "shadowB", label: "Shadow Blue", type: "range", min: -30, max: 30, step: 1 },
      { key: "highlightR", label: "Highlight Red", type: "range", min: -30, max: 30, step: 1 },
      { key: "highlightB", label: "Highlight Blue", type: "range", min: -30, max: 30, step: 1 }
    ]
  },
  {
    type: "vibrance",
    label: "Vibrance",
    category: "Color",
    icon: "⚡",
    description: "Selectively boost muted colors without clipping saturated ones",
    defaultParams: { vibrance: 0.3 },
    paramDefs: [
      { key: "vibrance", label: "Vibrance", type: "range", min: -1, max: 1, step: 0.01 }
    ]
  },
  {
    type: "shadows",
    label: "Shadows / Highlights",
    category: "Color",
    icon: "◐",
    description: "Lift shadows and recover highlights independently",
    defaultParams: { shadows: 0, highlights: 0 },
    paramDefs: [
      { key: "shadows", label: "Shadows", type: "range", min: -1, max: 1, step: 0.01 },
      { key: "highlights", label: "Highlights", type: "range", min: -1, max: 1, step: 0.01 }
    ]
  },
  {
    type: "curves",
    label: "Curves",
    category: "Color",
    icon: "〜",
    description: "Tone curve (master + RGB channels)",
    defaultParams: { masterGamma: 1, rGamma: 1, gGamma: 1, bGamma: 1 },
    paramDefs: [
      { key: "masterGamma", label: "Master Gamma", type: "range", min: 0.1, max: 4, step: 0.05 },
      { key: "rGamma", label: "Red Gamma", type: "range", min: 0.1, max: 4, step: 0.05 },
      { key: "gGamma", label: "Green Gamma", type: "range", min: 0.1, max: 4, step: 0.05 },
      { key: "bGamma", label: "Blue Gamma", type: "range", min: 0.1, max: 4, step: 0.05 }
    ]
  },
  // ── Texture / Film ────────────────────────────────────────────────────────
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
    type: "filmGrain",
    label: "Cinematic Grain",
    category: "Texture",
    icon: "🎞",
    description: "Heavy cinematic grain with luminance variation",
    defaultParams: { size: 1.2, amount: 0.18, roughness: 0.5 },
    paramDefs: [
      { key: "size", label: "Grain Size", type: "range", min: 0.5, max: 4, step: 0.1 },
      { key: "amount", label: "Amount", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "roughness", label: "Roughness", type: "range", min: 0, max: 1, step: 0.01 }
    ]
  },
  {
    type: "halftone",
    label: "Halftone",
    category: "Texture",
    icon: "⬤",
    description: "Comic-book / newspaper halftone dot pattern",
    defaultParams: { dotSize: 4, angle: 45 },
    paramDefs: [
      { key: "dotSize", label: "Dot Size", type: "range", min: 1, max: 16, step: 0.5, unit: "px" },
      { key: "angle", label: "Angle", type: "range", min: 0, max: 90, step: 1, unit: "°" }
    ]
  },
  {
    type: "scanlines",
    label: "Scanlines",
    category: "Texture",
    icon: "≡",
    description: "CRT monitor horizontal scanline overlay",
    defaultParams: { intensity: 0.25, spacing: 3 },
    paramDefs: [
      { key: "intensity", label: "Intensity", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "spacing", label: "Line Spacing", type: "range", min: 1, max: 10, step: 1, unit: "px" }
    ]
  },
  {
    type: "oldFilmEffect",
    label: "Old Film",
    category: "Texture",
    icon: "📽",
    description: "Flicker, scratches and vignette like classic film stock",
    defaultParams: { scratches: 0.5, flicker: 0.3, sepia: 0.4 },
    paramDefs: [
      { key: "scratches", label: "Scratches", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "flicker", label: "Flicker", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "sepia", label: "Sepia Tint", type: "range", min: 0, max: 1, step: 0.01 }
    ]
  },
  // ── Stylized ─────────────────────────────────────────────────────────────
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
  },
  // ── Additional Stylized ───────────────────────────────────────────────────
  {
    type: "rgbSplit",
    label: "RGB Split / Aberration",
    category: "Stylized",
    icon: "🌈",
    description: "Chromatic aberration with per-channel offset",
    defaultParams: { amount: 4, angle: 0 },
    paramDefs: [
      { key: "amount", label: "Amount", type: "range", min: 0, max: 30, step: 0.5, unit: "px" },
      { key: "angle", label: "Angle", type: "range", min: 0, max: 360, step: 1, unit: "°" }
    ]
  },
  {
    type: "posterize",
    label: "Posterize",
    category: "Stylized",
    icon: "🎨",
    description: "Reduce tonal levels for a graphic / pop-art look",
    defaultParams: { levels: 4 },
    paramDefs: [
      { key: "levels", label: "Levels", type: "range", min: 2, max: 16, step: 1 }
    ]
  },
  {
    type: "solarize",
    label: "Solarize",
    category: "Stylized",
    icon: "☀",
    description: "Invert tones above a threshold (Sabattier effect)",
    defaultParams: { threshold: 0.5 },
    paramDefs: [
      { key: "threshold", label: "Threshold", type: "range", min: 0, max: 1, step: 0.01 }
    ]
  },
  {
    type: "duotone",
    label: "Duotone",
    category: "Stylized",
    icon: "🎭",
    description: "Two-color tinted look (shadow color + highlight color)",
    defaultParams: { colorA: "#0f2b5c", colorB: "#f7b731" },
    paramDefs: [
      { key: "colorA", label: "Shadow Color", type: "color" },
      { key: "colorB", label: "Highlight Color", type: "color" }
    ]
  },
  {
    type: "nightVision",
    label: "Night Vision",
    category: "Stylized",
    icon: "🟢",
    description: "Phosphor green night-vision scope effect",
    defaultParams: { noise: 0.12, brightness: 0.1 },
    paramDefs: [
      { key: "noise", label: "Noise", type: "range", min: 0, max: 0.5, step: 0.01 },
      { key: "brightness", label: "Brightness", type: "range", min: -0.3, max: 0.5, step: 0.01 }
    ]
  },
  {
    type: "infrared",
    label: "Infrared",
    category: "Stylized",
    icon: "🔴",
    description: "Pseudo infrared photography look",
    defaultParams: { shift: 120, saturation: 0.6 },
    paramDefs: [
      { key: "shift", label: "Hue Shift", type: "range", min: 60, max: 180, step: 1, unit: "°" },
      { key: "saturation", label: "Saturation", type: "range", min: 0, max: 2, step: 0.01 }
    ]
  },
  {
    type: "painterly",
    label: "Painterly",
    category: "Stylized",
    icon: "🖌",
    description: "Watercolor / oil paint soft blending",
    defaultParams: { strength: 0.5 },
    paramDefs: [
      { key: "strength", label: "Strength", type: "range", min: 0, max: 1, step: 0.01 }
    ]
  },
  // ── Distortion ────────────────────────────────────────────────────────────
  {
    type: "motionBlur",
    label: "Motion Blur",
    category: "Spatial",
    icon: "💨",
    description: "Directional motion blur to simulate fast movement",
    defaultParams: { amount: 10, angle: 0 },
    paramDefs: [
      { key: "amount", label: "Amount", type: "range", min: 0, max: 60, step: 1, unit: "px" },
      { key: "angle", label: "Angle", type: "range", min: 0, max: 360, step: 1, unit: "°" }
    ]
  },
  {
    type: "radialBlur",
    label: "Radial Blur",
    category: "Spatial",
    icon: "🌀",
    description: "Zoom-burst or spin blur from image center",
    defaultParams: { amount: 8, mode: "zoom" },
    paramDefs: [
      { key: "amount", label: "Amount", type: "range", min: 0, max: 40, step: 1 },
      { key: "mode", label: "Mode", type: "select", options: ["zoom", "spin"] }
    ]
  },
  {
    type: "tiltShift",
    label: "Tilt Shift",
    category: "Spatial",
    icon: "🔍",
    description: "Selective focus blur — miniature / diorama effect",
    defaultParams: { focusY: 0.5, focusWidth: 0.2, blurRadius: 8 },
    paramDefs: [
      { key: "focusY", label: "Focus Position", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "focusWidth", label: "Focus Width", type: "range", min: 0.05, max: 0.8, step: 0.01 },
      { key: "blurRadius", label: "Blur Radius", type: "range", min: 0, max: 30, step: 0.5, unit: "px" }
    ]
  },
  {
    type: "lensDistort",
    label: "Lens Distortion",
    category: "Spatial",
    icon: "🔮",
    description: "Barrel or pincushion lens distortion",
    defaultParams: { amount: 0.3, mode: "barrel" },
    paramDefs: [
      { key: "amount", label: "Amount", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "mode", label: "Mode", type: "select", options: ["barrel", "pincushion"] }
    ]
  },
  {
    type: "fishEye",
    label: "Fish Eye",
    category: "Spatial",
    icon: "🐟",
    description: "Ultra-wide fisheye lens distortion",
    defaultParams: { strength: 0.5 },
    paramDefs: [
      { key: "strength", label: "Strength", type: "range", min: 0, max: 1, step: 0.01 }
    ]
  },
  // ── Keying ────────────────────────────────────────────────────────────────
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
    type: "lumaKey",
    label: "Luma Key",
    category: "Keying",
    icon: "⬛",
    description: "Key out dark or bright areas based on luminance",
    defaultParams: { threshold: 0.15, mode: "dark", feather: 0.05 },
    paramDefs: [
      { key: "threshold", label: "Threshold", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "mode", label: "Mode", type: "select", options: ["dark", "bright"] },
      { key: "feather", label: "Feather", type: "range", min: 0, max: 0.3, step: 0.005 }
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
  // ── Transform / Digital ───────────────────────────────────────────────────
  {
    type: "mirror",
    label: "Mirror",
    category: "Transform",
    icon: "⟺",
    description: "Horizontal or vertical flip of the frame",
    defaultParams: { horizontal: true, vertical: false },
    paramDefs: [
      { key: "horizontal", label: "Mirror H", type: "toggle" },
      { key: "vertical", label: "Mirror V", type: "toggle" }
    ]
  },
  {
    type: "kaleidoscope",
    label: "Kaleidoscope",
    category: "Transform",
    icon: "❄",
    description: "Symmetric mirror tiling pattern",
    defaultParams: { segments: 6, rotation: 0 },
    paramDefs: [
      { key: "segments", label: "Segments", type: "range", min: 2, max: 16, step: 1 },
      { key: "rotation", label: "Rotation", type: "range", min: 0, max: 360, step: 1, unit: "°" }
    ]
  },
  {
    type: "vhsEffect",
    label: "VHS",
    category: "Transform",
    icon: "📼",
    description: "VHS tape noise, scanlines and color bleeding",
    defaultParams: { noise: 0.1, scanlines: 0.25, colorShift: 3, tracking: 0.15 },
    paramDefs: [
      { key: "noise", label: "Noise", type: "range", min: 0, max: 0.5, step: 0.01 },
      { key: "scanlines", label: "Scanlines", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "colorShift", label: "Color Shift", type: "range", min: 0, max: 20, step: 0.5, unit: "px" },
      { key: "tracking", label: "Tracking", type: "range", min: 0, max: 1, step: 0.01 }
    ]
  },
  {
    type: "glitchEffect",
    label: "Glitch",
    category: "Transform",
    icon: "💥",
    description: "Digital glitch blocks and pixel displacement",
    defaultParams: { intensity: 0.3, frequency: 3 },
    paramDefs: [
      { key: "intensity", label: "Intensity", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "frequency", label: "Frequency", type: "range", min: 1, max: 30, step: 1 }
    ]
  },
  // ── AI Processing ─────────────────────────────────────────────────────────
  {
    type: "ai_upscale",
    label: "AI Upscale 2x",
    category: "AI",
    icon: "⬆",
    description: "AI-powered 2x resolution upscaling using Real-ESRGAN",
    defaultParams: { scale: 2, model: "realesrgan" },
    paramDefs: [
      { key: "scale", label: "Scale", type: "range", min: 2, max: 4, step: 2 },
      { key: "model", label: "Model", type: "select", options: ["realesrgan", "esrgan"] }
    ]
  },
  {
    type: "ai_denoise",
    label: "AI Denoise",
    category: "AI",
    icon: "✦",
    description: "Temporal AI noise reduction for clean footage",
    defaultParams: { strength: 0.7, temporal: true },
    paramDefs: [
      { key: "strength", label: "Strength", type: "range", min: 0, max: 1, step: 0.05 },
      { key: "temporal", label: "Temporal", type: "toggle" }
    ]
  },
  {
    type: "ai_stabilize",
    label: "AI Stabilize",
    category: "AI",
    icon: "⊕",
    description: "AI camera shake stabilization with crop compensation",
    defaultParams: { strength: 0.8, cropRatio: 0.05 },
    paramDefs: [
      { key: "strength", label: "Strength", type: "range", min: 0, max: 1, step: 0.05 },
      { key: "cropRatio", label: "Crop", type: "range", min: 0, max: 0.2, step: 0.01 }
    ]
  },
  {
    type: "ai_face_enhance",
    label: "AI Face Enhance",
    category: "AI",
    icon: "◉",
    description: "Restore and enhance facial detail using CodeFormer",
    defaultParams: { strength: 0.85, model: "codeformer" },
    paramDefs: [
      { key: "strength", label: "Strength", type: "range", min: 0, max: 1, step: 0.05 },
      { key: "model", label: "Model", type: "select", options: ["codeformer", "gfpgan"] }
    ]
  },
  {
    type: "ai_color_match",
    label: "AI Color Match",
    category: "AI",
    icon: "◈",
    description: "Match color grade to a reference image or LUT style",
    defaultParams: { strength: 1.0, reference: "" },
    paramDefs: [
      { key: "strength", label: "Strength", type: "range", min: 0, max: 1, step: 0.05 }
    ]
  },
  // ── DaVinci-parity Professional Effects ──────────────────────────────────────
  {
    type: "noise_reduction",
    label: "Noise Reduction",
    category: "Professional",
    icon: "⚡",
    description: "Temporal + spatial noise reduction (hqdn3d on export)",
    defaultParams: { spatialRadius: 5, temporalFrames: 3, strength: 0.5 },
    paramDefs: [
      { key: "spatialRadius", label: "Spatial Radius", type: "range", min: 0, max: 10, step: 0.5 },
      { key: "temporalFrames", label: "Temporal Frames", type: "range", min: 1, max: 5, step: 1 },
      { key: "strength", label: "Strength", type: "range", min: 0, max: 1, step: 0.05 }
    ]
  },
  {
    type: "sharpening",
    label: "Sharpening",
    category: "Professional",
    icon: "◆",
    description: "Unsharp mask sharpening for crisp detail",
    defaultParams: { amount: 1.0, radius: 2.5, threshold: 0 },
    paramDefs: [
      { key: "amount", label: "Amount", type: "range", min: 0, max: 2, step: 0.05 },
      { key: "radius", label: "Radius", type: "range", min: 0.5, max: 5, step: 0.1 },
      { key: "threshold", label: "Threshold", type: "range", min: 0, max: 100, step: 1 }
    ]
  },
  {
    type: "film_grain",
    label: "Film Grain",
    category: "Professional",
    icon: "▤",
    description: "Cinematic film grain texture",
    defaultParams: { amount: 0.3, size: 3, roughness: 0.5, colorGrain: false },
    paramDefs: [
      { key: "amount", label: "Amount", type: "range", min: 0, max: 1, step: 0.05 },
      { key: "size", label: "Size", type: "range", min: 1, max: 10, step: 0.5 },
      { key: "roughness", label: "Roughness", type: "range", min: 0, max: 1, step: 0.05 },
      { key: "colorGrain", label: "Color Grain", type: "toggle" }
    ]
  },
  {
    type: "lens_distortion",
    label: "Lens Distortion",
    category: "Professional",
    icon: "◎",
    description: "Barrel/pincushion lens correction or creative distortion",
    defaultParams: { distortion: 0, anamorphic: 0 },
    paramDefs: [
      { key: "distortion", label: "Distortion", type: "range", min: -1, max: 1, step: 0.02 },
      { key: "anamorphic", label: "Anamorphic", type: "range", min: 0, max: 1, step: 0.05 }
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
                      onInput={(e) => onUpdate({ ...effect.params, [pDef.key]: Number((e.target as HTMLInputElement).value) })}
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
                onInput={(e) => onUpdate({ threshold: Number((e.target as HTMLInputElement).value) })}
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
                onInput={(e) => onUpdate({ edgeRefinement: Number((e.target as HTMLInputElement).value) })}
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
                onInput={(e) => onUpdate({ spillSuppression: Number((e.target as HTMLInputElement).value) })}
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
