import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties
} from "react";
import type {
  ClipMask,
  ClipTransitionType,
  ColorGrade,
  EditorTool,
  MediaAsset
} from "../../shared/models";
import {
  getClipTransitionDurationFrames,
  type TimelineSegment
} from "../../shared/timeline";
import { formatTimecode } from "../lib/format";
import { usePlaybackController } from "../hooks/usePlaybackController";
import { MaskingCanvas, type MaskTool } from "./MaskingCanvas";
import { ColorGradeRenderer } from "../lib/colorGradeRenderer";

export interface ViewerPanelHandle {
  togglePlayback: () => Promise<void>;
  pausePlayback: () => void;
  stopPlayback: () => void;
  toggleFullscreen: () => Promise<void>;
  getVideoRef: () => HTMLVideoElement | null;
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
  /** Color grade for the current active clip — drives the WebGL renderer */
  colorGrade?: ColorGrade | null;
  // Masking
  activeMaskTool: MaskTool;
  selectedMaskId: string | null;
  onAddMask: (mask: ClipMask) => void;
  onUpdateMask: (maskId: string, updates: Partial<ClipMask>) => void;
  onSelectMask: (id: string | null) => void;
  // Playback callbacks
  onSetPlaybackPlaying: (isPlaying: boolean) => void;
  onSetToolMode: (toolMode: EditorTool) => void;
  onToggleBladeTool: () => void;
  onSplitAtPlayhead: () => void;
  onSetPlayheadFrame: (frame: number) => void;
  onStepFrames: (deltaFrames: number) => void;
}

// ─── Transition helpers (unchanged) ──────────────────────────────────────────

function getPreviewOpacity(activeSegment: TimelineSegment | null, frame: number): number {
  if (!activeSegment) return 1;
  const offset = Math.max(0, frame - activeSegment.startFrame);
  const toEnd  = Math.max(0, activeSegment.endFrame - frame - 1);
  const inF    = getClipTransitionDurationFrames(activeSegment.clip.transitionIn,  activeSegment.durationFrames);
  const outF   = getClipTransitionDurationFrames(activeSegment.clip.transitionOut, activeSegment.durationFrames);
  let o = 1;
  if (activeSegment.clip.transitionIn?.type  === "fade" && inF  > 0 && offset < inF)  o = Math.min(o, offset / inF);
  if (activeSegment.clip.transitionOut?.type === "fade" && outF > 0 && toEnd  < outF) o = Math.min(o, toEnd  / outF);
  return Math.max(0.08, o);
}

interface ActiveTransitionState {
  amount: number;
  edge: "in" | "out";
  progress: number;
  type: ClipTransitionType;
}

function getActiveTransitionState(activeSegment: TimelineSegment | null, frame: number): ActiveTransitionState | null {
  if (!activeSegment) return null;
  const offset = Math.max(0, frame - activeSegment.startFrame);
  const toEnd  = Math.max(0, activeSegment.endFrame - frame - 1);
  const inF    = getClipTransitionDurationFrames(activeSegment.clip.transitionIn,  activeSegment.durationFrames);
  const outF   = getClipTransitionDurationFrames(activeSegment.clip.transitionOut, activeSegment.durationFrames);
  const inAmt  = inF  > 0 && offset < inF  ? 1 - offset / inF  : 0;
  const outAmt = outF > 0 && toEnd  < outF ? 1 - toEnd  / outF : 0;
  if (inAmt <= 0 && outAmt <= 0) return null;
  if (inAmt >= outAmt) return { type: activeSegment.clip.transitionIn?.type  ?? "fade", edge: "in",  amount: inAmt,  progress: 1 - inAmt  };
  return              { type: activeSegment.clip.transitionOut?.type ?? "fade", edge: "out", amount: outAmt, progress: 1 - outAmt };
}

function getTransitionPreviewStyles(
  ts: ActiveTransitionState | null,
  frame: number
): { overlayStyle: CSSProperties; videoStyle: CSSProperties } {
  if (!ts) return { overlayStyle: { opacity: 0 }, videoStyle: {} };
  const { amount, edge, type } = ts;
  const jx = Math.sin(frame * 1.37) * amount * 22;
  const jy = Math.cos(frame * 1.11) * amount * 12;
  switch (type) {
    case "fade":
    case "crossDissolve": return { overlayStyle: { background: "#000", opacity: amount * 0.86 }, videoStyle: { opacity: Math.max(0, 1 - amount) } };
    case "dipBlack":      return { overlayStyle: { background: "#000", opacity: Math.min(1, amount * 1.1) }, videoStyle: { filter: `brightness(${Math.max(0.15, 1 - amount * 0.9)})` } };
    case "dipWhite":      return { overlayStyle: { background: "#fff", opacity: Math.min(1, amount * 1.1) }, videoStyle: { filter: `brightness(${Math.min(2,  1 + amount * 0.9)})` } };
    case "wipe":
    case "wipeLeft":   return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge === "in" ? `inset(0 ${amount*100}% 0 0)` : `inset(0 0 0 ${amount*100}%)` } };
    case "wipeRight":  return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge === "in" ? `inset(0 0 0 ${amount*100}%)` : `inset(0 ${amount*100}% 0 0)` } };
    case "wipeUp":     return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge === "in" ? `inset(${amount*100}% 0 0 0)` : `inset(0 0 ${amount*100}% 0)` } };
    case "wipeDown":   return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge === "in" ? `inset(0 0 ${amount*100}% 0)` : `inset(${amount*100}% 0 0 0)` } };
    case "pushLeft":
    case "push":       return { overlayStyle: { opacity: 0 }, videoStyle: { transform: `translateX(${edge === "in" ? amount*100 : -amount*100}%)` } };
    case "pushRight":  return { overlayStyle: { opacity: 0 }, videoStyle: { transform: `translateX(${edge === "in" ? -amount*100 : amount*100}%)` } };
    case "zoomIn":
    case "zoom":       return { overlayStyle: { background: "#000", opacity: amount * 0.3 }, videoStyle: { transform: `scale(${1 + amount*0.25})`, opacity: Math.max(0, 1 - amount*0.6) } };
    case "zoomOut":    return { overlayStyle: { background: "#000", opacity: amount * 0.3 }, videoStyle: { transform: `scale(${Math.max(0.6, 1 - amount*0.25)})`, opacity: Math.max(0, 1 - amount*0.6) } };
    case "blur":       return { overlayStyle: { background: "#000", opacity: amount * 0.2 }, videoStyle: { filter: `blur(${amount*18}px)`, opacity: Math.max(0.1, 1 - amount*0.5) } };
    case "shake":      return { overlayStyle: { opacity: 0 }, videoStyle: { transform: `translate(${jx}px,${jy}px) scale(${1+amount*0.02}) rotate(${Math.sin(frame*0.8)*amount*1.8}deg)`, filter: `blur(${amount*1.5}px) brightness(${Math.max(0.75,1-amount*0.18)})` } };
    case "rumble":     return { overlayStyle: { background: "radial-gradient(circle,rgba(255,143,61,0.18),rgba(0,0,0,0.45))", opacity: amount*0.7 }, videoStyle: { transform: `translate(${Math.sin(frame*0.42)*amount*32}px,${Math.cos(frame*0.57)*amount*18}px) scale(${1+amount*0.04})`, filter: `contrast(${1+amount*0.65}) saturate(${1+amount*0.35}) blur(${amount*1.2}px)` } };
    case "glitch":     return { overlayStyle: { background: "repeating-linear-gradient(180deg,rgba(95,196,255,0.22) 0px,rgba(95,196,255,0.22) 2px,transparent 2px,transparent 6px)", opacity: amount*0.9, mixBlendMode: "screen" }, videoStyle: { transform: `translate(${Math.sin(frame*3.7)*amount*18}px,${Math.cos(frame*4.4)*amount*8}px) skew(${Math.sin(frame*2.6)*amount*2.5}deg)`, filter: `contrast(${1+amount*1.1}) saturate(${1+amount*1.2}) hue-rotate(${amount*55}deg)` } };
    case "filmBurn":   return { overlayStyle: { background: `radial-gradient(circle at ${50+Math.sin(frame)*30}% ${50+Math.cos(frame)*20}%, rgba(255,160,30,0.7) 0%, rgba(0,0,0,0.95) 70%)`, opacity: amount*0.85 }, videoStyle: { filter: `contrast(${1+amount*0.4}) saturate(${1+amount*0.8}) brightness(${1+amount*0.3})` } };
    case "lensFlare":  return { overlayStyle: { background: `radial-gradient(circle at 80% 20%, rgba(255,255,255,0.9) 0%, rgba(100,150,255,0.4) 20%, transparent 50%)`, opacity: amount*0.7, mixBlendMode: "screen" }, videoStyle: { filter: `brightness(${1+amount*0.4})` } };
    default:           return { overlayStyle: { opacity: 0 }, videoStyle: {} };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export const ViewerPanel = forwardRef<ViewerPanelHandle, ViewerPanelProps>(
  function ViewerPanel({
    activeSegment,
    activeAudioSegment,
    segments,
    selectedAsset,
    playheadFrame,
    totalFrames,
    sequenceFps,
    isPlaying,
    toolMode,
    colorGrade,
    activeMaskTool,
    selectedMaskId,
    onAddMask,
    onUpdateMask,
    onSelectMask,
    onSetPlaybackPlaying,
    onSetToolMode,
    onToggleBladeTool,
    onSplitAtPlayhead,
    onSetPlayheadFrame,
    onStepFrames,
  }, ref) {

    const panelRef       = useRef<HTMLElement | null>(null);
    const videoRef       = useRef<HTMLVideoElement | null>(null);
    const audioRef       = useRef<HTMLAudioElement | null>(null);
    const stageRef       = useRef<HTMLDivElement | null>(null);
    const gradeCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const rendererRef    = useRef<ColorGradeRenderer | null>(null);

    const [playbackMessage, setPlaybackMessage] = useState<string | null>(null);
    const [isFullscreen,    setIsFullscreen]    = useState(false);
    const [stageSize,       setStageSize]       = useState({ w: 960, h: 540 });

    // ── Playback controller ───────────────────────────────────────────────────
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
      setPlayheadFrame:    onSetPlayheadFrame,
      setPlaybackPlaying:  onSetPlaybackPlaying,
      onPlaybackMessage:   setPlaybackMessage,
    });

    async function toggleFullscreen() {
      const panel = panelRef.current;
      if (!panel) return;
      if (document.fullscreenElement === panel) await document.exitFullscreen();
      else await panel.requestFullscreen();
    }

    useImperativeHandle(ref, () => ({
      togglePlayback,
      pausePlayback,
      stopPlayback,
      toggleFullscreen,
      getVideoRef: () => videoRef.current,
    }), [pausePlayback, stopPlayback, togglePlayback]);

    // ── Stage resize observer ─────────────────────────────────────────────────
    useEffect(() => {
      const stage = stageRef.current;
      if (!stage) return;
      const ro = new ResizeObserver((entries) => {
        const e = entries[0];
        if (e) setStageSize({ w: e.contentRect.width, h: e.contentRect.height });
      });
      ro.observe(stage);
      return () => ro.disconnect();
    }, []);

    // ── Fullscreen listener ───────────────────────────────────────────────────
    useEffect(() => {
      const h = () => setIsFullscreen(document.fullscreenElement === panelRef.current);
      document.addEventListener("fullscreenchange", h);
      return () => document.removeEventListener("fullscreenchange", h);
    }, []);

    // ── Fallback: load preview asset when no timeline clip is active ──────────
    useEffect(() => {
      const video = videoRef.current;
      if (!video || activeSegment) return;
      if (!selectedAsset) { video.removeAttribute("src"); video.load(); return; }
      if (video.currentSrc !== selectedAsset.previewUrl) {
        video.src = selectedAsset.previewUrl;
        video.load();
      }
    }, [activeSegment, selectedAsset?.id, selectedAsset?.previewUrl]);

    // ── WebGL color grade renderer ────────────────────────────────────────────
    //
    // Lifecycle: create when canvas mounts, destroy when unmounts.
    // The renderer runs its own RAF loop reading from videoRef every frame.
    // Whenever colorGrade changes (any wheel, slider, or curve touch), we call
    // renderer.setGrade() which bumps an internal version counter — the next RAF
    // tick uploads new uniforms and redraws instantly (GPU, ~0 ms).
    //
    useEffect(() => {
      const canvas = gradeCanvasRef.current;
      if (!canvas) return;
      const renderer = new ColorGradeRenderer(canvas);
      rendererRef.current = renderer;
      renderer.setVideo(videoRef.current);
      renderer.start();
      return () => {
        renderer.dispose();
        rendererRef.current = null;
      };
    }, []); // only on mount/unmount

    // Sync video element reference into renderer every render pass so it's
    // never stale (video ref stays the same object but its .current can update).
    useEffect(() => {
      rendererRef.current?.setVideo(videoRef.current);
    });

    // Push the latest grade to the renderer immediately when it changes.
    // colorGrade is the prop from the store — changes are instant.
    useEffect(() => {
      rendererRef.current?.setGrade(colorGrade ?? null);
    }, [colorGrade]);

    // ── Derived display state ─────────────────────────────────────────────────
    const previewAsset    = activeSegment?.asset ?? selectedAsset ?? null;
    const timelineReady   = totalFrames > 0;
    const previewOpacity  = getPreviewOpacity(activeSegment, playheadFrame);
    const transitionState = getActiveTransitionState(activeSegment, playheadFrame);
    const { overlayStyle, videoStyle } = getTransitionPreviewStyles(transitionState, playheadFrame);
    const currentMasks    = activeSegment?.clip.masks ?? [];

    // When a grade is active the raw <video> is hidden (opacity 0, pointer-events none)
    // and the graded <canvas> sits on top at the same size.
    const hasGrade = Boolean(colorGrade);

    return (
      <section
        ref={panelRef}
        className={`panel viewer-panel${isFullscreen ? " viewer-panel-fullscreen" : ""}`}
      >
        {/* ── Stage ── */}
        <div ref={stageRef} className="viewer-stage">
          {previewAsset ? (
            <>
              {/* Raw video — always in DOM so WebGL can read its frames.
                  Hidden visually when grade is active. */}
              <video
                ref={videoRef}
                className="viewer-video"
                controls={!timelineReady && !hasGrade}
                style={{
                  opacity: hasGrade ? 0 : previewOpacity,
                  ...videoStyle,
                  // Keep it in layout flow at same position; canvas overlaps it
                  ...(hasGrade ? { position: "absolute", inset: 0, pointerEvents: "none" } : {}),
                }}
                muted={timelineReady}
                playsInline
                preload="metadata"
              />

              {/* WebGL graded canvas — same size as stage, shown only when grade active */}
              <canvas
                ref={gradeCanvasRef}
                className="viewer-grade-canvas"
                style={{
                  display:  hasGrade ? "block" : "none",
                  opacity:  previewOpacity,
                  // Transition styles (wipe, zoom, etc.) applied to canvas too
                  ...(videoStyle as CSSProperties),
                }}
              />
            </>
          ) : (
            <div className="viewer-empty">
              <div className="viewer-empty-icon">▶</div>
              <p>Import footage and add clips to the timeline.</p>
              <span>The viewer follows the playhead during playback.</span>
            </div>
          )}

          {/* Transition overlay */}
          {previewAsset && (
            <div
              className={`viewer-transition-overlay${transitionState ? ` ${transitionState.type}` : ""}`}
              style={overlayStyle}
            />
          )}

          {/* Masking canvas overlay */}
          {previewAsset && (
            <MaskingCanvas
              width={stageSize.w}
              height={stageSize.h}
              masks={currentMasks}
              selectedMaskId={selectedMaskId}
              activeTool={activeMaskTool}
              playheadFrame={playheadFrame}
              onAddMask={onAddMask}
              onUpdateMask={onUpdateMask}
              onSelectMask={onSelectMask}
            />
          )}
        </div>

        <audio ref={audioRef} preload="metadata" />

        {/* ── Transport bar ── */}
        <div className="transport-bar">
          <div className="transport-left">
            <button className="transport-btn muted" disabled={!timelineReady} onClick={() => onStepFrames(-1)} title="Previous frame (←)" type="button">⏮ <kbd>←</kbd></button>
            <button className={`transport-btn play-btn${isPlaying ? " playing" : ""}`} disabled={!timelineReady} onClick={() => void togglePlayback()} title="Play/Pause (Space)" type="button">
              {isPlaying ? "⏸" : "▶"}<kbd>Space</kbd>
            </button>
            <button className="transport-btn muted" disabled={!timelineReady} onClick={() => onStepFrames(1)}  title="Next frame (→)"    type="button">⏭ <kbd>→</kbd></button>
            <button className="transport-btn muted" disabled={!timelineReady} onClick={stopPlayback}           title="Stop (K)"           type="button">⏹ <kbd>K</kbd></button>
          </div>

          <div className="transport-timecode">
            <strong className="timecode-current">{formatTimecode(playheadFrame, sequenceFps)}</strong>
            <span className="timecode-sep">/</span>
            <span className="timecode-total">{formatTimecode(Math.max(totalFrames - 1, 0), sequenceFps)}</span>
          </div>

          <div className="transport-right">
            {hasGrade && (
              <span className="viewer-grade-badge" title="Color grade active — WebGL">● GRADE</span>
            )}
            <button className={`transport-btn tool-btn${toolMode === "select" ? " active" : ""}`} onClick={() => onSetToolMode("select")} title="Select tool (A)" type="button">↖ <kbd>A</kbd></button>
            <button className={`transport-btn tool-btn${toolMode === "blade"  ? " active" : ""}`} onClick={onToggleBladeTool}            title="Blade tool (B)"  type="button">✂ <kbd>B</kbd></button>
            <button className="transport-btn muted" disabled={!activeSegment} onClick={onSplitAtPlayhead} title="Split at playhead (Cmd/Ctrl+B)" type="button">Split</button>
            <button className="transport-btn muted" onClick={() => void toggleFullscreen()} title="Fullscreen (F)" type="button">{isFullscreen ? "⊠" : "⊞"} <kbd>F</kbd></button>
          </div>
        </div>

        {/* ── Scrub bar ── */}
        <input
          className="scrub-bar"
          type="range"
          min={0}
          max={Math.max(totalFrames - 1, 0)}
          step={1}
          value={Math.min(playheadFrame, Math.max(totalFrames - 1, 0))}
          disabled={!timelineReady}
          onChange={(e) => { stopPlayback(); onSetPlayheadFrame(Number(e.target.value)); }}
        />

        {playbackMessage && <div className="playback-message">{playbackMessage}</div>}

        <div className="playback-hint">
          <kbd>Space</kbd> Play / Pause &nbsp;·&nbsp;
          <kbd>J</kbd> Rev &nbsp;·&nbsp;
          <kbd>K</kbd> Stop &nbsp;·&nbsp;
          <kbd>L</kbd> Fwd &nbsp;·&nbsp;
          <kbd>←</kbd><kbd>→</kbd> Step frame &nbsp;·&nbsp;
          <kbd>B</kbd> Blade
        </div>
      </section>
    );
  }
);
