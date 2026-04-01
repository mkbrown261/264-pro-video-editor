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
 *   Track-level mute / solo / volume and clip-level volume & speed are all
 *   respected without ever killing other clips.
 *
 * Pool strategy
 * ─────────────
 *   We reuse audio elements across renders.  An element is considered
 *   "dirty" only when its src changes.  Seek is skipped when the element
 *   is already within one-frame tolerance of the target time.
 *
 * Cleanup
 * ───────
 *   When the hook unmounts (or the segment list shrinks) surplus elements
 *   are paused, their src cleared, and they are returned to the pool.
 */

import { useEffect, useRef } from "react";
import { framesToSeconds, type TimelineSegment } from "../../shared/timeline";

// ── constants ─────────────────────────────────────────────────────────────────
const MAX_GAIN = 4;          // matches the clip-volume ceiling
const SEEK_TOLERANCE_FRAMES = 1.5;
const SEEK_TIMEOUT_MS = 2000;

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
  currentUrl: string;
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
    const gainNode = ctx.createGain();
    sourceNode.connect(gainNode);
    gainNode.connect(ctx.destination);
    const route: AudioRoute = { element, gainNode, sourceNode, currentUrl: "" };
    ctxRoutes.set(element, route);
    return route;
  } catch {
    return null;
  }
}

// ── element pool ──────────────────────────────────────────────────────────────
// A shared pool of <audio> elements shared across ALL instances of the hook.
// Each element is tagged with a lease token so we know which instance is using it.
const elementPool: HTMLAudioElement[] = [];

function acquireElement(): HTMLAudioElement {
  const pooled = elementPool.pop();
  if (pooled) {
    pooled.pause();
    return pooled;
  }
  const el = document.createElement("audio");
  el.preload = "auto";
  el.crossOrigin = "anonymous";
  // Mount to DOM so the browser loads it (some browsers throttle detached elements)
  el.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
  document.body.appendChild(el);
  return el;
}

function releaseElement(el: HTMLAudioElement) {
  el.pause();
  el.currentTime = 0;
  el.src = "";
  el.load();
  elementPool.push(el);
}

// ── seek helper ───────────────────────────────────────────────────────────────
async function seekTo(element: HTMLAudioElement, targetTime: number, fps: number): Promise<void> {
  const tolerance = framesToSeconds(SEEK_TOLERANCE_FRAMES, fps);
  if (Math.abs(element.currentTime - targetTime) < tolerance) return;

  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(() => { cleanup(); resolve(); }, SEEK_TIMEOUT_MS);
    const onSeeked = () => { cleanup(); resolve(); };
    const cleanup = () => {
      window.clearTimeout(timer);
      element.removeEventListener("seeked", onSeeked);
    };
    element.addEventListener("seeked", onSeeked, { once: true });
    element.currentTime = targetTime;
  });
}

// ── load helper ───────────────────────────────────────────────────────────────
async function loadSrc(element: HTMLAudioElement, url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      // Don't reject on timeout — the element might still play; just proceed.
      resolve();
    }, 5000);
    const onCanPlay = () => { cleanup(); resolve(); };
    const onError   = () => { cleanup(); reject(new Error(`Audio load failed: ${url}`)); };
    const cleanup = () => {
      window.clearTimeout(timer);
      element.removeEventListener("canplay", onCanPlay);
      element.removeEventListener("error",   onError);
    };
    element.pause();
    element.addEventListener("canplay", onCanPlay, { once: true });
    element.addEventListener("error",   onError,   { once: true });
    element.src = url;
    element.load();
  });
}

// ── slot (one active audio segment → one element) ─────────────────────────────
interface Slot {
  segment: TimelineSegment;
  element: HTMLAudioElement;
}

// ── hook interface ─────────────────────────────────────────────────────────────
export interface MultiTrackAudioOptions {
  /** All enabled audio segments that currently overlap the playhead */
  activeAudioSegments: TimelineSegment[];
  isPlaying: boolean;
  playheadFrame: number;
  sequenceFps: number;
}

/**
 * useMultiTrackAudio
 *
 * Call this hook in ViewerPanel instead of the old single-element approach.
 * It manages its own pool of <audio> elements and returns helpers to
 * start / stop the mix.
 */
export function useMultiTrackAudio({
  activeAudioSegments,
  isPlaying,
  playheadFrame,
  sequenceFps,
}: MultiTrackAudioOptions): {
  startAudio: (frame: number) => Promise<void>;
  stopAudio: () => void;
  pauseAudio: () => void;
} {
  // active slots: one per currently-playing segment
  const slotsRef = useRef<Slot[]>([]);
  // stateRef for use inside async functions to avoid stale closure issues
  const stateRef = useRef({ activeAudioSegments, isPlaying, playheadFrame, sequenceFps });

  // keep state ref current
  useEffect(() => {
    stateRef.current = { activeAudioSegments, isPlaying, playheadFrame, sequenceFps };
  });

  // ── reconcile: add/remove slots to match active segments ─────────────────
  async function reconcileSlots(
    targetSegments: TimelineSegment[],
    shouldPlay: boolean,
    frame: number,
    fps: number
  ) {
    const ctx = shouldPlay ? getAudioContext() : null;

    // Build a set of clip IDs we want active
    const wantedIds = new Set(targetSegments.map((s) => s.clip.id));

    // Release slots for segments no longer active
    const nextSlots: Slot[] = [];
    for (const slot of slotsRef.current) {
      if (wantedIds.has(slot.segment.clip.id)) {
        nextSlots.push(slot);
      } else {
        if (!shouldPlay) slot.element.pause();
        releaseElement(slot.element);
      }
    }

    // Add new slots for newly-active segments
    const existingIds = new Set(nextSlots.map((s) => s.segment.clip.id));
    for (const seg of targetSegments) {
      if (existingIds.has(seg.clip.id)) continue;
      const element = acquireElement();
      nextSlots.push({ segment: seg, element });
    }

    slotsRef.current = nextSlots;

    // Sync each slot
    const syncTasks = nextSlots.map(async (slot) => {
      const { element, segment } = slot;
      const url = segment.asset.previewUrl;

      // Load if src changed
      if (element.src !== url && url) {
        try {
          await loadSrc(element, url);
        } catch {
          return; // skip this slot if load fails
        }
      }

      // Compute target time
      const segOffsetFrames = Math.max(0, frame - segment.startFrame);
      const clipSpeed = Math.max(0.25, Math.min(4, segment.clip.speed ?? 1));
      const targetTime = segment.sourceInSeconds + framesToSeconds(segOffsetFrames, fps) * clipSpeed;
      const clampedTime = Math.min(
        Math.max(targetTime, segment.sourceInSeconds),
        Math.max(segment.sourceInSeconds, segment.sourceOutSeconds - framesToSeconds(1, fps))
      );

      // Seek if needed
      await seekTo(element, clampedTime, fps);

      // Apply track mute / volume
      const trackMuted = segment.track.muted ?? false;
      const trackSolo  = false; // solo handled at segment-filter level — all segments here are already filtered
      const clipVol    = Math.max(0, segment.clip.volume ?? 1);
      const effectiveVol = trackMuted ? 0 : clipVol;

      // Apply speed
      element.playbackRate = Math.max(0.25, Math.min(4, segment.clip.speed ?? 1));

      // Apply gain via Web Audio if possible, else HTML5 volume
      if (ctx) {
        const route = getOrCreateRoute(ctx, element);
        if (route) {
          route.gainNode.gain.value = Math.max(0, Math.min(MAX_GAIN, effectiveVol));
          element.volume = 1; // gain node controls the level
        } else {
          element.volume = Math.min(1, effectiveVol);
        }
      } else {
        element.volume = Math.min(1, effectiveVol);
      }

      // Play or pause
      if (shouldPlay && !trackMuted) {
        try { await element.play(); } catch { /* browser autoplay policy */ }
      } else {
        element.pause();
      }
    });

    await Promise.allSettled(syncTasks);
  }

  // ── pauseAudio ─────────────────────────────────────────────────────────────
  function pauseAudio() {
    for (const slot of slotsRef.current) {
      slot.element.pause();
    }
  }

  // ── stopAudio ──────────────────────────────────────────────────────────────
  function stopAudio() {
    pauseAudio();
  }

  // ── startAudio ─────────────────────────────────────────────────────────────
  async function startAudio(frame: number) {
    const { activeAudioSegments: segs, sequenceFps: fps } = stateRef.current;
    await reconcileSlots(segs, true, frame, fps);
  }

  // ── effect: sync when playing state / segments / volume / speed change ──────
  // FIX 3: Include volume and speed in dependency key so that changing
  // clip volume or speed immediately applies to the audio element even
  // while the clip ID set is unchanged.
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
    };
  }, []);

  return { startAudio, stopAudio, pauseAudio };
}

/**
 * findAllActiveAudioSegments
 * ─────────────────────────────────────────────────────────────────────────────
 * Returns ALL enabled, non-muted audio segments (across ALL tracks) that
 * overlap the current playhead frame — not just the highest-priority one.
 *
 * Solo semantics: if ANY track has solo=true, only return segments from
 * solo tracks (standard DAW behaviour).
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

  // Solo check
  const hasSolo = segments.some((s) => s.track.kind === "audio" && s.track.solo);
  if (hasSolo) {
    return audioSegs.filter((s) => s.track.solo);
  }

  return audioSegs;
}
