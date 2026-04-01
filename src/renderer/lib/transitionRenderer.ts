// ─────────────────────────────────────────────────────────────────────────────
// 264 Pro – WebGL Transition Renderer
// GPU-accelerated transitions: crossDissolve, glitch, glitchRgb, filmBurn,
// zoomCross, pixelate (blur), ripple/vhsRewind, additiveDissolve, whiteFlash,
// blackFlash
//
// Architecture:
//   - One shared WebGLRenderingContext per canvas (lazy init)
//   - Two texture units: TEXTURE0 = fromFrame, TEXTURE1 = toFrame
//   - progress [0..1] fed as uniform u_progress
//   - Each transition type has its own GLSL fragment shader
// ─────────────────────────────────────────────────────────────────────────────

import type { ClipTransitionType } from "../../shared/models";

// ── GLSL shaders ──────────────────────────────────────────────────────────────

const VERT_SRC = `
  attribute vec2 a_position;
  attribute vec2 a_uv;
  varying vec2 v_uv;
  void main() {
    v_uv = a_uv;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

// Cross dissolve
const FRAG_CROSS_DISSOLVE = `
  precision mediump float;
  uniform sampler2D u_from;
  uniform sampler2D u_to;
  uniform float u_progress;
  varying vec2 v_uv;
  void main() {
    vec4 fromColor = texture2D(u_from, v_uv);
    vec4 toColor   = texture2D(u_to,   v_uv);
    gl_FragColor   = mix(fromColor, toColor, u_progress);
  }
`;

// Additive dissolve
const FRAG_ADDITIVE = `
  precision mediump float;
  uniform sampler2D u_from;
  uniform sampler2D u_to;
  uniform float u_progress;
  varying vec2 v_uv;
  void main() {
    vec4 fromColor = texture2D(u_from, v_uv);
    vec4 toColor   = texture2D(u_to,   v_uv);
    float bright = smoothstep(0.0, 0.5, u_progress);
    vec4 blended  = clamp(fromColor + toColor * u_progress, 0.0, 1.0);
    gl_FragColor   = mix(blended, toColor, u_progress);
  }
`;

// Glitch
const FRAG_GLITCH = `
  precision mediump float;
  uniform sampler2D u_from;
  uniform sampler2D u_to;
  uniform float u_progress;
  uniform float u_time;
  varying vec2 v_uv;

  float rand(float n) { return fract(sin(n) * 43758.5453123); }

  void main() {
    float blocks = floor(v_uv.y * 12.0);
    float shift  = (rand(blocks + floor(u_time * 20.0)) - 0.5) * u_progress * 0.15;
    vec2 uv1 = vec2(v_uv.x + shift, v_uv.y);
    vec2 uv2 = v_uv;
    // RGB channel split on the incoming frame
    float r = texture2D(u_to, uv1 + vec2( 0.006 * u_progress, 0.0)).r;
    float g = texture2D(u_to, uv2).g;
    float b = texture2D(u_to, uv1 - vec2( 0.006 * u_progress, 0.0)).b;
    vec4 glitched = vec4(r, g, b, 1.0);
    vec4 fromColor = texture2D(u_from, v_uv);
    gl_FragColor  = mix(fromColor, glitched, u_progress);
  }
`;

// Glitch RGB (more intense)
const FRAG_GLITCH_RGB = `
  precision mediump float;
  uniform sampler2D u_from;
  uniform sampler2D u_to;
  uniform float u_progress;
  uniform float u_time;
  varying vec2 v_uv;

  float rand(float n) { return fract(sin(n) * 43758.5453123); }
  float rand2(vec2 c)  { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    float t = floor(u_time * 30.0);
    float blocks = floor(v_uv.y * 20.0);
    float shift  = (rand(blocks + t) - 0.5) * u_progress * 0.22;
    vec2 uvA = vec2(v_uv.x + shift, v_uv.y);
    float noise = rand2(vec2(floor(v_uv.y * 40.0) + t, t)) * u_progress * 0.1;
    float r = texture2D(u_to, uvA + vec2(0.012 * u_progress + noise, 0.0)).r;
    float g = texture2D(u_to, v_uv).g;
    float b = texture2D(u_to, uvA - vec2(0.012 * u_progress + noise, 0.0)).b;
    vec4 fromColor = texture2D(u_from, v_uv);
    vec4 toGlitch  = vec4(r, g, b, 1.0);
    gl_FragColor   = mix(fromColor, toGlitch, u_progress);
  }
`;

// Film Burn
const FRAG_FILM_BURN = `
  precision mediump float;
  uniform sampler2D u_from;
  uniform sampler2D u_to;
  uniform float u_progress;
  uniform float u_time;
  varying vec2 v_uv;

  float noise(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    float burn = noise(v_uv * 4.0 + u_time * 0.5) * u_progress * 2.0;
    float edge = smoothstep(u_progress - 0.35, u_progress + 0.05, burn);
    vec4 fromColor = texture2D(u_from, v_uv);
    vec4 toColor   = texture2D(u_to,   v_uv);
    // Burn region: orange-yellow flare
    vec4 burnColor = vec4(1.0, 0.55 + burn * 0.3, 0.1, 1.0);
    vec4 blended   = mix(fromColor, toColor, edge);
    float flare    = smoothstep(0.4, 0.6, edge) * (1.0 - smoothstep(0.6, 0.9, edge)) * 0.7;
    gl_FragColor   = mix(blended, burnColor, flare);
  }
`;

// Zoom Cross
const FRAG_ZOOM_CROSS = `
  precision mediump float;
  uniform sampler2D u_from;
  uniform sampler2D u_to;
  uniform float u_progress;
  varying vec2 v_uv;

  vec4 sampleZoom(sampler2D tex, vec2 uv, float zoom) {
    vec2 centered = uv - 0.5;
    vec2 zoomed   = centered / zoom + 0.5;
    if (zoomed.x < 0.0 || zoomed.x > 1.0 || zoomed.y < 0.0 || zoomed.y > 1.0)
      return vec4(0.0);
    return texture2D(tex, zoomed);
  }

  void main() {
    float zoomOut = 1.0 + u_progress * 0.25;
    float zoomIn  = 1.25 - u_progress * 0.25;
    vec4 fromColor = sampleZoom(u_from, v_uv, zoomOut);
    vec4 toColor   = sampleZoom(u_to,   v_uv, zoomIn);
    gl_FragColor   = mix(fromColor, toColor, u_progress);
  }
`;

// Pixelate
const FRAG_PIXELATE = `
  precision mediump float;
  uniform sampler2D u_from;
  uniform sampler2D u_to;
  uniform float u_progress;
  varying vec2 v_uv;

  vec4 pixSample(sampler2D tex, vec2 uv, float blockSize) {
    vec2 pxUv = floor(uv * blockSize) / blockSize + 0.5 / blockSize;
    return texture2D(tex, pxUv);
  }

  void main() {
    // Block size peaks at midpoint (most pixelated) then shrinks
    float t = 1.0 - abs(u_progress * 2.0 - 1.0);
    float blocks = 4.0 + t * 24.0;
    vec4 fromPix = pixSample(u_from, v_uv, blocks);
    vec4 toPix   = pixSample(u_to,   v_uv, blocks);
    gl_FragColor = mix(fromPix, toPix, u_progress);
  }
`;

// Ripple / Wave
const FRAG_RIPPLE = `
  precision mediump float;
  uniform sampler2D u_from;
  uniform sampler2D u_to;
  uniform float u_progress;
  varying vec2 v_uv;

  void main() {
    float freq  = 20.0;
    float amp   = 0.015 * sin(u_progress * 3.14159);
    float wave  = sin((v_uv.x + v_uv.y * 0.5) * freq - u_progress * 15.0) * amp;
    vec2 uvWarp = v_uv + vec2(wave, wave);
    uvWarp      = clamp(uvWarp, 0.0, 1.0);
    vec4 fromColor = texture2D(u_from, uvWarp);
    vec4 toColor   = texture2D(u_to,   v_uv);
    gl_FragColor   = mix(fromColor, toColor, u_progress);
  }
`;

// White Flash
const FRAG_WHITE_FLASH = `
  precision mediump float;
  uniform sampler2D u_from;
  uniform sampler2D u_to;
  uniform float u_progress;
  varying vec2 v_uv;
  void main() {
    float flash = 1.0 - abs(u_progress * 2.0 - 1.0);
    vec4 fromColor = texture2D(u_from, v_uv);
    vec4 toColor   = texture2D(u_to,   v_uv);
    vec4 blended   = mix(fromColor, toColor, u_progress);
    gl_FragColor   = mix(blended, vec4(1.0), flash);
  }
`;

// Black Flash
const FRAG_BLACK_FLASH = `
  precision mediump float;
  uniform sampler2D u_from;
  uniform sampler2D u_to;
  uniform float u_progress;
  varying vec2 v_uv;
  void main() {
    float flash = 1.0 - abs(u_progress * 2.0 - 1.0);
    vec4 fromColor = texture2D(u_from, v_uv);
    vec4 toColor   = texture2D(u_to,   v_uv);
    vec4 blended   = mix(fromColor, toColor, u_progress);
    gl_FragColor   = mix(blended, vec4(0.0, 0.0, 0.0, 1.0), flash);
  }
`;

// VHS Rewind
const FRAG_VHS_REWIND = `
  precision mediump float;
  uniform sampler2D u_from;
  uniform sampler2D u_to;
  uniform float u_progress;
  uniform float u_time;
  varying vec2 v_uv;

  float rand(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    // Horizontal band tearing
    float band = floor(v_uv.y * 30.0);
    float tear = rand(band + floor(u_time * 15.0)) * u_progress * 0.12;
    vec2 uv = vec2(v_uv.x + tear, v_uv.y);
    uv.x = mod(uv.x, 1.0);
    // Color bleed
    float r = texture2D(u_from, uv + vec2(0.005 * u_progress, 0.0)).r;
    float g = texture2D(u_from, uv).g;
    float b = texture2D(u_from, uv - vec2(0.005 * u_progress, 0.0)).b;
    vec4 fromVhs = vec4(r, g, b, 1.0);
    vec4 toColor = texture2D(u_to, v_uv);
    gl_FragColor = mix(fromVhs, toColor, u_progress);
  }
`;

// ── Shader registry ───────────────────────────────────────────────────────────

const FRAG_BY_TYPE: Partial<Record<ClipTransitionType, string>> = {
  // Dissolve family — cross-frame blending requires WebGL
  crossDissolve:     FRAG_CROSS_DISSOLVE,
  luminanceDissolve: FRAG_CROSS_DISSOLVE,  // luminance weighting approximated as cross-dissolve
  filmDissolve:      FRAG_CROSS_DISSOLVE,  // film-grain dissolve approximated
  additiveDissolve:  FRAG_ADDITIVE,
  // Stylized — complex per-pixel effects
  glitch:            FRAG_GLITCH,
  glitchRgb:         FRAG_GLITCH_RGB,
  filmBurn:          FRAG_FILM_BURN,
  lightLeak:         FRAG_FILM_BURN,        // same warm organic burn
  vhsStatic:         FRAG_VHS_REWIND,       // VHS static uses same shader
  // Zoom/Spatial
  zoomCross:         FRAG_ZOOM_CROSS,
  // Distortion
  pixelate:          FRAG_PIXELATE,
  ripple:            FRAG_RIPPLE,
  // Cinematic
  vhsRewind:         FRAG_VHS_REWIND,
  oldFilm:           FRAG_VHS_REWIND,       // old film approximated with VHS shader
  whiteFlash:        FRAG_WHITE_FLASH,
  blackFlash:        FRAG_BLACK_FLASH,
  filmFlash:         FRAG_WHITE_FLASH,      // film flash = white flash variant
  // NOTE: "blur" / "blurDissolve" use CSS filter — NOT WebGL
  // This keeps the <video> element visible and avoids hiding it under a canvas
};

// ── WebGL helpers ─────────────────────────────────────────────────────────────

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("[TransitionRenderer] Shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext, fragSrc: string): WebGLProgram | null {
  const vert = compileShader(gl, gl.VERTEX_SHADER,   VERT_SRC);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vert || !frag) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("[TransitionRenderer] Program link error:", gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

function uploadTexture(gl: WebGLRenderingContext, src: TexImageSource): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  return tex;
}

const QUAD_VERTS = new Float32Array([
  // x,    y,   u,   v
  -1.0, -1.0,  0.0, 0.0,
   1.0, -1.0,  1.0, 0.0,
  -1.0,  1.0,  0.0, 1.0,
   1.0,  1.0,  1.0, 1.0,
]);

// ── Renderer class ────────────────────────────────────────────────────────────

interface GLState {
  gl: WebGLRenderingContext;
  programs: Map<string, WebGLProgram>;
  buf: WebGLBuffer;
}

function initGL(canvas: HTMLCanvasElement): GLState | null {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false }) as WebGLRenderingContext | null;
  if (!gl) return null;
  const buf = gl.createBuffer();
  if (!buf) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW);
  return { gl, programs: new Map(), buf };
}

function getProgram(state: GLState, type: ClipTransitionType): WebGLProgram | null {
  const cached = state.programs.get(type);
  if (cached) return cached;
  const fragSrc = FRAG_BY_TYPE[type];
  if (!fragSrc) return null;
  const prog = createProgram(state.gl, fragSrc);
  if (!prog) return null;
  state.programs.set(type, prog);
  return prog;
}

// ── Public API ────────────────────────────────────────────────────────────────

const glStateMap = new WeakMap<HTMLCanvasElement, GLState>();

function getOrInitState(canvas: HTMLCanvasElement): GLState | null {
  if (glStateMap.has(canvas)) return glStateMap.get(canvas)!;
  const state = initGL(canvas);
  if (state) glStateMap.set(canvas, state);
  return state;
}

/**
 * Returns true if this transition type has a WebGL shader.
 */
export function isWebGLTransition(type: ClipTransitionType): boolean {
  return type in FRAG_BY_TYPE;
}

/**
 * Render a WebGL transition frame onto `canvas`.
 *
 * @param canvas  - Output canvas (will be sized to fromFrame dimensions)
 * @param type    - Transition type
 * @param fromEl  - "from" video/image element
 * @param toEl    - "to" video/image element (may be same as fromEl during the seam)
 * @param progress - 0 = full "from", 1 = full "to"
 * @param time    - current time in seconds (for animated shaders)
 */
export function renderTransitionFrame(
  canvas: HTMLCanvasElement,
  type: ClipTransitionType,
  fromEl: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  toEl: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  progress: number,
  time: number = 0
): boolean {
  const state = getOrInitState(canvas);
  if (!state) return false;
  const prog = getProgram(state, type);
  if (!prog) return false;

  const { gl, buf } = state;

  // Resize canvas to match fromEl if needed
  const w = (fromEl as HTMLVideoElement).videoWidth  || (fromEl as HTMLImageElement).width  || canvas.width;
  const h = (fromEl as HTMLVideoElement).videoHeight || (fromEl as HTMLImageElement).height || canvas.height;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width  = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  }

  gl.useProgram(prog);

  // Upload textures
  const fromTex = uploadTexture(gl, fromEl);
  const toTex   = uploadTexture(gl, toEl);
  if (!fromTex || !toTex) return false;

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, fromTex);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, toTex);

  // Uniforms
  const uFrom     = gl.getUniformLocation(prog, "u_from");
  const uTo       = gl.getUniformLocation(prog, "u_to");
  const uProgress = gl.getUniformLocation(prog, "u_progress");
  const uTime     = gl.getUniformLocation(prog, "u_time");

  gl.uniform1i(uFrom, 0);
  gl.uniform1i(uTo,   1);
  gl.uniform1f(uProgress, Math.max(0, Math.min(1, progress)));
  if (uTime) gl.uniform1f(uTime, time);

  // Vertex attribs
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const aPos = gl.getAttribLocation(prog, "a_position");
  const aUV  = gl.getAttribLocation(prog, "a_uv");
  gl.enableVertexAttribArray(aPos);
  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(aUV,  2, gl.FLOAT, false, 16, 8);

  // Draw
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Cleanup textures
  gl.deleteTexture(fromTex);
  gl.deleteTexture(toTex);

  return true;
}

/**
 * Dispose GL state for a canvas (call on unmount).
 */
export function disposeTransitionRenderer(canvas: HTMLCanvasElement): void {
  const state = glStateMap.get(canvas);
  if (!state) return;
  const { gl, programs } = state;
  programs.forEach((p) => gl.deleteProgram(p));
  programs.clear();
  glStateMap.delete(canvas);
}
