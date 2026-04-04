// src/renderer/components/compositing/NodeCanvas.tsx
// Infinite-canvas node editor for the Fusion compositing page
// Supports: pan, zoom, node drag, wire drawing, multi-select, context menu

import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import type {
  CompGraph,
  CompNode,
  CompWire,
  CompNodeType,
  CompNodeCategory,
} from "../../../shared/compositing";
import {
  NODE_CATEGORY_COLORS,
  PORT_TYPE_COLORS,
  getDefaultPorts,
  createNode,
} from "../../../shared/compositing";

// ── Constants ─────────────────────────────────────────────────────────────────
const NODE_W = 160;
const NODE_H = 58;
const PORT_R = 5;
const PORT_SPACING = 14;
const GRID_SIZE = 20;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4.0;

// ── Node type list for Add Node menu ─────────────────────────────────────────
const ADD_NODE_CATEGORIES: { category: CompNodeCategory; types: CompNodeType[] }[] = [
  {
    category: "Source",
    types: ["MediaIn", "Background", "Text+", "Shape", "Noise", "Checkerboard", "Loader"],
  },
  {
    category: "Color",
    types: ["ColorCorrector", "ColorGrade", "Hue", "Brightness", "Curves", "LUT", "WhiteBalance", "Exposure", "Invert", "Threshold", "ChannelBooleans"],
  },
  {
    category: "Transform",
    types: ["Transform", "Crop", "Resize", "Letterbox", "DVE", "Corner Pin"],
  },
  {
    category: "Merge",
    types: ["Merge", "MultiMerge", "Dissolve", "ChannelMerge"],
  },
  {
    category: "Mask",
    types: ["EllipseMask", "RectangleMask", "BezierMask", "WandMask", "PlanarTracker", "RotoPaint", "MatteControl"],
  },
  {
    category: "Blur",
    types: ["Blur", "DirectionalBlur", "Sharpen", "Defocus", "GlowBlur"],
  },
  {
    category: "Effect",
    types: ["FilmGrain", "ChromaticAberration", "Vignette", "Lens Flare", "Glow", "Emboss", "EdgeDetect"],
  },
  {
    category: "Keying",
    types: ["ChromaKeyer", "LumaKeyer", "DeltaKeyer", "Primatte", "SpillSuppressor"],
  },
  {
    category: "Particle",
    types: ["pEmitter", "pKill", "pBounce", "pGravity", "pTurbulence", "pRender"],
  },
  {
    category: "3D",
    types: ["Camera3D", "Light", "ImagePlane", "Shape3D", "Renderer3D", "ShadowCaster"],
  },
  {
    category: "Utility",
    types: ["MediaOut", "Pipe Router", "Note", "Switch", "Switcher", "Saver", "TimeSpeed", "TimeStretcher", "Delay", "Custom", "Expression"],
  },
];

// ── Port position helpers ─────────────────────────────────────────────────────
function getPortPos(
  node: CompNode,
  portId: string,
  isInput: boolean
): { x: number; y: number } {
  const ports = isInput ? node.ports.filter(p => p.direction === "in") : node.ports.filter(p => p.direction === "out");
  const idx = ports.findIndex(p => p.id === portId);
  const total = ports.length;
  const x = isInput ? node.x : node.x + NODE_W;
  const y = node.y + NODE_H / 2 + (idx - (total - 1) / 2) * PORT_SPACING;
  return { x, y };
}

// ── Wire path ─────────────────────────────────────────────────────────────────
function wirePath(
  x1: number, y1: number, x2: number, y2: number
): string {
  const dx = Math.abs(x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

// ── Node descriptions for right-click tooltip ─────────────────────────────────
const NODE_DESCRIPTIONS: Partial<Record<string, string>> = {
  "MediaIn":          "Reads the source video/image clip from the timeline into the node graph.",
  "MediaOut":         "Outputs the composited result back to the timeline clip.",
  "Background":       "Generates a solid colour or gradient background layer.",
  "Text+":            "Advanced text and title generator with animatable parameters.",
  "Shape":            "Procedural geometric shape generator (rectangle, ellipse, polygon).",
  "Noise":            "Generates animated noise patterns for textures and mattes.",
  "ColorCorrector":   "Primary colour correction: lift/gamma/gain, sat, hue, contrast.",
  "ColorGrade":       "Secondary colour grading with curves and qualifier isolation.",
  "Hue":              "Shifts, rotates or saturates specific hue ranges.",
  "Brightness":       "Adjusts overall brightness and contrast.",
  "Curves":           "Per-channel tone curve adjustment (RGB and master).",
  "LUT":              "Applies a Look-Up Table colour transform (.cube / .3dl).",
  "WhiteBalance":     "Corrects colour temperature and tint.",
  "Exposure":         "Adjusts exposure in stops (linear light).",
  "Invert":           "Inverts colour channels.",
  "Threshold":        "Converts image to black & white based on luminance threshold.",
  "Transform":        "Position, rotation, scale and shear with sub-pixel accuracy.",
  "Crop":             "Crops the image to a rectangular region.",
  "Resize":           "Resamples the image to a different resolution.",
  "Letterbox":        "Adds letterbox/pillarbox bars to change aspect ratio.",
  "DVE":              "3D-style digital video effect (perspective, rotation, shear).",
  "Corner Pin":       "Maps the image to four corner control points.",
  "Merge":            "Alpha-composite two images using standard blend modes.",
  "MultiMerge":       "Composites multiple layers onto a single output.",
  "Dissolve":         "Cross-dissolves between two images using a mix value.",
  "ChannelMerge":     "Combines individual R/G/B/A channels from separate inputs.",
  "EllipseMask":      "Draws an elliptical matte/mask.",
  "RectangleMask":    "Draws a rectangular matte/mask.",
  "BezierMask":       "Draw a freehand bezier spline mask/roto.",
  "WandMask":         "Smart selection mask based on colour similarity.",
  "PlanarTracker":    "2D planar motion tracker for corner-pin and roto assistance.",
  "RotoPaint":        "Frame-by-frame paint and roto with a built-in brush.",
  "MatteControl":     "Expands, contracts, blurs and combines matte channels.",
  "Blur":             "Gaussian blur with independent H/V control.",
  "DirectionalBlur":  "Motion/directional blur at any angle.",
  "Sharpen":          "Unsharp mask or high-frequency sharpen.",
  "Defocus":          "Camera lens defocus simulation with bokeh shapes.",
  "GlowBlur":         "Bloom/glow effect built from a layered blur.",
  "FilmGrain":        "Adds photographic film grain noise.",
  "ChromaticAberration": "Splits RGB channels to simulate lens chromatic aberration.",
  "Vignette":         "Darkens edges to simulate a lens vignette.",
  "Lens Flare":       "Procedural or image-based lens flare.",
  "Glow":             "Soft additive glow around bright areas.",
  "Emboss":           "Surface emboss / relief effect.",
  "EdgeDetect":       "Extracts edges as a luminance matte.",
  "ChromaKeyer":      "Green-screen / blue-screen chroma key with spill suppression.",
  "LumaKeyer":        "Keys based on luminance (light or dark areas).",
  "DeltaKeyer":       "Advanced difference matte keyer for studio setups.",
  "Primatte":         "Industry-standard multi-spill chroma key algorithm.",
  "SpillSuppressor":  "Removes green/blue spill from a keyed subject.",
  "pEmitter":         "Particle system emitter — birth rate, velocity, spread.",
  "pKill":            "Kills particles that enter a defined region.",
  "pBounce":          "Particle deflector/bounce plane.",
  "pGravity":         "Applies gravitational acceleration to particles.",
  "pTurbulence":      "Adds turbulent wind noise to particle motion.",
  "pRender":          "Renders the particle system to an image output.",
  "Camera3D":         "3D perspective camera for 3D scenes.",
  "Light":            "Directional, point or spot light for 3D rendering.",
  "ImagePlane":       "Maps a 2D image onto a 3D plane or surface.",
  "Shape3D":          "Procedural 3D primitive (cube, sphere, cylinder…).",
  "Renderer3D":       "Renders 3D geometry and lights to a 2D output.",
  "ShadowCaster":     "Casts shadows from 3D objects onto other surfaces.",
  "Pipe Router":      "Invisible routing node — organises wires without processing.",
  "Note":             "Non-processing annotation/comment node.",
  "Switch":           "Routes one of two inputs based on a boolean value.",
  "Switcher":         "Routes one of N inputs based on an integer index.",
  "Saver":            "Saves the image stream to disk as an image sequence.",
  "TimeSpeed":        "Retime / speed-change the image stream.",
  "TimeStretcher":    "Smooth optical-flow retiming for speed ramping.",
  "Delay":            "Delays the image stream by N frames.",
  "Custom":           "Custom shader / expression node.",
  "Expression":       "Evaluates a mathematical expression on channel values.",
  "ChannelBooleans":  "Boolean operations on individual RGBA channels.",
};

// ── Category header color ─────────────────────────────────────────────────────
function catColor(node: CompNode): string {
  // Use NODE_CATEGORY_COLORS if available
  const map: Record<string, string> = {
    Source: "#3a6ea5", Color: "#7e57c2", Transform: "#2e7d32",
    Merge: "#e65100", Mask: "#0277bd", Keying: "#6a1b9a",
    Effect: "#ad1457", Blur: "#00838f", Particle: "#558b2f",
    "3D": "#4e342e", Utility: "#37474f",
  };
  const cat = (NODE_CATEGORY_COLORS as Record<string, string>)[node.type] ?? "";
  return (map as Record<string,string>)[cat] ?? map["Utility"];
}

// ── Props ─────────────────────────────────────────────────────────────────────
export interface NodeCanvasProps {
  graph: CompGraph;
  selectedNodeIds: string[];
  onSelectNodes: (ids: string[]) => void;
  onUpdateGraph: (graph: CompGraph) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
const NodeCanvas: React.FC<NodeCanvasProps> = ({
  graph,
  selectedNodeIds,
  onSelectNodes,
  onUpdateGraph,
  onNodeDoubleClick,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 80, y: 80 });
  const [zoom, setZoom] = useState(1.0);
  const [isPanning, setIsPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  // BUG 3B: Space key held tracking for space+drag pan
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Wire-in-progress state
  const [wire, setWire] = useState<{
    fromNodeId: string; fromPortId: string;
    x1: number; y1: number; x2: number; y2: number;
  } | null>(null);

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null);

  // Add-node picker
  const [addMenu, setAddMenu] = useState<{ x: number; y: number; wx: number; wy: number } | null>(null);
  const [addSearch, setAddSearch] = useState("");

  // Drag state
  const dragRef = useRef<{ nodeId: string; ox: number; oy: number; startX: number; startY: number } | null>(null);

  // Lasso selection
  const lassoRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [lasso, setLasso] = useState<typeof lassoRef.current>(null);

  // Copy/paste clipboard
  const clipboard = useRef<CompNode[]>([]);

  // ── Canvas coordinate transforms ──────────────────────────────────────────
  const toCanvas = useCallback((cx: number, cy: number) => ({
    x: (cx - pan.x) / zoom,
    y: (cy - pan.y) / zoom,
  }), [pan, zoom]);

  const toScreen = useCallback((wx: number, wy: number) => ({
    x: wx * zoom + pan.x,
    y: wy * zoom + pan.y,
  }), [pan, zoom]);

  // ── Fit to view ───────────────────────────────────────────────────────────
  const fitToView = useCallback(() => {
    if (!containerRef.current || graph.nodes.length === 0) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of graph.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W);
      maxY = Math.max(maxY, n.y + NODE_H);
    }
    const padding = 60;
    const fw = width / (maxX - minX + padding * 2);
    const fh = height / (maxY - minY + padding * 2);
    const newZoom = Math.min(fw, fh, MAX_ZOOM);
    setZoom(newZoom);
    setPan({
      x: width / 2 - ((minX + maxX) / 2) * newZoom,
      y: height / 2 - ((minY + maxY) / 2) * newZoom,
    });
  }, [graph.nodes]);

  // ── Wheel / scroll handling ───────────────────────────────────────────────
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Ctrl/Meta+wheel = zoom around cursor (most important gesture)
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.12 : 0.9;
      setZoom(z => {
        const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor));
        setPan(p => ({
          x: mx - (mx - p.x) * (nz / z),
          y: my - (my - p.y) * (nz / z),
        }));
        return nz;
      });
      return;
    }

    // Shift+wheel = force horizontal pan
    if (e.shiftKey) {
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      setPan(p => ({ x: p.x - delta * 1.2, y: p.y }));
      return;
    }

    // Trackpad two-finger pan (deltaX present) — pan in both axes
    if (Math.abs(e.deltaX) > 2) {
      setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      return;
    }

    // Plain vertical scroll:
    // - If it looks like a mouse wheel (large discrete steps) → zoom
    // - If it looks like a trackpad (small steps) → pan vertically
    const isMouseWheel = Math.abs(e.deltaY) >= 100 || e.deltaMode === 1;
    if (isMouseWheel) {
      // Mouse wheel = zoom (DaVinci style)
      const factor = e.deltaY < 0 ? 1.12 : 0.9;
      setZoom(z => {
        const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor));
        setPan(p => ({
          x: mx - (mx - p.x) * (nz / z),
          y: my - (my - p.y) * (nz / z),
        }));
        return nz;
      });
    } else {
      // Trackpad single-finger scroll = pan vertically
      setPan(p => ({ x: p.x, y: p.y - e.deltaY }));
    }
  }, []);

  // ── Mouse events ──────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (ctxMenu) { setCtxMenu(null); return; }
    if (addMenu) { setAddMenu(null); setAddSearch(""); return; }

    const rect = containerRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = (mx - pan.x) / zoom;
    const wy = (my - pan.y) / zoom;

    // BUG 3B: Middle-click, Alt+drag, or Space+drag = pan
    if (e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && spaceHeld)) {
      setIsPanning(true);
      panStart.current = { mx, my, px: pan.x, py: pan.y };
      e.preventDefault();
      return;
    }

    if (e.button === 0) {
      // Check if clicking on empty canvas → lasso
      lassoRef.current = { x1: wx, y1: wy, x2: wx, y2: wy };
      setLasso({ x1: wx, y1: wy, x2: wx, y2: wy });
    }
  }, [ctxMenu, addMenu, pan, zoom, spaceHeld]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (isPanning) {
      setPan({
        x: panStart.current.px + (mx - panStart.current.mx),
        y: panStart.current.py + (my - panStart.current.my),
      });
      return;
    }

    if (dragRef.current) {
      // BUG 3A: Correct drag offset using getBoundingClientRect-based world coords.
      // ox/oy = click position within node (in world coords), so:
      //   newNodePos = currentMouseWorld - clickOffset
      const wx = (mx - pan.x) / zoom;
      const wy = (my - pan.y) / zoom;
      const rawX = wx - dragRef.current.ox;
      const rawY = wy - dragRef.current.oy;
      const snappedX = Math.round(rawX / GRID_SIZE) * GRID_SIZE;
      const snappedY = Math.round(rawY / GRID_SIZE) * GRID_SIZE;
      onUpdateGraph({
        ...graph,
        nodes: graph.nodes.map(n =>
          n.id === dragRef.current!.nodeId
            ? { ...n, x: snappedX, y: snappedY }
            : n
        ),
      });
      return;
    }

    if (wire) {
      setWire(w => w ? { ...w, x2: mx, y2: my } : null);
      return;
    }

    if (lassoRef.current) {
      const wx = (mx - pan.x) / zoom;
      const wy = (my - pan.y) / zoom;
      lassoRef.current.x2 = wx;
      lassoRef.current.y2 = wy;
      setLasso({ ...lassoRef.current });
    }
  }, [isPanning, dragRef, wire, pan, zoom, graph, onUpdateGraph]);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if (isPanning) { setIsPanning(false); return; }

    if (dragRef.current) {
      dragRef.current = null;
      return;
    }

    if (lassoRef.current) {
      const l = lassoRef.current;
      const minX = Math.min(l.x1, l.x2);
      const maxX = Math.max(l.x1, l.x2);
      const minY = Math.min(l.y1, l.y2);
      const maxY = Math.max(l.y1, l.y2);
      if (maxX - minX > 5 || maxY - minY > 5) {
        // Select nodes in lasso
        const selected = graph.nodes.filter(n =>
          n.x < maxX && n.x + NODE_W > minX && n.y < maxY && n.y + NODE_H > minY
        ).map(n => n.id);
        onSelectNodes(selected);
      } else {
        onSelectNodes([]);
      }
      lassoRef.current = null;
      setLasso(null);
    }
  }, [isPanning, graph.nodes, onSelectNodes]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    setCtxMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }, []);

  // ── Node events ───────────────────────────────────────────────────────────
  const onNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Select
    if (e.shiftKey) {
      onSelectNodes(
        selectedNodeIds.includes(nodeId)
          ? selectedNodeIds.filter(id => id !== nodeId)
          : [...selectedNodeIds, nodeId]
      );
    } else if (!selectedNodeIds.includes(nodeId)) {
      onSelectNodes([nodeId]);
    }

    // BUG 3A: Record precise offset from node's top-left corner using getBoundingClientRect
    const rect = containerRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Convert click to world coords
    const wx = (mx - pan.x) / zoom;
    const wy = (my - pan.y) / zoom;
    // Offset = click position inside the node (in world space)
    const ox = wx - node.x;
    const oy = wy - node.y;

    dragRef.current = {
      nodeId,
      ox,   // offset of click from node's left edge in world coords
      oy,   // offset of click from node's top edge in world coords
      startX: node.x,
      startY: node.y,
    };
  }, [graph.nodes, selectedNodeIds, onSelectNodes, pan, zoom]);

  const onNodeContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current!.getBoundingClientRect();
    setCtxMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, nodeId });
    if (!selectedNodeIds.includes(nodeId)) onSelectNodes([nodeId]);
  }, [selectedNodeIds, onSelectNodes]);

  const onNodeDblClick = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    onNodeDoubleClick?.(nodeId);
  }, [onNodeDoubleClick]);

  // ── Port events (start/end wire) ──────────────────────────────────────────
  const onPortMouseDown = useCallback((
    e: React.MouseEvent,
    nodeId: string,
    portId: string,
    isOutput: boolean,
  ) => {
    e.stopPropagation();
    if (!isOutput) return; // Only start wire from output ports
    const node = graph.nodes.find(n => n.id === nodeId)!;
    const pos = getPortPos(node, portId, false);
    const sp = toScreen(pos.x, pos.y);
    setWire({ fromNodeId: nodeId, fromPortId: portId, x1: sp.x, y1: sp.y, x2: sp.x, y2: sp.y });
  }, [graph.nodes, toScreen]);

  const onPortMouseUp = useCallback((
    e: React.MouseEvent,
    nodeId: string,
    portId: string,
    isInput: boolean,
  ) => {
    e.stopPropagation();
    if (!wire || !isInput) { setWire(null); return; }

    // Avoid self-connection
    if (wire.fromNodeId === nodeId) { setWire(null); return; }

    // Remove any existing wire to this input port
    const newWires = graph.wires.filter(
      w => !(w.toNodeId === nodeId && w.toPortId === portId)
    );

    const newWire: CompWire = {
      id: `w_${Date.now()}`,
      fromNodeId: wire.fromNodeId,
      fromPortId: wire.fromPortId,
      toNodeId: nodeId,
      toPortId: portId,
    };
    onUpdateGraph({ ...graph, wires: [...newWires, newWire] });
    setWire(null);
  }, [wire, graph, onUpdateGraph]);

  // Cancel wire on mouse-up on canvas
  const onSvgMouseUp = useCallback(() => {
    if (wire) setWire(null);
  }, [wire]);

  // ── Context menu actions ──────────────────────────────────────────────────
  const deleteSelected = useCallback(() => {
    const toDelete = new Set(selectedNodeIds);
    onUpdateGraph({
      ...graph,
      nodes: graph.nodes.filter(n => !toDelete.has(n.id)),
      wires: graph.wires.filter(w => !toDelete.has(w.fromNodeId) && !toDelete.has(w.toNodeId)),
    });
    onSelectNodes([]);
    setCtxMenu(null);
  }, [selectedNodeIds, graph, onUpdateGraph, onSelectNodes]);

  const duplicateSelected = useCallback(() => {
    const toDup = graph.nodes.filter(n => selectedNodeIds.includes(n.id));
    const newNodes = toDup.map(n => ({
      ...n,
      id: `n_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      x: n.x + 30,
      y: n.y + 30,
      label: n.label + " copy",
    }));
    onUpdateGraph({ ...graph, nodes: [...graph.nodes, ...newNodes] });
    onSelectNodes(newNodes.map(n => n.id));
    setCtxMenu(null);
  }, [selectedNodeIds, graph, onUpdateGraph, onSelectNodes]);

  const copySelected = useCallback(() => {
    clipboard.current = graph.nodes.filter(n => selectedNodeIds.includes(n.id));
    setCtxMenu(null);
  }, [selectedNodeIds, graph.nodes]);

  const pasteClipboard = useCallback(() => {
    const newNodes = clipboard.current.map(n => ({
      ...n,
      id: `n_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      x: n.x + 40,
      y: n.y + 40,
    }));
    onUpdateGraph({ ...graph, nodes: [...graph.nodes, ...newNodes] });
    onSelectNodes(newNodes.map(n => n.id));
    setCtxMenu(null);
  }, [graph, onUpdateGraph, onSelectNodes]);

  const disconnectWires = useCallback((nodeId: string) => {
    onUpdateGraph({
      ...graph,
      wires: graph.wires.filter(w => w.fromNodeId !== nodeId && w.toNodeId !== nodeId),
    });
    setCtxMenu(null);
  }, [graph, onUpdateGraph]);

  const toggleBypass = useCallback((nodeId: string) => {
    onUpdateGraph({
      ...graph,
      nodes: graph.nodes.map(n => n.id === nodeId ? { ...n, bypassed: !n.bypassed } : n),
    });
    setCtxMenu(null);
  }, [graph, onUpdateGraph]);

  // ── Add node ──────────────────────────────────────────────────────────────
  const openAddMenu = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    setAddMenu({ x: cx, y: cy, wx: (cx - pan.x) / zoom, wy: (cy - pan.y) / zoom });
    setCtxMenu(null);
    setAddSearch("");
  }, [pan, zoom]);

  const addNodeOfType = useCallback((type: CompNodeType, wx: number, wy: number) => {
    const n = createNode(type, wx, wy);
    onUpdateGraph({ ...graph, nodes: [...graph.nodes, n] });
    onSelectNodes([n.id]);
    setAddMenu(null);
    setAddSearch("");
  }, [graph, onUpdateGraph, onSelectNodes]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const isCtrl = e.ctrlKey || e.metaKey;

      // Delete / Backspace → delete selected nodes
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNodeIds.length > 0) { e.preventDefault(); deleteSelected(); }
      }

      // Ctrl+A → select all nodes
      if (isCtrl && e.key === "a") {
        e.preventDefault();
        onSelectNodes(graph.nodes.map(n => n.id));
        return;
      }
      // Ctrl+Shift+A → deselect all
      if (isCtrl && e.shiftKey && e.key === "A") {
        e.preventDefault();
        onSelectNodes([]);
        return;
      }
      // Ctrl+D → duplicate selected
      if (isCtrl && e.key === "d" && !e.shiftKey) {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      // Ctrl+C → copy selected
      if (isCtrl && e.key === "c") { e.preventDefault(); copySelected(); return; }
      // Ctrl+V → paste clipboard
      if (isCtrl && e.key === "v") { e.preventDefault(); pasteClipboard(); return; }
      // Ctrl+G → group selected (stub)
      if (isCtrl && e.key === "g") {
        e.preventDefault();
        // Group: wrap selected nodes into a group (placeholder)
        return;
      }
      // Ctrl+F → fit to view / frame selected
      if (isCtrl && e.key === "f") { e.preventDefault(); fitToView(); return; }
      // F → fit to view (no modifier)
      if (e.key === "f" && !isCtrl) { fitToView(); return; }
      // Tab → select next node
      if (e.key === "Tab" && !isCtrl) {
        e.preventDefault();
        if (graph.nodes.length === 0) return;
        const curIdx = selectedNodeIds.length > 0
          ? graph.nodes.findIndex(n => n.id === selectedNodeIds[0])
          : -1;
        const nextIdx = (curIdx + 1) % graph.nodes.length;
        onSelectNodes([graph.nodes[nextIdx].id]);
        return;
      }
      // B → toggle bypass on selected nodes
      if (e.key === "b" && !isCtrl) {
        selectedNodeIds.forEach(id => toggleBypass(id));
        return;
      }
      // P → open add node picker (like Fusion's Tab key)
      if (e.key === "p" && !isCtrl) {
        const cx = (containerRef.current?.clientWidth ?? 400) / 2;
        const cy = (containerRef.current?.clientHeight ?? 300) / 2;
        setAddMenu({ x: cx, y: cy, wx: (cx - pan.x) / zoom, wy: (cy - pan.y) / zoom });
        setAddSearch("");
        return;
      }
      // R → reset view
      if (e.key === "r" && !isCtrl) { setPan({ x: 80, y: 80 }); setZoom(1.0); return; }
      // = or + → zoom in
      if (e.key === "=" || e.key === "+") {
        setZoom(z => Math.min(MAX_ZOOM, z * 1.15));
        return;
      }
      // - → zoom out
      if (e.key === "-") {
        setZoom(z => Math.max(MIN_ZOOM, z * 0.85));
        return;
      }
      // 0 → reset zoom to 1:1
      if (e.key === "0" && !isCtrl) { setZoom(1); setPan({ x: 80, y: 80 }); return; }
      // 1 → zoom to fit
      if (e.key === "1" && !isCtrl) { fitToView(); return; }
      // 2 → zoom to 200%
      if (e.key === "2" && !isCtrl) { setZoom(2); return; }
      // 3 → zoom to 50%
      if (e.key === "3" && !isCtrl) { setZoom(0.5); return; }
      // Escape → cancel add menu or deselect
      if (e.key === "Escape") {
        if (addMenu) { setAddMenu(null); setAddSearch(""); return; }
        if (wire) { setWire(null); return; }
        onSelectNodes([]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedNodeIds, deleteSelected, duplicateSelected, copySelected, pasteClipboard, fitToView, graph.nodes, onSelectNodes, toggleBypass, pan, zoom, addMenu, wire]);

  // ── Filter nodes for add menu ─────────────────────────────────────────────
  const filteredAddNodes = addSearch.trim()
    ? ADD_NODE_CATEGORIES.flatMap(cat => cat.types.filter(t => t.toLowerCase().includes(addSearch.toLowerCase())))
    : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="node-canvas-container"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
      style={{ cursor: isPanning ? "grabbing" : spaceHeld ? "grab" : wire ? "crosshair" : "default" }}
    >
      {/* Grid background */}
      <svg
        ref={svgRef}
        className="node-canvas-svg"
        onMouseUp={onSvgMouseUp}
      >
        <defs>
          <pattern
            id="grid-small"
            width={GRID_SIZE * zoom}
            height={GRID_SIZE * zoom}
            x={pan.x % (GRID_SIZE * zoom)}
            y={pan.y % (GRID_SIZE * zoom)}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${GRID_SIZE * zoom} 0 L 0 0 0 ${GRID_SIZE * zoom}`}
              fill="none"
              stroke="rgba(255,255,255,0.04)"
              strokeWidth="0.5"
            />
          </pattern>
          <pattern
            id="grid-large"
            width={GRID_SIZE * zoom * 5}
            height={GRID_SIZE * zoom * 5}
            x={pan.x % (GRID_SIZE * zoom * 5)}
            y={pan.y % (GRID_SIZE * zoom * 5)}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${GRID_SIZE * zoom * 5} 0 L 0 0 0 ${GRID_SIZE * zoom * 5}`}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
            />
          </pattern>
          {/* Arrow marker for wires */}
          <marker id="wire-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="rgba(255,215,0,0.6)" />
          </marker>
        </defs>

        <rect width="100%" height="100%" fill="url(#grid-large)" />
        <rect width="100%" height="100%" fill="url(#grid-small)" />

        {/* Group = world space */}
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>

          {/* Wires */}
          {graph.wires.map(w => {
            const fromNode = graph.nodes.find(n => n.id === w.fromNodeId);
            const toNode = graph.nodes.find(n => n.id === w.toNodeId);
            if (!fromNode || !toNode) return null;
            const p1 = getPortPos(fromNode, w.fromPortId, false);
            const p2 = getPortPos(toNode, w.toPortId, true);
            const fromPort = fromNode.ports.find(p => p.id === w.fromPortId);
            const toPort = toNode.ports.find(p => p.id === w.toPortId);
            const portType = (fromPort?.type ?? toPort?.type) ?? "image";
            const color = (PORT_TYPE_COLORS as Record<string,string>)[portType] ?? "#f5c542";
            // Faster flow for audio, slower for mask
            const flowDur = portType === "audio" ? "0.9s" : portType === "mask" ? "3s" : "1.8s";
            const isSelected = selectedNodeIds.includes(w.fromNodeId) || selectedNodeIds.includes(w.toNodeId);
            const path = wirePath(p1.x, p1.y, p2.x, p2.y);
            return (
              <g key={w.id} className="comp-wire-group">
                {/* Wire glow when connected to selected node */}
                {isSelected && (
                  <path
                    d={path}
                    fill="none"
                    stroke={color}
                    strokeWidth={4 / zoom}
                    strokeOpacity={0.15}
                  />
                )}
                {/* Wire body */}
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={(isSelected ? 2 : 1.5) / zoom}
                  strokeOpacity={isSelected ? 0.9 : 0.65}
                  className="comp-wire"
                />
                {/* Animated flow dot */}
                <circle r={2.5 / zoom} fill={color} opacity={0.85}>
                  <animateMotion
                    dur={flowDur}
                    repeatCount="indefinite"
                    path={path}
                  />
                </circle>
              </g>
            );
          })}

          {/* Nodes */}
          {graph.nodes.map(node => {
            const isSel = selectedNodeIds.includes(node.id);
            const isBypass = node.bypassed;
            const catCol = catColor(node);
            const inputs = node.ports.filter(p => p.direction === "in");
            const outputs = node.ports.filter(p => p.direction === "out");

            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                onMouseDown={ev => onNodeMouseDown(ev, node.id)}
                onContextMenu={ev => onNodeContextMenu(ev, node.id)}
                onDoubleClick={ev => onNodeDblClick(ev, node.id)}
                style={{ cursor: "grab" }}
                opacity={isBypass ? 0.38 : 1}
              >
                {/* Drop shadow */}
                <rect x={3} y={5} width={NODE_W} height={NODE_H} rx={5}
                  fill="rgba(0,0,0,0.6)"
                  style={{ filter: "blur(4px)" }}
                />
                {/* Body background */}
                <rect width={NODE_W} height={NODE_H} rx={5} fill="#18191f" />
                {/* Side accent bar */}
                <rect x={0} y={0} width={4} height={NODE_H} rx={2} fill={catCol} opacity={0.9} />
                {/* Header gradient */}
                <defs>
                  <linearGradient id={`ng-${node.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={catCol} stopOpacity="0.4" />
                    <stop offset="100%" stopColor={catCol} stopOpacity="0.08" />
                  </linearGradient>
                </defs>
                <rect x={4} y={0} width={NODE_W - 4} height={20} rx={3}
                  fill={`url(#ng-${node.id})`}
                />
                {/* Top border glow when selected */}
                {isSel && (
                  <rect x={0} y={0} width={NODE_W} height={2} rx={1} fill="#ffd700" opacity={0.95} />
                )}
                {/* Selection ring */}
                {isSel && (
                  <rect
                    x={-2} y={-2}
                    width={NODE_W + 4}
                    height={NODE_H + 4}
                    rx={7}
                    fill="none"
                    stroke="#ffd700"
                    strokeWidth={1.2 / zoom}
                    opacity={0.85}
                  />
                )}
                {/* Node label */}
                <text
                  x={(NODE_W + 4) / 2} y={11}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#ffffff"
                  fontSize={7}
                  fontWeight="700"
                  letterSpacing="0.04em"
                  style={{ userSelect: "none", pointerEvents: "none" }}
                >
                  {node.label.length > 14 ? node.label.slice(0, 14) + "…" : node.label}
                </text>
                {/* Node type sub-label */}
                <text
                  x={(NODE_W + 4) / 2} y={33}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="rgba(255,255,255,0.38)"
                  fontSize={5.5}
                  style={{ userSelect: "none", pointerEvents: "none" }}
                >
                  {node.type}
                </text>
                {/* Category dot */}
                <circle cx={NODE_W - 6} cy={11} r={3.5} fill={catCol} opacity={0.9} />

                {/* Bypass indicator */}
                {isBypass && (
                  <g>
                    <rect x={NODE_W / 2 - 10} y={NODE_H / 2 - 5} width={20} height={10} rx={2} fill="#ff5722" opacity={0.9} />
                    <text x={NODE_W / 2} y={NODE_H / 2} textAnchor="middle" dominantBaseline="middle"
                      fill="white" fontSize={5} fontWeight="700" style={{ pointerEvents: "none", userSelect: "none" }}>BYP</text>
                  </g>
                )}

                {/* Input ports */}
                {inputs.map((port, idx) => {
                  const total = inputs.length;
                  const py = NODE_H / 2 + (idx - (total - 1) / 2) * PORT_SPACING;
                  const col = (PORT_TYPE_COLORS as Record<string,string>)[port.type] ?? "#f5c542";
                  return (
                    <g key={port.id}
                      onMouseDown={ev => { ev.stopPropagation(); }}
                      onMouseUp={ev => onPortMouseUp(ev, node.id, port.id, true)}
                    >
                      {/* Port hover ring */}
                      <circle cx={0} cy={py} r={PORT_R + 3} fill="transparent" style={{ cursor: "crosshair" }} />
                      <circle cx={0} cy={py} r={PORT_R} fill={col} stroke="rgba(0,0,0,0.7)" strokeWidth={1.2} />
                      <circle cx={0} cy={py} r={PORT_R - 1.5} fill="rgba(255,255,255,0.25)" />
                      <text x={9} y={py} dominantBaseline="middle" fill="rgba(255,255,255,0.55)"
                        fontSize={5.5} style={{ pointerEvents: "none", userSelect: "none" }}>{port.label}</text>
                    </g>
                  );
                })}

                {/* Output ports */}
                {outputs.map((port, idx) => {
                  const total = outputs.length;
                  const py = NODE_H / 2 + (idx - (total - 1) / 2) * PORT_SPACING;
                  const col = (PORT_TYPE_COLORS as Record<string,string>)[port.type] ?? "#f5c542";
                  return (
                    <g key={port.id}
                      onMouseDown={ev => onPortMouseDown(ev, node.id, port.id, true)}
                      onMouseUp={ev => { ev.stopPropagation(); }}
                      style={{ cursor: "crosshair" }}
                    >
                      <circle cx={NODE_W} cy={py} r={PORT_R + 3} fill="transparent" />
                      <circle cx={NODE_W} cy={py} r={PORT_R} fill={col} stroke="rgba(0,0,0,0.7)" strokeWidth={1.2} />
                      <circle cx={NODE_W} cy={py} r={PORT_R - 1.5} fill="rgba(255,255,255,0.25)" />
                      <text x={NODE_W - 9} y={py} textAnchor="end" dominantBaseline="middle"
                        fill="rgba(255,255,255,0.55)" fontSize={5.5}
                        style={{ pointerEvents: "none", userSelect: "none" }}>{port.label}</text>
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* Lasso selection rect */}
          {lasso && (
            <rect
              x={Math.min(lasso.x1, lasso.x2)}
              y={Math.min(lasso.y1, lasso.y2)}
              width={Math.abs(lasso.x2 - lasso.x1)}
              height={Math.abs(lasso.y2 - lasso.y1)}
              fill="rgba(255,215,0,0.05)"
              stroke="#ffd700"
              strokeWidth={1 / zoom}
              strokeDasharray={`${4 / zoom},${2 / zoom}`}
            />
          )}
        </g>

        {/* Wire-in-progress (screen space) */}
        {wire && (
          <path
            d={wirePath(wire.x1, wire.y1, wire.x2, wire.y2)}
            fill="none"
            stroke="#ffd700"
            strokeWidth={2}
            strokeDasharray="6,3"
            opacity={0.8}
          />
        )}
      </svg>

      {/* Toolbar */}
      <div className="node-canvas-toolbar">
        <button className="nc-tb-btn" title="Add Node (right-click or click +)" onClick={e => openAddMenu(e)}>＋ Add</button>
        <button className="nc-tb-btn" title="Fit to view (F)" onClick={fitToView}>⊞ Fit</button>
        <button className="nc-tb-btn" title="Zoom in" onClick={() => setZoom(z => Math.min(z * 1.2, MAX_ZOOM))}>＋</button>
        <span className="nc-zoom-label">{Math.round(zoom * 100)}%</span>
        <button className="nc-tb-btn" title="Zoom out" onClick={() => setZoom(z => Math.max(z * 0.8, MIN_ZOOM))}>－</button>
        <button className="nc-tb-btn" title="Reset zoom" onClick={() => { setZoom(1); setPan({ x: 80, y: 80 }); }}>⟳</button>
        {selectedNodeIds.length > 0 && (
          <>
            <div className="nc-tb-sep" />
            <button className="nc-tb-btn nc-tb-danger" title="Delete selected (Del)" onClick={deleteSelected}>✕ Delete</button>
            <button className="nc-tb-btn" title="Duplicate (Ctrl+D)" onClick={duplicateSelected}>⧉ Dup</button>
          </>
        )}
      </div>

      {/* Minimap */}
      <NodeMinimap graph={graph} pan={pan} zoom={zoom} containerRef={containerRef} />

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="nc-context-menu"
          style={{
            left: Math.min(ctxMenu.x, (containerRef.current?.clientWidth ?? 800) - 180),
            top: Math.min(ctxMenu.y, (containerRef.current?.clientHeight ?? 600) - 240),
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          {ctxMenu.nodeId && (() => {
            const node = graph.nodes.find(n => n.id === ctxMenu.nodeId);
            const desc = node ? NODE_DESCRIPTIONS[node.type] : undefined;
            return (
              <>
                <div className="nc-ctx-header">
                  <span className="nc-ctx-node-type">{node?.type ?? "Node"}</span>
                  <span className="nc-ctx-node-label">{node?.label}</span>
                </div>
                {desc && (
                  <div className="nc-ctx-desc">{desc}</div>
                )}
                <hr />
                <button title="Enable/disable this node without removing it" onClick={() => toggleBypass(ctxMenu.nodeId!)}>
                  {node?.bypassed ? "✓ Enable Node" : "⊘ Bypass Node"}
                </button>
                <button title="Remove all wires connected to this node" onClick={() => disconnectWires(ctxMenu.nodeId!)}>
                  ✂ Disconnect Wires
                </button>
                <hr />
                <button title="Duplicate selected nodes (Ctrl+D)" onClick={duplicateSelected}>⧉ Duplicate</button>
                <button title="Copy selected nodes (Ctrl+C)" onClick={copySelected}>⎘ Copy</button>
                <button className="danger" title="Delete selected nodes (Del)" onClick={deleteSelected}>🗑 Delete</button>
                <hr />
              </>
            );
          })()}
          {!ctxMenu.nodeId && (
            <>
              <div className="nc-ctx-header"><span className="nc-ctx-node-type">Canvas</span></div>
              <hr />
            </>
          )}
          <button title="Open the add-node menu at this position (right-click or +)" onClick={openAddMenu}>＋ Add Node…</button>
          {clipboard.current.length > 0 && (
            <button title={`Paste ${clipboard.current.length} copied node(s) (Ctrl+V)`} onClick={pasteClipboard}>
              ⎘ Paste ({clipboard.current.length})
            </button>
          )}
          <button title="Zoom and pan to fit all nodes (F)" onClick={fitToView}>⊞ Fit to View</button>
          <button title="Select all nodes (Ctrl+A)" onClick={() => { onSelectNodes(graph.nodes.map(n => n.id)); setCtxMenu(null); }}>
            ◻ Select All
          </button>
        </div>
      )}

      {/* Add Node menu */}
      {addMenu && (
        <div
          className="nc-add-menu"
          style={{ left: addMenu.x, top: addMenu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="nc-add-search-row">
            <input
              autoFocus
              className="nc-add-search"
              placeholder="Search nodes…"
              value={addSearch}
              onChange={e => setAddSearch(e.target.value)}
            />
            <button className="nc-add-close" onClick={() => { setAddMenu(null); setAddSearch(""); }}>✕</button>
          </div>
          <div className="nc-add-list">
            {filteredAddNodes ? (
              <div className="nc-add-cat-section">
                {filteredAddNodes.map(type => (
                  <button
                    key={type}
                    className="nc-add-type-btn"
                    onClick={() => addNodeOfType(type as CompNodeType, addMenu.wx, addMenu.wy)}
                  >
                    {type}
                  </button>
                ))}
              </div>
            ) : (
              ADD_NODE_CATEGORIES.map(cat => (
                <div key={cat.category} className="nc-add-cat-section">
                  <div className="nc-add-cat-header">{cat.category}</div>
                  {cat.types.map(type => (
                    <button
                      key={type}
                      className="nc-add-type-btn"
                      onClick={() => addNodeOfType(type, addMenu.wx, addMenu.wy)}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Minimap ───────────────────────────────────────────────────────────────────
const NodeMinimap: React.FC<{
  graph: CompGraph;
  pan: { x: number; y: number };
  zoom: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
}> = ({ graph, pan, zoom, containerRef }) => {
  const MM_W = 140;
  const MM_H = 80;
  if (graph.nodes.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of graph.nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + NODE_W);
    maxY = Math.max(maxY, n.y + NODE_H);
  }
  const padding = 40;
  minX -= padding; minY -= padding; maxX += padding; maxY += padding;
  const worldW = maxX - minX;
  const worldH = maxY - minY;
  const scaleX = MM_W / worldW;
  const scaleY = MM_H / worldH;
  const scale = Math.min(scaleX, scaleY);

  const toMM = (wx: number, wy: number) => ({
    x: (wx - minX) * scale,
    y: (wy - minY) * scale,
  });

  const cw = containerRef.current?.clientWidth ?? 800;
  const ch = containerRef.current?.clientHeight ?? 400;
  const vpX = (-pan.x) / zoom;
  const vpY = (-pan.y) / zoom;
  const vpW = cw / zoom;
  const vpH = ch / zoom;
  const vp = toMM(vpX, vpY);

  return (
    <div className="node-minimap">
      <svg width={MM_W} height={MM_H}>
        <rect width={MM_W} height={MM_H} fill="rgba(10,10,16,0.85)" rx={4} />
        {graph.nodes.map(n => {
          const mp = toMM(n.x, n.y);
          return (
            <rect
              key={n.id}
              x={mp.x} y={mp.y}
              width={Math.max(NODE_W * scale, 4)}
              height={Math.max(NODE_H * scale, 3)}
              rx={1}
              fill={catColor(n)}
              opacity={0.7}
            />
          );
        })}
        {/* Viewport rect */}
        <rect
          x={vp.x} y={vp.y}
          width={vpW * scale} height={vpH * scale}
          fill="none"
          stroke="rgba(255,215,0,0.5)"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
};

export default NodeCanvas;
