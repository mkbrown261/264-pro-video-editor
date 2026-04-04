/**
 * useMultiTrackAudio
 * ─────────────────────────────────────────────────────────────────────────────
 * True multi-track audio mixing engine using the Web Audio API.
 *
 * Architecture
 * ────────────
 *   For every UNIQUE source URL that is active at the current playhead we
 *   keep one <audio> element (from a pool) that is routed through its own
 *   GainNode into a single shared AudioContext destination.
 *
 *   This means Clip A (1 min) and Clip B (10 s) that overlap on different
 *   tracks BOTH play simultaneously — their output is summed by the Web
 *   Audio graph, exactly like a hardware mixer.
 *
 * Seam Design (why there was a pause between clips)
 * ─────────────────────────────────────────────────
 *   The root cause of the seam pause was a cascade of async waits that all
 *   had to complete before element.play() could fire on the incoming clip:
 *
 *   1. React render cycle latency — audioSegKey useEffect fires AFTER the
 *      frame that crosses the seam boundary (1-2 render ticks = 8-33 ms).
 *
 *   2. seekTo() await — even with a prefetched element, the element's
 *      currentTime is parked at sourceInSeconds.  At the seam the target
 *      time is sourceInSeconds + small offset (frames already elapsed since
 *      prefetch completed).  The tolerance check fails → browser fires a
 *      seeked event → 30-150 ms silence on Chromium/Electron.
 *
 *   3. Hard-cut pop — outgoing element.pause() was instantaneous, leaving
 *      residual speaker energy that the ear hears as a click.
 *
 * Fixes applied
 * ─────────────
 *   A. PRE-PLAY strategy: prefetched elements are started in MUTED playback
 *      mode (gain=0) slightly BEFORE the seam.  By the time the seam arrives
 *      the element is already running — no seek needed, no play() latency.
 *      At the exact seam frame we just ramp the gain up.
 *
 *   B. Wide seek tolerance for pre-playing elements: if the element is
 *      already playing and within PRE_PLAY_SEEK_TOLERANCE_S of the target,
 *      we skip the seek entirely and rely on real-time drift correction.
 *
 *   C. Gain crossfade: outgoing clip ramps to 0 over FADE_OUT_S before
 *      pause.  Incoming clip ramps from 0 to target over FADE_IN_S.
 *      Both use AudioContext.gain.linearRampToValueAtTime (sample-accurate).
 *
 *   D. Rolling seek update during prefetch: every LOOKAHEAD_FRAMES ticks we
 *      update the prefetched element's currentTime so it stays within
 *      PRE_PLAY_SEEK_TOLERANCE_S of where it needs to be at the seam.
 *
 * Pool strategy
 * ─────────────
 *   We reuse audio elements across renders.  An element is considered
 *   "dirty" only when its src changes.  Seek is skipped when the element
 *   is already within tolerance of the target time.
 *
 * Cleanup
 * ───────
 *   When the hook unmounts (or the segment list shrinks) surplus elements
 *   are paused, their src cleared, and they are returned to the pool.
 */

import { useEffect, useRef } from "react";
import { framesToSeconds, type TimelineSegment } from "../../shared/timeline";

// ── constants ─────────────────────────────────────────────────────────────────
const MAX_GAIN              = 4;       // matches the clip-volume ceiling
const SEEK_TOLERANCE_FRAMES = 1.5;    // normal per-frame drift tolerance
/** For a pre-playing (muted, pre-started) element we allow much larger drift
 *  so we never issue a mid-flight seek that would cause a glitch. */
const PRE_PLAY_SEEK_TOLERANCE_S = 0.25; // 250 ms — wide enough to skip any seek at the seam
const SEEK_TIMEOUT_MS       = 2000;
/** Frames ahead of a segment start to begin prefetching + pre-playing. */
const LOOKAHEAD_FRAMES      = 90;     // ~3 s at 30 fps
/** How many frames before the seam we start the incoming element (muted). */
const PRE_PLAY_FRAMES       = 12;     // ~400 ms at 30 fps — longer runway clears play() + seek latency
/** Gain ramp durations for seam crossfade (seconds).
 *  Equal-power crossfade: both ramps have the same duration so they overlap
 *  and sum to constant perceived loudness across the seam. */
const FADE_OUT_S            = 0.060;  // 60 ms outgoing ramp — tight but pop-free
const FADE_IN_S             = 0.060;  // 60 ms incoming ramp — matches outgoing for equal-power
/** Hard-cut micro-ramp: prevents DC-offset click on instant cuts (5 ms). */
const HARD_CUT_RAMP_S       = 0.005;  // 5 ms — inaudible ramp, zero-crossing protection

// ── shared AudioContext singleton (created lazily after a user gesture) ───────
let sharedCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  try {
    if (!sharedCtx || sharedCtx.state === "closed") {
      sharedCtx = new AudioContext();
    }
    if (sharedCtx.state === "suspended") void sharedCtx.resume();
    return sharedCtx;
  } catch {
    return null;
  }
}

// ── per-element Web Audio routing ─────────────────────────────────────────────
interface AudioRoute {
  element: HTMLAudioElement;
  gainNode: GainNode;
  sourceNode: MediaElementAudioSourceNode;
}

const routeMap = new WeakMap<AudioContext, Map<HTMLAudioElement, AudioRoute>>();

function getOrCreateRoute(
  ctx: AudioContext,
  element: HTMLAudioElement
): AudioRoute | null {
  try {
    if (!routeMap.has(ctx)) routeMap.set(ctx, new Map());
    const ctxRoutes = routeMap.get(ctx)!;
    if (ctxRoutes.has(element)) return ctxRoutes.get(element)!;

    const sourceNode = ctx.createMediaElementSource(element);
    const gainNode   = ctx.createGain();
    sourceNode.connect(gainNode);
    gainNode.connect(ctx.destination);
    const route: AudioRoute = { element, gainNode, sourceNode };
    ctxRoutes.set(element, route);
    return route;
  } catch {
    return null;
  }
}

/**
 * Schedule a sample-accurate LINEAR gain ramp using the AudioContext clock.
 * Use for fade-out (linear taper sounds natural on attenuation).
 */
function rampGain(
  route: AudioRoute,
  ctx: AudioContext,
  fromVal: number,
  toVal: number,
  durationSecs: number
): void {
  try {
    const now = ctx.currentTime;
    route.gainNode.gain.cancelScheduledValues(now);
    route.gainNode.gain.setValueAtTime(fromVal, now);
    route.gainNode.gain.linearRampToValueAtTime(toVal, now + durationSecs);
  } catch {
    route.gainNode.gain.value = toVal;
  }
}

/**
 * Equal-power (constant-power) fade-in ramp.
 * Uses an exponential curve so that as the outgoing clip fades linearly,
 * the combined perceived loudness stays constant across the seam:
 *   out_gain(t) = cos(t * π/2),  in_gain(t) = sin(t * π/2)
 * where t goes 0→1.  We approximate this with setValueCurveAtTime
 * using a 32-point sine curve.
 */
function rampGainEqualPower(
  route: AudioRoute,
  ctx: AudioContext,
  durationSecs: number
): void {
  try {
    const now    = ctx.currentTime;
    const STEPS  = 32;
    const curve  = new Float32Array(STEPS);
    for (let i = 0; i < STEPS; i++) {
      curve[i] = Math.sin((i / (STEPS - 1)) * (Math.PI / 2));
    }
    route.gainNode.gain.cancelScheduledValues(now);
    route.gainNode.gain.setValueAtTime(0, now);
    route.gainNode.gain.setValueCurveAtTime(curve, now, Math.max(0.001, durationSecs));
  } catch {
    // Fallback to linear if curve method unavailable
    rampGain(route, ctx, 0, 1, durationSecs);
  }
}

function setGainImmediate(route: AudioRoute, ctx: AudioContext, val: number): void {
  try {
    route.gainNode.gain.cancelScheduledValues(ctx.currentTime);
    route.gainNode.gain.setValueAtTime(val, ctx.currentTime);
  } catch {
    route.gainNode.gain.value = val;
  }
}

// ── element pool ──────────────────────────────────────────────────────────────
const elementPool: HTMLAudioElement[] = [];

function acquireElement(): HTMLAudioElement {
  const pooled = elementPool.pop();
  if (pooled) {
    pooled.pause();
    pooled.volume = 1;
    return pooled;
  }
  const el = document.createElement("audio");
  el.preload      = "auto";
  el.crossOrigin  = "anonymous";
  el.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
  document.body.appendChild(el);
  return el;
}

function releaseElement(el: HTMLAudioElement) {
  el.pause();
  el.currentTime = 0;
  el.src         = "";
  el.load();
  elementPool.push(el);
}

// ── seek helper ───────────────────────────────────────────────────────────────
async function seekTo(
  element: HTMLAudioElement,
  targetTime: number,
  fps: number
): Promise<void> {
  const tolerance = framesToSeconds(SEEK_TOLERANCE_FRAMES, fps);
  if (Math.abs(element.currentTime - targetTime) < tolerance) return;

  return new Promise<void>((resolve) => {
    const timer    = window.setTimeout(() => { cleanup(); resolve(); }, SEEK_TIMEOUT_MS);
    const onSeeked = () => { cleanup(); resolve(); };
    const cleanup  = () => {
      window.clearTimeout(timer);
      element.removeEventListener("seeked", onSeeked);
    };
    element.addEventListener("seeked", onSeeked, { once: true });
    element.currentTime = targetTime;
  });
}

// ── load helper ───────────────────────────────────────────────────────────────
async function loadSrc(element: HTMLAudioElement, url: string): Promise<void> {
  // Skip if already loaded with enough data
  if (
    element.src === url &&
    element.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA
  ) {
    return;
  }
  return new Promise<void>((resolve, reject) => {
    const timer     = window.setTimeout(() => { cleanup(); resolve(); }, 5000);
    const onCanPlay = () => { cleanup(); resolve(); };
    const onError   = () => { cleanup(); reject(new Error(`Audio load failed: ${url}`)); };
    const cleanup   = () => {
      window.clearTimeout(timer);
      element.removeEventListener("canplay",  onCanPlay);
      element.removeEventListener("error",    onError);
    };
    element.pause();
    element.addEventListener("canplay", onCanPlay, { once: true });
    element.addEventListener("error",   onError,   { once: true });
    element.src  = url;
    element.load();
  });
}

// ── slot (one active audio segment → one element) ─────────────────────────────
interface Slot {
  segment: TimelineSegment;
  element: HTMLAudioElement;
  /** True once this slot's fade-in ramp has fired for the current play start */
  fadeInDone: boolean;
  /** True if this element is already playing muted (pre-play mode) */
  isPrePlaying: boolean;
  /** True when this slot was adopted from the previous clip via seamless-continue.
   *  The element is already running at the correct position — NEVER seek it. */
  isSeamlessContinue?: boolean;
}

// ── prefetch / pre-play cache ─────────────────────────────────────────────────
interface PrefetchEntry {
  element: HTMLAudioElement;
  segment: TimelineSegment;
  /** True once element.play() has been called in muted/pre-play mode */
  prePlaying: boolean;
}

const prefetchMap = new Map<string, PrefetchEntry>();

/** Load and pre-play a segment's audio element at gain=0 so it's running by
 *  the time the seam arrives.  No seeked event will be needed at the boundary. */
async function prefetchAndPrePlay(
  seg: TimelineSegment,
  currentPlayheadFrame: number,
  fps: number
): Promise<void> {
  const url = seg.asset.previewUrl;
  if (!url) return;

  let entry = prefetchMap.get(seg.clip.id);
  if (!entry) {
    const el = acquireElement();
    entry = { element: el, segment: seg, prePlaying: false };
    prefetchMap.set(seg.clip.id, entry);
  }

  const { element } = entry;

  // Load source if needed
  try {
    await loadSrc(element, url);
  } catch {
    prefetchMap.delete(seg.clip.id);
    releaseElement(element);
    return;
  }

  // Compute where the element needs to be at the seam (startFrame)
  // minus a small buffer so it's already running when the seam hits.
  const clipSpeed = Math.max(0.25, Math.min(4, seg.clip.speed ?? 1));
  const preStartFrame = Math.max(seg.startFrame - PRE_PLAY_FRAMES, currentPlayheadFrame);
  const framesFromStart = Math.max(0, preStartFrame - seg.startFrame);
  const targetTime = seg.sourceInSeconds + framesToSeconds(framesFromStart, fps) * clipSpeed;

  // Seek the element to the pre-play position if not already close
  if (!entry.prePlaying) {
    if (Math.abs(element.currentTime - targetTime) > 0.1) {
      element.currentTime = targetTime;
      // Wait briefly for seek (non-blocking — if it doesn't complete, we still proceed)
      await new Promise<void>((resolve) => {
        const t = window.setTimeout(resolve, 500);
        element.addEventListener("seeked", () => { window.clearTimeout(t); resolve(); }, { once: true });
      });
    }
  } else {
    // Already pre-playing — just update position if drifted
    // (This is a rolling correction to stay near where we'll need to be)
    const seamTargetTime = seg.sourceInSeconds; // actual start position
    const drift = element.currentTime - seamTargetTime;
    // If drift is MORE than 1s ahead of where we need to be, re-seek
    if (element.currentTime < seamTargetTime - 0.3 || element.currentTime > seamTargetTime + 2.0) {
      element.currentTime = targetTime;
    }
  }

  // Start pre-playing at gain=0 so the element is running — no play() latency at seam
  if (!entry.prePlaying) {
    entry.prePlaying = true;
    const ctx = getAudioContext();
    if (ctx) {
      const route = getOrCreateRoute(ctx, element);
      if (route) {
        setGainImmediate(route, ctx, 0); // completely silent
        element.volume = 1;
      } else {
        element.volume = 0;
      }
    } else {
      element.volume = 0;
    }
    element.playbackRate = clipSpeed;
    try { await element.play(); } catch { /* autoplay policy — will try again at seam */ }
  }
}

/** Claim a prefetched/pre-playing element for a segment. */
function claimPrefetched(clipId: string): { element: HTMLAudioElement; wasPrePlaying: boolean } | null {
  const entry = prefetchMap.get(clipId);
  if (!entry) return null;
  prefetchMap.delete(clipId);
  return { element: entry.element, wasPrePlaying: entry.prePlaying };
}

// ── hook interface ─────────────────────────────────────────────────────────────
export interface MultiTrackAudioOptions {
  /** All enabled audio segments that currently overlap the playhead */
  activeAudioSegments: TimelineSegment[];
  /** All segments in the sequence (for lookahead prefetch) */
  allSegments?: TimelineSegment[];
  isPlaying: boolean;
  playheadFrame: number;
  sequenceFps: number;
}

export function useMultiTrackAudio({
  activeAudioSegments,
  allSegments,
  isPlaying,
  playheadFrame,
  sequenceFps,
}: MultiTrackAudioOptions): {
  startAudio: (frame: number) => Promise<void>;
  stopAudio: () => void;
  pauseAudio: () => void;
} {
  const slotsRef  = useRef<Slot[]>([]);
  const stateRef  = useRef({ activeAudioSegments, allSegments, isPlaying, playheadFrame, sequenceFps });

  useEffect(() => {
    stateRef.current = { activeAudioSegments, allSegments, isPlaying, playheadFrame, sequenceFps };
  });

  // ── reconcile ─────────────────────────────────────────────────────────────
  async function reconcileSlots(
    targetSegments: TimelineSegment[],
    shouldPlay: boolean,
    frame: number,
    fps: number
  ) {
    const ctx      = shouldPlay ? getAudioContext() : null;
    const wantedIds = new Set(targetSegments.map((s) => s.clip.id));

    // ── Detect "seamless continue" pairs ─────────────────────────────────
    // When outgoing clip A and incoming clip B:
    //   1. Share the same previewUrl (same source file)
    //   2. Are on the same track
    //   3. A.endFrame === B.startFrame  (adjacent — a split seam)
    //   4. A.sourceOutSeconds ≈ B.sourceInSeconds (continuous in source)
    // Then we can transfer A's running element directly to B — zero gap,
    // zero seek, zero fade. This is exactly what happens after a split.
    // Map: incoming clip.id → outgoing slot whose element we'll reuse
    //
    // NOTE: We compare against currentIds (slots currently playing), NOT
    // wantedIds.  Every entry in targetSegments is in wantedIds by definition,
    // so the old guard `wantedIds.has(incoming.clip.id)` always fired and the
    // loop body never executed — the seamless detection was completely dead.
    const currentIds = new Set(slotsRef.current.map((s) => s.segment.clip.id));
    const seamlessContinueMap = new Map<string, Slot>();
    for (const incoming of targetSegments) {
      if (currentIds.has(incoming.clip.id)) continue; // already playing — no seam to cross
      for (const slot of slotsRef.current) {
        if (wantedIds.has(slot.segment.clip.id)) continue; // still wanted — not outgoing
        const sameTrack   = slot.segment.track.id === incoming.track.id;
        const adjacent    = slot.segment.endFrame === incoming.startFrame;
        const sameUrl     = slot.segment.asset.previewUrl === incoming.asset.previewUrl;
        // Allow up to 1 frame of float imprecision in source time comparison
        const seamTime    = Math.abs(slot.segment.sourceOutSeconds - incoming.sourceInSeconds);
        const frameSecs   = framesToSeconds(1, fps);
        if (sameTrack && adjacent && sameUrl && seamTime < frameSecs * 2) {
          seamlessContinueMap.set(incoming.clip.id, slot);
          break;
        }
      }
    }

    // Outgoing slots that are being donated to a seamless continue — don't stop them
    const donatedSlots = new Set(seamlessContinueMap.values());

    // ── Outgoing slots: ramp gain to 0, then release ──────────────────────
    const nextSlots: Slot[]           = [];
    const outgoingReleases: Promise<void>[] = [];

    for (const slot of slotsRef.current) {
      if (wantedIds.has(slot.segment.clip.id)) {
        nextSlots.push(slot);
      } else if (donatedSlots.has(slot)) {
        // This element is being handed off to the next clip — don't touch it
        // (the incoming slot setup below will adopt it)
      } else {
        // Check if this outgoing clip is adjacent to any incoming clip on the
        // SAME track (hard cut — no fade bleed at seams between consecutive clips).
        const isAdjacentHardCut = targetSegments.some(
          (incoming) =>
            incoming.track.id === slot.segment.track.id &&
            slot.segment.endFrame === incoming.startFrame
        );

        if (shouldPlay && ctx) {
          const route = getOrCreateRoute(ctx, slot.element);
          if (route) {
            // Always ramp gain to 0 — even on hard cuts use a 5ms micro-ramp
            // to prevent the DC-offset click from a waveform that isn't at
            // zero at the cut point.  5 ms is completely inaudible.
            const rampDur = isAdjacentHardCut ? HARD_CUT_RAMP_S : FADE_OUT_S;
            rampGain(route, ctx, route.gainNode.gain.value, 0, rampDur);
            const el = slot.element;
            outgoingReleases.push(new Promise<void>((resolve) => {
              window.setTimeout(() => {
                el.pause();
                releaseElement(el);
                resolve();
              }, Math.ceil(rampDur * 1000) + 5);
            }));
          } else {
            slot.element.pause();
            releaseElement(slot.element);
          }
        } else {
          // Not playing — stop immediately (no audible issue when paused)
          if (ctx) {
            const route = getOrCreateRoute(ctx, slot.element);
            if (route) setGainImmediate(route, ctx, 0);
          }
          slot.element.pause();
          releaseElement(slot.element);
        }
      }
    }

    // ── Incoming slots: prefer pre-playing prefetch element ───────────────
    const existingIds = new Set(nextSlots.map((s) => s.segment.clip.id));
    // Identify clips that are hard-cut adjacent to a just-outgoing clip on the same track.
    // For these we skip the fade-in to avoid the "fade up from silence" artifact.
    const hardCutIncomingIds = new Set(
      targetSegments
        .filter((incoming) =>
          slotsRef.current.some(
            (outgoing) =>
              !wantedIds.has(outgoing.segment.clip.id) &&
              outgoing.segment.track.id === incoming.track.id &&
              outgoing.segment.endFrame === incoming.startFrame
          )
        )
        .map((s) => s.clip.id)
    );

    for (const seg of targetSegments) {
      if (existingIds.has(seg.clip.id)) continue;

      // ── Seamless continue: adopt the outgoing element unchanged ──────────
      const donorSlot = seamlessContinueMap.get(seg.clip.id);
      if (donorSlot) {
        // The element is already playing at exactly the right position.
        // Just update the segment reference so volume/trim checks use the
        // new clip's parameters, and mark fadeInDone=true (no ramp needed).
        // isSeamlessContinue=true prevents any seek in the ready-slot handler.
        nextSlots.push({
          segment:           seg,
          element:           donorSlot.element,
          fadeInDone:        true,   // already at correct gain — skip ramp
          isPrePlaying:      false,
          isSeamlessContinue: true,  // element is running — do NOT seek
        });
        continue;
      }

      const claimed   = claimPrefetched(seg.clip.id);
      const element   = claimed?.element ?? acquireElement();
      const wasPrePlaying = claimed?.wasPrePlaying ?? false;
      // Mark as fadeInDone so the sync loop sets gain immediately (no ramp)
      const isHardCut = hardCutIncomingIds.has(seg.clip.id);

      nextSlots.push({ segment: seg, element, fadeInDone: isHardCut, isPrePlaying: wasPrePlaying });
    }

    slotsRef.current = nextSlots;

    // ── Sync each slot ────────────────────────────────────────────────────
    // We split slots into two groups:
    //   A) "ready" — src already loaded (HAVE_ENOUGH_DATA or HAVE_FUTURE_DATA),
    //      or pre-playing.  These get full synchronous handling so they play
    //      in lock-step with video.
    //   B) "needs-load" — src not yet decoded.  We fire the load in the
    //      background (fire-and-forget) so we NEVER block video playback start.
    //      Once loaded they will pick up at the correct position via the next
    //      reconcile cycle triggered by the audioSegKey effect.

    const readySlots:   Slot[] = [];
    const pendingSlots: Slot[] = [];

    for (const slot of nextSlots) {
      const url = slot.segment.asset.previewUrl;
      const alreadyLoaded =
        slot.isPrePlaying ||
        slot.isSeamlessContinue ||   // element is actively playing — never "needs load"
        (slot.element.src === url &&
          slot.element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);
      if (alreadyLoaded) {
        readySlots.push(slot);
      } else {
        pendingSlots.push(slot);
      }
    }

    // ── handle "needs-load" slots in background (non-blocking) ───────────
    for (const slot of pendingSlots) {
      const { element, segment } = slot;
      const url = segment.asset.previewUrl;
      void (async () => {
        try { await loadSrc(element, url); }
        catch { return; }
        const segOffsetFrames = Math.max(0, stateRef.current.playheadFrame - segment.startFrame);
        const clipSpeed       = Math.max(0.25, Math.min(4, segment.clip.speed ?? 1));
        const targetTime      = segment.sourceInSeconds +
                                framesToSeconds(segOffsetFrames, fps) * clipSpeed;
        const clampedTime     = Math.min(
          Math.max(targetTime, segment.sourceInSeconds),
          Math.max(segment.sourceInSeconds, segment.sourceOutSeconds - framesToSeconds(1, fps))
        );
        await seekTo(element, clampedTime, fps);
        const trackMuted   = segment.track.muted ?? false;
        const clipVol      = Math.max(0, segment.clip.volume ?? 1);
        const effectiveVol = trackMuted ? 0 : clipVol;
        element.playbackRate = clipSpeed;
        const liveCtx = stateRef.current.isPlaying ? getAudioContext() : null;
        if (liveCtx) {
          const route = getOrCreateRoute(liveCtx, element);
          if (route) {
            const targetGain = Math.max(0, Math.min(MAX_GAIN, effectiveVol));
            // Ramp in from 0 when we start playing (avoids click)
            rampGain(route, liveCtx, 0, targetGain, FADE_IN_S);
            element.volume = 1;
          } else {
            element.volume = Math.min(1, effectiveVol);
          }
        } else {
          element.volume = Math.min(1, effectiveVol);
        }
        if (stateRef.current.isPlaying && !trackMuted) {
          try { await element.play(); } catch { /* autoplay policy */ }
        }
      })();
    }

    // ── handle "ready" slots synchronously ───────────────────────────────
    const syncTasks = readySlots.map(async (slot) => {
      const { element, segment } = slot;

      // Compute target playback position
      const segOffsetFrames = Math.max(0, frame - segment.startFrame);
      const clipSpeed       = Math.max(0.25, Math.min(4, segment.clip.speed ?? 1));
      const targetTime      = segment.sourceInSeconds +
                              framesToSeconds(segOffsetFrames, fps) * clipSpeed;
      const clampedTime     = Math.min(
        Math.max(targetTime, segment.sourceInSeconds),
        Math.max(segment.sourceInSeconds, segment.sourceOutSeconds - framesToSeconds(1, fps))
      );

      // ── SEEK DECISION ──────────────────────────────────────────────────
      // Seamless-continue slots: the element is already running at the exact
      // right position (the outgoing clip handed it off mid-stream).  Any seek
      // would cause a hiccup — skip entirely, just update gain/playbackRate.
      if (slot.isSeamlessContinue) {
        // No seek — element is already playing. Just clear the flag so future
        // reconcile cycles treat this slot normally.
        slot.isSeamlessContinue = false;
      } else if (slot.isPrePlaying && shouldPlay) {
        // Pre-playing (muted) element: use wide tolerance so we never await a
        // seeked event at the seam.  A small drift is completely inaudible.
        const drift = Math.abs(element.currentTime - clampedTime);
        if (drift > PRE_PLAY_SEEK_TOLERANCE_S) {
          // Drifted too far — synchronous seek only (no await); accept brief glitch
          // rather than silence. This only happens if prefetch started very early.
          element.currentTime = clampedTime;
        }
        // else: drift is acceptable, skip seek entirely — element is already running
      } else {
        // Already loaded, but not pre-playing — seek normally (fast, no network wait)
        await seekTo(element, clampedTime, fps);
      }

      // Apply volume / gain
      const trackMuted   = segment.track.muted ?? false;
      const clipVol      = Math.max(0, segment.clip.volume ?? 1);
      const effectiveVol = trackMuted ? 0 : clipVol;
      const targetGain   = Math.max(0, Math.min(MAX_GAIN, effectiveVol));

      element.playbackRate = clipSpeed;

      if (ctx) {
        const route = getOrCreateRoute(ctx, element);
        if (route) {
          if (shouldPlay && !slot.fadeInDone) {
            // Equal-power fade-in: use sine curve for incoming clip so that
            // outgoing (linear fade-out) + incoming (sine fade-in) ≈ constant
            // perceived loudness across the seam.  Scale the unit curve to
            // targetGain so volume-adjusted clips ramp to the correct level.
            if (targetGain > 0) {
              // Build a scaled equal-power curve: sin(0..π/2) * targetGain
              const STEPS = 32;
              const curve = new Float32Array(STEPS);
              for (let i = 0; i < STEPS; i++) {
                curve[i] = Math.sin((i / (STEPS - 1)) * (Math.PI / 2)) * targetGain;
              }
              try {
                const now = ctx.currentTime;
                route.gainNode.gain.cancelScheduledValues(now);
                route.gainNode.gain.setValueAtTime(0, now);
                route.gainNode.gain.setValueCurveAtTime(curve, now, Math.max(0.001, FADE_IN_S));
              } catch {
                rampGain(route, ctx, 0, targetGain, FADE_IN_S);
              }
            } else {
              setGainImmediate(route, ctx, 0);
            }
            slot.fadeInDone    = true;
            slot.isPrePlaying  = false; // now officially audible
          } else {
            setGainImmediate(route, ctx, targetGain);
          }
          element.volume = 1;
        } else {
          element.volume = Math.min(1, effectiveVol);
        }
      } else {
        element.volume = Math.min(1, effectiveVol);
      }

      // Play or pause
      if (shouldPlay && !trackMuted) {
        // If already playing (pre-play), play() is a no-op — no latency
        try { await element.play(); } catch { /* autoplay policy */ }
      } else {
        element.pause();
      }
    });

    await Promise.allSettled(syncTasks);
    // Outgoing fades run fire-and-forget
    void Promise.allSettled(outgoingReleases);
  }

  // ── pauseAudio ─────────────────────────────────────────────────────────────
  function pauseAudio() {
    const ctx = getAudioContext();
    for (const slot of slotsRef.current) {
      if (ctx) {
        const route = getOrCreateRoute(ctx, slot.element);
        if (route) route.gainNode.gain.cancelScheduledValues(ctx.currentTime);
      }
      slot.element.pause();
    }
  }

  function stopAudio() { pauseAudio(); }

  // ── startAudio ─────────────────────────────────────────────────────────────
  async function startAudio(frame: number) {
    const { activeAudioSegments: segs, sequenceFps: fps } = stateRef.current;
    for (const slot of slotsRef.current) {
      slot.fadeInDone   = false;
      slot.isPrePlaying = false;
    }
    await reconcileSlots(segs, true, frame, fps);
  }

  // ── Lookahead prefetch + pre-play effect ────────────────────────────────────
  // Triggered every frame while playing. When a segment is within
  // LOOKAHEAD_FRAMES we load its element. When it is within PRE_PLAY_FRAMES
  // we start it playing at gain=0 so it's already running at the seam.
  useEffect(() => {
    if (!isPlaying) return;
    const segs = allSegments ?? stateRef.current.allSegments ?? [];
    const fps  = sequenceFps;

    for (const seg of segs) {
      if (
        seg.track.kind !== "audio" ||
        !seg.clip.isEnabled         ||
        seg.track.muted
      ) continue;

      // Already active — nothing to prefetch
      if (playheadFrame >= seg.startFrame && playheadFrame < seg.endFrame) continue;

      const framesUntilStart = seg.startFrame - playheadFrame;

      if (framesUntilStart > 0 && framesUntilStart <= LOOKAHEAD_FRAMES) {
        // Within lookahead window — start prefetch + pre-play async
        void prefetchAndPrePlay(seg, playheadFrame, fps);
      }
    }

    // Housekeeping: drop stale prefetch entries
    for (const [clipId, entry] of prefetchMap.entries()) {
      const seg = segs.find((s) => s.clip.id === clipId);
      if (!seg || seg.endFrame <= playheadFrame) {
        prefetchMap.delete(clipId);
        entry.element.pause();
        releaseElement(entry.element);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, playheadFrame, sequenceFps]);

  // ── effect: sync when playing state / segments / volume / speed change ──────
  const audioSegKey = activeAudioSegments
    .map((s) => `${s.clip.id}:${(s.clip.volume ?? 1).toFixed(3)}:${(s.clip.speed ?? 1).toFixed(3)}:${s.track.muted ? 1 : 0}`)
    .join(",");
  useEffect(() => {
    const { activeAudioSegments: segs, playheadFrame: frame, sequenceFps: fps } = stateRef.current;
    void reconcileSlots(segs, isPlaying, frame, fps);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, audioSegKey]);

  // ── effect: scrub sync (when NOT playing) ─────────────────────────────────
  useEffect(() => {
    if (isPlaying) return;
    const { activeAudioSegments: segs, sequenceFps: fps } = stateRef.current;
    void reconcileSlots(segs, false, playheadFrame, fps);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, playheadFrame]);

  // ── cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      for (const slot of slotsRef.current) {
        slot.element.pause();
        releaseElement(slot.element);
      }
      slotsRef.current = [];
      for (const entry of prefetchMap.values()) {
        entry.element.pause();
        releaseElement(entry.element);
      }
      prefetchMap.clear();
    };
  }, []);

  return { startAudio, stopAudio, pauseAudio };
}

/**
 * findAllActiveAudioSegments
 * Returns ALL enabled, non-muted audio segments that overlap the playhead.
 * Solo semantics: if ANY track has solo=true, only return segments from solo tracks.
 */
export function findAllActiveAudioSegments(
  segments: TimelineSegment[],
  playheadFrame: number
): TimelineSegment[] {
  const audioSegs = segments.filter(
    (s) =>
      s.track.kind === "audio" &&
      s.clip.isEnabled &&
      !s.track.muted &&
      playheadFrame >= s.startFrame &&
      playheadFrame < s.endFrame
  );

  const hasSolo = segments.some((s) => s.track.kind === "audio" && s.track.solo);
  if (hasSolo) return audioSegs.filter((s) => s.track.solo);
  return audioSegs;
}
