import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import type {
  ClipEffect,
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
import { getGradeFilterStyle, GRADE_FILTER_ID } from "../lib/colorGradeRenderer";
import { computeCssFilterFromEffects } from "./EffectsPanel";

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
  /** Color grade for the current clip — applied as a CSS filter on the video element */
  colorGrade?: ColorGrade | null;
  /** Effects stack — blur, sharpen, etc. applied on top of grade */
  clipEffects?: ClipEffect[] | null;
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

// ─── Transition helpers ───────────────────────────────────────────────────────

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
    case "dipBlack":      return { overlayStyle: { background: "#000", opacity: Math.min(1, amount * 1.1) }, videoStyle: {} };
    case "dipWhite":      return { overlayStyle: { background: "#fff", opacity: Math.min(1, amount * 1.1) }, videoStyle: {} };
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
    case "blur":       return { overlayStyle: { background: "#000", opacity: amount * 0.2 }, videoStyle: { opacity: Math.max(0.1, 1 - amount*0.5) } };
    case "shake":      return { overlayStyle: { opacity: 0 }, videoStyle: { transform: `translate(${jx}px,${jy}px) scale(${1+amount*0.02}) rotate(${Math.sin(frame*0.8)*amount*1.8}deg)` } };
    case "rumble":     return { overlayStyle: { background: "radial-gradient(circle,rgba(255,143,61,0.18),rgba(0,0,0,0.45))", opacity: amount*0.7 }, videoStyle: { transform: `translate(${Math.sin(frame*0.42)*amount*32}px,${Math.cos(frame*0.57)*amount*18}px) scale(${1+amount*0.04})` } };
    case "glitch":     return { overlayStyle: { background: "repeating-linear-gradient(180deg,rgba(95,196,255,0.22) 0px,rgba(95,196,255,0.22) 2px,transparent 2px,transparent 6px)", opacity: amount*0.9, mixBlendMode: "screen" }, videoStyle: { transform: `translate(${Math.sin(frame*3.7)*amount*18}px,${Math.cos(frame*4.4)*amount*8}px) skew(${Math.sin(frame*2.6)*amount*2.5}deg)` } };
    case "filmBurn":   return { overlayStyle: { background: `radial-gradient(circle at ${50+Math.sin(frame)*30}% ${50+Math.cos(frame)*20}%, rgba(255,160,30,0.7) 0%, rgba(0,0,0,0.95) 70%)`, opacity: amount*0.85 }, videoStyle: {} };
    case "lensFlare":  return { overlayStyle: { background: `radial-gradient(circle at 80% 20%, rgba(255,255,255,0.9) 0%, rgba(100,150,255,0.4) 20%, transparent 50%)`, opacity: amount*0.7, mixBlendMode: "screen" }, videoStyle: {} };
    default:           return { overlayStyle: { opacity: 0 }, videoStyle: {} };
  }
}

// ─── Mask visual effect overlay ───────────────────────────────────────────────
//
// Renders an SVG overlay that visually shows masks on the video:
//   - Semi-transparent tinted fill inside mask area
//   - Feather effect via SVG feGaussianBlur filter
//   - Inverted masks show effect OUTSIDE the mask region
//
function buildSvgMaskOverlay(
  masks: ClipMask[],
  w: number,
  h: number,
  playheadFrame: number
): string | null {
  if (!masks.length) return null;

  const defs: string[] = [];
  const uses: string[] = [];

  for (const mask of masks) {
    if (!mask || !mask.shape) continue;

    const shape = mask.shape;
    const feather = Math.max(0, mask.feather ?? 0);
    const opacity = Math.max(0, Math.min(1, mask.opacity ?? 1));
    const inverted = mask.inverted ?? false;
    const filterId = `mf-${mask.id}`;
    const clipId = `mc-${mask.id}`;
    const maskId2 = `mm-${mask.id}`;

    // Build shape path
    let pathD = "";
    if (shape.type === "rectangle" || shape.type === "ellipse") {
      const cx = (shape.x + shape.width / 2) * w;
      const cy = (shape.y + shape.height / 2) * h;
      const hw = (shape.width / 2) * w;
      const hh = (shape.height / 2) * h;
      const rot = shape.rotation ?? 0;
      if (shape.type === "rectangle") {
        pathD = `M ${cx - hw},${cy - hh} L ${cx + hw},${cy - hh} L ${cx + hw},${cy + hh} L ${cx - hw},${cy + hh} Z`;
      } else {
        // Approximate ellipse with SVG ellipse element via path
        const rx = hw;
        const ry = hh;
        pathD = `M ${cx + rx},${cy} A ${rx},${ry} 0 1,0 ${cx - rx},${cy} A ${rx},${ry} 0 1,0 ${cx + rx},${cy} Z`;
      }
      if (rot !== 0) {
        // Embed rotation via transform on the path group
        const shapeEl = shape.type === "rectangle"
          ? `<rect x="${cx - hw}" y="${cy - hh}" width="${hw * 2}" height="${hh * 2}" transform="rotate(${rot},${cx},${cy})" />`
          : `<ellipse cx="${cx}" cy="${cy}" rx="${hw}" ry="${hh}" transform="rotate(${rot},${cx},${cy})" />`;

        // Filter for feather
        if (feather > 0) {
          defs.push(`<filter id="${filterId}" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="${feather * 0.4}" />
          </filter>`);
        }

        defs.push(`<mask id="${maskId2}">
          <rect width="${w}" height="${h}" fill="${inverted ? 'white' : 'black'}" />
          <g fill="${inverted ? 'black' : 'white'}" ${feather > 0 ? `filter="url(#${filterId})"` : ""}>
            ${shapeEl}
          </g>
        </mask>`);

        uses.push(`<rect width="${w}" height="${h}" fill="rgba(79,142,247,0.25)" opacity="${opacity}" mask="url(#${maskId2})" />`);
        continue;
      }
    } else if (shape.type === "bezier" && shape.points && shape.points.length >= 2) {
      const pts = shape.points;
      pathD = `M ${pts[0].point.x * w},${pts[0].point.y * h}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const curr = pts[i];
        const next = pts[i + 1];
        pathD += ` C ${curr.handleOut.x * w},${curr.handleOut.y * h} ${next.handleIn.x * w},${next.handleIn.y * h} ${next.point.x * w},${next.point.y * h}`;
      }
      if (pts.length >= 3) {
        const last = pts[pts.length - 1];
        const first = pts[0];
        pathD += ` C ${last.handleOut.x * w},${last.handleOut.y * h} ${first.handleIn.x * w},${first.handleIn.y * h} ${first.point.x * w},${first.point.y * h}`;
      }
      pathD += " Z";
    } else if (shape.type === "freehand" && shape.points && shape.points.length >= 3) {
      const pts = shape.points;
      pathD = `M ${pts[0].point.x * w},${pts[0].point.y * h}`;
      for (let i = 1; i < pts.length; i++) {
        pathD += ` L ${pts[i].point.x * w},${pts[i].point.y * h}`;
      }
      pathD += " Z";
    }

    if (!pathD) continue;

    // Filter
    if (feather > 0) {
      defs.push(`<filter id="${filterId}" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="${feather * 0.4}" />
      </filter>`);
    }

    // SVG mask element
    defs.push(`<mask id="${maskId2}">
      <rect width="${w}" height="${h}" fill="${inverted ? 'white' : 'black'}" />
      <path d="${pathD}" fill="${inverted ? 'black' : 'white'}" ${feather > 0 ? `filter="url(#${filterId})"` : ""} />
    </mask>`);

    // Overlay rect using the mask
    uses.push(`<rect width="${w}" height="${h}" fill="rgba(79,142,247,0.28)" opacity="${opacity}" mask="url(#${maskId2})" />`);
  }

  if (!uses.length) return null;
  void playheadFrame; // used for keyframe interpolation in future
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" style="position:absolute;inset:0;pointer-events:none;">
    <defs>${defs.join("")}</defs>
    ${uses.join("")}
  </svg>`;
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
    clipEffects,
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

    const panelRef   = useRef<HTMLElement | null>(null);
    const videoRef   = useRef<HTMLVideoElement | null>(null);
    const audioRef   = useRef<HTMLAudioElement | null>(null);
    const stageRef   = useRef<HTMLDivElement | null>(null);

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

    // ── Sync audio element volume/mute from clip settings ─────────────────────
    useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;
      const vol = activeAudioSegment?.clip.volume ?? 1;
      const track = activeAudioSegment?.track;
      const muted = track?.muted ?? false;
      audio.volume = Math.max(0, Math.min(1, vol));
      audio.muted = muted;
    }, [activeAudioSegment?.clip.volume, activeAudioSegment?.track?.muted]);

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

    // ── Derived display state ─────────────────────────────────────────────────
    const previewAsset    = activeSegment?.asset ?? selectedAsset ?? null;
    const timelineReady   = totalFrames > 0;
    const previewOpacity  = getPreviewOpacity(activeSegment, playheadFrame);
    const transitionState = getActiveTransitionState(activeSegment, playheadFrame);
    const { overlayStyle, videoStyle } = getTransitionPreviewStyles(transitionState, playheadFrame);
    const currentMasks    = activeSegment?.clip.masks ?? [];

    // ── Color grading via SVG feColorMatrix + CSS filters ──────────────────
    //
    // Per-channel R/G/B grading (lift/gamma/gain/offset wheels) is handled
    // by an SVG feColorMatrix injected as a hidden <svg> in the DOM.
    // Global adjustments (exposure, contrast, saturation, temperature)
    // are handled by a CSS filter string that references url(#grade-filter)
    // followed by brightness/contrast/saturate/hue-rotate.
    //
    const gradeStyle  = useMemo(
      () => getGradeFilterStyle(colorGrade ?? null),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [colorGrade]
    );
    const hasGrade    = Boolean(colorGrade);

    // ── Effects CSS filter (blur, sharpen, brightness, etc.) ─────────────────
    // FIX 7: compute filter from active effects and merge with grade filter
    const effectsFilter = useMemo(() => {
      if (!clipEffects || clipEffects.length === 0) return "";
      const f = computeCssFilterFromEffects(clipEffects);
      return f === "none" ? "" : f;
    }, [clipEffects]);

    // ── Mask SVG overlay ──────────────────────────────────────────────────────
    const maskSvg = useMemo(
      () => buildSvgMaskOverlay(currentMasks, stageSize.w, stageSize.h, playheadFrame),
      [currentMasks, stageSize.w, stageSize.h, playheadFrame]
    );

    return (
      <section
        ref={panelRef}
        className={`panel viewer-panel${isFullscreen ? " viewer-panel-fullscreen" : ""}`}
      >
        {/* ── Hidden SVG for per-channel grade filter ── */}
        {gradeStyle.hasSvgEffect && (
          <svg
            style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: gradeStyle.svgFilter }}
          />
        )}

        {/* ── Stage ── */}
        <div ref={stageRef} className="viewer-stage">
          {previewAsset ? (
            <>
              {/*
                * Single <video> element with CSS filter applied for color grading.
                * No canvas or WebGL — the browser compositor applies the filter on
                * the GPU. Adjusting any wheel/slider updates `gradeFilter` instantly
                * on the next React render without any RAF loop or texture uploads.
                *
                * Transition effects that previously set videoStyle.filter (blur,
                * shake, dipBlack, etc.) are now handled separately via overlayStyle
                * only, so they don't conflict with the grade filter.
                */}
              <video
                ref={videoRef}
                className="viewer-video"
                controls={false}
                style={{
                  opacity: previewOpacity,
                  // FIX 7: merge grade filter + effects filter into single CSS filter string
                  filter: [
                    gradeStyle.cssFilter !== "none" ? gradeStyle.cssFilter : "",
                    effectsFilter,
                  ].filter(Boolean).join(" ") || undefined,
                  ...videoStyle,
                }}
                muted={true}
                playsInline
                preload="metadata"
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

          {/* Mask visual effect overlay — shows tinted fill inside each mask shape */}
          {previewAsset && maskSvg && (
            <div
              className="viewer-mask-svg-overlay"
              style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
              dangerouslySetInnerHTML={{ __html: maskSvg }}
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
              <span className="viewer-grade-badge" title="Color grade active">● GRADE</span>
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
