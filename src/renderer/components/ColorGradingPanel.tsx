/**
 * 264 Pro — Professional Color Grading Page
 * Layout inspired by DaVinci Resolve Color Page:
 *   [Node Graph] | [Viewer area (handled in App)] | [Controls/Wheels/Curves]
 *   [Scopes always visible at bottom-right]
 *
 * This component renders the full right-side grading controls + node graph.
 * App.tsx wraps it alongside the ViewerPanel and mini timeline.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as RMouseEvent,
} from "react";
import type { ColorGrade, CurvePoint, RGBValue } from "../../shared/models";
import { createDefaultColorGrade, createId } from "../../shared/models";
import type { TimelineSegment } from "../../shared/timeline";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ColorGradingPanelProps {
  selectedSegment: TimelineSegment | null;
  colorGrade: ColorGrade | null;
  onEnableGrade: () => void;
  onUpdateGrade: (grade: Partial<ColorGrade>) => void;
  onResetGrade: () => void;
}

interface FullColorGradingPanelProps extends ColorGradingPanelProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

type ActiveScope   = "waveform" | "vectorscope" | "histogram" | "parade";
type ActivePanel   = "primary" | "curves" | "lut" | "scopes";
type WheelKey      = "lift" | "gamma" | "gain" | "offset";
type CurveChannel  = "master" | "red" | "green" | "blue" | "hueVsHue" | "hueVsSat";

interface ColorNode {
  id: string;
  label: string;
  type: "corrector" | "effect" | "serial";
  enabled: boolean;
  active: boolean;   // currently selected for editing
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
}

// ─── Color Wheel ─────────────────────────────────────────────────────────────

interface ColorWheelProps {
  label: string;
  value: RGBValue;
  onChange: (v: RGBValue) => void;
  disabled?: boolean;
}

function ColorWheel({ label, value, onChange, disabled = false }: ColorWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDragging = useRef(false);
  const RADIUS = 58;
  const SIZE   = RADIUS * 2 + 10;
  const CX     = SIZE / 2;
  const CY     = SIZE / 2;

  // Compute indicator position from RGB offset value
  const indX = CX + value.r * RADIUS * 2;
  const indY = CY + value.g * RADIUS * 2;

  const drawWheel = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, SIZE, SIZE);

    // Draw color wheel pixel by pixel
    const imageData = ctx.createImageData(SIZE, SIZE);
    for (let py = 0; py < SIZE; py++) {
      for (let px = 0; px < SIZE; px++) {
        const dx = px - CX;
        const dy = py - CY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > RADIUS) continue;
        const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const sat = dist / RADIUS;
        const lum = disabled ? 0.25 : 0.5;
        const [ri, gi, bi] = hslToRgb(hue / 360, sat, lum);
        const idx = (py * SIZE + px) * 4;
        imageData.data[idx]     = ri;
        imageData.data[idx + 1] = gi;
        imageData.data[idx + 2] = bi;
        imageData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    // Outer ring
    ctx.beginPath();
    ctx.arc(CX, CY, RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Crosshair lines
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(CX, CY - RADIUS); ctx.lineTo(CX, CY + RADIUS); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(CX - RADIUS, CY); ctx.lineTo(CX + RADIUS, CY); ctx.stroke();

    // Indicator dot
    const ix = clamp(indX, CX - RADIUS, CX + RADIUS);
    const iy = clamp(indY, CY - RADIUS, CY + RADIUS);
    // Shadow
    ctx.beginPath();
    ctx.arc(ix, iy, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fill();
    // White dot
    ctx.beginPath();
    ctx.arc(ix, iy, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [value, disabled, indX, indY]);

  useEffect(() => { drawWheel(); }, [drawWheel]);

  function handlePointer(e: RMouseEvent<HTMLCanvasElement>) {
    if (disabled) return;
    if (!isDragging.current && e.type !== "mousedown") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = (e.clientX - rect.left - CX) / RADIUS;
    const dy = (e.clientY - rect.top  - CY) / RADIUS;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ndx = dist > 1 ? dx / dist : dx;
    const ndy = dist > 1 ? dy / dist : dy;
    onChange({ r: Math.round(ndx * 1000) / 1000, g: Math.round(ndy * 1000) / 1000, b: value.b });
  }

  // Compute the tint color for the label
  const magnitude = Math.sqrt(value.r * value.r + value.g * value.g);
  const hasOffset = magnitude > 0.01;

  return (
    <div className={`cw-wrap${disabled ? " cw-disabled" : ""}`}>
      <div className="cw-label">{label}</div>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="cw-canvas"
        style={{ cursor: disabled ? "default" : "crosshair" }}
        onMouseDown={(e) => { if (!disabled) { isDragging.current = true; handlePointer(e); } }}
        onMouseMove={handlePointer}
        onMouseUp={() => { isDragging.current = false; }}
        onMouseLeave={() => { isDragging.current = false; }}
      />
      {/* Luminance / master slider */}
      <div className="cw-lum-row">
        <input
          type="range"
          className="cw-lum-slider"
          min={-0.5}
          max={0.5}
          step={0.002}
          value={value.b}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, b: Number(e.target.value) })}
        />
      </div>
      <div className="cw-value-row">
        {(["r", "g", "b"] as const).map((ch) => (
          <span key={ch} className={`cw-val cw-${ch}`}>{value[ch] >= 0 ? "+" : ""}{value[ch].toFixed(3)}</span>
        ))}
      </div>
      <button
        className="cw-reset-btn"
        onClick={() => onChange({ r: 0, g: 0, b: 0 })}
        type="button"
        disabled={disabled || !hasOffset}
        title={`Reset ${label}`}
      >
        ↺
      </button>
    </div>
  );
}

// ─── Curve Editor ─────────────────────────────────────────────────────────────

interface CurveEditorProps {
  points: CurvePoint[];
  color: string;
  secondaryColor?: string;
  label?: string;
  onChange: (pts: CurvePoint[]) => void;
  size?: number;
}

function CurveEditor({ points, color, onChange, size = 220 }: CurveEditorProps) {
  const canvasRef  = useRef<HTMLCanvasElement | null>(null);
  const dragging   = useRef<number | null>(null);
  const SIZE       = size;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Background
    ctx.fillStyle = "#0f0f0f";
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 4; i++) {
      const p = (i / 4) * SIZE;
      ctx.beginPath(); ctx.moveTo(p, 0);    ctx.lineTo(p, SIZE);    ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p);    ctx.lineTo(SIZE, p);    ctx.stroke();
    }

    // Diagonal identity
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 0.7;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, SIZE); ctx.lineTo(SIZE, 0); ctx.stroke();
    ctx.setLineDash([]);

    // Curve spline
    const sorted = [...points].sort((a, b) => a.x - b.x);
    if (sorted.length >= 2) {
      // Filled area under curve
      ctx.beginPath();
      ctx.moveTo(0, SIZE);
      ctx.lineTo(sorted[0].x * SIZE, (1 - sorted[0].y) * SIZE);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        const mx = ((prev.x + curr.x) / 2) * SIZE;
        ctx.bezierCurveTo(mx, (1 - prev.y) * SIZE, mx, (1 - curr.y) * SIZE, curr.x * SIZE, (1 - curr.y) * SIZE);
      }
      ctx.lineTo(SIZE, SIZE);
      ctx.closePath();
      ctx.fillStyle = `${color}18`;
      ctx.fill();

      // Curve line
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.moveTo(sorted[0].x * SIZE, (1 - sorted[0].y) * SIZE);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        const mx = ((prev.x + curr.x) / 2) * SIZE;
        ctx.bezierCurveTo(mx, (1 - prev.y) * SIZE, mx, (1 - curr.y) * SIZE, curr.x * SIZE, (1 - curr.y) * SIZE);
      }
      ctx.stroke();
    }

    // Control points
    for (let i = 0; i < sorted.length; i++) {
      const pt = sorted[i];
      const isFixed = pt.x === 0 || pt.x === 1;
      ctx.beginPath();
      ctx.arc(pt.x * SIZE, (1 - pt.y) * SIZE, isFixed ? 3 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = isFixed ? "rgba(255,255,255,0.5)" : "#ffffff";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [points, color, SIZE]);

  useEffect(() => { draw(); }, [draw]);

  function ptFromEvent(e: RMouseEvent<HTMLCanvasElement>): CurvePoint {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: clamp((e.clientX - rect.left) / SIZE, 0, 1),
      y: clamp(1 - (e.clientY - rect.top)  / SIZE, 0, 1),
    };
  }

  function handleMouseDown(e: RMouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const pt = ptFromEvent(e);
    let nearest = -1, minDist = 0.045;
    for (let i = 0; i < points.length; i++) {
      const d = Math.hypot(points[i].x - pt.x, points[i].y - pt.y);
      if (d < minDist) { minDist = d; nearest = i; }
    }
    if (nearest >= 0) {
      dragging.current = nearest;
    } else {
      const newPts = [...points, pt].sort((a, b) => a.x - b.x);
      onChange(newPts);
      dragging.current = newPts.findIndex((p) => p === pt || (p.x === pt.x && p.y === pt.y));
    }
  }

  function handleMouseMove(e: RMouseEvent<HTMLCanvasElement>) {
    if (dragging.current === null) return;
    const pt  = ptFromEvent(e);
    const idx = dragging.current;
    const newPts = [...points];
    // Prevent dragging past neighbours
    const isFixed = newPts[idx].x === 0 || newPts[idx].x === 1;
    newPts[idx] = isFixed ? { x: newPts[idx].x, y: pt.y } : pt;
    onChange(newPts);
  }

  function handleDoubleClick(e: RMouseEvent<HTMLCanvasElement>) {
    const pt = ptFromEvent(e);
    const filtered = points.filter((p) =>
      p.x === 0 || p.x === 1 || Math.hypot(p.x - pt.x, p.y - pt.y) > 0.045
    );
    if (filtered.length < points.length) onChange(filtered);
  }

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      className="ce-canvas"
      style={{ cursor: "crosshair" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={() => { dragging.current = null; }}
      onMouseLeave={() => { dragging.current = null; }}
      onDoubleClick={handleDoubleClick}
    />
  );
}

// ─── Scope Canvas ─────────────────────────────────────────────────────────────

interface ScopeProps {
  type: ActiveScope;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  width?: number;
  height?: number;
}

function ScopeCanvas({ type, videoRef, width = 280, height = 160 }: ScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef    = useRef<number | null>(null);
  const lastTime  = useRef(-1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    function render() {
      const video = videoRef.current;
      if (!video || !canvas) { rafRef.current = requestAnimationFrame(render); return; }
      if (video.paused && video.currentTime === lastTime.current) {
        rafRef.current = requestAnimationFrame(render);
        return;
      }
      lastTime.current = video.currentTime;

      const tmp = document.createElement("canvas");
      tmp.width  = 96;
      tmp.height = 54;
      const tc = tmp.getContext("2d");
      if (!tc || !ctx) { rafRef.current = requestAnimationFrame(render); return; }
      try {
        tc.drawImage(video, 0, 0, 96, 54);
        const imgData = tc.getImageData(0, 0, 96, 54);
        drawScope(ctx, imgData, type, canvas.width, canvas.height);
      } catch {
        if (ctx) {
          ctx.fillStyle = "#111";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "rgba(255,255,255,0.2)";
          ctx.font = "9px monospace";
          ctx.fillText("No signal", 6, canvas.height / 2);
        }
      }
      rafRef.current = requestAnimationFrame(render);
    }
    rafRef.current = requestAnimationFrame(render);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [type, videoRef]);

  return <canvas ref={canvasRef} width={width} height={height} className="scope-canvas" />;
}

function drawScope(
  ctx: CanvasRenderingContext2D,
  img: ImageData,
  type: ActiveScope,
  w: number,
  h: number,
) {
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, w, h);
  const d = img.data;
  const n = d.length / 4;

  if (type === "waveform") {
    for (let i = 0; i < n; i++) {
      const r = d[i*4], g = d[i*4+1], b = d[i*4+2];
      const luma = (0.299*r + 0.587*g + 0.114*b) / 255;
      const px = ((i % img.width) / img.width) * w;
      const py = (1 - luma) * h;
      ctx.fillStyle = "rgba(100,210,100,0.18)";
      ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 0.5;
    for (const ire of [0, 20, 40, 60, 80, 100]) {
      const y = (1 - ire / 100) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.font = "7px monospace";
      ctx.fillText(String(ire), 2, y - 1);
    }
  } else if (type === "histogram") {
    const rBins = new Array(256).fill(0);
    const gBins = new Array(256).fill(0);
    const bBins = new Array(256).fill(0);
    for (let i = 0; i < n; i++) {
      rBins[d[i*4]]++;
      gBins[d[i*4+1]]++;
      bBins[d[i*4+2]]++;
    }
    const maxVal = Math.max(...rBins, ...gBins, ...bBins);
    const barW = w / 256;
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * w;
      ctx.fillStyle = "rgba(255,60,60,0.5)";
      ctx.fillRect(x, h - (rBins[i] / maxVal) * h, barW, (rBins[i] / maxVal) * h);
      ctx.fillStyle = "rgba(60,200,60,0.5)";
      ctx.fillRect(x, h - (gBins[i] / maxVal) * h, barW, (gBins[i] / maxVal) * h);
      ctx.fillStyle = "rgba(60,120,255,0.5)";
      ctx.fillRect(x, h - (bBins[i] / maxVal) * h, barW, (bBins[i] / maxVal) * h);
    }
  } else if (type === "vectorscope") {
    // Circle guide
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.arc(w/2, h/2, Math.min(w,h)*0.46, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(w/2, h/2, Math.min(w,h)*0.23, 0, Math.PI*2); ctx.stroke();
    for (let i = 0; i < n; i++) {
      const r = d[i*4]/255, g = d[i*4+1]/255, b = d[i*4+2]/255;
      const cb = (-0.169*r - 0.331*g + 0.5*b);
      const cr = (0.5*r   - 0.419*g - 0.081*b);
      const px = (0.5 + cb * 0.9) * w;
      const py = (0.5 - cr * 0.9) * h;
      ctx.fillStyle = "rgba(80,230,190,0.14)";
      ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
    }
    // Center
    ctx.beginPath(); ctx.arc(w/2, h/2, 2, 0, Math.PI*2);
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fill();
  } else if (type === "parade") {
    const cW = Math.floor(w / 3);
    const chConfig: Array<[number, string]> = [
      [0, "rgba(255,50,50,0.75)"],
      [1, "rgba(50,220,50,0.75)"],
      [2, "rgba(50,100,255,0.75)"],
    ];
    for (const [ci, col] of chConfig) {
      const bins = new Array(256).fill(0);
      for (let i = 0; i < n; i++) bins[d[i*4+ci]]++;
      const mx = Math.max(...bins, 1);
      for (let i = 0; i < 256; i++) {
        const x = ci * cW + (i / 255) * cW;
        const bh = (bins[i] / mx) * h;
        ctx.fillStyle = col;
        ctx.fillRect(x, h - bh, cW/256 + 0.5, bh);
      }
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "8px monospace";
      ctx.fillText(["R","G","B"][ci], ci * cW + 3, 10);
    }
  }
}

// ─── Node Graph ───────────────────────────────────────────────────────────────

interface NodeGraphProps {
  nodes: ColorNode[];
  activeNodeId: string | null;
  onSelectNode: (id: string) => void;
  onAddNode: () => void;
  onDeleteNode: (id: string) => void;
  onToggleNode: (id: string) => void;
}

function NodeGraph({ nodes, activeNodeId, onSelectNode, onAddNode, onDeleteNode, onToggleNode }: NodeGraphProps) {
  return (
    <div className="ng-root">
      <div className="ng-header">
        <span className="ng-title">Node Graph</span>
        <button className="ng-add-btn" onClick={onAddNode} type="button" title="Add Serial Node">+</button>
      </div>
      <div className="ng-canvas">
        {nodes.map((node, idx) => (
          <div key={node.id} className="ng-node-group">
            {/* Connector */}
            {idx > 0 && (
              <div className="ng-connector">
                <svg width="32" height="16" style={{ display: "block" }}>
                  <line x1="0" y1="8" x2="32" y2="8" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5"/>
                  <polygon points="28,5 32,8 28,11" fill="rgba(255,255,255,0.3)"/>
                </svg>
              </div>
            )}
            {/* Node card */}
            <div
              className={`ng-node${node.active ? " ng-node-active" : ""}${!node.enabled ? " ng-node-disabled" : ""}`}
              onClick={() => onSelectNode(node.id)}
            >
              <div className="ng-node-thumb" style={{ opacity: node.enabled ? 1 : 0.3 }}>
                <div className="ng-node-thumb-inner" />
              </div>
              <div className="ng-node-label">{node.label}</div>
              <div className="ng-node-type">{node.type}</div>
              <div className="ng-node-actions">
                <button
                  className={`ng-node-btn${!node.enabled ? " off" : ""}`}
                  onClick={(e) => { e.stopPropagation(); onToggleNode(node.id); }}
                  title={node.enabled ? "Disable" : "Enable"}
                  type="button"
                >
                  {node.enabled ? "●" : "○"}
                </button>
                {nodes.length > 1 && (
                  <button
                    className="ng-node-btn del"
                    onClick={(e) => { e.stopPropagation(); onDeleteNode(node.id); }}
                    title="Delete node"
                    type="button"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Slider Row ───────────────────────────────────────────────────────────────

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onReset?: number; // reset value
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
  color?: string;
}

function SliderRow({ label, value, min, max, step, onReset, onChange, formatValue, color }: SliderRowProps) {
  const pct = ((value - min) / (max - min)) * 100;
  const displayVal = formatValue ? formatValue(value) : value.toFixed(2);
  const isDefault = onReset !== undefined && Math.abs(value - onReset) < step;

  return (
    <div className="sr-row">
      <span className="sr-label">{label}</span>
      <div className="sr-track-wrap">
        <div
          className="sr-fill"
          style={{
            width: `${pct}%`,
            background: color ?? "var(--accent)"
          }}
        />
        <input
          type="range"
          className="sr-input"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      <span className="sr-value" style={{ color: isDefault ? "var(--text-dim)" : "var(--text)" }}>
        {displayVal}
      </span>
      {onReset !== undefined && !isDefault && (
        <button
          className="sr-reset"
          onClick={() => onChange(onReset)}
          type="button"
          title={`Reset to ${onReset}`}
        >
          ↺
        </button>
      )}
    </div>
  );
}

// ─── Main ColorGradingPanel ───────────────────────────────────────────────────

export function ColorGradingPanel({
  selectedSegment,
  colorGrade,
  videoRef,
  onEnableGrade,
  onUpdateGrade,
  onResetGrade,
}: FullColorGradingPanelProps) {

  const [activePanel, setActivePanel]   = useState<ActivePanel>("primary");
  const [activeScope,  setActiveScope]  = useState<ActiveScope>("waveform");
  const [activeCurve,  setActiveCurve]  = useState<CurveChannel>("master");
  const [showScopes,   setShowScopes]   = useState(true);

  // Node graph state — persisted locally for now
  const [nodes, setNodes] = useState<ColorNode[]>([
    { id: "node-1", label: "Corrector 1", type: "corrector", enabled: true, active: true }
  ]);
  const [activeNodeId, setActiveNodeId] = useState<string>("node-1");

  const grade = colorGrade ?? createDefaultColorGrade();

  // ── Node helpers ──────────────────────────────────────────────────────────
  function addNode() {
    const id = createId();
    const n  = nodes.length + 1;
    const newNode: ColorNode = { id, label: `Corrector ${n}`, type: "corrector", enabled: true, active: false };
    const updated = nodes.map((nd) => ({ ...nd, active: false }));
    setNodes([...updated, { ...newNode, active: true }]);
    setActiveNodeId(id);
  }

  function deleteNode(id: string) {
    const filtered = nodes.filter((n) => n.id !== id);
    if (!filtered.length) return;
    setNodes(filtered.map((n, i) => ({ ...n, active: i === 0 })));
    setActiveNodeId(filtered[0].id);
  }

  function toggleNode(id: string) {
    setNodes(nodes.map((n) => n.id === id ? { ...n, enabled: !n.enabled } : n));
  }

  function selectNode(id: string) {
    setNodes(nodes.map((n) => ({ ...n, active: n.id === id })));
    setActiveNodeId(id);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!selectedSegment) {
    return (
      <div className="cgp-root cgp-empty">
        <div className="cgp-empty-msg">
          <div className="cgp-empty-icon">🎨</div>
          <p>Select a video clip in the timeline to start color grading.</p>
          <span>Switch to Edit page to import and arrange clips.</span>
        </div>
      </div>
    );
  }

  const clipName = selectedSegment.asset.name ?? "Untitled Clip";

  return (
    <div className="cgp-root">
      {/* ── Top: Clip info bar ── */}
      <div className="cgp-topbar">
        <span className="cgp-clip-badge">
          <span className="cgp-clip-dot" style={{ background: colorGrade ? "var(--accent)" : "var(--text-dim)" }} />
          {clipName}
        </span>
        {!colorGrade && (
          <button className="cgp-enable-btn" onClick={onEnableGrade} type="button">
            Enable Color Grade
          </button>
        )}
        {colorGrade && (
          <div className="cgp-topbar-actions">
            <button className="cgp-btn" onClick={() => setShowScopes((v) => !v)} type="button">
              {showScopes ? "Hide Scopes" : "Show Scopes"}
            </button>
            <button className="cgp-btn muted" onClick={onResetGrade} type="button">
              Reset Grade
            </button>
          </div>
        )}
      </div>

      {/* ── Node graph bar ── */}
      <NodeGraph
        nodes={nodes}
        activeNodeId={activeNodeId}
        onSelectNode={selectNode}
        onAddNode={addNode}
        onDeleteNode={deleteNode}
        onToggleNode={toggleNode}
      />

      {/* ── Main body ── */}
      {!colorGrade ? (
        <div className="cgp-no-grade">
          <p>No color grade applied to this clip.</p>
          <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 8 }}>
            Click "Enable Color Grade" above to activate the grading controls.
          </p>
        </div>
      ) : (
        <div className="cgp-body">
          {/* ── Panel tabs ── */}
          <div className="cgp-tabs">
            {([
              { id: "primary" as const, label: "Primary" },
              { id: "curves"  as const, label: "Curves"  },
              { id: "lut"     as const, label: "LUT"     },
              { id: "scopes"  as const, label: "Scopes"  },
            ]).map(({ id, label }) => (
              <button
                key={id}
                className={`cgp-tab${activePanel === id ? " active" : ""}`}
                onClick={() => setActivePanel(id)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── Panel content ── */}
          <div className="cgp-panel-content">

            {/* ─── PRIMARY ─── */}
            {activePanel === "primary" && (
              <div className="cgp-primary">
                {/* Color wheels */}
                <div className="cgp-wheels-section">
                  <div className="cgp-section-title">COLOR WHEELS</div>
                  <div className="cgp-wheels-row">
                    {([
                      { key: "lift"   as WheelKey, label: "Lift"   },
                      { key: "gamma"  as WheelKey, label: "Gamma"  },
                      { key: "gain"   as WheelKey, label: "Gain"   },
                      { key: "offset" as WheelKey, label: "Offset" },
                    ]).map(({ key, label }) => (
                      <ColorWheel
                        key={key}
                        label={label}
                        value={grade[key]}
                        onChange={(v) => onUpdateGrade({ [key]: v })}
                      />
                    ))}
                  </div>
                </div>

                {/* Primary sliders */}
                <div className="cgp-sliders-section">
                  <div className="cgp-section-title">PRIMARY CONTROLS</div>
                  <div className="cgp-sliders-grid">
                    <SliderRow
                      label="Exposure"
                      value={grade.exposure}
                      min={-3} max={3} step={0.01}
                      onReset={0}
                      onChange={(v) => onUpdateGrade({ exposure: v })}
                      formatValue={(v) => (v >= 0 ? "+" : "") + v.toFixed(2)}
                      color="rgba(255,210,80,0.8)"
                    />
                    <SliderRow
                      label="Contrast"
                      value={grade.contrast}
                      min={-1} max={1} step={0.01}
                      onReset={0}
                      onChange={(v) => onUpdateGrade({ contrast: v })}
                      formatValue={(v) => (v >= 0 ? "+" : "") + v.toFixed(2)}
                      color="rgba(200,200,200,0.7)"
                    />
                    <SliderRow
                      label="Saturation"
                      value={grade.saturation}
                      min={0} max={3} step={0.01}
                      onReset={1}
                      onChange={(v) => onUpdateGrade({ saturation: v })}
                      formatValue={(v) => v.toFixed(2)}
                      color="rgba(200,80,200,0.7)"
                    />
                    <SliderRow
                      label="Temperature"
                      value={grade.temperature}
                      min={-100} max={100} step={1}
                      onReset={0}
                      onChange={(v) => onUpdateGrade({ temperature: v })}
                      formatValue={(v) => (v >= 0 ? "+" : "") + v.toFixed(0) + "K"}
                      color="rgba(80,150,255,0.7)"
                    />
                    <SliderRow
                      label="Tint"
                      value={grade.tint}
                      min={-100} max={100} step={1}
                      onReset={0}
                      onChange={(v) => onUpdateGrade({ tint: v })}
                      formatValue={(v) => (v >= 0 ? "+" : "") + v.toFixed(0)}
                      color="rgba(120,200,100,0.7)"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ─── CURVES ─── */}
            {activePanel === "curves" && (
              <div className="cgp-curves">
                <div className="cgp-section-title">RGB CURVES</div>
                <div className="cgp-curve-channels">
                  {([
                    { id: "master"   as CurveChannel, label: "Master", color: "#c0c0c0" },
                    { id: "red"      as CurveChannel, label: "R",      color: "#ff5555" },
                    { id: "green"    as CurveChannel, label: "G",      color: "#55cc55" },
                    { id: "blue"     as CurveChannel, label: "B",      color: "#5599ff" },
                    { id: "hueVsHue" as CurveChannel, label: "H/H",    color: "#ffaa44" },
                    { id: "hueVsSat" as CurveChannel, label: "H/S",    color: "#aa44ff" },
                  ]).map(({ id, label, color }) => (
                    <button
                      key={id}
                      className={`cgp-ch-btn${activeCurve === id ? " active" : ""}`}
                      style={activeCurve === id ? { borderColor: color, color } : {}}
                      onClick={() => setActiveCurve(id)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="cgp-curve-editor-wrap">
                  <CurveEditor
                    points={grade.curves[activeCurve] ?? [{ x: 0, y: 0 }, { x: 1, y: 1 }]}
                    color={
                      activeCurve === "master"   ? "#c0c0c0" :
                      activeCurve === "red"      ? "#ff5555" :
                      activeCurve === "green"    ? "#55cc55" :
                      activeCurve === "blue"     ? "#5599ff" :
                      activeCurve === "hueVsHue" ? "#ffaa44" :
                                                   "#aa44ff"
                    }
                    size={200}
                    onChange={(pts) =>
                      onUpdateGrade({ curves: { ...grade.curves, [activeCurve]: pts } })
                    }
                  />
                  <div className="cgp-curve-actions">
                    <button
                      className="cgp-btn muted"
                      type="button"
                      onClick={() =>
                        onUpdateGrade({ curves: { ...grade.curves, [activeCurve]: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } })
                      }
                    >
                      Reset Curve
                    </button>
                  </div>
                </div>
                <p className="cgp-hint">Click to add · Double-click to remove · Drag to move</p>
              </div>
            )}

            {/* ─── LUT ─── */}
            {activePanel === "lut" && (
              <div className="cgp-lut">
                <div className="cgp-section-title">LUT — LOOK-UP TABLE</div>

                <div className="cgp-lut-status">
                  {grade.lutPath ? (
                    <>
                      <div className="cgp-lut-active-row">
                        <span className="cgp-lut-dot active" />
                        <span className="cgp-lut-name">{grade.lutPath.split(/[\\/]/).pop()}</span>
                        <button
                          className="cgp-btn danger"
                          onClick={() => onUpdateGrade({ lutPath: null })}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="cgp-lut-inactive">
                      <span className="cgp-lut-dot" />
                      <span>No LUT applied</span>
                    </div>
                  )}
                </div>

                <div className="cgp-section-title" style={{ marginTop: 14 }}>INTENSITY</div>
                <SliderRow
                  label="LUT Mix"
                  value={grade.lutIntensity}
                  min={0} max={1} step={0.01}
                  onReset={1}
                  onChange={(v) => onUpdateGrade({ lutIntensity: v })}
                  formatValue={(v) => Math.round(v * 100) + "%"}
                  color="rgba(224,120,32,0.8)"
                />

                <div className="cgp-section-title" style={{ marginTop: 14 }}>LOAD .CUBE FILE</div>
                <div className="cgp-lut-input-row">
                  <input
                    className="cgp-lut-path-input"
                    type="text"
                    placeholder="Paste or type .cube path…"
                    value={grade.lutPath ?? ""}
                    onChange={(e) => onUpdateGrade({ lutPath: e.target.value.trim() || null })}
                  />
                </div>

                <div className="cgp-lut-presets">
                  <div className="cgp-section-title" style={{ marginTop: 14 }}>PRESETS</div>
                  <div className="cgp-lut-preset-grid">
                    {[
                      { name: "Log to Rec.709", path: "luts/log_to_rec709.cube" },
                      { name: "Cinematic",       path: "luts/cinematic.cube"     },
                      { name: "Warm Vintage",    path: "luts/warm_vintage.cube"  },
                      { name: "Cool Teal",       path: "luts/cool_teal.cube"     },
                      { name: "High Contrast",   path: "luts/high_contrast.cube" },
                      { name: "Faded Film",      path: "luts/faded_film.cube"    },
                    ].map((p) => (
                      <button
                        key={p.path}
                        className={`cgp-lut-preset-btn${grade.lutPath === p.path ? " active" : ""}`}
                        onClick={() => onUpdateGrade({ lutPath: p.path })}
                        type="button"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ─── SCOPES ─── */}
            {activePanel === "scopes" && (
              <div className="cgp-scopes-panel">
                <div className="cgp-scope-selector">
                  {(["waveform","histogram","vectorscope","parade"] as const).map((s) => (
                    <button
                      key={s}
                      className={`cgp-scope-btn${activeScope === s ? " active" : ""}`}
                      onClick={() => setActiveScope(s)}
                      type="button"
                    >
                      {s === "waveform" ? "Wave" : s === "vectorscope" ? "Vector" : s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="cgp-scope-display">
                  <div className="cgp-scope-label">{activeScope.toUpperCase()}</div>
                  <ScopeCanvas type={activeScope} videoRef={videoRef} width={260} height={180} />
                </div>
              </div>
            )}
          </div>

          {/* ── Always-visible mini scopes strip ── */}
          {showScopes && activePanel !== "scopes" && (
            <div className="cgp-scope-strip">
              <div className="cgp-scope-strip-header">
                <span>WAVEFORM</span>
                <span>HISTOGRAM</span>
                <button className="cgp-scope-strip-close" onClick={() => setShowScopes(false)} type="button">✕</button>
              </div>
              <div className="cgp-scope-strip-canvases">
                <ScopeCanvas type="waveform"   videoRef={videoRef} width={130} height={80} />
                <ScopeCanvas type="histogram"  videoRef={videoRef} width={130} height={80} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
