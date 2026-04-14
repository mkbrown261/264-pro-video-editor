import React, { useCallback, useEffect, useRef, useState } from "react";
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

export type MaskTool = "none" | "rectangle" | "ellipse" | "bezier" | "freehand" | "select" | "track";

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

interface FreehandState {
  points: Vec2[];  // normalized 0-1
}

// ─── Interpolation helpers ────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function getInterpolatedMaskShape(mask: ClipMask, frame: number): MaskShape {
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

  if (kf.x)        shape.x        = interpolateKF(kf.x,        shape.x);
  if (kf.y)        shape.y        = interpolateKF(kf.y,        shape.y);
  if (kf.width)    shape.width    = interpolateKF(kf.width,    shape.width);
  if (kf.height)   shape.height   = interpolateKF(kf.height,   shape.height);
  if (kf.rotation) shape.rotation = interpolateKF(kf.rotation, shape.rotation);

  return shape;
}

// ─── Canvas drawing ───────────────────────────────────────────────────────────

function applyFeatherAndOpacity(
  ctx: CanvasRenderingContext2D,
  feather: number,
  opacity: number,
  fn: () => void
) {
  ctx.save();
  if (feather > 0) {
    ctx.filter = `blur(${feather * 0.5}px)`;
  }
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  fn();
  ctx.restore();
}

function drawMaskOnCanvas(
  ctx: CanvasRenderingContext2D,
  shape: MaskShape,
  isSelected: boolean,
  inverted: boolean,
  opacity: number,
  feather: number,
  expansion: number,
  canvasWidth: number,
  canvasHeight: number
): void {
  ctx.save();

  const expNx = expansion / canvasWidth;
  const expNy = expansion / canvasHeight;

  const x = (shape.x - expNx) * canvasWidth;
  const y = (shape.y - expNy) * canvasHeight;
  const w = (shape.width  + expNx * 2) * canvasWidth;
  const h = (shape.height + expNy * 2) * canvasHeight;

  // Build the path
  const buildPath = () => {
    ctx.beginPath();
    if (shape.type === "rectangle") {
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate((shape.rotation * Math.PI) / 180);
      ctx.rect(-w / 2, -h / 2, w, h);
    } else if (shape.type === "ellipse") {
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate((shape.rotation * Math.PI) / 180);
      ctx.ellipse(0, 0, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
    } else if (shape.type === "bezier" && shape.points.length >= 2) {
      const pts = shape.points;
      ctx.moveTo(pts[0].point.x * canvasWidth, pts[0].point.y * canvasHeight);
      for (let i = 0; i < pts.length - 1; i++) {
        const curr = pts[i];
        const next = pts[i + 1];
        ctx.bezierCurveTo(
          curr.handleOut.x * canvasWidth, curr.handleOut.y * canvasHeight,
          next.handleIn.x  * canvasWidth, next.handleIn.y  * canvasHeight,
          next.point.x     * canvasWidth, next.point.y     * canvasHeight
        );
      }
      if (pts.length >= 3) {
        const last  = pts[pts.length - 1];
        const first = pts[0];
        ctx.bezierCurveTo(
          last.handleOut.x  * canvasWidth, last.handleOut.y  * canvasHeight,
          first.handleIn.x  * canvasWidth, first.handleIn.y  * canvasHeight,
          first.point.x     * canvasWidth, first.point.y     * canvasHeight
        );
      }
      ctx.closePath();
    } else if (shape.type === "freehand" && shape.points.length >= 2) {
      // Freehand stores each vertex as a BezierPoint; only .point (Vec2) is used
      const pts = shape.points.map((bp) => bp.point);
      ctx.moveTo(pts[0].x * canvasWidth, pts[0].y * canvasHeight);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x * canvasWidth, pts[i].y * canvasHeight);
      }
      ctx.closePath();
    }
  };

  // Apply feather via shadow
  if (feather > 0) {
    ctx.shadowBlur  = feather * 0.8;
    ctx.shadowColor = isSelected ? "rgba(79,142,247,0.5)" : "rgba(255,255,255,0.4)";
  }

  buildPath();

  // Fill
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  ctx.fillStyle = isSelected
    ? `rgba(79, 142, 247, ${inverted ? 0.35 : 0.22})`
    : `rgba(255, 255, 255, ${inverted ? 0.18 : 0.12})`;
  ctx.fill();

  ctx.shadowBlur  = 0;
  ctx.shadowColor = "transparent";

  // Stroke
  ctx.globalAlpha = 1;
  ctx.strokeStyle = isSelected ? "#4f8ef7" : "rgba(255,255,255,0.55)";
  ctx.lineWidth   = isSelected ? 2 : 1;
  ctx.setLineDash(isSelected ? [] : [4, 3]);
  buildPath();
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();

  // Control handles for selected masks
  if (isSelected) {
    if (shape.type === "bezier") {
      drawBezierHandles(ctx, shape, canvasWidth, canvasHeight);
    } else if (shape.type !== "freehand") {
      drawRectHandles(ctx, shape, canvasWidth, canvasHeight);
    }
  }
}

function drawRectHandles(ctx: CanvasRenderingContext2D, shape: MaskShape, w: number, h: number): void {
  const cx  = (shape.x + shape.width  / 2) * w;
  const cy  = (shape.y + shape.height / 2) * h;
  const hw  = (shape.width  / 2) * w;
  const hh  = (shape.height / 2) * h;
  const rad = (shape.rotation * Math.PI) / 180;

  const corners: Array<[number, number]> = [
    [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh],
    [0, -hh],   [hw, 0],   [0, hh],  [-hw, 0]
  ];

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad);

  for (const [dx, dy] of corners) {
    ctx.beginPath();
    ctx.arc(dx, dy, 4.5, 0, Math.PI * 2);
    ctx.fillStyle   = "#fff";
    ctx.fill();
    ctx.strokeStyle = "#4f8ef7";
    ctx.lineWidth   = 1.5;
    ctx.stroke();
  }

  ctx.restore();
}

function drawBezierHandles(ctx: CanvasRenderingContext2D, shape: MaskShape, cw: number, ch: number): void {
  for (const pt of shape.points) {
    const px   = pt.point.x    * cw;
    const py   = pt.point.y    * ch;
    const inX  = pt.handleIn.x * cw;
    const inY  = pt.handleIn.y * ch;
    const outX = pt.handleOut.x * cw;
    const outY = pt.handleOut.y * ch;

    // Handle lines
    ctx.beginPath();
    ctx.moveTo(inX, inY);
    ctx.lineTo(px,  py);
    ctx.lineTo(outX, outY);
    ctx.strokeStyle = "rgba(79,142,247,0.6)";
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Anchor point
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fillStyle   = "#fff";
    ctx.fill();
    ctx.strokeStyle = "#4f8ef7";
    ctx.lineWidth   = 1.5;
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
  const canvasRef     = useRef<HTMLCanvasElement | null>(null);
  const [drawState,   setDrawState]   = useState<DrawState | null>(null);
  const [bezierState, setBezierState] = useState<BezierDrawState | null>(null);
  const [freehandState, setFreehandState] = useState<FreehandState | null>(null);
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
        ctx, shape,
        mask.id === propsRef.current.selectedMaskId,
        mask.inverted,
        mask.opacity,
        mask.feather,
        mask.expansion,
        canvas.width,
        canvas.height
      );
    }

    // Draw in-progress rect/ellipse
    const ds = drawState;
    if (ds) {
      const x = Math.min(ds.startX, ds.currentX);
      const y = Math.min(ds.startY, ds.currentY);
      const w = Math.abs(ds.currentX - ds.startX);
      const h = Math.abs(ds.currentY - ds.startY);
      ctx.save();
      ctx.strokeStyle = "#4f8ef7";
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      const tool = propsRef.current.activeTool;
      if (tool === "rectangle") {
        ctx.rect(x, y, w, h);
      } else if (tool === "ellipse") {
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // Size label
      if (w > 20 && h > 20) {
        ctx.fillStyle = "rgba(79,142,247,0.9)";
        ctx.font      = "10px monospace";
        ctx.fillText(`${Math.round(w)}×${Math.round(h)}`, x + 4, y + 14);
      }
      ctx.restore();
    }

    // Draw in-progress bezier
    const bs = bezierState;
    if (bs && bs.points.length > 0) {
      ctx.save();
      ctx.strokeStyle = "#4f8ef7";
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      const first = bs.points[0];
      ctx.moveTo(first.point.x * canvas.width, first.point.y * canvas.height);
      for (let i = 0; i < bs.points.length - 1; i++) {
        const curr = bs.points[i];
        const nxt  = bs.points[i + 1];
        ctx.bezierCurveTo(
          curr.handleOut.x * canvas.width, curr.handleOut.y * canvas.height,
          nxt.handleIn.x   * canvas.width, nxt.handleIn.y   * canvas.height,
          nxt.point.x      * canvas.width, nxt.point.y      * canvas.height
        );
      }
      ctx.stroke();
      // Point dots
      for (let i = 0; i < bs.points.length; i++) {
        const pt = bs.points[i];
        ctx.beginPath();
        ctx.arc(pt.point.x * canvas.width, pt.point.y * canvas.height, i === 0 ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle   = i === 0 ? "#ff9900" : "#4f8ef7";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth   = 1.5;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Draw in-progress freehand
    const fs = freehandState;
    if (fs && fs.points.length > 1) {
      ctx.save();
      ctx.strokeStyle = "#4f8ef7";
      ctx.lineWidth   = 2;
      ctx.lineJoin    = "round";
      ctx.lineCap     = "round";
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(fs.points[0].x * canvas.width, fs.points[0].y * canvas.height);
      for (let i = 1; i < fs.points.length; i++) {
        ctx.lineTo(fs.points[i].x * canvas.width, fs.points[i].y * canvas.height);
      }
      ctx.stroke();
      // Closing indicator
      if (fs.points.length > 3) {
        const fp = fs.points[0];
        ctx.beginPath();
        ctx.arc(fp.x * canvas.width, fp.y * canvas.height, 7, 0, Math.PI * 2);
        ctx.fillStyle   = "rgba(79,142,247,0.35)";
        ctx.fill();
        ctx.strokeStyle = "#4f8ef7";
        ctx.lineWidth   = 1.5;
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [drawState, bezierState, freehandState, masks, selectedMaskId, playheadFrame]);

  useEffect(() => { redraw(); }, [redraw]);

  // ── Mouse helpers ──────────────────────────────────────────────────────────

  function getCanvasXY(e: React.MouseEvent<HTMLCanvasElement>): [number, number] {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / (rect.width || 1);
    const scaleY = canvas.height / (rect.height || 1);
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  }

  function getNormXY(cx: number, cy: number): [number, number] {
    const cw = canvasRef.current?.width  ?? 1;
    const ch = canvasRef.current?.height ?? 1;
    return [cx / cw, cy / ch];
  }

  // ── Mouse down ─────────────────────────────────────────────────────────────

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const tool = activeTool;
    const [cx, cy] = getCanvasXY(e);

    if (tool === "rectangle" || tool === "ellipse") {
      setDrawState({ isDrawing: true, startX: cx, startY: cy, currentX: cx, currentY: cy });
      return;
    }

    if (tool === "freehand") {
      const [nx, ny] = getNormXY(cx, cy);
      setFreehandState({ points: [{ x: nx, y: ny }] });
      return;
    }

    if (tool === "bezier") {
      const [nx, ny] = getNormXY(cx, cy);
      const newPoint: BezierPoint = {
        point:     { x: nx,        y: ny       },
        handleIn:  { x: nx - 0.03, y: ny       },
        handleOut: { x: nx + 0.03, y: ny       }
      };

      // Check if closing (close to first point)
      if (bezierState && bezierState.points.length >= 3) {
        const first = bezierState.points[0];
        const dx = first.point.x - nx;
        const dy = first.point.y - ny;
        if (Math.sqrt(dx * dx + dy * dy) < 0.025) {
          commitBezierMask(bezierState.points);
          setBezierState(null);
          return;
        }
      }

      setBezierState((prev) => ({
        points:    [...(prev?.points ?? []), newPoint],
        isClosing: false
      }));
      return;
    }

    if (tool === "select") {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const [nx, ny] = getNormXY(cx, cy);
      let hit: string | null = null;
      for (const mask of [...masks].reverse()) {
        const shape = getInterpolatedMaskShape(mask, playheadFrame);
        if (isPointInMask(nx, ny, shape)) { hit = mask.id; break; }
      }
      onSelectMask(hit);
    }
  }

  // ── Mouse move ─────────────────────────────────────────────────────────────

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const [cx, cy] = getCanvasXY(e);

    if (drawState) {
      setDrawState((prev) => prev ? { ...prev, currentX: cx, currentY: cy } : null);
      return;
    }

    if (freehandState && e.buttons === 1) {
      const [nx, ny] = getNormXY(cx, cy);
      setFreehandState((prev) => {
        if (!prev) return prev;
        // Downsample: only add if moved enough
        const last = prev.points[prev.points.length - 1];
        const dx = nx - last.x;
        const dy = ny - last.y;
        if (dx * dx + dy * dy < 0.0001) return prev;
        return { points: [...prev.points, { x: nx, y: ny }] };
      });
    }
  }

  // ── Mouse up ───────────────────────────────────────────────────────────────

  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    // Rect / ellipse commit
    if (drawState) {
      const [cx, cy] = getCanvasXY(e);
      const canvas = canvasRef.current;
      if (!canvas) return;

      const x = Math.min(drawState.startX, cx) / canvas.width;
      const y = Math.min(drawState.startY, cy) / canvas.height;
      const w = Math.abs(cx - drawState.startX) / canvas.width;
      const h = Math.abs(cy - drawState.startY) / canvas.height;

      if (w >= 0.01 && h >= 0.01) {
        const type: MaskType = activeTool === "ellipse" ? "ellipse" : "rectangle";
        const mask: ClipMask = makeMask(type, {
          type, x, y, width: w, height: h, rotation: 0, points: []
        });
        onAddMask(mask);
        onSelectMask(mask.id);
      }
      setDrawState(null);
      return;
    }

    // Freehand commit
    if (freehandState && freehandState.points.length >= 4) {
      const pts = freehandState.points;
      const mask: ClipMask = makeMask("freehand", {
        type: "freehand",
        x: 0, y: 0, width: 1, height: 1,
        rotation: 0,
        points: pts.map((p) => ({
          point:     { x: p.x, y: p.y },
          handleIn:  { x: p.x, y: p.y },
          handleOut: { x: p.x, y: p.y }
        }))
      });
      propsRef.current.onAddMask(mask);
      propsRef.current.onSelectMask(mask.id);
      setFreehandState(null);
    } else if (freehandState) {
      setFreehandState(null);
    }
  }

  function handleDoubleClick() {
    if (activeTool === "bezier" && bezierState && bezierState.points.length >= 3) {
      commitBezierMask(bezierState.points);
      setBezierState(null);
    }
  }

  function makeMask(type: MaskType | "freehand", shape: MaskShape): ClipMask {
    return {
      id: createId(),
      name: `${type.charAt(0).toUpperCase()}${type.slice(1)} Mask`,
      shape,
      feather: 0,
      opacity: 1,
      inverted: false,
      expansion: 0,
      trackingEnabled: false,
      trackingData: [],
      keyframes: {}
    };
  }

  function commitBezierMask(points: BezierPoint[]) {
    const mask: ClipMask = makeMask("bezier", {
      type: "bezier",
      x: 0, y: 0, width: 1, height: 1,
      rotation: 0,
      points: [...points]
    });
    propsRef.current.onAddMask(mask);
    propsRef.current.onSelectMask(mask.id);
  }

  function isPointInMask(nx: number, ny: number, shape: MaskShape): boolean {
    if (shape.type === "freehand" && shape.points.length >= 3) {
      // Ray-casting on freehand poly
      const pts = shape.points;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i].point.x, yi = pts[i].point.y;
        const xj = pts[j].point.x, yj = pts[j].point.y;
        const intersect = ((yi > ny) !== (yj > ny)) &&
          (nx < (xj - xi) * (ny - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }
    if (shape.type === "bezier") return false; // simplified
    const cx  = shape.x + shape.width  / 2;
    const cy  = shape.y + shape.height / 2;
    const rad = (-shape.rotation * Math.PI) / 180;
    const dx  = nx - cx;
    const dy  = ny - cy;
    const rx  = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry  = dx * Math.sin(rad) + dy * Math.cos(rad);
    if (shape.type === "ellipse") {
      return (rx / (shape.width / 2)) ** 2 + (ry / (shape.height / 2)) ** 2 <= 1;
    }
    return Math.abs(rx) <= shape.width / 2 && Math.abs(ry) <= shape.height / 2;
  }

  const cursor =
    activeTool === "rectangle" || activeTool === "ellipse" || activeTool === "freehand" ? "crosshair" :
    activeTool === "bezier"  ? "crosshair" :
    activeTool === "select"  ? "pointer"   : "default";

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="masking-canvas"
      style={{
        cursor,
        position: "absolute",
        inset: 0,
        pointerEvents: activeTool === "none" ? "none" : "auto",
        userSelect: "none"
      }}
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
  /** Optional video ref for motion tracking analysis */
  videoRef?: React.RefObject<HTMLVideoElement | null>;
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
  playheadFrame,
  videoRef,
  onSelectMask,
  onSetActiveTool,
  onUpdateMask,
  onRemoveMask
}: MaskInspectorProps) {
  const selectedMask = masks.find((m) => m.id === selectedMaskId) ?? null;
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const TOOLS: Array<{ label: string; value: MaskTool; icon: string; tooltip: string }> = [
    { label: "Select",    value: "select",    icon: "↖",  tooltip: "Select / move masks"        },
    { label: "Rect",      value: "rectangle", icon: "⬜", tooltip: "Draw rectangle mask"         },
    { label: "Ellipse",   value: "ellipse",   icon: "⬭",  tooltip: "Draw ellipse mask"           },
    { label: "Freehand",  value: "freehand",  icon: "✏️", tooltip: "Freehand / paint mask"       },
    { label: "Pen",       value: "bezier",    icon: "🖊",  tooltip: "Pen / Bezier path mask"      },
    { label: "Track",     value: "track",     icon: "⊕",  tooltip: "Enable motion tracking"      }
  ];

  return (
    <div className="mask-inspector">
      {/* Tool buttons */}
      <div className="mask-tools">
        {TOOLS.map((t) => (
          <button
            key={t.value}
            className={`mask-tool-btn${activeTool === t.value ? " active" : ""}`}
            onClick={() => onSetActiveTool(activeTool === t.value ? "none" : t.value)}
            title={t.tooltip}
            type="button"
            aria-label={t.label}
          >
            <span className="mask-tool-icon">{t.icon}</span>
            <span className="mask-tool-label">{t.label}</span>
          </button>
        ))}
      </div>

      {masks.length === 0 ? (
        <p className="mask-empty">
          Select a tool above and draw on the viewer to create a mask.
        </p>
      ) : (
        <div className="mask-list">
          {masks.map((mask) => (
            <div
              key={mask.id}
              className={`mask-list-item${mask.id === selectedMaskId ? " selected" : ""}`}
              onClick={() => onSelectMask(mask.id === selectedMaskId ? null : mask.id)}
            >
              <span className="mask-type-icon">
                {mask.shape.type === "ellipse"   ? "⬭"
                : mask.shape.type === "bezier"   ? "🖊"
                : mask.shape.type === "freehand" ? "✏️"
                : "⬜"}
              </span>
              <span className="mask-name">{mask.name}</span>
              <button
                className="mask-delete-btn"
                onClick={(e) => { e.stopPropagation(); onRemoveMask(mask.id); }}
                title="Delete mask"
                type="button"
                aria-label="Delete mask"
              >×</button>
            </div>
          ))}
        </div>
      )}

      {selectedMask && (
        <div className="mask-properties">
          <div className="mask-prop-section-label">MASK PROPERTIES</div>

          <div className="mask-prop-row">
            <label title="Soften mask edges">Feather</label>
            <input
              type="range" min={0} max={100} step={1}
              value={selectedMask.feather}
              onChange={(e) => onUpdateMask(selectedMask.id, { feather: Number(e.target.value) })}
            />
            <span className="mask-prop-value">{selectedMask.feather}px</span>
          </div>

          <div className="mask-prop-row">
            <label title="Mask transparency">Opacity</label>
            <input
              type="range" min={0} max={1} step={0.01}
              value={selectedMask.opacity}
              onChange={(e) => onUpdateMask(selectedMask.id, { opacity: Number(e.target.value) })}
            />
            <span className="mask-prop-value">{Math.round(selectedMask.opacity * 100)}%</span>
          </div>

          <div className="mask-prop-row">
            <label title="Expand or contract mask boundary">Expand</label>
            <input
              type="range" min={-50} max={50} step={1}
              value={selectedMask.expansion}
              onChange={(e) => onUpdateMask(selectedMask.id, { expansion: Number(e.target.value) })}
            />
            <span className="mask-prop-value">{selectedMask.expansion > 0 ? "+" : ""}{selectedMask.expansion}px</span>
          </div>

          <div className="mask-prop-row mask-prop-row-check">
            <label title="Invert mask selection">Invert</label>
            <input
              type="checkbox"
              checked={selectedMask.inverted}
              onChange={(e) => onUpdateMask(selectedMask.id, { inverted: e.target.checked })}
            />
          </div>

          <div className="mask-prop-row mask-prop-row-check">
            <label title="Track mask to clip motion">Track Motion</label>
            <input
              type="checkbox"
              checked={selectedMask.trackingEnabled}
              onChange={(e) => onUpdateMask(selectedMask.id, { trackingEnabled: e.target.checked })}
            />
          </div>

          {/* FIX 11: Motion tracking controls */}
          {selectedMask.trackingEnabled && (
            <div className="mask-tracking-section">
              <div className="mask-tracking-status">
                {selectedMask.trackingData.length > 0
                  ? <span className="tracking-active-badge">● {selectedMask.trackingData.length} keyframes tracked</span>
                  : <span className="tracking-idle-text">No tracking data. Click ⋔ Analyze below.</span>
                }
              </div>

              {/* Tracking path preview SVG */}
              {selectedMask.trackingData.length > 1 && (
                <svg className="tracking-path-svg" viewBox="0 0 100 40" preserveAspectRatio="none">
                  <polyline
                    points={selectedMask.trackingData.map((kf, i) => {
                      const total = selectedMask.trackingData.length;
                      const x = (i / Math.max(1, total - 1)) * 100;
                      const y = 20 + kf.dy * 18;
                      return `${x.toFixed(1)},${Math.max(2, Math.min(38, y)).toFixed(1)}`;
                    }).join(" ")}
                    fill="none" stroke="#4f8ef7" strokeWidth="1.5"
                  />
                </svg>
              )}

              <div className="mask-tracking-actions">
                <button
                  className={`panel-action${isAnalyzing ? " primary" : " muted"}`}
                  type="button"
                  disabled={isAnalyzing || !videoRef?.current}
                  title={!videoRef?.current ? "Load a clip in the viewer first" : "Analyze video motion for this mask"}
                  onClick={async () => {
                    const video = videoRef?.current;
                    if (!video || !selectedMask) return;
                    if (selectedMask.shape.type === "freehand" || selectedMask.shape.type === "bezier") return;
                    setIsAnalyzing(true);
                    const savedTime = video.currentTime;
                    try {
                      const fps = 24;
                      const keyframes: import("../../shared/models").TrackingKeyframe[] = [];
                      const { x, y, width, height } = selectedMask.shape as { x: number; y: number; width: number; height: number };
                      const offscreen = new OffscreenCanvas(160, 90);
                      const ctx = offscreen.getContext("2d")!;
                      ctx.drawImage(video, 0, 0, 160, 90);
                      const rx = Math.floor(x * 160);
                      const ry = Math.floor(y * 90);
                      const rw = Math.max(2, Math.floor(width * 160));
                      const rh = Math.max(2, Math.floor(height * 90));
                      const refData = ctx.getImageData(rx, ry, rw, rh).data;
                      // Sample frames over next ~5 seconds
                      const totalFrames = Math.min(fps * 5, 120);
                      const step = Math.max(1, Math.floor(fps / 10));
                      for (let f = 0; f < totalFrames; f += step) {
                        video.currentTime = savedTime + (f / fps);
                        await new Promise<void>((res) => {
                          const h = () => { video.removeEventListener("seeked", h); res(); };
                          video.addEventListener("seeked", h, { once: true });
                          setTimeout(res, 200);
                        });
                        ctx.drawImage(video, 0, 0, 160, 90);
                        const searchPx = 10;
                        let bestDx = 0, bestDy = 0, bestSad = Infinity;
                        for (let dy = -searchPx; dy <= searchPx; dy++) {
                          for (let dx = -searchPx; dx <= searchPx; dx++) {
                            const cx2 = rx + dx, cy2 = ry + dy;
                            if (cx2 < 0 || cy2 < 0 || cx2 + rw > 160 || cy2 + rh > 90) continue;
                            const cand = ctx.getImageData(cx2, cy2, rw, rh).data;
                            let sad = 0;
                            for (let pi = 0; pi < refData.length; pi += 4) {
                              sad += Math.abs(cand[pi] - refData[pi]) + Math.abs(cand[pi+1] - refData[pi+1]) + Math.abs(cand[pi+2] - refData[pi+2]);
                            }
                            if (sad < bestSad) { bestSad = sad; bestDx = dx; bestDy = dy; }
                          }
                        }
                        keyframes.push({ frame: playheadFrame + f, dx: bestDx / 160, dy: bestDy / 90 });
                      }
                      onUpdateMask(selectedMask.id, { trackingData: keyframes });
                    } finally {
                      video.currentTime = savedTime;
                      setIsAnalyzing(false);
                    }
                  }}
                >
                  {isAnalyzing ? "⏳ Analyzing…" : "⋔ Analyze & Track"}
                </button>
                {selectedMask.trackingData.length > 0 && (
                  <button
                    className="panel-action danger"
                    type="button"
                    onClick={() => onUpdateMask(selectedMask.id, { trackingData: [] })}
                  >
                    ️ Clear
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Numeric inputs for precise entry */}
          {(selectedMask.shape.type === "rectangle" || selectedMask.shape.type === "ellipse") && (
            <div className="mask-prop-numeric-grid">
              <div className="mask-num-row">
                <label>X</label>
                <input
                  type="number" min={0} max={1} step={0.001}
                  value={selectedMask.shape.x.toFixed(3)}
                  onChange={(e) => onUpdateMask(selectedMask.id, {
                    shape: { ...selectedMask.shape, x: Number(e.target.value) }
                  })}
                />
              </div>
              <div className="mask-num-row">
                <label>Y</label>
                <input
                  type="number" min={0} max={1} step={0.001}
                  value={selectedMask.shape.y.toFixed(3)}
                  onChange={(e) => onUpdateMask(selectedMask.id, {
                    shape: { ...selectedMask.shape, y: Number(e.target.value) }
                  })}
                />
              </div>
              <div className="mask-num-row">
                <label>W</label>
                <input
                  type="number" min={0} max={1} step={0.001}
                  value={selectedMask.shape.width.toFixed(3)}
                  onChange={(e) => onUpdateMask(selectedMask.id, {
                    shape: { ...selectedMask.shape, width: Number(e.target.value) }
                  })}
                />
              </div>
              <div className="mask-num-row">
                <label>H</label>
                <input
                  type="number" min={0} max={1} step={0.001}
                  value={selectedMask.shape.height.toFixed(3)}
                  onChange={(e) => onUpdateMask(selectedMask.id, {
                    shape: { ...selectedMask.shape, height: Number(e.target.value) }
                  })}
                />
              </div>
              <div className="mask-num-row" style={{ gridColumn: "span 2" }}>
                <label>Rotation°</label>
                <input
                  type="number" min={-360} max={360} step={1}
                  value={Math.round(selectedMask.shape.rotation)}
                  onChange={(e) => onUpdateMask(selectedMask.id, {
                    shape: { ...selectedMask.shape, rotation: Number(e.target.value) }
                  })}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
