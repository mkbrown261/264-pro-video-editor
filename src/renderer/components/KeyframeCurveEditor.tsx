import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CurveKeyframe {
  frame: number;
  value: number;
  easing: 'linear' | 'bezier' | 'hold';
  /** outgoing bezier handle — x in [0,1] fraction of segment, y is value offset */
  cpOut?: { x: number; y: number };
  /** incoming bezier handle — x in [0,1] fraction of segment, y is value offset */
  cpIn?: { x: number; y: number };
}

interface KeyframeCurveEditorProps {
  paramName: string;
  paramMin: number;
  paramMax: number;
  totalFrames: number;
  fps: number;
  keyframes: CurveKeyframe[];
  currentFrame: number;
  onKeyframesChange: (keyframes: CurveKeyframe[]) => void;
  onClose: () => void;
}

// ── Interpolation engine (exported for playback use) ─────────────────────────

export function interpolateKeyframes(
  kfs: CurveKeyframe[],
  frame: number,
  min: number,
  max: number
): number {
  if (kfs.length === 0) return (min + max) / 2;
  const sorted = [...kfs].sort((a, b) => a.frame - b.frame);
  if (frame <= sorted[0].frame) return sorted[0].value;
  if (frame >= sorted[sorted.length - 1].frame) return sorted[sorted.length - 1].value;
  const idx = sorted.findIndex((k) => k.frame > frame) - 1;
  const k0 = sorted[idx];
  const k1 = sorted[idx + 1];
  if (k0.easing === 'hold') return k0.value;
  const t = (frame - k0.frame) / (k1.frame - k0.frame);
  if (k0.easing === 'linear') return k0.value + t * (k1.value - k0.value);
  // Bezier: cubic interpolation using control points
  const cp0y = k0.cpOut?.y ?? 0;
  const cp1y = k1.cpIn?.y ?? 0;
  const range = k1.value - k0.value;
  const mt = 1 - t;
  return (
    mt * mt * mt * k0.value
    + 3 * mt * mt * t * (k0.value + cp0y * range)
    + 3 * mt * t * t * (k1.value - cp1y * range)
    + t * t * t * k1.value
  );
}

// ── Coordinate helpers ────────────────────────────────────────────────────────

const CANVAS_W = 700;
const CANVAS_H = 200;
const PAD_L = 36;
const PAD_R = 16;
const PAD_T = 12;
const PAD_B = 28;
const PLOT_W = CANVAS_W - PAD_L - PAD_R;
const PLOT_H = CANVAS_H - PAD_T - PAD_B;

function frameToX(frame: number, totalFrames: number): number {
  const tf = Math.max(1, totalFrames);
  return PAD_L + (frame / tf) * PLOT_W;
}

function valueToY(value: number, min: number, max: number): number {
  const range = max - min || 1;
  const norm = (value - min) / range;
  // SVG y=0 is top, so invert: high value → small y
  return PAD_T + (1 - norm) * PLOT_H;
}

function xToFrame(x: number, totalFrames: number): number {
  return Math.round(((x - PAD_L) / PLOT_W) * totalFrames);
}

function yToValue(y: number, min: number, max: number): number {
  const norm = 1 - (y - PAD_T) / PLOT_H;
  return min + norm * (max - min);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── Default bezier handle position ───────────────────────────────────────────

function defaultCpOut(): { x: number; y: number } {
  return { x: 0.333, y: 0 };
}

function defaultCpIn(): { x: number; y: number } {
  return { x: 0.333, y: 0 };
}

// ── Bezier path builder ───────────────────────────────────────────────────────

function buildPath(
  kfs: CurveKeyframe[],
  totalFrames: number,
  min: number,
  max: number
): string {
  if (kfs.length === 0) return '';
  const sorted = [...kfs].sort((a, b) => a.frame - b.frame);

  const parts: string[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const k0 = sorted[i];
    const k1 = sorted[i + 1];
    const x0 = frameToX(k0.frame, totalFrames);
    const y0 = valueToY(k0.value, min, max);
    const x1 = frameToX(k1.frame, totalFrames);
    const y1 = valueToY(k1.value, min, max);
    const segW = x1 - x0;
    const range = k1.value - k0.value;

    if (i === 0) {
      parts.push(`M ${x0} ${y0}`);
    }

    if (k0.easing === 'hold') {
      // Horizontal then vertical drop
      parts.push(`L ${x1} ${y0}`);
      parts.push(`L ${x1} ${y1}`);
    } else if (k0.easing === 'linear') {
      parts.push(`L ${x1} ${y1}`);
    } else {
      // Bezier
      const cp0 = k0.cpOut ?? defaultCpOut();
      const cp1 = k1.cpIn ?? defaultCpIn();
      const cx0 = x0 + cp0.x * segW;
      const cy0 = valueToY(k0.value + cp0.y * range, min, max);
      const cx1 = x1 - cp1.x * segW;
      const cy1 = valueToY(k1.value - cp1.y * range, min, max);
      parts.push(`C ${cx0} ${cy0} ${cx1} ${cy1} ${x1} ${y1}`);
    }
  }

  return parts.join(' ');
}

// ── Drag state ────────────────────────────────────────────────────────────────

type DragTarget =
  | { kind: 'keyframe'; idx: number }
  | { kind: 'cpOut'; idx: number }
  | { kind: 'cpIn'; idx: number }
  | null;

// ── Component ─────────────────────────────────────────────────────────────────

export function KeyframeCurveEditor({
  paramName,
  paramMin,
  paramMax,
  totalFrames,
  fps,
  keyframes,
  currentFrame,
  onKeyframesChange,
  onClose,
}: KeyframeCurveEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [dragging, setDragging] = useState<DragTarget>(null);
  const dragStartRef = useRef<{ svgX: number; svgY: number; kf: CurveKeyframe } | null>(null);

  // Keep sorted keyframes in local memo
  const sorted = useMemo(
    () => [...keyframes].sort((a, b) => a.frame - b.frame),
    [keyframes]
  );

  // Convert sorted index back to keyframes array index
  function sortedIndexToOriginal(si: number): number {
    const sk = sorted[si];
    return keyframes.findIndex((k) => k === sk);
  }

  // ── SVG pointer coordinate helper ──────────────────────────────────────────
  function getSvgPoint(e: React.PointerEvent | PointerEvent): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    };
  }

  // ── Click on SVG canvas (not on a handle) ─────────────────────────────────
  function handleCanvasClick(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
    const svgY = ((e.clientY - rect.top) / rect.height) * CANVAS_H;

    // Only add if click is within plot area
    if (svgX < PAD_L || svgX > PAD_L + PLOT_W || svgY < PAD_T || svgY > PAD_T + PLOT_H) return;

    const frame = clamp(xToFrame(svgX, totalFrames), 0, totalFrames - 1);
    const value = clamp(yToValue(svgY, paramMin, paramMax), paramMin, paramMax);

    // Check if near existing keyframe (12px hit radius)
    const hitRadius = (12 / CANVAS_W) * totalFrames;
    const nearIdx = sorted.findIndex((k) => Math.abs(k.frame - frame) < hitRadius);
    if (nearIdx >= 0) {
      setSelectedIdx(nearIdx);
      return;
    }

    // Add new keyframe
    const newKf: CurveKeyframe = {
      frame,
      value,
      easing: 'bezier',
      cpOut: defaultCpOut(),
      cpIn: defaultCpIn(),
    };
    const next = [...keyframes, newKf].sort((a, b) => a.frame - b.frame);
    onKeyframesChange(next);
    const newSortedIdx = next.findIndex((k) => k.frame === frame && k.value === value);
    setSelectedIdx(newSortedIdx);
  }

  // ── Pointer down on a keyframe diamond ────────────────────────────────────
  function handleKeyframePointerDown(e: React.PointerEvent, sortedIdx: number) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedIdx(sortedIdx);
    setDragging({ kind: 'keyframe', idx: sortedIdx });
    dragStartRef.current = { svgX: getSvgPoint(e).x, svgY: getSvgPoint(e).y, kf: { ...sorted[sortedIdx] } };
  }

  // ── Pointer down on bezier handle ─────────────────────────────────────────
  function handleHandlePointerDown(
    e: React.PointerEvent,
    sortedIdx: number,
    handleKind: 'cpOut' | 'cpIn'
  ) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging({ kind: handleKind, idx: sortedIdx });
    dragStartRef.current = { svgX: getSvgPoint(e).x, svgY: getSvgPoint(e).y, kf: { ...sorted[sortedIdx] } };
  }

  // ── Pointer move ──────────────────────────────────────────────────────────
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const { x: svgX, y: svgY } = getSvgPoint(e);

      if (dragging.kind === 'keyframe') {
        const si = dragging.idx;
        const origIdx = sortedIndexToOriginal(si);
        if (origIdx < 0) return;

        const newFrame = clamp(xToFrame(svgX, totalFrames), 0, totalFrames - 1);
        const newValue = clamp(yToValue(svgY, paramMin, paramMax), paramMin, paramMax);

        const next = keyframes.map((k, i) => {
          if (i !== origIdx) return k;
          return { ...k, frame: newFrame, value: newValue };
        });
        onKeyframesChange(next);
      } else if (dragging.kind === 'cpOut' || dragging.kind === 'cpIn') {
        const si = dragging.idx;
        const origIdx = sortedIndexToOriginal(si);
        if (origIdx < 0) return;
        const kf = sorted[si];

        if (dragging.kind === 'cpOut' && si < sorted.length - 1) {
          const k1 = sorted[si + 1];
          const segW = frameToX(k1.frame, totalFrames) - frameToX(kf.frame, totalFrames);
          if (segW <= 0) return;
          const range = k1.value - kf.value || 1;
          const cpX = clamp((svgX - frameToX(kf.frame, totalFrames)) / segW, 0, 1);
          const cpY = (yToValue(svgY, paramMin, paramMax) - kf.value) / range;
          const next = keyframes.map((k, i) => {
            if (i !== origIdx) return k;
            return { ...k, cpOut: { x: cpX, y: cpY } };
          });
          onKeyframesChange(next);
        } else if (dragging.kind === 'cpIn' && si > 0) {
          const k0 = sorted[si - 1];
          const segW = frameToX(kf.frame, totalFrames) - frameToX(k0.frame, totalFrames);
          if (segW <= 0) return;
          const range = kf.value - k0.value || 1;
          const cpX = clamp((frameToX(kf.frame, totalFrames) - svgX) / segW, 0, 1);
          const cpY = (kf.value - yToValue(svgY, paramMin, paramMax)) / range;
          const next = keyframes.map((k, i) => {
            if (i !== origIdx) return k;
            return { ...k, cpIn: { x: cpX, y: cpY } };
          });
          onKeyframesChange(next);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dragging, keyframes, sorted, totalFrames, paramMin, paramMax, onKeyframesChange]
  );

  function handlePointerUp() {
    setDragging(null);
    dragStartRef.current = null;
  }

  // ── Keyboard: delete selected keyframe ────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (selectedIdx === null) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const origIdx = sortedIndexToOriginal(selectedIdx);
        if (origIdx < 0) return;
        const next = keyframes.filter((_, i) => i !== origIdx);
        onKeyframesChange(next);
        setSelectedIdx(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx, keyframes, sorted]);

  // ── Double-click: cycle easing ────────────────────────────────────────────
  function handleKeyframeDblClick(e: React.MouseEvent, sortedIdx: number) {
    e.stopPropagation();
    const origIdx = sortedIndexToOriginal(sortedIdx);
    if (origIdx < 0) return;
    const cycle: CurveKeyframe['easing'][] = ['linear', 'bezier', 'hold'];
    const cur = keyframes[origIdx].easing;
    const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
    const updated = keyframes.map((k, i) =>
      i === origIdx
        ? { ...k, easing: next, cpOut: defaultCpOut(), cpIn: defaultCpIn() }
        : k
    );
    onKeyframesChange(updated);
  }

  // ── Easing segmented button ───────────────────────────────────────────────
  function setSelectedEasing(easing: CurveKeyframe['easing']) {
    if (selectedIdx === null) return;
    const origIdx = sortedIndexToOriginal(selectedIdx);
    if (origIdx < 0) return;
    const updated = keyframes.map((k, i) =>
      i === origIdx ? { ...k, easing } : k
    );
    onKeyframesChange(updated);
  }

  // ── Add keyframe at playhead ──────────────────────────────────────────────
  function addAtPlayhead() {
    const frame = clamp(currentFrame, 0, totalFrames - 1);
    const interpVal = interpolateKeyframes(keyframes, frame, paramMin, paramMax);
    const exists = keyframes.findIndex((k) => k.frame === frame);
    if (exists >= 0) {
      setSelectedIdx(sorted.findIndex((k) => k.frame === frame));
      return;
    }
    const newKf: CurveKeyframe = {
      frame,
      value: clamp(interpVal, paramMin, paramMax),
      easing: 'bezier',
      cpOut: defaultCpOut(),
      cpIn: defaultCpIn(),
    };
    const next = [...keyframes, newKf].sort((a, b) => a.frame - b.frame);
    onKeyframesChange(next);
    setSelectedIdx(next.findIndex((k) => k.frame === frame));
  }

  // ── Remove selected keyframe ──────────────────────────────────────────────
  function removeSelected() {
    if (selectedIdx === null) return;
    const origIdx = sortedIndexToOriginal(selectedIdx);
    if (origIdx < 0) return;
    const next = keyframes.filter((_, i) => i !== origIdx);
    onKeyframesChange(next);
    setSelectedIdx(null);
  }

  // ── Grid lines ────────────────────────────────────────────────────────────
  const gridLines = useMemo(() => {
    const lines: React.ReactNode[] = [];
    // Vertical lines every 30 frames
    const step = 30;
    for (let f = 0; f <= totalFrames; f += step) {
      const x = frameToX(f, totalFrames);
      lines.push(
        <line key={`v${f}`} x1={x} y1={PAD_T} x2={x} y2={PAD_T + PLOT_H}
          stroke="#2d3748" strokeWidth={1} />
      );
    }
    // Horizontal lines at 25%, 50%, 75%
    for (const p of [0.25, 0.5, 0.75]) {
      const y = PAD_T + (1 - p) * PLOT_H;
      lines.push(
        <line key={`h${p}`} x1={PAD_L} y1={y} x2={PAD_L + PLOT_W} y2={y}
          stroke="#2d3748" strokeWidth={1} />
      );
    }
    return lines;
  }, [totalFrames]);

  // ── Timecode labels ───────────────────────────────────────────────────────
  const timeLabels = useMemo(() => {
    const labels: React.ReactNode[] = [];
    const step = 30;
    for (let f = 0; f <= totalFrames; f += step) {
      const x = frameToX(f, totalFrames);
      const secs = Math.floor(f / Math.max(1, fps));
      const fr = f % Math.max(1, fps);
      const label = `${secs}s${fr > 0 ? `+${fr}` : ''}`;
      labels.push(
        <text key={`t${f}`} x={x} y={CANVAS_H - 6}
          fill="#64748b" fontSize={9} textAnchor="middle">{label}</text>
      );
    }
    return labels;
  }, [totalFrames, fps]);

  // ── Bezier handle coordinates ─────────────────────────────────────────────
  function getHandlePositions(si: number): {
    cpOutX?: number; cpOutY?: number;
    cpInX?: number; cpInY?: number;
  } {
    const kf = sorted[si];
    if (kf.easing !== 'bezier') return {};

    const result: { cpOutX?: number; cpOutY?: number; cpInX?: number; cpInY?: number } = {};

    if (si < sorted.length - 1) {
      const k1 = sorted[si + 1];
      const segW = frameToX(k1.frame, totalFrames) - frameToX(kf.frame, totalFrames);
      const range = k1.value - kf.value;
      const cp = kf.cpOut ?? defaultCpOut();
      result.cpOutX = frameToX(kf.frame, totalFrames) + cp.x * segW;
      result.cpOutY = valueToY(kf.value + cp.y * range, paramMin, paramMax);
    }

    if (si > 0) {
      const k0 = sorted[si - 1];
      const segW = frameToX(kf.frame, totalFrames) - frameToX(k0.frame, totalFrames);
      const range = kf.value - k0.value;
      const cp = kf.cpIn ?? defaultCpIn();
      result.cpInX = frameToX(kf.frame, totalFrames) - cp.x * segW;
      result.cpInY = valueToY(kf.value - cp.y * range, paramMin, paramMax);
    }

    return result;
  }

  const selectedKf = selectedIdx !== null ? sorted[selectedIdx] : null;
  const curvePath = buildPath(sorted, totalFrames, paramMin, paramMax);
  const playheadX = frameToX(clamp(currentFrame, 0, totalFrames - 1), totalFrames);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 200,
        left: '50%',
        transform: 'translateX(-50%)',
        width: CANVAS_W,
        zIndex: 300,
        background: '#0f172a',
        border: '1px solid #334155',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        fontFamily: 'system-ui, sans-serif',
        userSelect: 'none',
      }}
    >
      {/* ── Controls bar ────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderBottom: '1px solid #1e293b',
        background: '#0f172a',
        borderRadius: '8px 8px 0 0',
        flexWrap: 'wrap',
      }}>
        <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, marginRight: 4 }}>
          {paramName} curve
        </span>

        <button
          type="button"
          onClick={addAtPlayhead}
          style={btnStyle('#1e293b', '#38bdf8')}
        >
          + Add at Playhead
        </button>

        {selectedKf && (
          <>
            <span style={{ color: '#475569', fontSize: 10 }}>Easing:</span>
            {(['linear', 'bezier', 'hold'] as const).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setSelectedEasing(e)}
                style={btnStyle(
                  selectedKf.easing === e ? '#7c3aed' : '#1e293b',
                  selectedKf.easing === e ? '#fff' : '#94a3b8'
                )}
              >
                {e.charAt(0).toUpperCase() + e.slice(1)}
              </button>
            ))}
            <button
              type="button"
              onClick={removeSelected}
              style={btnStyle('#7f1d1d', '#fca5a5')}
            >
              ✕ Remove
            </button>
          </>
        )}

        <div style={{ flex: 1 }} />

        <button
          type="button"
          onClick={onClose}
          style={btnStyle('#1e293b', '#94a3b8')}
          title="Close curve editor"
        >
          ✕ Close
        </button>
      </div>

      {/* ── SVG canvas ──────────────────────────────────────────────────── */}
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        style={{ display: 'block', cursor: dragging ? 'grabbing' : 'crosshair' }}
        onClick={handleCanvasClick}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Plot area background */}
        <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H}
          fill="#0a0f1a" rx={2} />

        {/* Grid */}
        {gridLines}

        {/* Y-axis border */}
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + PLOT_H}
          stroke="#334155" strokeWidth={1} />
        {/* X-axis border */}
        <line x1={PAD_L} y1={PAD_T + PLOT_H} x2={PAD_L + PLOT_W} y2={PAD_T + PLOT_H}
          stroke="#334155" strokeWidth={1} />

        {/* Curve */}
        {curvePath && (
          <path
            d={curvePath}
            fill="none"
            stroke="#a855f7"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Bezier handles for selected keyframe */}
        {selectedIdx !== null && sorted[selectedIdx]?.easing === 'bezier' && (() => {
          const { cpOutX, cpOutY, cpInX, cpInY } = getHandlePositions(selectedIdx);
          const kf = sorted[selectedIdx];
          const kx = frameToX(kf.frame, totalFrames);
          const ky = valueToY(kf.value, paramMin, paramMax);
          return (
            <>
              {cpOutX !== undefined && cpOutY !== undefined && (
                <>
                  <line x1={kx} y1={ky} x2={cpOutX} y2={cpOutY}
                    stroke="#14b8a6" strokeWidth={1} strokeDasharray="3,2" />
                  <circle
                    cx={cpOutX} cy={cpOutY} r={5}
                    fill="#14b8a6" stroke="#0f172a" strokeWidth={1.5}
                    style={{ cursor: 'grab' }}
                    onPointerDown={(e) => handleHandlePointerDown(e, selectedIdx, 'cpOut')}
                  />
                </>
              )}
              {cpInX !== undefined && cpInY !== undefined && (
                <>
                  <line x1={kx} y1={ky} x2={cpInX} y2={cpInY}
                    stroke="#14b8a6" strokeWidth={1} strokeDasharray="3,2" />
                  <circle
                    cx={cpInX} cy={cpInY} r={5}
                    fill="#14b8a6" stroke="#0f172a" strokeWidth={1.5}
                    style={{ cursor: 'grab' }}
                    onPointerDown={(e) => handleHandlePointerDown(e, selectedIdx, 'cpIn')}
                  />
                </>
              )}
            </>
          );
        })()}

        {/* Keyframe diamonds */}
        {sorted.map((kf, si) => {
          const kx = frameToX(kf.frame, totalFrames);
          const ky = valueToY(kf.value, paramMin, paramMax);
          const isSelected = si === selectedIdx;
          // Diamond = rotated square, use polygon points
          const S = isSelected ? 7 : 5;
          const pts = `${kx},${ky - S} ${kx + S},${ky} ${kx},${ky + S} ${kx - S},${ky}`;
          return (
            <polygon
              key={si}
              points={pts}
              fill={isSelected ? '#fff' : '#cbd5e1'}
              stroke={isSelected ? '#7c3aed' : '#64748b'}
              strokeWidth={isSelected ? 2 : 1.5}
              style={{ cursor: dragging?.kind === 'keyframe' && dragging.idx === si ? 'grabbing' : 'grab' }}
              onPointerDown={(e) => handleKeyframePointerDown(e, si)}
              onDoubleClick={(e) => handleKeyframeDblClick(e, si)}
            />
          );
        })}

        {/* Playhead */}
        <line
          x1={playheadX} y1={PAD_T} x2={playheadX} y2={PAD_T + PLOT_H}
          stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4,3"
          style={{ pointerEvents: 'none' }}
        />
        <polygon
          points={`${playheadX - 4},${PAD_T} ${playheadX + 4},${PAD_T} ${playheadX},${PAD_T + 6}`}
          fill="#ef4444"
          style={{ pointerEvents: 'none' }}
        />

        {/* Timecode labels */}
        {timeLabels}

        {/* Y-axis value labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => {
          const v = paramMin + p * (paramMax - paramMin);
          const y = PAD_T + (1 - p) * PLOT_H;
          return (
            <text key={p} x={PAD_L - 4} y={y + 3}
              fill="#64748b" fontSize={8} textAnchor="end">
              {Number.isInteger(v) ? v : v.toFixed(1)}
            </text>
          );
        })}
      </svg>

      {/* ── Info bar ────────────────────────────────────────────────────── */}
      <div style={{
        padding: '3px 10px',
        borderTop: '1px solid #1e293b',
        color: '#475569',
        fontSize: 10,
        display: 'flex',
        gap: 12,
        borderRadius: '0 0 8px 8px',
      }}>
        <span>{sorted.length} keyframe{sorted.length !== 1 ? 's' : ''}</span>
        {selectedKf && (
          <>
            <span>Frame: {selectedKf.frame}</span>
            <span>Value: {typeof selectedKf.value === 'number' ? selectedKf.value.toFixed(3) : selectedKf.value}</span>
            <span>Easing: {selectedKf.easing}</span>
          </>
        )}
        <span style={{ marginLeft: 'auto' }}>Click canvas to add • Double-click keyframe to cycle easing • Del to remove</span>
      </div>
    </div>
  );
}

// ── Button style helper ────────────────────────────────────────────────────────

function btnStyle(bg: string, color: string): React.CSSProperties {
  return {
    background: bg,
    color,
    border: 'none',
    borderRadius: 4,
    padding: '3px 8px',
    fontSize: 11,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}
