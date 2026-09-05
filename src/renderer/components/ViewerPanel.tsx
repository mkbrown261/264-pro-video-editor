import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useCallback,
  type CSSProperties
} from "react";
import type {
  ClipEffect,
  ClipMask,
  ColorGrade,
  EditorTool,
  MediaAsset
} from "../../shared/models";
import {
  interpolateKeyframe,
  type TimelineSegment
} from "../../shared/timeline";
import {
  getActiveTransitionAtFrame,
  selectPartnerSegment,
  type ActiveTransition
} from "../../shared/transitions";
import { formatTimecode } from "../lib/format";
import { usePlaybackController, type VideoSlot } from "../hooks/usePlaybackController";
import { MaskingCanvas, type MaskTool } from "./MaskingCanvas";
import { getGradeFilterStyle, GRADE_FILTER_ID } from "../lib/colorGradeRenderer";
import { computeCssFilterFromEffects } from "./EffectsPanel";
import { interpolateKeyframes } from "./KeyframeCurveEditor";
import type { CurveKeyframe } from "./KeyframeCurveEditor";
import { isWebGLTransition, renderTransitionFrame, disposeTransitionRenderer } from "../lib/transitionRenderer";
import {
  getEdgeLayerStyle,
  getTransitionLayerStyles,
  type LayerStyle,
  type TransitionLayerStyles
} from "../lib/transitionStyles";

export interface ViewerPanelHandle {
  togglePlayback: () => Promise<void>;
  pausePlayback: () => void;
  stopPlayback: () => void;
  toggleFullscreen: () => Promise<void>;
  getVideoRef: () => HTMLVideoElement | null;
}

interface ViewerPanelProps {
  activeSegment: TimelineSegment | null;
  /** @deprecated kept for API compat — multi-track audio is managed internally */
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
  /** Called once with a ref to the AudioEngine so parent can control volume */
  onAudioEngineRef?: (ref: import("../lib/AudioScheduler").AudioEngine | null) => void;
  /** Subtitle cues to overlay on the viewer */
  subtitleCues?: import("../../shared/models").SubtitleCue[];
  /** Insert selected asset (trimmed to in/out) at playhead — ripple existing clips */
  onInsertAtPlayhead?: (assetId: string, inFrame: number, outFrame: number) => void;
  /** Overwrite at playhead with selected asset (trimmed to in/out) */
  onOverwriteAtPlayhead?: (assetId: string, inFrame: number, outFrame: number) => void;
  /** Optional: return a cached file path for a clip (from useRenderCache) */
  getCachedVideoPath?: (clipId: string) => string | null;
}

// ─── Transition helpers ───────────────────────────────────────────────────────
// Layer styling lives in ../lib/transitionStyles (pure, unit-tested).  The
// junction model (which cut is transitioning, progress, who is A / B) lives in
// ../../shared/transitions and is shared with the store and the exporter.

/** Frames before a junction starts at which the partner clip is pre-loaded. */
const PARTNER_PREP_FRAMES = 45;
/** Frames before a plain cut at which the next clip is pre-rolled. */
const PARTNER_LOOKAHEAD_FRAMES = 90;

/** WebGL shaders need real A and B frames; enabled only when both layers exist. */
function useGlTransition(t: ActiveTransition | null): boolean {
  return !!t && !!t.from && !!t.to && isWebGLTransition(t.type);
}

/**
 * Override a segment's previewUrl for the current viewer mode.
 *   • render cache (pre-trimmed, pre-graded file) takes priority — in/out are
 *     reset to 0/duration because the cached file starts at the clip's in-point;
 *   • proxyMode=false → the original source via the media:// protocol;
 *   • otherwise the asset's proxy previewUrl is used unchanged.
 */
function patchSegmentSource(
  segment: TimelineSegment,
  proxyMode: boolean,
  getCachedVideoPath: ((clipId: string) => string | null) | undefined
): TimelineSegment {
  const cachedPath = getCachedVideoPath?.(segment.clip.id);
  if (cachedPath) {
    const durSecs = segment.sourceOutSeconds - segment.sourceInSeconds;
    return {
      ...segment,
      sourceInSeconds: 0,
      sourceOutSeconds: durSecs,
      asset: { ...segment.asset, previewUrl: `file://${cachedPath}`, durationSeconds: durSecs },
    };
  }
  if (proxyMode) return segment;
  const originalUrl = `media://asset?path=${encodeURIComponent(segment.asset.sourcePath)}`;
  return { ...segment, asset: { ...segment.asset, previewUrl: originalUrl } };
}

const LAYER_VISIBLE: LayerStyle = { wrapper: { zIndex: 2 }, video: {} };
const LAYER_HIDDEN:  LayerStyle = { wrapper: { opacity: 0, zIndex: 1, visibility: "hidden" }, video: {} };

interface ResolvedLayerStyles {
  /** Layer holding the ACTIVE clip. */
  primary: LayerStyle;
  /** Layer holding the partner clip (other half of the transition / pre-roll). */
  partner: LayerStyle;
  overlay: CSSProperties;
}

/**
 * Turn the junction state into concrete styles for the two viewer layers.
 *   • no transition → primary fully visible, partner hidden (pre-rolling);
 *   • two-clip transition → A/B styles by role; the active clip is A while
 *     the playhead is before the cut and B after it;
 *   • edge fade (no neighbour) → one-sided styles on the primary;
 *   • WebGL active → both layers are hidden, the canvas draws the blend.
 */
function resolveLayerStyles(
  t: ActiveTransition | null,
  activeIsOutgoing: boolean,
  frame: number,
  glActive: boolean
): ResolvedLayerStyles {
  if (!t) return { primary: LAYER_VISIBLE, partner: LAYER_HIDDEN, overlay: { opacity: 0 } };
  if (glActive) {
    return { primary: LAYER_HIDDEN, partner: LAYER_HIDDEN, overlay: { opacity: 0 } };
  }
  if (t.from && t.to) {
    const s = getTransitionLayerStyles(t.type, t.progress, frame);
    return activeIsOutgoing
      ? { primary: s.out, partner: s.in, overlay: s.overlay }
      : { primary: s.in, partner: s.out, overlay: s.overlay };
  }
  // Edge fade: only one clip exists at this junction.
  const role = t.from ? "out" : "in";
  const s = getEdgeLayerStyle(t.type, t.progress, role, frame);
  return { primary: role === "out" ? s.out : s.in, partner: LAYER_HIDDEN, overlay: s.overlay };
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
    onAudioEngineRef,
    subtitleCues,
    onInsertAtPlayhead,
    onOverwriteAtPlayhead,
    getCachedVideoPath,
  }, ref) {

    const panelRef       = useRef<HTMLElement | null>(null);
    const videoRef       = useRef<HTMLVideoElement | null>(null);   // slot 0
    const videoBRef      = useRef<HTMLVideoElement | null>(null);   // slot 1
    // Dummy audioRef — kept for API compat with usePlaybackController signature
    const audioRef       = useRef<HTMLAudioElement | null>(null);
    const stageRef       = useRef<HTMLDivElement | null>(null);
    const webglCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const webglRafRef    = useRef<number>(0);

    // ── Hierarchical rendering: only the topmost visible video segment ────────
    // activeSegment (prop) is already the highest-trackIndex video segment
    // as computed by findAllActiveVideoSegments in App.tsx.
    // All audio segments across ALL tracks are mixed by useMultiTrackAudio
    // inside usePlaybackController — no per-segment tracking needed here.

    const [playbackMessage, setPlaybackMessage] = useState<string | null>(null);
    const [isFullscreen,    setIsFullscreen]    = useState(false);
    const [stageSize,       setStageSize]       = useState({ w: 960, h: 540 });
    // Proxy / Original toggle: when proxyMode=true use asset.previewUrl (proxy),
    // when false use the original source via media:// protocol
    const [proxyMode, setProxyMode] = useState(true);

    // ── GAP 3B: Safe Area Overlay ─────────────────────────────────────────────
    const [showSafeArea, setShowSafeArea] = useState(false);
    const [safeAreaType, setSafeAreaType] = useState<'broadcast' | 'cinema' | 'action'>('broadcast');

    // ── GAP 4: Dual Viewer (Source + Program) ─────────────────────────────────
    const [dualViewerMode, setDualViewerMode] = useState(false);
    const sourceVideoRef = useRef<HTMLVideoElement>(null);
    const [sourceInFrame, setSourceInFrame] = useState(0);
    const [sourceOutFrame, setSourceOutFrame] = useState(0);
    const [sourceCurrentFrame, setSourceCurrentFrame] = useState(0);
    const [sourcePlaying, setSourcePlaying] = useState(false);
    const sourceRafRef = useRef<number>(0);

    // Load source asset video when selectedAsset changes in dual mode
    useEffect(() => {
      const video = sourceVideoRef.current;
      if (!video || !selectedAsset?.previewUrl) return;
      video.src = selectedAsset.previewUrl;
      video.load();
      setSourceInFrame(0);
      setSourceOutFrame(0);
      setSourceCurrentFrame(0);
      setSourcePlaying(false);
    }, [selectedAsset?.previewUrl]);

    // Sync sourceCurrentFrame from video time
    useEffect(() => {
      const video = sourceVideoRef.current;
      if (!video) return;
      const onTimeUpdate = () => {
        setSourceCurrentFrame(Math.round(video.currentTime * sequenceFps));
      };
      video.addEventListener('timeupdate', onTimeUpdate);
      return () => video.removeEventListener('timeupdate', onTimeUpdate);
    }, [sequenceFps]);

    const toggleSourcePlayback = useCallback(() => {
      const video = sourceVideoRef.current;
      if (!video) return;
      if (sourcePlaying) {
        video.pause();
        setSourcePlaying(false);
      } else {
        void video.play();
        setSourcePlaying(true);
      }
    }, [sourcePlaying]);

    const setSourceIn = useCallback(() => {
      setSourceInFrame(sourceCurrentFrame);
    }, [sourceCurrentFrame]);

    const setSourceOut = useCallback(() => {
      setSourceOutFrame(sourceCurrentFrame);
    }, [sourceCurrentFrame]);

    // Cleanup source RAF on unmount
    useEffect(() => {
      return () => { if (sourceRafRef.current) cancelAnimationFrame(sourceRafRef.current); };
    }, []);

    // Build a patched version of activeSegment that overrides previewUrl
    // based on proxyMode. When using original, we construct the media:// URL
    // from the asset's sourcePath (same pattern as probeMediaFile returns).
    // Also: if a render-cached file exists for this clip, use it instead —
    // sourceInSeconds/sourceOutSeconds are reset to 0/duration because the
    // cached file is a pre-trimmed, pre-graded render from the start.
    const patchedActiveSegment = useMemo(
      () => (activeSegment ? patchSegmentSource(activeSegment, proxyMode, getCachedVideoPath) : null),
      [activeSegment, proxyMode, getCachedVideoPath]
    );

    // ── A/B transition state ─────────────────────────────────────────────────
    // The junction (if any) covering the playhead, and the clip on the other
    // side of it.  Outside a transition the partner is the NEXT clip so the
    // second slot can pre-roll it and the cut is seamless.
    const activeTransition = useMemo(
      () => getActiveTransitionAtFrame(segments, activeSegment, playheadFrame),
      [segments, activeSegment, playheadFrame]
    );
    const partnerSelection = useMemo(
      () => selectPartnerSegment(segments, activeSegment, playheadFrame, PARTNER_PREP_FRAMES, PARTNER_LOOKAHEAD_FRAMES),
      [segments, activeSegment, playheadFrame]
    );
    const partnerSegment = partnerSelection?.segment ?? null;
    const patchedPartnerSegment = useMemo(
      () => (partnerSegment ? patchSegmentSource(partnerSegment, proxyMode, getCachedVideoPath) : null),
      [partnerSegment, proxyMode, getCachedVideoPath]
    );
    /** true when the active clip is the OUTGOING half (A) of the current transition */
    const activeIsOutgoing = !!(activeTransition && activeSegment && activeTransition.from?.clip.id === activeSegment.clip.id);
    /** true when both halves of a transition are on screen (partner visible) */
    const partnerVisible = !!(activeTransition && activeTransition.from && activeTransition.to && partnerSegment &&
      (activeTransition.from.clip.id === partnerSegment.clip.id || activeTransition.to.clip.id === partnerSegment.clip.id));

    const patchedSelectedAsset = useMemo(() => {
      if (!selectedAsset) return null;
      if (proxyMode) return selectedAsset;
      const originalUrl = `media://asset?path=${encodeURIComponent(selectedAsset.sourcePath)}`;
      return { ...selectedAsset, previewUrl: originalUrl };
    }, [selectedAsset, proxyMode]);

    // ── Playback controller ───────────────────────────────────────────────────
    // activeAudioSegment is kept in props for API compat but audio is now
    // managed by useMultiTrackAudio inside usePlaybackController.
    const { togglePlayback, pausePlayback, stopPlayback, audioEngineRef, primarySlot } = usePlaybackController({
      videoRef,
      videoBRef,
      audioRef,
      activeSegment: patchedActiveSegment,
      partnerSegment: patchedPartnerSegment,
      partnerIsBlending: partnerVisible,
      activeAudioSegment: activeAudioSegment,
      segments,
      isPlaying,
      playheadFrame,
      sequenceFps,
      totalFrames,
      setPlayheadFrame:    onSetPlayheadFrame,
      setPlaybackPlaying:  onSetPlaybackPlaying,
      onPlaybackMessage:   setPlaybackMessage,
    });

    // Expose audioEngineRef to parent (for AudioMixerPanel volume control)
    useEffect(() => {
      if (onAudioEngineRef) onAudioEngineRef(audioEngineRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onAudioEngineRef]);

    async function toggleFullscreen() {
      const panel = panelRef.current;
      if (!panel) return;
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
          // State update handled by fullscreenchange listener
        } else {
          await panel.requestFullscreen();
        }
      } catch {
        // requestFullscreen can fail (e.g., called on hidden element) — clear state
        setIsFullscreen(false);
      }
    }

    useImperativeHandle(ref, () => ({
      togglePlayback,
      pausePlayback,
      stopPlayback,
      toggleFullscreen,
      // Always the element currently showing the ACTIVE clip (scopes / colour page sample it).
      getVideoRef: () => (primarySlot === 0 ? videoRef.current : videoBRef.current),
    }), [pausePlayback, stopPlayback, togglePlayback, primarySlot]);

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
    // FIX 6: Always sync isFullscreen to the actual browser fullscreen state.
    // On unmount, force-clear the class so it never persists to block other UI.
    useEffect(() => {
      const h = () => {
        const inFs = document.fullscreenElement === panelRef.current;
        setIsFullscreen(inFs);
      };
      document.addEventListener("fullscreenchange", h);
      // Also handle webkitfullscreenchange for Safari
      document.addEventListener("webkitfullscreenchange", h);
      return () => {
        document.removeEventListener("fullscreenchange", h);
        document.removeEventListener("webkitfullscreenchange", h);
        // On unmount, exit fullscreen if this panel owns it
        if (document.fullscreenElement === panelRef.current) {
          void document.exitFullscreen().catch(() => {});
        }
        setIsFullscreen(false);
      };
    }, []);

    // ── Fallback: load preview asset when no timeline clip is active ──────────
    // Targets whichever slot is currently primary (the visible one).
    useEffect(() => {
      const video = primarySlot === 0 ? videoRef.current : videoBRef.current;
      if (!video || patchedActiveSegment) return;
      if (!patchedSelectedAsset) { video.removeAttribute("src"); video.load(); return; }
      if (video.currentSrc !== patchedSelectedAsset.previewUrl) {
        video.src = patchedSelectedAsset.previewUrl;
        video.load();
      }
    }, [patchedActiveSegment, patchedSelectedAsset?.id, patchedSelectedAsset?.previewUrl, primarySlot]);

    // ── Derived display state ─────────────────────────────────────────────────
    // IMPORTANT: These must be computed BEFORE any useEffect that references them
    // to avoid the "Cannot access before initialization" TDZ error.
    const previewAsset    = patchedActiveSegment?.asset ?? patchedSelectedAsset ?? null;
    const timelineReady   = totalFrames > 0;
    const glActive        = useGlTransition(activeTransition) && partnerVisible;
    const layerStyles     = resolveLayerStyles(activeTransition, activeIsOutgoing, playheadFrame, glActive);
    const overlayStyle    = layerStyles.overlay;
    const currentMasks    = activeSegment?.clip.masks ?? [];

    // ── Clip transform (position, scale, rotation, opacity from Inspector) ─────
    // Keyframes override static transform values when present
    const clipTransform = activeSegment?.clip.transform ?? null;
    const kfs = activeSegment?.clip.keyframes;
    const kfPosX     = kfs?.posX     ? interpolateKeyframe(kfs.posX,     playheadFrame) : null;
    const kfPosY     = kfs?.posY     ? interpolateKeyframe(kfs.posY,     playheadFrame) : null;
    const kfScaleX   = kfs?.scaleX   ? interpolateKeyframe(kfs.scaleX,   playheadFrame) : null;
    const kfScaleY   = kfs?.scaleY   ? interpolateKeyframe(kfs.scaleY,   playheadFrame) : null;
    const kfRotation = kfs?.rotation ? interpolateKeyframe(kfs.rotation, playheadFrame) : null;
    const kfOpacity  = kfs?.opacity  ? interpolateKeyframe(kfs.opacity,  playheadFrame) : null;

    const effectivePosX     = kfPosX     ?? clipTransform?.posX     ?? 0;
    const effectivePosY     = kfPosY     ?? clipTransform?.posY     ?? 0;
    const effectiveScaleX   = kfScaleX   ?? clipTransform?.scaleX   ?? 1;
    const effectiveScaleY   = kfScaleY   ?? clipTransform?.scaleY   ?? 1;
    const effectiveRotation = kfRotation ?? clipTransform?.rotation ?? 0;
    const effectiveOpacity  = kfOpacity  ?? clipTransform?.opacity  ?? 1;
    const hasTransform = effectivePosX !== 0 || effectivePosY !== 0 ||
      effectiveScaleX !== 1 || effectiveScaleY !== 1 ||
      effectiveRotation !== 0 || effectiveOpacity !== 1 || !!kfs;

    const clipTransformStyle: CSSProperties = (clipTransform || kfs) ? {
      transform: [
        effectivePosX !== 0 || effectivePosY !== 0
          ? `translate(${effectivePosX * 100}%, ${effectivePosY * 100}%)`
          : "",
        effectiveScaleX !== 1 || effectiveScaleY !== 1
          ? `scale(${effectiveScaleX}, ${effectiveScaleY})`
          : "",
        effectiveRotation !== 0
          ? `rotate(${effectiveRotation}deg)`
          : "",
      ].filter(Boolean).join(" ") || undefined,
      transformOrigin: `${(clipTransform?.anchorX ?? 0.5) * 100}% ${(clipTransform?.anchorY ?? 0.5) * 100}%`,
      opacity: effectiveOpacity,
    } : {};
    void hasTransform; // used implicitly

    // Per-slot wrapper/video styles.  The clip transform (Inspector position /
    // scale / rotation) applies to the ACTIVE clip's layer; the transition
    // transform is composed on top.  The partner layer only gets its
    // transition styling (its own clip transform is not previewed mid-blend).
    const composeWrapper = (base: CSSProperties, layer: LayerStyle): CSSProperties => {
      const merged: CSSProperties = { ...base, ...layer.wrapper };
      if (base.transform && layer.wrapper.transform) merged.transform = `${base.transform} ${layer.wrapper.transform}`;
      if (base.opacity !== undefined && layer.wrapper.opacity !== undefined) {
        merged.opacity = Number(base.opacity) * Number(layer.wrapper.opacity);
      }
      return merged;
    };
    const primaryWrapperStyle = composeWrapper(clipTransformStyle, layerStyles.primary);
    const partnerWrapperStyle = composeWrapper({}, layerStyles.partner);
    const primaryVideoStyle   = layerStyles.primary.video;
    const partnerVideoStyle   = layerStyles.partner.video;
    const primaryFilter       = layerStyles.primary.filter ?? "";
    const partnerFilter       = layerStyles.partner.filter ?? "";
    // Slot → role mapping for the JSX below.
    const slotIsPrimary = (slot: VideoSlot) => slot === primarySlot;
    const styleForSlot = (slot: VideoSlot) => slotIsPrimary(slot)
      ? { wrapper: primaryWrapperStyle, video: primaryVideoStyle, filter: primaryFilter }
      : { wrapper: partnerWrapperStyle, video: partnerVideoStyle, filter: partnerFilter };

    // ── WebGL transition rendering via RAF loop ───────────────────────────────
    // IMPORTANT: Never call renderTransitionFrame inside JSX render.
    // Use a useEffect + RAF loop keyed on the active transition.  The shader
    // receives the REAL outgoing (from) and incoming (to) video elements.
    const glFromTo = useMemo((): { from: VideoSlot; to: VideoSlot } | null => {
      if (!glActive) return null;
      const partnerSlot: VideoSlot = primarySlot === 0 ? 1 : 0;
      return activeIsOutgoing ? { from: primarySlot, to: partnerSlot } : { from: partnerSlot, to: primarySlot };
    }, [glActive, primarySlot, activeIsOutgoing]);
    const glProgressRef = useRef(0);
    glProgressRef.current = activeTransition?.progress ?? 0;

    useEffect(() => {
      const canvas = webglCanvasRef.current;
      if (!canvas || !glFromTo || !activeTransition) {
        if (webglRafRef.current) {
          cancelAnimationFrame(webglRafRef.current);
          webglRafRef.current = 0;
        }
        return;
      }
      const fromEl = glFromTo.from === 0 ? videoRef.current : videoBRef.current;
      const toEl   = glFromTo.to   === 0 ? videoRef.current : videoBRef.current;
      if (!fromEl || !toEl) return;
      const type = activeTransition.type;

      let alive = true;
      const tick = () => {
        if (!alive) return;
        // Only draw once both sources have a decoded frame; otherwise the
        // texture upload would produce a black flash.
        if (fromEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            toEl.readyState   >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          renderTransitionFrame(canvas, type, fromEl, toEl, glProgressRef.current, performance.now() / 1000);
        }
        webglRafRef.current = requestAnimationFrame(tick);
      };
      webglRafRef.current = requestAnimationFrame(tick);

      return () => {
        alive = false;
        if (webglRafRef.current) cancelAnimationFrame(webglRafRef.current);
        webglRafRef.current = 0;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [glFromTo, activeTransition?.type]);

    // ── WebGL canvas cleanup on unmount ───────────────────────────────────────
    useEffect(() => {
      return () => {
        if (webglRafRef.current) cancelAnimationFrame(webglRafRef.current);
        if (webglCanvasRef.current) disposeTransitionRenderer(webglCanvasRef.current);
      };
    }, []);

    // Audio volume/mute is now managed per-segment by useMultiTrackAudio
    // inside usePlaybackController.  No audio element to sync here.

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

    // ── Keyframe interpolation: patch effect params at current frame ──────────
    // For each ClipEffect param that has CurveKeyframe[] data stored in
    // ef.keyframes[paramKey], compute the interpolated value at playheadFrame
    // and override the static param value.  This is the playback engine hook
    // for the bezier curve editor.
    const interpolatedEffects = useMemo((): ClipEffect[] => {
      if (!clipEffects || clipEffects.length === 0) return clipEffects ?? [];
      return clipEffects.map((ef) => {
        if (!ef.enabled || !ef.keyframes || Object.keys(ef.keyframes).length === 0) return ef;
        const patchedParams = { ...ef.params };
        for (const [paramKey, kfArr] of Object.entries(ef.keyframes)) {
          if (!kfArr || kfArr.length === 0) continue;
          const vals = (kfArr as CurveKeyframe[]).map((k) => k.value);
          const kMin = Math.min(...vals);
          const kMax = Math.max(...vals);
          patchedParams[paramKey] = interpolateKeyframes(
            kfArr as CurveKeyframe[],
            playheadFrame,
            kMin,
            kMax
          );
        }
        return { ...ef, params: patchedParams };
      });
    }, [clipEffects, playheadFrame]);

    // ── Effects CSS filter (blur, sharpen, brightness, etc.) ─────────────────
    // FIX 7: compute filter from active effects and merge with grade filter
    const effectsFilter = useMemo(() => {
      if (!interpolatedEffects || interpolatedEffects.length === 0) return "";
      const f = computeCssFilterFromEffects(interpolatedEffects);
      return f === "none" ? "" : f;
    }, [interpolatedEffects]);

    // ── Vignette overlay (cannot be done via CSS filter) ─────────────────────
    const vignetteEffect = useMemo(() => {
      if (!interpolatedEffects) return null;
      return interpolatedEffects.find((e) => e.enabled && e.type === "vignette") ?? null;
    }, [interpolatedEffects]);

    const vignetteStyle = useMemo((): CSSProperties | null => {
      if (!vignetteEffect) return null;
      const intensity = Number(vignetteEffect.params.intensity ?? 0.5);
      const radius    = Number(vignetteEffect.params.radius    ?? 0.7);
      const feather   = Number(vignetteEffect.params.feather   ?? 0.5);
      const stop1 = Math.round(radius * 100);
      const stop2 = Math.round(Math.min(100, (radius + feather * (1 - radius)) * 100));
      return {
        position: "absolute", inset: 0, pointerEvents: "none", borderRadius: "inherit",
        background: `radial-gradient(ellipse at 50% 50%, transparent ${stop1}%, rgba(0,0,0,${intensity.toFixed(2)}) ${stop2}%)`,
        zIndex: 5,
      };
    }, [vignetteEffect]);

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

        {/* ── GAP 4: Dual Viewer — Source panel (shown above stage in a side-by-side row when dualViewerMode) ── */}
        {dualViewerMode && (
          <div style={{ display: 'flex', gap: 4, padding: '4px 4px 0', height: '45%', minHeight: 0, overflow: 'hidden' }}>
            {/* SOURCE viewer */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0a0e1a', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ padding: '4px 8px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                SOURCE {selectedAsset ? `— ${selectedAsset.name}` : ''}
              </div>
              <div style={{ flex: 1, position: 'relative', background: '#000', overflow: 'hidden' }}>
                {selectedAsset?.previewUrl ? (
                  <video
                    ref={sourceVideoRef}
                    src={selectedAsset.previewUrl}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                    muted
                    playsInline
                    preload="auto"
                  />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontSize: 11 }}>
                    Select an asset
                  </div>
                )}
              </div>
              {/* Source transport */}
              <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4, borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
                <button onClick={toggleSourcePlayback} style={{ padding: '2px 8px', borderRadius: 4, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 11, cursor: 'pointer' }}>
                  {sourcePlaying ? '⏸' : '▶'}
                </button>
                <button onClick={setSourceIn} title="Set In Point (I)" style={{ padding: '2px 6px', borderRadius: 4, border: 'none', background: 'rgba(255,255,255,0.07)', color: '#e2e8f0', fontSize: 10, cursor: 'pointer', fontWeight: 700 }}>I</button>
                <button onClick={setSourceOut} title="Set Out Point (O)" style={{ padding: '2px 6px', borderRadius: 4, border: 'none', background: 'rgba(255,255,255,0.07)', color: '#e2e8f0', fontSize: 10, cursor: 'pointer', fontWeight: 700 }}>O</button>
                <span style={{ fontSize: 10, color: '#64748b', fontVariantNumeric: 'tabular-nums', marginLeft: 2 }}>
                  {formatTimecode(sourceCurrentFrame, sequenceFps)}
                </span>
                <span style={{ flex: 1 }} />
                {sourceOutFrame > sourceInFrame && (
                  <>
                    <button
                      title="Insert at playhead — ripples existing clips forward"
                      style={{ padding: '2px 8px', borderRadius: 4, border: 'none', background: 'rgba(124,58,237,0.3)', color: '#c4b5fd', fontSize: 10, cursor: 'pointer', fontWeight: 700 }}
                      onClick={() => {
                        if (!selectedAsset) return;
                        if (onInsertAtPlayhead) {
                          onInsertAtPlayhead(selectedAsset.id, sourceInFrame, sourceOutFrame);
                        }
                      }}
                    >Insert</button>
                    <button
                      title="Overwrite at playhead — replaces frames with asset"
                      style={{ padding: '2px 8px', borderRadius: 4, border: 'none', background: 'rgba(59,130,246,0.3)', color: '#93c5fd', fontSize: 10, cursor: 'pointer', fontWeight: 700 }}
                      onClick={() => {
                        if (!selectedAsset) return;
                        if (onOverwriteAtPlayhead) {
                          onOverwriteAtPlayhead(selectedAsset.id, sourceInFrame, sourceOutFrame);
                        }
                      }}
                    >Overwrite</button>
                  </>
                )}
              </div>
            </div>

            {/* PROGRAM label panel (just a label; the main stage below shows program) */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0a0e1a', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ padding: '4px 8px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                PROGRAM
              </div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontSize: 11 }}>
                ↓ Timeline output below
              </div>
            </div>
          </div>
        )}

        {/* ── Hidden SVG for per-channel grade filter ── */}
        {gradeStyle.hasSvgEffect && (
          <svg
            style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: gradeStyle.svgFilter }}
          />
        )}

        {/* ── FIX 7: Effects active badge ── */}
        {effectsFilter && (
          <div className="viewer-effects-badge" aria-label="Effects active">
            FX
          </div>
        )}
        {/* Proxy badge */}
        {proxyMode && previewAsset && (
          <div
            className="viewer-effects-badge"
            aria-label="Playing proxy"
            style={{ left: "auto", right: effectsFilter ? 36 : 8, background: "rgba(80,160,255,0.85)", color: "#fff" }}
          >
            P
          </div>
        )}

        {/* ── Stage ── */}
        <div ref={stageRef} className="viewer-stage">
          {previewAsset ? (
            <>
              {/*
                * Two video layers (slots 0 and 1).  Each is wrapped in a clipping
                * container so that transitions using transform (push, slide,
                * spin, shake, etc.) don't visually bleed outside the stage.
                * All transform-based styles are applied to the wrapper; filter
                * and clipPath stay on the <video> element itself.
                *
                * Which slot is the ACTIVE clip is decided by the playback
                * controller (`primarySlot`); the other slot is the transition
                * partner (or an invisible pre-roll of the next clip).
                *
                * overflow:hidden on the wrapper clips translateX/Y translations.
                * transform-origin:center ensures spin/zoom pivot around the centre.
                */}
              {([0, 1] as VideoSlot[]).map((slot) => {
                const isPrimary = slotIsPrimary(slot);
                const ls = styleForSlot(slot);
                // Colour grade + effects belong to the clip shown in this slot.
                // The primary uses the SVG-capable grade pipeline; the partner
                // gets its own clip's CSS-only grade + effects so a graded B clip
                // doesn't pop when the cut lands.
                const slotSeg = isPrimary ? activeSegment : partnerSegment;
                const slotGradeCss = isPrimary
                  ? (gradeStyle.cssFilter !== "none" ? gradeStyle.cssFilter : "")
                  : (() => { const g = getGradeFilterStyle(slotSeg?.clip.colorGrade ?? null).cssFilter; return g !== "none" ? g : ""; })();
                const slotEffectsCss = isPrimary
                  ? effectsFilter
                  : (() => { const e = slotSeg?.clip.effects; if (!e || !e.length) return ""; const f = computeCssFilterFromEffects(e); return f === "none" ? "" : f; })();
                return (
                  <div
                    key={slot}
                    className={`viewer-video-wrapper${isPrimary ? "" : " viewer-video-wrapper-partner"}`}
                    data-slot={slot}
                    data-role={isPrimary ? "primary" : "partner"}
                    style={{
                      position: "absolute",
                      inset: 0,
                      overflow: "hidden",
                      transformOrigin: "center",
                      // Partner is display:none-equivalent (opacity 0, no pointer
                      // events) unless a two-clip transition is showing it.
                      pointerEvents: "none",
                      ...ls.wrapper,
                      ...(!isPrimary && !partnerVisible ? { opacity: 0 } : {}),
                    }}
                  >
                    <video
                      ref={slot === 0 ? videoRef : videoBRef}
                      className="viewer-video"
                      controls={false}
                      style={{
                        // merge grade filter + effects filter + transition filter into a single CSS filter string
                        filter: [slotGradeCss, slotEffectsCss, ls.filter].filter(Boolean).join(" ") || undefined,
                        ...ls.video,
                      }}
                      muted={true}
                      playsInline
                      preload="auto"
                    />
                  </div>
                );
              })}
            </>
          ) : (
            <div className="viewer-empty">
              <div className="viewer-empty-icon">▶</div>
              <p>Import footage and add clips to the timeline.</p>
              <span>The viewer follows the playhead during playback.</span>
            </div>
          )}

          {/* ── GAP 3B: Safe Area Overlay ── */}
          {showSafeArea && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
              {/* Action safe area - 90% */}
              <div style={{
                position: 'absolute',
                left: '5%', top: '5%', right: '5%', bottom: '5%',
                border: '1px solid rgba(255,255,0,0.6)',
                borderRadius: 1,
              }} />
              {/* Title safe area - 80% */}
              <div style={{
                position: 'absolute',
                left: '10%', top: '10%', right: '10%', bottom: '10%',
                border: '1px solid rgba(255,100,0,0.6)',
              }} />
              {/* Cinema 2.39:1 bars */}
              {safeAreaType === 'cinema' && (
                <>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '12.5%', background: 'rgba(0,0,0,0.5)' }} />
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '12.5%', background: 'rgba(0,0,0,0.5)' }} />
                </>
              )}
              {/* Center crosshair */}
              <div style={{ position:'absolute', left:'50%', top:'50%', width:12, height:1, background:'rgba(255,255,255,0.4)', transform:'translate(-50%,-50%)' }} />
              <div style={{ position:'absolute', left:'50%', top:'50%', width:1, height:12, background:'rgba(255,255,255,0.4)', transform:'translate(-50%,-50%)' }} />
              {/* Label */}
              <div style={{ position:'absolute', top:4, left:4, fontSize:9, color:'rgba(255,255,0,0.7)', fontWeight:600, letterSpacing:'0.05em' }}>
                {safeAreaType === 'broadcast' ? 'BROADCAST 90/80' : safeAreaType === 'cinema' ? 'CINEMA 2.39:1' : 'ACTION SAFE'}
              </div>
            </div>
          )}

          {/* Vignette overlay — rendered as radial-gradient since CSS filter can't do it */}
          {previewAsset && vignetteStyle && (
            <div style={vignetteStyle} aria-hidden="true" />
          )}

          {/* Transition overlay (CSS-based for non-WebGL transitions) */}
          {previewAsset && activeTransition && !glActive && (
            <div
              className={`viewer-transition-overlay ${activeTransition.type}`}
              style={{ ...overlayStyle, zIndex: 3 }}
            />
          )}

          {/* WebGL transition canvas — always in DOM so ref is stable;
              hidden via CSS when no GL transition is active.
              Rendering is driven by the useEffect + RAF loop above, never
              called from inside the render function. */}
          <canvas
            ref={webglCanvasRef}
            className="viewer-webgl-canvas"
            style={{
              position: "absolute", inset: 0, width: "100%", height: "100%",
              pointerEvents: "none", zIndex: 4, objectFit: "contain",
              // Only show when a WebGL transition is actually active
              display: (previewAsset && glActive) ? "block" : "none",
            }}
          />

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

          {/* Subtitle overlay */}
          {previewAsset && subtitleCues && subtitleCues.filter(c => c.startFrame <= playheadFrame && c.endFrame > playheadFrame).map(cue => (
            <div key={cue.id} style={{
              position: "absolute",
              bottom: cue.style.position === "bottom" ? "8%" : undefined,
              top: cue.style.position === "top" ? "8%" : (cue.style.position === "center" ? "50%" : undefined),
              transform: cue.style.position === "center" ? "translateY(-50%) translateX(-50%)" : "translateX(-50%)",
              left: "50%",
              textAlign: cue.style.alignment,
              color: cue.style.color,
              fontSize: `${cue.style.fontSize}px`,
              fontFamily: cue.style.fontFamily,
              fontWeight: cue.style.bold ? "bold" : "normal",
              fontStyle: cue.style.italic ? "italic" : "normal",
              WebkitTextStroke: cue.style.outlineWidth > 0 ? `${cue.style.outlineWidth}px ${cue.style.outlineColor}` : undefined,
              textShadow: cue.style.outlineWidth > 0
                ? `0 0 ${cue.style.outlineWidth * 2}px ${cue.style.outlineColor}, ${cue.style.shadowOffset}px ${cue.style.shadowOffset}px ${cue.style.shadowOffset * 2}px rgba(0,0,0,0.8)`
                : cue.style.shadowOffset > 0
                  ? `${cue.style.shadowOffset}px ${cue.style.shadowOffset}px ${cue.style.shadowOffset * 2}px rgba(0,0,0,0.8)`
                  : "none",
              background: cue.style.backgroundColor !== "transparent"
                ? `${cue.style.backgroundColor}${Math.round(cue.style.backgroundOpacity * 255).toString(16).padStart(2,"0")}`
                : "transparent",
              padding: "4px 12px",
              borderRadius: 4,
              pointerEvents: "none",
              zIndex: 10,
              maxWidth: "85%",
              whiteSpace: "pre-wrap",
              lineHeight: 1.3,
            }}>
              {cue.text}
            </div>
          ))}

          {/* Title clip overlay */}
          {previewAsset && (() => {
            const activeTitleClips = segments
              .filter(s => s.clip.titleConfig && s.startFrame <= playheadFrame && s.endFrame > playheadFrame);
            return activeTitleClips.map(s => {
              const title = s.clip.titleConfig!;
              const clipProgress = s.durationFrames > 0 ? (playheadFrame - s.startFrame) / s.durationFrames : 0;
              let translateX = "-50%";
              let translateY = "0";
              let opacity = 1;

              // Animation in (first 20% of clip)
              if (title.animationIn === "fade" && clipProgress < 0.2) {
                opacity = clipProgress / 0.2;
              } else if (title.animationIn === "slide_up" && clipProgress < 0.2) {
                const t = clipProgress / 0.2;
                translateY = `${(1 - t) * 40}px`;
                opacity = t;
              } else if (title.animationIn === "slide_right" && clipProgress < 0.2) {
                const t = clipProgress / 0.2;
                translateX = `calc(-50% + ${(1 - t) * -60}px)`;
                opacity = t;
              }

              // Animation out (last 20% of clip)
              if (title.animationOut === "fade" && clipProgress > 0.8) {
                opacity = Math.min(opacity, (1 - clipProgress) / 0.2);
              } else if (title.animationOut === "slide_down" && clipProgress > 0.8) {
                const t = (clipProgress - 0.8) / 0.2;
                translateY = `${t * 40}px`;
                opacity = Math.min(opacity, 1 - t);
              } else if (title.animationOut === "slide_left" && clipProgress > 0.8) {
                const t = (clipProgress - 0.8) / 0.2;
                translateX = `calc(-50% + ${t * -60}px)`;
                opacity = Math.min(opacity, 1 - t);
              }

              return (
                <div key={s.clip.id} style={{
                  position: "absolute",
                  left: `${title.posX * 100}%`,
                  top: `${title.posY * 100}%`,
                  transform: `translateX(${translateX}) translateY(${translateY})`,
                  opacity,
                  pointerEvents: "none",
                  zIndex: 15,
                  padding: "8px 16px",
                  borderRadius: 4,
                  background: title.bgOpacity > 0
                    ? `${title.bgColor}${Math.round(title.bgOpacity * 255).toString(16).padStart(2,"0")}`
                    : "transparent",
                }}>
                  <div style={{ fontWeight: 800, fontSize: title.fontSize, color: title.color, fontFamily: title.fontFamily }}>{title.mainText}</div>
                  {title.subText && <div style={{ fontSize: title.fontSize * 0.6, color: title.color, fontFamily: title.fontFamily, opacity: 0.85 }}>{title.subText}</div>}
                </div>
              );
            });
          })()}
        </div>

        {/* Audio is fully managed by useMultiTrackAudio — no <audio> element needed here */}

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
            {/* Proxy / Original quality toggle */}
            <button
              className={`transport-btn${proxyMode ? " active" : ""}`}
              onClick={() => setProxyMode((m) => !m)}
              title={proxyMode ? "Playing proxy — click for Original quality" : "Playing Original — click for Proxy"}
              type="button"
              style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em" }}
            >
              {proxyMode ? "PROXY" : "ORIG"}
            </button>
            {hasGrade && (
              <span className="viewer-grade-badge" title="Color grade active">● GRADE</span>
            )}
            <button className={`transport-btn tool-btn${toolMode === "select" ? " active" : ""}`} onClick={() => onSetToolMode("select")} title="Select tool (A)" type="button">↖ <kbd>A</kbd></button>
            <button className={`transport-btn tool-btn${toolMode === "blade"  ? " active" : ""}`} onClick={onToggleBladeTool}            title="Blade tool (B)"  type="button">✂ <kbd>B</kbd></button>
            <button className="transport-btn muted" disabled={!activeSegment} onClick={onSplitAtPlayhead} title="Split at playhead (Cmd/Ctrl+B)" type="button">Split</button>
            <button className="transport-btn muted" onClick={() => void toggleFullscreen()} title="Fullscreen (F)" type="button">{isFullscreen ? "⊠" : "⊞"} <kbd>F</kbd></button>
            {/* Dual Viewer toggle */}
            <button
              className={`transport-btn${dualViewerMode ? " active" : ""}`}
              onClick={() => setDualViewerMode(v => !v)}
              title="Dual Viewer: Source + Program"
              type="button"
              style={{ fontSize: 10, fontWeight: 700 }}
            >⧉ Dual</button>
            {/* Safe Area toggle */}
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <button
                className={`transport-btn${showSafeArea ? " active" : ""}`}
                onClick={() => setShowSafeArea(v => !v)}
                title="Toggle Safe Area Overlay"
                type="button"
                style={{ fontSize: 10, fontWeight: 700 }}
              >Safe</button>
              {showSafeArea && (
                <select
                  value={safeAreaType}
                  onChange={(e) => setSafeAreaType(e.target.value as 'broadcast' | 'cinema' | 'action')}
                  style={{ marginLeft: 2, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, color: '#e8e8e8', fontSize: 9, padding: '2px 4px', cursor: 'pointer' }}
                  title="Safe area type"
                >
                  <option value="broadcast">Broadcast</option>
                  <option value="cinema">Cinema 2.39:1</option>
                  <option value="action">Action Safe</option>
                </select>
              )}
            </div>
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
          onInput={(e) => { stopPlayback(); onSetPlayheadFrame(Number((e.target as HTMLInputElement).value)); }}
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
