/**
 * Volume / pan automation lane drawn over an audio track on the timeline.
 * Click to add a point, drag to move it, right-click (or Alt-click) to delete.
 * Values: volume 0–2 (1 = unity, middle of the lane), pan −1 (L) … +1 (R).
 */
import { useRef, useState } from "react";
import type { AutomationKeyframe, TimelineTrack } from "../../shared/models";

interface Props {
  track: TimelineTrack;
  param: "volume" | "pan";
  pixelsPerFrame: number;
  width: number;
  height: number;
  onSet: (frame: number, value: number) => void;
  onRemove: (frame: number) => void;
}

const RANGE = { volume: [0, 2], pan: [-1, 1] } as const;

export function AutomationLaneOverlay({ track, param, pixelsPerFrame, width, height, onSet, onRemove }: Props) {
  const lane = track.automation?.find((l) => l.param === param);
  const kfs: AutomationKeyframe[] = [...(lane?.keyframes ?? [])].sort((a, b) => a.frame - b.frame);
  const [lo, hi] = RANGE[param];
  const pad = 4;
  const toY = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2);
  const toV = (y: number) => Math.min(hi, Math.max(lo, lo + (1 - (y - pad) / (height - pad * 2)) * (hi - lo)));
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<{ from: number; frame: number; value: number } | null>(null);

  const local = (e: React.MouseEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const points = kfs.map((k) => (drag && k.frame === drag.from ? { frame: drag.frame, value: drag.value } : k))
    .sort((a, b) => a.frame - b.frame);
  const fallback = param === "volume" ? 1 : track.pan ?? 0;
  const path = points.length
    ? [`M 0 ${toY(points[0].value)}`, ...points.map((p) => `L ${p.frame * pixelsPerFrame} ${toY(p.value)}`), `L ${width} ${toY(points[points.length - 1].value)}`].join(" ")
    : `M 0 ${toY(fallback)} L ${width} ${toY(fallback)}`;
  const color = param === "volume" ? "#f7c948" : "#5fc4ff";
  const label = (v: number) => (param === "volume" ? `${(20 * Math.log10(Math.max(v, 1e-4))).toFixed(1)} dB` : v === 0 ? "C" : `${Math.round(Math.abs(v) * 100)}${v < 0 ? "L" : "R"}`);

  return (
    <svg
      ref={svgRef}
      className="automation-lane-overlay"
      width={width}
      height={height}
      style={{ position: "absolute", left: 0, top: 0, zIndex: 20, cursor: "crosshair", background: "rgba(0,0,0,0.25)" }}
      onMouseDown={(e) => {
        if (e.button !== 0 || (e.target as Element).tagName === "circle") return;
        e.stopPropagation();
        const { x, y } = local(e);
        onSet(Math.max(0, Math.round(x / pixelsPerFrame)), Number(toV(y).toFixed(3)));
      }}
      onMouseMove={(e) => {
        if (!drag) return;
        const { x, y } = local(e);
        setDrag({ ...drag, frame: Math.max(0, Math.round(x / pixelsPerFrame)), value: Number(toV(y).toFixed(3)) });
      }}
      onMouseUp={() => {
        if (!drag) return;
        if (drag.frame !== drag.from) onRemove(drag.from);
        onSet(drag.frame, drag.value);
        setDrag(null);
      }}
      onMouseLeave={() => setDrag(null)}
      onClick={(e) => e.stopPropagation()}
    >
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray={points.length ? undefined : "4 3"} />
      {points.map((p) => (
        <g key={p.frame}>
          <circle
            cx={p.frame * pixelsPerFrame}
            cy={toY(p.value)}
            r={4}
            fill={color}
            stroke="#000"
            style={{ cursor: "grab" }}
            onMouseDown={(e) => {
              e.stopPropagation();
              if (e.altKey) { onRemove(p.frame); return; }
              if (e.button === 0) setDrag({ from: p.frame, frame: p.frame, value: p.value });
            }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(p.frame); }}
          >
            <title>{`${label(p.value)} — drag to move, right-click to delete`}</title>
          </circle>
        </g>
      ))}
      <text x={6} y={11} fontSize={9} fill={color} style={{ pointerEvents: "none" }}>{param === "volume" ? "VOLUME" : "PAN"}{lane && !lane.enabled ? " (off)" : ""}</text>
    </svg>
  );
}
