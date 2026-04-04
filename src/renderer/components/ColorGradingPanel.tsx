/**
 * 264 Pro — Professional Color Grading Panel  (full rewrite, all bugs fixed)
 *
 * FIXES vs previous version:
 * 1. videoRef: App passes a stable useRef<HTMLVideoElement|null> (not an object literal).
 * 2. Slider CSS: uses sr-stack / sr-track / sr-fill / sr-input classes consistently;
 *    the track wrapper never sets overflow:hidden – the native input rides on top via z-index.
 * 3. cgp-section-label class used throughout; CSS added for it below in styles.css patch.
 * 4. Auto-enable: handleUpdate calls onEnableGrade THEN onUpdateGrade. Both hit the Zustand
 *    store synchronously so setColorGrade correctly merges on top of the freshly created default.
 * 5. Drag on color wheel tracked on window, not canvas, so fast mouse movement never drops drag.
 * 6. CurveEditor drag also tracked on window for same reason.
 * 7. Primary controls are ALWAYS visible (grade = colorGrade ?? createDefaultColorGrade()),
 *    regardless of whether the clip has a stored grade yet.
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

export interface ColorGradingPanelProps {
  selectedSegment: TimelineSegment | null;
  colorGrade: ColorGrade | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onEnableGrade: () => void;
  onUpdateGrade: (grade: Partial<ColorGrade>) => void;
  onResetGrade: () => void;
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
  active: boolean;
}

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

// ─── Color Wheel ──────────────────────────────────────────────────────────────

interface ColorWheelProps {
  label: string;
  value: RGBValue;
  onChange: (v: RGBValue) => void;
  onReset?: () => void;
}

function ColorWheel({ label, value, onChange, onReset }: ColorWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragging  = useRef(false);
  const valueRef  = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const RADIUS = 56;
  const SIZE   = RADIUS * 2 + 12;
  const CX     = SIZE / 2;
  const CY     = SIZE / 2;

  // ── Draw wheel ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, SIZE, SIZE);

    const imgData = ctx.createImageData(SIZE, SIZE);
    for (let py = 0; py < SIZE; py++) {
      for (let px = 0; px < SIZE; px++) {
        const dx = px - CX;
        const dy = py - CY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > RADIUS) continue;
        const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const [ri, gi, bi] = hslToRgb(hue / 360, dist / RADIUS, 0.5);
        const idx = (py * SIZE + px) * 4;
        imgData.data[idx]     = ri;
        imgData.data[idx + 1] = gi;
        imgData.data[idx + 2] = bi;
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Outer border ring
    ctx.beginPath();
    ctx.arc(CX, CY, RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Crosshair
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(CX, CY - RADIUS); ctx.lineTo(CX, CY + RADIUS); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(CX - RADIUS, CY); ctx.lineTo(CX + RADIUS, CY); ctx.stroke();

    // Indicator dot — r → X-axis, g → Y-axis (both in [-1, 1])
    const raw_ix = CX + value.r * RADIUS;
    const raw_iy = CY + value.g * RADIUS;
    const dot_d  = Math.sqrt((raw_ix - CX) ** 2 + (raw_iy - CY) ** 2);
    const ix = dot_d > RADIUS ? CX + (raw_ix - CX) / dot_d * RADIUS : raw_ix;
    const iy = dot_d > RADIUS ? CY + (raw_iy - CY) / dot_d * RADIUS : raw_iy;

    ctx.beginPath();
    ctx.arc(ix, iy, 6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ix, iy, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [value, SIZE, CX, CY, RADIUS]);

  useEffect(() => { draw(); }, [draw]);

  // Convert client coords to normalised RGB offset
  function posToRGB(clientX: number, clientY: number): RGBValue {
    const canvas = canvasRef.current;
    if (!canvas) return valueRef.current;
    const rect  = canvas.getBoundingClientRect();
    const scaleX = SIZE / rect.width;
    const scaleY = SIZE / rect.height;
    const cx = (clientX - rect.left) * scaleX;
    const cy = (clientY - rect.top)  * scaleY;
    const dx = (cx - CX) / RADIUS;
    const dy = (cy - CY) / RADIUS;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ndx  = dist > 1 ? dx / dist : dx;
    const ndy  = dist > 1 ? dy / dist : dy;
    return {
      r: Math.round(ndx * 1000) / 1000,
      g: Math.round(ndy * 1000) / 1000,
      b: valueRef.current.b,
    };
  }

  // ── Window-level drag listeners (never drop even if cursor leaves canvas) ──
  useEffect(() => {
    function onWindowMove(e: MouseEvent) {
      if (!dragging.current) return;
      onChangeRef.current(posToRGB(e.clientX, e.clientY));
    }
    function onWindowUp() { dragging.current = false; }
    window.addEventListener("mousemove", onWindowMove);
    window.addEventListener("mouseup",   onWindowUp);
    return () => {
      window.removeEventListener("mousemove", onWindowMove);
      window.removeEventListener("mouseup",   onWindowUp);
    };
  // posToRGB reads from refs, safe to omit from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleMouseDown(e: RMouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    dragging.current = true;
    onChangeRef.current(posToRGB(e.clientX, e.clientY));
  }

  function handleDoubleClick(e: RMouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    // Double-click on the wheel resets to neutral
    const resetVal: RGBValue = { r: 0, g: 0, b: 0 };
    onChangeRef.current(resetVal);
    onReset?.();
  }

  const magnitude = Math.sqrt(value.r * value.r + value.g * value.g);
  const hasOffset = magnitude > 0.005 || Math.abs(value.b) > 0.005;

  return (
    <div className="cw-wrap">
      <div className="cw-label">{label}</div>

      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="cw-canvas"
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        title="Drag to adjust color. Double-click to reset."
      />

      {/* Master luminance slider — independent of wheel drag */}
      <div className="cw-lum-row">
        <input
          type="range"
          className="cw-lum-slider"
          min={-0.5}
          max={0.5}
          step={0.002}
          value={value.b}
          onInput={(e) => onChange({ ...value, b: Number((e.target as HTMLInputElement).value) })}
          onChange={(e) => onChange({ ...value, b: Number(e.target.value) })}
        />
      </div>

      {/* RGB readout */}
      <div className="cw-value-row">
        <span className="cw-val cw-r">{value.r >= 0 ? "+" : ""}{value.r.toFixed(3)}</span>
        <span className="cw-val cw-g">{value.g >= 0 ? "+" : ""}{value.g.toFixed(3)}</span>
        <span className="cw-val cw-b">{value.b >= 0 ? "+" : ""}{value.b.toFixed(3)}</span>
      </div>

      <button
        className={`cw-reset-btn${hasOffset ? " has-offset" : ""}`}
        onClick={() => { onChange({ r: 0, g: 0, b: 0 }); onReset?.(); }}
        type="button"
        title={`Reset ${label} to neutral (or double-click the wheel)`}
        aria-label={`Reset ${label}`}
      >
        ↺
      </button>
    </div>
  );
}

// ─── Slider Row ───────────────────────────────────────────────────────────────
// The fill bar is a sibling div; the native range input sits on top with z-index.
// No overflow:hidden on the track — thumb is always fully visible and clickable.

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  resetValue?: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
  accentColor?: string;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  resetValue,
  onChange,
  formatValue,
  accentColor = "var(--accent)",
}: SliderRowProps) {
  const pct        = ((value - min) / (max - min)) * 100;
  const displayVal = formatValue ? formatValue(value) : value.toFixed(2);
  const isDefault  = resetValue !== undefined && Math.abs(value - resetValue) <= step * 0.5;

  return (
    <div className="sr-row">
      <span className="sr-label">{label}</span>

      {/* sr-stack: relative container, no overflow:hidden */}
      <div className="sr-stack">
        {/* Background track */}
        <div className="sr-track" />
        {/* Coloured fill */}
        <div
          className="sr-fill"
          style={{ width: `${pct}%`, background: accentColor }}
        />
        {/* Native range on top — full-width, z-index above fill */}
        <input
          type="range"
          className="sr-input"
          min={min}
          max={max}
          step={step}
          value={value}
          onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>

      <span
        className="sr-value"
        style={{ color: isDefault ? "var(--text-dim)" : "var(--text-hi)" }}
      >
        {displayVal}
      </span>

      {resetValue !== undefined && !isDefault && (
        <button
          className="sr-reset"
          onClick={() => onChange(resetValue)}
          type="button"
          title="Reset"
        >
          ↺
        </button>
      )}
    </div>
  );
}

// ─── Curve Editor ─────────────────────────────────────────────────────────────

interface CurveEditorProps {
  points: CurvePoint[];
  color: string;
  onChange: (pts: CurvePoint[]) => void;
  size?: number;
}

function CurveEditor({ points, color, onChange, size = 210 }: CurveEditorProps) {
  const canvasRef   = useRef<HTMLCanvasElement | null>(null);
  const dragging    = useRef<number | null>(null);
  const pointsRef   = useRef(points);
  const onChangeRef = useRef(onChange);
  const S           = size;
  useEffect(() => { pointsRef.current = points; }, [points]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#0e0e0e";
    ctx.fillRect(0, 0, S, S);

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth   = 0.5;
    for (let i = 1; i < 4; i++) {
      const p = (i / 4) * S;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
    }

    // Identity diagonal
    ctx.strokeStyle = "rgba(255,255,255,0.11)";
    ctx.lineWidth   = 0.7;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, S); ctx.lineTo(S, 0); ctx.stroke();
    ctx.setLineDash([]);

    const sorted = [...points].sort((a, b) => a.x - b.x);
    if (sorted.length >= 2) {
      // Fill under curve
      ctx.beginPath();
      ctx.moveTo(0, S);
      ctx.lineTo(sorted[0].x * S, (1 - sorted[0].y) * S);
      for (let i = 1; i < sorted.length; i++) {
        const mx = ((sorted[i - 1].x + sorted[i].x) / 2) * S;
        ctx.bezierCurveTo(
          mx, (1 - sorted[i - 1].y) * S,
          mx, (1 - sorted[i].y) * S,
          sorted[i].x * S, (1 - sorted[i].y) * S,
        );
      }
      ctx.lineTo(S, S);
      ctx.closePath();
      ctx.fillStyle = `${color}22`;
      ctx.fill();

      // Curve line
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2;
      ctx.moveTo(sorted[0].x * S, (1 - sorted[0].y) * S);
      for (let i = 1; i < sorted.length; i++) {
        const mx = ((sorted[i - 1].x + sorted[i].x) / 2) * S;
        ctx.bezierCurveTo(
          mx, (1 - sorted[i - 1].y) * S,
          mx, (1 - sorted[i].y) * S,
          sorted[i].x * S, (1 - sorted[i].y) * S,
        );
      }
      ctx.stroke();
    }

    // Control points
    for (const pt of sorted) {
      const fixed = pt.x === 0 || pt.x === 1;
      ctx.beginPath();
      ctx.arc(pt.x * S, (1 - pt.y) * S, fixed ? 3 : 5, 0, Math.PI * 2);
      ctx.fillStyle   = fixed ? "rgba(255,255,255,0.4)" : "#fff";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }
  }, [points, color, S]);

  useEffect(() => { draw(); }, [draw]);

  function ptFromCanvas(clientX: number, clientY: number): CurvePoint {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = S / rect.width;
    const sy = S / rect.height;
    return {
      x: clamp((clientX - rect.left) * sx / S, 0, 1),
      y: clamp(1 - (clientY - rect.top) * sy / S, 0, 1),
    };
  }

  // Window-level drag so mouse movement outside canvas doesn't drop the drag
  useEffect(() => {
    function onWindowMove(e: MouseEvent) {
      if (dragging.current === null) return;
      const pt  = ptFromCanvas(e.clientX, e.clientY);
      const idx = dragging.current;
      const pts = [...pointsRef.current];
      const isFixed = pts[idx].x === 0 || pts[idx].x === 1;
      pts[idx] = isFixed ? { x: pts[idx].x, y: pt.y } : pt;
      onChangeRef.current(pts);
    }
    function onWindowUp() { dragging.current = null; }
    window.addEventListener("mousemove", onWindowMove);
    window.addEventListener("mouseup",   onWindowUp);
    return () => {
      window.removeEventListener("mousemove", onWindowMove);
      window.removeEventListener("mouseup",   onWindowUp);
    };
  // ptFromCanvas reads from refs, safe
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleMouseDown(e: RMouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const pt = ptFromCanvas(e.clientX, e.clientY);
    const pts = pointsRef.current;
    let nearest = -1, minDist = 0.07;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pt.x, pts[i].y - pt.y);
      if (d < minDist) { minDist = d; nearest = i; }
    }
    if (nearest >= 0) {
      dragging.current = nearest;
    } else {
      const newPts = [...pts, pt].sort((a, b) => a.x - b.x);
      onChangeRef.current(newPts);
      dragging.current = newPts.findIndex((p) => Math.abs(p.x - pt.x) < 0.001 && Math.abs(p.y - pt.y) < 0.001);
    }
  }

  function handleDoubleClick(e: RMouseEvent<HTMLCanvasElement>) {
    const pt = ptFromCanvas(e.clientX, e.clientY);
    const filtered = pointsRef.current.filter(
      (p) => p.x === 0 || p.x === 1 || Math.hypot(p.x - pt.x, p.y - pt.y) > 0.05
    );
    if (filtered.length < pointsRef.current.length) onChangeRef.current(filtered);
  }

  return (
    <canvas
      ref={canvasRef}
      width={S}
      height={S}
      className="ce-canvas"
      style={{ cursor: "crosshair", display: "block" }}
      onMouseDown={handleMouseDown}
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

function ScopeCanvas({ type, videoRef, width = 270, height = 160 }: ScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef    = useRef<number | null>(null);
  const lastTime  = useRef(-1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    function tick() {
      const video = videoRef.current;
      if (!video || !canvas) { rafRef.current = requestAnimationFrame(tick); return; }
      if (video.paused && video.currentTime === lastTime.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastTime.current = video.currentTime;

      const tmp = document.createElement("canvas");
      tmp.width  = 96;
      tmp.height = 54;
      const tc = tmp.getContext("2d");
      if (!tc || !ctx) { rafRef.current = requestAnimationFrame(tick); return; }
      try {
        tc.drawImage(video, 0, 0, 96, 54);
        const imgData = tc.getImageData(0, 0, 96, 54);
        drawScope(ctx, imgData, type, canvas.width, canvas.height);
      } catch {
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.font      = "9px monospace";
        ctx.fillText("No signal", 6, canvas.height / 2);
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
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
  ctx.fillStyle = "#080808";
  ctx.fillRect(0, 0, w, h);
  const d = img.data;
  const n = d.length / 4;

  if (type === "waveform") {
    for (let i = 0; i < n; i++) {
      const luma = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
      const px = ((i % img.width) / img.width) * w;
      const py = (1 - luma) * h;
      ctx.fillStyle = "rgba(80,210,80,0.18)";
      ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 0.5;
    for (const ire of [0, 20, 40, 60, 80, 100]) {
      const y = (1 - ire / 100) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.font = "7px monospace";
      ctx.fillText(String(ire), 2, y - 1);
    }
  } else if (type === "histogram") {
    const rb = new Array<number>(256).fill(0);
    const gb = new Array<number>(256).fill(0);
    const bb = new Array<number>(256).fill(0);
    for (let i = 0; i < n; i++) { rb[d[i * 4]]++; gb[d[i * 4 + 1]]++; bb[d[i * 4 + 2]]++; }
    const mx = Math.max(...rb, ...gb, ...bb, 1);
    const bw = w / 256;
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * w;
      ctx.fillStyle = "rgba(255,60,60,0.55)";
      ctx.fillRect(x, h - (rb[i] / mx) * h, bw, (rb[i] / mx) * h);
      ctx.fillStyle = "rgba(60,200,60,0.55)";
      ctx.fillRect(x, h - (gb[i] / mx) * h, bw, (gb[i] / mx) * h);
      ctx.fillStyle = "rgba(60,120,255,0.55)";
      ctx.fillRect(x, h - (bb[i] / mx) * h, bw, (bb[i] / mx) * h);
    }
  } else if (type === "vectorscope") {
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.45, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.22, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < n; i++) {
      const r = d[i * 4] / 255, g = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255;
      const cb = -0.169 * r - 0.331 * g + 0.5 * b;
      const cr =  0.5   * r - 0.419 * g - 0.081 * b;
      ctx.fillStyle = "rgba(80,230,190,0.13)";
      ctx.fillRect(Math.round((0.5 + cb * 0.9) * w), Math.round((0.5 - cr * 0.9) * h), 1, 1);
    }
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fill();
  } else if (type === "parade") {
    const cW = Math.floor(w / 3);
    for (const [ci, col] of [
      [0, "rgba(255,50,50,0.8)"],
      [1, "rgba(50,220,50,0.8)"],
      [2, "rgba(50,100,255,0.8)"],
    ] as [number, string][]) {
      const bins = new Array<number>(256).fill(0);
      for (let i = 0; i < n; i++) bins[d[i * 4 + ci]]++;
      const mx = Math.max(...bins, 1);
      for (let i = 0; i < 256; i++) {
        const bh = (bins[i] / mx) * h;
        ctx.fillStyle = col;
        ctx.fillRect(ci * cW + (i / 255) * cW, h - bh, cW / 256 + 0.5, bh);
      }
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "8px monospace";
      ctx.fillText(["R", "G", "B"][ci], ci * cW + 3, 10);
    }
  }
}

// ─── Node Graph ───────────────────────────────────────────────────────────────

interface NodeGraphProps {
  nodes: ColorNode[];
  onSelectNode: (id: string) => void;
  onAddNode: () => void;
  onDeleteNode: (id: string) => void;
  onToggleNode: (id: string) => void;
}

function NodeGraph({ nodes, onSelectNode, onAddNode, onDeleteNode, onToggleNode }: NodeGraphProps) {
  return (
    <div className="ng-root">
      <div className="ng-header">
        <span className="ng-title">NODE GRAPH</span>
        <button className="ng-add-btn" onClick={onAddNode} type="button" title="Add Corrector Node">+</button>
      </div>
      <div className="ng-canvas">
        {nodes.map((node, idx) => (
          <div key={node.id} className="ng-node-group">
            {idx > 0 && (
              <div className="ng-connector">
                <svg width="28" height="14">
                  <line x1="0" y1="7" x2="24" y2="7" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
                  <polygon points="22,4 28,7 22,10" fill="rgba(255,255,255,0.28)" />
                </svg>
              </div>
            )}
            <div
              className={`ng-node${node.active ? " ng-node-active" : ""}${!node.enabled ? " ng-node-disabled" : ""}`}
              onClick={() => onSelectNode(node.id)}
            >
              <div className="ng-node-thumb">
                <div className="ng-node-thumb-inner" style={{ opacity: node.enabled ? 1 : 0.2 }} />
              </div>
              <div className="ng-node-label">{node.label}</div>
              <div className="ng-node-actions">
                <button
                  className={`ng-node-btn${node.enabled ? "" : " off"}`}
                  onClick={(e) => { e.stopPropagation(); onToggleNode(node.id); }}
                  type="button"
                  title={node.enabled ? "Disable" : "Enable"}
                >
                  {node.enabled ? "●" : "○"}
                </button>
                {nodes.length > 1 && (
                  <button
                    className="ng-node-btn del"
                    onClick={(e) => { e.stopPropagation(); onDeleteNode(node.id); }}
                    type="button"
                    title="Delete node"
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

// ─── Main ColorGradingPanel ───────────────────────────────────────────────────

export function ColorGradingPanel({
  selectedSegment,
  colorGrade,
  videoRef,
  onEnableGrade,
  onUpdateGrade,
  onResetGrade,
}: ColorGradingPanelProps) {

  const [activePanel, setActivePanel] = useState<ActivePanel>("primary");
  const [activeScope,  setActiveScope] = useState<ActiveScope>("waveform");
  const [activeCurve, setActiveCurve] = useState<CurveChannel>("master");
  const [showScopes,  setShowScopes]  = useState(true);

  const [nodes, setNodes] = useState<ColorNode[]>([
    { id: "node-1", label: "Corrector 1", type: "corrector", enabled: true, active: true },
  ]);

  // ── Auto-enable helper ──────────────────────────────────────────────────────
  // Always call onEnableGrade first if no grade exists, then immediately
  // call onUpdateGrade. Both calls hit Zustand synchronously so setColorGrade
  // will safely merge on top of the just-created default.
  const handleUpdate = useCallback((partial: Partial<ColorGrade>) => {
    if (!colorGrade) {
      onEnableGrade();
    }
    onUpdateGrade(partial);
  }, [colorGrade, onEnableGrade, onUpdateGrade]);

  // ── Working grade — always derived, never stale ──
  const grade = colorGrade ?? createDefaultColorGrade();

  // ── Node helpers ──
  function addNode() {
    const id = createId();
    setNodes((prev) => [
      ...prev.map((n) => ({ ...n, active: false })),
      { id, label: `Corrector ${prev.length + 1}`, type: "corrector" as const, enabled: true, active: true },
    ]);
  }
  function deleteNode(id: string) {
    setNodes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      if (!next.length) return prev;
      return next.map((n, i) => ({ ...n, active: i === 0 }));
    });
  }
  function toggleNode(id: string) {
    setNodes((prev) => prev.map((n) => n.id === id ? { ...n, enabled: !n.enabled } : n));
  }
  function selectNode(id: string) {
    setNodes((prev) => prev.map((n) => ({ ...n, active: n.id === id })));
  }

  // ── No segment selected ──
  if (!selectedSegment) {
    return (
      <div className="cgp-root cgp-empty">
        <div className="cgp-empty-msg">
          <div className="cgp-empty-icon">🎨</div>
          <p>Select a video clip in the timeline to start color grading.</p>
          <span>Click a clip below, then grade here.</span>
        </div>
      </div>
    );
  }

  const clipName = selectedSegment.asset?.name ?? "Untitled Clip";

  return (
    <div className="cgp-root">

      {/* ── Clip top bar ── */}
      <div className="cgp-topbar">
        <span className="cgp-clip-badge">
          <span
            className="cgp-clip-dot"
            style={{ background: colorGrade ? "var(--accent)" : "var(--text-dim)" }}
          />
          {clipName}
        </span>
        <div className="cgp-topbar-actions">
          {!colorGrade && (
            <button className="cgp-enable-btn" onClick={onEnableGrade} type="button">
              Enable Grade
            </button>
          )}
          {colorGrade && (
            <>
              {/* Bypass toggle: clicking hides/shows grade effect without deleting it */}
              <button
                className={`cgp-btn${colorGrade.bypass ? " cgp-bypass-on" : ""}`}
                onClick={() => handleUpdate({ bypass: !colorGrade.bypass })}
                type="button"
                title={colorGrade.bypass ? "Grade bypassed — click to enable" : "Click to bypass grade"}
              >
                {colorGrade.bypass ? "⊘ Bypassed" : "✓ Active"}
              </button>
              <button
                className="cgp-btn"
                onClick={() => setShowScopes((v) => !v)}
                type="button"
              >
                {showScopes ? "Hide Scopes" : "Scopes"}
              </button>
              <button className="cgp-btn muted" onClick={onResetGrade} type="button">
                Reset
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Node Graph ── */}
      <NodeGraph
        nodes={nodes}
        onSelectNode={selectNode}
        onAddNode={addNode}
        onDeleteNode={deleteNode}
        onToggleNode={toggleNode}
      />

      {/* ── Tab strip ── */}
      <div className="cgp-tabs">
        {(["primary", "curves", "lut", "scopes"] as ActivePanel[]).map((id) => (
          <button
            key={id}
            className={`cgp-tab${activePanel === id ? " active" : ""}`}
            onClick={() => setActivePanel(id)}
            type="button"
          >
            {id === "primary" ? "Primary"
              : id === "curves" ? "Curves"
              : id === "lut"    ? "LUT"
              : "Scopes"}
          </button>
        ))}
      </div>

      {/* ── Scrollable panel body ── */}
      <div className="cgp-panel-content">

        {/* ─── PRIMARY ─── */}
        {activePanel === "primary" && (
          <div className="cgp-primary">

            <div className="cgp-section-label">COLOR WHEELS</div>
            <div className="cgp-wheels-row">
              {(["lift", "gamma", "gain", "offset"] as WheelKey[]).map((key) => (
                <ColorWheel
                  key={key}
                  label={key.charAt(0).toUpperCase() + key.slice(1)}
                  value={grade[key]}
                  onChange={(v) => handleUpdate({ [key]: v })}
                />
              ))}
            </div>

            <div className="cgp-section-label" style={{ marginTop: 8 }}>PRIMARY CONTROLS</div>
            <div className="cgp-sliders-grid">
              <SliderRow
                label="Exposure"
                value={grade.exposure}
                min={-3} max={3} step={0.01}
                resetValue={0}
                accentColor="rgba(255,210,80,0.85)"
                onChange={(v) => handleUpdate({ exposure: v })}
                formatValue={(v) => (v >= 0 ? "+" : "") + v.toFixed(2)}
              />
              <SliderRow
                label="Contrast"
                value={grade.contrast}
                min={-1} max={1} step={0.01}
                resetValue={0}
                accentColor="rgba(200,200,200,0.7)"
                onChange={(v) => handleUpdate({ contrast: v })}
                formatValue={(v) => (v >= 0 ? "+" : "") + v.toFixed(2)}
              />
              <SliderRow
                label="Saturation"
                value={grade.saturation}
                min={0} max={3} step={0.01}
                resetValue={1}
                accentColor="rgba(210,80,210,0.7)"
                onChange={(v) => handleUpdate({ saturation: v })}
                formatValue={(v) => v.toFixed(2)}
              />
              <SliderRow
                label="Temperature"
                value={grade.temperature}
                min={-100} max={100} step={1}
                resetValue={0}
                accentColor="rgba(80,150,255,0.7)"
                onChange={(v) => handleUpdate({ temperature: v })}
                formatValue={(v) => (v >= 0 ? "+" : "") + v.toFixed(0) + "K"}
              />
              <SliderRow
                label="Tint"
                value={grade.tint}
                min={-100} max={100} step={1}
                resetValue={0}
                accentColor="rgba(120,200,100,0.7)"
                onChange={(v) => handleUpdate({ tint: v })}
                formatValue={(v) => (v >= 0 ? "+" : "") + v.toFixed(0)}
              />
            </div>
          </div>
        )}

        {/* ─── CURVES ─── */}
        {activePanel === "curves" && (
          <div className="cgp-curves">
            <div className="cgp-section-label">RGB CURVES</div>
            <div className="cgp-curve-channels">
              {(
                [
                  { id: "master"   as CurveChannel, label: "M",   color: "#c0c0c0" },
                  { id: "red"      as CurveChannel, label: "R",   color: "#ff5555" },
                  { id: "green"    as CurveChannel, label: "G",   color: "#55cc55" },
                  { id: "blue"     as CurveChannel, label: "B",   color: "#5599ff" },
                  { id: "hueVsHue" as CurveChannel, label: "H/H", color: "#ffaa44" },
                  { id: "hueVsSat" as CurveChannel, label: "H/S", color: "#aa44ff" },
                ] as const
              ).map(({ id, label, color }) => (
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
                  activeCurve === "hueVsHue" ? "#ffaa44" : "#aa44ff"
                }
                size={200}
                onChange={(pts) =>
                  handleUpdate({ curves: { ...grade.curves, [activeCurve]: pts } })
                }
              />
              <button
                className="cgp-btn muted"
                style={{ marginTop: 6, alignSelf: "flex-start" }}
                type="button"
                onClick={() =>
                  handleUpdate({
                    curves: {
                      ...grade.curves,
                      [activeCurve]: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
                    },
                  })
                }
              >
                Reset Curve
              </button>
            </div>
            <p className="cgp-hint">Click · drag to move · double-click to remove</p>
          </div>
        )}

        {/* ─── LUT ─── */}
        {activePanel === "lut" && (
          <div className="cgp-lut">
            <div className="cgp-section-label">LUT — LOOK-UP TABLE</div>
            <div className="cgp-lut-status">
              {grade.lutPath ? (
                <div className="cgp-lut-active-row">
                  <span className="cgp-lut-dot active" />
                  <span className="cgp-lut-name">{grade.lutPath.split(/[\\/]/).pop()}</span>
                  <button
                    className="cgp-btn danger"
                    onClick={() => handleUpdate({ lutPath: null })}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="cgp-lut-inactive">
                  <span className="cgp-lut-dot" />
                  <span>No LUT applied</span>
                </div>
              )}
            </div>

            <div className="cgp-section-label" style={{ marginTop: 12 }}>INTENSITY</div>
            <div style={{ padding: "4px 10px" }}>
              <SliderRow
                label="LUT Mix"
                value={grade.lutIntensity}
                min={0} max={1} step={0.01}
                resetValue={1}
                accentColor="rgba(224,120,32,0.85)"
                onChange={(v) => handleUpdate({ lutIntensity: v })}
                formatValue={(v) => Math.round(v * 100) + "%"}
              />
            </div>

            <div className="cgp-section-label" style={{ marginTop: 12 }}>LOAD .CUBE PATH</div>
            <div className="cgp-lut-input-row">
              <input
                className="cgp-lut-path-input"
                type="text"
                placeholder="Paste .cube file path…"
                value={grade.lutPath ?? ""}
                onChange={(e) =>
                  handleUpdate({ lutPath: e.target.value.trim() || null })
                }
              />
            </div>

            <div className="cgp-section-label" style={{ marginTop: 12 }}>PRESET LUTS</div>
            <div className="cgp-lut-preset-grid">
              {[
                { name: "Log → Rec.709",  path: "luts/log_to_rec709.cube" },
                { name: "Cinematic",       path: "luts/cinematic.cube"     },
                { name: "Warm Vintage",    path: "luts/warm_vintage.cube"  },
                { name: "Cool Teal",       path: "luts/cool_teal.cube"     },
                { name: "High Contrast",   path: "luts/high_contrast.cube" },
                { name: "Faded Film",      path: "luts/faded_film.cube"    },
              ].map((p) => (
                <button
                  key={p.path}
                  className={`cgp-lut-preset-btn${grade.lutPath === p.path ? " active" : ""}`}
                  onClick={() => handleUpdate({ lutPath: p.path })}
                  type="button"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ─── SCOPES ─── */}
        {activePanel === "scopes" && (
          <div className="cgp-scopes-panel">
            <div className="cgp-scope-selector">
              {(["waveform", "histogram", "vectorscope", "parade"] as ActiveScope[]).map((s) => (
                <button
                  key={s}
                  className={`cgp-scope-btn${activeScope === s ? " active" : ""}`}
                  onClick={() => setActiveScope(s)}
                  type="button"
                >
                  {s === "waveform" ? "Wave"
                    : s === "vectorscope" ? "Vector"
                    : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <div className="cgp-scope-display">
              <div className="cgp-scope-label">{activeScope.toUpperCase()}</div>
              <ScopeCanvas type={activeScope} videoRef={videoRef} width={270} height={190} />
            </div>
          </div>
        )}
      </div>

      {/* ── Always-visible scope strip (when grade active, not on Scopes tab) ── */}
      {colorGrade && showScopes && activePanel !== "scopes" && (
        <div className="cgp-scope-strip">
          <div className="cgp-scope-strip-header">
            <span>WAVEFORM</span>
            <span>HISTOGRAM</span>
            <button
              className="cgp-scope-strip-close"
              onClick={() => setShowScopes(false)}
              type="button"
            >
              ✕
            </button>
          </div>
          <div className="cgp-scope-strip-canvases">
            <ScopeCanvas type="waveform"  videoRef={videoRef} width={130} height={80} />
            <ScopeCanvas type="histogram" videoRef={videoRef} width={130} height={80} />
          </div>
        </div>
      )}
    </div>
  );
}
