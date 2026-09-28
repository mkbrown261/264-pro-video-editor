/**
 * Effect stack → CSS filter string.
 *
 * Shared by the viewer (applied as a CSS filter) and the export pipeline
 * (translated to equivalent FFmpeg filters by cssFilterToFfmpeg), so effects
 * look the same in preview and in the render.
 */
import type { ClipEffect } from "./models.js";

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
      case "film_look_creator": {
        // CSS approximation of film look — noise/grain via contrast+brightness,
        // halation via a warm brightness boost, faded blacks via brightness lift
        const stock = String(p.filmStock ?? "kodachrome");
        const grain  = Number(p.grainAmount ?? 0.3);
        const fade   = Number(p.fadeBlacks ?? 0.15);
        const colorShift = Number(p.colorShift ?? 0.2);
        // Stock-specific tones
        const stockTints: Record<string, string> = {
          kodachrome:   `saturate(1.3) hue-rotate(5deg)`,
          ektachrome:   `saturate(1.15) hue-rotate(-5deg)`,
          velvia:       `saturate(1.5) contrast(1.1)`,
          portra:       `saturate(0.85) brightness(1.05)`,
          tri_x_bw:     `grayscale(1) contrast(1.2)`,
          cinestill_800t: `saturate(0.9) hue-rotate(-10deg) brightness(0.95)`,
        };
        const tint = stockTints[stock] ?? `saturate(1.1)`;
        parts.push(
          tint,
          `brightness(${1 + fade * 0.3})`,
          `contrast(${1 - grain * 0.1})`,
          `hue-rotate(${colorShift * 8}deg)`,
        );
        break;
      }
      default:
        break;
    }
  }

  return parts.length ? parts.join(" ") : "none";
}
