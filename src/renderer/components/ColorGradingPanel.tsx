import { useCallback, useEffect, useRef, useState } from "react";
import type { ColorGrade, CurvePoint, RGBValue } from "../../shared/models";
import { createDefaultColorGrade } from "../../shared/models";
import type { TimelineSegment } from "../../shared/timeline";

interface ColorGradingPanelProps {
  selectedSegment: TimelineSegment | null;
  colorGrade: ColorGrade | null;
  onEnableGrade: () => void;
  onUpdateGrade: (grade: Partial<ColorGrade>) => void;
  onResetGrade: () => void;
}

type ActiveScope = "waveform" | "vectorscope" | "histogram" | "parade";
type ActiveTab = "primary" | "curves" | "scopes" | "lut";
type WheelTarget = "lift" | "gamma" | "gain" | "offset";
type CurveChannel = "master" | "red" | "green" | "blue";

// ─── Color Wheel ──────────────────────────────────────────────────────────────

interface ColorWheelProps {
  label: string;
  value: RGBValue;
  onChange: (v: RGBValue) => void;
}

function ColorWheel({ label, value, onChange }: ColorWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDragging = useRef(false);

  const RADIUS = 52;
  const SIZE = RADIUS * 2 + 8;
  const CX = SIZE / 2;
  const CY = SIZE / 2;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawWheel(ctx, SIZE, CX, CY, RADIUS, value);
  }, [value]);

  function drawWheel(
    ctx: CanvasRenderingContext2D,
    size: number,
    cx: number,
    cy: number,
    r: number,
    v: RGBValue
  ) {
    ctx.clearRect(0, 0, size, size);

    // Color wheel gradient
    const imageData = ctx.createImageData(size, size);
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const dx = px - cx;
        const dy = py - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > r) continue;
        const hue = (Math.atan2(dy, dx) * 180) / Math.PI + 180;
        const sat = dist / r;
        const [ri, gi, bi] = hslToRgb(hue / 360, sat, 0.5);
        const idx = (py * size + px) * 4;
        imageData.data[idx] = ri;
        imageData.data[idx + 1] = gi;
        imageData.data[idx + 2] = bi;
        imageData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    // Border
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Indicator dot
    const indicatorX = cx + v.r * r;
    const indicatorY = cy + v.g * r;  // simplified mapping
    ctx.beginPath();
    ctx.arc(indicatorX, indicatorY, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function handleMouse(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDragging.current && e.type !== "mousedown") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = (e.clientX - rect.left - CX) / RADIUS;
    const dy = (e.clientY - rect.top - CY) / RADIUS;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const clampedDx = dist > 1 ? dx / dist : dx;
    const clampedDy = dist > 1 ? dy / dist : dy;
    onChange({ r: clampedDx, g: clampedDy, b: value.b });
  }

  return (
    <div className="color-wheel-wrap">
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="color-wheel-canvas"
        onMouseDown={(e) => { isDragging.current = true; handleMouse(e); }}
        onMouseMove={handleMouse}
        onMouseUp={() => { isDragging.current = false; }}
        onMouseLeave={() => { isDragging.current = false; }}
      />
      <div className="color-wheel-label">{label}</div>
      <div className="color-wheel-sliders">
        {(["r", "g", "b"] as const).map((ch) => (
          <input
            key={ch}
            type="range"
            min={-0.5}
            max={0.5}
            step={0.005}
            value={value[ch]}
            className={`wheel-slider ${ch}`}
            onChange={(e) => onChange({ ...value, [ch]: Number(e.target.value) })}
          />
        ))}
      </div>
    </div>
  );
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

// ─── Curve Editor ─────────────────────────────────────────────────────────────

interface CurveEditorProps {
  points: CurvePoint[];
  color: string;
  onChange: (pts: CurvePoint[]) => void;
}

function CurveEditor({ points, color, onChange }: CurveEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingIdx = useRef<number | null>(null);
  const SIZE = 180;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, SIZE, SIZE);

    // Background
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const p = (i / 4) * SIZE;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(SIZE, p);
      ctx.stroke();
    }

    // Diagonal reference
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.moveTo(0, SIZE);
    ctx.lineTo(SIZE, 0);
    ctx.stroke();

    // Curve
    const sorted = [...points].sort((a, b) => a.x - b.x);
    if (sorted.length >= 2) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.moveTo(sorted[0].x * SIZE, (1 - sorted[0].y) * SIZE);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        const mx = (prev.x + curr.x) / 2 * SIZE;
        const my1 = (1 - prev.y) * SIZE;
        const my2 = (1 - curr.y) * SIZE;
        ctx.bezierCurveTo(mx, my1, mx, my2, curr.x * SIZE, (1 - curr.y) * SIZE);
      }
      ctx.stroke();
    }

    // Control points
    for (const pt of sorted) {
      ctx.beginPath();
      ctx.arc(pt.x * SIZE, (1 - pt.y) * SIZE, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [points, color]);

  useEffect(() => { draw(); }, [draw]);

  function getPoint(e: React.MouseEvent<HTMLCanvasElement>): CurvePoint {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / SIZE)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / SIZE))
    };
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const pt = getPoint(e);
    // Find nearest point
    let nearest = -1;
    let minDist = 0.04;
    for (let i = 0; i < points.length; i++) {
      const d = Math.sqrt((points[i].x - pt.x) ** 2 + (points[i].y - pt.y) ** 2);
      if (d < minDist) { minDist = d; nearest = i; }
    }

    if (nearest >= 0) {
      draggingIdx.current = nearest;
    } else {
      // Add new point
      const newPts = [...points, pt].sort((a, b) => a.x - b.x);
      onChange(newPts);
      draggingIdx.current = newPts.findIndex((p) => p.x === pt.x && p.y === pt.y);
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (draggingIdx.current === null) return;
    const pt = getPoint(e);
    const newPts = [...points];
    newPts[draggingIdx.current] = pt;
    onChange(newPts);
  }

  function handleMouseUp() {
    draggingIdx.current = null;
  }

  function handleDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const pt = getPoint(e);
    const newPts = points.filter((p) => Math.sqrt((p.x - pt.x) ** 2 + (p.y - pt.y) ** 2) > 0.04);
    if (newPts.length < points.length) onChange(newPts);
  }

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      className="curve-editor"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={handleDoubleClick}
    />
  );
}

// ─── Scope Canvas ─────────────────────────────────────────────────────────────

interface ScopeCanvasProps {
  type: ActiveScope;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

function ScopeCanvas({ type, videoRef }: ScopeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let lastFrame = -1;

    function render() {
      const v = videoRef.current;
      if (!v || v.paused && v.currentTime === lastFrame) {
        rafRef.current = requestAnimationFrame(render);
        return;
      }
      lastFrame = v.currentTime;

      // Sample video frame
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = 80;
      tempCanvas.height = 45;
      const tempCtx = tempCanvas.getContext("2d");
      if (!tempCtx || !canvas) {
        rafRef.current = requestAnimationFrame(render);
        return;
      }

      try {
        tempCtx.drawImage(v, 0, 0, 80, 45);
        const imageData = tempCtx.getImageData(0, 0, 80, 45);
        drawScope(ctx, imageData, type, canvas.width, canvas.height);
      } catch {
        // Cross-origin or decode error
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.font = "10px monospace";
        ctx.fillText("Scope unavailable", 10, canvas.height / 2);
      }

      rafRef.current = requestAnimationFrame(render);
    }

    rafRef.current = requestAnimationFrame(render);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [type, videoRef]);

  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={120}
      className="scope-canvas"
    />
  );
}

function drawScope(
  ctx: CanvasRenderingContext2D,
  imageData: ImageData,
  type: ActiveScope,
  w: number,
  h: number
): void {
  ctx.fillStyle = "#0d0d0d";
  ctx.fillRect(0, 0, w, h);

  const data = imageData.data;
  const pixels = data.length / 4;

  if (type === "waveform") {
    // Waveform: x=horizontal position, y=luminance
    for (let i = 0; i < pixels; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const px = (i % imageData.width) / imageData.width * w;
      const py = (1 - luma) * h;
      ctx.fillStyle = `rgba(100,200,100,0.15)`;
      ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
    }
    // IRE lines
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 0.5;
    for (const ire of [0, 25, 50, 75, 100]) {
      const y = (1 - ire / 100) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "8px monospace";
      ctx.fillText(String(ire), 2, y - 1);
    }
  } else if (type === "histogram") {
    const bins = new Array(256).fill(0);
    for (let i = 0; i < pixels; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      bins[luma]++;
    }
    const max = Math.max(...bins);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * w;
      const barH = (bins[i] / max) * h;
      ctx.fillStyle = "rgba(140,200,255,0.5)";
      ctx.fillRect(x, h - barH, w / 256, barH);
    }
  } else if (type === "vectorscope") {
    for (let i = 0; i < pixels; i++) {
      const r = data[i * 4] / 255;
      const g = data[i * 4 + 1] / 255;
      const b = data[i * 4 + 2] / 255;
      const cb = -0.169 * r - 0.331 * g + 0.5 * b;
      const cr = 0.5 * r - 0.419 * g - 0.081 * b;
      const px = (0.5 + cb) * w;
      const py = (0.5 - cr) * h;
      ctx.fillStyle = "rgba(80,220,180,0.12)";
      ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
    }
    // Center dot
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 2, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
  } else if (type === "parade") {
    // RGB parade
    const cW = w / 3;
    for (const [ci, channel, col] of [[0, "R", "rgba(255,60,60,0.8)"], [1, "G", "rgba(60,255,60,0.8)"], [2, "B", "rgba(60,120,255,0.8)"]] as Array<[number, string, string]>) {
      const bins = new Array(256).fill(0);
      for (let i = 0; i < pixels; i++) {
        bins[data[i * 4 + ci]]++;
      }
      const max = Math.max(...bins);
      for (let i = 0; i < 256; i++) {
        const x = ci * cW + (i / 255) * cW;
        const barH = (bins[i] / max) * h;
        ctx.fillStyle = col;
        ctx.fillRect(x, h - barH, cW / 256, barH);
      }
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "9px monospace";
      ctx.fillText(channel, ci * cW + 4, 12);
    }
  }
}

// ─── Main ColorGradingPanel ───────────────────────────────────────────────────

interface FullColorGradingPanelProps extends ColorGradingPanelProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function ColorGradingPanel({
  selectedSegment,
  colorGrade,
  videoRef,
  onEnableGrade,
  onUpdateGrade,
  onResetGrade
}: FullColorGradingPanelProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("primary");
  const [activeScope, setActiveScope] = useState<ActiveScope>("waveform");
  const [activeCurve, setActiveCurve] = useState<CurveChannel>("master");

  const grade = colorGrade ?? createDefaultColorGrade();

  if (!selectedSegment) {
    return (
      <div className="color-panel color-panel-empty">
        <p>Select a video clip to apply color grading.</p>
      </div>
    );
  }

  if (!colorGrade) {
    return (
      <div className="color-panel color-panel-empty">
        <p>No color grade applied to this clip.</p>
        <button className="panel-action" onClick={onEnableGrade} type="button">
          Enable Color Grade
        </button>
      </div>
    );
  }

  const TABS: Array<{ id: ActiveTab; label: string }> = [
    { id: "primary", label: "Primary" },
    { id: "curves", label: "Curves" },
    { id: "scopes", label: "Scopes" },
    { id: "lut", label: "LUT" }
  ];

  return (
    <div className="color-panel">
      <div className="color-panel-header">
        <div className="color-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`color-tab${activeTab === t.id ? " active" : ""}`}
              onClick={() => setActiveTab(t.id)}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>
        <button className="panel-action muted small" onClick={onResetGrade} type="button">
          Reset
        </button>
      </div>

      {/* ── Primary Tab ── */}
      {activeTab === "primary" && (
        <div className="color-primary">
          {/* Wheels */}
          <div className="color-wheels-row">
            {([
              { key: "lift" as const, label: "Lift" },
              { key: "gamma" as const, label: "Gamma" },
              { key: "gain" as const, label: "Gain" },
              { key: "offset" as const, label: "Offset" }
            ]).map(({ key, label }) => (
              <ColorWheel
                key={key}
                label={label}
                value={grade[key]}
                onChange={(v) => onUpdateGrade({ [key]: v })}
              />
            ))}
          </div>

          {/* Sliders */}
          <div className="color-sliders">
            {([
              { key: "exposure" as const, label: "Exposure", min: -3, max: 3, step: 0.01 },
              { key: "contrast" as const, label: "Contrast", min: -1, max: 1, step: 0.01 },
              { key: "saturation" as const, label: "Saturation", min: 0, max: 3, step: 0.01 },
              { key: "temperature" as const, label: "Temperature", min: -100, max: 100, step: 1 },
              { key: "tint" as const, label: "Tint", min: -100, max: 100, step: 1 }
            ]).map(({ key, label, min, max, step }) => (
              <div key={key} className="color-slider-row">
                <label>{label}</label>
                <input
                  type="range" min={min} max={max} step={step}
                  value={grade[key] as number}
                  onChange={(e) => onUpdateGrade({ [key]: Number(e.target.value) })}
                />
                <span>{typeof grade[key] === "number" ? (grade[key] as number).toFixed(2) : grade[key]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Curves Tab ── */}
      {activeTab === "curves" && (
        <div className="color-curves-tab">
          <div className="curve-channel-selector">
            {(["master", "red", "green", "blue"] as const).map((ch) => (
              <button
                key={ch}
                className={`curve-ch-btn ${ch}${activeCurve === ch ? " active" : ""}`}
                onClick={() => setActiveCurve(ch)}
                type="button"
              >
                {ch.charAt(0).toUpperCase()}
              </button>
            ))}
          </div>
          <CurveEditor
            points={grade.curves[activeCurve]}
            color={activeCurve === "master" ? "#aaa" : activeCurve === "red" ? "#f66" : activeCurve === "green" ? "#6c6" : "#69f"}
            onChange={(pts) => onUpdateGrade({ curves: { ...grade.curves, [activeCurve]: pts } })}
          />
          <p className="curve-hint">Click to add points · Double-click to remove · Drag to move</p>
        </div>
      )}

      {/* ── Scopes Tab ── */}
      {activeTab === "scopes" && (
        <div className="color-scopes-tab">
          <div className="scope-selector">
            {(["waveform", "vectorscope", "histogram", "parade"] as const).map((s) => (
              <button
                key={s}
                className={`scope-btn${activeScope === s ? " active" : ""}`}
                onClick={() => setActiveScope(s)}
                type="button"
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <ScopeCanvas type={activeScope} videoRef={videoRef} />
        </div>
      )}

      {/* ── LUT Tab ── */}
      {activeTab === "lut" && (
        <div className="color-lut-tab">
          <p className="lut-current">
            {grade.lutPath ? `LUT: ${grade.lutPath.split("/").pop()}` : "No LUT applied"}
          </p>
          <div className="color-slider-row">
            <label>Intensity</label>
            <input
              type="range" min={0} max={1} step={0.01}
              value={grade.lutIntensity}
              onChange={(e) => onUpdateGrade({ lutIntensity: Number(e.target.value) })}
            />
            <span>{Math.round(grade.lutIntensity * 100)}%</span>
          </div>
          <p className="lut-hint">
            LUT import requires saving the .cube file to the project directory and entering the path below.
          </p>
          <input
            className="lut-path-input"
            type="text"
            placeholder="/path/to/lut.cube"
            value={grade.lutPath ?? ""}
            onChange={(e) => onUpdateGrade({ lutPath: e.target.value || null })}
          />
          {grade.lutPath && (
            <button
              className="panel-action muted small"
              onClick={() => onUpdateGrade({ lutPath: null })}
              type="button"
            >
              Clear LUT
            </button>
          )}
        </div>
      )}
    </div>
  );
}
