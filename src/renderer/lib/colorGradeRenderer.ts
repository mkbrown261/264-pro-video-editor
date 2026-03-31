/**
 * 264 Pro — Real-time WebGL Color Grade Renderer  (v2 — gamma black-screen fix)
 *
 * KEY FIXES in this version:
 *
 * 1. GAIN NEUTRAL VALUE: RGBValue uses [-1, 1] where 0 = neutral.
 *    Old shader:  gain * (c + lift*(1-c))   → gain=0 → BLACK SCREEN
 *    Fixed:       (gain+1) * (c + lift*(1-c)) → gain=0 → pass-through ✓
 *
 * 2. GAMMA EXPONENT: pow(x, 1/(1+gamma))
 *    Old guard:  max(vec3(1)+gamma, vec3(0.001))  → allows (1+gamma)→0 → inf exponent
 *    Fixed:      clamp(1+gamma, 0.1, 10.0)         → exponent always in [0.1, 10] ✓
 *    Also:       pow() of negative base → NaN in GLSL; we clamp base ≥ 0 before pow ✓
 *
 * 3. LIFT NEUTRAL VALUE: lift=0 → c + 0*(1-c) = c → pass-through ✓  (was already correct)
 *
 * 4. OFFSET NEUTRAL VALUE: offset=0 → + 0 → pass-through ✓  (was already correct)
 *
 * 5. PER-STAGE CLAMP: every intermediate result is clamped [0,1] before being
 *    fed to the next operation, preventing NaN/Infinity propagation.
 *
 * 6. RENDER SKIP LOGIC: renderer now re-draws whenever grade changes even if
 *    the video frame hasn't advanced (paused video, still image).
 *
 * 7. CANVAS 2D FALLBACK: also fixed — neutral gain no longer darkens the image.
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
//
// IMPORTANT — value conventions (all match ColorGrade model):
//   lift   [-1..1]  0 = neutral  (shadow additive shift)
//   gamma  [-1..1]  0 = neutral  (midtone power curve)
//   gain   [-1..1]  0 = neutral  (highlight scale; shader adds 1 internally)
//   offset [-1..1]  0 = neutral  (global additive shift after LGG)
//
// DaVinci-style LGG formula (corrected):
//   t  = (gain+1) * (c  + lift*(1-c))      -- lift shadows, scale gain
//   t  = clamp(t, 0, 1)
//   t  = pow(t, 1 / clamp(1+gamma, 0.1, 10))  -- gamma midtone curve
//   t  = clamp(t + offset, 0, 1)
//
// When lift=0, gamma=0, gain=0, offset=0:
//   t = 1 * (c + 0) = c  →  pow(c, 1/1) = c  →  c + 0 = c   ✓ pass-through
//
const FRAG_SRC = `
precision highp float;

uniform sampler2D u_video;       // the video frame
uniform sampler2D u_curve_r;     // red channel curve  LUT  (256x1)
uniform sampler2D u_curve_g;     // green channel curve LUT
uniform sampler2D u_curve_b;     // blue channel curve  LUT
uniform sampler2D u_curve_m;     // master curve        LUT

// Primary wheels — all in [-1, 1], 0 = neutral
uniform vec3 u_lift;
uniform vec3 u_gamma;
uniform vec3 u_gain;
uniform vec3 u_offset;

uniform float u_exposure;        // stops, -3..3
uniform float u_contrast;        // -1..1, 0 = neutral
uniform float u_saturation;      // 0..3, 1 = neutral
uniform float u_temperature;     // -100..100, 0 = neutral
uniform float u_tint;            // -100..100, 0 = neutral

varying vec2 v_uv;

// ── Safe power — avoids NaN from negative base ─────────────────────────────
float safePow(float base, float exp) {
  return pow(max(base, 0.0), exp);
}
vec3 safePow3(vec3 base, vec3 exp) {
  return vec3(
    safePow(base.r, exp.r),
    safePow(base.g, exp.g),
    safePow(base.b, exp.b)
  );
}

// ── DaVinci-style Lift/Gamma/Gain/Offset ───────────────────────────────────
//
//  lift  [-1,1] 0=neutral : shifts shadows  (additive, weighted by (1-c))
//  gamma [-1,1] 0=neutral : adjusts midtones via power curve
//  gain  [-1,1] 0=neutral : scales highlights (neutral = ×1, not ×0!)
//  offset[-1,1] 0=neutral : global brightness shift after LGG
//
vec3 lift_gamma_gain_offset(vec3 c,
                             vec3 lift, vec3 gamma, vec3 gain, vec3 offset) {
  // Step 1 — Lift (shadow lift) + Gain (highlight scale)
  //   gain+1 converts [-1,1] range to [0,2] where 0 = neutral (×1)
  vec3 gainLinear = gain + vec3(1.0);               // [0..2], 1.0 = neutral
  vec3 r = gainLinear * (c + lift * (1.0 - c));
  r = clamp(r, 0.0, 1.0);

  // Step 2 — Gamma (midtone power curve)
  //   exponent = 1/(1+gamma).  When gamma=0 → exp=1 (pass-through).
  //   clamp denominator to [0.1, 10] to prevent division-by-zero / extreme values.
  vec3 denom = clamp(vec3(1.0) + gamma, 0.1, 10.0);
  vec3 gExp  = vec3(1.0) / denom;
  r = safePow3(r, gExp);
  r = clamp(r, 0.0, 1.0);

  // Step 3 — Offset (global shift)
  r = clamp(r + offset, 0.0, 1.0);

  return r;
}

// ── Helpers ────────────────────────────────────────────────────────────────
float rgb_to_luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 desaturate(vec3 c, float sat) {
  // sat=1 → no change; sat=0 → greyscale; sat>1 → hypersaturated
  float luma = rgb_to_luma(c);
  return clamp(mix(vec3(luma), c, sat), 0.0, 1.0);
}

// Temperature: +100 warm (redder/yellower), -100 cool (bluer)
vec3 apply_temperature(vec3 c, float temp) {
  float t = temp / 100.0;  // [-1, 1]
  c.r = clamp(c.r + t * 0.12, 0.0, 1.0);
  c.b = clamp(c.b - t * 0.12, 0.0, 1.0);
  return c;
}

// Tint: +100 magenta, -100 green
vec3 apply_tint(vec3 c, float tint) {
  float t = tint / 100.0;  // [-1, 1]
  c.g = clamp(c.g - t * 0.10, 0.0, 1.0);
  c.r = clamp(c.r + t * 0.04, 0.0, 1.0);
  c.b = clamp(c.b + t * 0.04, 0.0, 1.0);
  return c;
}

// Sample a 256-entry 1-D LUT texture (stored as 256x1 RGBA, value in R channel)
float sampleLUT(sampler2D lut, float v) {
  float u = (clamp(v, 0.0, 1.0) * 255.0 + 0.5) / 256.0;
  return texture2D(lut, vec2(u, 0.5)).r;
}

void main() {
  vec4 px  = texture2D(u_video, v_uv);
  vec3 col = clamp(px.rgb, 0.0, 1.0);

  // 1. Exposure (multiply by 2^stops)
  //    exposure=0 → ×1 = pass-through
  col *= pow(2.0, u_exposure);
  col  = clamp(col, 0.0, 1.0);

  // 2. Lift / Gamma / Gain / Offset (DaVinci LGG)
  col = lift_gamma_gain_offset(col, u_lift, u_gamma, u_gain, u_offset);

  // 3. Contrast (S-curve around pivot 0.5)
  //    contrast=0 → ×(1+0) = ×1 = pass-through
  col = clamp((col - 0.5) * (1.0 + u_contrast) + 0.5, 0.0, 1.0);

  // 4. Temperature & Tint
  col = apply_temperature(col, u_temperature);
  col = apply_tint(col, u_tint);

  // 5. Saturation
  col = desaturate(col, u_saturation);

  // 6. Per-channel curves (baked 1-D LUT textures)
  col.r = sampleLUT(u_curve_r, col.r);
  col.g = sampleLUT(u_curve_g, col.g);
  col.b = sampleLUT(u_curve_b, col.b);

  // 7. Master curve (applied after per-channel)
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
      const t  = (x - p0.x) / (p1.x - p0.x);
      const tm1 = i > 0                  ? sorted[i - 1] : p0;
      const tp2 = i < sorted.length - 2  ? sorted[i + 2] : p1;
      const m0 = (p1.y - tm1.y) / ((p1.x - tm1.x) || 1) * (p1.x - p0.x);
      const m1 = (tp2.y - p0.y) / ((tp2.x - p0.x) || 1) * (p1.x - p0.x);
      const t2 = t * t, t3 = t2 * t;
      return (
        (2 * t3 - 3 * t2 + 1) * p0.y +
        (t3 - 2 * t2 + t)     * m0   +
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
    const raw = evalCurve(pts, i / 255);
    // Guard NaN / Infinity before clamping
    const safe = Number.isFinite(raw) ? raw : i / 255;
    const v   = Math.round(Math.min(1, Math.max(0, safe)) * 255);
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

// ─── WebGL helpers ─────────────────────────────────────────────────────────

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

function linkProgram(
  gl: WebGLRenderingContext,
  vert: WebGLShader,
  frag: WebGLShader,
): WebGLProgram {
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

function update1DTexture(
  gl: WebGLRenderingContext,
  tex: WebGLTexture,
  data: Uint8Array,
) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
}

// ─── Renderer ──────────────────────────────────────────────────────────────

export class ColorGradeRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private videoTex: WebGLTexture | null = null;
  private curveTex: {
    r: WebGLTexture;
    g: WebGLTexture;
    b: WebGLTexture;
    m: WebGLTexture;
  } | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private video: HTMLVideoElement | null = null;
  private grade: ColorGrade | null = null;
  private rafId: number | null = null;
  private lastVideoTime   = -1;
  private gradeVersion    = 0;
  private lastRenderedVersion = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.initGL();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  private initGL() {
    const gl = this.canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    }) as WebGLRenderingContext | null;

    if (!gl) {
      console.warn("[ColorGradeRenderer] WebGL unavailable — using Canvas 2D fallback");
      return;
    }
    this.gl = gl;

    try {
      const vert = compileShader(gl, gl.VERTEX_SHADER,   VERT_SRC);
      const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
      this.program = linkProgram(gl, vert, frag);

      // Full-screen triangle-strip quad
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );
      const aPos = gl.getAttribLocation(this.program, "a_pos");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      // Cache uniform locations
      for (const name of [
        "u_video", "u_curve_r", "u_curve_g", "u_curve_b", "u_curve_m",
        "u_lift", "u_gamma", "u_gain", "u_offset",
        "u_exposure", "u_contrast", "u_saturation", "u_temperature", "u_tint",
      ]) {
        this.uniforms[name] = gl.getUniformLocation(this.program, name);
      }

      // Video texture slot (TEXTURE0) — parameters only; data uploaded per frame
      this.videoTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      // Curve textures (TEXTURE1-4) — initialised to identity
      const identity = bakeCurve(IDENTITY_CURVE);
      this.curveTex = {
        r: make1DTexture(gl, identity),
        g: make1DTexture(gl, identity),
        b: make1DTexture(gl, identity),
        m: make1DTexture(gl, identity),
      };
    } catch (e) {
      console.error("[ColorGradeRenderer] GL init failed:", e);
      this.gl      = null;
      this.program = null;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setVideo(video: HTMLVideoElement | null) {
    this.video = video;
    this.lastVideoTime = -1; // force re-upload on next frame
  }

  setGrade(grade: ColorGrade | null) {
    this.grade = grade;
    this.gradeVersion++;  // force shader uniform refresh even on paused video
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

  // ── Render ────────────────────────────────────────────────────────────────

  private renderFrame() {
    const video  = this.video;
    const canvas = this.canvas;

    // Sync canvas size to video intrinsic size
    const w = video?.videoWidth  || canvas.offsetWidth  || 1920;
    const h = video?.videoHeight || canvas.offsetHeight || 1080;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w;
      canvas.height = h;
    }

    const videoTime    = video?.currentTime ?? -1;
    const videoReady   = !!video && video.readyState >= 2 && video.videoWidth > 0;
    const gradeChanged = this.gradeVersion !== this.lastRenderedVersion;
    const frameChanged = videoTime !== this.lastVideoTime;

    // Render when: video has a new frame, OR grade changed (even on paused video)
    if (!videoReady) return;
    if (!frameChanged && !gradeChanged) return;

    if (this.gl && this.program && this.curveTex && this.videoTex) {
      this.renderGL(video!);
    } else {
      this.renderCanvas2D(video!);
    }

    this.lastVideoTime      = videoTime;
    this.lastRenderedVersion = this.gradeVersion;
  }

  private renderGL(video: HTMLVideoElement) {
    const gl   = this.gl!;
    const prog = this.program!;
    const ct   = this.curveTex!;
    const grade = this.grade;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(prog);

    // Rebuild curve textures when grade changes
    if (this.gradeVersion !== this.lastRenderedVersion) {
      if (grade) {
        update1DTexture(gl, ct.r, bakeCurve(grade.curves?.red    ?? IDENTITY_CURVE));
        update1DTexture(gl, ct.g, bakeCurve(grade.curves?.green  ?? IDENTITY_CURVE));
        update1DTexture(gl, ct.b, bakeCurve(grade.curves?.blue   ?? IDENTITY_CURVE));
        update1DTexture(gl, ct.m, bakeCurve(grade.curves?.master ?? IDENTITY_CURVE));
      } else {
        const id = bakeCurve(IDENTITY_CURVE);
        update1DTexture(gl, ct.r, id);
        update1DTexture(gl, ct.g, id);
        update1DTexture(gl, ct.b, id);
        update1DTexture(gl, ct.m, id);
      }
    }

    // Upload video frame → TEXTURE0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch {
      // cross-origin / not-ready — skip this frame
      return;
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

    // ── Upload grade uniforms ─────────────────────────────────────────────
    // All wheels are in [-1, 1] where 0 = neutral.
    // The shader adds 1 to gain internally to convert to [0..2] multiplicative range.
    const lift   = grade?.lift   ?? ZERO_RGB;
    const gamma  = grade?.gamma  ?? ZERO_RGB;
    const gain   = grade?.gain   ?? ZERO_RGB;
    const offset = grade?.offset ?? ZERO_RGB;

    // Sanity-check: reject NaN values (use 0 fallback)
    const safeF = (v: number, def = 0) => (Number.isFinite(v) ? v : def);
    const safeRGB = (rgb: RGBValue): [number, number, number] => [
      safeF(rgb.r), safeF(rgb.g), safeF(rgb.b),
    ];

    gl.uniform3f(this.uniforms["u_lift"],   ...safeRGB(lift));
    gl.uniform3f(this.uniforms["u_gamma"],  ...safeRGB(gamma));
    gl.uniform3f(this.uniforms["u_gain"],   ...safeRGB(gain));
    gl.uniform3f(this.uniforms["u_offset"], ...safeRGB(offset));

    gl.uniform1f(this.uniforms["u_exposure"],    safeF(grade?.exposure    ?? 0));
    gl.uniform1f(this.uniforms["u_contrast"],    safeF(grade?.contrast    ?? 0));
    gl.uniform1f(this.uniforms["u_saturation"],  safeF(grade?.saturation  ?? 1, 1));
    gl.uniform1f(this.uniforms["u_temperature"], safeF(grade?.temperature ?? 0));
    gl.uniform1f(this.uniforms["u_tint"],        safeF(grade?.tint        ?? 0));

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Canvas 2D fallback — applies exposure + saturation + contrast only */
  private renderCanvas2D(video: HTMLVideoElement) {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;

    const grade = this.grade;
    if (!grade) {
      ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    const { exposure, saturation, contrast } = grade;
    const brightness = Math.pow(2, Number.isFinite(exposure)    ? exposure    : 0);
    const sat        =             Number.isFinite(saturation)   ? saturation  : 1;
    const con        =         1 + (Number.isFinite(contrast)    ? contrast    : 0);

    ctx.filter = `brightness(${brightness.toFixed(3)}) saturate(${sat.toFixed(3)}) contrast(${con.toFixed(3)})`;
    ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
    ctx.filter = "none";
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  dispose() {
    this.stop();
    const gl = this.gl;
    if (gl) {
      if (this.program)  gl.deleteProgram(this.program);
      if (this.videoTex) gl.deleteTexture(this.videoTex);
      if (this.curveTex) {
        gl.deleteTexture(this.curveTex.r);
        gl.deleteTexture(this.curveTex.g);
        gl.deleteTexture(this.curveTex.b);
        gl.deleteTexture(this.curveTex.m);
      }
    }
    this.gl        = null;
    this.program   = null;
    this.videoTex  = null;
    this.curveTex  = null;
    this.video     = null;
    this.grade     = null;
  }
}

// ─── CSS Filter helper (primary rendering path) ───────────────────────────────
//
// Converts a ColorGrade into a CSS `filter` string applied directly on the
// <video> element.  This is the PRIMARY grading path in ViewerPanel because:
//
//  - Zero WebGL: no context loss, no CORS issues, no canvas display:none bugs
//  - GPU-accelerated: browser compositor applies filters on the GPU layer
//  - Instant: filter string recalculated on every React render (~0 ms)
//  - Always visible: cannot produce an all-black image from neutral settings
//
// Mapping from ColorGrade model to CSS filters:
//
//   exposure   [-3..3 stops]   → brightness(2^exposure)
//   contrast   [-1..1]         → contrast(1 + contrast)
//   saturation [0..3]          → saturate(saturation)
//   temperature[-100..100]     → hue-rotate (approximate warm/cool shift)
//   tint       [-100..100]     → slight hue-rotate in opposite direction
//   gamma      [-1..1 per ch]  → brightness of the luminance (average of r/g/b)
//   lift       [-1..1 per ch]  → brightness shift (average of r/g/b)
//   gain       [-1..1 per ch]  → brightness multiplier (average of r/g/b)
//   offset     [-1..1 per ch]  → brightness additive (average of r/g/b)
//
// Wheel-to-brightness mapping (master luminance only; per-channel tint via
// hue-rotate is not possible in CSS — full per-channel requires WebGL):
//
//   lift    master = avg(r,g,b) → add to brightness as (1 + liftMaster * 0.5)
//   gamma   master             → brightness(2^(-gammaMaster))   (inverse: +gamma → brighter mids)
//   gain    master             → multiply brightness by (1 + gainMaster)
//   offset  master             → add to brightness as (1 + offsetMaster)
//
export function colorGradeToCSS(grade: ColorGrade | null): string {
  if (!grade) return "none";

  const safe = (v: number, fallback = 0) => (Number.isFinite(v) ? v : fallback);

  // ── Exposure ─────────────────────────────────────────────────────────────
  const exposure    = safe(grade.exposure, 0);
  const expMult     = Math.pow(2, exposure);              // 2^stops

  // ── Contrast ─────────────────────────────────────────────────────────────
  const contrast    = safe(grade.contrast, 0);
  const contrastVal = Math.max(0.01, 1 + contrast);       // 0.01..2

  // ── Saturation ───────────────────────────────────────────────────────────
  const saturation  = safe(grade.saturation, 1);
  const satVal      = Math.max(0, saturation);            // 0..3

  // ── Temperature/Tint → hue-rotate approximation ──────────────────────────
  // temperature +100 = warm (red/yellow) ≈ -10deg hue shift
  // temperature -100 = cool (blue)       ≈ +10deg hue shift
  const temperature = safe(grade.temperature, 0);
  const tint        = safe(grade.tint, 0);
  const hueRot      = (-temperature * 0.10) + (tint * 0.05); // degrees

  // ── Wheels → master luminance adjustments ────────────────────────────────
  // Each wheel is RGBValue {r,g,b} in [-1,1]. We use the average as a
  // master luminance delta. Per-channel colour shifts need WebGL.
  const liftMaster   = (safe(grade.lift.r)  + safe(grade.lift.g)  + safe(grade.lift.b))  / 3;
  const gammaMaster  = (safe(grade.gamma.r) + safe(grade.gamma.g) + safe(grade.gamma.b)) / 3;
  const gainMaster   = (safe(grade.gain.r)  + safe(grade.gain.g)  + safe(grade.gain.b))  / 3;
  const offsetMaster = (safe(grade.offset.r)+ safe(grade.offset.g)+ safe(grade.offset.b))/ 3;

  // Combine all brightness factors multiplicatively:
  //   lift   → additive shadow lift  (1 + lift*0.5)  clamped ≥0.05
  //   gamma  → midtone power approx  (1 + gamma*0.8) clamped ≥0.05
  //            positive gamma = brighter mids
  //   gain   → highlight scale       (1 + gain)       clamped ≥0.05
  //   offset → global additive       (1 + offset)     clamped ≥0.05
  const liftFactor   = Math.max(0.05, 1 + liftMaster   * 0.5);
  const gammaFactor  = Math.max(0.05, 1 + gammaMaster  * 0.8);
  const gainFactor   = Math.max(0.05, 1 + gainMaster);
  const offsetFactor = Math.max(0.05, 1 + offsetMaster);

  const brightnessCombined = expMult * liftFactor * gammaFactor * gainFactor * offsetFactor;
  const brightnessVal       = Math.max(0.001, brightnessCombined);

  // Build filter string (only include non-identity values to keep it short)
  const parts: string[] = [];

  if (Math.abs(brightnessVal - 1) > 0.001)
    parts.push(`brightness(${brightnessVal.toFixed(4)})`);

  if (Math.abs(contrastVal - 1) > 0.001)
    parts.push(`contrast(${contrastVal.toFixed(3)})`);

  if (Math.abs(satVal - 1) > 0.001)
    parts.push(`saturate(${satVal.toFixed(3)})`);

  if (Math.abs(hueRot) > 0.1)
    parts.push(`hue-rotate(${hueRot.toFixed(2)}deg)`);

  return parts.length > 0 ? parts.join(" ") : "none";
}
