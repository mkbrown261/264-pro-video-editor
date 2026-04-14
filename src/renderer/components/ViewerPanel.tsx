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
  ClipTransitionType,
  ColorGrade,
  EditorTool,
  MediaAsset
} from "../../shared/models";
import {
  getClipTransitionDurationFrames,
  interpolateKeyframe,
  type TimelineSegment
} from "../../shared/timeline";
import { formatTimecode } from "../lib/format";
import { usePlaybackController } from "../hooks/usePlaybackController";
import { MaskingCanvas, type MaskTool } from "./MaskingCanvas";
import { getGradeFilterStyle, GRADE_FILTER_ID } from "../lib/colorGradeRenderer";
import { computeCssFilterFromEffects } from "./EffectsPanel";
import { isWebGLTransition, renderTransitionFrame, disposeTransitionRenderer } from "../lib/transitionRenderer";

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

// getTransitionPreviewStyles returns three style objects:
//   overlayStyle  — applied to the transition-overlay <div> (color overlays, flashes)
//   videoStyle    — applied to the <video> element (opacity, clipPath, CSS filters)
//   wrapperStyle  — applied to the video wrapper <div> (transform: translate/rotate/scale)
//                   The wrapper has overflow:hidden so transforms that move video
//                   off-screen don't bleed outside the stage.
//
// IMPORTANT: `transform` must never go on the <video> element itself because:
//   1. It can physically rotate/move the element in the DOM layout, breaking masking.
//   2. `overflow:hidden` on the wrapper clips translations at the stage boundary.
type TransitionStyles = {
  overlayStyle: CSSProperties;
  videoStyle: CSSProperties & { transitionFilter?: string };
  wrapperStyle: CSSProperties; // transform applied to wrapper, not video
};
const NO_TRANSITION: TransitionStyles = { overlayStyle: { opacity: 0 }, videoStyle: {}, wrapperStyle: {} };
function w(transform: string): TransitionStyles { return { overlayStyle: { opacity: 0 }, videoStyle: {}, wrapperStyle: { transform } }; }
function wOpacity(transform: string, opacity: number): TransitionStyles { return { overlayStyle: { opacity: 0 }, videoStyle: { opacity }, wrapperStyle: { transform } }; }

function getTransitionPreviewStyles(
  ts: ActiveTransitionState | null,
  frame: number
): TransitionStyles {
  if (!ts) return NO_TRANSITION;
  const { amount, edge, type } = ts;
  // amount: 1 = fully in transition (clip change just happened), 0 = transition done
  // For "in" edge: amount goes 1 → 0 as the incoming clip appears
  // For "out" edge: amount goes 1 → 0 as the outgoing clip disappears
  const jx = Math.sin(frame * 1.37) * amount * 22;
  const jy = Math.cos(frame * 1.11) * amount * 12;
  switch (type) {
    // ── Dissolves / Opacity transitions ─────────────────────────────────
    case "fade":
    case "crossDissolve":    return { overlayStyle: { background: "#000", opacity: amount * 0.86 }, videoStyle: { opacity: Math.max(0, 1 - amount) }, wrapperStyle: {} };
    case "dipBlack":         return { overlayStyle: { background: "#000", opacity: Math.min(1, amount * 1.1) }, videoStyle: {}, wrapperStyle: {} };
    case "dipWhite":         return { overlayStyle: { background: "#fff", opacity: Math.min(1, amount * 1.1) }, videoStyle: {}, wrapperStyle: {} };
    case "dipColor":         return { overlayStyle: { background: "#800080", opacity: Math.min(1, amount * 1.1) }, videoStyle: {}, wrapperStyle: {} };
    case "luminanceDissolve":return { overlayStyle: { background: "#fff", opacity: amount * 0.5 }, videoStyle: { opacity: Math.max(0, 1 - amount) }, wrapperStyle: {} };
    case "filmDissolve":     return { overlayStyle: { background: `linear-gradient(135deg,rgba(${Math.floor(200+frame%55)},${Math.floor(100+frame%80)},50,0.5),rgba(0,0,0,0.7))`, opacity: amount * 0.7 }, videoStyle: { opacity: Math.max(0, 1 - amount) }, wrapperStyle: {} };
    case "additiveDissolve": return { overlayStyle: { background: "#fff", opacity: amount * amount * 0.6 }, videoStyle: { opacity: Math.max(0, 1 - amount * 0.8) }, wrapperStyle: {} };
    // ── Wipes (clipPath on video, no transform) ──────────────────────
    case "wipe":
    case "wipeLeft":     return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge==="in" ? `inset(0 ${amount*100}% 0 0)` : `inset(0 0 0 ${amount*100}%)` }, wrapperStyle: {} };
    case "wipeRight":    return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge==="in" ? `inset(0 0 0 ${amount*100}%)` : `inset(0 ${amount*100}% 0 0)` }, wrapperStyle: {} };
    case "wipeUp":       return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge==="in" ? `inset(${amount*100}% 0 0 0)` : `inset(0 0 ${amount*100}% 0)` }, wrapperStyle: {} };
    case "wipeDown":     return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge==="in" ? `inset(0 0 ${amount*100}% 0)` : `inset(${amount*100}% 0 0 0)` }, wrapperStyle: {} };
    case "wipeDiagTL":   return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge==="in" ? `polygon(0 0,${(1-amount)*100}% 0,0 ${(1-amount)*100}%)` : `polygon(0 0,100% 0,100% 100%,0 100%,0 ${amount*100}%,${amount*100}% 0)` }, wrapperStyle: {} };
    case "wipeDiagTR":   return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge==="in" ? `polygon(100% 0,100% ${(1-amount)*100}%,${100-(1-amount)*100}% 0)` : `polygon(0 0,100% 0,100% 100%,0 100%,${(1-amount)*100}% 0,100% ${(1-amount)*100}%)` }, wrapperStyle: {} };
    case "wipeRadial":   return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge==="in" ? `circle(${(1-amount)*100}% at 50% 50%)` : `circle(${amount*100}% at 50% 50%)` }, wrapperStyle: {} };
    case "wipeClock":    return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge==="in" ? `circle(${(1-amount)*80}%)` : `circle(${amount*80}%)` }, wrapperStyle: {} };
    // wipeStar: rotating clipPath — rotation goes on wrapper (no physical video rotation)
    case "wipeStar":     return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge==="in" ? `circle(${(1-amount)*70}%)` : `circle(${amount*70}%)` }, wrapperStyle: { transform: `rotate(${amount*45}deg)`, transformOrigin: "center" } };
    case "wipeBlinds":   return { overlayStyle: { background: "repeating-linear-gradient(0deg,#000 0px,#000 4px,transparent 4px,transparent 20px)", opacity: amount * 0.9 }, videoStyle: { opacity: Math.max(0, 1 - amount) }, wrapperStyle: {} };
    case "wipeSplit":    return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge==="in" ? `inset(0 ${amount*50}%)` : `inset(0 ${(1-amount)*50}%)` }, wrapperStyle: {} };
    // ── Push / Slide (transform on wrapper so overflow:hidden clips the video) ───
    case "pushLeft":
    case "push":         return w(`translateX(${edge==="in" ? amount*100 : -amount*100}%)`);
    case "pushRight":    return w(`translateX(${edge==="in" ? -amount*100 : amount*100}%)`);
    case "pushUp":       return w(`translateY(${edge==="in" ? amount*100 : -amount*100}%)`);
    case "pushDown":     return w(`translateY(${edge==="in" ? -amount*100 : amount*100}%)`);
    case "slideLeft":    return wOpacity(`translateX(${edge==="in" ? amount*100 : -amount*100}%)`, Math.max(0, 1 - amount*0.4));
    case "slideRight":   return wOpacity(`translateX(${edge==="in" ? -amount*100 : amount*100}%)`, Math.max(0, 1 - amount*0.4));
    case "cover":        return w(`translateX(${edge==="in" ? `${(1-amount)*100}%` : "0"})`);
    case "uncover":      return w(`translateX(${edge==="out" ? `${amount*-100}%` : "0"})`);
    // ── Zoom (scale on wrapper — no DOM reflow, stays clipped) ──────────────
    case "zoomIn":
    case "zoom":         return { overlayStyle: { background: "#000", opacity: amount * 0.3 }, videoStyle: { opacity: Math.max(0, 1 - amount*0.6) }, wrapperStyle: { transform: `scale(${1 + amount*0.25})`, transformOrigin: "center" } };
    case "zoomOut":      return { overlayStyle: { background: "#000", opacity: amount * 0.3 }, videoStyle: { opacity: Math.max(0, 1 - amount*0.6) }, wrapperStyle: { transform: `scale(${Math.max(0.6, 1 - amount*0.25)})`, transformOrigin: "center" } };
    // ── Spin: full 360° rotation (amount=1 → fully rotated, amount=0 → normal) ───
    // For incoming (edge="in"): start at 180° (amount=1), end at 0° (amount=0) — video spins INTO place
    // For outgoing (edge="out"): start at 0° (amount=1 means transition just started), end at 180° — video spins OUT
    case "spinCW":  {
      const deg = edge==="in" ? amount*180 : (1-amount)*180;
      return { overlayStyle: { background: "#000", opacity: amount * 0.5 }, videoStyle: { opacity: Math.max(0, 1 - amount * 0.7) }, wrapperStyle: { transform: `rotate(${deg}deg) scale(${Math.max(0.3, 1 - amount*0.5)})`, transformOrigin: "center" } };
    }
    case "spinCCW": {
      const deg = edge==="in" ? -amount*180 : -(1-amount)*180;
      return { overlayStyle: { background: "#000", opacity: amount * 0.5 }, videoStyle: { opacity: Math.max(0, 1 - amount * 0.7) }, wrapperStyle: { transform: `rotate(${deg}deg) scale(${Math.max(0.3, 1 - amount*0.5)})`, transformOrigin: "center" } };
    }
    // ── Motion / Shake (small translations on wrapper, stays inside stage) ───
    case "shake":    return { overlayStyle: { opacity: 0 }, videoStyle: {}, wrapperStyle: { transform: `translate(${jx}px,${jy}px) rotate(${Math.sin(frame*0.8)*amount*1.8}deg)`, transformOrigin: "center" } };
    case "rumble":   return { overlayStyle: { background: "radial-gradient(circle,rgba(255,143,61,0.18),rgba(0,0,0,0.45))", opacity: amount*0.7 }, videoStyle: {}, wrapperStyle: { transform: `translate(${Math.sin(frame*0.42)*amount*32}px,${Math.cos(frame*0.57)*amount*18}px) scale(${1+amount*0.04})`, transformOrigin: "center" } };
    case "whipPan":  { const tx = edge==="in" ? `${(1-amount)*30}%` : `-${amount*30}%`; return { overlayStyle: { opacity: 0 }, videoStyle: { transitionFilter: `blur(${amount*20}px)`, opacity: Math.max(0, 1 - amount*0.4) } as CSSProperties & { transitionFilter?: string }, wrapperStyle: { transform: `translateX(${tx})` } }; }
    case "glitch":
    case "glitchRgb": return { overlayStyle: { background: "repeating-linear-gradient(180deg,rgba(95,196,255,0.22) 0px,rgba(95,196,255,0.22) 2px,transparent 2px,transparent 6px)", opacity: amount*0.9, mixBlendMode: "screen" }, videoStyle: {}, wrapperStyle: { transform: `translate(${Math.sin(frame*3.7)*amount*18}px,${Math.cos(frame*4.4)*amount*8}px) skew(${Math.sin(frame*2.6)*amount*2.5}deg)`, transformOrigin: "center" } };
    case "vhsRewind":return { overlayStyle: { background: "repeating-linear-gradient(0deg,rgba(0,0,0,0.15) 0px,rgba(0,0,0,0.15) 1px,transparent 1px,transparent 4px)", opacity: amount*0.8 }, videoStyle: {}, wrapperStyle: { transform: `translateY(${Math.sin(frame*5)*amount*6}px)` } };
    // ── Filter-based (no transform) ──────────────────────────────────────
    case "blur":
    case "blurDissolve":  return { overlayStyle: { background: "#000", opacity: amount * 0.2 }, videoStyle: { transitionFilter: `blur(${amount*8}px)`, opacity: Math.max(0.1, 1 - amount*0.5) } as CSSProperties & { transitionFilter?: string }, wrapperStyle: {} };
    case "filmBurn":
    case "lightLeak":     return { overlayStyle: { background: `radial-gradient(circle at ${50+Math.sin(frame)*30}% ${50+Math.cos(frame)*20}%, rgba(255,160,30,0.7) 0%,rgba(0,0,0,0.95) 70%)`, opacity: amount*0.85 }, videoStyle: {}, wrapperStyle: {} };
    case "lensFlare":     return { overlayStyle: { background: `radial-gradient(circle at 80% 20%,rgba(255,255,255,0.9) 0%,rgba(100,150,255,0.4) 20%,transparent 50%)`, opacity: amount*0.7, mixBlendMode: "screen" }, videoStyle: {}, wrapperStyle: {} };
    case "staticNoise":   return { overlayStyle: { background: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`, opacity: amount*0.7 }, videoStyle: {}, wrapperStyle: {} };
    case "oldFilm":       return { overlayStyle: { background: `radial-gradient(ellipse,transparent 70%,rgba(0,0,0,0.7) 100%)`, opacity: amount * 0.6, mixBlendMode: "multiply" as CSSProperties["mixBlendMode"] }, videoStyle: { transitionFilter: `sepia(${amount*0.5}) contrast(${1+amount*0.1})` } as CSSProperties & { transitionFilter?: string }, wrapperStyle: {} };
    case "prism":         return { overlayStyle: { background: "linear-gradient(135deg,rgba(255,0,0,0.25),rgba(0,255,0,0.25),rgba(0,0,255,0.25))", opacity: amount * 0.8, mixBlendMode: "screen" as CSSProperties["mixBlendMode"] }, videoStyle: { transitionFilter: `hue-rotate(${amount*180}deg)`, opacity: Math.max(0.1, 1 - amount*0.6) } as CSSProperties & { transitionFilter?: string }, wrapperStyle: {} };
    case "vhsStatic":     return { overlayStyle: { background: "repeating-linear-gradient(0deg,rgba(0,0,0,0.25) 0px,rgba(0,0,0,0.25) 2px,transparent 2px,transparent 5px)", opacity: amount*0.9, mixBlendMode: "multiply" as CSSProperties["mixBlendMode"] }, videoStyle: { transitionFilter: `saturate(${1-amount*0.8}) contrast(${1+amount*0.3})`, opacity: Math.max(0.1, 1 - amount*0.4) } as CSSProperties & { transitionFilter?: string }, wrapperStyle: {} };
    case "chromaShift":   return { overlayStyle: { background: "transparent", opacity: 0 }, videoStyle: { transitionFilter: `hue-rotate(${Math.sin(frame*0.5)*amount*120}deg) saturate(${1+amount*1.5})`, opacity: Math.max(0.2, 1 - amount*0.5) } as CSSProperties & { transitionFilter?: string }, wrapperStyle: {} };
    case "exposure":      return { overlayStyle: { background: "#fff", opacity: Math.pow(amount, 2) * 0.95 }, videoStyle: { transitionFilter: `brightness(${1 + amount * 3})` } as CSSProperties & { transitionFilter?: string }, wrapperStyle: {} };
    // ── Shape reveals (clipPath) ─────────────────────────────────────
    case "irisCircle":    return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge==="in" ? `circle(${(1-amount)*70}%)` : `circle(${amount*70}%)` }, wrapperStyle: {} };
    case "irisStar":      return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge==="in" ? `circle(${(1-amount)*70}%)` : `circle(${amount*70}%)`, transitionFilter: "drop-shadow(0 0 2px #fff)" } as CSSProperties & { transitionFilter?: string }, wrapperStyle: {} };
    case "irisHeart":     return { overlayStyle: { background: "#000", opacity: amount * 0.9 }, videoStyle: {}, wrapperStyle: {} };
    case "diamond":       return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge==="in" ? `polygon(50% ${amount*100}%,${100-amount*100}% 50%,50% ${100-amount*100}%,${amount*100}% 50%)` : `polygon(50% 0%,100% 50%,50% 100%,0% 50%)`, opacity: Math.max(0, 1 - amount*0.3) }, wrapperStyle: {} };
    case "revealSplitH":  return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge==="in" ? `inset(${amount*50}% 0)` : `inset(0 0 ${amount*50}% 0)` }, wrapperStyle: {} };
    case "revealSplitV":  return { overlayStyle: { opacity: 0 }, videoStyle: { clipPath: edge==="in" ? `inset(0 ${amount*50}%)` : `inset(0 ${(1-amount)*50}%)` }, wrapperStyle: {} };
    // ── Flash / cinematic ─────────────────────────────────────────
    case "whiteFlash":    return { overlayStyle: { background: "#fff", opacity: Math.sin(amount * Math.PI) * 0.95 }, videoStyle: {}, wrapperStyle: {} };
    case "blackFlash":    return { overlayStyle: { background: "#000", opacity: Math.sin(amount * Math.PI) * 0.95 }, videoStyle: {}, wrapperStyle: {} };
    case "filmFlash":     return { overlayStyle: { background: "#fff", opacity: Math.sin(amount * Math.PI) * 0.95 }, videoStyle: {}, wrapperStyle: {} };
    // ── WebGL — canvas handles rendering; CSS provides a subtle fallback ────
    case "pixelate":      return { overlayStyle: { opacity: 0 }, videoStyle: { opacity: Math.max(0.1, 1 - amount * 0.15) }, wrapperStyle: {} };
    case "ripple":        return { overlayStyle: { opacity: 0 }, videoStyle: { opacity: Math.max(0.1, 1 - amount * 0.15) }, wrapperStyle: {} };
    case "zoomCross":     return { overlayStyle: { background: "#000", opacity: amount * 0.15 }, videoStyle: { opacity: Math.max(0.1, 1 - amount * 0.15) }, wrapperStyle: {} };
    case "cut":           return NO_TRANSITION;
    default:              return NO_TRANSITION;
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
    onAudioEngineRef,
    subtitleCues,
    onInsertAtPlayhead,
    onOverwriteAtPlayhead,
  }, ref) {

    const panelRef       = useRef<HTMLElement | null>(null);
    const videoRef       = useRef<HTMLVideoElement | null>(null);
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
    const patchedActiveSegment = useMemo(() => {
      if (!activeSegment) return null;
      if (proxyMode) return activeSegment;
      const originalUrl = `media://asset?path=${encodeURIComponent(activeSegment.asset.sourcePath)}`;
      return {
        ...activeSegment,
        asset: { ...activeSegment.asset, previewUrl: originalUrl },
      };
    }, [activeSegment, proxyMode]);

    const patchedSelectedAsset = useMemo(() => {
      if (!selectedAsset) return null;
      if (proxyMode) return selectedAsset;
      const originalUrl = `media://asset?path=${encodeURIComponent(selectedAsset.sourcePath)}`;
      return { ...selectedAsset, previewUrl: originalUrl };
    }, [selectedAsset, proxyMode]);

    // ── Playback controller ───────────────────────────────────────────────────
    // activeAudioSegment is kept in props for API compat but audio is now
    // managed by useMultiTrackAudio inside usePlaybackController.
    const { togglePlayback, pausePlayback, stopPlayback, audioEngineRef } = usePlaybackController({
      videoRef,
      audioRef,
      activeSegment: patchedActiveSegment,
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
    useEffect(() => {
      const video = videoRef.current;
      if (!video || patchedActiveSegment) return;
      if (!patchedSelectedAsset) { video.removeAttribute("src"); video.load(); return; }
      if (video.currentSrc !== patchedSelectedAsset.previewUrl) {
        video.src = patchedSelectedAsset.previewUrl;
        video.load();
      }
    }, [patchedActiveSegment, patchedSelectedAsset?.id, patchedSelectedAsset?.previewUrl]);

    // ── Derived display state ─────────────────────────────────────────────────
    // IMPORTANT: These must be computed BEFORE any useEffect that references them
    // to avoid the "Cannot access before initialization" TDZ error.
    const previewAsset    = patchedActiveSegment?.asset ?? patchedSelectedAsset ?? null;
    const timelineReady   = totalFrames > 0;
    const previewOpacity  = getPreviewOpacity(activeSegment, playheadFrame);
    const transitionState = getActiveTransitionState(activeSegment, playheadFrame);
    const { overlayStyle, videoStyle: rawVideoStyle, wrapperStyle: transWrapperStyle } = getTransitionPreviewStyles(transitionState, playheadFrame);
    // Extract transitionFilter (blur/sepia from blur & oldFilm transitions) before spreading videoStyle onto <video>
    const { transitionFilter, ...videoStyle } = rawVideoStyle as CSSProperties & { transitionFilter?: string };
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

    // Merge clip transform into wrapperStyle (clip transform applied first, then transition transform on top)
    const wrapperStyle: CSSProperties = { ...clipTransformStyle, ...transWrapperStyle };

    // ── WebGL transition rendering via RAF loop ───────────────────────────────
    // IMPORTANT: Never call renderTransitionFrame inside JSX render.
    // Use a useEffect + RAF loop keyed on the active transition type.
    // transitionState must be declared above this block (done above).
    useEffect(() => {
      const canvas = webglCanvasRef.current;
      const video  = videoRef.current;
      if (!canvas || !video) return;
      if (!transitionState || !isWebGLTransition(transitionState.type)) {
        if (webglRafRef.current) {
          cancelAnimationFrame(webglRafRef.current);
          webglRafRef.current = 0;
        }
        return;
      }

      let alive = true;
      const tick = () => {
        if (!alive) return;
        const ts = transitionState; // capture for closure
        if (ts && isWebGLTransition(ts.type) && canvas && video) {
          renderTransitionFrame(canvas, ts.type, video, video, ts.progress, performance.now() / 1000);
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
    }, [transitionState?.type, transitionState?.progress]);

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

    // ── Effects CSS filter (blur, sharpen, brightness, etc.) ─────────────────
    // FIX 7: compute filter from active effects and merge with grade filter
    const effectsFilter = useMemo(() => {
      if (!clipEffects || clipEffects.length === 0) return "";
      const f = computeCssFilterFromEffects(clipEffects);
      return f === "none" ? "" : f;
    }, [clipEffects]);

    // ── Vignette overlay (cannot be done via CSS filter) ─────────────────────
    const vignetteEffect = useMemo(() => {
      if (!clipEffects) return null;
      return clipEffects.find((e) => e.enabled && e.type === "vignette") ?? null;
    }, [clipEffects]);

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
                * The video is wrapped in a clipping container so that transitions
                * using transform (push, slide, spin, shake, etc.) don't visually
                * bleed outside the stage boundary.  All transform-based styles are
                * applied to the wrapper; filter + opacity + clipPath stay on the
                * <video> element itself.
                *
                * overflow:hidden on the wrapper clips translateX/Y translations.
                * transform-origin:center ensures spin/zoom pivot around the centre.
                */}
              <div
                className="viewer-video-wrapper"
                style={{
                  position: "absolute",
                  inset: 0,
                  overflow: "hidden",
                  transformOrigin: "center",
                  ...wrapperStyle,
                }}
              >
                <video
                  ref={videoRef}
                  className="viewer-video"
                  controls={false}
                  style={{
                    opacity: previewOpacity,
                    // merge grade filter + effects filter + transition filter into single CSS filter string
                    // (transitionFilter is extracted separately and NOT spread via videoStyle to avoid overwrites)
                    filter: [
                      gradeStyle.cssFilter !== "none" ? gradeStyle.cssFilter : "",
                      effectsFilter,
                      transitionFilter ?? "",
                    ].filter(Boolean).join(" ") || undefined,
                    ...videoStyle,
                  }}
                  muted={true}
                  playsInline
                  preload="auto"
                />
              </div>
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
          {previewAsset && transitionState && !isWebGLTransition(transitionState.type) && (
            <div
              className={`viewer-transition-overlay ${transitionState.type}`}
              style={overlayStyle}
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
              pointerEvents: "none", zIndex: 10,
              // Only show when a WebGL transition is actually active
              display: (previewAsset && transitionState && isWebGLTransition(transitionState.type)) ? "block" : "none",
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
              WebkitTextStroke: `${cue.style.outlineWidth}px ${cue.style.outlineColor}`,
              textShadow: `${cue.style.shadowOffset}px ${cue.style.shadowOffset}px 4px rgba(0,0,0,0.8)`,
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
