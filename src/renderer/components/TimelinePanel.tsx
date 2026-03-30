import { useEffect, useRef, useState } from "react";
import type { EditorTool, TimelineTrackKind } from "../../shared/models";
import {
  getClipTransitionDurationFrames,
  type TimelineTrackLayout
} from "../../shared/timeline";
import { formatDuration, formatTimecode } from "../lib/format";

type TrimEdge = "start" | "end";

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
  const [dragState, setDragState] = useState<{
    clipId: string;
    trackKind: TimelineTrackKind;
  } | null>(null);
  const [pixelsPerFrame, setPixelsPerFrame] = useState(6);
  const [trimState, setTrimState] = useState<{
    clipId: string;
    edge: TrimEdge;
    anchorX: number;
    trimStartFrames: number;
    trimEndFrames: number;
  } | null>(null);
  const [isScrubbingPlayhead, setIsScrubbingPlayhead] = useState(false);
  const timelineFrames = Math.max(totalFrames, sequenceFps * 10);
  const canvasWidth = Math.max(timelineFrames * pixelsPerFrame, 960);
  const zoomPercent = Math.round((pixelsPerFrame / 6) * 100);
  const playheadPosition = Math.max(
    0,
    Math.min(playheadFrame * pixelsPerFrame, canvasWidth)
  );

  function getFrameFromPointer(clientX: number, element: HTMLElement): number {
    const bounds = element.getBoundingClientRect();
    const nextFrame = Math.round((clientX - bounds.left) / pixelsPerFrame);

    return Math.max(0, Math.min(nextFrame, timelineFrames));
  }

  useEffect(() => {
    if (!trimState) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const deltaFrames = Math.round((event.clientX - trimState.anchorX) / pixelsPerFrame);

      if (trimState.edge === "start") {
        onTrimClipStart(trimState.clipId, trimState.trimStartFrames + deltaFrames);
        return;
      }

      onTrimClipEnd(trimState.clipId, trimState.trimEndFrames - deltaFrames);
    };

    const handleMouseUp = () => {
      setTrimState(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onTrimClipEnd, onTrimClipStart, pixelsPerFrame, trimState]);

  useEffect(() => {
    if (!isScrubbingPlayhead) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const ruler = timelineRulerRef.current;

      if (!ruler) {
        return;
      }

      onSetPlayheadFrame(getFrameFromPointer(event.clientX, ruler));
    };

    const handleMouseUp = () => {
      setIsScrubbingPlayhead(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isScrubbingPlayhead, onSetPlayheadFrame, pixelsPerFrame, timelineFrames]);

  function setZoom(nextZoom: number, clientX?: number) {
    const clampedZoom = Math.max(2, Math.min(24, nextZoom));
    const editor = timelineEditorRef.current;

    if (!editor || typeof clientX !== "number") {
      setPixelsPerFrame(clampedZoom);
      return;
    }

    const bounds = editor.getBoundingClientRect();
    const cursorOffset = clientX - bounds.left;
    const cursorFrame = (editor.scrollLeft + cursorOffset) / pixelsPerFrame;
    const nextScrollLeft = Math.max(0, cursorFrame * clampedZoom - cursorOffset);

    setPixelsPerFrame(clampedZoom);
    requestAnimationFrame(() => {
      if (timelineEditorRef.current) {
        timelineEditorRef.current.scrollLeft = nextScrollLeft;
      }
    });
  }

  return (
    <section className="panel timeline-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Sequence</p>
          <h2>Timeline</h2>
        </div>
        <div className="timeline-meta">
          <span>{trackLayouts.length} tracks</span>
          <span>{zoomPercent}% zoom</span>
          <strong>{formatTimecode(Math.max(totalFrames - 1, 0), sequenceFps)}</strong>
        </div>
      </div>

      <div
        ref={timelineEditorRef}
        className="timeline-editor"
        onWheel={(event) => {
          const editor = event.currentTarget;
          const isMouseWheelZoom =
            event.ctrlKey ||
            event.deltaMode === WheelEvent.DOM_DELTA_LINE;

          if (isMouseWheelZoom) {
            event.preventDefault();
            setZoom(pixelsPerFrame - event.deltaY * 0.01, event.clientX);
            return;
          }

          editor.scrollLeft += event.deltaX;
          editor.scrollTop += event.deltaY;
        }}
      >
        <div
          ref={timelineRulerRef}
          className="timeline-ruler"
          style={{ width: canvasWidth }}
          onMouseDown={(event) => {
            event.preventDefault();
            onSetPlayheadFrame(getFrameFromPointer(event.clientX, event.currentTarget));
            setIsScrubbingPlayhead(true);
          }}
        >
          <div className="timeline-ruler-labels">
            <span>{formatTimecode(0, sequenceFps)}</span>
            <span>{formatTimecode(Math.floor(timelineFrames / 2), sequenceFps)}</span>
            <span>{formatTimecode(Math.max(totalFrames - 1, 0), sequenceFps)}</span>
          </div>
          <button
            className="timeline-playhead-handle"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsScrubbingPlayhead(true);
            }}
            style={{ left: playheadPosition }}
            type="button"
          />
          {markInFrame !== null ? (
            <div
              className="timeline-guide-marker mark-in"
              style={{ left: markInFrame * pixelsPerFrame }}
            >
              IN
            </div>
          ) : null}
          {markOutFrame !== null ? (
            <div
              className="timeline-guide-marker mark-out"
              style={{ left: markOutFrame * pixelsPerFrame }}
            >
              OUT
            </div>
          ) : null}
          {suggestedCutFrames.map((frame) => (
            <div
              key={`suggested-${frame}`}
              className="timeline-guide-marker ai-cut"
              style={{ left: frame * pixelsPerFrame }}
            >
              AI
            </div>
          ))}
        </div>

        <div className="timeline-rows">
          {trackLayouts.map((layout) => (
            <div key={layout.track.id} className="timeline-row">
              <div className="timeline-track-label">
                <strong>{layout.track.name}</strong>
                <span>{layout.track.kind === "video" ? "Video" : "Audio"}</span>
                <span>{layout.segments.length} clips</span>
              </div>

              <div
                className={`timeline-lane ${layout.track.kind}-lane${toolMode === "blade" ? " blade-active" : ""}`}
                style={{ width: canvasWidth }}
                onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const ratio =
                    bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0;
                  onSetPlayheadFrame(
                    Math.round(Math.max(0, Math.min(ratio, 1)) * timelineFrames)
                  );
                }}
                onDragOver={(event) => {
                  if (toolMode === "select") {
                    event.preventDefault();
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();

                  if (!dragState || dragState.trackKind !== layout.track.kind) {
                    return;
                  }

                  const bounds = event.currentTarget.getBoundingClientRect();
                  const ratio =
                    bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0;
                  const nextStartFrame = Math.round(
                    Math.max(0, Math.min(ratio, 1)) * timelineFrames
                  );

                  onMoveClipTo(dragState.clipId, layout.track.id, nextStartFrame);
                  setDragState(null);
                }}
              >
                {markInFrame !== null ? (
                  <div
                    className="timeline-guide-line mark-in"
                    style={{ left: markInFrame * pixelsPerFrame }}
                  />
                ) : null}
                {markOutFrame !== null ? (
                  <div
                    className="timeline-guide-line mark-out"
                    style={{ left: markOutFrame * pixelsPerFrame }}
                  />
                ) : null}
                {suggestedCutFrames.map((frame) => (
                  <div
                    key={`${layout.track.id}-ai-${frame}`}
                    className="timeline-guide-line ai-cut"
                    style={{ left: frame * pixelsPerFrame }}
                  />
                ))}
                <div className="timeline-playhead" style={{ left: playheadPosition }} />

                {layout.segments.map((segment) => (
                  <button
                    key={segment.clip.id}
                    className={`timeline-clip ${segment.track.kind}-clip${selectedClipId === segment.clip.id ? " selected" : ""}${segment.clip.isEnabled ? "" : " disabled"}`}
                    draggable={toolMode === "select"}
                    onClick={(event) => {
                      event.stopPropagation();

                      if (toolMode === "blade") {
                        const bounds = event.currentTarget.getBoundingClientRect();
                        const ratio =
                          bounds.width > 0
                            ? (event.clientX - bounds.left) / bounds.width
                            : 0;
                        const boundedRatio = Math.max(0, Math.min(ratio, 0.9999));
                        const clipFrame = Math.floor(
                          boundedRatio * segment.durationFrames
                        );
                        const splitFrame = segment.startFrame + clipFrame;

                        onSetPlayheadFrame(splitFrame);
                        onBladeCut(segment.clip.id, splitFrame);
                        return;
                      }

                      onSelectClip(segment.clip.id);
                    }}
                    onDragStart={() =>
                      setDragState({
                        clipId: segment.clip.id,
                        trackKind: segment.track.kind
                      })
                    }
                    onDragEnd={() => setDragState(null)}
                    style={{
                      left: segment.startFrame * pixelsPerFrame,
                      width: Math.max(segment.durationFrames * pixelsPerFrame, 64),
                      backgroundImage:
                        segment.track.kind === "video" && segment.asset.thumbnailUrl
                        ? `linear-gradient(180deg, rgba(255, 143, 61, 0.16), rgba(8, 17, 28, 0.4)), url(${segment.asset.thumbnailUrl})`
                        : undefined,
                      backgroundPosition:
                        segment.track.kind === "video" && segment.asset.thumbnailUrl
                        ? "center, left center"
                        : undefined,
                      backgroundRepeat:
                        segment.track.kind === "video" && segment.asset.thumbnailUrl
                        ? "no-repeat, repeat-x"
                        : undefined,
                      backgroundSize:
                        segment.track.kind === "video" && segment.asset.thumbnailUrl
                        ? `100% 100%, ${Math.max(72, pixelsPerFrame * 18)}px 100%`
                        : undefined
                    }}
                    type="button"
                  >
                    <span
                      className="timeline-clip-handle start"
                      onClick={(event) => {
                        event.stopPropagation();
                      }}
                      onMouseDown={(event) => {
                        if (toolMode !== "select") {
                          return;
                        }

                        event.preventDefault();
                        event.stopPropagation();
                        onSelectClip(segment.clip.id);
                        setTrimState({
                          clipId: segment.clip.id,
                          edge: "start",
                          anchorX: event.clientX,
                          trimStartFrames: segment.clip.trimStartFrames,
                          trimEndFrames: segment.clip.trimEndFrames
                        });
                      }}
                    />
                    {segment.clip.transitionIn ? (
                      <span className="timeline-transition-pill start">
                        Fade {getClipTransitionDurationFrames(
                          segment.clip.transitionIn,
                          segment.durationFrames
                        )}
                        f
                      </span>
                    ) : null}
                    <div className="timeline-clip-content">
                      <strong>{segment.asset.name}</strong>
                      <span>{formatDuration(segment.durationSeconds)}</span>
                    </div>
                    {segment.clip.transitionOut ? (
                      <span className="timeline-transition-pill end">
                        Fade {getClipTransitionDurationFrames(
                          segment.clip.transitionOut,
                          segment.durationFrames
                        )}
                        f
                      </span>
                    ) : null}
                    <span
                      className="timeline-clip-handle end"
                      onClick={(event) => {
                        event.stopPropagation();
                      }}
                      onMouseDown={(event) => {
                        if (toolMode !== "select") {
                          return;
                        }

                        event.preventDefault();
                        event.stopPropagation();
                        onSelectClip(segment.clip.id);
                        setTrimState({
                          clipId: segment.clip.id,
                          edge: "end",
                          anchorX: event.clientX,
                          trimStartFrames: segment.clip.trimStartFrames,
                          trimEndFrames: segment.clip.trimEndFrames
                        });
                      }}
                    />
                  </button>
                ))}

                {layout.segments.length === 0 ? (
                  <div className="timeline-track-empty">
                    <span>Drop a clip here</span>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
