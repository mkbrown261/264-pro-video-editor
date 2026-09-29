/**
 * ViewerCompositor — the viewer's real-time layered renderer.
 *
 * Mirrors the export compositor (src/shared/exportGraph.ts):
 *   • layers drawn bottom → top onto a sequence-sized canvas (gaps are black)
 *   • per-layer color: the clip's serial grade chain baked to a 3D LUT via
 *     colorMath and applied on the GPU (WebGL2, sampler3D, trilinear)
 *   • per-layer transform / opacity / effects (CSS filter) / feathered masks
 *   • transitions blend the outgoing clip's tail with the incoming clip
 *
 * Colour is evaluated by the same code that bakes the export LUTs, so the
 * viewer and the render match.
 */

import type { ClipMask, ColorGrade, TimelineClip } from "../../shared/models";
import {
  bakeChainToLut,
  compileGrade,
  getClipGradeNodes,
  gradeHasKeyframes,
  isIdentityChain,
  parseCubeLut,
  resolveGradeAtFrame,
  type Lut3D,
} from "../../shared/colorMath";
import { computeCssFilterFromEffects } from "../../shared/effectsCss";
import { maskAtFrame, type PreviewLayer, type PreviewUnit } from "../../shared/previewLayers";
import { compGraphActive } from "../../shared/exportGraph";
import { CompRenderer } from "./CompRenderer";
import { appAssetUrl } from "./appAssets";
import { cutout } from "./backgroundRemoval";

// ─── File LUT cache (async) ───────────────────────────────────────────────────

const fileLuts = new Map<string, Lut3D | null | "loading">();
let onLutLoaded: (() => void) | null = null;

function lutUrl(path: string): string {
  if (/^(https?:|media:|data:)/.test(path)) return path;
  if (/^([a-zA-Z]:[\\/]|\/)/.test(path)) return `media://asset?path=${encodeURIComponent(path)}`;
  return appAssetUrl(path);
}

function getFileLut(path: string): Lut3D | null {
  const hit = fileLuts.get(path);
  if (hit === "loading") return null;
  if (hit !== undefined) return hit;
  fileLuts.set(path, "loading");
  fetch(lutUrl(path))
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then((text) => fileLuts.set(path, parseCubeLut(text)))
    .catch(() => fileLuts.set(path, null))
    .finally(() => onLutLoaded?.());
  return null;
}

// ─── Grade LUT cache ──────────────────────────────────────────────────────────

interface BakedGrade { key: string; lut: Lut3D }
// Two-level cache keyed by object identity (clips are immutable in the store):
// colorGrade → gradeNodes → baked LUT.
const NONE = {};
const gradeCache = new WeakMap<object, WeakMap<object, BakedGrade | null>>();
let lutSerial = 0;

/** Baked LUT for a clip's grade chain at a frame, or null when it's identity. */
export function gradeLutFor(clip: TimelineClip, frame: number): BakedGrade | null {
  const nodes = getClipGradeNodes(clip);
  if (!nodes.length) return null;
  const animated = nodes.some((g) => gradeHasKeyframes(g));
  const k1 = (clip.colorGrade as object | null) ?? NONE;
  const k2 = (clip.gradeNodes as object | undefined) ?? NONE;
  if (!animated) {
    const hit = gradeCache.get(k1)?.get(k2);
    if (hit !== undefined) return hit;
  }
  const chain = nodes.map((g: ColorGrade) =>
    compileGrade(animated ? resolveGradeAtFrame(g, frame) : g, g.lutPath ? getFileLut(g.lutPath) : null)
  );
  const baked = isIdentityChain(chain) ? null : { key: `lut${lutSerial++}`, lut: bakeChainToLut(chain, 33) };
  // Don't cache while a file LUT is still loading; it will re-bake when ready.
  const loading = nodes.some((g) => g.lutPath && fileLuts.get(g.lutPath) === "loading");
  if (!animated && !loading) {
    let inner = gradeCache.get(k1);
    if (!inner) { inner = new WeakMap(); gradeCache.set(k1, inner); }
    inner.set(k2, baked);
  }
  return baked;
}

// ─── WebGL2 grade pass ────────────────────────────────────────────────────────

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D u_src;
uniform sampler3D u_lut;
uniform float u_size;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec4 px = texture(u_src, v_uv);
  vec3 c = clamp(px.rgb, 0.0, 1.0);
  vec3 coord = c * ((u_size - 1.0) / u_size) + 0.5 / u_size;
  outColor = vec4(texture(u_lut, coord).rgb, px.a);
}`;

class GradePass {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private srcTex: WebGLTexture | null = null;
  private lutTex: WebGLTexture | null = null;
  private lutKey = "";
  private uSize: WebGLUniformLocation | null = null;
  failed = false;

  constructor() {
    this.canvas = document.createElement("canvas");
    const gl = this.canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) { this.failed = true; return; }
    this.gl = gl;
    try {
      const sh = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
        return s;
      };
      const p = gl.createProgram()!;
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
      this.prog = p;
      gl.useProgram(p);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(p, "a_pos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(gl.getUniformLocation(p, "u_src"), 0);
      gl.uniform1i(gl.getUniformLocation(p, "u_lut"), 1);
      this.uSize = gl.getUniformLocation(p, "u_size");

      this.srcTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) {
        gl.texParameteri(gl.TEXTURE_2D, k, v);
      }
      this.lutTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) {
        gl.texParameteri(gl.TEXTURE_3D, k, v);
      }
    } catch (e) {
      console.warn("[ViewerCompositor] WebGL2 grade pass unavailable:", e);
      this.failed = true;
    }
  }

  /** Grade `src` (w×h) through `lut`; returns the grading canvas or null on failure. */
  run(src: CanvasImageSource, w: number, h: number, lut: BakedGrade): HTMLCanvasElement | null {
    const gl = this.gl;
    if (!gl || this.failed || !this.prog) return null;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    if (lut.key !== this.lutKey) {
      const n = lut.lut.size;
      const rgba = new Float32Array(n * n * n * 4);
      for (let i = 0, j = 0; i < lut.lut.data.length; i += 3, j += 4) {
        rgba[j] = lut.lut.data[i]; rgba[j + 1] = lut.lut.data[i + 1]; rgba[j + 2] = lut.lut.data[i + 2]; rgba[j + 3] = 1;
      }
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, n, n, n, 0, gl.RGBA, gl.FLOAT, rgba);
      this.lutKey = lut.key;
    }
    gl.uniform1f(this.uSize, lut.lut.size);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource);
    } catch {
      return null; // tainted / not ready
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }

  dispose() {
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
}

// ─── Compositor ───────────────────────────────────────────────────────────────

export type LayerSource = (layer: PreviewLayer) => HTMLVideoElement | HTMLCanvasElement | HTMLImageElement | null;

export interface CompositeOptions {
  width: number;
  height: number;
  frame: number;
  /** Effects with keyframes resolved at a frame. */
  effectsFor?: (clip: TimelineClip, frame: number) => TimelineClip["effects"];
}

function mediaSize(src: CanvasImageSource): [number, number] {
  if (src instanceof HTMLVideoElement) return [src.videoWidth, src.videoHeight];
  if (src instanceof HTMLImageElement) return [src.naturalWidth, src.naturalHeight];
  const c = src as HTMLCanvasElement;
  return [c.width, c.height];
}

function maskPath(mask: ClipMask, W: number, H: number): Path2D | null {
  const s = mask.shape;
  if (!s) return null;
  const p = new Path2D();
  if (s.type === "rectangle" || s.type === "ellipse") {
    const exp = mask.expansion ?? 0;
    const cx = (s.x + s.width / 2) * W, cy = (s.y + s.height / 2) * H;
    const hw = Math.max(1, (s.width / 2) * W + exp), hh = Math.max(1, (s.height / 2) * H + exp);
    const rot = ((s.rotation ?? 0) * Math.PI) / 180;
    if (s.type === "ellipse") p.ellipse(cx, cy, hw, hh, rot, 0, Math.PI * 2);
    else {
      const c = Math.cos(rot), sn = Math.sin(rot);
      const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [cx + x * c - y * sn, cy + x * sn + y * c]);
      p.moveTo(pts[0][0], pts[0][1]);
      for (const q of pts.slice(1)) p.lineTo(q[0], q[1]);
      p.closePath();
    }
    return p;
  }
  const pts = s.points ?? [];
  if (pts.length < 3) return null;
  p.moveTo(pts[0].point.x * W, pts[0].point.y * H);
  if (s.type === "bezier") {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      p.bezierCurveTo(a.handleOut.x * W, a.handleOut.y * H, b.handleIn.x * W, b.handleIn.y * H, b.point.x * W, b.point.y * H);
    }
  } else {
    for (const q of pts.slice(1)) p.lineTo(q.point.x * W, q.point.y * H);
  }
  p.closePath();
  return p;
}

/** Scale px values inside a CSS filter from the 960-px reference (matches export). */
function scaleCssPx(css: string, factor: number): string {
  return css.replace(/(-?[\d.]+)px/g, (_m, v) => `${(Number(v) * factor).toFixed(2)}px`);
}

const hexA = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  const v = m ? parseInt(m[1], 16) : 0xffffff;
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${Math.min(1, Math.max(0, a))})`;
};

export class ViewerCompositor {
  private ctx: CanvasRenderingContext2D;
  private grade = new GradePass();
  private canvases = new Map<string, HTMLCanvasElement>();
  private comps = new Map<string, { canvas: HTMLCanvasElement; renderer: CompRenderer }>();
  /** False when frames are tainted (no CORS) — caller falls back to legacy view. */
  healthy = true;

  constructor(readonly canvas: HTMLCanvasElement, onDirty: () => void, options: { readback?: boolean } = {}) {
    // readback: the GPU export reads every frame back, so keep it CPU-friendly.
    const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: !!options.readback });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    onLutLoaded = onDirty;
  }

  dispose() {
    this.grade.dispose();
    for (const c of this.comps.values()) c.renderer.dispose();
    this.comps.clear();
    if (onLutLoaded) onLutLoaded = null;
  }

  /** Named scratch canvas (sized W×H). Names include the nesting depth. */
  private buf(name: string, W: number, H: number): HTMLCanvasElement {
    let c = this.canvases.get(name);
    if (!c) { c = document.createElement("canvas"); this.canvases.set(name, c); }
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    return c;
  }

  private static reset(g: CanvasRenderingContext2D, W: number, H: number) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.filter = "none";
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, W, H);
  }

  /** Run a clip's NodeFX graph over its source frame. */
  private runComp(layer: PreviewLayer, source: CanvasImageSource, sw: number, sh: number): CanvasImageSource {
    const graph = layer.segment.clip.compGraph;
    if (!compGraphActive(graph)) return source;
    let entry = this.comps.get(layer.key);
    const w = Math.max(2, Math.round(sw)), h = Math.max(2, Math.round(sh));
    try {
      if (!entry) {
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        entry = { canvas, renderer: new CompRenderer(canvas) };
        this.comps.set(layer.key, entry);
      }
      if (entry.canvas.width !== w || entry.canvas.height !== h) {
        entry.canvas.width = w; entry.canvas.height = h;
        entry.renderer.resize(w, h);
      }
      const mediaIn = graph.nodes.find((n) => n.type === "MediaIn");
      if (mediaIn) entry.renderer.registerVideo(mediaIn.id, source as HTMLVideoElement);
      entry.renderer.setFrameTime(layer.frame);
      entry.renderer.render(graph);
      return entry.canvas;
    } catch {
      return source;
    }
  }

  /** Union of masks (already resolved at the frame) as a white-on-transparent canvas. */
  private maskCanvas(name: string, masks: ClipMask[], W: number, H: number): HTMLCanvasElement | null {
    const paths = masks.map((m) => ({ m, p: maskPath(m, W, H) })).filter((x) => x.p);
    if (!paths.length) return null;
    const mc = this.buf(name, W, H);
    const m = mc.getContext("2d")!;
    ViewerCompositor.reset(m, W, H);
    for (const { m: mask, p } of paths) {
      m.filter = mask.feather > 0 ? `blur(${(mask.feather * 0.4 * W) / 960}px)` : "none";
      m.globalAlpha = Math.min(1, Math.max(0, mask.opacity ?? 1));
      m.fillStyle = "#fff";
      if (mask.inverted) {
        const inv = new Path2D();
        inv.rect(0, 0, W, H);
        inv.addPath(p!);
        m.fill(inv, "evenodd");
      } else m.fill(p!);
    }
    m.filter = "none";
    m.globalAlpha = 1;
    return mc;
  }

  /** Place an image with the layer transform and a CSS filter onto `g`. */
  private place(g: CanvasRenderingContext2D, img: CanvasImageSource, layer: PreviewLayer, fw: number, fh: number, W: number, H: number, filter: string) {
    const t = layer.transform;
    // Preview semantics (shared with export): translate(pos·canvas), then
    // scale/rotate about the anchor point of the fitted frame.
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.translate(t.posX * W + (W - fw) / 2 + t.anchorX * fw, t.posY * H + (H - fh) / 2 + t.anchorY * fh);
    g.rotate((t.rotation * Math.PI) / 180);
    g.scale(t.scaleX, t.scaleY);
    g.filter = filter;
    g.drawImage(img, -t.anchorX * fw, -t.anchorY * fh, fw, fh);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.filter = "none";
  }

  /**
   * Draw one layer into `target`: NodeFX → grade → fit → transform → effects,
   * with power windows (grade/effects limited to masks) and clip masks.
   */
  private drawLayer(target: HTMLCanvasElement, layer: PreviewLayer, source: CanvasImageSource | null, opts: CompositeOptions, depth: number): boolean {
    const { width: W, height: H } = opts;
    const lc = target.getContext("2d")!;
    ViewerCompositor.reset(lc, W, H);
    if (!source) return false;
    const [sw0, sh0] = mediaSize(source);
    if (!sw0 || !sh0) return false;
    const clip = layer.segment.clip;
    const frame = layer.frame;

    // Work at no more than on-screen resolution.
    const fit = Math.min(W / sw0, H / sh0);
    const fw = sw0 * fit, fh = sh0 * fit;
    const workScale = Math.min(fit, 1);
    let base = this.runComp(layer, source, sw0 * workScale, sh0 * workScale);
    // AI background removal (on-device segmentation) happens before grading.
    const bg = clip.aiBackgroundRemoval;
    if (bg?.enabled) {
      const bw = Math.max(2, Math.round(sw0 * workScale)), bh = Math.max(2, Math.round(sh0 * workScale));
      const bgSource = layer.background ? this.currentSourceFor?.(layer.background) ?? null : null;
      const cut = cutout(base, bw, bh, bg, bgSource);
      if (cut) {
        const snap = this.buf(`bgcut${depth}`, bw, bh);
        const g = snap.getContext("2d")!;
        g.clearRect(0, 0, bw, bh);
        g.drawImage(cut, 0, 0);
        base = snap;
      }
    }

    let graded: CanvasImageSource | null = null;
    const lut = gradeLutFor(clip, frame);
    if (lut) {
      const g = this.grade.run(base, Math.max(2, Math.round(sw0 * workScale)), Math.max(2, Math.round(sh0 * workScale)), lut);
      if (g) {
        // The grade pass reuses one canvas; snapshot it before the next layer.
        const snap = this.buf(`graded${depth}`, g.width, g.height);
        const sg = snap.getContext("2d")!;
        sg.clearRect(0, 0, snap.width, snap.height);
        sg.drawImage(g, 0, 0);
        graded = snap;
      } else if (!this.grade.failed) this.healthy = false;
    }

    const resolved = (clip.masks ?? []).map((m) => maskAtFrame(m, frame));
    const byId = new Map(resolved.map((m) => [m.id, m]));
    const gradeWindow = (clip.colorGrade?.maskIds ?? []).map((id) => byId.get(id)).filter(Boolean) as ClipMask[];
    const effects = (opts.effectsFor ? opts.effectsFor(clip, frame) : clip.effects) ?? [];
    const globalFx = effects.filter((e) => e.enabled && !(e.maskIds?.length));
    const windowFx = effects.filter((e) => e.enabled && (e.maskIds?.length ?? 0) > 0);
    const css = (list: typeof effects) => {
      const f = list.length ? computeCssFilterFromEffects(list) : "none";
      return f === "none" ? "none" : scaleCssPx(f, W / 960);
    };

    try {
      // Main pass: graded everywhere unless the grade is windowed.
      this.place(lc, graded && !gradeWindow.length ? graded : base, layer, fw, fh, W, H, css(globalFx));
      // Windowed grade / effects: draw the processed version, keep it inside the mask.
      const windowPass = (img: CanvasImageSource, filter: string, masks: ClipMask[]) => {
        const mask = this.maskCanvas(`wmask${depth}`, masks, W, H);
        if (!mask) return;
        const wc = this.buf(`window${depth}`, W, H);
        const wg = wc.getContext("2d")!;
        ViewerCompositor.reset(wg, W, H);
        this.place(wg, img, layer, fw, fh, W, H, filter);
        wg.globalCompositeOperation = "destination-in";
        wg.drawImage(mask, 0, 0);
        wg.globalCompositeOperation = "source-over";
        lc.drawImage(wc, 0, 0);
      };
      if (graded && gradeWindow.length) windowPass(graded, css(globalFx), gradeWindow);
      for (const e of windowFx) {
        const masks = e.maskIds.map((id) => byId.get(id)).filter(Boolean) as ClipMask[];
        windowPass(graded && !gradeWindow.length ? graded : base, css([...globalFx, e]), masks);
      }
    } catch {
      this.healthy = false;
      return false;
    }

    // Masks that are not grade/effect windows cut the clip.
    const windowIds = new Set([...(clip.colorGrade?.maskIds ?? []), ...effects.flatMap((e) => e.maskIds ?? [])]);
    const cut = this.maskCanvas(`cut${depth}`, resolved.filter((m) => !windowIds.has(m.id)), W, H);
    if (cut) {
      lc.globalCompositeOperation = "destination-in";
      lc.drawImage(cut, 0, 0);
      lc.globalCompositeOperation = "source-over";
    }
    return true;
  }

  /** Titles and captions, drawn in track order (matches the export's libass look). */
  private drawText(target: HTMLCanvasElement, layer: PreviewLayer, W: number, H: number): boolean {
    const g = target.getContext("2d")!;
    ViewerCompositor.reset(g, W, H);
    const clip = layer.segment.clip;
    const s = W / 960;
    const seg = layer.segment;
    const progress = seg.durationFrames > 0 ? (layer.frame - seg.startFrame) / seg.durationFrames : 0;
    g.textBaseline = "top";
    if (clip.titleConfig) {
      const tc = clip.titleConfig;
      const size = (tc.fontSize || 48) * s;
      let alpha = 1, dx = 0, dy = 0, text = tc.mainText ?? "";
      if (progress < 0.2) {
        const t = progress / 0.2;
        if (tc.animationIn === "fade") alpha = t;
        else if (tc.animationIn === "slide_up") { alpha = t; dy = (1 - t) * 40 * s; }
        else if (tc.animationIn === "slide_right") { alpha = t; dx = -(1 - t) * 60 * s; }
        else if (tc.animationIn === "typewriter") text = text.slice(0, Math.ceil(text.length * t));
      }
      if (progress > 0.8) {
        const t = (progress - 0.8) / 0.2;
        if (tc.animationOut === "fade") alpha = Math.min(alpha, 1 - t);
        else if (tc.animationOut === "slide_down") { alpha = Math.min(alpha, 1 - t); dy = t * 40 * s; }
        else if (tc.animationOut === "slide_left") { alpha = Math.min(alpha, 1 - t); dx = -t * 60 * s; }
      }
      const family = tc.fontFamily || "sans-serif";
      const x = tc.posX * W + dx, y = tc.posY * H + dy;
      g.globalAlpha = Math.max(0, alpha);
      g.font = `800 ${size}px ${family}`;
      const mainW = g.measureText(text).width;
      g.font = `${size * 0.6}px ${family}`;
      const subW = tc.subText ? g.measureText(tc.subText).width : 0;
      const boxW = Math.max(mainW, subW) + 32 * s;
      const boxH = size * 1.25 + (tc.subText ? size * 0.75 : 0) + 16 * s;
      if (tc.bgOpacity > 0) {
        g.fillStyle = hexA(tc.bgColor, tc.bgOpacity);
        g.fillRect(x - boxW / 2, y, boxW, boxH);
      }
      g.textAlign = "center";
      g.fillStyle = tc.color || "#fff";
      g.font = `800 ${size}px ${family}`;
      g.fillText(text, x, y + 8 * s);
      if (tc.subText) {
        g.globalAlpha = Math.max(0, alpha) * 0.85;
        g.font = `${size * 0.6}px ${family}`;
        g.fillText(tc.subText, x, y + 8 * s + size * 1.25);
      }
      g.globalAlpha = 1;
      return true;
    }
    if (clip.clipType === "caption" && clip.captionText) {
      const style = clip.captionStyle ?? "bold";
      const size = (style === "minimal" ? 28 : 36) * s;
      g.font = `${style === "minimal" ? 400 : 700} ${size}px sans-serif`;
      g.textAlign = "center";
      const w = g.measureText(clip.captionText).width;
      const y = H - H * 0.08 - size * 1.2;
      if (style === "bold") {
        g.fillStyle = "rgba(0,0,0,0.6)";
        g.fillRect(W / 2 - w / 2 - 10 * s, y - 6 * s, w + 20 * s, size * 1.2 + 12 * s);
      }
      if (style === "outline") {
        g.lineWidth = Math.max(2, 3 * s) * 2;
        g.strokeStyle = "#000";
        g.lineJoin = "round";
        g.strokeText(clip.captionText, W / 2, y);
      }
      if (style === "minimal") { g.shadowColor = "rgba(0,0,0,0.8)"; g.shadowOffsetX = g.shadowOffsetY = 2; }
      g.fillStyle = "#fff";
      g.fillText(clip.captionText, W / 2, y);
      g.shadowColor = "transparent";
      return true;
    }
    return false;
  }

  /** Blend `from`→`to` layer canvases onto `ctx` per the xfade name. */
  private blend(ctx: CanvasRenderingContext2D, name: string, p: number, from: HTMLCanvasElement | null, to: HTMLCanvasElement | null, W: number, H: number, opFrom: number, opTo: number, depth: number) {
    const q = Math.min(1, Math.max(0, p));
    const draw = (c: HTMLCanvasElement | null, alpha: number, clip?: (g: CanvasRenderingContext2D) => void, dx = 0, dy = 0, scale = 1, filter = "none") => {
      if (!c || alpha <= 0) return;
      ctx.save();
      if (clip) { ctx.beginPath(); clip(ctx); ctx.clip(); }
      ctx.globalAlpha = alpha;
      ctx.filter = filter;
      if (scale !== 1) {
        ctx.translate(W / 2, H / 2); ctx.scale(scale, scale); ctx.translate(-W / 2, -H / 2);
      }
      ctx.drawImage(c, dx, dy);
      ctx.restore();
    };
    const color = (hex: string, alpha: number) => {
      if (alpha <= 0) return;
      ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = hex; ctx.fillRect(0, 0, W, H); ctx.restore();
    };
    switch (name) {
      case "fadeblack":
      case "fadewhite": {
        const c = name === "fadeblack" ? "#000" : "#fff";
        if (q < 0.5) { draw(from, opFrom); color(c, q * 2); }
        else { draw(to, opTo); color(c, (1 - q) * 2); }
        return;
      }
      case "wipeleft": draw(from, opFrom); draw(to, opTo, (g) => g.rect(W * (1 - q), 0, W * q, H)); return;
      case "wiperight": draw(from, opFrom); draw(to, opTo, (g) => g.rect(0, 0, W * q, H)); return;
      case "wipeup": draw(from, opFrom); draw(to, opTo, (g) => g.rect(0, H * (1 - q), W, H * q)); return;
      case "wipedown": draw(from, opFrom); draw(to, opTo, (g) => g.rect(0, 0, W, H * q)); return;
      case "diagtl": draw(from, opFrom); draw(to, opTo, (g) => { g.moveTo(0, 0); g.lineTo(2 * W * q, 0); g.lineTo(0, 2 * H * q); g.closePath(); }); return;
      case "diagtr": draw(from, opFrom); draw(to, opTo, (g) => { g.moveTo(W, 0); g.lineTo(W - 2 * W * q, 0); g.lineTo(W, 2 * H * q); g.closePath(); }); return;
      case "circleopen": draw(from, opFrom); draw(to, opTo, (g) => g.arc(W / 2, H / 2, (Math.hypot(W, H) / 2) * q, 0, Math.PI * 2)); return;
      case "radial": draw(from, opFrom); draw(to, opTo, (g) => { g.moveTo(W / 2, H / 2); g.arc(W / 2, H / 2, Math.hypot(W, H), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * q); g.closePath(); }); return;
      case "vertopen": draw(from, opFrom); draw(to, opTo, (g) => g.rect((W / 2) * (1 - q), 0, W * q, H)); return;
      case "horzopen": draw(from, opFrom); draw(to, opTo, (g) => g.rect(0, (H / 2) * (1 - q), W, H * q)); return;
      case "hlslice": draw(from, opFrom); draw(to, opTo, (g) => { const n = 10; for (let i = 0; i < n; i++) g.rect(0, (H / n) * i, W, (H / n) * q); }); return;
      case "slideleft": draw(from, opFrom, undefined, -W * q); draw(to, opTo, undefined, W * (1 - q)); return;
      case "slideright": draw(from, opFrom, undefined, W * q); draw(to, opTo, undefined, -W * (1 - q)); return;
      case "slideup": draw(from, opFrom, undefined, 0, -H * q); draw(to, opTo, undefined, 0, H * (1 - q)); return;
      case "slidedown": draw(from, opFrom, undefined, 0, H * q); draw(to, opTo, undefined, 0, -H * (1 - q)); return;
      case "smoothleft": draw(from, opFrom); draw(to, opTo, undefined, W * (1 - q)); return;
      case "smoothright": draw(to, opTo); draw(from, opFrom, undefined, W * q); return;
      case "zoomin": draw(from, opFrom * (1 - q), undefined, 0, 0, 1 + q); draw(to, opTo * q); return;
      case "hblur": draw(from, opFrom * (1 - q), undefined, 0, 0, 1, `blur(${(q * 30 * W) / 960}px)`); draw(to, opTo * q, undefined, 0, 0, 1, `blur(${((1 - q) * 30 * W) / 960}px)`); return;
      case "pixelize": {
        const c = q < 0.5 ? from : to;
        const sz = Math.max(1, Math.round((1 - Math.abs(q - 0.5) * 2) * 40));
        if (c) {
          const t = this.buf(`pix${depth}`, Math.max(1, Math.round(W / sz)), Math.max(1, Math.round(H / sz)));
          const tc = t.getContext("2d")!;
          tc.clearRect(0, 0, t.width, t.height);
          tc.drawImage(c, 0, 0, t.width, t.height);
          ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = q < 0.5 ? opFrom : opTo;
          ctx.drawImage(t, 0, 0, W, H); ctx.restore();
        }
        return;
      }
      default: // fade, fadegrays, dissolve
        draw(from, opFrom * (from && to ? 1 : 1 - q));
        draw(to, opTo * q);
    }
  }

  /** Draw a layer's content (media, nested sequence or text) into `target`. */
  private drawAny(target: HTMLCanvasElement, layer: PreviewLayer, kind: PreviewUnit["kind"], sourceFor: LayerSource, opts: CompositeOptions, depth: number): boolean {
    if (kind === "text") return this.drawText(target, layer, opts.width, opts.height);
    if (layer.nested) {
      const inner = this.buf(`nest${depth}:${layer.key}`, opts.width, opts.height);
      const ig = inner.getContext("2d")!;
      ViewerCompositor.reset(ig, opts.width, opts.height);
      this.renderUnits(ig, layer.nested, sourceFor, opts, depth + 1, true);
      return this.drawLayer(target, layer, inner, opts, depth);
    }
    return this.drawLayer(target, layer, sourceFor(layer), opts, depth);
  }

  /** The source lookup of the render in progress (background-removal backgrounds). */
  private currentSourceFor: LayerSource | null = null;

  private renderUnits(ctx: CanvasRenderingContext2D, units: PreviewUnit[], sourceFor: LayerSource, opts: CompositeOptions, depth: number, transparent: boolean) {
    this.currentSourceFor = sourceFor;
    const { width: W, height: H } = opts;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    if (!transparent) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); }
    for (const unit of units) {
      if (unit.kind === "adjustment") {
        const layer = unit.to!;
        const snap = this.buf(`adjsrc${depth}`, W, H);
        const sg = snap.getContext("2d")!;
        ViewerCompositor.reset(sg, W, H);
        sg.drawImage(ctx.canvas, 0, 0);
        const adjusted = this.buf(`adj${depth}`, W, H);
        const identity = { posX: 0, posY: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1 };
        if (this.drawLayer(adjusted, { ...layer, transform: identity }, snap, opts, depth)) {
          ctx.globalAlpha = layer.transform.opacity;
          ctx.drawImage(adjusted, 0, 0);
          ctx.globalAlpha = 1;
        }
        continue;
      }
      const a = unit.from ? this.buf(`from${depth}`, W, H) : null;
      const b = unit.to ? this.buf(`to${depth}`, W, H) : null;
      const okA = a && unit.from ? this.drawAny(a, unit.from, unit.kind, sourceFor, opts, depth) : false;
      const okB = b && unit.to ? this.drawAny(b, unit.to, unit.kind, sourceFor, opts, depth) : false;
      if (unit.transition) {
        this.blend(ctx, unit.transition.name, unit.transition.progress, okA ? a : null, okB ? b : null, W, H,
          unit.from?.transform.opacity ?? 1, unit.to?.transform.opacity ?? 1, depth);
      } else if (okB && b) {
        ctx.globalAlpha = unit.to!.transform.opacity;
        ctx.drawImage(b, 0, 0);
        ctx.globalAlpha = 1;
      }
    }
  }

  /**
   * Composite all units onto the canvas. Returns false if a source was
   * unusable (e.g. tainted) so the caller can fall back to the legacy view.
   */
  render(units: PreviewUnit[], sourceFor: LayerSource, opts: CompositeOptions): boolean {
    const { width: W, height: H } = opts;
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    this.healthy = true;
    this.renderUnits(this.ctx, units, sourceFor, opts, 0, false);
    // Free NodeFX renderers for clips that are no longer on screen.
    const live = new Set<string>();
    const collect = (list: PreviewUnit[]) => {
      for (const u of list) for (const l of [u.from, u.to]) if (l) { live.add(l.key); if (l.nested) collect(l.nested); }
    };
    collect(units);
    for (const [key, c] of this.comps) {
      if (!live.has(key)) { c.renderer.dispose(); this.comps.delete(key); }
    }
    return this.healthy;
  }

  /** Read back the current frame (for the GPU export path). */
  readPixels(): ImageData {
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }
}
