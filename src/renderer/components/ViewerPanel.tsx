import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties
} from "react";
import type {
  ClipTransitionType,
  EditorTool,
  MediaAsset
} from "../../shared/models";
import {
  getClipTransitionDurationFrames,
  type TimelineSegment
} from "../../shared/timeline";
import { formatTimecode } from "../lib/format";
import { usePlaybackController } from "../hooks/usePlaybackController";

export interface ViewerPanelHandle {
  togglePlayback: () => Promise<void>;
  pausePlayback: () => void;
  stopPlayback: () => void;
  toggleFullscreen: () => Promise<void>;
}

interface ViewerPanelProps {
  activeSegment: TimelineSegment | null;
  activeAudioSegment: TimelineSegment | null;
  segments: TimelineSegment[];
  selectedAsset: MediaAsset | null;
  playheadFrame: number;
  totalFrames: number;
  sequenceFps: number;
  isPlaying: boolean;
  toolMode: EditorTool;
  onSetPlaybackPlaying: (isPlaying: boolean) => void;
  onSetToolMode: (toolMode: EditorTool) => void;
  onToggleBladeTool: () => void;
  onSplitAtPlayhead: () => void;
  onSetPlayheadFrame: (frame: number) => void;
  onStepFrames: (deltaFrames: number) => void;
}

function getPreviewOpacity(
  activeSegment: TimelineSegment | null,
  playheadFrame: number
): number {
  if (!activeSegment) {
    return 1;
  }

  const segmentOffsetFrames = Math.max(0, playheadFrame - activeSegment.startFrame);
  const framesUntilEnd = Math.max(0, activeSegment.endFrame - playheadFrame - 1);
  const transitionInFrames = getClipTransitionDurationFrames(
    activeSegment.clip.transitionIn,
    activeSegment.durationFrames
  );
  const transitionOutFrames = getClipTransitionDurationFrames(
    activeSegment.clip.transitionOut,
    activeSegment.durationFrames
  );
  let opacity = 1;

  if (
    activeSegment.clip.transitionIn?.type === "fade" &&
    transitionInFrames > 0 &&
    segmentOffsetFrames < transitionInFrames
  ) {
    opacity = Math.min(opacity, segmentOffsetFrames / transitionInFrames);
  }

  if (
    activeSegment.clip.transitionOut?.type === "fade" &&
    transitionOutFrames > 0 &&
    framesUntilEnd < transitionOutFrames
  ) {
    opacity = Math.min(opacity, framesUntilEnd / transitionOutFrames);
  }

  return Math.max(0.08, opacity);
}

interface ActiveTransitionState {
  amount: number;
  edge: "in" | "out";
  progress: number;
  type: ClipTransitionType;
}

function getActiveTransitionState(
  activeSegment: TimelineSegment | null,
  playheadFrame: number
): ActiveTransitionState | null {
  if (!activeSegment) {
    return null;
  }

  const segmentOffsetFrames = Math.max(0, playheadFrame - activeSegment.startFrame);
  const framesUntilEnd = Math.max(0, activeSegment.endFrame - playheadFrame - 1);
  const transitionInFrames = getClipTransitionDurationFrames(
    activeSegment.clip.transitionIn,
    activeSegment.durationFrames
  );
  const transitionOutFrames = getClipTransitionDurationFrames(
    activeSegment.clip.transitionOut,
    activeSegment.durationFrames
  );
  const inAmount =
    transitionInFrames > 0 && segmentOffsetFrames < transitionInFrames
      ? 1 - segmentOffsetFrames / transitionInFrames
      : 0;
  const outAmount =
    transitionOutFrames > 0 && framesUntilEnd < transitionOutFrames
      ? 1 - framesUntilEnd / transitionOutFrames
      : 0;

  if (inAmount <= 0 && outAmount <= 0) {
    return null;
  }

  if (inAmount >= outAmount) {
    return {
      type: activeSegment.clip.transitionIn?.type ?? "fade",
      edge: "in",
      amount: inAmount,
      progress: 1 - inAmount
    };
  }

  return {
    type: activeSegment.clip.transitionOut?.type ?? "fade",
    edge: "out",
    amount: outAmount,
    progress: 1 - outAmount
  };
}

function getTransitionPreviewStyles(
  transitionState: ActiveTransitionState | null,
  playheadFrame: number
): {
  overlayStyle: CSSProperties;
  videoStyle: CSSProperties;
} {
  if (!transitionState) {
    return {
      overlayStyle: { opacity: 0 },
      videoStyle: {}
    };
  }

  const { amount, edge, type } = transitionState;
  const jitterX = Math.sin(playheadFrame * 1.37) * amount * 22;
  const jitterY = Math.cos(playheadFrame * 1.11) * amount * 12;

  switch (type) {
    case "fade":
      return {
        overlayStyle: {
          background: "rgba(0, 0, 0, 1)",
          opacity: amount * 0.86
        },
        videoStyle: {
          opacity: Math.max(0, 1 - amount)
        }
      };
    case "dipBlack":
      return {
        overlayStyle: {
          background: "rgba(0, 0, 0, 1)",
          opacity: Math.min(1, amount * 1.1)
        },
        videoStyle: {
          filter: `brightness(${Math.max(0.15, 1 - amount * 0.9)})`
        }
      };
    case "wipe":
      return {
        overlayStyle: { opacity: 0 },
        videoStyle: {
          clipPath:
            edge === "in"
              ? `inset(0 ${amount * 100}% 0 0 round 22px)`
              : `inset(0 0 0 ${amount * 100}% round 22px)`
        }
      };
    case "shake":
      return {
        overlayStyle: { opacity: 0 },
        videoStyle: {
          transform: `translate(${jitterX}px, ${jitterY}px) scale(${1 + amount * 0.02}) rotate(${Math.sin(playheadFrame * 0.8) * amount * 1.8}deg)`,
          filter: `blur(${amount * 1.5}px) brightness(${Math.max(0.75, 1 - amount * 0.18)})`
        }
      };
    case "rumble":
      return {
        overlayStyle: {
          background:
            "radial-gradient(circle at center, rgba(255,143,61,0.18), rgba(0,0,0,0.45))",
          opacity: amount * 0.7
        },
        videoStyle: {
          transform: `translate(${Math.sin(playheadFrame * 0.42) * amount * 32}px, ${Math.cos(playheadFrame * 0.57) * amount * 18}px) scale(${1 + amount * 0.04})`,
          filter: `contrast(${1 + amount * 0.65}) saturate(${1 + amount * 0.35}) blur(${amount * 1.2}px)`
        }
      };
    case "glitch":
      return {
        overlayStyle: {
          background:
            "repeating-linear-gradient(180deg, rgba(95,196,255,0.22) 0px, rgba(95,196,255,0.22) 2px, transparent 2px, transparent 6px)",
          opacity: amount * 0.9,
          mixBlendMode: "screen"
        },
        videoStyle: {
          transform: `translate(${Math.sin(playheadFrame * 3.7) * amount * 18}px, ${Math.cos(playheadFrame * 4.4) * amount * 8}px) skew(${Math.sin(playheadFrame * 2.6) * amount * 2.5}deg)`,
          filter: `contrast(${1 + amount * 1.1}) saturate(${1 + amount * 1.2}) hue-rotate(${amount * 55}deg) brightness(${Math.max(0.72, 1 - amount * 0.2)})`
        }
      };
    default:
      return {
        overlayStyle: { opacity: 0 },
        videoStyle: {}
      };
  }
}

export const ViewerPanel = forwardRef<ViewerPanelHandle, ViewerPanelProps>(
  function ViewerPanel(
    {
      activeSegment,
      activeAudioSegment,
      segments,
      selectedAsset,
      playheadFrame,
      totalFrames,
      sequenceFps,
      isPlaying,
      toolMode,
      onSetPlaybackPlaying,
      onSetToolMode,
      onToggleBladeTool,
      onSplitAtPlayhead,
      onSetPlayheadFrame,
      onStepFrames
    },
    ref
  ) {
    const panelRef = useRef<HTMLElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [playbackMessage, setPlaybackMessage] = useState<string | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const { togglePlayback, pausePlayback, stopPlayback } = usePlaybackController({
      videoRef,
      audioRef,
      activeSegment,
      activeAudioSegment,
      segments,
      isPlaying,
      playheadFrame,
      sequenceFps,
      totalFrames,
      setPlayheadFrame: onSetPlayheadFrame,
      setPlaybackPlaying: onSetPlaybackPlaying,
      onPlaybackMessage: setPlaybackMessage
    });

    async function toggleFullscreen() {
      const panel = panelRef.current;

      if (!panel) {
        return;
      }

      if (document.fullscreenElement === panel) {
        await document.exitFullscreen();
        return;
      }

      await panel.requestFullscreen();
    }

    useImperativeHandle(
      ref,
      () => ({
        togglePlayback,
        pausePlayback,
        stopPlayback,
        toggleFullscreen
      }),
      [pausePlayback, stopPlayback, togglePlayback, toggleFullscreen]
    );

    const previewAsset = activeSegment?.asset ?? selectedAsset ?? null;
    const timelineReady = totalFrames > 0;
    const durationLabel = formatTimecode(Math.max(totalFrames - 1, 0), sequenceFps);
    const previewOpacity = getPreviewOpacity(activeSegment, playheadFrame);
    const transitionState = getActiveTransitionState(activeSegment, playheadFrame);
    const { overlayStyle, videoStyle } = getTransitionPreviewStyles(
      transitionState,
      playheadFrame
    );

    useEffect(() => {
      const video = videoRef.current;

      if (!video || activeSegment) {
        return;
      }

      if (!previewAsset) {
        video.removeAttribute("src");
        video.load();
        return;
      }

      if (video.currentSrc !== previewAsset.previewUrl) {
        video.src = previewAsset.previewUrl;
        video.load();
      }
    }, [activeSegment, previewAsset?.id, previewAsset?.previewUrl]);

    useEffect(() => {
      const handleFullscreenChange = () => {
        setIsFullscreen(document.fullscreenElement === panelRef.current);
      };

      document.addEventListener("fullscreenchange", handleFullscreenChange);

      return () => {
        document.removeEventListener("fullscreenchange", handleFullscreenChange);
      };
    }, []);

    return (
      <section
        ref={panelRef}
        className={`panel viewer-panel${isFullscreen ? " viewer-panel-fullscreen" : ""}`}
      >
        <div className="panel-header">
          <div>
            <p className="eyebrow">Playback</p>
            <h2>Viewer</h2>
          </div>
          <div className="viewer-status">
            <span>{timelineReady ? "Timeline mode" : "Source mode"}</span>
            <strong>{previewAsset?.name ?? "No source selected"}</strong>
          </div>
        </div>

        <div className="viewer-stage">
          {previewAsset ? (
            <video
              ref={videoRef}
              className="viewer-video"
              controls={!timelineReady}
              style={{
                opacity: previewOpacity,
                ...videoStyle
              }}
              muted={timelineReady}
              playsInline
              preload="metadata"
            />
          ) : (
            <div className="viewer-empty">
              <p>Import footage and add a clip to the timeline.</p>
              <span>The viewer will follow the active timeline clip during playback.</span>
            </div>
          )}
          {previewAsset ? (
            <div
              className={`viewer-transition-overlay${
                transitionState ? ` ${transitionState.type}` : ""
              }`}
              style={overlayStyle}
            />
          ) : null}
        </div>
        <audio ref={audioRef} preload="metadata" />

        <div className="transport-bar">
          <div className="transport-buttons">
            <button
              className="panel-action muted"
              disabled={!timelineReady}
              onClick={() => onStepFrames(-1)}
              type="button"
            >
              Prev Frame
              <kbd>←</kbd>
            </button>
            <button
              className="panel-action"
              disabled={!timelineReady}
              onClick={() => void togglePlayback()}
              type="button"
            >
              {isPlaying ? "Pause" : "Play"}
              <kbd>Space</kbd>
            </button>
            <button
              className="panel-action muted"
              disabled={!timelineReady}
              onClick={() => onStepFrames(1)}
              type="button"
            >
              Next Frame
              <kbd>→</kbd>
            </button>
            <button
              className="panel-action muted"
              disabled={!activeSegment}
              onClick={onSplitAtPlayhead}
              type="button"
            >
              Split
              <kbd>{navigator.platform.includes("Mac") ? "Cmd+B" : "Ctrl+B"}</kbd>
            </button>
            <button
              className={`panel-action tool-button${toolMode === "select" ? " active" : ""}`}
              onClick={() => onSetToolMode("select")}
              type="button"
            >
              Select
              <kbd>A</kbd>
            </button>
            <button
              className={`panel-action tool-button${toolMode === "blade" ? " active" : ""}`}
              onClick={onToggleBladeTool}
              type="button"
            >
              Blade
              <kbd>B</kbd>
            </button>
            <button
              className="panel-action muted"
              disabled={!timelineReady}
              onClick={stopPlayback}
              type="button"
            >
              Stop
              <kbd>K</kbd>
            </button>
            <button
              className="panel-action muted"
              onClick={() => void toggleFullscreen()}
              type="button"
            >
              {isFullscreen ? "Exit Full Screen" : "Full Screen"}
              <kbd>F</kbd>
            </button>
          </div>

          <div className="transport-readout">
            <strong>{formatTimecode(playheadFrame, sequenceFps)}</strong>
            <span>{durationLabel}</span>
          </div>
        </div>

        <input
          className="scrub-bar"
          type="range"
          min={0}
          max={Math.max(totalFrames - 1, 0)}
          step={1}
          value={Math.min(playheadFrame, Math.max(totalFrames - 1, 0))}
          onChange={(event) => {
            stopPlayback();
            onSetPlayheadFrame(Number(event.target.value));
          }}
          disabled={!timelineReady}
        />

        <div className="shortcut-strip">
          <span>
            <kbd>Space</kbd>
            Play/Pause
          </span>
          <span>
            <kbd>A</kbd>
            Select
          </span>
          <span>
            <kbd>B</kbd>
            Blade
          </span>
          <span>
            <kbd>{navigator.platform.includes("Mac") ? "Cmd+B" : "Ctrl+B"}</kbd>
            Split
          </span>
          <span>
            <kbd>Shift+←/→</kbd>
            1 sec jump
          </span>
          <span>
            <kbd>Delete</kbd>
            Remove clip
          </span>
          <span>
            <kbd>F</kbd>
            Full screen
          </span>
        </div>

        {playbackMessage ? (
          <div className="playback-message">{playbackMessage}</div>
        ) : null}
      </section>
    );
  }
);
