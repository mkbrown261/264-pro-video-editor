import { useEffect, useRef, useState } from "react";
import type { EditorTool, TimelineTrackKind } from "../../shared/models";
import {
  getClipTransitionDurationFrames,
  type TimelineTrackLayout,
  type TimelineSegment
} from "../../shared/timeline";
import { formatDuration, formatTimecode } from "../lib/format";

type TrimEdge = "start" | "end";

interface DragState {
  clipId: string;
  trackKind: TimelineTrackKind;
  /** pixel offset from clip's left edge to mouse pointer at drag start */
  offsetX: number;
  /** the startFrame at drag start */
  originalStartFrame: number;
}

interface TrimState {
  clipId: string;
  edge: TrimEdge;
  anchorX: number;
  trimStartFrames: number;
  trimEndFrames: number;
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
}

const MIN_PPF = 2;
const MAX_PPF = 40;

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
  onBladeCut
}: TimelinePanelProps) {
  const timelineEditorRef = useRef<HTMLDivElement | null>(null);
  const timelineRulerRef = useRef<HTMLDivElement | null>(null);

  // Keep prop callbacks in refs so mouse-event closures always call latest version
  const propsRef = useRef({
    onSetPlayheadFrame,
    onSelectClip,
    onMoveClipTo,
    onTrimClipStart,
    onTrimClipEnd,
    onBladeCut,
    toolMode,
    sequenceFps
  });
  useEffect(() => {
    propsRef.current = {
      onSetPlayheadFrame,
      onSelectClip,
      onMoveClipTo,
      onTrimClipStart,
      onTrimClipEnd,
      onBladeCut,
      toolMode,
      sequenceFps
    };
  });

  const [pixelsPerFrame, setPpf] = useState(6);
  const ppfRef = useRef(pixelsPerFrame);
  useEffect(() => { ppfRef.current = pixelsPerFrame; }, [pixelsPerFrame]);

  const [trimState, setTrimState] = useState<TrimState | null>(null);
  const [isScrubbingPlayhead, setIsScrubbingPlayhead] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragGhostInfo, setDragGhostInfo] = useState<{ frame: number; trackId: string } | null>(null);

  const timelineFrames = Math.max(totalFrames, sequenceFps * 10);
  const canvasWidth = Math.max(timelineFrames * pixelsPerFrame, 960);
  const zoomPercent = Math.round((pixelsPerFrame / 6) * 100);
  const playheadLeft = Math.round(playheadFrame * pixelsPerFrame);

  // ── zoom ──────────────────────────────────────────────────────────────────
  function setZoom(nextPpf: number, clientX?: number) {
    const clamped = Math.max(MIN_PPF, Math.min(MAX_PPF, nextPpf));
    const editor = timelineEditorRef.current;

    if (!editor || clientX === undefined) {
      setPpf(clamped);
      return;
    }

    const bounds = editor.getBoundingClientRect();
    const cursorOffset = clientX - bounds.left;
    const cursorFrame = (editor.scrollLeft + cursorOffset) / ppfRef.current;
    const nextScrollLeft = Math.max(0, cursorFrame * clamped - cursorOffset);

    setPpf(clamped);
    requestAnimationFrame(() => {
      if (timelineEditorRef.current) {
        timelineEditorRef.current.scrollLeft = nextScrollLeft;
      }
    });
  }

  // ── playhead scrub ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isScrubbingPlayhead) return;

    function getFrameFromRuler(clientX: number) {
      const ruler = timelineRulerRef.current;
      if (!ruler) return 0;
      const bounds = ruler.getBoundingClientRect();
      const editor = timelineEditorRef.current;
      const scrollLeft = editor?.scrollLeft ?? 0;
      const px = clientX - bounds.left - 72 + scrollLeft; // 72 = label spacer width
      const frames = Math.max(0, Math.min(Math.round(px / ppfRef.current), timelineFrames));
      return frames;
    }

    const onMove = (e: MouseEvent) => propsRef.current.onSetPlayheadFrame(getFrameFromRuler(e.clientX));
    const onUp = () => setIsScrubbingPlayhead(false);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isScrubbingPlayhead, timelineFrames]);

  // ── trim ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!trimState) return;

    const onMove = (e: MouseEvent) => {
      const delta = Math.round((e.clientX - trimState.anchorX) / ppfRef.current);
      if (trimState.edge === "start") {
        propsRef.current.onTrimClipStart(trimState.clipId, trimState.trimStartFrames + delta);
      } else {
        propsRef.current.onTrimClipEnd(trimState.clipId, trimState.trimEndFrames - delta);
      }
    };
    const onUp = () => setTrimState(null);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [trimState]);

  // ── mouse drag ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!dragState) return;

    function getLaneInfoAtPoint(clientX: number, clientY: number) {
      const lanes = document.querySelectorAll<HTMLElement>(".timeline-lane");
      for (const lane of lanes) {
        const r = lane.getBoundingClientRect();
        if (clientY >= r.top && clientY <= r.bottom) {
          const editor = timelineEditorRef.current;
          const scrollLeft = editor?.scrollLeft ?? 0;
          const px = clientX - r.left + scrollLeft - (dragState?.offsetX ?? 0);
          const frame = Math.max(0, Math.round(px / ppfRef.current));
          const trackId = lane.dataset.trackId ?? "";
          const trackKind = lane.dataset.trackKind as TimelineTrackKind | undefined;
          return { frame, trackId, trackKind };
        }
      }
      return null;
    }

    const onMove = (e: MouseEvent) => {
      const info = getLaneInfoAtPoint(e.clientX, e.clientY);
      if (info && info.trackKind === dragState.trackKind) {
        setDragGhostInfo({ frame: info.frame, trackId: info.trackId });
      }
    };

    const onUp = (e: MouseEvent) => {
      const info = getLaneInfoAtPoint(e.clientX, e.clientY);
      if (info && info.trackKind === dragState.trackKind) {
        propsRef.current.onMoveClipTo(dragState.clipId, info.trackId, info.frame);
      }
      setDragState(null);
      setDragGhostInfo(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragState]);

  // ── ruler tick rendering ───────────────────────────────────────────────────
  function renderRulerTicks() {
    const ticks: React.ReactNode[] = [];
    const minTickPx = 50;
    const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    let interval = 30;

    for (const c of candidates) {
      if (c * pixelsPerFrame >= minTickPx) {
        interval = c;
        break;
      }
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
      {/* ── TOOLBAR ─────────────────────────────────────────────────────── */}
      <div className="panel-header timeline-header">
        <div className="tl-header-left">
          <span className="tl-section-label">TIMELINE</span>
          <span className="tl-info">{sequenceFps} fps</span>
          <span className="tl-info">{trackLayouts.length} tracks</span>
          <span className="tl-info tl-duration">
            {formatTimecode(Math.max(totalFrames - 1, 0), sequenceFps)}
          </span>
        </div>
        <div className="tl-header-right">
          <span className="tl-info">{zoomPercent}%</span>
          <button
            className="tl-zoom-btn"
            disabled={pixelsPerFrame <= MIN_PPF}
            onClick={() => setZoom(pixelsPerFrame - 1)}
            type="button"
            title="Zoom out"
          >−</button>
          <button
            className="tl-zoom-btn"
            disabled={pixelsPerFrame >= MAX_PPF}
            onClick={() => setZoom(pixelsPerFrame + 1)}
            type="button"
            title="Zoom in"
          >+</button>
        </div>
      </div>

      {/* ── SCROLLABLE CANVAS ─────────────────────────────────────────────── */}
      <div
        ref={timelineEditorRef}
        className="timeline-editor"
        onWheel={(event) => {
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            setZoom(ppfRef.current + (event.deltaY > 0 ? -0.5 : 0.5), event.clientX);
          } else {
            // Horizontal scroll
            event.currentTarget.scrollLeft += event.deltaY !== 0 ? event.deltaY : event.deltaX;
          }
        }}
      >
        {/* ── RULER ─────────────────────────────────────────────────────── */}
        <div
          ref={timelineRulerRef}
          className="timeline-ruler"
          style={{ minWidth: canvasWidth + 72 }}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            const ruler = event.currentTarget;
            const bounds = ruler.getBoundingClientRect();
            const editor = timelineEditorRef.current;
            const scrollLeft = editor?.scrollLeft ?? 0;
            const px = event.clientX - bounds.left - 72 + scrollLeft;
            const frame = Math.max(0, Math.min(Math.round(px / pixelsPerFrame), timelineFrames));
            onSetPlayheadFrame(frame);
            setIsScrubbingPlayhead(true);
          }}
        >
          {/* 72px spacer to align with track labels */}
          <div className="ruler-label-spacer" />
          <div className="ruler-ticks-area" style={{ width: canvasWidth }}>
            {renderRulerTicks()}
            {/* Playhead handle */}
            <div
              className="timeline-playhead-handle"
              style={{ left: playheadLeft }}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setIsScrubbingPlayhead(true); }}
            />
            {/* Guide markers */}
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
          {trackLayouts.map((layout) => (
            <div key={layout.track.id} className="timeline-row">

              {/* Track label */}
              <div className={`timeline-track-label ${layout.track.kind}-track-label`}>
                <span className="track-name">{layout.track.name}</span>
              </div>

              {/* Lane */}
              <div
                className={`timeline-lane ${layout.track.kind}-lane${toolMode === "blade" ? " blade-active" : ""}`}
                data-track-id={layout.track.id}
                data-track-kind={layout.track.kind}
                style={{ width: canvasWidth }}
                onClick={(e) => {
                  if (toolMode !== "select") return;
                  // Only fire if clicking on the lane itself (not on a clip)
                  if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("timeline-track-empty")) return;
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

                {/* Empty state */}
                {layout.segments.length === 0 && (
                  <div className="timeline-track-empty"><span>Empty track — double-click a media clip to add</span></div>
                )}

                {/* Clips */}
                {layout.segments.map((segment) => {
                  const clipLeft = segment.startFrame * pixelsPerFrame;
                  const clipWidth = Math.max(segment.durationFrames * pixelsPerFrame, 32);
                  const isSelected = selectedClipId === segment.clip.id;
                  const isDragging = dragState?.clipId === segment.clip.id;
                  const ghostFrame = isDragging && dragGhostInfo?.trackId === layout.track.id
                    ? dragGhostInfo.frame
                    : null;
                  const displayLeft = ghostFrame !== null ? ghostFrame * pixelsPerFrame : clipLeft;

                  const clipClass = [
                    "timeline-clip",
                    segment.track.kind === "video" ? "video-clip" : "audio-clip",
                    isSelected ? "selected" : "",
                    !segment.clip.isEnabled ? "disabled" : "",
                    isDragging ? "dragging" : ""
                  ].filter(Boolean).join(" ");

                  return (
                    <div
                      key={segment.clip.id}
                      className={clipClass}
                      style={{
                        left: displayLeft,
                        width: clipWidth,
                        ...(segment.track.kind === "video" && segment.asset.thumbnailUrl
                          ? {
                              backgroundImage: `url(${segment.asset.thumbnailUrl})`,
                              backgroundRepeat: "repeat-x",
                              backgroundSize: `${Math.max(64, pixelsPerFrame * 16)}px 100%`,
                              backgroundPosition: "left center"
                            }
                          : {})
                      }}
                      onMouseDown={(event) => {
                        if (event.button !== 0) return;
                        const handleEl = (event.target as HTMLElement).closest(".timeline-clip-handle");
                        if (handleEl) return; // let handle's own handler run

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

                        // Start drag
                        const clipBounds = event.currentTarget.getBoundingClientRect();
                        const editor = timelineEditorRef.current;
                        const scrollLeft = editor?.scrollLeft ?? 0;
                        const offsetX = event.clientX - clipBounds.left + scrollLeft - (segment.startFrame * ppfRef.current);
                        // simpler: just track pointer relative to clip left edge
                        const offsetFromClipLeft = event.clientX - clipBounds.left;
                        setDragState({
                          clipId: segment.clip.id,
                          trackKind: segment.track.kind,
                          offsetX: offsetFromClipLeft,
                          originalStartFrame: segment.startFrame
                        });
                        setDragGhostInfo({ frame: segment.startFrame, trackId: layout.track.id });
                      }}
                    >
                      {/* thumbnail tint */}
                      {segment.track.kind === "video" && segment.asset.thumbnailUrl && (
                        <div className="clip-thumb-tint" />
                      )}

                      {/* Trim start handle */}
                      <span
                        className="timeline-clip-handle start"
                        onMouseDown={(e) => {
                          if (propsRef.current.toolMode !== "select") return;
                          e.preventDefault();
                          e.stopPropagation();
                          propsRef.current.onSelectClip(segment.clip.id);
                          setTrimState({
                            clipId: segment.clip.id,
                            edge: "start",
                            anchorX: e.clientX,
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

                      {/* Content */}
                      <div className="timeline-clip-content">
                        <strong>{segment.asset.name}</strong>
                        <span>{formatDuration(segment.durationSeconds)}</span>
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
                          if (propsRef.current.toolMode !== "select") return;
                          e.preventDefault();
                          e.stopPropagation();
                          propsRef.current.onSelectClip(segment.clip.id);
                          setTrimState({
                            clipId: segment.clip.id,
                            edge: "end",
                            anchorX: e.clientX,
                            trimStartFrames: segment.clip.trimStartFrames,
                            trimEndFrames: segment.clip.trimEndFrames
                          });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
