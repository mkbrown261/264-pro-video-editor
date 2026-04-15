// src/shared/compositing.ts
// Complete data model for the 264 Pro Fusion / Compositing page
// NodeFX — node-based visual compositor

// ── Node Types ────────────────────────────────────────────────────────────────

export type CompNodeType =
  // SOURCE NODES (no inputs, produce media)
  | "MediaIn"           // pulls a clip frame from the timeline
  | "Background"        // solid color or gradient frame generator
  | "Text+"             // rich text generator with animation path
  | "Shape"             // vector shape (rect/ellipse/poly/star)
  | "Particle"          // particle system emitter
  | "Noise"             // procedural noise (Perlin/Simplex/Worley/Fractal)
  | "Checkerboard"      // test pattern / calibration
  | "Loader"            // static image or PNG sequence loader
  // COLOR NODES
  | "ColorCorrector"    // full LGG + hue/sat/lum + curves (master + shadows/mids/highs)
  | "ColorGrade"        // lift/gamma/gain wheels (integrates with existing system)
  | "Hue"               // hue rotation + hue range band targeting
  | "Brightness"        // brightness/contrast/gamma
  | "Curves"            // bezier curve per channel (Master/R/G/B/A)
  | "LUT"               // apply .cube 3D LUT with intensity blend
  | "WhiteBalance"      // temperature + tint + strength
  | "Exposure"          // EV stops (multiplies luminance by 2^EV)
  | "Invert"            // invert per-channel (R/G/B/A)
  | "Threshold"         // posterize — pixels above level = white
  | "ChannelBooleans"   // route RGBA channels arbitrarily
  // TRANSFORM NODES
  | "Transform"         // position/scale/rotation/pivot/flip/edges
  | "Crop"              // crop with per-edge feather, keep canvas option
  | "Resize"            // change resolution (bilinear/bicubic/lanczos)
  | "Letterbox"         // add letterbox bars for format change
  | "DVE"               // 3D DVE: perspective/spin/tilt card transform
  | "Corner Pin"        // 4-point corner pin (screen replacement)
  // MERGE / COMPOSITE NODES
  | "Merge"             // composite Foreground over Background + 27 blend modes
  | "MultiMerge"        // stack unlimited layers in one node
  | "Dissolve"          // blend between A and B by alpha float 0-1
  | "ChannelMerge"      // combine R/G/B/A from different sources
  // MASK NODES
  | "EllipseMask"       // soft-edge ellipse mask
  | "RectangleMask"     // rounded rectangle mask
  | "BezierMask"        // freehand bezier polygon mask
  | "WandMask"          // color-range selection mask
  | "PlanarTracker"     // flat surface tracker for mask attachment
  | "RotoPaint"         // frame-by-frame paint / roto
  | "MatteControl"      // clean/grow/blur/erode keyer matte
  // BLUR / SHARPEN NODES
  | "Blur"              // Gaussian / radial / directional blur
  | "DirectionalBlur"   // motion blur in direction+angle
  | "Sharpen"           // unsharp mask sharpen
  | "Defocus"           // optical defocus simulation
  | "GlowBlur"          // bloom/glow via dual-pass blur
  // EFFECT NODES
  | "FilmGrain"         // animated per-frame noise grain
  | "ChromaticAberration" // RGB channel split
  | "Vignette"          // radial darkening overlay
  | "Lens Flare"        // optical lens flare generator
  | "Glow"              // high-pass bloom
  | "Emboss"            // relief / emboss
  | "EdgeDetect"        // edge detection filter
  // KEYING NODES
  | "ChromaKeyer"       // green/blue screen keyer
  | "LumaKeyer"         // key on brightness channel
  | "DeltaKeyer"        // professional per-pixel chroma key
  | "Primatte"          // Primatte-style keyer
  | "SpillSuppressor"   // remove chroma spill after key
  // PARTICLE NODES
  | "pEmitter"          // particle emitter (position/rate/velocity)
  | "pKill"             // kill particles by region
  | "pBounce"           // physics bounce floor/ceiling
  | "pGravity"          // gravity force field
  | "pTurbulence"       // turbulence noise force
  | "pRender"           // render particles to image output
  // 3D NODES
  | "Camera3D"          // perspective camera
  | "Light"             // point/spot/ambient light
  | "ImagePlane"        // 2D image as 3D plane in scene
  | "Shape3D"           // 3D primitive (cube/sphere/plane/cylinder/torus/cone)
  | "Renderer3D"        // render 3D scene to 2D image
  | "ShadowCaster"      // shadow projection
  // UTILITY NODES
  | "MediaOut"          // final output of the graph
  | "Pipe Router"       // pass-through for wire organisation
  | "Note"              // annotation / comment node
  | "Switch"            // A/B switch by value or keyframe
  | "Switcher"          // multi-input selector
  | "Saver"             // export specific node output to file
  | "TimeSpeed"         // retime clip playback speed
  | "TimeStretcher"     // time-based frame blending
  | "Delay"             // delay input by N frames
  | "Custom"            // user-written GLSL fragment shader node
  | "Expression"        // math expression evaluator node
  // ALIASES / EXTENDED TYPES
  | "XF"                // crossfade/dissolve between two inputs
  | "CrossDissolve"     // explicit cross-dissolve alias
  | "TextPlus"          // alias for Text+ (for code that uses no special chars)
  | "FishEye"           // fisheye / barrel lens distortion
  | "fishEye"           // lowercase alias
  | "lensDistortion";   // generic lens distortion alias

// ── Node category (for header colour + picker grouping) ───────────────────────

export type CompNodeCategory =
  | "Source" | "Color" | "Transform" | "Merge"
  | "Mask" | "Keying" | "Effect" | "Blur" | "Particle" | "3D" | "Utility";

export const NODE_CATEGORY_COLORS: Record<CompNodeCategory, string> = {
  Source:    "#1A4A1A",
  Color:     "#3A2500",
  Transform: "#003A3A",
  Merge:     "#001A4A",
  Mask:      "#2A0040",
  Keying:    "#1A0030",
  Effect:    "#3A0030",
  Blur:      "#2A1A00",
  Particle:  "#1A2A3A",
  "3D":      "#2A2000",
  Utility:   "#1A1A1A",
};

// Per-node type → category color for display purposes
export const NODE_TYPE_CATEGORY: Partial<Record<CompNodeType, CompNodeCategory>> = {};

// Port type → wire/dot color
export type CompPortKind = "image" | "mask" | "point3d" | "camera" | "number" | "geometry" | "particles";

export const PORT_TYPE_COLORS: Record<CompPortKind, string> = {
  image:     "#f5c542",
  mask:      "#5baef5",
  point3d:   "#c8a0e0",
  camera:    "#a0d0a0",
  number:    "#f0f0f0",
  geometry:  "#e8885a",
  particles: "#78d87c",
};

export function getNodeCategory(type: CompNodeType): CompNodeCategory {
  if (["MediaIn","Background","Text+","Shape","Particle","Noise","Checkerboard","Loader"].includes(type)) return "Source";
  if (["ColorCorrector","ColorGrade","Hue","Brightness","Curves","LUT","WhiteBalance","Exposure","Invert","Threshold","ChannelBooleans"].includes(type)) return "Color";
  if (["Transform","Crop","Resize","Letterbox","DVE","Corner Pin"].includes(type)) return "Transform";
  if (["Merge","MultiMerge","Dissolve","ChannelMerge"].includes(type)) return "Merge";
  if (["EllipseMask","RectangleMask","BezierMask","WandMask","PlanarTracker","RotoPaint","MatteControl"].includes(type)) return "Mask";
  if (["ChromaKeyer","LumaKeyer","DeltaKeyer","Primatte","SpillSuppressor"].includes(type)) return "Keying";
  if (["FilmGrain","ChromaticAberration","Vignette","Lens Flare","Glow","Emboss","EdgeDetect"].includes(type)) return "Effect";
  if (["Blur","DirectionalBlur","Sharpen","Defocus","GlowBlur"].includes(type)) return "Blur";
  if (["pEmitter","pKill","pBounce","pGravity","pTurbulence","pRender"].includes(type)) return "Particle";
  if (["Camera3D","Light","ImagePlane","Shape3D","Renderer3D","ShadowCaster"].includes(type)) return "3D";
  return "Utility";
}

export const NODE_DESCRIPTIONS: Partial<Record<CompNodeType, string>> = {
  MediaIn:    "Pull a clip frame from the timeline",
  Background: "Solid color or gradient frame",
  "Text+":    "Rich text with animation path",
  Shape:      "Vector shape generator",
  Noise:      "Procedural noise texture",
  Particle:   "Particle system emitter",
  Checkerboard: "Test pattern",
  Loader:     "Static image or image sequence",
  ColorCorrector: "Full LGG + hue/sat/lum curves",
  Hue:        "Hue rotation and band targeting",
  Brightness: "Brightness / contrast / gamma",
  Curves:     "Bezier curve per RGBA channel",
  LUT:        "Apply a .cube 3D LUT",
  WhiteBalance: "Temperature + tint correction",
  Exposure:   "EV stop exposure adjustment",
  Invert:     "Invert channels",
  Threshold:  "Posterize / threshold",
  ChannelBooleans: "Route RGBA channels",
  Transform:  "Position / scale / rotation / flip",
  Crop:       "Crop with per-edge feather",
  Resize:     "Change output resolution",
  Letterbox:  "Add letterbox bars",
  DVE:        "3D perspective card transform",
  "Corner Pin": "4-point corner pin warp",
  Merge:      "Composite A over B — 27 blend modes",
  MultiMerge: "Stack unlimited layers",
  Dissolve:   "Blend A and B by alpha amount",
  ChannelMerge: "Combine channels from different sources",
  EllipseMask: "Soft-edge ellipse mask",
  RectangleMask: "Rounded rectangle mask",
  BezierMask: "Freehand bezier polygon mask",
  WandMask:   "Color-range selection mask",
  MatteControl: "Clean/grow/blur matte",
  ChromaKeyer: "Green/blue screen key",
  LumaKeyer:  "Key by brightness",
  DeltaKeyer: "Professional per-pixel chroma key",
  SpillSuppressor: "Remove chroma spill",
  Blur:       "Gaussian / radial / directional blur",
  DirectionalBlur: "Motion blur by angle",
  Sharpen:    "Unsharp mask sharpen",
  Defocus:    "Optical defocus simulation",
  GlowBlur:   "Bloom / glow dual-pass",
  FilmGrain:  "Animated film grain noise",
  ChromaticAberration: "RGB channel split",
  Vignette:   "Radial darkening overlay",
  Glow:       "High-pass bloom",
  Emboss:     "Relief / emboss effect",
  EdgeDetect: "Edge detection filter",
  pEmitter:   "Particle emitter",
  pGravity:   "Gravity force field",
  pTurbulence:"Turbulence noise force",
  pRender:    "Render particles to image",
  Camera3D:   "Perspective camera",
  ImagePlane: "2D image as 3D plane",
  Shape3D:    "3D primitive geometry",
  Renderer3D: "Render 3D scene to image",
  MediaOut:   "Final composited output",
  Custom:     "User-written GLSL shader",
  Expression: "Math expression node",
  Note:       "Annotation / comment",
  Switch:     "A/B switch by value/keyframe",
};

// ── Port types ────────────────────────────────────────────────────────────────

export type CompPortType = "image" | "mask" | "number" | "point2d" | "color" | "3d";

export const PORT_COLORS: Record<CompPortType, string> = {
  image:   "#d4d4d4",
  mask:    "#e05555",
  number:  "#44cc44",
  point2d: "#44cccc",
  color:   "#ee8833",
  "3d":    "#ccaa22",
};

export interface CompPort {
  id: string;
  name: string;          // "Input", "Background", "Foreground", "Mask", "Output"
  type: CompPortType;
  direction: "in" | "out";
  required: boolean;
}

// ── Parameter types ───────────────────────────────────────────────────────────

export type CompParamType =
  | "number" | "integer" | "boolean" | "color"
  | "point2d" | "point3d" | "string" | "enum" | "curve";

export interface CompKeyframe {
  frame: number;
  value: unknown;
  easing: "linear" | "easeIn" | "easeOut" | "easeInOut" | "step";
}

export interface CompParam {
  type: CompParamType;
  value: unknown;
  keyframes: CompKeyframe[];
  expression: string | null;   // JS math expression — overrides value when set
  min?: number;
  max?: number;
  step?: number;
  options?: string[];           // for enum type
  label?: string;
  group?: string;               // collapsible group name
}

// ── Node instance ─────────────────────────────────────────────────────────────

/** Phase 8: Node rendering role in the color page node graph */
export type CompNodeRole = 'serial' | 'parallel' | 'layer';

export interface CompNode {
  id: string;
  type: CompNodeType;
  label: string;               // user-editable display name
  x: number;                   // canvas position (px)
  y: number;
  width: number;               // default 160
  collapsed: boolean;
  bypassed: boolean;           // pass input through unchanged
  selected: boolean;
  params: Record<string, CompParam>;
  ports: CompPort[];
  color: string | null;        // user-set header colour override
  thumbnailDataUrl?: string;   // 80×45 live preview (updated by renderer)
  /** Phase 8: parallel nodes blend their grade with upstream using screen mode */
  nodeRole?: CompNodeRole;
}

// ── Wire (connection) ─────────────────────────────────────────────────────────

export interface CompWire {
  id: string;
  fromNodeId: string;
  fromPortId: string;
  toNodeId: string;
  toPortId: string;
}

// ── The complete graph ────────────────────────────────────────────────────────

export interface CompGraph {
  id: string;
  clipId: string;          // which TimelineClip owns this graph
  nodes: CompNode[];
  wires: CompWire[];
  frameWidth: number;
  frameHeight: number;
  fps: number;
}

// ── Helper: create a default parameter ───────────────────────────────────────

export function mkParam(
  type: CompParamType,
  value: unknown,
  opts: Partial<Omit<CompParam, "type" | "value">> = {}
): CompParam {
  return { type, value, keyframes: [], expression: null, ...opts };
}

// ── Default port definitions for each node type ───────────────────────────────

export function getDefaultPorts(type: CompNodeType): CompPort[] {
  const inp = (id: string, name: string, t: CompPortType = "image", required = true): CompPort =>
    ({ id, name, type: t, direction: "in", required });
  const out = (id: string, name: string, t: CompPortType = "image"): CompPort =>
    ({ id, name, type: t, direction: "out", required: false });

  switch (type) {
    // Source — no inputs
    case "MediaIn":      return [out("out", "Output")];
    case "Background":   return [out("out", "Output")];
    case "Text+":        return [out("out", "Output")];
    case "Shape":        return [out("out", "Output"), out("mask_out", "Mask", "mask")];
    case "Noise":        return [out("out", "Output")];
    case "Particle":     return [out("out", "Output")];
    case "Checkerboard": return [out("out", "Output")];
    case "Loader":       return [out("out", "Output")];
    // Color
    case "ColorCorrector": return [inp("in", "Input"), inp("mask", "Mask", "mask", false), out("out", "Output")];
    case "ColorGrade":     return [inp("in", "Input"), inp("mask", "Mask", "mask", false), out("out", "Output")];
    case "Hue":            return [inp("in", "Input"), out("out", "Output")];
    case "Brightness":     return [inp("in", "Input"), out("out", "Output")];
    case "Curves":         return [inp("in", "Input"), out("out", "Output")];
    case "LUT":            return [inp("in", "Input"), out("out", "Output")];
    case "WhiteBalance":   return [inp("in", "Input"), out("out", "Output")];
    case "Exposure":       return [inp("in", "Input"), out("out", "Output")];
    case "Invert":         return [inp("in", "Input"), out("out", "Output")];
    case "Threshold":      return [inp("in", "Input"), out("out", "Output")];
    case "ChannelBooleans":return [inp("in", "Input"), out("out", "Output")];
    // Transform
    case "Transform":    return [inp("in", "Input"), inp("mask", "Mask", "mask", false), out("out", "Output")];
    case "Crop":         return [inp("in", "Input"), out("out", "Output")];
    case "Resize":       return [inp("in", "Input"), out("out", "Output")];
    case "Letterbox":    return [inp("in", "Input"), out("out", "Output")];
    case "DVE":          return [inp("in", "Input"), out("out", "Output")];
    case "Corner Pin":   return [inp("in", "Input"), out("out", "Output")];
    // Merge
    case "Merge":        return [inp("fg", "Foreground"), inp("bg", "Background"), inp("mask", "Mask", "mask", false), out("out", "Output")];
    case "MultiMerge":   return [inp("bg", "Background"), inp("fg1", "Layer 1"), inp("fg2", "Layer 2"), inp("fg3", "Layer 3"), out("out", "Output")];
    case "Dissolve":     return [inp("a", "A"), inp("b", "B"), out("out", "Output")];
    case "ChannelMerge": return [inp("r", "R Source"), inp("g", "G Source"), inp("b", "B Source"), inp("a", "A Source"), out("out", "Output")];
    // Mask
    case "EllipseMask":    return [inp("in", "Input", "image", false), out("mask_out", "Mask", "mask")];
    case "RectangleMask":  return [inp("in", "Input", "image", false), out("mask_out", "Mask", "mask")];
    case "BezierMask":     return [inp("in", "Input", "image", false), out("mask_out", "Mask", "mask")];
    case "WandMask":       return [inp("in", "Input"), out("mask_out", "Mask", "mask")];
    case "MatteControl":   return [inp("mask", "Mask", "mask"), out("mask_out", "Mask", "mask")];
    case "PlanarTracker":  return [inp("in", "Input"), out("out", "Output"), out("mask_out", "Mask", "mask")];
    case "RotoPaint":      return [inp("in", "Input"), out("out", "Output"), out("mask_out", "Mask", "mask")];
    // Blur / Sharpen
    case "Blur":           return [inp("in", "Input"), inp("mask", "Mask", "mask", false), out("out", "Output")];
    case "DirectionalBlur":return [inp("in", "Input"), out("out", "Output")];
    case "Sharpen":        return [inp("in", "Input"), out("out", "Output")];
    case "Defocus":        return [inp("in", "Input"), out("out", "Output")];
    case "GlowBlur":       return [inp("in", "Input"), out("out", "Output")];
    // Effect
    case "FilmGrain":      return [inp("in", "Input"), out("out", "Output")];
    case "ChromaticAberration": return [inp("in", "Input"), out("out", "Output")];
    case "Vignette":       return [inp("in", "Input"), out("out", "Output")];
    case "Lens Flare":     return [inp("in", "Input"), out("out", "Output")];
    case "Glow":           return [inp("in", "Input"), out("out", "Output")];
    case "Emboss":         return [inp("in", "Input"), out("out", "Output")];
    case "EdgeDetect":     return [inp("in", "Input"), out("out", "Output")];
    // Keying
    case "ChromaKeyer":    return [inp("in", "Input"), inp("bg", "Background", "image", false), out("out", "Output"), out("mask_out", "Matte", "mask")];
    case "LumaKeyer":      return [inp("in", "Input"), out("out", "Output"), out("mask_out", "Matte", "mask")];
    case "DeltaKeyer":     return [inp("in", "Input"), inp("bg", "Background", "image", false), out("out", "Output"), out("mask_out", "Matte", "mask")];
    case "Primatte":       return [inp("in", "Input"), out("out", "Output"), out("mask_out", "Matte", "mask")];
    case "SpillSuppressor":return [inp("in", "Input"), out("out", "Output")];
    // Particle
    case "pEmitter":    return [out("out", "Particles", "image")];
    case "pKill":       return [inp("in", "Particles"), out("out", "Particles")];
    case "pBounce":     return [inp("in", "Particles"), out("out", "Particles")];
    case "pGravity":    return [inp("in", "Particles"), out("out", "Particles")];
    case "pTurbulence": return [inp("in", "Particles"), out("out", "Particles")];
    case "pRender":     return [inp("in", "Particles"), out("out", "Output")];
    // 3D
    case "Camera3D":   return [out("out", "3D Output", "3d")];
    case "Light":      return [out("out", "3D Output", "3d")];
    case "ImagePlane": return [inp("in", "Image"), out("out", "3D Object", "3d")];
    case "Shape3D":    return [out("out", "3D Object", "3d")];
    case "Renderer3D": return [inp("cam", "Camera", "3d"), inp("light1", "Light", "3d", false), inp("obj1", "Object", "3d", false), out("out", "Output")];
    case "ShadowCaster":return [inp("in", "3D Scene", "3d"), out("out", "Output")];
    // Utility
    case "MediaOut":    return [inp("in", "Input")];
    case "Pipe Router": return [inp("in", "Input"), out("out", "Output")];
    case "Switch":      return [inp("a", "A"), inp("b", "B"), out("out", "Output")];
    case "Switcher":    return [inp("in1", "Input 1"), inp("in2", "Input 2"), inp("in3", "Input 3"), inp("in4", "Input 4"), out("out", "Output")];
    case "TimeSpeed":   return [inp("in", "Input"), out("out", "Output")];
    case "TimeStretcher":return [inp("in", "Input"), out("out", "Output")];
    case "Delay":       return [inp("in", "Input"), out("out", "Output")];
    case "Custom":      return [inp("in", "Input"), out("out", "Output")];
    case "Expression":  return [inp("in", "Input"), out("out", "Output")];
    case "Saver":       return [inp("in", "Input"), out("out", "Output")];
    case "Note":        return [];
    default:            return [inp("in", "Input"), out("out", "Output")];
  }
}

// ── Default parameters for each node type ────────────────────────────────────

export function getDefaultParams(type: CompNodeType): Record<string, CompParam> {
  switch (type) {
    case "MediaIn":
      return { clipId: mkParam("string", "", { label: "Clip Reference" }) };
    case "Background":
      return {
        color:  mkParam("color",  [0,0,0,1], { label: "Color", group: "Fill" }),
        type:   mkParam("enum",   "solid", { label: "Type", options: ["solid","linear","radial","conical"], group: "Fill" }),
        color2: mkParam("color",  [0.1,0.1,0.1,1], { label: "Color 2", group: "Fill" }),
        angle:  mkParam("number", 0, { label: "Angle", min: 0, max: 360, step: 1, group: "Fill" }),
      };
    case "Text+":
      return {
        text:       mkParam("string", "264 Pro", { label: "Text" }),
        fontFamily: mkParam("string", "sans-serif", { label: "Font" }),
        fontSize:   mkParam("number", 72, { label: "Size", min: 4, max: 500, step: 1 }),
        color:      mkParam("color",  [1,1,1,1], { label: "Color" }),
        alignH:     mkParam("enum",   "center", { label: "H Align", options: ["left","center","right"] }),
        alignV:     mkParam("enum",   "center", { label: "V Align", options: ["top","center","bottom"] }),
        tracking:   mkParam("number", 0,   { label: "Tracking", min: -50, max: 200, step: 1 }),
        leading:    mkParam("number", 1.2, { label: "Leading",  min: 0.5, max: 5, step: 0.05 }),
        bold:       mkParam("boolean", false, { label: "Bold" }),
        italic:     mkParam("boolean", false, { label: "Italic" }),
        outline:    mkParam("boolean", false, { label: "Outline" }),
        outlineWidth: mkParam("number", 2, { label: "Outline Width", min: 0, max: 20 }),
        outlineColor: mkParam("color",  [0,0,0,1], { label: "Outline Color" }),
        shadow:     mkParam("boolean", false, { label: "Drop Shadow" }),
        shadowX:    mkParam("number",  4, { label: "Shadow X", min: -50, max: 50 }),
        shadowY:    mkParam("number",  4, { label: "Shadow Y", min: -50, max: 50 }),
        shadowColor:mkParam("color",  [0,0,0,0.7], { label: "Shadow Color" }),
        posX:       mkParam("number", 0.5, { label: "Pos X", min: 0, max: 1, step: 0.001, group: "Position" }),
        posY:       mkParam("number", 0.5, { label: "Pos Y", min: 0, max: 1, step: 0.001, group: "Position" }),
      };
    case "Shape":
      return {
        shapeType:  mkParam("enum", "rectangle", { label: "Shape", options: ["rectangle","ellipse","polygon","star"] }),
        fill:       mkParam("color",  [1,1,1,1], { label: "Fill Color" }),
        stroke:     mkParam("color",  [0,0,0,0], { label: "Stroke Color" }),
        strokeWidth:mkParam("number", 0,   { label: "Stroke Width", min: 0, max: 50 }),
        softness:   mkParam("number", 0,   { label: "Softness", min: 0, max: 1, step: 0.01 }),
        width:      mkParam("number", 0.5, { label: "Width", min: 0, max: 2, step: 0.001, group: "Size" }),
        height:     mkParam("number", 0.5, { label: "Height", min: 0, max: 2, step: 0.001, group: "Size" }),
        posX:       mkParam("number", 0.5, { label: "Center X", min: 0, max: 1, step: 0.001, group: "Position" }),
        posY:       mkParam("number", 0.5, { label: "Center Y", min: 0, max: 1, step: 0.001, group: "Position" }),
        angle:      mkParam("number", 0,   { label: "Angle", min: -180, max: 180, step: 0.1, group: "Position" }),
        sides:      mkParam("integer", 6,  { label: "Sides (polygon)", min: 3, max: 20, group: "Shape" }),
      };
    case "Noise":
      return {
        type:    mkParam("enum",   "perlin", { label: "Type", options: ["perlin","simplex","worley","fractal"] }),
        scale:   mkParam("number", 0.5,   { label: "Scale", min: 0.01, max: 10, step: 0.01 }),
        octaves: mkParam("integer", 4,    { label: "Octaves", min: 1, max: 8 }),
        offsetX: mkParam("number", 0,     { label: "Offset X", min: -10, max: 10, step: 0.001 }),
        offsetY: mkParam("number", 0,     { label: "Offset Y", min: -10, max: 10, step: 0.001 }),
        seed:    mkParam("integer", 42,   { label: "Seed", min: 0, max: 9999 }),
        color:   mkParam("boolean", false,{ label: "Color Mode" }),
      };
    case "ColorCorrector":
      return {
        // Master
        masterLift:   mkParam("number", 0,   { label: "Lift",     min: -1,  max: 1,  step: 0.001, group: "Master" }),
        masterGamma:  mkParam("number", 1,   { label: "Gamma",    min: 0.1, max: 10, step: 0.01,  group: "Master" }),
        masterGain:   mkParam("number", 1,   { label: "Gain",     min: 0,   max: 4,  step: 0.001, group: "Master" }),
        masterHue:    mkParam("number", 0,   { label: "Hue",      min: -180,max: 180,step: 0.1,   group: "Master" }),
        masterSat:    mkParam("number", 1,   { label: "Saturation",min:0,   max: 4,  step: 0.01,  group: "Master" }),
        masterLum:    mkParam("number", 0,   { label: "Luminance",min: -1,  max: 1,  step: 0.001, group: "Master" }),
        // Shadows
        shadowLift:   mkParam("number", 0,   { label: "Shadow Lift",  min:-1,max:1, step:0.001, group:"Shadows" }),
        shadowGamma:  mkParam("number", 1,   { label: "Shadow Gamma", min:0.1,max:10,step:0.01, group:"Shadows" }),
        shadowGain:   mkParam("number", 1,   { label: "Shadow Gain",  min:0,max:4,  step:0.001, group:"Shadows" }),
        // Midtones
        midLift:      mkParam("number", 0,   { label: "Mid Lift",  min:-1,max:1,step:0.001,group:"Midtones" }),
        midGamma:     mkParam("number", 1,   { label: "Mid Gamma",min:0.1,max:10,step:0.01,group:"Midtones" }),
        midGain:      mkParam("number", 1,   { label: "Mid Gain", min:0,max:4,step:0.001,group:"Midtones" }),
        // Highlights
        hiLift:       mkParam("number", 0,   { label: "Hi Lift",  min:-1,max:1,step:0.001,group:"Highlights" }),
        hiGamma:      mkParam("number", 1,   { label: "Hi Gamma", min:0.1,max:10,step:0.01,group:"Highlights" }),
        hiGain:       mkParam("number", 1,   { label: "Hi Gain",  min:0,max:4,step:0.001,group:"Highlights" }),
      };
    case "Hue":
      return {
        hueRotation: mkParam("number", 0, { label: "Hue Rotation", min: -180, max: 180, step: 0.1 }),
        hueRange:    mkParam("number", 30, { label: "Hue Range", min: 0, max: 180, step: 1 }),
        targetHue:   mkParam("number", 0, { label: "Target Hue", min: 0, max: 360, step: 1 }),
      };
    case "Brightness":
      return {
        brightness: mkParam("number", 0,   { label: "Brightness", min: -1, max: 1, step: 0.001 }),
        contrast:   mkParam("number", 0,   { label: "Contrast",   min: -1, max: 1, step: 0.001 }),
        gamma:      mkParam("number", 1,   { label: "Gamma",      min: 0.1, max: 10, step: 0.01 }),
      };
    case "LUT":
      return {
        lutPath:    mkParam("string", "", { label: "LUT File (.cube)" }),
        intensity:  mkParam("number", 1, { label: "Intensity", min: 0, max: 1, step: 0.01 }),
      };
    case "WhiteBalance":
      return {
        temperature: mkParam("number", 0, { label: "Temperature", min: -1, max: 1, step: 0.001 }),
        tint:        mkParam("number", 0, { label: "Tint",        min: -1, max: 1, step: 0.001 }),
        strength:    mkParam("number", 1, { label: "Strength",    min: 0, max: 1, step: 0.01 }),
      };
    case "Exposure":
      return {
        ev: mkParam("number", 0, { label: "EV Stops", min: -5, max: 5, step: 0.01 }),
      };
    case "Invert":
      return {
        invertR: mkParam("boolean", true,  { label: "Invert R", group: "Channels" }),
        invertG: mkParam("boolean", true,  { label: "Invert G", group: "Channels" }),
        invertB: mkParam("boolean", true,  { label: "Invert B", group: "Channels" }),
        invertA: mkParam("boolean", false, { label: "Invert A", group: "Channels" }),
      };
    case "Threshold":
      return {
        level: mkParam("number", 0.5, { label: "Threshold Level", min: 0, max: 1, step: 0.001 }),
      };
    case "Transform":
      return {
        centerX:  mkParam("number", 0.5,  { label: "Center X", min:0, max:1, step:0.001, group:"Position" }),
        centerY:  mkParam("number", 0.5,  { label: "Center Y", min:0, max:1, step:0.001, group:"Position" }),
        pivotX:   mkParam("number", 0.5,  { label: "Pivot X",  min:0, max:1, step:0.001, group:"Pivot" }),
        pivotY:   mkParam("number", 0.5,  { label: "Pivot Y",  min:0, max:1, step:0.001, group:"Pivot" }),
        sizeX:    mkParam("number", 1,    { label: "Scale X",  min:0.01, max:10, step:0.001, group:"Scale" }),
        sizeY:    mkParam("number", 1,    { label: "Scale Y",  min:0.01, max:10, step:0.001, group:"Scale" }),
        angle:    mkParam("number", 0,    { label: "Angle",    min:-180, max:180, step:0.1, group:"Rotation" }),
        flipH:    mkParam("boolean", false,{ label: "Flip H",  group:"Flip" }),
        flipV:    mkParam("boolean", false,{ label: "Flip V",  group:"Flip" }),
        edges:    mkParam("enum",  "black",{ label: "Edges",   options:["black","wrap","reflect","smear"], group:"Edges" }),
      };
    case "Crop":
      return {
        left:   mkParam("number", 0, { label: "Left",   min:0, max:1, step:0.001 }),
        right:  mkParam("number", 0, { label: "Right",  min:0, max:1, step:0.001 }),
        top:    mkParam("number", 0, { label: "Top",    min:0, max:1, step:0.001 }),
        bottom: mkParam("number", 0, { label: "Bottom", min:0, max:1, step:0.001 }),
        feather:mkParam("number", 0, { label: "Feather", min:0, max:0.2, step:0.001 }),
      };
    case "Resize":
      return {
        width:     mkParam("integer", 1920, { label: "Width",  min:1, max:7680 }),
        height:    mkParam("integer", 1080, { label: "Height", min:1, max:4320 }),
        filter:    mkParam("enum", "bilinear", { label: "Filter", options:["nearest","bilinear","bicubic","lanczos"] }),
        keepAspect:mkParam("boolean", true, { label: "Keep Aspect" }),
      };
    case "Merge":
      return {
        blendMode: mkParam("enum", "normal", { label: "Blend Mode", options:[
          "normal","dissolve","multiply","screen","overlay","darken","lighten",
          "colorDodge","colorBurn","hardLight","softLight","difference",
          "exclusion","hue","saturation","color","luminosity",
          "add","subtract","divide","linearBurn","linearDodge",
          "vividLight","linearLight","pinLight","hardMix","reflect"
        ]}),
        opacity:   mkParam("number", 1, { label: "Opacity", min:0, max:1, step:0.01 }),
        gain:      mkParam("number", 1, { label: "FG Gain", min:0, max:4, step:0.01 }),
        subtractive:mkParam("boolean", false, { label: "Subtractive Alpha" }),
      };
    case "Dissolve":
      return {
        mix: mkParam("number", 0.5, { label: "Mix", min:0, max:1, step:0.001 }),
      };
    case "Blur":
      return {
        size:      mkParam("number", 5,   { label: "Size",    min:0, max:200, step:0.1 }),
        type:      mkParam("enum", "gaussian", { label: "Type", options:["gaussian","radial","directional"] }),
        angle:     mkParam("number", 0,   { label: "Angle",   min:0, max:360, step:1 }),
        quality:   mkParam("integer", 4,  { label: "Quality", min:1, max:8 }),
      };
    case "Sharpen":
      return {
        strength:  mkParam("number", 0.5, { label: "Strength", min:0, max:5, step:0.01 }),
        radius:    mkParam("number", 1,   { label: "Radius",   min:0.1, max:10, step:0.1 }),
        threshold: mkParam("number", 0,   { label: "Threshold",min:0, max:1, step:0.01 }),
      };
    case "GlowBlur":
      return {
        size:      mkParam("number", 10,  { label: "Glow Size",  min:0, max:200, step:0.1 }),
        intensity: mkParam("number", 0.5, { label: "Intensity",  min:0, max:4, step:0.01 }),
        threshold: mkParam("number", 0.7, { label: "Threshold",  min:0, max:1, step:0.01 }),
      };
    case "Vignette":
      return {
        intensity: mkParam("number", 0.5, { label: "Intensity", min:0, max:1, step:0.01 }),
        radius:    mkParam("number", 0.7, { label: "Radius",    min:0, max:2, step:0.01 }),
        feather:   mkParam("number", 0.4, { label: "Feather",   min:0, max:1, step:0.01 }),
        color:     mkParam("color",  [0,0,0,1], { label: "Color" }),
      };
    case "ChromaticAberration":
      return {
        amount: mkParam("number", 3, { label: "Amount", min:0, max:50, step:0.1 }),
        angle:  mkParam("number", 0, { label: "Angle",  min:0, max:360, step:1 }),
      };
    case "FilmGrain":
      return {
        intensity: mkParam("number", 0.1, { label: "Intensity", min:0, max:1, step:0.01 }),
        size:      mkParam("number", 1,   { label: "Grain Size", min:0.5, max:5, step:0.1 }),
        color:     mkParam("boolean", false, { label: "Color Grain" }),
      };
    case "Glow":
      return {
        threshold: mkParam("number", 0.7, { label: "Threshold", min:0, max:1, step:0.01 }),
        size:      mkParam("number", 15,  { label: "Size",      min:0, max:200, step:1 }),
        intensity: mkParam("number", 1,   { label: "Intensity", min:0, max:10, step:0.1 }),
      };
    case "ChromaKeyer":
      return {
        keyColor:  mkParam("color", [0,1,0,1], { label: "Key Color" }),
        tolerance: mkParam("number", 0.4, { label: "Tolerance", min:0, max:1, step:0.01 }),
        softness:  mkParam("number", 0.1, { label: "Softness",  min:0, max:1, step:0.01 }),
        spillSuppress:mkParam("number", 0.5, { label: "Spill Suppress", min:0, max:1, step:0.01 }),
        gain:      mkParam("number", 1,   { label: "Gain", min:0, max:4, step:0.01 }),
      };
    case "LumaKeyer":
      return {
        lowClip:   mkParam("number", 0,   { label: "Low Clip",  min:0, max:1, step:0.001 }),
        highClip:  mkParam("number", 1,   { label: "High Clip", min:0, max:1, step:0.001 }),
        softness:  mkParam("number", 0.05,{ label: "Softness",  min:0, max:1, step:0.001 }),
        invert:    mkParam("boolean", false, { label: "Invert" }),
      };
    case "DeltaKeyer":
      return {
        keyColor:  mkParam("color", [0,1,0,1], { label: "Key Color" }),
        tolerance: mkParam("number", 0.4, { label: "Tolerance", min:0, max:1, step:0.01 }),
        softness:  mkParam("number", 0.1, { label: "Softness",  min:0, max:1, step:0.01 }),
        preBlur:   mkParam("number", 0,   { label: "Pre-Blur",  min:0, max:10, step:0.1 }),
        fringe:    mkParam("number", 0,   { label: "Pixel Fringe", min:0, max:10, step:0.1 }),
        spillSuppress:mkParam("number", 0.5, { label: "Spill Suppress", min:0, max:1 }),
        matteThreshold:mkParam("number", 0.1, { label: "Matte Threshold", min:0, max:1, step:0.01 }),
      };
    case "SpillSuppressor":
      return {
        keyColor:   mkParam("color",  [0,1,0,1], { label: "Key Color" }),
        algorithm:  mkParam("enum", "complement", { label: "Algorithm", options:["complement","hue","saturation"] }),
        strength:   mkParam("number", 0.8, { label: "Strength",   min:0, max:1, step:0.01 }),
        saturation: mkParam("number", 0.5, { label: "Saturation", min:0, max:1, step:0.01 }),
      };
    case "MatteControl":
      return {
        grow:      mkParam("number", 0,   { label: "Grow (px)",  min:-20, max:20, step:0.1 }),
        blur:      mkParam("number", 0,   { label: "Blur (px)",  min:0, max:50, step:0.1 }),
        threshold: mkParam("number", 0.5, { label: "Threshold",  min:0, max:1, step:0.01 }),
        gamma:     mkParam("number", 1,   { label: "Gamma",      min:0.1, max:10, step:0.01 }),
        invert:    mkParam("boolean", false, { label: "Invert" }),
        erode:     mkParam("number", 0,   { label: "Erode (px)", min:0, max:20, step:0.1 }),
      };
    case "EllipseMask":
      return {
        centerX:  mkParam("number", 0.5,  { label: "Center X", min:0, max:1, step:0.001 }),
        centerY:  mkParam("number", 0.5,  { label: "Center Y", min:0, max:1, step:0.001 }),
        width:    mkParam("number", 0.5,  { label: "Width",    min:0, max:2, step:0.001 }),
        height:   mkParam("number", 0.3,  { label: "Height",   min:0, max:2, step:0.001 }),
        angle:    mkParam("number", 0,    { label: "Angle",    min:-180, max:180, step:0.1 }),
        softness: mkParam("number", 0.05, { label: "Softness", min:0, max:1, step:0.001 }),
        invert:   mkParam("boolean", false, { label: "Invert" }),
      };
    case "RectangleMask":
      return {
        centerX:  mkParam("number", 0.5,  { label: "Center X", min:0, max:1, step:0.001 }),
        centerY:  mkParam("number", 0.5,  { label: "Center Y", min:0, max:1, step:0.001 }),
        width:    mkParam("number", 0.8,  { label: "Width",    min:0, max:2, step:0.001 }),
        height:   mkParam("number", 0.6,  { label: "Height",   min:0, max:2, step:0.001 }),
        angle:    mkParam("number", 0,    { label: "Angle",    min:-180, max:180, step:0.1 }),
        softness: mkParam("number", 0,    { label: "Softness", min:0, max:1, step:0.001 }),
        radius:   mkParam("number", 0,    { label: "Corner Radius", min:0, max:0.5, step:0.001 }),
        invert:   mkParam("boolean", false, { label: "Invert" }),
      };
    case "Defocus":
      return {
        size:     mkParam("number", 5, { label: "Size",    min:0, max:100, step:0.1 }),
        quality:  mkParam("integer", 3,{ label: "Quality", min:1, max:6 }),
        useDepth: mkParam("boolean", false, { label: "Use Depth Map" }),
      };
    case "DVE":
      return {
        zRot:   mkParam("number", 0, { label: "Z Rotation",  min:-180, max:180, step:0.1, group:"Rotation" }),
        xRot:   mkParam("number", 0, { label: "X Rotation",  min:-90,  max:90,  step:0.1, group:"Rotation" }),
        yRot:   mkParam("number", 0, { label: "Y Rotation",  min:-90,  max:90,  step:0.1, group:"Rotation" }),
        xPos:   mkParam("number", 0, { label: "X Position",  min:-1,   max:1,   step:0.001, group:"Position" }),
        yPos:   mkParam("number", 0, { label: "Y Position",  min:-1,   max:1,   step:0.001, group:"Position" }),
        zPos:   mkParam("number", 0, { label: "Z Depth",     min:-2,   max:2,   step:0.001, group:"Position" }),
        persp:  mkParam("number", 0.5, { label: "Perspective", min:0, max:2, step:0.01, group:"Perspective" }),
        scale:  mkParam("number", 1,   { label: "Scale",     min:0.01, max:10, step:0.001 }),
      };
    case "Letterbox":
      return {
        aspect: mkParam("enum", "2.35:1", { label: "Aspect", options:["1.33:1","1.66:1","1.78:1","1.85:1","2.35:1","2.39:1","2.66:1"] }),
        color:  mkParam("color", [0,0,0,1], { label: "Bar Color" }),
        position:mkParam("number", 0.5, { label: "Position", min:0, max:1, step:0.001 }),
      };
    case "Corner Pin":
      return {
        tlX: mkParam("number", 0, { label: "TL X", min:-1, max:2, step:0.001, group:"Top" }),
        tlY: mkParam("number", 1, { label: "TL Y", min:-1, max:2, step:0.001, group:"Top" }),
        trX: mkParam("number", 1, { label: "TR X", min:-1, max:2, step:0.001, group:"Top" }),
        trY: mkParam("number", 1, { label: "TR Y", min:-1, max:2, step:0.001, group:"Top" }),
        blX: mkParam("number", 0, { label: "BL X", min:-1, max:2, step:0.001, group:"Bottom" }),
        blY: mkParam("number", 0, { label: "BL Y", min:-1, max:2, step:0.001, group:"Bottom" }),
        brX: mkParam("number", 1, { label: "BR X", min:-1, max:2, step:0.001, group:"Bottom" }),
        brY: mkParam("number", 0, { label: "BR Y", min:-1, max:2, step:0.001, group:"Bottom" }),
      };
    case "Switch":
      return {
        which: mkParam("enum", "a", { label: "Select", options:["a","b"] }),
      };
    case "Switcher":
      return {
        which: mkParam("integer", 1, { label: "Select Input", min:1, max:4 }),
      };
    case "TimeSpeed":
      return {
        speed: mkParam("number", 1, { label: "Speed", min:0.1, max:8, step:0.01 }),
      };
    case "Delay":
      return {
        frames: mkParam("integer", 0, { label: "Delay Frames", min:0, max:300 }),
      };
    case "Custom":
      return {
        shader: mkParam("string", "void main() { gl_FragColor = texture2D(uInput, vUv); }", { label: "GLSL Fragment Shader" }),
        param1: mkParam("number", 0, { label: "Param 1", min:-10, max:10, step:0.001 }),
        param2: mkParam("number", 0, { label: "Param 2", min:-10, max:10, step:0.001 }),
        param3: mkParam("number", 0, { label: "Param 3", min:-10, max:10, step:0.001 }),
        param4: mkParam("number", 0, { label: "Param 4", min:-10, max:10, step:0.001 }),
      };
    case "Expression":
      return {
        expr: mkParam("string", "time / fps", { label: "Expression" }),
      };
    case "Note":
      return {
        text:  mkParam("string", "Note...", { label: "Text" }),
        color: mkParam("color", [0.9,0.8,0.2,1], { label: "Color" }),
      };
    case "pEmitter":
      return {
        rate:   mkParam("number", 50, { label: "Emission Rate", min:1, max:10000, step:1 }),
        speed:  mkParam("number", 1,  { label: "Speed",    min:0, max:20, step:0.01 }),
        spread: mkParam("number", 30, { label: "Spread",   min:0, max:180, step:1 }),
        life:   mkParam("number", 2,  { label: "Life (s)", min:0.1, max:30, step:0.1 }),
        size:   mkParam("number", 5,  { label: "Size (px)", min:1, max:100, step:0.5 }),
        gravityX:mkParam("number", 0, { label: "Gravity X", min:-20, max:20, step:0.01 }),
        gravityY:mkParam("number", -2,{ label: "Gravity Y", min:-20, max:20, step:0.01 }),
        posX:   mkParam("number", 0.5,{ label: "Origin X",  min:0, max:1, step:0.001 }),
        posY:   mkParam("number", 0.5,{ label: "Origin Y",  min:0, max:1, step:0.001 }),
        color:  mkParam("color", [1,1,1,1], { label: "Color" }),
      };
    case "Camera3D":
      return {
        fov:    mkParam("number", 40,  { label: "FOV",  min:5, max:120, step:0.1 }),
        near:   mkParam("number", 0.1, { label: "Near", min:0.001, max:10 }),
        far:    mkParam("number", 1000,{ label: "Far",  min:10, max:100000 }),
        type:   mkParam("enum", "perspective", { label: "Type", options:["perspective","orthographic"] }),
        posX:   mkParam("number", 0, { label: "Pos X", min:-1000, max:1000, group:"Position" }),
        posY:   mkParam("number", 0, { label: "Pos Y", min:-1000, max:1000, group:"Position" }),
        posZ:   mkParam("number", 5, { label: "Pos Z", min:-1000, max:1000, group:"Position" }),
      };
    case "Shape3D":
      return {
        type:       mkParam("enum", "cube", { label: "Type", options:["cube","sphere","cylinder","plane","torus","cone"] }),
        sizeX:      mkParam("number", 1, { label: "Size X", min:0.01, max:100, group:"Size" }),
        sizeY:      mkParam("number", 1, { label: "Size Y", min:0.01, max:100, group:"Size" }),
        sizeZ:      mkParam("number", 1, { label: "Size Z", min:0.01, max:100, group:"Size" }),
        subdivisions:mkParam("integer", 32, { label: "Subdivisions", min:3, max:256 }),
        color:      mkParam("color", [0.8,0.8,0.8,1], { label: "Color" }),
        roughness:  mkParam("number", 0.5, { label: "Roughness", min:0, max:1, step:0.01 }),
        metalness:  mkParam("number", 0,   { label: "Metalness", min:0, max:1, step:0.01 }),
      };
    case "Renderer3D":
      return {
        bgColor:   mkParam("color", [0,0,0,0], { label: "Background" }),
        antiAlias: mkParam("boolean", true, { label: "Antialiasing" }),
        motionBlur:mkParam("boolean", false, { label: "Motion Blur" }),
        shadows:   mkParam("boolean", true,  { label: "Shadows" }),
      };
    case "ImagePlane":
      return {
        posX: mkParam("number", 0, { label: "Pos X", min:-100, max:100, group:"Position" }),
        posY: mkParam("number", 0, { label: "Pos Y", min:-100, max:100, group:"Position" }),
        posZ: mkParam("number", 0, { label: "Pos Z", min:-100, max:100, group:"Position" }),
        rotX: mkParam("number", 0, { label: "Rot X", min:-180, max:180, group:"Rotation" }),
        rotY: mkParam("number", 0, { label: "Rot Y", min:-180, max:180, group:"Rotation" }),
        rotZ: mkParam("number", 0, { label: "Rot Z", min:-180, max:180, group:"Rotation" }),
        scaleX:mkParam("number",1, { label: "Scale X", min:0.01, max:100, group:"Scale" }),
        scaleY:mkParam("number",1, { label: "Scale Y", min:0.01, max:100, group:"Scale" }),
        receiveShadow:mkParam("boolean", true, { label: "Receive Shadow" }),
        castShadow:   mkParam("boolean", true, { label: "Cast Shadow" }),
      };
    default:
      return {};
  }
}

// ── Create a node with defaults ───────────────────────────────────────────────

let _nodeCounter = 1;

export function createNode(
  type: CompNodeType,
  x = 200,
  y = 200,
  overrides: Partial<CompNode> = {}
): CompNode {
  const label = `${type}${_nodeCounter++}`;
  return {
    id: `node_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    label,
    x,
    y,
    width: type === "Note" ? 200 : 160,
    collapsed: false,
    bypassed: false,
    selected: false,
    params: getDefaultParams(type),
    ports: getDefaultPorts(type),
    color: null,
    ...overrides,
  };
}

// ── Create a default graph (MediaIn → MediaOut) ───────────────────────────────

export function createDefaultGraph(clipId: string, frameWidth = 1920, frameHeight = 1080, fps = 30): CompGraph {
  const mediaIn  = createNode("MediaIn",  100, 200, { label: "MediaIn1" });
  const mediaOut = createNode("MediaOut", 380, 200, { label: "MediaOut1" });

  // Wire MediaIn output to MediaOut input
  const wire: CompWire = {
    id: `wire_${Date.now()}`,
    fromNodeId: mediaIn.id,
    fromPortId: "out",
    toNodeId:   mediaOut.id,
    toPortId:   "in",
  };

  return {
    id: `graph_${Date.now()}`,
    clipId,
    nodes: [mediaIn, mediaOut],
    wires: [wire],
    frameWidth,
    frameHeight,
    fps,
  };
}

// ── Topological sort ──────────────────────────────────────────────────────────

export function topoSort(graph: CompGraph): CompNode[] {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>(); // nodeId -> list of downstream nodeIds

  for (const n of graph.nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }

  for (const w of graph.wires) {
    inDegree.set(w.toNodeId, (inDegree.get(w.toNodeId) ?? 0) + 1);
    adj.get(w.fromNodeId)?.push(w.toNodeId);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: CompNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) sorted.push(node);
    for (const nextId of (adj.get(id) ?? [])) {
      const newDeg = (inDegree.get(nextId) ?? 1) - 1;
      inDegree.set(nextId, newDeg);
      if (newDeg === 0) queue.push(nextId);
    }
  }

  return sorted;
}

// ── Template library ──────────────────────────────────────────────────────────

export interface CompTemplate {
  id: string;
  name: string;
  description: string;
  thumbnail?: string;
  create: (clipId: string, w: number, h: number, fps: number) => CompGraph;
}

export const BUILT_IN_TEMPLATES: CompTemplate[] = [
  {
    id: "pass",
    name: "Clean Composite",
    description: "MediaIn + Transform + Merge over Background",
    create: (clipId, w, h, fps) => {
      const mediaIn   = createNode("MediaIn",   100, 200, { label: "MediaIn1" });
      const transform = createNode("Transform", 320, 200, { label: "Transform1" });
      const bg        = createNode("Background",100, 370, { label: "Background1" });
      const merge     = createNode("Merge",     540, 280, { label: "Merge1" });
      const mediaOut  = createNode("MediaOut",  760, 280, { label: "MediaOut1" });
      const wires: CompWire[] = [
        { id: "w1", fromNodeId: mediaIn.id,   fromPortId: "out", toNodeId: transform.id, toPortId: "in" },
        { id: "w2", fromNodeId: transform.id, fromPortId: "out", toNodeId: merge.id,     toPortId: "fg" },
        { id: "w3", fromNodeId: bg.id,        fromPortId: "out", toNodeId: merge.id,     toPortId: "bg" },
        { id: "w4", fromNodeId: merge.id,     fromPortId: "out", toNodeId: mediaOut.id,  toPortId: "in" },
      ];
      return { id: `g_${Date.now()}`, clipId, nodes: [mediaIn, transform, bg, merge, mediaOut], wires, frameWidth: w, frameHeight: h, fps };
    },
  },
  {
    id: "greenscreen",
    name: "Green Screen",
    description: "ChromaKeyer + SpillSuppressor + Merge over background",
    create: (clipId, w, h, fps) => {
      const mediaIn  = createNode("MediaIn",  100, 200, { label: "MediaIn1" });
      const keyer    = createNode("ChromaKeyer", 320, 200, { label: "ChromaKeyer1" });
      const spill    = createNode("SpillSuppressor", 540, 200, { label: "SpillSuppressor1" });
      const bg       = createNode("Background", 100, 370, { label: "Background1" });
      const merge    = createNode("Merge",    760, 280, { label: "Merge1" });
      const out      = createNode("MediaOut", 980, 280, { label: "MediaOut1" });
      const wires: CompWire[] = [
        { id: "w1", fromNodeId: mediaIn.id, fromPortId: "out", toNodeId: keyer.id,  toPortId: "in" },
        { id: "w2", fromNodeId: keyer.id,   fromPortId: "out", toNodeId: spill.id,  toPortId: "in" },
        { id: "w3", fromNodeId: spill.id,   fromPortId: "out", toNodeId: merge.id,  toPortId: "fg" },
        { id: "w4", fromNodeId: bg.id,      fromPortId: "out", toNodeId: merge.id,  toPortId: "bg" },
        { id: "w5", fromNodeId: merge.id,   fromPortId: "out", toNodeId: out.id,    toPortId: "in" },
      ];
      return { id: `g_${Date.now()}`, clipId, nodes:[mediaIn,keyer,spill,bg,merge,out], wires, frameWidth:w,frameHeight:h,fps };
    },
  },
  {
    id: "pip",
    name: "Picture in Picture",
    description: "Two MediaIn + Transform + Merge",
    create: (clipId, w, h, fps) => {
      const m1  = createNode("MediaIn",  100, 150, { label: "MediaIn1" });
      const m2  = createNode("MediaIn",  100, 300, { label: "MediaIn2" });
      const t2  = createNode("Transform",320, 300, { label: "Transform1" });
      const merge= createNode("Merge",   540, 220, { label: "Merge1" });
      const out = createNode("MediaOut", 760, 220, { label: "MediaOut1" });
      t2.params.sizeX = mkParam("number", 0.35, { min:0.01, max:10 });
      t2.params.sizeY = mkParam("number", 0.35, { min:0.01, max:10 });
      t2.params.centerX = mkParam("number", 0.75, { min:0, max:1 });
      t2.params.centerY = mkParam("number", 0.25, { min:0, max:1 });
      const wires: CompWire[] = [
        { id: "w1", fromNodeId: m1.id,   fromPortId: "out", toNodeId: merge.id, toPortId: "bg" },
        { id: "w2", fromNodeId: m2.id,   fromPortId: "out", toNodeId: t2.id,    toPortId: "in" },
        { id: "w3", fromNodeId: t2.id,   fromPortId: "out", toNodeId: merge.id, toPortId: "fg" },
        { id: "w4", fromNodeId: merge.id,fromPortId: "out", toNodeId: out.id,   toPortId: "in" },
      ];
      return { id:`g_${Date.now()}`, clipId, nodes:[m1,m2,t2,merge,out], wires, frameWidth:w,frameHeight:h,fps };
    },
  },
  {
    id: "lowerthird",
    name: "Lower Third",
    description: "MediaIn + Background + Text+ + Merge",
    create: (clipId, w, h, fps) => {
      const m1  = createNode("MediaIn",   100, 150, { label: "MediaIn1" });
      const bg  = createNode("Background",100, 300, { label: "Background1" });
      const txt = createNode("Text+",     320, 300, { label: "Text1" });
      const m   = createNode("Merge",     540, 210, { label: "Merge1" });
      const out = createNode("MediaOut",  760, 210, { label: "MediaOut1" });
      txt.params.posY = mkParam("number", 0.82, { min:0, max:1 });
      txt.params.text = mkParam("string", "Your Name Here");
      bg.params.color = mkParam("color", [0.05,0.05,0.05,0.85]);
      const wires: CompWire[] = [
        { id:"w1", fromNodeId:m1.id, fromPortId:"out", toNodeId:m.id, toPortId:"bg" },
        { id:"w2", fromNodeId:bg.id, fromPortId:"out", toNodeId:txt.id, toPortId:"in" },
        { id:"w3", fromNodeId:txt.id, fromPortId:"out", toNodeId:m.id, toPortId:"fg" },
        { id:"w4", fromNodeId:m.id, fromPortId:"out", toNodeId:out.id, toPortId:"in" },
      ];
      return { id:`g_${Date.now()}`, clipId, nodes:[m1,bg,txt,m,out], wires, frameWidth:w,frameHeight:h,fps };
    },
  },
  {
    id: "vignette_glow",
    name: "Vignette Glow",
    description: "MediaIn + Vignette + Glow + Merge",
    create: (clipId, w, h, fps) => {
      const m = createNode("MediaIn",   100, 200, { label:"MediaIn1" });
      const v = createNode("Vignette",  320, 200, { label:"Vignette1" });
      const g = createNode("Glow",      540, 200, { label:"Glow1" });
      const o = createNode("MediaOut",  760, 200, { label:"MediaOut1" });
      const wires: CompWire[] = [
        { id:"w1", fromNodeId:m.id, fromPortId:"out", toNodeId:v.id, toPortId:"in" },
        { id:"w2", fromNodeId:v.id, fromPortId:"out", toNodeId:g.id, toPortId:"in" },
        { id:"w3", fromNodeId:g.id, fromPortId:"out", toNodeId:o.id, toPortId:"in" },
      ];
      return { id:`g_${Date.now()}`, clipId, nodes:[m,v,g,o], wires, frameWidth:w,frameHeight:h,fps };
    },
  },
  {
    id: "cinematic_bars",
    name: "Cinematic Bars",
    description: "MediaIn + Letterbox + ColorCorrector",
    create: (clipId, w, h, fps) => {
      const m  = createNode("MediaIn",  100, 200, { label:"MediaIn1" });
      const lb = createNode("Letterbox",320, 200, { label:"Letterbox1" });
      const cc = createNode("ColorCorrector",540, 200, { label:"ColorCorrector1" });
      const o  = createNode("MediaOut", 760, 200, { label:"MediaOut1" });
      const wires: CompWire[] = [
        { id:"w1", fromNodeId:m.id, fromPortId:"out", toNodeId:lb.id, toPortId:"in" },
        { id:"w2", fromNodeId:lb.id,fromPortId:"out", toNodeId:cc.id, toPortId:"in" },
        { id:"w3", fromNodeId:cc.id,fromPortId:"out", toNodeId:o.id,  toPortId:"in" },
      ];
      return { id:`g_${Date.now()}`, clipId, nodes:[m,lb,cc,o], wires, frameWidth:w,frameHeight:h,fps };
    },
  },
];
