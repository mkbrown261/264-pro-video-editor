import { useCallback, useEffect, useRef, useState } from "react";
import type { BezierPoint, ClipMask, MaskShape, MaskType, Vec2 } from "../../shared/models";
import { createId } from "../../shared/models";

interface MaskingCanvasProps {
  width: number;
  height: number;
  masks: ClipMask[];
  selectedMaskId: string | null;
  activeTool: MaskTool;
  playheadFrame: number;
  onAddMask: (mask: ClipMask) => void;
  onUpdateMask: (maskId: string, updates: Partial<ClipMask>) => void;
  onSelectMask: (maskId: string | null) => void;
}

export type MaskTool = "none" | "rectangle" | "ellipse" | "bezier" | "select" | "track";

interface DrawState {
  isDrawing: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface BezierDrawState {
  points: BezierPoint[];
  isClosing: boolean;
}

// ─── Interpolation helpers ────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function cubicBezierPoint(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  t: number
): Vec2 {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y
  };
}

function getInterpolatedMaskShape(
  mask: ClipMask,
  frame: number
): MaskShape {
  const kf = mask.keyframes;
  const shape = { ...mask.shape };

  function interpolateKF(keyframes: Array<{ frame: number; value: number }> | undefined, fallback: number): number {
    if (!keyframes || keyframes.length === 0) return fallback;
    if (keyframes.length === 1) return keyframes[0].value;
    const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);
    if (frame <= sorted[0].frame) return sorted[0].value;
    if (frame >= sorted[sorted.length - 1].frame) return sorted[sorted.length - 1].value;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (frame >= a.frame && frame <= b.frame) {
        const t = (frame - a.frame) / (b.frame - a.frame);
        return lerp(a.value, b.value, t);
      }
    }
    return fallback;
  }

  if (kf.x) shape.x = interpolateKF(kf.x, shape.x);
  if (kf.y) shape.y = interpolateKF(kf.y, shape.y);
  if (kf.width) shape.width = interpolateKF(kf.width, shape.width);
  if (kf.height) shape.height = interpolateKF(kf.height, shape.height);
  if (kf.rotation) shape.rotation = interpolateKF(kf.rotation, shape.rotation);

  return shape;
}

// ─── Canvas drawing ───────────────────────────────────────────────────────────

function drawMaskOnCanvas(
  ctx: CanvasRenderingContext2D,
  shape: MaskShape,
  isSelected: boolean,
  inverted: boolean,
  opacity: number,
  canvasWidth: number,
  canvasHeight: number
): void {
  ctx.save();

  const x = shape.x * canvasWidth;
  const y = shape.y * canvasHeight;
  const w = shape.width * canvasWidth;
  const h = shape.height * canvasHeight;

  ctx.beginPath();

  if (shape.type === "rectangle") {
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((shape.rotation * Math.PI) / 180);
    ctx.rect(-w / 2, -h / 2, w, h);
  } else if (shape.type === "ellipse") {
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((shape.rotation * Math.PI) / 180);
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (shape.type === "bezier" && shape.points.length >= 2) {
    const pts = shape.points;
    ctx.moveTo(pts[0].point.x * canvasWidth, pts[0].point.y * canvasHeight);
    for (let i = 0; i < pts.length - 1; i++) {
      const curr = pts[i];
      const next = pts[i + 1];
      ctx.bezierCurveTo(
        curr.handleOut.x * canvasWidth,
        curr.handleOut.y * canvasHeight,
        next.handleIn.x * canvasWidth,
        next.handleIn.y * canvasHeight,
        next.point.x * canvasWidth,
        next.point.y * canvasHeight
      );
    }
    if (pts.length >= 3) {
      const last = pts[pts.length - 1];
      const first = pts[0];
      ctx.bezierCurveTo(
        last.handleOut.x * canvasWidth,
        last.handleOut.y * canvasHeight,
        first.handleIn.x * canvasWidth,
        first.handleIn.y * canvasHeight,
        first.point.x * canvasWidth,
        first.point.y * canvasHeight
      );
    }
    ctx.closePath();
  }

  // Fill
  ctx.fillStyle = isSelected
    ? `rgba(79, 142, 247, ${inverted ? opacity * 0.35 : opacity * 0.25})`
    : `rgba(255, 255, 255, ${inverted ? opacity * 0.2 : opacity * 0.15})`;
  ctx.fill();

  // Stroke
  ctx.strokeStyle = isSelected ? "#4f8ef7" : "rgba(255,255,255,0.6)";
  ctx.lineWidth = isSelected ? 2 : 1;
  ctx.setLineDash(isSelected ? [] : [4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();

  // Control handles for selected masks
  if (isSelected && shape.type !== "bezier") {
    drawRectHandles(ctx, shape, canvasWidth, canvasHeight);
  } else if (isSelected && shape.type === "bezier") {
    drawBezierHandles(ctx, shape, canvasWidth, canvasHeight);
  }
}

function drawRectHandles(
  ctx: CanvasRenderingContext2D,
  shape: MaskShape,
  w: number,
  h: number
): void {
  const cx = (shape.x + shape.width / 2) * w;
  const cy = (shape.y + shape.height / 2) * h;
  const hw = (shape.width / 2) * w;
  const hh = (shape.height / 2) * h;
  const rad = (shape.rotation * Math.PI) / 180;

  const corners: Array<[number, number]> = [
    [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh],
    [0, -hh], [hw, 0], [0, hh], [-hw, 0]
  ];

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad);

  for (const [dx, dy] of corners) {
    ctx.beginPath();
    ctx.arc(dx, dy, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "#4f8ef7";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();
}

function drawBezierHandles(
  ctx: CanvasRenderingContext2D,
  shape: MaskShape,
  cw: number,
  ch: number
): void {
  for (const pt of shape.points) {
    const px = pt.point.x * cw;
    const py = pt.point.y * ch;
    const inX = pt.handleIn.x * cw;
    const inY = pt.handleIn.y * ch;
    const outX = pt.handleOut.x * cw;
    const outY = pt.handleOut.y * ch;

    // Handle lines
    ctx.beginPath();
    ctx.moveTo(inX, inY);
    ctx.lineTo(px, py);
    ctx.lineTo(outX, outY);
    ctx.strokeStyle = "rgba(79,142,247,0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Anchor point
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "#4f8ef7";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Handle dots
    for (const [hx, hy] of [[inX, inY], [outX, outY]]) {
      ctx.beginPath();
      ctx.arc(hx, hy, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#4f8ef7";
      ctx.fill();
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MaskingCanvas({
  width,
  height,
  masks,
  selectedMaskId,
  activeTool,
  playheadFrame,
  onAddMask,
  onUpdateMask,
  onSelectMask
}: MaskingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawState, setDrawState] = useState<DrawState | null>(null);
  const [bezierState, setBezierState] = useState<BezierDrawState | null>(null);
  const propsRef = useRef({ onAddMask, onUpdateMask, onSelectMask, activeTool, masks, selectedMaskId, playheadFrame });
  useEffect(() => {
    propsRef.current = { onAddMask, onUpdateMask, onSelectMask, activeTool, masks, selectedMaskId, playheadFrame };
  });

  // ── Redraw canvas ──────────────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw all existing masks
    for (const mask of propsRef.current.masks) {
      const shape = getInterpolatedMaskShape(mask, propsRef.current.playheadFrame);
      drawMaskOnCanvas(
        ctx,
        shape,
        mask.id === propsRef.current.selectedMaskId,
        mask.inverted,
        mask.opacity,
        canvas.width,
        canvas.height
      );
    }

    // Draw in-progress shape
    const ds = drawState;
    if (ds) {
      const x = Math.min(ds.startX, ds.currentX) / canvas.width;
      const y = Math.min(ds.startY, ds.currentY) / canvas.height;
      const w = Math.abs(ds.currentX - ds.startX) / canvas.width;
      const h = Math.abs(ds.currentY - ds.startY) / canvas.height;
      ctx.save();
      ctx.strokeStyle = "#4f8ef7";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      const tool = propsRef.current.activeTool;
      if (tool === "rectangle") {
        ctx.rect(x * canvas.width, y * canvas.height, w * canvas.width, h * canvas.height);
      } else if (tool === "ellipse") {
        ctx.ellipse(
          (x + w / 2) * canvas.width, (y + h / 2) * canvas.height,
          (w / 2) * canvas.width, (h / 2) * canvas.height,
          0, 0, Math.PI * 2
        );
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Draw in-progress bezier
    const bs = bezierState;
    if (bs && bs.points.length > 0) {
      ctx.save();
      ctx.strokeStyle = "#4f8ef7";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const first = bs.points[0];
      ctx.moveTo(first.point.x * canvas.width, first.point.y * canvas.height);
      for (let i = 0; i < bs.points.length - 1; i++) {
        const curr = bs.points[i];
        const nxt = bs.points[i + 1];
        ctx.bezierCurveTo(
          curr.handleOut.x * canvas.width, curr.handleOut.y * canvas.height,
          nxt.handleIn.x * canvas.width, nxt.handleIn.y * canvas.height,
          nxt.point.x * canvas.width, nxt.point.y * canvas.height
        );
      }
      ctx.stroke();
      // Draw points
      for (const pt of bs.points) {
        ctx.beginPath();
        ctx.arc(pt.point.x * canvas.width, pt.point.y * canvas.height, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#4f8ef7";
        ctx.fill();
      }
      ctx.restore();
    }
  }, [drawState, bezierState, masks, selectedMaskId, playheadFrame]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // ── Mouse handlers ─────────────────────────────────────────────────────────

  function getCanvasXY(e: React.MouseEvent<HTMLCanvasElement>): [number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const tool = activeTool;
    const [cx, cy] = getCanvasXY(e);

    if (tool === "rectangle" || tool === "ellipse") {
      setDrawState({ isDrawing: true, startX: cx, startY: cy, currentX: cx, currentY: cy });
      return;
    }

    if (tool === "bezier") {
      const normX = cx / (canvasRef.current?.width ?? 1);
      const normY = cy / (canvasRef.current?.height ?? 1);
      const newPoint: BezierPoint = {
        point: { x: normX, y: normY },
        handleIn: { x: normX - 0.03, y: normY },
        handleOut: { x: normX + 0.03, y: normY }
      };

      // Check if closing
      if (bezierState && bezierState.points.length >= 3) {
        const first = bezierState.points[0];
        const dx = first.point.x - normX;
        const dy = first.point.y - normY;
        if (Math.sqrt(dx * dx + dy * dy) < 0.02) {
          // Close the path
          commitBezierMask(bezierState.points);
          setBezierState(null);
          return;
        }
      }

      setBezierState((prev) => ({
        points: [...(prev?.points ?? []), newPoint],
        isClosing: false
      }));
      return;
    }

    if (tool === "select") {
      // Hit-test on existing masks
      const canvas = canvasRef.current;
      if (!canvas) return;
      const normX = cx / canvas.width;
      const normY = cy / canvas.height;
      let hit: string | null = null;

      for (const mask of [...masks].reverse()) {
        const shape = getInterpolatedMaskShape(mask, playheadFrame);
        if (isPointInMask(normX, normY, shape)) {
          hit = mask.id;
          break;
        }
      }
      onSelectMask(hit);
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawState) return;
    const [cx, cy] = getCanvasXY(e);
    setDrawState((prev) => prev ? { ...prev, currentX: cx, currentY: cy } : null);
  }

  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawState) return;
    const [cx, cy] = getCanvasXY(e);
    const canvas = canvasRef.current;
    if (!canvas) return;

    const x = Math.min(drawState.startX, cx) / canvas.width;
    const y = Math.min(drawState.startY, cy) / canvas.height;
    const w = Math.abs(cx - drawState.startX) / canvas.width;
    const h = Math.abs(cy - drawState.startY) / canvas.height;

    if (w < 0.01 || h < 0.01) { setDrawState(null); return; }

    const type: MaskType = activeTool === "ellipse" ? "ellipse" : "rectangle";
    const mask: ClipMask = {
      id: createId(),
      name: `${type.charAt(0).toUpperCase()}${type.slice(1)} Mask`,
      shape: {
        type,
        x, y, width: w, height: h,
        rotation: 0,
        points: []
      },
      feather: 0,
      opacity: 1,
      inverted: false,
      expansion: 0,
      trackingEnabled: false,
      trackingData: [],
      keyframes: {}
    };

    onAddMask(mask);
    onSelectMask(mask.id);
    setDrawState(null);
  }

  function handleDoubleClick() {
    if (activeTool === "bezier" && bezierState && bezierState.points.length >= 3) {
      commitBezierMask(bezierState.points);
      setBezierState(null);
    }
  }

  function commitBezierMask(points: BezierPoint[]) {
    const mask: ClipMask = {
      id: createId(),
      name: "Bezier Mask",
      shape: {
        type: "bezier",
        x: 0, y: 0, width: 1, height: 1,
        rotation: 0,
        points: [...points]
      },
      feather: 0,
      opacity: 1,
      inverted: false,
      expansion: 0,
      trackingEnabled: false,
      trackingData: [],
      keyframes: {}
    };
    propsRef.current.onAddMask(mask);
    propsRef.current.onSelectMask(mask.id);
  }

  function isPointInMask(nx: number, ny: number, shape: MaskShape): boolean {
    if (shape.type === "bezier") return false; // simplified for now
    const cx = shape.x + shape.width / 2;
    const cy = shape.y + shape.height / 2;
    const rad = (-shape.rotation * Math.PI) / 180;
    const dx = nx - cx;
    const dy = ny - cy;
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
    if (shape.type === "ellipse") {
      return (rx / (shape.width / 2)) ** 2 + (ry / (shape.height / 2)) ** 2 <= 1;
    }
    return Math.abs(rx) <= shape.width / 2 && Math.abs(ry) <= shape.height / 2;
  }

  const cursor =
    activeTool === "rectangle" || activeTool === "ellipse" ? "crosshair" :
    activeTool === "bezier" ? "crosshair" :
    activeTool === "select" ? "pointer" : "default";

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="masking-canvas"
      style={{ cursor, position: "absolute", inset: 0, pointerEvents: activeTool === "none" ? "none" : "auto" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
    />
  );
}

// ─── Mask Inspector sub-panel ─────────────────────────────────────────────────

interface MaskInspectorProps {
  clipId: string;
  masks: ClipMask[];
  selectedMaskId: string | null;
  activeTool: MaskTool;
  playheadFrame: number;
  onSelectMask: (id: string | null) => void;
  onSetActiveTool: (tool: MaskTool) => void;
  onAddMask: (mask: ClipMask) => void;
  onUpdateMask: (maskId: string, updates: Partial<ClipMask>) => void;
  onRemoveMask: (maskId: string) => void;
}

export function MaskInspector({
  masks,
  selectedMaskId,
  activeTool,
  onSelectMask,
  onSetActiveTool,
  onUpdateMask,
  onRemoveMask
}: MaskInspectorProps) {
  const selectedMask = masks.find((m) => m.id === selectedMaskId) ?? null;

  const TOOLS: Array<{ label: string; value: MaskTool; icon: string }> = [
    { label: "Select", value: "select", icon: "↖" },
    { label: "Rect", value: "rectangle", icon: "▭" },
    { label: "Ellipse", value: "ellipse", icon: "◯" },
    { label: "Bezier", value: "bezier", icon: "✏" },
    { label: "Track", value: "track", icon: "⊕" }
  ];

  return (
    <div className="mask-inspector">
      <div className="mask-tools">
        {TOOLS.map((t) => (
          <button
            key={t.value}
            className={`mask-tool-btn${activeTool === t.value ? " active" : ""}`}
            onClick={() => onSetActiveTool(activeTool === t.value ? "none" : t.value)}
            title={t.label}
            type="button"
          >
            {t.icon}
          </button>
        ))}
      </div>

      {masks.length === 0 && (
        <p className="mask-empty">Select a mask tool above and draw on the viewer.</p>
      )}

      <div className="mask-list">
        {masks.map((mask) => (
          <div
            key={mask.id}
            className={`mask-list-item${mask.id === selectedMaskId ? " selected" : ""}`}
            onClick={() => onSelectMask(mask.id === selectedMaskId ? null : mask.id)}
          >
            <span className="mask-type-icon">{mask.shape.type === "ellipse" ? "◯" : mask.shape.type === "bezier" ? "✏" : "▭"}</span>
            <span className="mask-name">{mask.name}</span>
            <button
              className="mask-delete-btn"
              onClick={(e) => { e.stopPropagation(); onRemoveMask(mask.id); }}
              title="Delete mask"
              type="button"
            >×</button>
          </div>
        ))}
      </div>

      {selectedMask && (
        <div className="mask-properties">
          <div className="mask-prop-row">
            <label>Feather</label>
            <input
              type="range" min={0} max={100} step={1}
              value={selectedMask.feather}
              onChange={(e) => onUpdateMask(selectedMask.id, { feather: Number(e.target.value) })}
            />
            <span>{selectedMask.feather}px</span>
          </div>
          <div className="mask-prop-row">
            <label>Opacity</label>
            <input
              type="range" min={0} max={1} step={0.01}
              value={selectedMask.opacity}
              onChange={(e) => onUpdateMask(selectedMask.id, { opacity: Number(e.target.value) })}
            />
            <span>{Math.round(selectedMask.opacity * 100)}%</span>
          </div>
          <div className="mask-prop-row">
            <label>Expand</label>
            <input
              type="range" min={-50} max={50} step={1}
              value={selectedMask.expansion}
              onChange={(e) => onUpdateMask(selectedMask.id, { expansion: Number(e.target.value) })}
            />
            <span>{selectedMask.expansion}px</span>
          </div>
          <div className="mask-prop-row">
            <label>Invert</label>
            <input
              type="checkbox"
              checked={selectedMask.inverted}
              onChange={(e) => onUpdateMask(selectedMask.id, { inverted: e.target.checked })}
            />
          </div>
          <div className="mask-prop-row">
            <label>Track</label>
            <input
              type="checkbox"
              checked={selectedMask.trackingEnabled}
              onChange={(e) => onUpdateMask(selectedMask.id, { trackingEnabled: e.target.checked })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
