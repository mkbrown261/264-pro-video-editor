/**
 * 264 Pro — Real-time WebGL Color Grade Renderer
 *
 * Renders a <video> element into a <canvas> every animation frame,
 * applying the full ColorGrade (lift/gamma/gain/offset wheels, exposure,
 * contrast, saturation, temperature/tint, RGB curves) via a GLSL fragment
 * shader. GPU-accelerated: zero CPU pixel loops.
 *
 * Usage:
 *   const renderer = new ColorGradeRenderer(canvasEl);
 *   renderer.setGrade(grade);         // call on every grade change
 *   renderer.setVideo(videoEl);       // call once video is available
 *   renderer.start();                 // begins RAF loop
 *   renderer.stop();                  // cancels RAF, frees GL
 *   renderer.dispose();               // full teardown
 */

import type { ColorGrade, CurvePoint, RGBValue } from "../../shared/models";

// ─── Vertex shader ────────────────────────────────────────────────────────────
const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  // Flip Y: WebGL origin is bottom-left, video textures are top-left
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// ─── Fragment shader ──────────────────────────────────────────────────────────
// Each curve is baked into a 256-entry 1-D texture (R channel only) so
// curve sampling is O(1) per pixel regardless of control-point count.
const FRAG_SRC = `
precision mediump float;

uniform sampler2D u_video;       // the video frame
uniform sampler2D u_curve_r;     // red channel curve  LUT  (256×1)
uniform sampler2D u_curve_g;     // green channel curve LUT
uniform sampler2D u_curve_b;     // blue channel curve  LUT
uniform sampler2D u_curve_m;     // master curve        LUT

uniform vec3 u_lift;             // lift  wheel  (r,g,b)  each -1..1
uniform vec3 u_gamma;            // gamma wheel
uniform vec3 u_gain;             // gain  wheel
uniform vec3 u_offset;           // offset wheel

uniform float u_exposure;        // stops, -3..3
uniform float u_contrast;        // -1..1
uniform float u_saturation;      // 0..3
uniform float u_temperature;     // -100..100
uniform float u_tint;            // -100..100

varying vec2 v_uv;

// ── helpers ────────────────────────────────────────────────────────────────
vec3 lift_gamma_gain_offset(vec3 c,
                             vec3 lift, vec3 gamma, vec3 gain, vec3 offset) {
  // Apply lift (shadow shift), gain (highlight scale), gamma (midtone power)
  // Mirrors DaVinci's LGG model:
  //   out = pow( clamp( gain*(c + lift*(1-c)), 0, 1 ), 1/(1+gamma) ) + offset
  vec3 r = gain * (c + lift * (1.0 - c));
  r = clamp(r, 0.0, 1.0);
  // gamma: positive = brighter mids, negative = darker mids
  vec3 gExp = vec3(1.0) / max(vec3(1.0) + gamma, vec3(0.001));
  r = pow(r, gExp);
  r = clamp(r + offset, 0.0, 1.0);
  return r;
}

float rgb_to_luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 desaturate(vec3 c, float amount) {
  float luma = rgb_to_luma(c);
  return mix(vec3(luma), c, amount);
}

// Temperature shifts: warm=red/yellow, cool=blue
vec3 apply_temperature(vec3 c, float temp) {
  // temp: +100 warm (add red, remove blue), -100 cool (add blue, remove red)
  float t = temp / 100.0;
  c.r = clamp(c.r + t * 0.12, 0.0, 1.0);
  c.b = clamp(c.b - t * 0.12, 0.0, 1.0);
  return c;
}

// Tint: +100 magenta, -100 green
vec3 apply_tint(vec3 c, float tint) {
  float t = tint / 100.0;
  c.g = clamp(c.g - t * 0.10, 0.0, 1.0);
  c.r = clamp(c.r + t * 0.04, 0.0, 1.0);
  c.b = clamp(c.b + t * 0.04, 0.0, 1.0);
  return c;
}

// Sample a 256-entry 1-D LUT texture (stored as 256×1 RGBA, value in R)
float sampleLUT(sampler2D lut, float v) {
  // Use centre-of-texel addressing to avoid edge artefacts
  float u = (clamp(v, 0.0, 1.0) * 255.0 + 0.5) / 256.0;
  return texture2D(lut, vec2(u, 0.5)).r;
}

void main() {
  vec4 px   = texture2D(u_video, v_uv);
  vec3 col  = px.rgb;

  // 1. Exposure (multiply by 2^stops)
  col *= pow(2.0, u_exposure);
  col  = clamp(col, 0.0, 1.0);

  // 2. Lift / Gamma / Gain / Offset
  col = lift_gamma_gain_offset(col, u_lift, u_gamma, u_gain, u_offset);

  // 3. Contrast (S-curve around 0.5)
  col = clamp((col - 0.5) * (1.0 + u_contrast) + 0.5, 0.0, 1.0);

  // 4. Temperature & Tint
  col = apply_temperature(col, u_temperature);
  col = apply_tint(col, u_tint);

  // 5. Saturation
  col = desaturate(col, u_saturation);

  // 6. Per-channel curves (baked to 1-D LUT textures)
  col.r = sampleLUT(u_curve_r, col.r);
  col.g = sampleLUT(u_curve_g, col.g);
  col.b = sampleLUT(u_curve_b, col.b);

  // 7. Master curve
  col.r = sampleLUT(u_curve_m, col.r);
  col.g = sampleLUT(u_curve_m, col.g);
  col.b = sampleLUT(u_curve_m, col.b);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), px.a);
}
`;

// ─── Curve baking ─────────────────────────────────────────────────────────────

/** Evaluate a piecewise Catmull-Rom / linear spline at x ∈ [0,1]. */
function evalCurve(pts: CurvePoint[], x: number): number {
  const sorted = [...pts].sort((a, b) => a.x - b.x);
  if (sorted.length === 0) return x;
  if (x <= sorted[0].x) return sorted[0].y;
  if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;

  for (let i = 0; i < sorted.length - 1; i++) {
    const p0 = sorted[i];
    const p1 = sorted[i + 1];
    if (x >= p0.x && x <= p1.x) {
      const t = (x - p0.x) / (p1.x - p0.x);
      // Cubic Hermite (tension 0) – tangent approximated from neighbours
      const tm1 = i > 0 ? sorted[i - 1] : p0;
      const tp2 = i < sorted.length - 2 ? sorted[i + 2] : p1;
      const m0 = (p1.y - tm1.y) / ((p1.x - tm1.x) || 1) * (p1.x - p0.x);
      const m1 = (tp2.y - p0.y) / ((tp2.x - p0.x) || 1) * (p1.x - p0.x);
      const t2 = t * t, t3 = t2 * t;
      return (
        (2 * t3 - 3 * t2 + 1) * p0.y +
        (t3 - 2 * t2 + t)     * m0  +
        (-2 * t3 + 3 * t2)    * p1.y +
        (t3 - t2)             * m1
      );
    }
  }
  return x;
}

/** Bake a curve into a 256-element Uint8Array (R channel of a 256×1 texture). */
function bakeCurve(pts: CurvePoint[]): Uint8Array {
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const v = Math.round(Math.min(1, Math.max(0, evalCurve(pts, i / 255))) * 255);
    const idx = i * 4;
    data[idx]     = v;  // R
    data[idx + 1] = v;  // G
    data[idx + 2] = v;  // B
    data[idx + 3] = 255;
  }
  return data;
}

// ─── Identity defaults ─────────────────────────────────────────────────────

const IDENTITY_CURVE: CurvePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
const ZERO_RGB: RGBValue = { r: 0, g: 0, b: 0 };

// ─── Main renderer class ───────────────────────────────────────────────────

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error("Could not create shader");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader compile error: ${log}`);
  }
  return s;
}

function linkProgram(gl: WebGLRenderingContext, vert: WebGLShader, frag: WebGLShader): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error("Could not create program");
  gl.attachShader(p, vert);
  gl.attachShader(p, frag);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`Program link error: ${log}`);
  }
  return p;
}

function make1DTexture(gl: WebGLRenderingContext, data: Uint8Array): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function update1DTexture(gl: WebGLRenderingContext, tex: WebGLTexture, data: Uint8Array) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
}

export class ColorGradeRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private videoTex: WebGLTexture | null = null;
  private curveTex: { r: WebGLTexture; g: WebGLTexture; b: WebGLTexture; m: WebGLTexture } | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private video: HTMLVideoElement | null = null;
  private grade: ColorGrade | null = null;
  private rafId: number | null = null;
  private lastVideoTime = -1;
  private gradeVersion = 0;
  private lastRenderedGradeVersion = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.initGL();
  }

  private initGL() {
    const gl = this.canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    }) as WebGLRenderingContext | null;

    if (!gl) {
      console.warn("[ColorGradeRenderer] WebGL not available, will use canvas2D fallback");
      return;
    }
    this.gl = gl;

    try {
      const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
      const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
      this.program = linkProgram(gl, vert, frag);

      // Full-screen quad
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(this.program, "a_pos");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      // Uniforms
      for (const name of [
        "u_video", "u_curve_r", "u_curve_g", "u_curve_b", "u_curve_m",
        "u_lift", "u_gamma", "u_gain", "u_offset",
        "u_exposure", "u_contrast", "u_saturation", "u_temperature", "u_tint",
      ]) {
        this.uniforms[name] = gl.getUniformLocation(this.program, name);
      }

      // Video texture (TEXTURE0)
      this.videoTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      // Curve textures (TEXTURE1-4) — baked to identity initially
      const identity = bakeCurve(IDENTITY_CURVE);
      this.curveTex = {
        r: make1DTexture(gl, identity),
        g: make1DTexture(gl, identity),
        b: make1DTexture(gl, identity),
        m: make1DTexture(gl, identity),
      };

    } catch (e) {
      console.error("[ColorGradeRenderer] GL init failed:", e);
      this.gl = null;
    }
  }

  setVideo(video: HTMLVideoElement | null) {
    this.video = video;
    this.lastVideoTime = -1;
  }

  setGrade(grade: ColorGrade | null) {
    this.grade = grade;
    this.gradeVersion++;
  }

  start() {
    if (this.rafId !== null) return;
    const loop = () => {
      this.renderFrame();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private renderFrame() {
    const video = this.video;
    const canvas = this.canvas;

    // Sync canvas size to video intrinsic size (or container size)
    const w = video?.videoWidth  || canvas.offsetWidth  || 1920;
    const h = video?.videoHeight || canvas.offsetHeight || 1080;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w;
      canvas.height = h;
    }

    // Skip if no new frame and grade hasn't changed
    const videoTime = video?.currentTime ?? -1;
    const videoReady = video && video.readyState >= 2 && video.videoWidth > 0;
    const gradeChanged = this.gradeVersion !== this.lastRenderedGradeVersion;
    const frameChanged = videoTime !== this.lastVideoTime;

    if (!videoReady || (!frameChanged && !gradeChanged)) return;

    if (this.gl && this.program && this.curveTex && this.videoTex) {
      this.renderGL(video!);
    } else {
      this.renderCanvas2D(video!);
    }

    this.lastVideoTime = videoTime;
    this.lastRenderedGradeVersion = this.gradeVersion;
  }

  private renderGL(video: HTMLVideoElement) {
    const gl = this.gl!;
    const prog = this.program!;
    const ct = this.curveTex!;
    const grade = this.grade;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(prog);

    // Update curve textures if grade changed
    if (this.gradeVersion !== this.lastRenderedGradeVersion && grade) {
      update1DTexture(gl, ct.r, bakeCurve(grade.curves.red   ?? IDENTITY_CURVE));
      update1DTexture(gl, ct.g, bakeCurve(grade.curves.green ?? IDENTITY_CURVE));
      update1DTexture(gl, ct.b, bakeCurve(grade.curves.blue  ?? IDENTITY_CURVE));
      // Master curve (applied after per-channel)
      update1DTexture(gl, ct.m, bakeCurve(grade.curves.master ?? IDENTITY_CURVE));
    } else if (this.gradeVersion !== this.lastRenderedGradeVersion) {
      // No grade — reset all curves to identity
      const id = bakeCurve(IDENTITY_CURVE);
      update1DTexture(gl, ct.r, id);
      update1DTexture(gl, ct.g, id);
      update1DTexture(gl, ct.b, id);
      update1DTexture(gl, ct.m, id);
    }

    // Upload video frame to TEXTURE0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch {
      return; // cross-origin or not-ready
    }
    gl.uniform1i(this.uniforms["u_video"], 0);

    // Bind curve textures
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ct.r);
    gl.uniform1i(this.uniforms["u_curve_r"], 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, ct.g);
    gl.uniform1i(this.uniforms["u_curve_g"], 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, ct.b);
    gl.uniform1i(this.uniforms["u_curve_b"], 3);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, ct.m);
    gl.uniform1i(this.uniforms["u_curve_m"], 4);

    // Upload grade uniforms
    const g = grade;
    const lift   = g?.lift   ?? ZERO_RGB;
    const gamma  = g?.gamma  ?? ZERO_RGB;
    const gain   = g?.gain   ?? ZERO_RGB;
    const offset = g?.offset ?? ZERO_RGB;

    gl.uniform3f(this.uniforms["u_lift"],   lift.r,   lift.g,   lift.b);
    gl.uniform3f(this.uniforms["u_gamma"],  gamma.r,  gamma.g,  gamma.b);
    gl.uniform3f(this.uniforms["u_gain"],   gain.r,   gain.g,   gain.b);
    gl.uniform3f(this.uniforms["u_offset"], offset.r, offset.g, offset.b);
    gl.uniform1f(this.uniforms["u_exposure"],    g?.exposure    ?? 0);
    gl.uniform1f(this.uniforms["u_contrast"],    g?.contrast    ?? 0);
    gl.uniform1f(this.uniforms["u_saturation"],  g?.saturation  ?? 1);
    gl.uniform1f(this.uniforms["u_temperature"], g?.temperature ?? 0);
    gl.uniform1f(this.uniforms["u_tint"],        g?.tint        ?? 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Canvas 2D fallback (no WebGL) — applies only exposure + saturation via compositing */
  private renderCanvas2D(video: HTMLVideoElement) {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);

    if (!this.grade) return;
    const { exposure, saturation, contrast } = this.grade;

    // Rough approximation via CSS filter on the canvas context (not perfect but visible)
    const brightness = Math.pow(2, exposure);
    const sat = saturation;
    const con = 1 + contrast;
    ctx.filter = `brightness(${brightness.toFixed(3)}) saturate(${sat.toFixed(3)}) contrast(${con.toFixed(3)})`;
    ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
    ctx.filter = "none";
  }

  dispose() {
    this.stop();
    const gl = this.gl;
    if (gl) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.videoTex) gl.deleteTexture(this.videoTex);
      if (this.curveTex) {
        gl.deleteTexture(this.curveTex.r);
        gl.deleteTexture(this.curveTex.g);
        gl.deleteTexture(this.curveTex.b);
        gl.deleteTexture(this.curveTex.m);
      }
    }
    this.gl = null;
    this.program = null;
    this.videoTex = null;
    this.curveTex = null;
    this.video = null;
    this.grade = null;
  }
}
