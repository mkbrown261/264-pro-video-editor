/**
 * exportGraph — builds the FFmpeg filter graph that renders a timeline.
 *
 * Model: a real layered compositor, the same as the viewer.
 *   • A black canvas spans the whole sequence; gaps stay black.
 *   • Video tracks are composited bottom → top (track index 0 is the top layer).
 *   • Every clip becomes a canvas-sized RGBA layer at its timeline position,
 *     with transform (static or keyframed), opacity, masks, effects and the
 *     serial color-node chain (baked to a 3D LUT via colorMath — identical to
 *     the viewer).
 *   • Transitions are real two-clip blends (xfade) between adjacent clips on a
 *     track; a lone edge transitions against transparency (the layers below).
 *   • Title, caption and adjustment clips render; nested sequences recurse.
 *   • Audio comes from audio tracks only (video clips carry a linked audio
 *     clip), mixed per track with volume, automation, pan, EQ, compressor and
 *     ducking, then the master bus.
 *
 * This module is pure (no fs / child_process) so it can be unit tested; the
 * caller supplies callbacks for writing temp files (LUTs, text).
 */

import type {
  ClipEffect,
  ClipMask,
  ClipTransitionType,
  EditorProject,
  ExportRequest,
  Keyframe,
  KeyframeTrack,
  MediaAsset,
  TimelineClip,
  TimelineSequence,
  TimelineTrack,
} from "./models.js";
import {
  buildTimelineSegments,
  getClipTransitionDurationFrames,
  type TimelineSegment,
} from "./timeline.js";
import {
  bakeChainToLut,
  compileGrade,
  getClipGradeNodes,
  gradeHasKeyframes,
  isIdentityChain,
  resolveGradeAtFrame,
  serializeCubeLut,
  type Lut3D,
} from "./colorMath.js";
import { computeCssFilterFromEffects } from "./effectsCss.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ExportGraphEnv {
  /** Extra font directory for libass (system fonts), or null for fontconfig defaults. */
  fontsDir: string | null;
  /** Write a temp file and return its absolute path. */
  writeTempFile: (name: string, contents: string) => string;
  /** Load a .cube referenced by a grade (lutPath), or null if unavailable. */
  loadFileLut?: (lutPath: string) => Lut3D | null;
  /** Viewer width the CSS px values (blur, font sizes) were tuned against. */
  previewReferenceWidth?: number;
  /** 3D LUT resolution for baked grades. */
  lutSize?: number;
}

export interface ExportInput {
  path: string;
  /** Input options placed before -i (seek, duration, loop). */
  options: string[];
}

export interface ExportGraph {
  inputs: ExportInput[];
  filterComplex: string;
  videoLabel: string;
  audioLabel: string;
  durationSeconds: number;
  totalFrames: number;
  /** Features that could not be rendered exactly (surfaced to the user). */
  warnings: string[];
}

export type ExportGraphRequest = Omit<ExportRequest, "outputPath"> & {
  burnSubtitles?: boolean;
};

// ─── Small helpers ────────────────────────────────────────────────────────────

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|tiff?|heic|avif)$/i;
export const isImagePath = (p: string) => IMAGE_EXT.test(p);

const f3 = (n: number) => (Number.isFinite(n) ? Number(n.toFixed(4)).toString() : "0");
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Escape a value for use inside a single-quoted filter option. */
export function escapeFilterValue(v: string): string {
  return v.replace(/\\/g, "/").replace(/'/g, "'\\\\\\''").replace(/:/g, "\\\\:");
}
const quotePath = (p: string) => `'${escapeFilterValue(p)}'`;

function hexToFfColor(hex: string, alpha = 1): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const rgb = m ? m[1] : "ffffff";
  return `0x${rgb}@${f3(clamp(alpha, 0, 1))}`;
}

/**
 * Piecewise-linear keyframe expression in FFmpeg expr syntax.
 * `frameExpr` evaluates to the timeline frame (e.g. "(120+t*30)").
 */
export function keyframeExpr(kfs: Keyframe<number>[], frameExpr: string): string {
  const s = [...kfs].sort((a, b) => a.frame - b.frame);
  if (s.length === 0) return "0";
  if (s.length === 1) return f3(s[0].value);
  let expr = f3(s[s.length - 1].value);
  for (let i = s.length - 2; i >= 0; i--) {
    const a = s[i], b = s[i + 1];
    const span = b.frame - a.frame || 1;
    const lerp = `${f3(a.value)}+(${frameExpr}-${a.frame})*${f3((b.value - a.value) / span)}`;
    expr = `if(lt(${frameExpr},${b.frame}),${lerp},${expr})`;
  }
  return `if(lt(${frameExpr},${s[0].frame}),${f3(s[0].value)},${expr})`;
}

const kfList = (t?: KeyframeTrack<number>) => (t && t.keyframes && t.keyframes.length ? t.keyframes : null);

// ─── Transition mapping (xfade) ───────────────────────────────────────────────

export function xfadeName(type: ClipTransitionType | undefined): string | null {
  switch (type) {
    case undefined:
    case "cut":
      return null;
    case "dipBlack": case "dipColor": case "blackFlash": return "fadeblack";
    case "dipWhite": case "whiteFlash": case "filmFlash": case "exposure":
    case "lightLeak": case "lensFlare": case "filmBurn": case "light_leak_dissolve":
      return "fadewhite";
    case "wipe": case "wipeLeft": return "wipeleft";
    case "wipeRight": return "wiperight";
    case "wipeUp": return "wipeup";
    case "wipeDown": return "wipedown";
    case "wipeDiagTL": return "diagtl";
    case "wipeDiagTR": return "diagtr";
    case "wipeRadial": case "irisCircle": case "wipeStar": case "irisStar":
    case "irisHeart": case "diamond":
      return "circleopen";
    case "wipeClock": return "radial";
    case "wipeBlinds": return "hlslice";
    case "wipeSplit": case "revealSplitV": return "vertopen";
    case "revealSplitH": return "horzopen";
    case "push": case "pushLeft": case "slideLeft": return "slideleft";
    case "pushRight": case "slideRight": return "slideright";
    case "pushUp": return "slideup";
    case "pushDown": return "slidedown";
    case "cover": return "smoothleft";
    case "uncover": return "smoothright";
    case "zoom": case "zoomIn": case "zoomOut": case "zoomCross": return "zoomin";
    case "whipPan": case "whip_smear": return "hblur";
    case "spinCW": case "spinCCW": return "radial";
    case "pixelate": case "glitch": case "glitchRgb": case "digital_shatter": return "pixelize";
    case "luminanceDissolve": return "fadegrays";
    default:
      return "fade";
  }
}

// ─── Effects → FFmpeg ─────────────────────────────────────────────────────────

type Mat3 = [number, number, number, number, number, number, number, number, number];

function mixerFilter(m: Mat3): string {
  return `colorchannelmixer=rr=${f3(m[0])}:rg=${f3(m[1])}:rb=${f3(m[2])}:gr=${f3(m[3])}:gg=${f3(m[4])}:gb=${f3(m[5])}:br=${f3(m[6])}:bg=${f3(m[7])}:bb=${f3(m[8])}`;
}

/** Filter Effects spec matrices (the same ones the browser applies). */
function saturateMat(s: number): Mat3 {
  return [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
}
function hueRotateMat(deg: number): Mat3 {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
}
function sepiaMat(a: number): Mat3 {
  const k = 1 - clamp(a, 0, 1);
  return [
    0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k,
    0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k,
    0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k,
  ];
}
function grayscaleMat(a: number): Mat3 {
  const k = 1 - clamp(a, 0, 1);
  return [
    0.2126 + 0.7874 * k, 0.7152 - 0.7152 * k, 0.0722 - 0.0722 * k,
    0.2126 - 0.2126 * k, 0.7152 + 0.2848 * k, 0.0722 - 0.0722 * k,
    0.2126 - 0.2126 * k, 0.7152 - 0.7152 * k, 0.0722 + 0.9278 * k,
  ];
}

/** Translate a CSS filter string (as produced for the viewer) to FFmpeg filters. */
export function cssFilterToFfmpeg(css: string, pxScale: number): string[] {
  const out: string[] = [];
  if (!css || css === "none") return out;
  const re = /([a-z-]+)\(\s*(-?[\d.]+)(px|deg)?\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const v = Number(m[2]);
    if (!Number.isFinite(v)) continue;
    switch (m[1]) {
      case "blur":
        if (v > 0) out.push(`gblur=sigma=${f3(v * pxScale)}`);
        break;
      case "brightness":
        if (v !== 1) out.push(`colorchannelmixer=rr=${f3(v)}:gg=${f3(v)}:bb=${f3(v)}`);
        break;
      case "contrast":
        if (v !== 1) {
          const e = `clip((val-128)*${f3(v)}+128\\,0\\,255)`;
          out.push(`lutrgb=r='${e}':g='${e}':b='${e}'`);
        }
        break;
      case "saturate":
        if (v !== 1) out.push(mixerFilter(saturateMat(v)));
        break;
      case "hue-rotate":
        if (v % 360 !== 0) out.push(mixerFilter(hueRotateMat(v)));
        break;
      case "grayscale":
        if (v > 0) out.push(mixerFilter(grayscaleMat(v)));
        break;
      case "sepia":
        if (v > 0) out.push(mixerFilter(sepiaMat(v)));
        break;
      case "invert":
        if (v > 0) {
          const e = `val*${f3(1 - 2 * clamp(v, 0, 1))}+${f3(255 * clamp(v, 0, 1))}`;
          out.push(`lutrgb=r='${e}':g='${e}':b='${e}'`);
        }
        break;
      case "opacity":
        if (v < 1) out.push(`format=yuva420p,colorchannelmixer=aa=${f3(clamp(v, 0, 1))}`);
        break;
    }
  }
  return out;
}

/**
 * Effects with a true FFmpeg implementation are rendered for real; the rest
 * use the viewer's CSS mapping so they look the same as in preview.
 */
export function effectToFfmpeg(effect: ClipEffect, pxScale: number): string[] {
  const p = effect.params ?? {};
  const n = (k: string, d: number) => {
    const v = Number(p[k]);
    return Number.isFinite(v) ? v : d;
  };
  switch (effect.type) {
    case "chromaKey": {
      const color = typeof p.color === "string" ? p.color : typeof p.keyColor === "string" ? p.keyColor : "#00ff00";
      return [`format=yuva420p,chromakey=color=${hexToFfColor(color).split("@")[0]}:similarity=${f3(clamp(n("similarity", n("tolerance", 0.3)), 0.01, 1))}:blend=${f3(clamp(n("smoothness", n("softness", 0.1)), 0, 1))}`];
    }
    case "lumaKey":
      return [`format=yuva420p,lumakey=threshold=${f3(clamp(n("threshold", 0.1), 0, 1))}:tolerance=${f3(clamp(n("tolerance", 0.1), 0, 1))}:softness=${f3(clamp(n("softness", 0.1), 0, 1))}`];
    case "mirror":
      return [String(p.axis ?? "horizontal") === "vertical" ? "vflip" : "hflip"];
    case "vignette": {
      const intensity = clamp(n("intensity", n("strength", 0.5)), 0, 1);
      return [`vignette=angle=${f3((Math.PI / 2) * (0.2 + intensity * 0.8))}`];
    }
    case "filmGrain":
    case "film_grain":
    case "noise":
      return [`noise=alls=${Math.round(clamp(n("amount", 0.18), 0, 1) * 40)}:allf=t`];
    case "sharpen":
    case "sharpening":
      return [`unsharp=5:5:${f3(clamp(n("amount", 0.5) * 2, 0, 5))}:5:5:0`];
    case "pixelate": {
      const size = Math.max(2, Math.round(n("size", 8) * pxScale));
      return [`scale=iw/${size}:ih/${size}:flags=neighbor,scale=iw*${size}:ih*${size}:flags=neighbor`];
    }
    case "edgeDetect":
      return [`edgedetect=mode=colormix:high=${f3(clamp(0.4 / Math.max(0.1, n("strength", 1)), 0.01, 1))}`];
    case "posterize": {
      const lv = Math.max(2, Math.round(n("levels", 4)));
      const step = 255 / (lv - 1);
      const e = `floor(val/${f3(step)}+0.5)*${f3(step)}`;
      return [`lutrgb=r='${e}':g='${e}':b='${e}'`];
    }
    case "lensDistort":
    case "lens_distortion":
    case "fishEye": {
      const k = clamp(n("distortion", n("amount", effect.type === "fishEye" ? 0.4 : 0.1)), -1, 1);
      return Math.abs(k) > 0.01 ? [`lenscorrection=k1=${f3(k)}:k2=0`] : [];
    }
    case "noise_reduction": {
      const r = n("spatialRadius", 5);
      return [`hqdn3d=${f3(r)}:${f3(r)}:${f3(r * 1.5)}:${f3(r * 1.5)}`];
    }
    case "face_refinement":
      return ["smartblur=lr=1.0:ls=-1.0:cr=0.9:cs=-0.3"];
    default:
      return cssFilterToFfmpeg(computeCssFilterFromEffects([{ ...effect, enabled: true }]), pxScale);
  }
}

// ─── Masks ────────────────────────────────────────────────────────────────────

/** geq luminance expression (0–255) for a rectangle/ellipse mask; null if unsupported. */
export function maskGeqExpr(mask: ClipMask, W: number, H: number): string | null {
  const s = mask.shape;
  if (!s || (s.type !== "rectangle" && s.type !== "ellipse")) return null;
  const cx = (s.x + s.width / 2) * W;
  const cy = (s.y + s.height / 2) * H;
  const hw = Math.max(1, (s.width / 2) * W + (mask.expansion ?? 0));
  const hh = Math.max(1, (s.height / 2) * H + (mask.expansion ?? 0));
  const a = ((s.rotation ?? 0) * Math.PI) / 180;
  const c = Math.cos(a), sn = Math.sin(a);
  // Rotate the pixel into the shape's frame (normalized coords u,v ∈ [-1,1] inside)
  const u = `((X-${f3(cx)})*${f3(c)}+(Y-${f3(cy)})*${f3(sn)})/${f3(hw)}`;
  const v = `(-(X-${f3(cx)})*${f3(sn)}+(Y-${f3(cy)})*${f3(c)})/${f3(hh)}`;
  // Signed distance-ish in pixels (negative inside)
  const feather = Math.max(0.5, (mask.feather ?? 0) * 0.8);
  const minR = Math.min(hw, hh);
  const dist = s.type === "ellipse"
    ? `(sqrt(${u}*${u}+${v}*${v})-1)*${f3(minR)}`
    : `(max(abs(${u})*${f3(hw)}-${f3(hw)},abs(${v})*${f3(hh)}-${f3(hh)}))`;
  const inside = `clip(0.5-(${dist})/${f3(feather * 2)},0,1)`;
  const val = mask.inverted ? `(1-${inside})` : inside;
  return `255*${f3(clamp(mask.opacity ?? 1, 0, 1))}*${val}`;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

interface Ctx {
  project: EditorProject;
  env: ExportGraphEnv;
  W: number;
  H: number;
  fps: number;
  sr: number;
  pxScale: number;
  inputs: ExportInput[];
  parts: string[];
  warnings: Set<string>;
  n: number;
  lutCount: number;
}

const label = (ctx: Ctx, p: string) => `${p}${ctx.n++}`;

function addInput(ctx: Ctx, path: string, options: string[]): number {
  ctx.inputs.push({ path, options });
  return ctx.inputs.length - 1;
}

export function playable(segments: TimelineSegment[], kind: "video" | "audio"): TimelineSegment[] {
  const list = segments.filter((s) => s.track.kind === kind && s.clip.isEnabled && !s.track.muted);
  const solo = list.some((s) => s.track.solo);
  return solo ? list.filter((s) => s.track.solo) : list;
}

/** A transparent canvas-sized source of the given duration. */
function transparent(ctx: Ctx, seconds: number): string {
  const l = label(ctx, "tr");
  ctx.parts.push(`color=c=black@0:s=${ctx.W}x${ctx.H}:r=${ctx.fps}:d=${f3(seconds)},format=yuva420p[${l}]`);
  return l;
}

function gradeFilters(ctx: Ctx, clip: TimelineClip, clipStartFrame: number, durationFrames: number): string[] {
  const nodes = getClipGradeNodes(clip);
  if (!nodes.length) return [];
  const loadLut = (g: (typeof nodes)[number]) =>
    g.lutPath && ctx.env.loadFileLut ? ctx.env.loadFileLut(g.lutPath) : null;
  const size = ctx.env.lutSize ?? 33;
  const bake = (frame: number) => {
    const chain = nodes.map((g) => compileGrade(resolveGradeAtFrame(g, frame), loadLut(g)));
    if (isIdentityChain(chain)) return null;
    const lut = bakeChainToLut(chain, size);
    return ctx.env.writeTempFile(`grade_${ctx.lutCount++}.cube`, serializeCubeLut(lut));
  };
  for (const g of nodes) {
    if (g.lutPath && !loadLut(g)) ctx.warnings.add(`LUT "${g.lutName ?? g.lutPath}" could not be loaded and was skipped.`);
  }
  const animated = nodes.some((g) => gradeHasKeyframes(g));
  if (!animated) {
    const file = bake(clipStartFrame);
    if (!file) return [];
    return [`lut3d=file=${quotePath(file)}:interp=tetrahedral`];
  }
  // Animated grade: re-bake every few frames and switch LUTs over time.
  const step = Math.max(Math.round(ctx.fps / 4), Math.ceil(durationFrames / 48));
  const out: string[] = [];
  for (let f = 0; f < durationFrames; f += step) {
    const file = bake(clipStartFrame + f + step / 2);
    if (!file) continue;
    const a = f / ctx.fps, b = Math.min(durationFrames, f + step) / ctx.fps;
    const win = `between(t,${f3(a)},${f3(b - 1e-4)})`;
    out.push(`lut3d=file=${quotePath(file)}:interp=tetrahedral:enable='${win}'`);
  }
  return out;
}

function effectFilters(ctx: Ctx, clip: TimelineClip): string[] {
  const out: string[] = [];
  const effects = [...(clip.effects ?? [])].filter((e) => e.enabled).sort((a, b) => a.order - b.order);
  for (const e of effects) {
    if (e.keyframes && Object.values(e.keyframes).some((k) => (k?.length ?? 0) > 1)) {
      ctx.warnings.add("Animated effect parameters export at their starting value.");
    }
    out.push(...effectToFfmpeg(e, ctx.pxScale));
  }
  if (clip.compGraph && (clip.compGraph as { nodes?: unknown[] }).nodes?.length) {
    ctx.warnings.add("Fusion node graphs are preview-only and are not included in the export.");
  }
  if (clip.aiBackgroundRemoval?.enabled) {
    ctx.warnings.add("AI background removal is preview-only and is not included in the export.");
  }
  return out;
}

/**
 * Build a canvas-sized RGBA layer for one video segment, starting at t=0,
 * `extraTail` seconds longer than the segment (for outgoing transitions).
 */
function buildClipLayer(ctx: Ctx, seg: TimelineSegment, extraTail: number): string | null {
  const { clip, asset } = seg;
  const { W, H, fps } = ctx;
  const len = seg.durationSeconds + extraTail;
  const F = `(${seg.startFrame}+t*${fps})`; // timeline frame at clip-local time t

  let src: string | null = null;
  if (clip.titleConfig) src = buildTitle(ctx, clip, len);
  else if (clip.clipType === "caption") src = buildCaption(ctx, clip, len);
  else if (clip.nestedSequenceId) src = buildNestedSource(ctx, seg, len);
  else if (asset.sourcePath) src = buildMediaSource(ctx, seg, extraTail);
  if (!src) return null;

  // ── Transform ────────────────────────────────────────────────────────────
  const t = clip.transform;
  const kf = clip.keyframes ?? {};
  const k = {
    posX: kfList(kf.posX), posY: kfList(kf.posY), scaleX: kfList(kf.scaleX),
    scaleY: kfList(kf.scaleY), rotation: kfList(kf.rotation), opacity: kfList(kf.opacity),
  };
  const sx = t?.scaleX ?? 1, sy = t?.scaleY ?? 1, rot = t?.rotation ?? 0, op = t?.opacity ?? 1;
  const px = t?.posX ?? 0, py = t?.posY ?? 0;
  const chain: string[] = [];

  const animScale = !!(k.scaleX || k.scaleY);
  if (animScale) {
    // Constant output size (max scale) keeps the graph stable; per-frame scale
    // is applied by zooming within that box.
    const maxSx = Math.max(sx, ...(k.scaleX ?? []).map((q) => q.value));
    const maxSy = Math.max(sy, ...(k.scaleY ?? []).map((q) => q.value));
    const ex = k.scaleX ? keyframeExpr(k.scaleX, F) : f3(sx);
    const ey = k.scaleY ? keyframeExpr(k.scaleY, F) : f3(sy);
    chain.push(
      `scale=w='iw*${f3(maxSx)}':h='ih*${f3(maxSy)}'`,
      `format=yuva420p`,
      // pad to the max box, then crop the scaled content back in per frame
      `scale=w='iw*(${ex})/${f3(maxSx)}':h='ih*(${ey})/${f3(maxSy)}':eval=frame`,
      `pad=w='ceil(${f3(W * maxSx)}/2)*2+2':h='ceil(${f3(H * maxSy)}/2)*2+2':x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame`,
    );
  } else if (sx !== 1 || sy !== 1) {
    chain.push(`scale=w='max(2,trunc(iw*${f3(sx)}/2)*2)':h='max(2,trunc(ih*${f3(sy)}/2)*2)'`);
  }
  chain.push("format=yuva420p");

  if (k.rotation) {
    chain.push(`rotate=a='(${keyframeExpr(k.rotation, F)})*PI/180':ow='hypot(iw,ih)':oh='ow':c=none`);
  } else if (rot !== 0) {
    const a = `${f3(rot)}*PI/180`;
    chain.push(`rotate=a='${a}':ow='rotw(${a})':oh='roth(${a})':c=none`);
  }

  if (k.opacity) {
    chain.push(`geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*clip(${keyframeExpr(k.opacity, `(${seg.startFrame}+T*${fps})`)},0,1)'`);
  } else if (op < 1) {
    chain.push(`colorchannelmixer=aa=${f3(clamp(op, 0, 1))}`);
  }

  const withChain = label(ctx, "xf");
  ctx.parts.push(`[${src}]${chain.join(",")}[${withChain}]`);

  // ── Place on a transparent canvas ─────────────────────────────────────────
  // Preview semantics: translate(posX·100%, posY·100%) of the canvas, scale
  // about the anchor point.
  const ax = t?.anchorX ?? 0.5, ay = t?.anchorY ?? 0.5;
  const anchorDx = !animScale ? (0.5 - ax) * W * (sx - 1) : 0;
  const anchorDy = !animScale ? (0.5 - ay) * H * (sy - 1) : 0;
  const xExpr = k.posX ? `(${keyframeExpr(k.posX, `(${seg.startFrame}+t*${fps})`)})*${W}` : f3(px * W + anchorDx);
  const yExpr = k.posY ? `(${keyframeExpr(k.posY, `(${seg.startFrame}+t*${fps})`)})*${H}` : f3(py * H + anchorDy);
  const bg = transparent(ctx, len);
  let placed = label(ctx, "pl");
  ctx.parts.push(
    `[${bg}][${withChain}]overlay=x='(main_w-overlay_w)/2+${xExpr}':y='(main_h-overlay_h)/2+${yExpr}':eval=${k.posX || k.posY ? "frame" : "init"}:format=yuv420:alpha=straight:eof_action=endall:shortest=1[${placed}]`
  );

  // ── Clip masks (masks not used as effect/grade windows cut the clip) ─────
  const usedElsewhere = new Set<string>([
    ...(clip.colorGrade?.maskIds ?? []),
    ...(clip.effects ?? []).flatMap((e) => e.maskIds ?? []),
  ]);
  const clipMasks = (clip.masks ?? []).filter((m) => !usedElsewhere.has(m.id));
  const maskStream = buildMaskStream(ctx, clipMasks, len);
  if (maskStream) {
    const a = label(ctx, "ma"), b = label(ctx, "mb"), ae = label(ctx, "mc"), am = label(ctx, "md"), out = label(ctx, "mo");
    ctx.parts.push(
      `[${placed}]split[${a}][${b}]`,
      `[${b}]alphaextract[${ae}]`,
      `[${ae}][${maskStream}]blend=all_mode=multiply[${am}]`,
      `[${a}][${am}]alphamerge[${out}]`,
    );
    placed = out;
  }
  return placed;
}

/** Combined (union) grayscale mask stream, or null when there are no supported masks. */
function buildMaskStream(ctx: Ctx, masks: ClipMask[], len: number): string | null {
  const exprs: string[] = [];
  for (const m of masks) {
    const e = maskGeqExpr(m, ctx.W, ctx.H);
    if (e) exprs.push(e);
    else ctx.warnings.add("Bezier/freehand masks export as rectangles are not supported yet and were skipped.");
    if (m.keyframes && Object.values(m.keyframes).some((k) => (k?.length ?? 0) > 1)) {
      ctx.warnings.add("Animated masks export at their starting shape.");
    }
  }
  if (!exprs.length) return null;
  const union = exprs.reduce((acc, e) => (acc ? `max(${acc},${e})` : e), "");
  const l = label(ctx, "mk");
  ctx.parts.push(
    `color=c=black:s=${ctx.W}x${ctx.H}:r=${ctx.fps}:d=${f3(1 / ctx.fps)},format=gray,geq=lum='${union}',loop=loop=-1:size=1,trim=duration=${f3(len)},setpts=N/(${ctx.fps}*TB)[${l}]`
  );
  return l;
}

function buildMediaSource(ctx: Ctx, seg: TimelineSegment, extraTail: number): string {
  const { clip, asset } = seg;
  const { W, H, fps } = ctx;
  const image = isImagePath(asset.sourcePath);
  const len = seg.durationSeconds + extraTail;
  const srcDur = Math.max(1 / fps, seg.sourceOutSeconds - seg.sourceInSeconds);
  // How much source media the clip consumes per timeline second.
  const rate = srcDur / seg.durationSeconds;
  const want = srcDur + extraTail * rate;
  const avail = Math.max(0, asset.durationSeconds - seg.sourceInSeconds);

  const idx = image
    ? addInput(ctx, asset.sourcePath, ["-loop", "1", "-framerate", String(fps), "-t", f3(len + 1)])
    : addInput(ctx, asset.sourcePath, ["-ss", f3(seg.sourceInSeconds), "-t", f3(Math.min(want, avail || want) + 0.5)]);

  if ((clip.speedRampKeyframes?.length ?? 0) >= 2) {
    ctx.warnings.add("Speed ramps export at the clip's constant speed.");
  }

  const chain: string[] = ["setpts=PTS-STARTPTS"];
  if (!image && Math.abs(rate - 1) > 1e-4) chain.push(`setpts=PTS/${f3(rate)}`);
  if (!image && clip.opticalFlow && rate < 1) {
    const q = clip.opticalFlowQuality ?? "good";
    chain.push(
      q === "draft"
        ? `minterpolate=fps=${fps}:mi_mode=blend`
        : `minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_algo=${q === "best" ? "umh" : "epzs"}${q === "best" ? ":vsbmc=1" : ""}`
    );
  }
  chain.push(
    `fps=${fps}`,
    `scale=${W}:${H}:force_original_aspect_ratio=decrease:in_color_matrix=auto:out_color_matrix=bt709`,
    "setsar=1",
  );
  // Freeze the last frame if the source runs out (e.g. transition handles).
  chain.push(`tpad=stop_mode=clone:stop_duration=${f3(len + 1)}`, `trim=duration=${f3(len)}`, "setpts=PTS-STARTPTS");

  chain.push(...effectFilters(ctx, clip));
  chain.push(...gradeFilters(ctx, clip, seg.startFrame, seg.durationFrames));
  if ((clip.colorGrade?.maskIds?.length ?? 0) > 0) {
    ctx.warnings.add("Power-window masks on grades export as full-frame grades.");
  }

  const l = label(ctx, "src");
  ctx.parts.push(`[${idx}:v]${chain.join(",")}[${l}]`);
  return l;
}

// ─── Text (ASS via libass) ────────────────────────────────────────────────────
// All text is rendered through libass: it ships in every ffmpeg-static build
// (drawtext needs HarfBuzz since FFmpeg 6.1 and is missing), finds system fonts
// on every OS, and supports fades, motion and boxes natively.

function assColor(hex: string, alpha = 1): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  const rgb = m ? m[1] : "ffffff";
  const a = Math.round((1 - clamp(alpha, 0, 1)) * 255).toString(16).padStart(2, "0");
  return `&H${a}${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`.toUpperCase();
}

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

export function assText(text: string): string {
  return (text ?? "").replace(/\\/g, "⧵").replace(/[{}]/g, (c) => (c === "{" ? "(" : ")")).replace(/\r?\n/g, "\\N");
}

const fontName = (family?: string) =>
  (family ?? "").split(",")[0].replace(/["']/g, "").trim() || "Arial";

interface AssStyle {
  name: string; font?: string; size: number; color: string; alpha?: number; bold?: boolean; italic?: boolean;
  outline?: number; outlineColor?: string; shadow?: number; box?: { color: string; alpha: number }; align: number;
  marginL?: number; marginR?: number; marginV?: number;
}

function assDocument(W: number, H: number, styles: AssStyle[], events: string[]): string {
  const st = styles.map((x) => [
    `Style: ${x.name}`, fontName(x.font), Math.max(1, Math.round(x.size)),
    assColor(x.color, x.alpha ?? 1), assColor(x.color, x.alpha ?? 1),
    x.box ? assColor(x.box.color, x.box.alpha) : assColor(x.outlineColor ?? "#000000", x.alpha ?? 1),
    x.box ? assColor(x.box.color, x.box.alpha) : assColor("#000000", 0.5 * (x.alpha ?? 1)),
    x.bold ? -1 : 0, x.italic ? -1 : 0, 0, 0, 100, 100, 0, 0,
    x.box ? 3 : 1, x.box ? Math.max(1, x.outline ?? 6) : (x.outline ?? 0), x.shadow ?? 0,
    x.align, x.marginL ?? 20, x.marginR ?? 20, x.marginV ?? 20, 1,
  ].join(",")).join("\n");
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${st}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
}

const dialogue = (start: number, end: number, style: string, text: string) =>
  `Dialogue: 0,${assTime(start)},${assTime(end)},${style},,0,0,0,,${text}`;

function assFilter(ctx: Ctx, file: string, alpha: boolean): string {
  const fonts = ctx.env.fontsDir ? `:fontsdir=${quotePath(ctx.env.fontsDir)}` : "";
  return `ass=filename=${quotePath(file)}${fonts}${alpha ? ":alpha=1" : ""}`;
}

function buildTitle(ctx: Ctx, clip: TimelineClip, len: number): string {
  const tc = clip.titleConfig!;
  const s = ctx.pxScale;
  const size = (tc.fontSize || 48) * s;
  const x = Math.round(tc.posX * ctx.W), y = Math.round(tc.posY * ctx.H);
  const dIn = Math.round(len * 200), dOut = Math.round(len * 200); // 20% of the clip, in ms
  const endMs = Math.round(len * 1000);
  const box = tc.bgOpacity > 0 ? { color: tc.bgColor, alpha: tc.bgOpacity } : undefined;
  const styles: AssStyle[] = [
    { name: "Main", font: tc.fontFamily, size, color: tc.color, bold: true, box, outline: 12 * s, align: 8 },
    { name: "Sub", font: tc.fontFamily, size: size * 0.6, color: tc.color, alpha: 0.85, align: 8 },
  ];
  const events: string[] = [];
  const line = (text: string, style: string, dy: number) => {
    const y0 = y + dy;
    let move = `\\pos(${x},${y0})`;
    if (tc.animationIn === "slide_up") move = `\\move(${x},${y0 + Math.round(40 * s)},${x},${y0},0,${dIn})`;
    else if (tc.animationIn === "slide_right") move = `\\move(${x - Math.round(60 * s)},${y0},${x},${y0},0,${dIn})`;
    else if (tc.animationOut === "slide_down") move = `\\move(${x},${y0},${x},${y0 + Math.round(40 * s)},${endMs - dOut},${endMs})`;
    else if (tc.animationOut === "slide_left") move = `\\move(${x},${y0},${x - Math.round(60 * s)},${y0},${endMs - dOut},${endMs})`;
    const fin = tc.animationIn === "none" || tc.animationIn === "typewriter" ? 0 : dIn;
    const fout = tc.animationOut === "none" ? 0 : dOut;
    const fad = fin || fout ? `\\fad(${fin},${fout})` : "";
    if (tc.animationIn === "typewriter" && text.length > 1) {
      const steps = Math.min(text.length, 60);
      const per = (len * 0.2) / steps;
      for (let i = 1; i <= steps; i++) {
        const shown = text.slice(0, Math.ceil((i / steps) * text.length));
        events.push(dialogue((i - 1) * per, i === steps ? len : i * per, style, `{${move}${i === steps ? fad : ""}}${assText(shown)}`));
      }
    } else {
      events.push(dialogue(0, len, style, `{${move}${fad}}${assText(text)}`));
    }
  };
  line(tc.mainText ?? "", "Main", 0);
  if (tc.subText) line(tc.subText, "Sub", Math.round(size * 1.3));
  const file = ctx.env.writeTempFile(`title_${clip.id}.ass`, assDocument(ctx.W, ctx.H, styles, events));
  const bg = transparent(ctx, len);
  const l = label(ctx, "ti");
  ctx.parts.push(`[${bg}]${assFilter(ctx, file, true)}[${l}]`);
  return l;
}

function buildCaption(ctx: Ctx, clip: TimelineClip, len: number): string {
  const s = ctx.pxScale;
  const style = clip.captionStyle ?? "bold";
  const st: AssStyle = {
    name: "Cap", size: (style === "minimal" ? 28 : 36) * s, color: "#ffffff", bold: style !== "minimal",
    align: 2, marginV: Math.round(ctx.H * 0.08),
    ...(style === "bold" ? { box: { color: "#000000", alpha: 0.6 }, outline: 10 * s } :
      style === "outline" ? { outline: Math.max(2, 3 * s), outlineColor: "#000000" } : { shadow: 2 }),
  };
  const file = ctx.env.writeTempFile(`caption_${clip.id}.ass`, assDocument(ctx.W, ctx.H, [st], [dialogue(0, len, "Cap", assText(clip.captionText ?? ""))]));
  const bg = transparent(ctx, len);
  const l = label(ctx, "cap");
  ctx.parts.push(`[${bg}]${assFilter(ctx, file, true)}[${l}]`);
  return l;
}

function buildNestedSource(ctx: Ctx, seg: TimelineSegment, len: number): string | null {
  const nested = ctx.project.nestedSequences?.[seg.clip.nestedSequenceId!];
  if (!nested) return null;
  const nestedDur = sequenceDurationSeconds(nested, ctx.project.assets);
  const video = buildVideoComposite(ctx, nested, Math.max(nestedDur, seg.sourceOutSeconds));
  const l = label(ctx, "ns");
  ctx.parts.push(
    `[${video}]trim=start=${f3(seg.sourceInSeconds)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${f3(len + 1)},trim=duration=${f3(len)},format=yuva420p[${l}]`
  );
  return l;
}

export function sequenceDurationSeconds(seq: TimelineSequence, assets: MediaAsset[]): number {
  const segs = buildTimelineSegments(seq, assets);
  const vis = [...playable(segs, "video"), ...playable(segs, "audio")];
  const end = vis.reduce((m, s) => Math.max(m, s.endFrame), 0);
  return end / (seq.settings.fps || 30);
}

interface Run { segs: TimelineSegment[] }

export function transitionBetween(a: TimelineSegment, b: TimelineSegment): { name: string; frames: number } | null {
  if (a.endFrame !== b.startFrame) return null;
  const tr = b.clip.transitionIn ?? a.clip.transitionOut;
  const name = xfadeName(tr?.type);
  if (!tr || !name) return null;
  const frames = Math.min(
    getClipTransitionDurationFrames(tr, b.durationFrames),
    Math.max(1, b.durationFrames - 1),
  );
  return frames > 0 ? { name, frames } : null;
}

/** Render every video layer of a sequence onto a black canvas of `durationSeconds`. */
function buildVideoComposite(ctx: Ctx, seq: TimelineSequence, durationSeconds: number): string {
  const segs = playable(buildTimelineSegments(seq, ctx.project.assets), "video");
  let base = label(ctx, "base");
  ctx.parts.push(`color=c=black:s=${ctx.W}x${ctx.H}:r=${ctx.fps}:d=${f3(durationSeconds)},format=yuv420p[${base}]`);

  const trackIdxs = [...new Set(segs.map((s) => s.trackIndex))].sort((a, b) => b - a); // bottom → top
  for (const ti of trackIdxs) {
    const trackSegs = segs.filter((s) => s.trackIndex === ti).sort((a, b) => a.startFrame - b.startFrame);
    // Adjustment clips process everything composited below them.
    for (const adj of trackSegs.filter((s) => s.clip.clipType === "adjustment")) {
      const fx = [
        ...effectFilters(ctx, adj.clip),
        ...gradeFilters(ctx, adj.clip, adj.startFrame, adj.durationFrames),
      ];
      if (!fx.length) continue;
      const a = adj.startFrame / ctx.fps;
      const keep = label(ctx, "ak"), work = label(ctx, "aw"), done = label(ctx, "ad"), out = label(ctx, "adj");
      ctx.parts.push(
        `[${base}]split[${keep}][${work}]`,
        `[${work}]trim=start=${f3(a)}:duration=${f3(adj.durationSeconds)},setpts=PTS-STARTPTS,format=yuva420p,${fx.join(",")},format=yuva420p,setpts=PTS+${f3(a)}/TB[${done}]`,
        `[${keep}][${done}]overlay=x=0:y=0:eof_action=pass:format=yuv420[${out}]`,
      );
      base = out;
    }
    const media = trackSegs.filter((s) => s.clip.clipType !== "adjustment");
    // Group adjacent clips joined by transitions into runs.
    const runs: Run[] = [];
    for (const s of media) {
      const last = runs[runs.length - 1];
      const prev = last?.segs[last.segs.length - 1];
      if (prev && transitionBetween(prev, s)) last.segs.push(s);
      else runs.push({ segs: [s] });
    }
    for (const run of runs) {
      const stream = buildRun(ctx, run);
      if (!stream) continue;
      const start = run.segs[0].startFrame / ctx.fps;
      const shifted = label(ctx, "sh"), out = label(ctx, "ov");
      ctx.parts.push(
        `[${stream}]setpts=PTS-STARTPTS+${f3(start)}/TB[${shifted}]`,
        `[${base}][${shifted}]overlay=x=0:y=0:eof_action=pass:format=yuv420[${out}]`,
      );
      base = out;
    }
  }
  return base;
}

/** Chain the clips of a run with xfade; lone edges fade against transparency. */
function buildRun(ctx: Ctx, run: Run): string | null {
  const segs = run.segs;
  const joins = segs.slice(1).map((s, i) => transitionBetween(segs[i], s)!);
  let out: string | null = null;
  let outLen = 0;
  for (let i = 0; i < segs.length; i++) {
    const tail = i < joins.length ? joins[i].frames / ctx.fps : 0;
    const layer = buildClipLayer(ctx, segs[i], tail);
    if (!layer) {
      if (out) ctx.warnings.add("A clip with missing media was skipped.");
      continue;
    }
    let cur = layer;
    let curLen = segs[i].durationSeconds + tail;
    // Lone incoming edge (first clip of the run)
    if (i === 0) {
      const tin = segs[i].clip.transitionIn;
      const name = xfadeName(tin?.type);
      const frames = tin ? getClipTransitionDurationFrames(tin, segs[i].durationFrames) : 0;
      if (name && frames > 0) {
        const d = frames / ctx.fps;
        const tr = transparent(ctx, d), o = label(ctx, "xin");
        ctx.parts.push(`[${tr}][${cur}]xfade=transition=${name}:duration=${f3(d)}:offset=0[${o}]`);
        cur = o;
      }
    }
    // Lone outgoing edge (last clip of the run)
    if (i === segs.length - 1) {
      const tout = segs[i].clip.transitionOut;
      const name = xfadeName(tout?.type);
      const frames = tout ? getClipTransitionDurationFrames(tout, segs[i].durationFrames) : 0;
      if (name && frames > 0) {
        const d = frames / ctx.fps;
        const tr = transparent(ctx, d), o = label(ctx, "xout");
        ctx.parts.push(`[${cur}][${tr}]xfade=transition=${name}:duration=${f3(d)}:offset=${f3(curLen - d)}[${o}]`);
        cur = o;
      }
    }
    if (!out) {
      out = cur;
      outLen = curLen;
      continue;
    }
    const j = joins[i - 1];
    const d = j.frames / ctx.fps;
    const o = label(ctx, "xj");
    ctx.parts.push(`[${out}][${cur}]xfade=transition=${j.name}:duration=${f3(d)}:offset=${f3(outLen - d)}[${o}]`);
    out = o;
    outLen = outLen - d + curLen;
  }
  return out;
}

// ─── Audio ────────────────────────────────────────────────────────────────────

function atempoChain(speed: number): string[] {
  const out: string[] = [];
  let r = clamp(speed, 0.25, 4);
  while (r > 2 + 1e-6) { out.push("atempo=2"); r /= 2; }
  while (r < 0.5 - 1e-6) { out.push("atempo=0.5"); r /= 0.5; }
  if (Math.abs(r - 1) > 1e-4) out.push(`atempo=${f3(r)}`);
  return out;
}

function trackBusFilters(track: TimelineTrack, fps: number): string[] {
  const out: string[] = [];
  for (const band of track.eq ?? []) {
    if (!band.enabled) continue;
    const f = clamp(band.frequency, 20, 20000), q = clamp(band.q, 0.1, 10), g = clamp(band.gain, -24, 24);
    switch (band.type) {
      case "highpass": out.push(`highpass=f=${f3(f)}:width_type=q:w=${f3(q)}`); break;
      case "lowpass": out.push(`lowpass=f=${f3(f)}:width_type=q:w=${f3(q)}`); break;
      case "lowshelf": if (g) out.push(`lowshelf=f=${f3(f)}:g=${f3(g)}`); break;
      case "highshelf": if (g) out.push(`highshelf=f=${f3(f)}:g=${f3(g)}`); break;
      case "notch": out.push(`bandreject=f=${f3(f)}:width_type=q:w=${f3(q)}`); break;
      default: if (g) out.push(`equalizer=f=${f3(f)}:width_type=q:w=${f3(q)}:g=${f3(g)}`);
    }
  }
  const c = track.compressor;
  if (c?.enabled) {
    out.push(
      `acompressor=threshold=${f3(clamp(Math.pow(10, c.threshold / 20), 0.000976563, 1))}:ratio=${f3(clamp(c.ratio, 1, 20))}:attack=${f3(clamp(c.attack, 0.01, 2000))}:release=${f3(clamp(c.release, 0.01, 9000))}:makeup=${f3(clamp(Math.pow(10, (c.makeupGain ?? 0) / 20), 1, 64))}:knee=${f3(clamp(c.knee || 1, 1, 8))}`
    );
  }
  const vol = track.volume ?? 1;
  if (vol !== 1) out.push(`volume=${f3(clamp(vol, 0, 4))}`);
  const volLane = track.automation?.find((l) => l.enabled && l.param === "volume" && l.keyframes.length);
  if (volLane) out.push(`volume='${keyframeExpr(volLane.keyframes, `(t*${fps})`)}':eval=frame`);
  const panLane = track.automation?.find((l) => l.enabled && l.param === "pan" && l.keyframes.length);
  const pan = clamp(track.pan ?? 0, -1, 1);
  if (panLane) {
    // Equal-power StereoPanner, per frame (matches Web Audio for stereo input).
    const p = `clip(${keyframeExpr(panLane.keyframes, `(t*${fps})`)},-1,1)`;
    out.push(`aeval='if(lte(${p},0),val(0)+val(1)*cos((${p}+1)*PI/2),val(0)*cos(${p}*PI/2))|if(lte(${p},0),val(1)*sin((${p}+1)*PI/2),val(1)+val(0)*sin(${p}*PI/2))':c=stereo`);
  } else if (pan !== 0) {
    const x = pan <= 0 ? pan + 1 : pan;
    const gl = Math.cos((x * Math.PI) / 2), gr = Math.sin((x * Math.PI) / 2);
    out.push(pan <= 0 ? `pan=stereo|c0=c0+${f3(gl)}*c1|c1=${f3(gr)}*c1` : `pan=stereo|c0=${f3(gl)}*c0|c1=c1+${f3(gr)}*c0`);
  }
  return out;
}

/** Mixed audio for a sequence, delayed by `offsetSeconds`, keyed by track id. */
function buildTrackAudio(ctx: Ctx, seq: TimelineSequence, durationSeconds: number): Map<string, string> {
  const segs = playable(buildTimelineSegments(seq, ctx.project.assets), "audio");
  const byTrack = new Map<string, string[]>();
  for (const seg of segs) {
    const { clip, asset } = seg;
    if (!asset.sourcePath || !asset.hasAudio) continue;
    const srcDur = Math.max(1 / ctx.fps, seg.sourceOutSeconds - seg.sourceInSeconds);
    const rate = srcDur / seg.durationSeconds;
    const idx = addInput(ctx, asset.sourcePath, ["-ss", f3(seg.sourceInSeconds), "-t", f3(srcDur + 0.1)]);
    const chain = [
      "asetpts=PTS-STARTPTS",
      `aresample=${ctx.sr}`,
      "aformat=sample_fmts=fltp:channel_layouts=stereo",
      ...atempoChain(rate),
      `apad=whole_dur=${f3(seg.durationSeconds)}`,
      `atrim=duration=${f3(seg.durationSeconds)}`,
    ];
    const vol = clamp(clip.volume ?? 1, 0, 4);
    const vk = kfList(clip.keyframes?.volume);
    if (vk) chain.push(`volume='${keyframeExpr(vk, `(${seg.startFrame}+t*${ctx.fps})`)}':eval=frame`);
    else if (vol !== 1) chain.push(`volume=${f3(vol)}`);
    const tin = getClipTransitionDurationFrames(clip.transitionIn, seg.durationFrames) / ctx.fps;
    const tout = getClipTransitionDurationFrames(clip.transitionOut, seg.durationFrames) / ctx.fps;
    if (tin > 0 && clip.transitionIn?.type !== "cut") chain.push(`afade=t=in:st=0:d=${f3(tin)}`);
    if (tout > 0 && clip.transitionOut?.type !== "cut") chain.push(`afade=t=out:st=${f3(seg.durationSeconds - tout)}:d=${f3(tout)}`);
    const ms = Math.round((seg.startFrame / ctx.fps) * 1000);
    if (ms > 0) chain.push(`adelay=${ms}:all=1`);
    const l = label(ctx, "ac");
    ctx.parts.push(`[${idx}:a]${chain.join(",")}[${l}]`);
    const list = byTrack.get(seg.track.id) ?? [];
    list.push(l);
    byTrack.set(seg.track.id, list);
  }
  const out = new Map<string, string>();
  for (const track of seq.tracks) {
    const clips = byTrack.get(track.id);
    if (!clips?.length) continue;
    const l = label(ctx, "trk");
    const mix = clips.length > 1 ? `amix=inputs=${clips.length}:duration=longest:normalize=0,` : "";
    const bus = trackBusFilters(track, ctx.fps);
    ctx.parts.push(`${clips.map((c) => `[${c}]`).join("")}${mix}apad=whole_dur=${f3(durationSeconds)},atrim=duration=${f3(durationSeconds)}${bus.length ? "," + bus.join(",") : ""}[${l}]`);
    out.set(track.id, l);
  }
  return out;
}

function buildAudioMix(ctx: Ctx, request: ExportGraphRequest, durationSeconds: number): string {
  const project = ctx.project;
  const tracks = buildTrackAudio(ctx, project.sequence, durationSeconds);

  // Nested sequences contribute their own audio tracks at the nest position.
  const segs = playable(buildTimelineSegments(project.sequence, project.assets), "video");
  const nestedLabels: string[] = [];
  for (const seg of segs) {
    const nested = seg.clip.nestedSequenceId ? project.nestedSequences?.[seg.clip.nestedSequenceId] : null;
    if (!nested) continue;
    const inner = buildTrackAudio(ctx, nested, sequenceDurationSeconds(nested, project.assets));
    for (const l of inner.values()) {
      const o = label(ctx, "na");
      const ms = Math.round((seg.startFrame / ctx.fps) * 1000);
      ctx.parts.push(`[${l}]atrim=start=${f3(seg.sourceInSeconds)}:duration=${f3(seg.durationSeconds)},asetpts=PTS-STARTPTS${ms ? `,adelay=${ms}:all=1` : ""}[${o}]`);
      nestedLabels.push(o);
    }
  }

  // Ducking: sidechain-compress target tracks by their trigger tracks.
  for (const d of project.duckingSettings ?? []) {
    if (!d.enabled) continue;
    const target = tracks.get(d.targetTrackId), trigger = tracks.get(d.triggerTrackId);
    if (!target || !trigger || target === trigger) continue;
    const keep = label(ctx, "dk"), sc = label(ctx, "ds"), out = label(ctx, "dd");
    ctx.parts.push(
      `[${trigger}]asplit[${keep}][${sc}]`,
      `[${target}][${sc}]sidechaincompress=threshold=${f3(clamp(Math.pow(10, d.threshold / 20), 0.000976563, 1))}:ratio=${f3(1 + clamp(d.reduction, 0, 1) * 19)}:attack=${f3(clamp(d.attackMs, 0.01, 2000))}:release=${f3(clamp(d.releaseMs, 0.01, 9000))}[${out}]`,
    );
    tracks.set(d.triggerTrackId, keep);
    tracks.set(d.targetTrackId, out);
  }

  const all = [...tracks.values(), ...nestedLabels];
  let master = label(ctx, "master");
  if (!all.length) {
    ctx.parts.push(`anullsrc=r=${ctx.sr}:cl=stereo,atrim=duration=${f3(durationSeconds)}[${master}]`);
  } else {
    const mix = all.length > 1 ? `amix=inputs=${all.length}:duration=longest:normalize=0,` : "";
    const mv = project.sequence.settings.masterVolume ?? 1;
    ctx.parts.push(`${all.map((l) => `[${l}]`).join("")}${mix}apad=whole_dur=${f3(durationSeconds)},atrim=duration=${f3(durationSeconds)}${mv !== 1 ? `,volume=${f3(mv)}` : ""}[${master}]`);
  }
  if (request.loudnormTarget) {
    const o = label(ctx, "loud");
    ctx.parts.push(`[${master}]loudnorm=I=${request.loudnormTarget}:TP=-1.5:LRA=11,aresample=${ctx.sr}[${o}]`);
    master = o;
  }
  return master;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function buildExportGraph(request: ExportGraphRequest, env: ExportGraphEnv): ExportGraph {
  const project = request.project;
  const settings = project.sequence.settings;
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const W = even(request.outputWidth && request.outputWidth > 0 ? request.outputWidth : settings.width);
  const H = even(request.outputHeight && request.outputHeight > 0 ? request.outputHeight : settings.height);
  const fps = settings.fps || 30;
  const ctx: Ctx = {
    project, env, W, H, fps,
    sr: settings.audioSampleRate || 48000,
    pxScale: W / (env.previewReferenceWidth ?? 960),
    inputs: [], parts: [], warnings: new Set(), n: 0, lutCount: 0,
  };

  const segments = buildTimelineSegments(project.sequence, project.assets);
  const endFrame = [...playable(segments, "video"), ...playable(segments, "audio")]
    .reduce((m, s) => Math.max(m, s.endFrame), 0);
  if (endFrame <= 0) throw new Error("Nothing is on the timeline. Add clips before exporting.");
  const totalFrames = endFrame;
  const durationSeconds = totalFrames / fps;

  let video = buildVideoComposite(ctx, project.sequence, durationSeconds);

  // Burn-ins (subtitles, timecode, watermark) — one ASS document over the final picture.
  const styles: AssStyle[] = [];
  const events: string[] = [];
  if (request.burnSubtitles) {
    (project.subtitleCues ?? []).forEach((cue, i) => {
      const st = cue.style;
      const name = `S${i}`;
      const hasBox = !!st && st.backgroundColor !== "transparent";
      styles.push({
        name, font: st?.fontFamily, size: (st?.fontSize ?? 42) * ctx.pxScale * 0.6, color: st?.color ?? "#ffffff",
        bold: st?.bold, italic: st?.italic,
        box: hasBox ? { color: st!.backgroundColor, alpha: st!.backgroundOpacity } : undefined,
        outline: hasBox ? 8 * ctx.pxScale : (st?.outlineWidth ?? 0) * ctx.pxScale, outlineColor: st?.outlineColor,
        shadow: st?.shadowOffset ?? 0,
        align: (st?.position === "top" ? 8 : st?.position === "center" ? 5 : 2) + (st?.alignment === "left" ? -1 : st?.alignment === "right" ? 1 : 0),
        marginV: Math.round(H * (st?.position === "center" ? 0 : st?.position === "top" ? 0.06 : 0.08)),
      });
      events.push(dialogue(cue.startFrame / fps, cue.endFrame / fps, name, assText(cue.text)));
    });
  }
  if (request.burnIn?.timecode) {
    styles.push({ name: "TC", font: "Menlo", size: H / 28, color: "#ffffff", outline: 2, align: 7, marginL: 20, marginV: 20 });
    // One event per frame (per second beyond ~2h to keep the file small).
    const step = totalFrames > 216000 ? Math.round(fps) : 1;
    const pad = (v: number) => String(v).padStart(2, "0");
    const nominal = Math.round(fps);
    for (let f = 0; f < totalFrames; f += step) {
      const tcText = `${pad(Math.floor(f / (nominal * 3600)))}:${pad(Math.floor(f / (nominal * 60)) % 60)}:${pad(Math.floor(f / nominal) % 60)}:${pad(f % nominal)}`;
      events.push(dialogue(f / fps, Math.min(totalFrames, f + step) / fps, "TC", tcText));
    }
  }
  if (request.burnIn?.watermarkText) {
    const o = clamp(request.burnIn.watermarkOpacity ?? 0.7, 0, 1);
    styles.push({ name: "WM", size: H / 36, color: "#ffffff", alpha: o, outline: 1, outlineColor: "#000000", align: 3, marginR: 20, marginV: 20 });
    events.push(dialogue(0, durationSeconds, "WM", assText(request.burnIn.watermarkText)));
  }
  const burn: string[] = [];
  if (events.length) {
    const file = env.writeTempFile("burnin.ass", assDocument(W, H, styles, events));
    burn.push(assFilter(ctx, file, false));
  }
  const vOut = label(ctx, "vout");
  ctx.parts.push(`[${video}]${burn.length ? burn.join(",") + "," : ""}format=yuv420p,trim=duration=${f3(durationSeconds)}[${vOut}]`);
  video = vOut;

  const audio = buildAudioMix(ctx, request, durationSeconds);

  return {
    inputs: ctx.inputs,
    filterComplex: ctx.parts.join(";\n"),
    videoLabel: `[${video}]`,
    audioLabel: `[${audio}]`,
    durationSeconds,
    totalFrames,
    warnings: [...ctx.warnings],
  };
}
