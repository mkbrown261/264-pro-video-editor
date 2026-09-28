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
import type { PreviewLayer, PreviewUnit } from "../../shared/previewLayers";

// ─── File LUT cache (async) ───────────────────────────────────────────────────

const fileLuts = new Map<string, Lut3D | null | "loading">();
let onLutLoaded: (() => void) | null = null;

function lutUrl(path: string): string {
  if (/^(https?:|media:|data:)/.test(path)) return path;
  if (/^([a-zA-Z]:[\\/]|\/)/.test(path)) return `media://asset?path=${encodeURIComponent(path)}`;
  return `./${path.replace(/^\.?\//, "")}`;
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
  /** Effects with keyframes already resolved for this frame. */
  effectsFor?: (clip: TimelineClip) => TimelineClip["effects"];
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

export class ViewerCompositor {
  private ctx: CanvasRenderingContext2D;
  private grade = new GradePass();
  private layerCanvases: HTMLCanvasElement[] = [];
  private scratch = document.createElement("canvas");
  /** False when frames are tainted (no CORS) — caller falls back to legacy view. */
  healthy = true;

  constructor(readonly canvas: HTMLCanvasElement, onDirty: () => void) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    onLutLoaded = onDirty;
  }

  dispose() {
    this.grade.dispose();
    if (onLutLoaded) onLutLoaded = null;
  }

  private layerCanvas(i: number, W: number, H: number): HTMLCanvasElement {
    let c = this.layerCanvases[i];
    if (!c) { c = document.createElement("canvas"); this.layerCanvases[i] = c; }
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    return c;
  }

  /** Draw one layer (grade → fit → transform → effects → masks) into a canvas-sized layer. */
  private drawLayer(target: HTMLCanvasElement, layer: PreviewLayer, source: CanvasImageSource | null, opts: CompositeOptions): boolean {
    const { width: W, height: H } = opts;
    const lc = target.getContext("2d")!;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalAlpha = 1;
    lc.filter = "none";
    lc.globalCompositeOperation = "source-over";
    lc.clearRect(0, 0, W, H);
    if (!source) return false;
    const [sw, sh] = mediaSize(source);
    if (!sw || !sh) return false;

    let img: CanvasImageSource = source;
    const clip = layer.segment.clip;
    const lut = gradeLutFor(clip, opts.frame);
    if (lut) {
      // Grade at no more than the layer's on-screen resolution.
      const fit = Math.min(W / sw, H / sh, 1);
      const graded = this.grade.run(source, Math.max(2, Math.round(sw * fit)), Math.max(2, Math.round(sh * fit)), lut);
      if (graded) img = graded;
      else if (!this.grade.failed) this.healthy = false;
    }

    const fit = Math.min(W / sw, H / sh);
    const fw = sw * fit, fh = sh * fit;
    const t = layer.transform;
    // Preview semantics (shared with export): translate(pos·canvas), then
    // scale/rotate about the anchor point of the fitted frame.
    const ax = (W - fw) / 2 + t.anchorX * fw;
    const ay = (H - fh) / 2 + t.anchorY * fh;
    lc.translate(t.posX * W + ax, t.posY * H + ay);
    lc.rotate((t.rotation * Math.PI) / 180);
    lc.scale(t.scaleX, t.scaleY);
    const effects = opts.effectsFor ? opts.effectsFor(clip) : clip.effects;
    const css = effects?.length ? computeCssFilterFromEffects(effects) : "none";
    lc.filter = css === "none" ? "none" : scaleCssPx(css, W / 960);
    try {
      lc.drawImage(img, -t.anchorX * fw, -t.anchorY * fh, fw, fh);
    } catch {
      this.healthy = false;
      return false;
    }
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.filter = "none";

    // Masks that are not effect/grade windows cut the clip (union, feathered).
    const windows = new Set([...(clip.colorGrade?.maskIds ?? []), ...(clip.effects ?? []).flatMap((e) => e.maskIds ?? [])]);
    const masks = (clip.masks ?? []).filter((m) => !windows.has(m.id));
    if (masks.length) {
      const mc = this.scratch;
      if (mc.width !== W || mc.height !== H) { mc.width = W; mc.height = H; }
      const m = mc.getContext("2d")!;
      m.setTransform(1, 0, 0, 1, 0, 0);
      m.clearRect(0, 0, W, H);
      for (const mask of masks) {
        const path = maskPath(mask, W, H);
        if (!path) continue;
        m.filter = mask.feather > 0 ? `blur(${(mask.feather * 0.4 * W) / 960}px)` : "none";
        m.globalAlpha = Math.min(1, Math.max(0, mask.opacity ?? 1));
        m.fillStyle = "#fff";
        if (mask.inverted) {
          const inv = new Path2D();
          inv.rect(0, 0, W, H);
          inv.addPath(path);
          m.fill(inv, "evenodd");
        } else m.fill(path);
      }
      m.filter = "none";
      m.globalAlpha = 1;
      lc.globalCompositeOperation = "destination-in";
      lc.drawImage(mc, 0, 0);
      lc.globalCompositeOperation = "source-over";
    }
    return true;
  }

  /** Blend `from`→`to` layer canvases onto the main canvas per the xfade name. */
  private blend(name: string, p: number, from: HTMLCanvasElement | null, to: HTMLCanvasElement | null, W: number, H: number, opFrom: number, opTo: number) {
    const ctx = this.ctx;
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
      case "circleopen": draw(from, opFrom); draw(to, opTo, (g) => g.arc(W / 2, H / 2, Math.hypot(W, H) / 2 * q, 0, Math.PI * 2)); return;
      case "radial": draw(from, opFrom); draw(to, opTo, (g) => { g.moveTo(W / 2, H / 2); g.arc(W / 2, H / 2, Math.hypot(W, H), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * q); g.closePath(); }); return;
      case "vertopen": draw(from, opFrom); draw(to, opTo, (g) => g.rect(W / 2 * (1 - q), 0, W * q, H)); return;
      case "horzopen": draw(from, opFrom); draw(to, opTo, (g) => g.rect(0, H / 2 * (1 - q), W, H * q)); return;
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
        const s = Math.max(1, Math.round((1 - Math.abs(q - 0.5) * 2) * 40));
        if (c) {
          const t = this.scratch;
          t.width = Math.max(1, Math.round(W / s)); t.height = Math.max(1, Math.round(H / s));
          const tc = t.getContext("2d")!;
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

  /**
   * Composite all units. Returns false if a source was unusable (e.g. tainted)
   * so the caller can fall back to the legacy single-video view.
   */
  render(units: PreviewUnit[], sourceFor: LayerSource, opts: CompositeOptions): boolean {
    const { width: W, height: H } = opts;
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    this.healthy = true;

    for (const unit of units) {
      if (unit.kind === "text") continue; // titles/captions are drawn by the DOM overlay
      if (unit.kind === "adjustment") {
        const layer = unit.to!;
        const lc = this.layerCanvas(0, W, H);
        const snap = lc.getContext("2d")!;
        snap.setTransform(1, 0, 0, 1, 0, 0);
        snap.clearRect(0, 0, W, H);
        snap.drawImage(this.canvas, 0, 0);
        const adjusted = this.layerCanvas(1, W, H);
        const ok = this.drawLayer(adjusted, { ...layer, transform: { posX: 0, posY: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1 } }, lc, opts);
        if (ok) { ctx.globalAlpha = layer.transform.opacity; ctx.drawImage(adjusted, 0, 0); ctx.globalAlpha = 1; }
        continue;
      }
      const a = unit.from ? this.layerCanvas(0, W, H) : null;
      const b = unit.to ? this.layerCanvas(1, W, H) : null;
      const okA = a && unit.from ? this.drawLayer(a, unit.from, sourceFor(unit.from), opts) : false;
      const okB = b && unit.to ? this.drawLayer(b, unit.to, sourceFor(unit.to), opts) : false;
      if (unit.transition) {
        this.blend(unit.transition.name, unit.transition.progress, okA ? a : null, okB ? b : null, W, H,
          unit.from?.transform.opacity ?? 1, unit.to?.transform.opacity ?? 1);
      } else if (okB && b) {
        ctx.globalAlpha = unit.to!.transform.opacity;
        ctx.drawImage(b, 0, 0);
        ctx.globalAlpha = 1;
      }
    }
    return this.healthy;
  }
}
