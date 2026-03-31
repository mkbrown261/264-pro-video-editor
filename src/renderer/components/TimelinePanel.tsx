import { useEffect, useRef, useState } from "react";
import type { EditorTool, TimelineTrack, TimelineTrackKind } from "../../shared/models";
import {
  getClipTransitionDurationFrames,
  type TimelineTrackLayout,
  type TimelineSegment
} from "../../shared/timeline";
import { formatDuration, formatTimecode } from "../lib/format";

type TrimEdge = "start" | "end";

// ── Snap quantization options (in frames multiplier of fps) ──────────────────
export const SNAP_DIVISIONS = [
  { label: "1/1",  factor: 1     },
  { label: "1/2",  factor: 0.5   },
  { label: "1/4",  factor: 0.25  },
  { label: "1/8",  factor: 0.125 },
  { label: "1/16", factor: 0.0625 }
];

// ── Context menu state ────────────────────────────────────────────────────────
interface ContextMenu {
  x: number;
  y: number;
  clipId: string;
  clipKind: TimelineTrackKind;
  isLinked: boolean;
  isEnabled: boolean;
  speed: number;
}

interface DragState {
  clipId: string;
  trackKind: TimelineTrackKind;
  offsetX: number;
  originalStartFrame: number;
  originalTrackId: string;
}

interface TrimState {
  clipId: string;
  edge: TrimEdge;
  anchorX: number;
  trimStartFrames: number;
  trimEndFrames: number;
}

interface FadeHandleState {
  clipId: string;
  edge: "in" | "out";
  anchorX: number;
  originalDurationFrames: number;
  maxFrames: number;
}

// Ghost info: where the dragged clip will land
interface GhostInfo {
  frame: number;
  trackId: string;
  isNewTrack: boolean;      // true when hovering above top video or below last track
  newTrackKind: TimelineTrackKind;
  newTrackIndex: number;
}

interface TimelinePanelProps {
  trackLayouts: TimelineTrackLayout[];
  selectedClipId: string | null;
  toolMode: EditorTool;
  playheadFrame: number;
  suggestedCutFrames: number[];
  markInFrame: number | null;
  markOutFrame: number | null;
  totalFrames: number;
  sequenceFps: number;
  onSetPlayheadFrame: (frame: number) => void;
  onSelectClip: (clipId: string) => void;
  onMoveClipTo: (clipId: string, trackId: string, startFrame: number) => void;
  onTrimClipStart: (clipId: string, trimStartFrames: number) => void;
  onTrimClipEnd: (clipId: string, trimEndFrames: number) => void;
  onBladeCut: (clipId: string, frame: number) => void;
  onDropAsset: (assetId: string, trackId: string, startFrame: number) => void;
  onUpdateTrack: (trackId: string, updates: Partial<TimelineTrack>) => void;
  onSetTransitionDuration: (clipId: string, edge: "in" | "out", durationFrames: number) => void;
  // Context menu actions
  onDeleteClip?: (clipId: string) => void;
  onDuplicateClip?: (clipId: string) => void;
  onSplitClip?: (clipId: string, frame: number) => void;
  onToggleClipEnabled?: (clipId: string) => void;
  onDetachLinkedClips?: (clipId: string) => void;
  onRelinkClips?: (clipId: string) => void;
  onSetClipSpeed?: (clipId: string, speed: number) => void;
  onAddFade?: (clipId: string, edge: "in" | "out") => void;
  onAddTrack?: (kind: TimelineTrackKind) => void;
}

const MIN_PPF = 1.5;
const MAX_PPF = 60;
const LABEL_W = 100; // track-label width in px

function snapFrame(frame: number, snapEnabled: boolean, fps: number, snapDivFactor: number): number {
  if (!snapEnabled) return frame;
  const gridSize = Math.max(1, Math.round(fps * snapDivFactor));
  return Math.round(frame / gridSize) * gridSize;
}

export function TimelinePanel({
  trackLayouts,
  selectedClipId,
  toolMode,
  playheadFrame,
  suggestedCutFrames,
  markInFrame,
  markOutFrame,
  totalFrames,
  sequenceFps,
  onSetPlayheadFrame,
  onSelectClip,
  onMoveClipTo,
  onTrimClipStart,
  onTrimClipEnd,
  onBladeCut,
  onDropAsset,
  onUpdateTrack,
  onSetTransitionDuration,
  onDeleteClip,
  onDuplicateClip,
  onSplitClip,
  onToggleClipEnabled,
  onDetachLinkedClips,
  onRelinkClips,
  onSetClipSpeed,
  onAddFade,
  onAddTrack,
}: TimelinePanelProps) {
  const timelineEditorRef = useRef<HTMLDivElement | null>(null);
  const timelineRulerRef  = useRef<HTMLDivElement | null>(null);

  const propsRef = useRef({
    onSetPlayheadFrame, onSelectClip, onMoveClipTo,
    onTrimClipStart, onTrimClipEnd, onBladeCut, onDropAsset,
    onUpdateTrack, onSetTransitionDuration,
    toolMode, sequenceFps,
    onAddTrack
  });
  useEffect(() => {
    propsRef.current = {
      onSetPlayheadFrame, onSelectClip, onMoveClipTo,
      onTrimClipStart, onTrimClipEnd, onBladeCut, onDropAsset,
      onUpdateTrack, onSetTransitionDuration,
      toolMode, sequenceFps,
      onAddTrack
    };
  });

  const [pixelsPerFrame, setPpf] = useState(() => {
    try { return Number(localStorage.getItem("264pro_timeline_ppf") ?? "6") || 6; } catch { return 6; }
  });
  const ppfRef = useRef(pixelsPerFrame);
  useEffect(() => {
    ppfRef.current = pixelsPerFrame;
    try { localStorage.setItem("264pro_timeline_ppf", String(pixelsPerFrame)); } catch { /* noop */ }
  }, [pixelsPerFrame]);

  // ── Snap state ────────────────────────────────────────────────────────────
  const [snapEnabled, setSnapEnabled] = useState(() => {
    try { return localStorage.getItem("264pro_snap_enabled") !== "false"; } catch { return true; }
  });
  const [snapDivIdx, setSnapDivIdx] = useState(() => {
    try { return Number(localStorage.getItem("264pro_snap_div_idx") ?? "2"); } catch { return 2; }
  });
  const snapRef = useRef({ snapEnabled, snapDivIdx });
  useEffect(() => {
    snapRef.current = { snapEnabled, snapDivIdx };
    try {
      localStorage.setItem("264pro_snap_enabled", String(snapEnabled));
      localStorage.setItem("264pro_snap_div_idx", String(snapDivIdx));
    } catch { /* noop */ }
  }, [snapEnabled, snapDivIdx]);

  // ── Interaction state ─────────────────────────────────────────────────────
  const [trimState, setTrimState]                   = useState<TrimState | null>(null);
  const [fadeHandleState, setFadeHandleState]       = useState<FadeHandleState | null>(null);
  const [isScrubbingPlayhead, setIsScrubbingPlayhead] = useState(false);
  const [dragState, setDragState]                   = useState<DragState | null>(null);
  const [ghostInfo, setGhostInfo]                   = useState<GhostInfo | null>(null);
  const [dropTargetTrackId, setDropTargetTrackId]   = useState<string | null>(null);

  // ── Track height resize ───────────────────────────────────────────────────
  const [trackHeightDrag, setTrackHeightDrag] = useState<{ trackId: string; anchorY: number; origHeight: number } | null>(null);

  // ── Context menu ──────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [speedInput, setSpeedInput] = useState<string>("1.0");

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".timeline-context-menu")) setContextMenu(null);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  const timelineFrames = Math.max(totalFrames + sequenceFps * 4, sequenceFps * 10);
  const canvasWidth    = Math.max(timelineFrames * pixelsPerFrame, 960);
  const zoomPercent    = Math.round((pixelsPerFrame / 6) * 100);
  const playheadLeft   = Math.round(playheadFrame * pixelsPerFrame);

  // Helper: get frame under cursor accounting for scroll + label offset
  function getFrameAt(clientX: number, containerRef: React.RefObject<HTMLDivElement | null>) {
    const el = containerRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const scrollLeft = timelineEditorRef.current?.scrollLeft ?? 0;
    const px = clientX - r.left - LABEL_W + scrollLeft;
    return Math.max(0, Math.round(px / ppfRef.current));
  }

  // ── Zoom ──────────────────────────────────────────────────────────────────
  function setZoom(nextPpf: number, clientX?: number) {
    const clamped = Math.max(MIN_PPF, Math.min(MAX_PPF, nextPpf));
    const editor = timelineEditorRef.current;
    if (!editor || clientX === undefined) { setPpf(clamped); return; }
    const bounds = editor.getBoundingClientRect();
    const cursorOffset = clientX - bounds.left - LABEL_W;
    const cursorFrame  = (editor.scrollLeft + cursorOffset) / ppfRef.current;
    const nextScroll   = Math.max(0, cursorFrame * clamped - cursorOffset);
    setPpf(clamped);
    requestAnimationFrame(() => { if (timelineEditorRef.current) timelineEditorRef.current.scrollLeft = nextScroll; });
  }

  // ── Playhead scrub ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isScrubbingPlayhead) return;
    const onMove = (e: MouseEvent) => {
      const ruler = timelineRulerRef.current;
      if (!ruler) return;
      const r = ruler.getBoundingClientRect();
      const scrollLeft = timelineEditorRef.current?.scrollLeft ?? 0;
      const px = e.clientX - r.left - LABEL_W + scrollLeft;
      const frame = Math.max(0, Math.min(Math.round(px / ppfRef.current), timelineFrames));
      propsRef.current.onSetPlayheadFrame(frame);
    };
    const onUp = () => setIsScrubbingPlayhead(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isScrubbingPlayhead, timelineFrames]);

  // ── Trim ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!trimState) return;
    const onMove = (e: MouseEvent) => {
      const rawDelta = Math.round((e.clientX - trimState.anchorX) / ppfRef.current);
      const { snapEnabled: se, snapDivIdx: sdi } = snapRef.current;
      const delta = snapFrame(rawDelta, se, propsRef.current.sequenceFps, SNAP_DIVISIONS[sdi].factor) - snapFrame(0, se, propsRef.current.sequenceFps, SNAP_DIVISIONS[sdi].factor);
      if (trimState.edge === "start") {
        propsRef.current.onTrimClipStart(trimState.clipId, trimState.trimStartFrames + rawDelta);
      } else {
        propsRef.current.onTrimClipEnd(trimState.clipId, trimState.trimEndFrames - rawDelta);
      }
      void delta; // used for snap in future
    };
    const onUp = () => setTrimState(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [trimState]);

  // ── Fade handle drag ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!fadeHandleState) return;
    const onMove = (e: MouseEvent) => {
      const fhs = fadeHandleState;
      const delta = Math.round((e.clientX - fhs.anchorX) / ppfRef.current);
      const rawDur = fhs.edge === "in"
        ? Math.max(0, Math.min(fhs.originalDurationFrames + delta, fhs.maxFrames))
        : Math.max(0, Math.min(fhs.originalDurationFrames - delta, fhs.maxFrames));
      const { snapEnabled: se, snapDivIdx: sdi } = snapRef.current;
      const dur = snapFrame(rawDur, se, propsRef.current.sequenceFps, SNAP_DIVISIONS[sdi].factor);
      propsRef.current.onSetTransitionDuration(fhs.clipId, fhs.edge, Math.max(0, dur));
    };
    const onUp = () => setFadeHandleState(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [fadeHandleState]);

  // ── Track height resize ───────────────────────────────────────────────────
  useEffect(() => {
    if (!trackHeightDrag) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientY - trackHeightDrag.anchorY;
      const newH = Math.max(36, Math.min(120, trackHeightDrag.origHeight + delta));
      propsRef.current.onUpdateTrack(trackHeightDrag.trackId, { height: newH });
    };
    const onUp = () => setTrackHeightDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [trackHeightDrag]);

  // ── Clip drag ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!dragState) return;

    function resolveGhostAt(clientX: number, clientY: number): GhostInfo | null {
      const lanes = document.querySelectorAll<HTMLElement>(".timeline-lane");
      const editor = timelineEditorRef.current;
      const scrollLeft = editor?.scrollLeft ?? 0;

      let topLaneBottom = 0;
      let bottomLaneTop = 999999;
      let topLaneTrackId = "";
      let bottomLaneTrackId = "";
      let topLaneKind: TimelineTrackKind = "video";
      let bottomLaneKind: TimelineTrackKind = "audio";

      for (const lane of lanes) {
        const r = lane.getBoundingClientRect();
        const kind = lane.dataset.trackKind as TimelineTrackKind;
        const trackId = lane.dataset.trackId ?? "";

        if (clientY >= r.top && clientY <= r.bottom) {
          if (kind === dragState.trackKind) {
            const px = clientX - r.left + scrollLeft - dragState.offsetX;
            const rawFrame = Math.max(0, Math.round(px / ppfRef.current));
            const { snapEnabled: se, snapDivIdx: sdi } = snapRef.current;
            const frame = snapFrame(rawFrame, se, propsRef.current.sequenceFps, SNAP_DIVISIONS[sdi].factor);
            return { frame, trackId, isNewTrack: false, newTrackKind: kind, newTrackIndex: 0 };
          }
        }
        if (r.bottom > topLaneBottom) { topLaneBottom = r.bottom; topLaneTrackId = trackId; topLaneKind = kind; }
        if (r.top < bottomLaneTop) { bottomLaneTop = r.top; bottomLaneTrackId = trackId; bottomLaneKind = kind; }
      }

      // Dragging outside existing tracks — offer new track
      const r = (document.querySelector(".timeline-rows") as HTMLElement | null)?.getBoundingClientRect();
      if (!r) return null;
      const px = clientX - r.left - LABEL_W + scrollLeft - dragState.offsetX;
      const rawFrame = Math.max(0, Math.round(px / ppfRef.current));
      const { snapEnabled: se, snapDivIdx: sdi } = snapRef.current;
      const frame = snapFrame(rawFrame, se, propsRef.current.sequenceFps, SNAP_DIVISIONS[sdi].factor);

      if (clientY < topLaneBottom) {
        return { frame, trackId: "", isNewTrack: true, newTrackKind: dragState.trackKind, newTrackIndex: 0 };
      }
      if (clientY > bottomLaneTop) {
        return { frame, trackId: "", isNewTrack: true, newTrackKind: dragState.trackKind, newTrackIndex: -1 };
      }
      void topLaneTrackId; void bottomLaneTrackId; void topLaneKind; void bottomLaneKind;
      return null;
    }

    const onMove = (e: MouseEvent) => {
      const g = resolveGhostAt(e.clientX, e.clientY);
      setGhostInfo(g);
    };

    const onUp = (e: MouseEvent) => {
      const g = resolveGhostAt(e.clientX, e.clientY);
      if (g && !g.isNewTrack) {
        propsRef.current.onMoveClipTo(dragState.clipId, g.trackId, g.frame);
      }
      // New track creation — add the track first, then move clip to same frame on original track.
      // (We can't move to the new track synchronously since we don't have its ID yet.)
      if (g?.isNewTrack) {
        propsRef.current.onAddTrack?.(g.newTrackKind);
        propsRef.current.onMoveClipTo(dragState.clipId, dragState.originalTrackId, g.frame);
      }
      setDragState(null);
      setGhostInfo(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragState]);

  // ── Context menu renderer ─────────────────────────────────────────────────
  function renderContextMenu() {
    if (!contextMenu) return null;
    const { x, y, clipId, isLinked, isEnabled, speed } = contextMenu;
    const frameAtPlayhead = playheadFrame;
    return (
      <div
        className="timeline-context-menu"
        style={{ position: "fixed", left: x, top: y, zIndex: 9999 }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="ctx-menu-item" onClick={() => { onSplitClip?.(clipId, frameAtPlayhead); setContextMenu(null); }}>
          ✂ Split at Playhead
        </div>
        <div className="ctx-menu-sep" />
        <div className="ctx-menu-item" onClick={() => { onDuplicateClip?.(clipId); setContextMenu(null); }}>
          ⧉ Duplicate
        </div>
        <div className="ctx-menu-item" onClick={() => { onDeleteClip?.(clipId); setContextMenu(null); }}>
          🗑 Delete
        </div>
        <div className="ctx-menu-sep" />
        <div className="ctx-menu-item" onClick={() => { onToggleClipEnabled?.(clipId); setContextMenu(null); }}>
          {isEnabled ? "⊘ Disable Clip" : "✓ Enable Clip"}
        </div>
        <div className="ctx-menu-sep" />
        <div className="ctx-menu-item" onClick={() => { onAddFade?.(clipId, "in"); setContextMenu(null); }}>
          ◁ Add Fade In
        </div>
        <div className="ctx-menu-item" onClick={() => { onAddFade?.(clipId, "out"); setContextMenu(null); }}>
          ▷ Add Fade Out
        </div>
        <div className="ctx-menu-sep" />
        {isLinked ? (
          <div className="ctx-menu-item" onClick={() => { onDetachLinkedClips?.(clipId); setContextMenu(null); }}>
            🔗 Unlink Audio/Video
          </div>
        ) : (
          <div className="ctx-menu-item" onClick={() => { onRelinkClips?.(clipId); setContextMenu(null); }}>
            🔗 Relink Audio/Video
          </div>
        )}
        <div className="ctx-menu-sep" />
        <div className="ctx-menu-item ctx-menu-speed-row">
          <span>⚡ Speed:</span>
          <input
            className="ctx-speed-input"
            type="number"
            min={0.25} max={4} step={0.05}
            value={speedInput}
            onChange={(e) => setSpeedInput(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          <span>×</span>
          <button
            className="ctx-speed-apply"
            type="button"
            onClick={() => {
              const spd = Math.max(0.25, Math.min(4, parseFloat(speedInput) || speed));
              onSetClipSpeed?.(clipId, spd);
              setContextMenu(null);
            }}
          >Apply</button>
        </div>
      </div>
    );
  }

  // ── Ruler ticks ───────────────────────────────────────────────────────────
  function renderRulerTicks() {
    const ticks: React.ReactNode[] = [];
    const minTickPx = 50;
    const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    let interval = 30;
    for (const c of candidates) {
      if (c * pixelsPerFrame >= minTickPx) { interval = c; break; }
    }
    const count = Math.ceil(timelineFrames / interval) + 2;
    for (let i = 0; i < count; i++) {
      const frame = i * interval;
      if (frame > timelineFrames + interval) break;
      ticks.push(
        <div key={frame} className="ruler-tick" style={{ left: frame * pixelsPerFrame }}>
          <div className="ruler-tick-line" />
          <span className="ruler-tick-label">{formatTimecode(frame, sequenceFps)}</span>
        </div>
      );
    }
    return ticks;
  }

  return (
    <section className="panel timeline-panel">
      {renderContextMenu()}

      {/* ── TOOLBAR ──────────────────────────────────────────────────────── */}
      <div className="panel-header timeline-header">
        <div className="tl-header-left">
          <span className="tl-section-label">TIMELINE</span>
          <span className="tl-info">{sequenceFps}fps</span>
          <span className="tl-info">{trackLayouts.length} tracks</span>
          <span className="tl-info tl-duration">
            {formatTimecode(Math.max(totalFrames - 1, 0), sequenceFps)}
          </span>
        </div>

        {/* Snap controls */}
        <div className="tl-snap-controls">
          <button
            className={`tl-snap-btn${snapEnabled ? " active" : ""}`}
            onClick={() => setSnapEnabled((v) => !v)}
            title={snapEnabled ? "Snap ON — click to disable" : "Snap OFF — click to enable"}
            type="button"
          >
            <span className="tl-snap-icon">⊞</span>
            {snapEnabled ? "Snap" : "Free"}
          </button>
          {snapEnabled && (
            <select
              className="tl-snap-select"
              value={snapDivIdx}
              onChange={(e) => setSnapDivIdx(Number(e.target.value))}
              title="Snap grid resolution"
            >
              {SNAP_DIVISIONS.map((d, i) => (
                <option key={d.label} value={i}>{d.label}</option>
              ))}
            </select>
          )}
        </div>

        <div className="tl-header-right">
          <span className="tl-info">{zoomPercent}%</span>
          <button
            className="tl-zoom-btn"
            disabled={pixelsPerFrame <= MIN_PPF}
            onClick={() => setZoom(pixelsPerFrame * 0.8)}
            type="button"
            title="Zoom out (Ctrl+scroll)"
          >−</button>
          <input
            type="range"
            className="tl-zoom-range"
            min={MIN_PPF} max={MAX_PPF} step={0.5}
            value={pixelsPerFrame}
            onChange={(e) => setZoom(Number(e.target.value))}
            title="Timeline zoom"
          />
          <button
            className="tl-zoom-btn"
            disabled={pixelsPerFrame >= MAX_PPF}
            onClick={() => setZoom(pixelsPerFrame * 1.25)}
            type="button"
            title="Zoom in (Ctrl+scroll)"
          >+</button>
          <span className="tl-header-sep" />
          <button
            className="tl-add-track-btn"
            onClick={() => onAddTrack?.("video")}
            title="Add video track"
            type="button"
          >+ V</button>
          <button
            className="tl-add-track-btn"
            onClick={() => onAddTrack?.("audio")}
            title="Add audio track"
            type="button"
          >+ A</button>
        </div>
      </div>

      {/* ── SCROLLABLE CANVAS ──────────────────────────────────────────────── */}
      <div
        ref={timelineEditorRef}
        className="timeline-editor"
        onWheel={(event) => {
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            setZoom(ppfRef.current + (event.deltaY > 0 ? -0.8 : 0.8), event.clientX);
          } else {
            event.currentTarget.scrollLeft += event.deltaY !== 0 ? event.deltaY : event.deltaX;
          }
        }}
      >
        {/* ── RULER ──────────────────────────────────────────────────────── */}
        <div
          ref={timelineRulerRef}
          className="timeline-ruler"
          style={{ minWidth: canvasWidth + LABEL_W }}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            const r = event.currentTarget.getBoundingClientRect();
            const scrollLeft = timelineEditorRef.current?.scrollLeft ?? 0;
            const px = event.clientX - r.left - LABEL_W + scrollLeft;
            const frame = Math.max(0, Math.min(Math.round(px / pixelsPerFrame), timelineFrames));
            onSetPlayheadFrame(frame);
            setIsScrubbingPlayhead(true);
          }}
        >
          <div className="ruler-label-spacer" style={{ width: LABEL_W }} />
          <div className="ruler-ticks-area" style={{ width: canvasWidth }}>
            {renderRulerTicks()}
            <div
              className="timeline-playhead-handle"
              style={{ left: playheadLeft }}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setIsScrubbingPlayhead(true); }}
            />
            {markInFrame !== null && (
              <div className="timeline-guide-marker mark-in" style={{ left: markInFrame * pixelsPerFrame }}>IN</div>
            )}
            {markOutFrame !== null && (
              <div className="timeline-guide-marker mark-out" style={{ left: markOutFrame * pixelsPerFrame }}>OUT</div>
            )}
            {suggestedCutFrames.map((f) => (
              <div key={`ai-${f}`} className="timeline-guide-marker ai-cut" style={{ left: f * pixelsPerFrame }}>✂</div>
            ))}
          </div>
        </div>

        {/* ── TRACK ROWS ─────────────────────────────────────────────────── */}
        <div className="timeline-rows">

          {/* Ghost new-track indicator (above) */}
          {ghostInfo?.isNewTrack && ghostInfo.newTrackIndex === 0 && (
            <div className="timeline-new-track-ghost">
              <div className="ghost-new-track-label">+ New {ghostInfo.newTrackKind} track</div>
            </div>
          )}

          {trackLayouts.map((layout) => {
            const isLocked = layout.track.locked;
            const isMuted  = layout.track.muted;
            const trackH   = layout.track.height ?? (layout.track.kind === "video" ? 56 : 44);

            return (
              <div
                key={layout.track.id}
                className={`timeline-row${isLocked ? " track-locked" : ""}${isMuted ? " track-muted" : ""}`}
                style={{ height: trackH }}
              >
                {/* ── Track label with controls ── */}
                <div
                  className={`timeline-track-label ${layout.track.kind}-track-label`}
                  style={{
                    width: LABEL_W,
                    borderLeft: `3px solid ${layout.track.color ?? (layout.track.kind === "video" ? "#4f8ef7" : "#2fc77a")}`
                  }}
                >
                  <div className="track-label-top">
                    <span className="track-name" title={layout.track.name}>{layout.track.name}</span>
                  </div>
                  <div className="track-label-controls">
                    {/* Mute */}
                    <button
                      className={`track-ctrl-btn${isMuted ? " active-mute" : ""}`}
                      title={isMuted ? "Unmute track" : "Mute track"}
                      onClick={() => onUpdateTrack(layout.track.id, { muted: !isMuted })}
                      type="button"
                    >M</button>
                    {/* Lock */}
                    <button
                      className={`track-ctrl-btn${isLocked ? " active-lock" : ""}`}
                      title={isLocked ? "Unlock track" : "Lock track"}
                      onClick={() => onUpdateTrack(layout.track.id, { locked: !isLocked })}
                      type="button"
                    >{isLocked ? "🔒" : "🔓"}</button>
                    {/* Solo (video tracks: hide/show) */}
                    <button
                      className={`track-ctrl-btn${layout.track.solo ? " active-solo" : ""}`}
                      title={layout.track.solo ? "Un-solo" : (layout.track.kind === "audio" ? "Solo" : "Isolate")}
                      onClick={() => onUpdateTrack(layout.track.id, { solo: !layout.track.solo })}
                      type="button"
                    >S</button>
                  </div>
                  {/* Height resize handle */}
                  <div
                    className="track-height-handle"
                    title="Drag to resize track height"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setTrackHeightDrag({ trackId: layout.track.id, anchorY: e.clientY, origHeight: trackH });
                    }}
                  />
                </div>

                {/* ── Lane ── */}
                <div
                  className={`timeline-lane ${layout.track.kind}-lane${toolMode === "blade" ? " blade-active" : ""}${dropTargetTrackId === layout.track.id ? " drop-target" : ""}${isLocked ? " lane-locked" : ""}`}
                  data-track-id={layout.track.id}
                  data-track-kind={layout.track.kind}
                  style={{ width: canvasWidth, opacity: isMuted ? 0.45 : 1 }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("application/x-asset-id") && !isLocked) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                      setDropTargetTrackId(layout.track.id);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTargetTrackId(null);
                  }}
                  onDrop={(e) => {
                    if (isLocked) return;
                    const assetId = e.dataTransfer.getData("application/x-asset-id");
                    if (!assetId) return;
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    const scrollLeft = timelineEditorRef.current?.scrollLeft ?? 0;
                    const px = e.clientX - r.left + scrollLeft;
                    const rawFrame = Math.max(0, Math.round(px / ppfRef.current));
                    const frame = snapFrame(rawFrame, snapEnabled, sequenceFps, SNAP_DIVISIONS[snapDivIdx].factor);
                    propsRef.current.onDropAsset(assetId, layout.track.id, frame);
                    setDropTargetTrackId(null);
                  }}
                  onClick={(e) => {
                    if (toolMode !== "select" || isLocked) return;
                    if ((e.target as HTMLElement).closest(".timeline-clip")) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    const scrollLeft = timelineEditorRef.current?.scrollLeft ?? 0;
                    const px = e.clientX - r.left + scrollLeft;
                    const frame = Math.max(0, Math.min(Math.round(px / pixelsPerFrame), timelineFrames));
                    onSetPlayheadFrame(frame);
                  }}
                >
                  {/* Guide lines */}
                  {markInFrame !== null && <div className="timeline-guide-line mark-in" style={{ left: markInFrame * pixelsPerFrame }} />}
                  {markOutFrame !== null && <div className="timeline-guide-line mark-out" style={{ left: markOutFrame * pixelsPerFrame }} />}
                  {suggestedCutFrames.map((f) => (
                    <div key={`${layout.track.id}-ai-${f}`} className="timeline-guide-line ai-cut" style={{ left: f * pixelsPerFrame }} />
                  ))}

                  {/* Playhead */}
                  <div className="timeline-playhead" style={{ left: playheadLeft }} />

                  {/* Snap grid lines (subtle) */}
                  {snapEnabled && pixelsPerFrame >= 4 && (() => {
                    const gridFrames = Math.max(1, Math.round(sequenceFps * SNAP_DIVISIONS[snapDivIdx].factor));
                    const lines: React.ReactNode[] = [];
                    const count = Math.ceil(timelineFrames / gridFrames);
                    for (let i = 1; i < count; i++) {
                      lines.push(
                        <div key={i} className="snap-grid-line" style={{ left: i * gridFrames * pixelsPerFrame }} />
                      );
                    }
                    return lines;
                  })()}

                  {/* Empty state */}
                  {layout.segments.length === 0 && (
                    <div className="timeline-track-empty">
                      <span>{isLocked ? "🔒 Track locked" : "Drag a clip here"}</span>
                    </div>
                  )}

                  {/* Clips */}
                  {layout.segments.map((segment) => {
                    const clipLeft  = segment.startFrame * pixelsPerFrame;
                    const clipWidth = Math.max(segment.durationFrames * pixelsPerFrame, 24);
                    const isSelected = selectedClipId === segment.clip.id;
                    const isDragging = dragState?.clipId === segment.clip.id;

                    // Ghost position for this clip while dragging (live preview follows mouse)
                    const ghostTargetFrame = isDragging && ghostInfo && !ghostInfo.isNewTrack && ghostInfo.trackId === layout.track.id
                      ? ghostInfo.frame
                      : null;
                    // While dragging, show clip at ghost target position; otherwise at clip position
                    const displayLeft = ghostTargetFrame !== null ? ghostTargetFrame * pixelsPerFrame : clipLeft;

                    // Fade durations
                    const fadeInFrames  = segment.clip.transitionIn?.durationFrames  ?? 0;
                    const fadeOutFrames = segment.clip.transitionOut?.durationFrames ?? 0;
                    const fadeInPx      = fadeInFrames  * pixelsPerFrame;
                    const fadeOutPx     = fadeOutFrames * pixelsPerFrame;

                    const clipClass = [
                      "timeline-clip",
                      segment.track.kind === "video" ? "video-clip" : "audio-clip",
                      isSelected  ? "selected"  : "",
                      !segment.clip.isEnabled ? "disabled" : "",
                      isDragging  ? "dragging"  : "",
                      isLocked    ? "clip-locked" : ""
                    ].filter(Boolean).join(" ");

                    return (
                      <div
                        key={segment.clip.id}
                        className={clipClass}
                        style={{
                          left: displayLeft,
                          width: clipWidth,
                          height: "calc(100% - 4px)",
                          ...(segment.track.kind === "video" && segment.asset.thumbnailUrl
                            ? {
                                backgroundImage: `url(${segment.asset.thumbnailUrl})`,
                                backgroundRepeat: "repeat-x",
                                backgroundSize: `${Math.max(48, pixelsPerFrame * 16)}px 100%`,
                                backgroundPosition: "left center"
                              }
                            : {})
                        }}
                        onMouseDown={(event) => {
                          if (event.button !== 0 || isLocked) return;
                          const handleEl = (event.target as HTMLElement).closest(".timeline-clip-handle,.fade-handle");
                          if (handleEl) return;

                          event.stopPropagation();

                          if (propsRef.current.toolMode === "blade") {
                            const bounds = event.currentTarget.getBoundingClientRect();
                            const ratio = (event.clientX - bounds.left) / bounds.width;
                            const splitFrame = segment.startFrame + Math.floor(Math.max(0, Math.min(ratio, 0.9999)) * segment.durationFrames);
                            propsRef.current.onSetPlayheadFrame(splitFrame);
                            propsRef.current.onBladeCut(segment.clip.id, splitFrame);
                            return;
                          }

                          propsRef.current.onSelectClip(segment.clip.id);

                          const clipBounds = event.currentTarget.getBoundingClientRect();
                          const offsetFromClipLeft = event.clientX - clipBounds.left;
                          setDragState({
                            clipId: segment.clip.id,
                            trackKind: segment.track.kind,
                            offsetX: offsetFromClipLeft,
                            originalStartFrame: segment.startFrame,
                            originalTrackId: layout.track.id
                          });
                          // Initialize ghost at current position
                          setGhostInfo({ frame: segment.startFrame, trackId: layout.track.id, isNewTrack: false, newTrackKind: layout.track.kind, newTrackIndex: 0 });
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          propsRef.current.onSelectClip(segment.clip.id);
                          setSpeedInput(String((segment.clip.speed ?? 1).toFixed(2)));
                          setContextMenu({
                            x: event.clientX,
                            y: event.clientY,
                            clipId: segment.clip.id,
                            clipKind: segment.track.kind,
                            isLinked: Boolean(segment.clip.linkedGroupId),
                            isEnabled: segment.clip.isEnabled !== false,
                            speed: segment.clip.speed ?? 1,
                          });
                        }}
                      >
                        {/* Thumbnail tint overlay */}
                        {segment.track.kind === "video" && segment.asset.thumbnailUrl && (
                          <div className="clip-thumb-tint" />
                        )}

                        {/* ── Fade-in overlay + handle ── */}
                        {fadeInFrames > 0 && (
                          <div
                            className="clip-fade-overlay fade-in-overlay"
                            style={{ width: Math.min(fadeInPx, clipWidth * 0.5) }}
                          />
                        )}
                        <div
                          className={`fade-handle fade-handle-in${fadeInFrames > 0 ? " has-fade" : ""}`}
                          title={`Fade in: ${(fadeInFrames / sequenceFps).toFixed(2)}s — drag to adjust`}
                          style={{ left: fadeInPx }}
                          onMouseDown={(e) => {
                            if (isLocked) return;
                            e.stopPropagation(); e.preventDefault();
                            setFadeHandleState({
                              clipId: segment.clip.id,
                              edge: "in",
                              anchorX: e.clientX,
                              originalDurationFrames: fadeInFrames,
                              maxFrames: Math.floor(segment.durationFrames * 0.5)
                            });
                          }}
                        />

                        {/* Trim start handle */}
                        <span
                          className="timeline-clip-handle start"
                          onMouseDown={(e) => {
                            if (propsRef.current.toolMode !== "select" || isLocked) return;
                            e.preventDefault(); e.stopPropagation();
                            propsRef.current.onSelectClip(segment.clip.id);
                            setTrimState({
                              clipId: segment.clip.id, edge: "start", anchorX: e.clientX,
                              trimStartFrames: segment.clip.trimStartFrames,
                              trimEndFrames: segment.clip.trimEndFrames
                            });
                          }}
                        />

                        {/* Transition in pill */}
                        {segment.clip.transitionIn && (
                          <span className="timeline-transition-pill in">
                            {getClipTransitionDurationFrames(segment.clip.transitionIn, segment.durationFrames)}f
                          </span>
                        )}

                        {/* Clip content */}
                        <div className="timeline-clip-content">
                          <strong className="clip-name">{segment.asset.name}</strong>
                          {clipWidth > 60 && <span className="clip-dur">{formatDuration(segment.durationSeconds)}</span>}
                          {segment.clip.effects?.some((ef) => ef.enabled) && (
                            <span className="clip-fx-badge" title="Effects applied">✦</span>
                          )}
                          {(segment.clip.volume !== undefined && segment.clip.volume !== 1) && (
                            <span className="clip-vol-badge" title={`Volume: ${Math.round((segment.clip.volume ?? 1) * 100)}%`}>
                              🔊{Math.round((segment.clip.volume ?? 1) * 100)}%
                            </span>
                          )}
                          {(segment.clip.speed !== undefined && segment.clip.speed !== 1) && (
                            <span className="clip-speed-badge" title={`Speed: ${(segment.clip.speed ?? 1).toFixed(2)}×`}>
                              {(segment.clip.speed ?? 1).toFixed(1)}×
                            </span>
                          )}
                        </div>

                        {/* Transition out pill */}
                        {segment.clip.transitionOut && (
                          <span className="timeline-transition-pill out">
                            {getClipTransitionDurationFrames(segment.clip.transitionOut, segment.durationFrames)}f
                          </span>
                        )}

                        {/* Trim end handle */}
                        <span
                          className="timeline-clip-handle end"
                          onMouseDown={(e) => {
                            if (propsRef.current.toolMode !== "select" || isLocked) return;
                            e.preventDefault(); e.stopPropagation();
                            propsRef.current.onSelectClip(segment.clip.id);
                            setTrimState({
                              clipId: segment.clip.id, edge: "end", anchorX: e.clientX,
                              trimStartFrames: segment.clip.trimStartFrames,
                              trimEndFrames: segment.clip.trimEndFrames
                            });
                          }}
                        />

                        {/* ── Fade-out overlay + handle ── */}
                        {fadeOutFrames > 0 && (
                          <div
                            className="clip-fade-overlay fade-out-overlay"
                            style={{ width: Math.min(fadeOutPx, clipWidth * 0.5), right: 0, left: "auto" }}
                          />
                        )}
                        <div
                          className={`fade-handle fade-handle-out${fadeOutFrames > 0 ? " has-fade" : ""}`}
                          title={`Fade out: ${(fadeOutFrames / sequenceFps).toFixed(2)}s — drag to adjust`}
                          style={{ right: fadeOutPx, left: "auto" }}
                          onMouseDown={(e) => {
                            if (isLocked) return;
                            e.stopPropagation(); e.preventDefault();
                            setFadeHandleState({
                              clipId: segment.clip.id,
                              edge: "out",
                              anchorX: e.clientX,
                              originalDurationFrames: fadeOutFrames,
                              maxFrames: Math.floor(segment.durationFrames * 0.5)
                            });
                          }}
                        />
                      </div>
                    );
                  })}

                  {/* Ghost clip preview while dragging — shows origin position as shadow, clip follows cursor */}
                  {dragState && layout.segments.some((s) => s.clip.id === dragState.clipId) && (() => {
                    const seg = layout.segments.find((s) => s.clip.id === dragState.clipId);
                    if (!seg) return null;
                    const w = Math.max(seg.durationFrames * pixelsPerFrame, 24);
                    // Show ghost at original position while clip moves
                    return (
                      <div
                        className="timeline-clip-ghost"
                        style={{ left: seg.startFrame * pixelsPerFrame, width: w, height: "calc(100% - 4px)" }}
                      />
                    );
                  })()}
                </div>
              </div>
            );
          })}

          {/* Ghost new-track indicator (below) */}
          {ghostInfo?.isNewTrack && ghostInfo.newTrackIndex === -1 && (
            <div className="timeline-new-track-ghost">
              <div className="ghost-new-track-label">+ New {ghostInfo.newTrackKind} track</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
