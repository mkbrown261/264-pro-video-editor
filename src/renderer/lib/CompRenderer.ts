// src/renderer/lib/CompRenderer.ts
// WebGL-based compositing renderer for the Fusion node graph
// Evaluates CompGraph nodes topologically and renders to canvas

import type {
  CompGraph,
  CompNode,
  CompNodeType,
} from "../../shared/compositing";
import { topoSort } from "../../shared/compositing";

// ── Shader sources ────────────────────────────────────────────────────────────

const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG_PASSTHROUGH = `
precision mediump float;
uniform sampler2D u_tex;
varying vec2 v_uv;
void main(){ gl_FragColor = texture2D(u_tex, v_uv); }`;

const FRAG_BACKGROUND = `
precision mediump float;
uniform vec4 u_color;
varying vec2 v_uv;
void main(){ gl_FragColor = u_color; }`;

const FRAG_MERGE = `
precision mediump float;
uniform sampler2D u_fg;
uniform sampler2D u_bg;
uniform float u_opacity;
uniform int u_blendMode;
varying vec2 v_uv;

vec3 blendNormal(vec3 fg, vec3 bg){ return fg; }
vec3 blendAdd(vec3 fg, vec3 bg){ return clamp(fg + bg, 0.0, 1.0); }
vec3 blendMultiply(vec3 fg, vec3 bg){ return fg * bg; }
vec3 blendScreen(vec3 fg, vec3 bg){ return 1.0 - (1.0 - fg)*(1.0 - bg); }
vec3 blendOverlay(vec3 fg, vec3 bg){
  return vec3(
    bg.r < 0.5 ? 2.0*bg.r*fg.r : 1.0-2.0*(1.0-bg.r)*(1.0-fg.r),
    bg.g < 0.5 ? 2.0*bg.g*fg.g : 1.0-2.0*(1.0-bg.g)*(1.0-fg.g),
    bg.b < 0.5 ? 2.0*bg.b*fg.b : 1.0-2.0*(1.0-bg.b)*(1.0-fg.b)
  );
}
vec3 blendSoftLight(vec3 fg, vec3 bg){
  return vec3(
    fg.r < 0.5 ? bg.r-(1.0-2.0*fg.r)*bg.r*(1.0-bg.r) : bg.r+(2.0*fg.r-1.0)*(sqrt(bg.r)-bg.r),
    fg.g < 0.5 ? bg.g-(1.0-2.0*fg.g)*bg.g*(1.0-bg.g) : bg.g+(2.0*fg.g-1.0)*(sqrt(bg.g)-bg.g),
    fg.b < 0.5 ? bg.b-(1.0-2.0*fg.b)*bg.b*(1.0-bg.b) : bg.b+(2.0*fg.b-1.0)*(sqrt(bg.b)-bg.b)
  );
}
vec3 blendHardLight(vec3 fg, vec3 bg){ return blendOverlay(bg, fg); }
vec3 blendDifference(vec3 fg, vec3 bg){ return abs(fg - bg); }
vec3 blendExclusion(vec3 fg, vec3 bg){ return fg + bg - 2.0*fg*bg; }
vec3 blendDarken(vec3 fg, vec3 bg){ return min(fg, bg); }
vec3 blendLighten(vec3 fg, vec3 bg){ return max(fg, bg); }
vec3 blendColorDodge(vec3 fg, vec3 bg){ return clamp(bg / max(1.0 - fg, 0.001), 0.0, 1.0); }
vec3 blendColorBurn(vec3 fg, vec3 bg){ return 1.0 - clamp((1.0 - bg) / max(fg, 0.001), 0.0, 1.0); }

void main(){
  vec4 fgColor = texture2D(u_fg, v_uv);
  vec4 bgColor = texture2D(u_bg, v_uv);
  vec3 blended;
  if(u_blendMode == 1)       blended = blendAdd(fgColor.rgb, bgColor.rgb);
  else if(u_blendMode == 2)  blended = blendMultiply(fgColor.rgb, bgColor.rgb);
  else if(u_blendMode == 3)  blended = blendScreen(fgColor.rgb, bgColor.rgb);
  else if(u_blendMode == 4)  blended = blendOverlay(fgColor.rgb, bgColor.rgb);
  else if(u_blendMode == 5)  blended = blendSoftLight(fgColor.rgb, bgColor.rgb);
  else if(u_blendMode == 6)  blended = blendHardLight(fgColor.rgb, bgColor.rgb);
  else if(u_blendMode == 7)  blended = blendDifference(fgColor.rgb, bgColor.rgb);
  else if(u_blendMode == 8)  blended = blendExclusion(fgColor.rgb, bgColor.rgb);
  else if(u_blendMode == 9)  blended = blendDarken(fgColor.rgb, bgColor.rgb);
  else if(u_blendMode == 10) blended = blendLighten(fgColor.rgb, bgColor.rgb);
  else if(u_blendMode == 11) blended = blendColorDodge(fgColor.rgb, bgColor.rgb);
  else if(u_blendMode == 12) blended = blendColorBurn(fgColor.rgb, bgColor.rgb);
  else                       blended = blendNormal(fgColor.rgb, bgColor.rgb);

  float fgAlpha = fgColor.a * u_opacity;
  gl_FragColor = vec4(mix(bgColor.rgb, blended, fgAlpha), max(bgColor.a, fgAlpha));
}`;

const FRAG_COLOR_CORRECTOR = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_gamma;
uniform float u_lift;
uniform float u_gain;
varying vec2 v_uv;

vec3 rgb2hsl(vec3 c){
  float maxC = max(c.r,max(c.g,c.b));
  float minC = min(c.r,min(c.g,c.b));
  float l = (maxC + minC) * 0.5;
  if(maxC == minC) return vec3(0.0,0.0,l);
  float d = maxC - minC;
  float s = l > 0.5 ? d/(2.0-maxC-minC) : d/(maxC+minC);
  float h;
  if(maxC == c.r)      h = (c.g-c.b)/d + (c.g < c.b ? 6.0 : 0.0);
  else if(maxC == c.g) h = (c.b-c.r)/d + 2.0;
  else                 h = (c.r-c.g)/d + 4.0;
  return vec3(h/6.0, s, l);
}
float hue2rgb(float p, float q, float t){
  if(t<0.0) t+=1.0; if(t>1.0) t-=1.0;
  if(t<1.0/6.0) return p+(q-p)*6.0*t;
  if(t<0.5)     return q;
  if(t<2.0/3.0) return p+(q-p)*(2.0/3.0-t)*6.0;
  return p;
}
vec3 hsl2rgb(vec3 hsl){
  if(hsl.y == 0.0) return vec3(hsl.z);
  float q = hsl.z<0.5 ? hsl.z*(1.0+hsl.y) : hsl.z+hsl.y-hsl.z*hsl.y;
  float p = 2.0*hsl.z - q;
  return vec3(hue2rgb(p,q,hsl.x+1.0/3.0), hue2rgb(p,q,hsl.x), hue2rgb(p,q,hsl.x-1.0/3.0));
}

void main(){
  vec4 col = texture2D(u_tex, v_uv);
  vec3 c = col.rgb;
  // Lift/Gain (shadows/highlights)
  c = c * u_gain + u_lift;
  // Brightness & Contrast
  c = (c + u_brightness - 0.5) * u_contrast + 0.5;
  // Gamma
  c = pow(max(c, 0.001), vec3(1.0 / max(u_gamma, 0.01)));
  // Saturation via HSL
  vec3 hsl = rgb2hsl(c);
  hsl.y *= u_saturation;
  c = hsl2rgb(hsl);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), col.a);
}`;

const FRAG_BLUR = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_radius;
varying vec2 v_uv;
void main(){
  vec4 sum = vec4(0.0);
  int r = int(u_radius);
  float total = 0.0;
  for(int x = -8; x <= 8; x++){
    for(int y = -8; y <= 8; y++){
      float w = exp(-float(x*x+y*y)/(2.0*u_radius*u_radius+0.001));
      sum += texture2D(u_tex, v_uv + vec2(float(x),float(y))*u_texel) * w;
      total += w;
    }
  }
  gl_FragColor = sum / total;
}`;

const FRAG_TRANSFORM = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_center;
uniform vec2 u_scale;
uniform float u_rotation;
varying vec2 v_uv;
void main(){
  vec2 uv = v_uv - u_center;
  float c = cos(-u_rotation), s = sin(-u_rotation);
  uv = vec2(uv.x*c - uv.y*s, uv.x*s + uv.y*c);
  uv /= u_scale;
  uv += u_center;
  if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){
    gl_FragColor = vec4(0.0);
  } else {
    gl_FragColor = texture2D(u_tex, uv);
  }
}`;

const FRAG_CHROMA_KEY = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec3 u_keyColor;
uniform float u_similarity;
uniform float u_smoothness;
uniform float u_spill;
varying vec2 v_uv;
void main(){
  vec4 col = texture2D(u_tex, v_uv);
  float d = distance(col.rgb, u_keyColor);
  float alpha = smoothstep(u_similarity - u_smoothness, u_similarity + u_smoothness, d);
  // Spill suppression
  vec3 c = col.rgb;
  if(u_keyColor.g > u_keyColor.r && u_keyColor.g > u_keyColor.b){
    c.g = min(c.g, (c.r + c.b) * 0.5 + u_spill);
  } else if(u_keyColor.b > u_keyColor.r && u_keyColor.b > u_keyColor.g){
    c.b = min(c.b, (c.r + c.g) * 0.5 + u_spill);
  }
  gl_FragColor = vec4(c, col.a * alpha);
}`;

const FRAG_VIGNETTE = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_radius;
uniform float u_softness;
uniform float u_opacity;
varying vec2 v_uv;
void main(){
  vec4 col = texture2D(u_tex, v_uv);
  vec2 uv = v_uv - 0.5;
  float d = length(uv) / u_radius;
  float vign = smoothstep(1.0 - u_softness, 1.0, d);
  col.rgb = mix(col.rgb, col.rgb * (1.0 - vign * u_opacity), 1.0);
  gl_FragColor = col;
}`;

const FRAG_GLOW = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_radius;
uniform float u_strength;
varying vec2 v_uv;
void main(){
  vec4 base = texture2D(u_tex, v_uv);
  vec4 blur = vec4(0.0);
  float total = 0.0;
  for(int x = -6; x <= 6; x++){
    for(int y = -6; y <= 6; y++){
      float w = exp(-float(x*x+y*y)/(2.0*u_radius*u_radius+0.001));
      blur += texture2D(u_tex, v_uv + vec2(float(x),float(y))*u_texel) * w;
      total += w;
    }
  }
  blur /= total;
  gl_FragColor = base + blur * u_strength;
}`;

const FRAG_LUMA_KEY = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_low;
uniform float u_high;
varying vec2 v_uv;
void main(){
  vec4 col = texture2D(u_tex, v_uv);
  float luma = dot(col.rgb, vec3(0.299, 0.587, 0.114));
  float alpha = smoothstep(u_low, u_high, luma);
  gl_FragColor = vec4(col.rgb, col.a * alpha);
}`;

const FRAG_INVERT = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_invertR;
uniform float u_invertG;
uniform float u_invertB;
uniform float u_invertA;
varying vec2 v_uv;
void main(){
  vec4 c = texture2D(u_tex, v_uv);
  gl_FragColor = vec4(
    mix(c.r, 1.0-c.r, u_invertR),
    mix(c.g, 1.0-c.g, u_invertG),
    mix(c.b, 1.0-c.b, u_invertB),
    mix(c.a, 1.0-c.a, u_invertA)
  );
}`;

const FRAG_FILM_GRAIN = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_amount;
uniform float u_time;
varying vec2 v_uv;
float rand(vec2 co){ return fract(sin(dot(co.xy+u_time,vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec4 col = texture2D(u_tex, v_uv);
  float noise = (rand(v_uv) - 0.5) * u_amount;
  gl_FragColor = vec4(clamp(col.rgb + noise, 0.0, 1.0), col.a);
}`;

const FRAG_SHARPEN = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_strength;
varying vec2 v_uv;
void main(){
  vec4 c  = texture2D(u_tex, v_uv);
  vec4 tl = texture2D(u_tex, v_uv + vec2(-u_texel.x, -u_texel.y));
  vec4 tr = texture2D(u_tex, v_uv + vec2( u_texel.x, -u_texel.y));
  vec4 bl = texture2D(u_tex, v_uv + vec2(-u_texel.x,  u_texel.y));
  vec4 br = texture2D(u_tex, v_uv + vec2( u_texel.x,  u_texel.y));
  vec4 lap = c*4.0 - tl - tr - bl - br;
  gl_FragColor = clamp(c + lap * u_strength, 0.0, 1.0);
}`;

const FRAG_DISSOLVE_BLEND = `
precision mediump float;
uniform sampler2D u_texA;
uniform sampler2D u_texB;
uniform float u_blend;
varying vec2 v_uv;
void main(){
  vec4 a = texture2D(u_texA, v_uv);
  vec4 b = texture2D(u_texB, v_uv);
  gl_FragColor = mix(a, b, u_blend);
}`;

const FRAG_LETTERBOX = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_barHeight;
varying vec2 v_uv;
void main(){
  if(v_uv.y < u_barHeight || v_uv.y > 1.0 - u_barHeight){
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    gl_FragColor = texture2D(u_tex, v_uv);
  }
}`;

// ── Blend mode index map ──────────────────────────────────────────────────────
const BLEND_MODE_INDEX: Record<string, number> = {
  Normal: 0, Add: 1, Multiply: 2, Screen: 3, Overlay: 4,
  "Soft Light": 5, "Hard Light": 6, Difference: 7, Exclusion: 8,
  Darken: 9, Lighten: 10, "Color Dodge": 11, "Color Burn": 12,
};

// ── WebGL helpers ─────────────────────────────────────────────────────────────
function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error("Shader compile error: " + gl.getShaderInfoLog(s));
  }
  return s;
}

function createProgram(gl: WebGLRenderingContext, fragSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error("Program link error: " + gl.getProgramInfoLog(prog));
  }
  return prog;
}

function createFBO(gl: WebGLRenderingContext, w: number, h: number): { fb: WebGLFramebuffer; tex: WebGLTexture } {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex };
}

// ── FBO Pool ──────────────────────────────────────────────────────────────────
class FBOPool {
  private available: Array<{ fb: WebGLFramebuffer; tex: WebGLTexture }> = [];
  constructor(private gl: WebGLRenderingContext, private w: number, private h: number) {}

  acquire(): { fb: WebGLFramebuffer; tex: WebGLTexture } {
    return this.available.pop() ?? createFBO(this.gl, this.w, this.h);
  }

  release(fbo: { fb: WebGLFramebuffer; tex: WebGLTexture }): void {
    this.available.push(fbo);
  }

  dispose(): void {
    for (const fbo of this.available) {
      this.gl.deleteFramebuffer(fbo.fb);
      this.gl.deleteTexture(fbo.tex);
    }
    this.available = [];
  }
}

// ── Full-screen quad ──────────────────────────────────────────────────────────
function drawQuad(gl: WebGLRenderingContext, prog: WebGLProgram, vbo: WebGLBuffer): void {
  const loc = gl.getAttribLocation(prog, "a_pos");
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.disableVertexAttribArray(loc);
}

// ── Parameter helpers ─────────────────────────────────────────────────────────
function pVal(node: CompNode, key: string, def: number): number {
  const p = node.params[key];
  if (!p) return def;
  const v = p.value;
  return typeof v === "number" ? v : def;
}
function pColor(node: CompNode, key: string, def: [number,number,number,number]): [number,number,number,number] {
  const p = node.params[key];
  if (!p || !Array.isArray(p.value)) return def;
  const v = p.value as number[];
  return [v[0]??0, v[1]??0, v[2]??0, v[3]??1];
}
function pString(node: CompNode, key: string, def: string): string {
  const p = node.params[key];
  if (!p) return def;
  const v = p.value;
  return typeof v === "string" ? v : def;
}

// ── Main CompRenderer class ───────────────────────────────────────────────────

export class CompRenderer {
  private gl: WebGLRenderingContext;
  private programs: Map<string, WebGLProgram> = new Map();
  private pool!: FBOPool;
  private vbo!: WebGLBuffer;
  // Texture cache: nodeId -> { tex, dirty }
  private texCache: Map<string, { tex: WebGLTexture; version: number }> = new Map();
  // Video element cache for MediaIn nodes
  private videoCache: Map<string, HTMLVideoElement> = new Map();
  private w: number;
  private h: number;
  private frameTime = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { premultipliedAlpha: false, alpha: true });
    if (!gl) throw new Error("WebGL not available");
    this.gl = gl;
    this.w = canvas.width;
    this.h = canvas.height;
    this.init();
  }

  private init(): void {
    const gl = this.gl;
    // Full-screen quad
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    // Compile all programs
    this.programs.set("passthrough",    createProgram(gl, FRAG_PASSTHROUGH));
    this.programs.set("background",     createProgram(gl, FRAG_BACKGROUND));
    this.programs.set("merge",          createProgram(gl, FRAG_MERGE));
    this.programs.set("colorCorrector", createProgram(gl, FRAG_COLOR_CORRECTOR));
    this.programs.set("blur",           createProgram(gl, FRAG_BLUR));
    this.programs.set("transform",      createProgram(gl, FRAG_TRANSFORM));
    this.programs.set("chromaKey",      createProgram(gl, FRAG_CHROMA_KEY));
    this.programs.set("vignette",       createProgram(gl, FRAG_VIGNETTE));
    this.programs.set("glow",           createProgram(gl, FRAG_GLOW));
    this.programs.set("lumaKey",        createProgram(gl, FRAG_LUMA_KEY));
    this.programs.set("invert",         createProgram(gl, FRAG_INVERT));
    this.programs.set("filmGrain",      createProgram(gl, FRAG_FILM_GRAIN));
    this.programs.set("sharpen",        createProgram(gl, FRAG_SHARPEN));
    this.programs.set("dissolve",       createProgram(gl, FRAG_DISSOLVE_BLEND));
    this.programs.set("letterbox",      createProgram(gl, FRAG_LETTERBOX));

    // FBO pool
    this.pool = new FBOPool(gl, this.w, this.h);

    // Enable blending
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Resize internal textures when canvas size changes */
  resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.pool.dispose();
    this.pool = new FBOPool(this.gl, w, h);
    this.texCache.clear();
  }

  /** Set current frame time for animated parameters (e.g. film grain) */
  setFrameTime(t: number): void { this.frameTime = t; }

  /** Register a video element for MediaIn nodes */
  registerVideo(nodeId: string, video: HTMLVideoElement): void {
    this.videoCache.set(nodeId, video);
  }

  /** Mark a node's texture as dirty so it gets re-evaluated */
  invalidateNode(nodeId: string): void {
    this.texCache.delete(nodeId);
  }

  /** Render graph to the bound canvas */
  render(graph: CompGraph): void {
    const gl = this.gl;
    const sorted = topoSort(graph);
    const nodeTextures = new Map<string, WebGLTexture>();

    // Helper: get input texture for a port
    const getInputTex = (nodeId: string, portId: string): WebGLTexture | null => {
      const wire = graph.wires.find(w => w.toNodeId === nodeId && w.toPortId === portId);
      if (!wire) return null;
      return nodeTextures.get(wire.fromNodeId) ?? null;
    };

    for (const node of sorted) {
      const fbo = this.pool.acquire();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
      gl.viewport(0, 0, this.w, this.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      this.renderNode(node, graph, getInputTex, gl, fbo);
      nodeTextures.set(node.id, fbo.tex);
    }

    // Final output: find MediaOut node and blit to screen
    const mediaOut = sorted.find(n => n.type === "MediaOut");
    if (mediaOut) {
      const outTex = getInputTex(mediaOut.id, "in");
      if (outTex) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.w, this.h);
        const prog = this.programs.get("passthrough")!;
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, outTex);
        gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);
        drawQuad(gl, prog, this.vbo);
      }
    }

    // Release all temporary FBOs (except screen output)
    for (const [nodeId, tex] of nodeTextures) {
      const fbo = sorted.find(n => n.id === nodeId);
      if (fbo) {
        // We can't easily release here without tracking fbo objects separately.
        // In production you'd maintain a nodeId -> fbo map.
      }
    }
  }

  private renderNode(
    node: CompNode,
    graph: CompGraph,
    getInputTex: (nodeId: string, portId: string) => WebGLTexture | null,
    gl: WebGLRenderingContext,
    fbo: { fb: WebGLFramebuffer; tex: WebGLTexture }
  ): void {
    const type = node.type as CompNodeType;

    switch (type) {
      case "MediaIn": {
        const video = this.videoCache.get(node.id);
        if (video && video.readyState >= 2) {
          const tex = gl.createTexture()!;
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          // Blit to FBO
          const prog = this.programs.get("passthrough")!;
          gl.useProgram(prog);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);
          drawQuad(gl, prog, this.vbo);
          gl.deleteTexture(tex);
        } else {
          // Black frame fallback
          gl.clearColor(0.05, 0.05, 0.05, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        break;
      }

      case "Background": {
        const col = pColor(node, "color", [0,0,0,1]);
        const prog = this.programs.get("background")!;
        gl.useProgram(prog);
        gl.uniform4f(gl.getUniformLocation(prog, "u_color"), col[0], col[1], col[2], col[3]);
        drawQuad(gl, prog, this.vbo);
        break;
      }

      case "Merge": {
        const fgTex = getInputTex(node.id, "fg");
        const bgTex = getInputTex(node.id, "bg");
        const prog = this.programs.get("merge")!;
        gl.useProgram(prog);
        const opacity = pVal(node, "opacity", 1);
        const blendStr = pString(node, "blendMode", "Normal");
        const blendIdx = BLEND_MODE_INDEX[blendStr] ?? 0;
        gl.uniform1f(gl.getUniformLocation(prog, "u_opacity"), opacity);
        gl.uniform1i(gl.getUniformLocation(prog, "u_blendMode"), blendIdx);
        if (bgTex) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, bgTex);
          gl.uniform1i(gl.getUniformLocation(prog, "u_bg"), 0);
        }
        if (fgTex) {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, fgTex);
          gl.uniform1i(gl.getUniformLocation(prog, "u_fg"), 1);
        }
        drawQuad(gl, prog, this.vbo);
        break;
      }

      case "ColorCorrector":
      case "ColorGrade":
      case "Brightness":
      case "Exposure": {
        const inTex = getInputTex(node.id, "in");
        if (!inTex) break;
        const prog = this.programs.get("colorCorrector")!;
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inTex);
        gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);
        gl.uniform1f(gl.getUniformLocation(prog, "u_brightness"), pVal(node, "brightness", 0));
        gl.uniform1f(gl.getUniformLocation(prog, "u_contrast"), pVal(node, "contrast", 1));
        gl.uniform1f(gl.getUniformLocation(prog, "u_saturation"), pVal(node, "saturation", 1));
        gl.uniform1f(gl.getUniformLocation(prog, "u_gamma"), pVal(node, "gamma", 1));
        gl.uniform1f(gl.getUniformLocation(prog, "u_lift"), pVal(node, "lift", 0));
        gl.uniform1f(gl.getUniformLocation(prog, "u_gain"), pVal(node, "gain", 1));
        drawQuad(gl, prog, this.vbo);
        break;
      }

      case "Blur":
      case "DirectionalBlur":
      case "GlowBlur":
      case "Defocus": {
        const inTex = getInputTex(node.id, "in");
        if (!inTex) break;
        const prog = this.programs.get("blur")!;
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inTex);
        gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);
        gl.uniform2f(gl.getUniformLocation(prog, "u_texel"), 1/this.w, 1/this.h);
        gl.uniform1f(gl.getUniformLocation(prog, "u_radius"), pVal(node, "radius", 2));
        drawQuad(gl, prog, this.vbo);
        break;
      }

      case "Transform":
      case "DVE": {
        const inTex = getInputTex(node.id, "in");
        if (!inTex) break;
        const prog = this.programs.get("transform")!;
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inTex);
        gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);
        gl.uniform2f(gl.getUniformLocation(prog, "u_center"), pVal(node, "centerX", 0.5), pVal(node, "centerY", 0.5));
        gl.uniform2f(gl.getUniformLocation(prog, "u_scale"), pVal(node, "sizeX", 1), pVal(node, "sizeY", 1));
        gl.uniform1f(gl.getUniformLocation(prog, "u_rotation"), pVal(node, "rotation", 0));
        drawQuad(gl, prog, this.vbo);
        break;
      }

      case "ChromaKeyer":
      case "DeltaKeyer":
      case "Primatte": {
        const inTex = getInputTex(node.id, "in");
        if (!inTex) break;
        const prog = this.programs.get("chromaKey")!;
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inTex);
        gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);
        const kc = pColor(node, "keyColor", [0,1,0,1]);
        gl.uniform3f(gl.getUniformLocation(prog, "u_keyColor"), kc[0], kc[1], kc[2]);
        gl.uniform1f(gl.getUniformLocation(prog, "u_similarity"), pVal(node, "similarity", 0.3));
        gl.uniform1f(gl.getUniformLocation(prog, "u_smoothness"), pVal(node, "smoothness", 0.1));
        gl.uniform1f(gl.getUniformLocation(prog, "u_spill"), pVal(node, "spillSuppression", 0.1));
        drawQuad(gl, prog, this.vbo);
        break;
      }

      case "LumaKeyer": {
        const inTex = getInputTex(node.id, "in");
        if (!inTex) break;
        const prog = this.programs.get("lumaKey")!;
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inTex);
        gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);
        gl.uniform1f(gl.getUniformLocation(prog, "u_low"), pVal(node, "low", 0.1));
        gl.uniform1f(gl.getUniformLocation(prog, "u_high"), pVal(node, "high", 0.9));
        drawQuad(gl, prog, this.vbo);
        break;
      }

      case "Vignette": {
        const inTex = getInputTex(node.id, "in");
        if (!inTex) break;
        const prog = this.programs.get("vignette")!;
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inTex);
        gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);
        gl.uniform1f(gl.getUniformLocation(prog, "u_radius"), pVal(node, "radius", 0.7));
        gl.uniform1f(gl.getUniformLocation(prog, "u_softness"), pVal(node, "softness", 0.5));
        gl.uniform1f(gl.getUniformLocation(prog, "u_opacity"), pVal(node, "opacity", 0.8));
        drawQuad(gl, prog, this.vbo);
        break;
      }

      case "Glow":
      case "Lens Flare": {
        const inTex = getInputTex(node.id, "in");
        if (!inTex) break;
        const prog = this.programs.get("glow")!;
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inTex);
        gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);
        gl.uniform2f(gl.getUniformLocation(prog, "u_texel"), 1/this.w, 1/this.h);
        gl.uniform1f(gl.getUniformLocation(prog, "u_radius"), pVal(node, "radius", 4));
        gl.uniform1f(gl.getUniformLocation(prog, "u_strength"), pVal(node, "strength", 1));
        drawQuad(gl, prog, this.vbo);
        break;
      }

      case "Invert": {
        const inTex = getInputTex(node.id, "in");
        if (!inTex) break;
        const prog = this.programs.get("invert")!;
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inTex);
        gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);
        gl.uniform1f(gl.getUniformLocation(prog, "u_invertR"), pVal(node, "r", 1));
        gl.uniform1f(gl.getUniformLocation(prog, "u_invertG"), pVal(node, "g", 1));
        gl.uniform1f(gl.getUniformLocation(prog, "u_invertB"), pVal(node, "b", 1));
        gl.uniform1f(gl.getUniformLocation(prog, "u_invertA"), pVal(node, "a", 0));
        drawQuad(gl, prog, this.vbo);
        break;
      }

      case "FilmGrain": {
        const inTex = getInputTex(node.id, "in");
        if (!inTex) break;
        const prog = this.programs.get("filmGrain")!;
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inTex);
        gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);
        gl.uniform1f(gl.getUniformLocation(prog, "u_amount"), pVal(node, "amount", 0.05));
        gl.uniform1f(gl.getUniformLocation(prog, "u_time"), this.frameTime * 0.1);
        drawQuad(gl, prog, this.vbo);
        break;
      }

      case "Sharpen": {
        const inTex = getInputTex(node.id, "in");
        if (!inTex) break;
        const prog = this.programs.get("sharpen")!;
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inTex);
        gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);
        gl.uniform2f(gl.getUniformLocation(prog, "u_texel"), 1/this.w, 1/this.h);
        gl.uniform1f(gl.getUniformLocation(prog, "u_strength"), pVal(node, "strength", 0.5));
        drawQuad(gl, prog, this.vbo);
        break;
      }

      case "Dissolve": {
        const texA = getInputTex(node.id, "inA");
        const texB = getInputTex(node.id, "inB");
        if (!texA || !texB) break;
        const prog = this.programs.get("dissolve")!;
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texA);
        gl.uniform1i(gl.getUniformLocation(prog, "u_texA"), 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texB);
        gl.uniform1i(gl.getUniformLocation(prog, "u_texB"), 1);
        gl.uniform1f(gl.getUniformLocation(prog, "u_blend"), pVal(node, "blend", 0.5));
        drawQuad(gl, prog, this.vbo);
        break;
      }

      case "Letterbox": {
        const inTex = getInputTex(node.id, "in");
        if (!inTex) break;
        const prog = this.programs.get("letterbox")!;
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inTex);
        gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);
        const barH = pVal(node, "barHeight", 0.1);
        gl.uniform1f(gl.getUniformLocation(prog, "u_barHeight"), barH);
        drawQuad(gl, prog, this.vbo);
        break;
      }

      case "SpillSuppressor": {
        // Use chroma key shader but only for spill suppression
        const inTex = getInputTex(node.id, "in");
        if (!inTex) break;
        const prog = this.programs.get("chromaKey")!;
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inTex);
        gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);
        const kc = pColor(node, "keyColor", [0,1,0,1]);
        gl.uniform3f(gl.getUniformLocation(prog, "u_keyColor"), kc[0], kc[1], kc[2]);
        gl.uniform1f(gl.getUniformLocation(prog, "u_similarity"), 0);
        gl.uniform1f(gl.getUniformLocation(prog, "u_smoothness"), 0.001);
        gl.uniform1f(gl.getUniformLocation(prog, "u_spill"), pVal(node, "spill", 0.2));
        drawQuad(gl, prog, this.vbo);
        break;
      }

      // Pass-through nodes (Crop, Resize, Hue, WhiteBalance, Threshold, ChannelBooleans,
      //                     EllipseMask, RectangleMask, BezierMask, Note, PipeRouter,
      //                     MatteControl, RotoPaint, ChromaticAberration, Emboss,
      //                     EdgeDetect, Checkerboard, Loader, Noise, Text+, Shape,
      //                     MultiMerge, ChannelMerge, WandMask, PlanarTracker,
      //                     pEmitter, pKill, pBounce, pGravity, pTurbulence, pRender,
      //                     Camera3D, Light, ImagePlane, Shape3D, Renderer3D,
      //                     ShadowCaster, Switch, Switcher, Saver, TimeSpeed,
      //                     TimeStretcher, Delay, Custom, Expression, LUT,
      //                     Curves, Hue, MediaOut, CornerPin)
      default: {
        const inTex = getInputTex(node.id, "in") ??
                      getInputTex(node.id, "fg") ??
                      getInputTex(node.id, "bg");
        if (!inTex) break;
        const prog = this.programs.get("passthrough")!;
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inTex);
        gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);
        drawQuad(gl, prog, this.vbo);
        break;
      }
    }
  }

  dispose(): void {
    this.pool.dispose();
    const gl = this.gl;
    for (const prog of this.programs.values()) {
      gl.deleteProgram(prog);
    }
    gl.deleteBuffer(this.vbo);
  }
}
