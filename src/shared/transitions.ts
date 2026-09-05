/**
 * Transition junction model
 * ─────────────────────────────────────────────────────────────────────────────
 * A transition conceptually lives on the CUT between two adjacent clips
 * (A → B) on the same video track.  The data model stores it per clip edge
 * (`transitionOut` on A / `transitionIn` on B), which historically allowed
 * both edges to carry a transition for the same cut so the viewer and
 * exporter double-applied it (A faded to black, then B faded in from black).
 *
 * This module is the single source of truth for how those edge fields are
 * interpreted:
 *
 *   • For a cut A|B, the OUTGOING clip's `transitionOut` is authoritative.
 *     If A has no `transitionOut`, B's `transitionIn` is used.  Only one is
 *     ever active per cut.
 *   • A clip with no neighbour on that side (start / end of a track, or a
 *     gap) has an "edge" transition: it fades from / to transparent (black
 *     stage).  This is the only case a one-sided fade is correct.
 *   • The duration is clamped so it never exceeds either clip (minus one
 *     frame so both clips keep at least one un-blended frame).
 *
 * Everything here is pure and shared by the renderer, the store and the
 * FFmpeg exporter so preview and export agree frame-for-frame.
 */

import type { ClipTransition, ClipTransitionType, TimelineClip } from "./models.js";
import { getClipTransitionDurationFrames, MIN_CLIP_DURATION_FRAMES, type TimelineSegment } from "./timeline.js";

/** Frames on either side of a cut that still count as "adjacent" (rounding slack). */
export const JUNCTION_TOLERANCE_FRAMES = 1;

export interface TransitionJunction {
  /** Outgoing clip (ends at the cut). null when the transition is a track-edge fade-in. */
  from: TimelineSegment | null;
  /** Incoming clip (starts at the cut). null when the transition is a track-edge fade-out. */
  to: TimelineSegment | null;
  type: ClipTransitionType;
  durationFrames: number;
  /** Timeline frame where the transition starts (inclusive). */
  startFrame: number;
  /** Timeline frame where the transition ends (exclusive). */
  endFrame: number;
  /** The cut point (= to.startFrame = from.endFrame when both exist). */
  cutFrame: number;
}

export interface ActiveTransition extends TransitionJunction {
  /** 0 = 100% `from`, 1 = 100% `to`. Linear in frames. */
  progress: number;
}

function sameTrack(a: TimelineSegment, b: TimelineSegment): boolean {
  return a.track.id === b.track.id;
}

/** Next segment on the same track that begins where `segment` ends. */
export function findNextAdjacentSegment(
  segments: TimelineSegment[],
  segment: TimelineSegment
): TimelineSegment | null {
  let best: TimelineSegment | null = null;
  for (const s of segments) {
    if (s === segment || s.clip.id === segment.clip.id) continue;
    if (!sameTrack(s, segment)) continue;
    if (!s.clip.isEnabled) continue;
    if (Math.abs(s.startFrame - segment.endFrame) <= JUNCTION_TOLERANCE_FRAMES) {
      if (!best || s.startFrame < best.startFrame) best = s;
    }
  }
  return best;
}

/** Previous segment on the same track that ends where `segment` begins. */
export function findPrevAdjacentSegment(
  segments: TimelineSegment[],
  segment: TimelineSegment
): TimelineSegment | null {
  let best: TimelineSegment | null = null;
  for (const s of segments) {
    if (s === segment || s.clip.id === segment.clip.id) continue;
    if (!sameTrack(s, segment)) continue;
    if (!s.clip.isEnabled) continue;
    if (Math.abs(s.endFrame - segment.startFrame) <= JUNCTION_TOLERANCE_FRAMES) {
      if (!best || s.endFrame > best.endFrame) best = s;
    }
  }
  return best;
}

/**
 * Longest transition allowed at a cut: both clips must keep at least one
 * frame that is not part of the transition.
 */
export function getMaxJunctionDurationFrames(
  fromDurationFrames: number | null,
  toDurationFrames: number | null
): number {
  const limits: number[] = [];
  if (fromDurationFrames !== null) limits.push(Math.max(0, fromDurationFrames - MIN_CLIP_DURATION_FRAMES));
  if (toDurationFrames !== null) limits.push(Math.max(0, toDurationFrames - MIN_CLIP_DURATION_FRAMES));
  if (!limits.length) return 0;
  return Math.min(...limits);
}

/**
 * Resolve the transition that plays at the END of `segment` (i.e. on the cut
 * between `segment` and the clip that follows it, or a fade-out to black when
 * nothing follows).  Returns null when there is no transition at that cut.
 */
export function resolveOutgoingJunction(
  segments: TimelineSegment[],
  segment: TimelineSegment
): TransitionJunction | null {
  const next = findNextAdjacentSegment(segments, segment);
  // The outgoing clip owns the cut; fall back to the incoming clip's "in".
  const owner: ClipTransition | null =
    segment.clip.transitionOut ?? next?.clip.transitionIn ?? null;
  if (!owner || owner.type === "cut") return null;

  const maxDur = getMaxJunctionDurationFrames(segment.durationFrames, next ? next.durationFrames : null);
  const durationFrames = Math.min(
    getClipTransitionDurationFrames(owner, segment.durationFrames),
    maxDur
  );
  if (durationFrames <= 0) return null;

  const cutFrame = segment.endFrame;
  if (next) {
    // Centred on the cut: half the frames come from A's tail, half from B's head.
    // (Both clips keep their full content; the overlap is a visual blend.)
    const before = Math.ceil(durationFrames / 2);
    const after = durationFrames - before;
    return {
      from: segment,
      to: next,
      type: owner.type,
      durationFrames,
      startFrame: cutFrame - before,
      endFrame: cutFrame + after,
      cutFrame
    };
  }
  // Track-edge fade out: entirely inside A's tail.
  return {
    from: segment,
    to: null,
    type: owner.type,
    durationFrames,
    startFrame: cutFrame - durationFrames,
    endFrame: cutFrame,
    cutFrame
  };
}

/**
 * Resolve a transition that plays at the START of `segment` when it has no
 * predecessor (fade in from black).  When a predecessor exists the cut is
 * owned by `resolveOutgoingJunction(prev)`, so this returns null to avoid
 * double application.
 */
export function resolveIncomingEdgeFade(
  segments: TimelineSegment[],
  segment: TimelineSegment
): TransitionJunction | null {
  const prev = findPrevAdjacentSegment(segments, segment);
  if (prev) return null;
  const t = segment.clip.transitionIn;
  if (!t || t.type === "cut") return null;
  const durationFrames = getClipTransitionDurationFrames(t, segment.durationFrames);
  if (durationFrames <= 0) return null;
  return {
    from: null,
    to: segment,
    type: t.type,
    durationFrames,
    startFrame: segment.startFrame,
    endFrame: segment.startFrame + durationFrames,
    cutFrame: segment.startFrame
  };
}

/** All junctions/edge-fades on the given (video) segments, ordered by start. */
export function collectJunctions(segments: TimelineSegment[]): TransitionJunction[] {
  const out: TransitionJunction[] = [];
  for (const s of segments) {
    if (!s.clip.isEnabled) continue;
    const j = resolveOutgoingJunction(segments, s);
    if (j) out.push(j);
    const f = resolveIncomingEdgeFade(segments, s);
    if (f) out.push(f);
  }
  return out.sort((a, b) => a.startFrame - b.startFrame);
}

/**
 * The transition active at `frame` for the clip currently shown (`active`).
 * Looks at both the cut ahead of and behind the active clip so the incoming
 * half of a centred junction is found while B is already the active clip.
 */
export function getActiveTransitionAtFrame(
  segments: TimelineSegment[],
  active: TimelineSegment | null,
  frame: number
): ActiveTransition | null {
  if (!active) return null;
  const candidates: (TransitionJunction | null)[] = [
    resolveOutgoingJunction(segments, active),
    resolveIncomingEdgeFade(segments, active)
  ];
  const prev = findPrevAdjacentSegment(segments, active);
  if (prev) candidates.push(resolveOutgoingJunction(segments, prev));

  for (const j of candidates) {
    if (!j) continue;
    if (frame >= j.startFrame && frame < j.endFrame) {
      const progress = j.durationFrames > 0 ? (frame - j.startFrame + 1) / (j.durationFrames + 1) : 1;
      return { ...j, progress: Math.max(0, Math.min(1, progress)) };
    }
  }
  return null;
}

/**
 * The junction (if any) that `frame` falls inside, scanning every enabled
 * segment.  Unlike getActiveTransitionAtFrame this does not need to know
 * which clip is "active" — useful for audio, where several clips can be live.
 */
export function findJunctionAtFrame(
  segments: TimelineSegment[],
  frame: number
): ActiveTransition | null {
  for (const s of segments) {
    if (!s.clip.isEnabled) continue;
    for (const j of [resolveOutgoingJunction(segments, s), resolveIncomingEdgeFade(segments, s)]) {
      if (!j) continue;
      if (frame >= j.startFrame && frame < j.endFrame) {
        const progress = j.durationFrames > 0 ? (frame - j.startFrame + 1) / (j.durationFrames + 1) : 1;
        return { ...j, progress: Math.max(0, Math.min(1, progress)) };
      }
    }
  }
  return null;
}

/**
 * The clip that should be pre-rolled / kept live alongside `active` at
 * `frame` because a two-clip transition is in progress (or about to start
 * within `lookaheadFrames`).  Returns null when a single clip suffices.
 */
export function getTransitionPartnerSegment(
  segments: TimelineSegment[],
  active: TimelineSegment | null,
  frame: number,
  lookaheadFrames = 0
): TimelineSegment | null {
  if (!active) return null;
  const current = getActiveTransitionAtFrame(segments, active, frame);
  if (current && current.from && current.to) {
    return current.from.clip.id === active.clip.id ? current.to : current.from;
  }
  if (lookaheadFrames > 0) {
    const upcoming = resolveOutgoingJunction(segments, active);
    if (upcoming && upcoming.to && frame >= upcoming.startFrame - lookaheadFrames && frame < upcoming.endFrame) {
      return upcoming.to;
    }
  }
  return null;
}

/**
 * Audio/visual level (0..1) of `segment` at `frame` implied by the junction
 * model: 1 inside the clip body, ramping down across an outgoing junction and
 * up across an incoming one.  Frames that lie outside the clip's own range but
 * inside a centred junction are included (the clip is "extended" across the
 * cut for the overlap), which is what an equal-power crossfade needs.
 * Returns null when `frame` is neither inside the clip nor in one of its
 * junction windows.
 */
export function getJunctionLevelAtFrame(
  segments: TimelineSegment[],
  segment: TimelineSegment,
  frame: number
): number | null {
  const out = resolveOutgoingJunction(segments, segment);
  const prev = findPrevAdjacentSegment(segments, segment);
  const inJ = prev ? resolveOutgoingJunction(segments, prev) : resolveIncomingEdgeFade(segments, segment);

  const inside = frame >= segment.startFrame && frame < segment.endFrame;
  let level: number | null = inside ? 1 : null;

  if (out && frame >= out.startFrame && frame < out.endFrame) {
    const p = (frame - out.startFrame + 1) / (out.durationFrames + 1);
    level = Math.min(level ?? 1, Math.max(0, 1 - p));
  }
  if (inJ && frame >= inJ.startFrame && frame < inJ.endFrame) {
    const p = (frame - inJ.startFrame + 1) / (inJ.durationFrames + 1);
    level = Math.min(level ?? 1, Math.max(0, p));
  }
  return level;
}

/**
 * Timeline range over which `segment` must actually produce media, including
 * the half-junction spill on either side of its cuts.  Used by the audio
 * scheduler (so B's audio starts before the cut) and by the exporter.
 */
export function getSegmentExtentsWithJunctions(
  segments: TimelineSegment[],
  segment: TimelineSegment
): { startFrame: number; endFrame: number; leadFrames: number; tailFrames: number } {
  const out = resolveOutgoingJunction(segments, segment);
  const prev = findPrevAdjacentSegment(segments, segment);
  const inJ = prev ? resolveOutgoingJunction(segments, prev) : null;
  const leadFrames = inJ && inJ.to?.clip.id === segment.clip.id ? Math.max(0, segment.startFrame - inJ.startFrame) : 0;
  const tailFrames = out && out.to ? Math.max(0, out.endFrame - segment.endFrame) : 0;
  return {
    startFrame: segment.startFrame - leadFrames,
    endFrame: segment.endFrame + tailFrames,
    leadFrames,
    tailFrames
  };
}

/**
 * Apply a transition at the cut between `clip` and its neighbour on `edge`.
 * Returns the updated clip list.  The outgoing clip's `transitionOut` is set
 * and the incoming clip's `transitionIn` is CLEARED so exactly one record
 * describes the cut.  For a clip with no neighbour on that side, the edge
 * field is set directly (fade from/to black).
 */
export function applyJunctionTransition(
  clips: TimelineClip[],
  segments: TimelineSegment[],
  clipId: string,
  edge: "in" | "out",
  transition: ClipTransition | null
): TimelineClip[] {
  const seg = segments.find((s) => s.clip.id === clipId);
  if (!seg) return clips;

  let fromId: string | null;
  let toId: string | null;
  let fromDur: number | null;
  let toDur: number | null;

  if (edge === "out") {
    const next = findNextAdjacentSegment(segments, seg);
    fromId = seg.clip.id; toId = next?.clip.id ?? null;
    fromDur = seg.durationFrames; toDur = next?.durationFrames ?? null;
  } else {
    const prev = findPrevAdjacentSegment(segments, seg);
    fromId = prev?.clip.id ?? null; toId = seg.clip.id;
    fromDur = prev?.durationFrames ?? null; toDur = seg.durationFrames;
  }

  let record: ClipTransition | null = null;
  if (transition && transition.type !== "cut") {
    const maxDur = getMaxJunctionDurationFrames(fromDur, toDur);
    const dur = Math.min(Math.max(1, Math.round(transition.durationFrames)), maxDur);
    record = dur > 0 ? { ...transition, durationFrames: dur } : null;
  }

  return clips.map((c) => {
    if (fromId && c.id === fromId) {
      // Outgoing owner.  When there is no outgoing clip (edge fade-in) fromId is null.
      return { ...c, transitionOut: record };
    }
    if (toId && c.id === toId) {
      // If a real cut exists the incoming side never carries its own record.
      // With no outgoing clip, the incoming edge holds the fade-in itself.
      return { ...c, transitionIn: fromId ? null : record };
    }
    return c;
  });
}

/** Read the effective transition for a clip edge (what the UI should display). */
export function getEffectiveEdgeTransition(
  segments: TimelineSegment[],
  clipId: string,
  edge: "in" | "out"
): ClipTransition | null {
  const seg = segments.find((s) => s.clip.id === clipId);
  if (!seg) return null;
  if (edge === "out") {
    const j = resolveOutgoingJunction(segments, seg);
    return j ? { type: j.type, durationFrames: j.durationFrames } : null;
  }
  const prev = findPrevAdjacentSegment(segments, seg);
  const j = prev ? resolveOutgoingJunction(segments, prev) : resolveIncomingEdgeFade(segments, seg);
  return j ? { type: j.type, durationFrames: j.durationFrames } : null;
}

// ─── Extents (handles) ────────────────────────────────────────────────────────

/**
 * How far a segment must keep playing beyond its own bounds so that it can be
 * blended with its neighbour during a centred junction, plus the length of
 * the fade envelope at each end.  All values in timeline frames.
 *
 *   visibleStart = startFrame - preRollFrames   (B is shown before the cut)
 *   visibleEnd   = endFrame   + postRollFrames  (A is shown after the cut)
 *
 * Source media beyond the clip's in/out points ("handles") is used for the
 * pre/post-roll.  When the source has no handle the last/first frame is held
 * (see `getHandleTargetTime`).
 */
export interface SegmentExtents {
  preRollFrames: number;
  postRollFrames: number;
  /** Frames over which the segment fades IN (starting at visibleStart). 0 = none. */
  fadeInFrames: number;
  /** Frames over which the segment fades OUT (ending at visibleEnd). 0 = none. */
  fadeOutFrames: number;
  visibleStart: number;
  visibleEnd: number;
  /** Junction at the head of the segment (if any). */
  headJunction: TransitionJunction | null;
  /** Junction at the tail of the segment (if any). */
  tailJunction: TransitionJunction | null;
}

export function getSegmentExtents(
  segments: TimelineSegment[],
  segment: TimelineSegment
): SegmentExtents {
  const tail = resolveOutgoingJunction(segments, segment);
  const prev = findPrevAdjacentSegment(segments, segment);
  const head = prev ? resolveOutgoingJunction(segments, prev) : resolveIncomingEdgeFade(segments, segment);

  const postRollFrames = tail && tail.to ? Math.max(0, tail.endFrame - segment.endFrame) : 0;
  const preRollFrames = head && head.from ? Math.max(0, segment.startFrame - head.startFrame) : 0;

  return {
    preRollFrames,
    postRollFrames,
    fadeInFrames: head ? head.durationFrames : 0,
    fadeOutFrames: tail ? tail.durationFrames : 0,
    visibleStart: segment.startFrame - preRollFrames,
    visibleEnd: segment.endFrame + postRollFrames,
    headJunction: head,
    tailJunction: tail
  };
}

/**
 * Linear gain envelope (0..1) for a segment at `frame`, honouring the junction
 * fades at both ends.  Used by the audio engine so A/B cross-fade with equal
 * power-ish linear ramps centred on the cut, exactly matching the picture.
 */
export function getSegmentGainAtFrame(extents: SegmentExtents, frame: number): number {
  const { visibleStart, visibleEnd, fadeInFrames, fadeOutFrames } = extents;
  if (frame < visibleStart || frame >= visibleEnd) return 0;
  let g = 1;
  if (fadeInFrames > 0) {
    const t = (frame - visibleStart + 1) / (fadeInFrames + 1);
    if (t < 1) g = Math.min(g, Math.max(0, t));
  }
  if (fadeOutFrames > 0) {
    const t = (visibleEnd - frame) / (fadeOutFrames + 1);
    if (t < 1) g = Math.min(g, Math.max(0, t));
  }
  return g;
}

/**
 * Source time (seconds) a segment should show at `frame`, allowing the
 * position to run into the source handles outside [sourceIn, sourceOut).
 * Clamped to the physical media so a missing handle holds the first/last frame
 * (Premiere-style "insufficient media" behaviour) instead of erroring.
 */
export function getHandleTargetTime(
  segment: TimelineSegment,
  frame: number,
  fps: number
): number {
  if (!fps || fps <= 0) return segment.sourceInSeconds;
  const speed = Math.max(0.25, Math.min(4, segment.clip.speed ?? 1));
  const offsetSeconds = ((frame - segment.startFrame) / fps) * speed;
  const raw = segment.sourceInSeconds + offsetSeconds;
  // Physical media bounds.  Prefer the asset duration; fall back to the clip's
  // own out-point when the asset has no duration (render-cache / unknown).
  const mediaEnd = segment.asset.durationSeconds > 0
    ? segment.asset.durationSeconds
    : segment.sourceOutSeconds;
  const maxTime = Math.max(0, mediaEnd - 1 / fps);
  return Math.max(0, Math.min(raw, maxTime));
}

/**
 * Source time at which a segment must stop producing frames: its own out
 * point plus any outgoing-transition tail that spills past the cut.
 */
export function getPlayableOutTime(
  segments: TimelineSegment[],
  segment: TimelineSegment,
  fps: number
): number {
  const ext = getSegmentExtents(segments, segment);
  if (ext.postRollFrames <= 0) return segment.sourceOutSeconds;
  return Math.max(segment.sourceOutSeconds, getHandleTargetTime(segment, ext.visibleEnd, fps));
}

// ─── Viewer partner selection ─────────────────────────────────────────────────

export type PartnerRole = "incoming" | "outgoing" | "lookahead";

export interface PartnerSelection {
  segment: TimelineSegment;
  /** Junction this partner belongs to (null for a plain lookahead preload). */
  junction: TransitionJunction | null;
  role: PartnerRole;
}

function isVisibleVideoSegment(s: TimelineSegment): boolean {
  return s.track.kind === "video" && s.clip.isEnabled && !s.track.muted;
}

/**
 * Decide which clip the viewer's second video slot should hold right now:
 *   1. the other half of a junction that is active or starts within
 *      `prepFrames` (so it is loaded and seeked before the blend begins);
 *   2. otherwise the clip that becomes active when `active` ends, if that is
 *      within `lookaheadFrames`, so a plain cut can swap slots with no reload.
 */
export function selectPartnerSegment(
  segments: TimelineSegment[],
  active: TimelineSegment | null,
  frame: number,
  prepFrames: number,
  lookaheadFrames: number
): PartnerSelection | null {
  if (!active) return null;

  const tail = resolveOutgoingJunction(segments, active);
  if (tail && tail.to && frame >= tail.startFrame - prepFrames && frame < tail.endFrame) {
    return { segment: tail.to, junction: tail, role: "incoming" };
  }
  const prev = findPrevAdjacentSegment(segments, active);
  const head = prev ? resolveOutgoingJunction(segments, prev) : null;
  if (head && head.from && frame >= head.startFrame && frame < head.endFrame) {
    return { segment: head.from, junction: head, role: "outgoing" };
  }

  // Plain lookahead: whichever visible video segment starts at (or right after)
  // the active clip's end, on any track, preferring the topmost (lowest index).
  if (active.endFrame - frame <= lookaheadFrames) {
    let best: TimelineSegment | null = null;
    for (const s of segments) {
      if (s.clip.id === active.clip.id || !isVisibleVideoSegment(s)) continue;
      if (s.startFrame < active.endFrame - JUNCTION_TOLERANCE_FRAMES) continue;
      if (s.startFrame > frame + lookaheadFrames) continue;
      if (!best || s.startFrame < best.startFrame ||
          (s.startFrame === best.startFrame && s.trackIndex < best.trackIndex)) {
        best = s;
      }
    }
    if (best) return { segment: best, junction: null, role: "lookahead" };
  }
  return null;
}

// ─── FFmpeg xfade mapping ─────────────────────────────────────────────────────

/**
 * Map an editor transition type to an FFmpeg `xfade` transition name so the
 * export blends A and B the same way the viewer does.  Unknown / purely
 * stylised types fall back to a dissolve, which is what the CSS fallback shows.
 */
export function getXfadeTransitionName(type: ClipTransitionType): string {
  switch (type) {
    case "fade":
    case "crossDissolve":
    case "filmDissolve":
    case "luminanceDissolve":
    case "blur":
    case "blurDissolve":
    case "pixelate":
    case "ripple":
    case "chromaShift":
    case "prism":
    case "oldFilm":
    case "staticNoise":
    case "vhsStatic":
    case "vhsRewind":
    case "glitch":
    case "glitchRgb":
    case "shake":
    case "rumble":
      return "fade";
    case "additiveDissolve":
    case "exposure":
    case "lensFlare":
    case "filmBurn":
    case "lightLeak":
      return "fadewhite";
    case "dipBlack":
    case "dipColor":
    case "blackFlash":
      return "fadeblack";
    case "dipWhite":
    case "whiteFlash":
    case "filmFlash":
      return "fadewhite";
    case "wipe":
    case "wipeLeft":
      return "wipeleft";
    case "wipeRight":
      return "wiperight";
    case "wipeUp":
      return "wipeup";
    case "wipeDown":
      return "wipedown";
    case "wipeDiagTL":
      return "wipetl";
    case "wipeDiagTR":
      return "wipetr";
    case "wipeRadial":
    case "wipeClock":
    case "irisCircle":
    case "irisHeart":
      return "circleopen";
    case "wipeStar":
    case "irisStar":
    case "diamond":
      return "diagtl";
    case "wipeBlinds":
      return "hlslice";
    case "wipeSplit":
    case "revealSplitV":
      return "vertopen";
    case "revealSplitH":
      return "horzopen";
    case "push":
    case "pushLeft":
      return "slideleft";
    case "pushRight":
      return "slideright";
    case "pushUp":
      return "slideup";
    case "pushDown":
      return "slidedown";
    case "slideLeft":
    case "uncover":
      return "revealleft";
    case "slideRight":
      return "revealright";
    case "cover":
      return "coverleft";
    case "whipPan":
      return "hlwind";
    case "zoom":
    case "zoomIn":
    case "zoomCross":
      return "zoomin";
    case "zoomOut":
      return "fadefast";
    case "spinCW":
    case "spinCCW":
      return "circlecrop";
    case "cut":
    default:
      return "fade";
  }
}
