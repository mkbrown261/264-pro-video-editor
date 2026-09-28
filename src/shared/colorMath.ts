/**
 * colorMath — single source of truth for 264 Pro color grading.
 *
 * Both the real-time viewer (WebGL, via a baked 3D LUT texture) and the
 * FFmpeg export (via a baked .cube file + lut3d) evaluate grades through the
 * functions in this module, so what you see in the viewer is what you get in
 * the render.
 *
 * Pipeline per node (identical to the original GLSL shader, extended with
 * ColorSlice, hue curves and file LUTs which the shader previously ignored):
 *   0. log input transform
 *   1. exposure            (×2^stops)
 *   2. lift/gamma/gain/offset
 *   3. contrast            (pivot 0.5)
 *   4. temperature / tint
 *   5. saturation          (Rec.709 luma)
 *   6. ColorSlice six-vector + hue-vs-hue / hue-vs-sat curves
 *   7. per-channel curves, then master curve
 *   8. file LUT (mixed by lutIntensity)
 *
 * Nodes are applied in SERIES: the output of node N is the input of node N+1.
 */

import type {
  ColorGrade,
  ColorSliceState,
  CurvePoint,
  GradeNode,
  LogInputTransform,
  RGBValue,
  VectorAdjustment,
} from "./models.js";

export type RGB = [number, number, number];

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
const safePow = (b: number, e: number) => Math.pow(Math.max(b, 0), e);

// ─── Curves ───────────────────────────────────────────────────────────────────

/** Evaluate a piecewise cubic Hermite (Catmull-Rom style) spline at x ∈ [0,1]. */
export function evalCurve(pts: CurvePoint[], x: number): number {
  if (!pts || pts.length === 0) return x;
  const sorted = [...pts].sort((a, b) => a.x - b.x);
  if (x <= sorted[0].x) return sorted[0].y;
  if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;
  for (let i = 0; i < sorted.length - 1; i++) {
    const p0 = sorted[i];
    const p1 = sorted[i + 1];
    if (x >= p0.x && x <= p1.x) {
      const span = p1.x - p0.x || 1;
      const t = (x - p0.x) / span;
      const tm1 = i > 0 ? sorted[i - 1] : p0;
      const tp2 = i < sorted.length - 2 ? sorted[i + 2] : p1;
      const m0 = ((p1.y - tm1.y) / ((p1.x - tm1.x) || 1)) * span;
      const m1 = ((tp2.y - p0.y) / ((tp2.x - p0.x) || 1)) * span;
      const t2 = t * t;
      const t3 = t2 * t;
      const v =
        (2 * t3 - 3 * t2 + 1) * p0.y +
        (t3 - 2 * t2 + t) * m0 +
        (-2 * t3 + 3 * t2) * p1.y +
        (t3 - t2) * m1;
      return Number.isFinite(v) ? v : x;
    }
  }
  return x;
}

/** Bake a curve to a 256-entry table (matches the viewer's 8-bit curve texture). */
export function bakeCurveTable(pts: CurvePoint[] | undefined): Float32Array {
  const out = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    out[i] = clamp01(pts && pts.length ? evalCurve(pts, i / 255) : i / 255);
  }
  return out;
}

function sampleTable(table: Float32Array, v: number): number {
  const f = clamp01(v) * 255;
  const i = Math.floor(f);
  if (i >= 255) return table[255];
  const t = f - i;
  return table[i] * (1 - t) + table[i + 1] * t;
}

function isIdentityCurve(pts: CurvePoint[] | undefined): boolean {
  if (!pts || pts.length === 0) return true;
  return pts.every((p) => Math.abs(p.x - p.y) < 1e-4);
}

// ─── Log input transforms ─────────────────────────────────────────────────────

function slog2(x: number) {
  x = Math.max(x, 0);
  return x >= 0.030001222851889303
    ? Math.pow(10, (x - 0.616596 - 0.03) / 0.432699) - 0.037584
    : (x - 0.030001222851889303) / 5.0;
}
function slog3(x: number) {
  return x >= 0.171672532
    ? Math.pow(10, (x - 0.598206) / 0.326006) * 0.18 - 0.01
    : (x - 0.092864) / 5.5;
}
function clog(x: number) {
  return x >= 0.0730597
    ? Math.pow(10, (x - 0.0730597) / 0.529136) / 10.1596
    : -(Math.pow(10, -(x - 0.0730597) / 0.529136) - 1) / 10.1596;
}
function logc(x: number) {
  const a = 5.555556, b = 0.052272, c = 0.24719, d = 0.385537, e = 5.367655, f = 0.092809, cut = 0.010591;
  return x >= e * cut + f ? (Math.pow(10, (x - d) / c) - b) / a : (x - f) / e;
}
function vlog(x: number) {
  const cut1 = 0.181, b = 0.00873, c = 0.241514, d = 0.598206;
  return x >= cut1 ? Math.pow(10, (x - d) / c) - b : (x - 0.125) / 5.6;
}

export function applyLogTransform(c: RGB, mode: LogInputTransform | undefined): RGB {
  switch (mode) {
    case "slog2": return [clamp01(slog2(c[0])), clamp01(slog2(c[1])), clamp01(slog2(c[2]))];
    case "slog3": return [clamp01(slog3(c[0])), clamp01(slog3(c[1])), clamp01(slog3(c[2]))];
    case "clog":
    case "clog2":
    case "clog3":
      return [clamp01(clog(c[0]) * 0.9 + 0.05), clamp01(clog(c[1]) * 0.9 + 0.05), clamp01(clog(c[2]) * 0.9 + 0.05)];
    case "logc":
    case "log3g10":
      return [clamp01(logc(c[0]) * 1.1), clamp01(logc(c[1]) * 1.1), clamp01(logc(c[2]) * 1.1)];
    case "vlog":
      return [clamp01(vlog(c[0]) * 0.85 + 0.07), clamp01(vlog(c[1]) * 0.85 + 0.07), clamp01(vlog(c[2]) * 0.85 + 0.07)];
    default:
      return c;
  }
}

// ─── HSV helpers ──────────────────────────────────────────────────────────────

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max <= 0 ? 0 : d / max, max];
}

function hsvToRgb(h: number, s: number, v: number): RGB {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

const VECTOR_CENTERS: Record<keyof ColorSliceState["vectors"], number> = {
  red: 0, yellow: 60, green: 120, cyan: 180, blue: 240, magenta: 300,
};

function isNeutralVector(v: VectorAdjustment | undefined): boolean {
  return !v || (v.hue === 0 && v.saturation === 0 && v.luminance === 0);
}

// ─── Grade compilation ────────────────────────────────────────────────────────

/** Pre-computed per-node data so LUT baking does not re-bake curves per sample. */
export interface CompiledGrade {
  grade: ColorGrade;
  r: Float32Array | null;
  g: Float32Array | null;
  b: Float32Array | null;
  m: Float32Array | null;
  hueVsHue: CurvePoint[] | null;
  hueVsSat: CurvePoint[] | null;
  sliceActive: boolean;
  fileLut: Lut3D | null;
}

export function compileGrade(grade: ColorGrade, fileLut: Lut3D | null = null): CompiledGrade {
  const c = grade.curves;
  const hueActive = (pts?: CurvePoint[]) => (pts && pts.length >= 2 && !isIdentityCurve(pts) ? pts : null);
  const slice = grade.colorSlice;
  return {
    grade,
    r: isIdentityCurve(c?.red) ? null : bakeCurveTable(c.red),
    g: isIdentityCurve(c?.green) ? null : bakeCurveTable(c.green),
    b: isIdentityCurve(c?.blue) ? null : bakeCurveTable(c.blue),
    m: isIdentityCurve(c?.master) ? null : bakeCurveTable(c.master),
    hueVsHue: hueActive(c?.hueVsHue),
    hueVsSat: hueActive(c?.hueVsSat),
    sliceActive: !!slice && Object.values(slice.vectors).some((v) => !isNeutralVector(v)),
    fileLut,
  };
}

function applyLGGO(c: RGB, lift: RGBValue, gamma: RGBValue, gain: RGBValue, offset: RGBValue): RGB {
  const ch = (v: number, l: number, gm: number, gn: number, o: number) => {
    let r = clamp01((gn + 1) * (v + l * (1 - v)));
    r = clamp01(safePow(r, 1 / Math.min(10, Math.max(0.1, 1 + gm))));
    return clamp01(r + o);
  };
  return [
    ch(c[0], lift.r, gamma.r, gain.r, offset.r),
    ch(c[1], lift.g, gamma.g, gain.g, offset.g),
    ch(c[2], lift.b, gamma.b, gain.b, offset.b),
  ];
}

function applyHueStage(c: RGB, cg: CompiledGrade): RGB {
  if (!cg.sliceActive && !cg.hueVsHue && !cg.hueVsSat) return c;
  let [h, s, v] = rgbToHsv(c[0], c[1], c[2]);
  if (s < 1e-5) return c;

  if (cg.hueVsHue) h = evalCurve(cg.hueVsHue, h);
  if (cg.hueVsSat) s = s * Math.max(0, 1 + 2 * (evalCurve(cg.hueVsSat, h) - h));

  if (cg.sliceActive && cg.grade.colorSlice) {
    const hueDeg = h * 360;
    let dh = 0, ds = 0, dl = 0;
    for (const [name, center] of Object.entries(VECTOR_CENTERS) as [keyof ColorSliceState["vectors"], number][]) {
      const vec = cg.grade.colorSlice.vectors[name];
      if (isNeutralVector(vec)) continue;
      let dist = Math.abs(hueDeg - center);
      if (dist > 180) dist = 360 - dist;
      const width = 30 + clamp01(vec.softness ?? 0.5) * 60;
      if (dist >= width) continue;
      const x = 1 - dist / width;
      const w = x * x * (3 - 2 * x) * Math.min(1, s * 4); // smoothstep, fade out on greys
      dh += (vec.hue / 360) * w;
      ds += vec.saturation * w;
      dl += vec.luminance * 0.5 * w;
    }
    h += dh;
    s = s * Math.max(0, 1 + ds);
    v = v + dl;
  }
  const out = hsvToRgb(h, clamp01(s), clamp01(v));
  return [clamp01(out[0]), clamp01(out[1]), clamp01(out[2])];
}

/** Apply a single compiled grade node to an RGB triple (values 0–1). */
export function applyCompiledGrade(input: RGB, cg: CompiledGrade): RGB {
  const g = cg.grade;
  if (g.bypass) return input;
  let c: RGB = [clamp01(input[0]), clamp01(input[1]), clamp01(input[2])];

  c = applyLogTransform(c, g.logInputTransform);

  const exp = Math.pow(2, g.exposure ?? 0);
  c = [clamp01(c[0] * exp), clamp01(c[1] * exp), clamp01(c[2] * exp)];

  const zero = { r: 0, g: 0, b: 0 };
  c = applyLGGO(c, g.lift ?? zero, g.gamma ?? zero, g.gain ?? zero, g.offset ?? zero);

  const k = 1 + (g.contrast ?? 0);
  c = [clamp01((c[0] - 0.5) * k + 0.5), clamp01((c[1] - 0.5) * k + 0.5), clamp01((c[2] - 0.5) * k + 0.5)];

  const t = (g.temperature ?? 0) / 100;
  c = [clamp01(c[0] + t * 0.12), c[1], clamp01(c[2] - t * 0.12)];
  const ti = (g.tint ?? 0) / 100;
  c = [clamp01(c[0] + ti * 0.04), clamp01(c[1] - ti * 0.1), clamp01(c[2] + ti * 0.04)];

  const sat = g.saturation ?? 1;
  if (sat !== 1) {
    const luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    c = [
      clamp01(luma + (c[0] - luma) * sat),
      clamp01(luma + (c[1] - luma) * sat),
      clamp01(luma + (c[2] - luma) * sat),
    ];
  }

  c = applyHueStage(c, cg);

  if (cg.r) c[0] = sampleTable(cg.r, c[0]);
  if (cg.g) c[1] = sampleTable(cg.g, c[1]);
  if (cg.b) c[2] = sampleTable(cg.b, c[2]);
  if (cg.m) c = [sampleTable(cg.m, c[0]), sampleTable(cg.m, c[1]), sampleTable(cg.m, c[2])];

  if (cg.fileLut) {
    const mix = clamp01(g.lutIntensity ?? 1);
    const l = sampleLut3D(cg.fileLut, c);
    c = [c[0] + (l[0] - c[0]) * mix, c[1] + (l[1] - c[1]) * mix, c[2] + (l[2] - c[2]) * mix];
  }
  return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
}

/** Apply a list of grade nodes in series. */
export function applyGradeChain(input: RGB, chain: CompiledGrade[]): RGB {
  let c = input;
  for (const node of chain) c = applyCompiledGrade(c, node);
  return c;
}

/** Convenience wrapper for a single grade (no file LUT). */
export function applyGrade(input: RGB, grade: ColorGrade): RGB {
  return applyCompiledGrade(input, compileGrade(grade));
}

/** True when a chain would leave every pixel unchanged (lets renderers skip work). */
export function isIdentityChain(chain: CompiledGrade[]): boolean {
  return chain.every((cg) => {
    const g = cg.grade;
    if (g.bypass) return true;
    const z = (v?: RGBValue) => !v || (v.r === 0 && v.g === 0 && v.b === 0);
    return (
      (!g.logInputTransform || g.logInputTransform === "none" || g.logInputTransform === "rec709") &&
      (g.exposure ?? 0) === 0 && (g.contrast ?? 0) === 0 && (g.saturation ?? 1) === 1 &&
      (g.temperature ?? 0) === 0 && (g.tint ?? 0) === 0 &&
      z(g.lift) && z(g.gamma) && z(g.gain) && z(g.offset) &&
      !cg.r && !cg.g && !cg.b && !cg.m && !cg.hueVsHue && !cg.hueVsSat && !cg.sliceActive &&
      (!cg.fileLut || (g.lutIntensity ?? 1) === 0)
    );
  });
}

// ─── Grade keyframes ──────────────────────────────────────────────────────────

/** Resolve animated grade parameters (exposure, contrast, …) at a timeline frame. */
export function resolveGradeAtFrame(grade: ColorGrade, frame: number): ColorGrade {
  const kf = grade.keyframes;
  if (!kf) return grade;
  const keys = Object.keys(kf) as (keyof ColorGrade["keyframes"])[];
  if (!keys.some((k) => (kf[k]?.length ?? 0) > 0)) return grade;
  const out: ColorGrade = { ...grade };
  for (const k of keys) {
    const list = kf[k];
    if (!list || list.length === 0) continue;
    const s = [...list].sort((a, b) => a.frame - b.frame);
    let v = s[0].value;
    if (frame >= s[s.length - 1].frame) v = s[s.length - 1].value;
    else {
      for (let i = 0; i < s.length - 1; i++) {
        if (frame >= s[i].frame && frame <= s[i + 1].frame) {
          const span = s[i + 1].frame - s[i].frame || 1;
          v = s[i].value + ((frame - s[i].frame) / span) * (s[i + 1].value - s[i].value);
          break;
        }
      }
    }
    (out as unknown as Record<string, number>)[k] = v;
  }
  return out;
}

export function gradeHasKeyframes(grade: ColorGrade | null | undefined): boolean {
  if (!grade?.keyframes) return false;
  return Object.values(grade.keyframes).some((l) => (l?.length ?? 0) > 1);
}

// ─── 3D LUTs ──────────────────────────────────────────────────────────────────

export interface Lut3D {
  size: number;
  /** RGB triples, red varies fastest (Adobe .cube order). length = size³·3 */
  data: Float32Array;
  domainMin: RGB;
  domainMax: RGB;
}

export function parseCubeLut(text: string): Lut3D | null {
  let size = 0;
  let domainMin: RGB = [0, 0, 0];
  let domainMax: RGB = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^TITLE/i.test(line)) continue;
    if (/^LUT_1D_SIZE/i.test(line)) return null; // 1D LUTs unsupported
    const sizeMatch = /^LUT_3D_SIZE\s+(\d+)/i.exec(line);
    if (sizeMatch) { size = Number(sizeMatch[1]); continue; }
    const dmin = /^DOMAIN_MIN\s+(\S+)\s+(\S+)\s+(\S+)/i.exec(line);
    if (dmin) { domainMin = [Number(dmin[1]), Number(dmin[2]), Number(dmin[3])]; continue; }
    const dmax = /^DOMAIN_MAX\s+(\S+)\s+(\S+)\s+(\S+)/i.exec(line);
    if (dmax) { domainMax = [Number(dmax[1]), Number(dmax[2]), Number(dmax[3])]; continue; }
    const parts = line.split(/\s+/);
    if (parts.length >= 3) {
      const r = Number(parts[0]), g = Number(parts[1]), b = Number(parts[2]);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) values.push(r, g, b);
    }
  }
  if (size < 2 || values.length !== size * size * size * 3) return null;
  return { size, data: Float32Array.from(values), domainMin, domainMax };
}

/** Trilinear LUT lookup. */
export function sampleLut3D(lut: Lut3D, c: RGB): RGB {
  const n = lut.size;
  const idx = (ch: number) => {
    const lo = lut.domainMin[ch], hi = lut.domainMax[ch];
    return clamp01((c[ch] - lo) / ((hi - lo) || 1)) * (n - 1);
  };
  const fr = idx(0), fg = idx(1), fb = idx(2);
  const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
  const r1 = Math.min(n - 1, r0 + 1), g1 = Math.min(n - 1, g0 + 1), b1 = Math.min(n - 1, b0 + 1);
  const dr = fr - r0, dg = fg - g0, db = fb - b0;
  const d = lut.data;
  const at = (r: number, g: number, b: number, ch: number) => d[(r + g * n + b * n * n) * 3 + ch];
  const out: RGB = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const c00 = at(r0, g0, b0, ch) * (1 - dr) + at(r1, g0, b0, ch) * dr;
    const c10 = at(r0, g1, b0, ch) * (1 - dr) + at(r1, g1, b0, ch) * dr;
    const c01 = at(r0, g0, b1, ch) * (1 - dr) + at(r1, g0, b1, ch) * dr;
    const c11 = at(r0, g1, b1, ch) * (1 - dr) + at(r1, g1, b1, ch) * dr;
    const c0 = c00 * (1 - dg) + c10 * dg;
    const c1 = c01 * (1 - dg) + c11 * dg;
    out[ch] = c0 * (1 - db) + c1 * db;
  }
  return out;
}

/** Bake a grade chain into a size³ 3D LUT (red fastest, .cube order). */
export function bakeChainToLut(chain: CompiledGrade[], size = 33): Lut3D {
  const data = new Float32Array(size * size * size * 3);
  let o = 0;
  const inv = 1 / (size - 1);
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const out = applyGradeChain([r * inv, g * inv, b * inv], chain);
        data[o++] = out[0];
        data[o++] = out[1];
        data[o++] = out[2];
      }
    }
  }
  return { size, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}

export function serializeCubeLut(lut: Lut3D, title = "264 Pro Grade"): string {
  const lines: string[] = [`TITLE "${title.replace(/"/g, "'")}"`, `LUT_3D_SIZE ${lut.size}`, ""];
  const d = lut.data;
  for (let i = 0; i < d.length; i += 3) {
    lines.push(`${d[i].toFixed(6)} ${d[i + 1].toFixed(6)} ${d[i + 2].toFixed(6)}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * The serial grade chain for a clip: node 1 is `colorGrade` (kept for
 * compatibility with every feature that edits it), followed by any enabled
 * extra nodes in `gradeNodes`.
 */
export function getClipGradeNodes(clip: {
  colorGrade: ColorGrade | null;
  gradeNodes?: GradeNode[];
}): ColorGrade[] {
  const out: ColorGrade[] = [];
  if (clip.colorGrade && !clip.colorGrade.bypass) out.push(clip.colorGrade);
  for (const n of clip.gradeNodes ?? []) {
    if (n.enabled && !n.grade.bypass) out.push(n.grade);
  }
  return out;
}
