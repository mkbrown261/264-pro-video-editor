/**
 * usePlaybackController
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates timeline playback for the ViewerPanel.
 *
 * Video: TWO <video> elements ("slots").  At any moment one slot is the
 *        PRIMARY (shows the active clip) and the other is the PARTNER:
 *          • during a two-clip transition the partner plays the adjacent clip
 *            so the viewer can blend / wipe / push A and B for real;
 *          • ahead of a plain cut the partner pre-rolls the next clip (loaded,
 *            seeked to its in-point, paused).
 *        When the playhead crosses the cut the two slots simply SWAP roles —
 *        no load/seek on the visible element, so there is no freeze or black
 *        frame at the seam.
 * Audio: delegates to useMultiTrackAudio which keeps N buffer sources in a
 *        Web Audio graph, one per active audio segment, all mixed together.
 *
 * Rendering hierarchy (video):
 *   Only the highest-priority enabled video segment at the playhead is the
 *   active clip.  Which slot is primary is exposed via `primarySlot` so the
 *   ViewerPanel can style the layers by role (outgoing / incoming).
 */

import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type MutableRefObject
} from "react";
import {
  findNextSegmentAtOrAfterFrame,
  framesToSeconds,
  type TimelineSegment
} from "../../shared/timeline";
import {
  getHandleTargetTime,
  getPlayableOutTime,
  getSegmentExtents
} from "../../shared/transitions";
import type { TimelineTrackKind } from "../../shared/models";
import {
  useMultiTrackAudio,
  findAllActiveAudioSegments
} from "./useMultiTrackAudio";
import type { AudioEngine } from "../lib/AudioScheduler";
import { AudioScheduler } from "../lib/AudioScheduler";

export type VideoSlot = 0 | 1;

interface PlaybackControllerOptions {
  /** Video slot 0. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Video slot 1.  Optional — without it the controller degrades to the
   *  single-element behaviour (no A/B blending, reload at every cut). */
  videoBRef?: RefObject<HTMLVideoElement | null>;
  /** @deprecated kept for API compatibility — audio is now fully managed by
   *  useMultiTrackAudio internally.  Pass a ref; it will not be used. */
  audioRef: RefObject<HTMLAudioElement | null>;
  activeSegment: TimelineSegment | null;
  /**
   * Clip to keep live in the partner slot: the other half of an in-progress
   * transition, or the next clip to pre-roll before a plain cut.  Same
   * (proxy / render-cache patched) shape as `activeSegment`.
   */
  partnerSegment?: TimelineSegment | null;
  /** True while `partnerSegment` is the other half of a transition that is
   *  currently blending (it must PLAY, not just sit pre-rolled). */
  partnerIsBlending?: boolean;
  activeAudioSegment: TimelineSegment | null;
  segments: TimelineSegment[];
  isPlaying: boolean;
  playheadFrame: number;
  sequenceFps: number;
  totalFrames: number;
  setPlayheadFrame: (frame: number) => void;
  setPlaybackPlaying: (isPlaying: boolean) => void;
  onPlaybackMessage?: (message: string | null) => void;
}

interface PlaybackControllerResult {
  togglePlayback: () => Promise<void>;
  pausePlayback: () => void;
  stopPlayback: () => void;
  audioEngineRef: MutableRefObject<AudioEngine | null>;
  /** Which slot currently shows the active clip (React state — re-renders on swap). */
  primarySlot: VideoSlot;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function getTargetCurrentTime(
  segment: TimelineSegment,
  playheadFrame: number,
  sequenceFps: number
): number {
  // BUG #25 fix: guard against division by zero when sequenceFps is 0 (corrupted project)
  if (!sequenceFps || sequenceFps <= 0) return segment.sourceInSeconds;
  const segmentOffsetFrames = Math.max(0, playheadFrame - segment.startFrame);
  const clipSpeed = Math.max(0.25, Math.min(4, segment.clip.speed ?? 1));
  const sourceOffsetSeconds = framesToSeconds(segmentOffsetFrames, sequenceFps) * clipSpeed;
  const expectedTime = segment.sourceInSeconds + sourceOffsetSeconds;
  return Math.min(
    Math.max(expectedTime, segment.sourceInSeconds),
    Math.max(segment.sourceInSeconds, segment.sourceOutSeconds - framesToSeconds(1, sequenceFps))
  );
}

/**
 * Target source time for a clip that may currently be OUTSIDE its own
 * timeline bounds (the incoming half of a transition before the cut, or the
 * outgoing half after it).  Runs into the source handles, clamped to media.
 */
function getTargetTimeWithHandles(
  segments: TimelineSegment[],
  segment: TimelineSegment,
  playheadFrame: number,
  sequenceFps: number
): number {
  const ext = getSegmentExtents(segments, segment);
  const f = Math.max(ext.visibleStart, Math.min(ext.visibleEnd - 1, playheadFrame));
  if (f >= segment.startFrame && f < segment.endFrame) {
    return getTargetCurrentTime(segment, f, sequenceFps);
  }
  return getHandleTargetTime(segment, f, sequenceFps);
}

function getPlaybackErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Playback could not start for this media source.";
}

// ── Web Audio gain for video element volume > 100% ─────────────────────────
const gainNodeMap = new WeakMap<HTMLMediaElement, { ctx: AudioContext; gain: GainNode }>();

// BUG #18 fix: module-level singleton AudioContext to avoid hitting Safari's
// ~6 concurrent AudioContext limit (previously created one per video element).
let sharedAudioContext: AudioContext | null = null;
function getSharedAudioContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContext();
  }
  return sharedAudioContext;
}

function applyGain(media: HTMLMediaElement, volume: number): void {
  try {
    let entry = gainNodeMap.get(media);
    if (!entry) {
      const ctx  = getSharedAudioContext(); // BUG #18 fix: use shared context
      const src  = ctx.createMediaElementSource(media);
      const gain = ctx.createGain();
      src.connect(gain);
      gain.connect(ctx.destination);
      entry = { ctx, gain };
      gainNodeMap.set(media, entry);
    }
    entry.gain.gain.value = Math.max(0, Math.min(4, volume));
    if (entry.ctx.state === "suspended") void entry.ctx.resume();
  } catch {
    media.volume = Math.min(1, volume);
  }
}
void applyGain; // retained for parity with earlier builds (video elements are muted)

function getEnabledSegments(segments: TimelineSegment[]): TimelineSegment[] {
  return segments.filter((s) => s.clip.isEnabled);
}

function findActiveVideoSegmentAtFrame(
  segments: TimelineSegment[],
  frame: number
): TimelineSegment | null {
  const covering = segments.filter(
    (s) =>
      s.track.kind === ("video" as TimelineTrackKind) &&
      s.clip.isEnabled &&
      !s.track.muted &&
      frame >= s.startFrame &&
      frame < s.endFrame
  );
  if (!covering.length) return null;
  // Lowest trackIndex wins — trackIndex 0 is the topmost visual row in the
  // timeline (rendered first in trackLayouts.map()), so it has highest priority.
  return covering.sort((a, b) => a.trackIndex - b.trackIndex)[0];
}

async function loadMediaSource(
  element: HTMLMediaElement,
  sourceUrl: string,
  assetName: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    // 8-second hard timeout — if canplay never fires (e.g. codec unsupported),
    // we resolve anyway so startPlaybackAtFrame can still set the RAF clock.
    const timer = window.setTimeout(() => { cleanup(); resolve(); }, 8000);
    const handleCanPlay = () => { cleanup(); resolve(); };
    const handleError   = () => { cleanup(); reject(new Error(`Failed to load ${assetName} into playback.`)); };
    const cleanup = () => {
      window.clearTimeout(timer);
      element.removeEventListener("canplay", handleCanPlay);
      element.removeEventListener("error",   handleError);
    };
    element.pause();
    element.addEventListener("canplay", handleCanPlay, { once: true });
    element.addEventListener("error",   handleError,   { once: true });
    element.src = sourceUrl;
    element.load();
  });
}

async function seekMediaElement(
  element: HTMLMediaElement,
  targetTime: number,
  sequenceFps: number
): Promise<void> {
  await new Promise<void>((resolve) => {
    // 2-second hard timeout — always resolves so we never hang the viewer
    const timeoutId = window.setTimeout(() => { cleanup(); resolve(); }, 2000);

    const handleSeeked = () => { cleanup(); resolve(); };
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      element.removeEventListener("seeked", handleSeeked);
    };

    // If already seeking, let it finish then seek to our target
    // (avoids double-seek race on rapid scrub)
    if (element.seeking) {
      const onCurrentSeeked = () => {
        element.removeEventListener("seeked", onCurrentSeeked);
        element.addEventListener("seeked", handleSeeked, { once: true });
        element.currentTime = targetTime;
      };
      element.addEventListener("seeked", onCurrentSeeked, { once: true });
      return;
    }

    element.addEventListener("seeked", handleSeeked, { once: true });
    element.currentTime = targetTime;

    // If the browser already has this frame decoded (readyState >= HAVE_CURRENT_DATA)
    // and currentTime snapped exactly, seeked may not fire — resolve immediately.
    // Use a microtask so the seeked listener has a chance to fire first.
    Promise.resolve().then(() => {
      if (Math.abs(element.currentTime - targetTime) < framesToSeconds(1, sequenceFps) &&
          element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        cleanup();
        resolve();
      }
    });
  });
}

/** Per-slot bookkeeping. */
interface SlotState {
  loadedUrl: string | null;
  /** clip.id of the segment last synced into this slot (null = empty). */
  clipId: string | null;
  generation: number;
  loading: boolean;
  trimGuardCleanup: (() => void) | null;
}

function newSlotState(): SlotState {
  return { loadedUrl: null, clipId: null, generation: 0, loading: false, trimGuardCleanup: null };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function usePlaybackController({
  videoRef,
  videoBRef,
  // audioRef is kept for API compatibility but audio is now handled by
  // useMultiTrackAudio internally
  audioRef: _audioRef,
  activeSegment,
  partnerSegment = null,
  partnerIsBlending = false,
  segments,
  isPlaying,
  playheadFrame,
  sequenceFps,
  totalFrames,
  setPlayheadFrame,
  setPlaybackPlaying,
  onPlaybackMessage
}: PlaybackControllerOptions): PlaybackControllerResult {

  const rafRef = useRef<number | null>(null);
  // Tracks the previous RAF timestamp so we can detect browser stalls
  // (fullscreen transitions, tab switches, etc.) and compensate for them.
  // Stalls show up as an abnormally large gap between consecutive RAF frames.
  const lastRafTimestampRef = useRef<number | null>(null);

  // ── AudioScheduler (singleton across renders) ──────────────────────────────
  const schedulerRef = useRef<AudioScheduler | null>(null);
  if (!schedulerRef.current) {
    schedulerRef.current = new AudioScheduler();
  }

  // ── Slots ─────────────────────────────────────────────────────────────────
  const [primarySlot, setPrimarySlot] = useState<VideoSlot>(0);
  const primarySlotRef = useRef<VideoSlot>(0);
  const slotStateRef = useRef<[SlotState, SlotState]>([newSlotState(), newSlotState()]);

  function slotEl(slot: VideoSlot): HTMLVideoElement | null {
    return slot === 0 ? videoRef.current : (videoBRef?.current ?? null);
  }
  function primaryEl(): HTMLVideoElement | null { return slotEl(primarySlotRef.current); }
  function partnerSlot(): VideoSlot { return primarySlotRef.current === 0 ? 1 : 0; }
  function partnerEl(): HTMLVideoElement | null {
    return videoBRef ? slotEl(partnerSlot()) : null;
  }
  function swapSlots(): void {
    const next = partnerSlot();
    primarySlotRef.current = next;
    setPrimarySlot(next);
  }

  // All mutable state tracked via refs to avoid stale closures
  const stateRef = useRef({
    isPlaying,
    playheadFrame,
    activeSegment,
    partnerSegment,
    partnerIsBlending,
    segments,
    sequenceFps,
    totalFrames,
    setPlayheadFrame,
    setPlaybackPlaying,
    onPlaybackMessage,
    playbackAnchorFrame: playheadFrame,
    playbackStartedAt: null as number | null
  });

  // Keep stateRef in sync with latest props
  useEffect(() => {
    stateRef.current.isPlaying = isPlaying;
    stateRef.current.playheadFrame = playheadFrame;
    stateRef.current.activeSegment = activeSegment;
    stateRef.current.partnerSegment = partnerSegment;
    stateRef.current.partnerIsBlending = partnerIsBlending;
    stateRef.current.segments = segments;
    stateRef.current.sequenceFps = sequenceFps;
    stateRef.current.totalFrames = totalFrames;
    stateRef.current.setPlayheadFrame = setPlayheadFrame;
    stateRef.current.setPlaybackPlaying = setPlaybackPlaying;
    stateRef.current.onPlaybackMessage = onPlaybackMessage;
  });

  // ── Preload audio assets via AudioScheduler whenever segment list changes ──
  // This pre-buffers upcoming clips so there are no gaps at seam points.
  useEffect(() => {
    const scheduler = schedulerRef.current;
    if (!scheduler) return;
    const audioAssets = segments
      .filter((s) => s.track.kind === ("audio" as TimelineTrackKind) && s.clip.isEnabled && !s.track.muted)
      .map((s) => s.asset);
    // Deduplicate by id
    const unique = Array.from(new Map(audioAssets.map((a) => [a.id, a])).values());
    void scheduler.preload(unique);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments]);

  // ── Multi-track audio engine ───────────────────────────────────────────────
  // Compute all active audio segments (across ALL tracks) at the current frame
  const activeAudioSegments = findAllActiveAudioSegments(segments, playheadFrame);

  const { startAudio, stopAudio, pauseAudio, engineRef: audioEngineRef } = useMultiTrackAudio({
    activeAudioSegments,
    allSegments: segments,   // pass ALL segments for lookahead prefetch
    isPlaying,
    playheadFrame,
    sequenceFps
  });

  // True while startPlaybackAtFrame is in progress — prevents the scrub effect
  // (which fires when playheadFrame changes) from racing the play-start sync
  // and winning the generation counter, leaving the video paused at the wrong frame.
  const startingPlaybackRef = useRef(false);

  // ── Auto-invalidate loadedUrl on external video reset ─────────────────────
  // ViewerPanel may call video.src = x; video.load() to show a media-pool
  // asset when no timeline clip is active.  That resets the element state
  // (currentTime → 0, readyState → 0).  We listen for 'emptied' to detect
  // when the element is reset by an EXTERNAL caller, so the next sync
  // correctly re-loads instead of assuming the URL is still valid.
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    ([0, 1] as VideoSlot[]).forEach((slot) => {
      const video = slotEl(slot);
      if (!video) return;
      const onEmptied = () => {
        const st = slotStateRef.current[slot];
        if (st.loading) return; // our own loadMediaSource reset
        st.loadedUrl = null;
        st.clipId = null;
      };
      video.addEventListener("emptied", onEmptied);
      cleanups.push(() => video.removeEventListener("emptied", onEmptied));
    });
    return () => cleanups.forEach((c) => c());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Attach a timeupdate listener that hard-stops a slot the instant it passes
   *  its playable out-point (own out point + any transition tail).  Fires every
   *  ~250 ms (browser-driven) so we catch the boundary even when the RAF is
   *  frozen during load/seek.
   *
   *  IMPORTANT: we only PAUSE here — we do NOT reset currentTime.  Resetting
   *  currentTime inside timeupdate creates an infinite loop. */
  function attachTrimGuard(slot: VideoSlot, media: HTMLVideoElement, seg: TimelineSegment): void {
    const st = slotStateRef.current[slot];
    st.trimGuardCleanup?.();
    st.trimGuardCleanup = null;

    const outTime = getPlayableOutTime(stateRef.current.segments, seg, stateRef.current.sequenceFps);
    const ext = getSegmentExtents(stateRef.current.segments, seg);
    const inTime  = ext.preRollFrames > 0
      ? getHandleTargetTime(seg, ext.visibleStart, stateRef.current.sequenceFps)
      : seg.sourceInSeconds;

    const onTimeUpdate = () => {
      if (media.currentTime > outTime + 0.016) { // 16 ms ≈ 1 frame at 60fps
        media.pause();
      }
      if (media.currentTime < inTime - 0.016) {
        media.currentTime = inTime;
      }
    };

    media.addEventListener("timeupdate", onTimeUpdate);
    st.trimGuardCleanup = () => media.removeEventListener("timeupdate", onTimeUpdate);
  }

  function detachTrimGuard(slot: VideoSlot): void {
    const st = slotStateRef.current[slot];
    st.trimGuardCleanup?.();
    st.trimGuardCleanup = null;
  }

  // ── sync one slot ─────────────────────────────────────────────────────────
  /**
   * Bring `slot` to `segment` @ `frame`.  Loads the URL if needed, seeks if
   * needed, then plays or pauses.  `hideDuringSeek` hides the element while a
   * load/seek is pending so a wrong frame is never painted (used for the
   * primary slot; the partner is invisible anyway until a transition starts).
   */
  async function syncSlot(
    slot: VideoSlot,
    segment: TimelineSegment | null,
    frame: number,
    shouldPlay: boolean,
    hideDuringSeek: boolean
  ): Promise<boolean> {
    const st = slotStateRef.current[slot];
    const myGen = ++st.generation;
    const isStale = () => st.generation !== myGen;

    const media = slotEl(slot);
    if (!media) return false;

    if (!segment) {
      detachTrimGuard(slot);
      media.pause();
      if (media.src) {
        st.loading = true;
        try {
          media.removeAttribute("src");
          media.load();
        } finally {
          st.loading = false;
        }
      }
      st.loadedUrl = null;
      st.clipId = null;
      return false;
    }

    try {
      const fps = stateRef.current.sequenceFps;
      const nextUrl = segment.asset.previewUrl;
      const urlChanged = st.loadedUrl !== nextUrl;
      const targetTime = getTargetTimeWithHandles(stateRef.current.segments, segment, frame, fps);
      const outTime = getPlayableOutTime(stateRef.current.segments, segment, fps);

      // Determine whether a seek is needed BEFORE hiding.  The root cause of
      // the frame-0 flash on trimmed clips was: same URL → no hide → browser
      // painted the previously-buffered frame before seeked fired.  Fix: hide
      // whenever ANY seek happens on a visible slot.
      const timeDrift = Math.abs(media.currentTime - targetTime);
      const outOfBounds = media.currentTime > outTime + framesToSeconds(1, fps) ||
        media.currentTime < Math.min(targetTime, segment.sourceInSeconds) - framesToSeconds(1, fps);
      // When paused, a seek is skipped only if the element is already showing
      // the exact frame (sub-frame drift with decoded data) — otherwise we
      // would flash the stale frame.
      const alreadyOnFrame = !urlChanged && !outOfBounds &&
        timeDrift < framesToSeconds(0.5, fps) &&
        media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      const needsSeek = urlChanged || outOfBounds ||
        (!shouldPlay && !alreadyOnFrame) ||
        timeDrift > framesToSeconds(2, fps);

      if (hideDuringSeek && (urlChanged || needsSeek)) {
        media.style.visibility = "hidden";
      }

      if (urlChanged) {
        detachTrimGuard(slot);
        st.loading = true;
        try {
          // loadMediaSource is always called — when the browser cache is warm
          // the canplay event fires in <10 ms, making this effectively instant.
          await loadMediaSource(media, nextUrl, segment.asset.name);
        } finally {
          st.loading = false;
        }
        st.loadedUrl = nextUrl;
        if (isStale()) { media.style.visibility = "visible"; return false; }
      }

      if (needsSeek) {
        await seekMediaElement(media, targetTime, fps);
        if (isStale()) { media.style.visibility = "visible"; return false; }
      }

      // Load + seek complete — the correct frame is decoded and ready.
      media.style.visibility = "visible";
      st.clipId = segment.clip.id;

      if (shouldPlay) {
        const clipSpeed = Math.max(0.25, Math.min(4, segment.clip.speed ?? 1));
        media.playbackRate = clipSpeed;
        // Video element is muted — audio is handled by useMultiTrackAudio
        media.muted = true;
        media.volume = 1;
        attachTrimGuard(slot, media, segment);
        await media.play();
      } else {
        detachTrimGuard(slot);
        media.pause();
      }

      if (slot === primarySlotRef.current) stateRef.current.onPlaybackMessage?.(null);
      return true;
    } catch (error) {
      const el = slotEl(slot);
      if (el) el.style.visibility = "visible";
      if (slot === primarySlotRef.current) {
        stateRef.current.onPlaybackMessage?.(getPlaybackErrorMessage(error));
      }
      return false;
    }
  }

  /** Sync the PRIMARY slot (the element that shows the active clip). */
  function syncVideo(segment: TimelineSegment | null, frame: number, shouldPlay: boolean): Promise<boolean> {
    return syncSlot(primarySlotRef.current, segment, frame, shouldPlay, true);
  }

  /**
   * Sync the PARTNER slot.  During a blend it plays in lock-step with the
   * primary; otherwise it sits paused on the next clip's first frame so a
   * plain cut can swap slots with zero latency.
   */
  function syncPartner(segment: TimelineSegment | null, frame: number, shouldPlay: boolean): Promise<boolean> {
    if (!videoBRef) return Promise.resolve(false);
    return syncSlot(partnerSlot(), segment, frame, shouldPlay, false);
  }

  // ── pause ─────────────────────────────────────────────────────────────────
  function pausePlayback() {
    videoRef.current?.pause();
    videoBRef?.current?.pause();
    pauseAudio();

    stateRef.current.playbackAnchorFrame = stateRef.current.playheadFrame;
    stateRef.current.playbackStartedAt = null;
    lastRafTimestampRef.current = null; // clear stall-detection history

    if (stateRef.current.isPlaying) {
      stateRef.current.isPlaying = false;
      stateRef.current.setPlaybackPlaying(false);
    }
  }

  // ── stop ──────────────────────────────────────────────────────────────────
  function stopPlayback() {
    pausePlayback();
  }

  // ── start playback ────────────────────────────────────────────────────────
  async function startPlaybackAtFrame(frame: number): Promise<void> {
    const { segments: segs } = stateRef.current;
    const targetVideo = findActiveVideoSegmentAtFrame(segs, frame);

    // Block the scrub effect from racing us: while startingPlaybackRef is true,
    // the scrub effect's sync call is skipped.
    startingPlaybackRef.current = true;

    // Reset anchor; null out timestamp so RAF doesn't run ahead during load/seek
    stateRef.current.playbackAnchorFrame = frame;
    stateRef.current.playbackStartedAt = null;   // ← set AFTER load completes
    stateRef.current.playheadFrame = frame;
    stateRef.current.setPlayheadFrame(frame);

    try {
      // SYNC FIX: video seek FIRST, audio SECOND (sequential).  See git history
      // for the audio/playhead drift analysis behind this ordering.
      await syncVideo(targetVideo, frame, true);

      // Partner: if a blend is in progress at this frame, start it too so the
      // two layers move together from the very first frame.
      const partner = stateRef.current.partnerSegment;
      if (partner && stateRef.current.partnerIsBlending) {
        void syncPartner(partner, frame, true);
      }

      await startAudio(frame);

      // Stamp the RAF clock anchor.  Subtract START_LATENCY_MS so the
      // playhead zero-point aligns with when audio actually starts playing.
      const START_LATENCY_MS = 15; // must match AudioEngine START_LATENCY (0.015 s)
      stateRef.current.playbackStartedAt = performance.now() - START_LATENCY_MS;
      stateRef.current.playbackAnchorFrame = frame;  // anchor stays at start frame
      lastRafTimestampRef.current = null; // reset stall-detection history at play start

      if (!stateRef.current.isPlaying) {
        stateRef.current.isPlaying = true;
        stateRef.current.setPlaybackPlaying(true);
      }
    } finally {
      // Always release the guard so the scrub effect resumes for future scrubs
      startingPlaybackRef.current = false;
    }
  }

  // ── toggle playback ───────────────────────────────────────────────────────
  async function togglePlayback(): Promise<void> {
    if (stateRef.current.isPlaying) {
      pausePlayback();
      return;
    }

    const enabledSegs = getEnabledSegments(stateRef.current.segments);
    if (!enabledSegs.length || stateRef.current.totalFrames <= 0) return;

    let targetFrame = stateRef.current.playheadFrame;
    const hasMediaAtPlayhead =
      findActiveVideoSegmentAtFrame(enabledSegs, targetFrame) !== null ||
      findAllActiveAudioSegments(enabledSegs, targetFrame).length > 0;

    if (targetFrame >= stateRef.current.totalFrames - 1) {
      targetFrame = enabledSegs[0].startFrame;
    } else if (!hasMediaAtPlayhead) {
      const nextSeg = findNextSegmentAtOrAfterFrame(enabledSegs, targetFrame) ?? enabledSegs[0];
      targetFrame = nextSeg.startFrame;
    }

    await startPlaybackAtFrame(targetFrame);
  }

  // ── Immediate video/audio stop when isPlaying changes to false externally ─
  // (e.g. dropping a new clip while playing, or clip removal from the store).
  useEffect(() => {
    if (!isPlaying) {
      for (const video of [videoRef.current, videoBRef?.current ?? null]) {
        if (video && !video.paused) video.pause();
      }
      pauseAudio();
      stateRef.current.playbackStartedAt = null;
      stateRef.current.playbackAnchorFrame = stateRef.current.playheadFrame;
      lastRafTimestampRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  // ── RAF loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying || totalFrames <= 0) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const step = (timestamp: number) => {
      const {
        playbackStartedAt,
        playbackAnchorFrame,
        sequenceFps: fps,
        totalFrames: total,
        activeSegment: seg
      } = stateRef.current;

      // BUG #25 fix: guard against corrupted project with fps=0
      if (!fps || fps <= 0) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      // If playbackStartedAt is null, media is still loading — skip this
      // frame so the playhead doesn't drift forward during load/seek.
      if (playbackStartedAt === null) {
        lastRafTimestampRef.current = timestamp;
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      // ── Stall detection: compensate for RAF gaps caused by fullscreen
      //    transitions, OS-level tab switches, or resize events.
      {
        const prevTs = lastRafTimestampRef.current;
        const oneFrameMs = 1000 / fps;
        if (prevTs !== null && timestamp - prevTs > 200) {
          const stallMs = (timestamp - prevTs) - oneFrameMs;
          stateRef.current.playbackStartedAt = playbackStartedAt + stallMs;
        }
        lastRafTimestampRef.current = timestamp;
      }

      const startedAt = stateRef.current.playbackStartedAt ?? playbackStartedAt;

      const elapsedFrames = ((timestamp - startedAt) / 1000) * fps;
      const nextFrame = Math.min(total - 1, Math.round(playbackAnchorFrame + elapsedFrames));

      if (nextFrame !== stateRef.current.playheadFrame) {
        stateRef.current.playheadFrame = nextFrame;
        stateRef.current.setPlayheadFrame(nextFrame);
      }

      // ── TRIM ENFORCEMENT ──────────────────────────────────────────────────
      // The <video> element plays the raw source and has no concept of the
      // clip's out point.  If the primary overshoots its playable end, pause it.
      const video = primaryEl();
      if (video && seg && !video.paused) {
        const outTime = getPlayableOutTime(stateRef.current.segments, seg, fps);
        if (video.currentTime > outTime + framesToSeconds(1, fps)) {
          video.pause();
        }
      }

      // ── Partner drift correction (during a blend) ─────────────────────────
      // Both elements are free-running; if the partner drifts more than ~3
      // frames from where it should be, nudge it (rare — same clock).
      const partner = stateRef.current.partnerSegment;
      const pEl = partnerEl();
      if (partner && pEl && stateRef.current.partnerIsBlending && !pEl.paused && !pEl.seeking) {
        const want = getTargetTimeWithHandles(stateRef.current.segments, partner, nextFrame, fps);
        if (Math.abs(pEl.currentTime - want) > framesToSeconds(3, fps)) {
          pEl.currentTime = want;
        }
      }

      if (nextFrame >= total - 1) {
        pausePlayback();
        return;
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, totalFrames]);

  // ── active clip change ────────────────────────────────────────────────────
  // When the active clip changes (playing or paused) and the PARTNER slot is
  // already holding that clip, swap roles instead of reloading — that is the
  // whole point of the second element: the seam costs nothing.
  //
  // While playing and no swap is possible we fall back to the historic path:
  // freeze the RAF clock, load/seek the primary, then re-anchor.
  useEffect(() => {
    const frameAtChange = stateRef.current.playheadFrame;

    if (!activeSegment) {
      if (isPlaying) {
        stateRef.current.playbackStartedAt = null;
        void syncVideo(null, frameAtChange, false);
        pausePlayback();
      }
      return;
    }

    // ── Slot swap ───────────────────────────────────────────────────────────
    if (videoBRef) {
      const pSlot = partnerSlot();
      const pSt = slotStateRef.current[pSlot];
      const pEl = slotEl(pSlot);
      if (pEl && pSt.clipId === activeSegment.clip.id && pSt.loadedUrl === activeSegment.asset.previewUrl) {
        const fps = stateRef.current.sequenceFps;
        const want = getTargetTimeWithHandles(stateRef.current.segments, activeSegment, frameAtChange, fps);
        const drift = Math.abs(pEl.currentTime - want);
        swapSlots();
        // The old primary becomes the partner; the partner effect decides what
        // it should hold next.  Make sure the new primary is running.
        pEl.style.visibility = "visible";
        if (isPlaying) {
          if (drift > framesToSeconds(3, fps) || pEl.paused) {
            // Pre-rolled (paused on first frame) — start it now.  A seek is
            // only needed if it is not already at the right spot.
            if (drift > framesToSeconds(2, fps)) pEl.currentTime = want;
            pEl.playbackRate = Math.max(0.25, Math.min(4, activeSegment.clip.speed ?? 1));
            attachTrimGuard(pSlot, pEl, activeSegment);
            void pEl.play().catch(() => {});
          } else {
            attachTrimGuard(pSlot, pEl, activeSegment);
          }
          // Re-anchor so accumulated drift is zeroed out from this frame forward.
          stateRef.current.playbackAnchorFrame = frameAtChange;
          stateRef.current.playbackStartedAt = performance.now();
          lastRafTimestampRef.current = null;
        }
        return;
      }
    }

    if (!isPlaying) return; // scrub effect handles paused loads

    const media = primaryEl();
    const pst = slotStateRef.current[primarySlotRef.current];
    const newUrl = activeSegment.asset.previewUrl;
    const urlChanged = pst.loadedUrl !== newUrl;
    // Same-URL segment change (e.g. split clip seam): if the element is already
    // at the right position keep the RAF clock running — no stutter.
    if (!urlChanged && media) {
      const targetTime = getTargetCurrentTime(activeSegment, frameAtChange, stateRef.current.sequenceFps);
      const timeDrift = Math.abs(media.currentTime - targetTime);
      const twoFrames = framesToSeconds(2, stateRef.current.sequenceFps);
      if (timeDrift < twoFrames && !media.paused) {
        pst.clipId = activeSegment.clip.id;
        attachTrimGuard(primarySlotRef.current, media, activeSegment);
        stateRef.current.playbackAnchorFrame = frameAtChange;
        stateRef.current.playbackStartedAt = performance.now();
        lastRafTimestampRef.current = null;
        return;
      }
    }

    stateRef.current.playbackStartedAt = null;  // freeze RAF during load/seek
    lastRafTimestampRef.current = null;
    void syncVideo(activeSegment, frameAtChange, true).then(() => {
      stateRef.current.playbackAnchorFrame = stateRef.current.playheadFrame;
      stateRef.current.playbackStartedAt = performance.now();
      lastRafTimestampRef.current = null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegment?.clip.id, activeSegment?.asset.previewUrl, activeSegment?.sourceInSeconds, activeSegment?.sourceOutSeconds, isPlaying]);

  // ── sync when NOT playing (scrub / seek) ──────────────────────────────────
  // This is the SOLE loader/seeker for the primary element when not playing.
  useEffect(() => {
    if (isPlaying) return;
    if (startingPlaybackRef.current) return;
    void syncVideo(activeSegment, playheadFrame, false);
    // Audio scrub is handled by useMultiTrackAudio's own effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegment?.clip.id, activeSegment?.asset.previewUrl, activeSegment?.sourceInSeconds, activeSegment?.sourceOutSeconds, isPlaying, playheadFrame]);

  // ── partner slot sync (playing or not) ────────────────────────────────────
  // Keeps the second element holding the right clip at the right time.  While
  // blending it plays (when we play) so both layers advance together; while
  // merely pre-rolled it stays paused on its first frame.
  useEffect(() => {
    if (!videoBRef) return;
    if (startingPlaybackRef.current) return;
    if (!partnerSegment) {
      // Nothing to hold — release the slot only if it is not the primary.
      void syncPartner(null, playheadFrame, false);
      return;
    }
    const pEl = partnerEl();
    if (!pEl) return;
    const st = slotStateRef.current[partnerSlot()];
    const sameClip = st.clipId === partnerSegment.clip.id && st.loadedUrl === partnerSegment.asset.previewUrl;
    const shouldPlay = isPlaying && partnerIsBlending;

    if (sameClip && isPlaying) {
      // Already holding the clip.  Only intervene at state changes:
      if (shouldPlay && pEl.paused) {
        // Blend just started — seek to the exact frame and run.
        void syncPartner(partnerSegment, playheadFrame, true);
      } else if (!shouldPlay && !pEl.paused) {
        pEl.pause();
      }
      return;
    }
    if (sameClip && !isPlaying && !partnerIsBlending) {
      // Paused, pre-rolled — nothing to update.
      return;
    }
    void syncPartner(partnerSegment, playheadFrame, shouldPlay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerSegment?.clip.id, partnerSegment?.asset.previewUrl, partnerSegment?.sourceInSeconds, partnerSegment?.sourceOutSeconds, partnerIsBlending, isPlaying, isPlaying ? 0 : playheadFrame, primarySlot]);

  // ── FIX 4: Immediately apply playback speed change to video element ────────
  useEffect(() => {
    const video = primaryEl();
    const seg = activeSegment;
    if (!video || !seg) return;
    const newRate = Math.max(0.25, Math.min(4, seg.clip.speed ?? 1));
    if (Math.abs(video.playbackRate - newRate) > 0.001) {
      video.playbackRate = newRate;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegment?.clip.speed]);

  // ── cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      detachTrimGuard(0);
      detachTrimGuard(1);
      videoRef.current?.pause();
      videoBRef?.current?.pause();
      stopAudio();
      // Dispose AudioScheduler — releases AudioContext and cached buffers
      schedulerRef.current?.dispose();
      schedulerRef.current = null;
      if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
        void sharedAudioContext.close();
        sharedAudioContext = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { togglePlayback, pausePlayback, stopPlayback, audioEngineRef, primarySlot };
}
