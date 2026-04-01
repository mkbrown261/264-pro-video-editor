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
  const panStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });

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

  // ── Wheel zoom ────────────────────────────────────────────────────────────
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(z => {
      const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor));
      setPan(p => ({
        x: mx - (mx - p.x) * (nz / z),
        y: my - (my - p.y) * (nz / z),
      }));
      return nz;
    });
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

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Middle-click or Alt+drag = pan
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
  }, [ctxMenu, addMenu, pan, zoom]);

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
      const wx = (mx - pan.x) / zoom;
      const wy = (my - pan.y) / zoom;
      const dx = wx - dragRef.current.ox;
      const dy = wy - dragRef.current.oy;
      const snappedX = Math.round(dx / GRID_SIZE) * GRID_SIZE + dragRef.current.startX;
      const snappedY = Math.round(dy / GRID_SIZE) * GRID_SIZE + dragRef.current.startY;
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

    const rect = containerRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = (mx - pan.x) / zoom;
    const wy = (my - pan.y) / zoom;

    dragRef.current = {
      nodeId,
      ox: wx - node.x,
      oy: wy - node.y,
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
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNodeIds.length > 0) deleteSelected();
      }
      if (e.key === "d" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        duplicateSelected();
      }
      if (e.key === "c" && (e.ctrlKey || e.metaKey)) copySelected();
      if (e.key === "v" && (e.ctrlKey || e.metaKey)) pasteClipboard();
      if (e.key === "f" && !e.ctrlKey) fitToView();
      if (e.key === "Escape") { setAddMenu(null); setAddSearch(""); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedNodeIds, deleteSelected, duplicateSelected, copySelected, pasteClipboard, fitToView]);

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
      style={{ cursor: isPanning ? "grabbing" : wire ? "crosshair" : "default" }}
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
            const color = (PORT_TYPE_COLORS as Record<string,string>)[(fromPort?.type ?? toPort?.type) ?? "image"] ?? "#f5c542";
            return (
              <g key={w.id}>
                <path
                  d={wirePath(p1.x, p1.y, p2.x, p2.y)}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5 / zoom}
                  strokeOpacity={0.7}
                  className="comp-wire"
                />
                {/* Animated flow dots */}
                <circle r={2 / zoom} fill={color} opacity={0.9}>
                  <animateMotion
                    dur="1.8s"
                    repeatCount="indefinite"
                    path={wirePath(p1.x, p1.y, p2.x, p2.y)}
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
                opacity={isBypass ? 0.45 : 1}
              >
                {/* Selection glow */}
                {isSel && (
                  <rect
                    x={-3} y={-3}
                    width={NODE_W + 6}
                    height={NODE_H + 6}
                    rx={6}
                    fill="none"
                    stroke="#ffd700"
                    strokeWidth={1.5 / zoom}
                    opacity={0.9}
                  />
                )}
                {/* Shadow */}
                <rect x={2} y={3} width={NODE_W} height={NODE_H} rx={4} fill="rgba(0,0,0,0.5)" />
                {/* Body */}
                <rect width={NODE_W} height={NODE_H} rx={4} fill="#1e1e24" />
                {/* Category stripe */}
                <rect width={NODE_W} height={14} rx={4} fill={catCol} />
                <rect y={10} width={NODE_W} height={4} fill={catCol} />
                {/* Label */}
                <text
                  x={NODE_W / 2} y={8}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#fff"
                  fontSize={7 / zoom < 7 ? 7 : 7}
                  fontWeight="700"
                  letterSpacing="0.05em"
                  style={{ userSelect: "none", pointerEvents: "none" }}
                >
                  {node.label}
                </text>
                {/* Node type sub-label */}
                <text
                  x={NODE_W / 2} y={32}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="rgba(255,255,255,0.5)"
                  fontSize={6}
                  style={{ userSelect: "none", pointerEvents: "none" }}
                >
                  {node.type}
                </text>

                {/* Bypass indicator */}
                {isBypass && (
                  <text x={NODE_W - 6} y={7} textAnchor="end" fill="#ffb74d" fontSize={6} fontWeight="700">BYP</text>
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
                      <circle cx={0} cy={py} r={PORT_R} fill={col} stroke="#111" strokeWidth={1} />
                      <text x={8} y={py} dominantBaseline="middle" fill="rgba(255,255,255,0.6)" fontSize={5.5} style={{ pointerEvents: "none", userSelect: "none" }}>{port.label}</text>
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
                      <circle cx={NODE_W} cy={py} r={PORT_R} fill={col} stroke="#111" strokeWidth={1} />
                      <text x={NODE_W - 8} y={py} textAnchor="end" dominantBaseline="middle" fill="rgba(255,255,255,0.6)" fontSize={5.5} style={{ pointerEvents: "none", userSelect: "none" }}>{port.label}</text>
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
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          {ctxMenu.nodeId && (
            <>
              <button onClick={() => toggleBypass(ctxMenu.nodeId!)}>Toggle Bypass</button>
              <button onClick={() => disconnectWires(ctxMenu.nodeId!)}>Disconnect Wires</button>
              <button onClick={duplicateSelected}>Duplicate</button>
              <button onClick={copySelected}>Copy</button>
              <button className="danger" onClick={deleteSelected}>Delete</button>
              <hr />
            </>
          )}
          <button onClick={openAddMenu}>Add Node…</button>
          {clipboard.current.length > 0 && (
            <button onClick={pasteClipboard}>Paste ({clipboard.current.length})</button>
          )}
          <button onClick={fitToView}>Fit to View</button>
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
