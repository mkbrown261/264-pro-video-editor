/**
 * usePlaybackController
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates timeline playback for the ViewerPanel.
 *
 * Video: one <video> element showing the topmost visible clip at the playhead.
 * Audio: delegates to useMultiTrackAudio which keeps N <audio> elements in
 *        a Web Audio graph, one per active audio segment, all mixed together.
 *
 * Rendering hierarchy (video):
 *   Only the highest-trackIndex enabled video segment at the playhead is
 *   shown.  Lower clips are hidden unless transparency/mask allows
 *   see-through (handled by the ViewerPanel canvas layer in a future step).
 */

import {
  useEffect,
  useRef,
  type RefObject,
  type MutableRefObject
} from "react";
import {
  findNextSegmentAtOrAfterFrame,
  framesToSeconds,
  type TimelineSegment
} from "../../shared/timeline";
import type { TimelineTrackKind } from "../../shared/models";
import {
  useMultiTrackAudio,
  findAllActiveAudioSegments
} from "./useMultiTrackAudio";
import type { AudioEngine } from "../lib/AudioScheduler";
import { AudioScheduler } from "../lib/AudioScheduler";

interface PlaybackControllerOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** @deprecated kept for API compatibility — audio is now fully managed by
   *  useMultiTrackAudio internally.  Pass a ref; it will not be used. */
  audioRef: RefObject<HTMLAudioElement | null>;
  activeSegment: TimelineSegment | null;
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

// ── Main hook ─────────────────────────────────────────────────────────────────

export function usePlaybackController({
  videoRef,
  // audioRef is kept for API compatibility but audio is now handled by
  // useMultiTrackAudio internally
  audioRef: _audioRef,
  activeSegment,
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

  // All mutable state tracked via refs to avoid stale closures
  const stateRef = useRef({
    isPlaying,
    playheadFrame,
    activeSegment,
    segments,
    sequenceFps,
    totalFrames,
    setPlayheadFrame,
    setPlaybackPlaying,
    onPlaybackMessage,
    playbackAnchorFrame: playheadFrame,
    playbackStartedAt: null as number | null,
    lastLoadedVideoUrl: null as string | null
  });

  // Keep stateRef in sync with latest props
  useEffect(() => {
    stateRef.current.isPlaying = isPlaying;
    stateRef.current.playheadFrame = playheadFrame;
    stateRef.current.activeSegment = activeSegment;
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

  const lastLoadedVideoUrlRef = useRef<string | null>(null);
  // Guard: prevents two concurrent syncVideo calls from racing each other.
  // Only one sync is allowed at a time; if a new one starts, the old one's
  // results are discarded (via the generation counter below).
  const syncGenerationRef = useRef(0);
  // True while startPlaybackAtFrame is in progress — prevents the scrub effect
  // (which fires when playheadFrame changes) from racing the play-start syncVideo
  // and winning the generation counter, leaving the video paused at the wrong frame.
  const startingPlaybackRef = useRef(false);

  // ── Auto-invalidate lastLoadedVideoUrlRef on external video reset ─────────
  // ViewerPanel may call video.src = x; video.load() to show a media-pool
  // asset when no timeline clip is active.  That resets the element state
  // (currentTime → 0, readyState → 0).  We listen for 'emptied' to detect
  // when the element is reset by an EXTERNAL caller, so the next syncVideo
  // correctly re-loads instead of assuming the URL is still valid.
  //
  // We use a boolean ref that syncVideo sets to true while loadMediaSource
  // is running, so the emptied listener knows to ignore those internal resets.
  const syncVideoLoadingRef = useRef(false);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEmptied = () => {
      // Ignore emptied events triggered by syncVideo's own loadMediaSource call.
      if (syncVideoLoadingRef.current) return;
      // External reset — clear the tracking ref so next syncVideo re-loads.
      lastLoadedVideoUrlRef.current = null;
    };
    video.addEventListener("emptied", onEmptied);
    return () => video.removeEventListener("emptied", onEmptied);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Cleanup handle for the trim-boundary timeupdate listener
  const trimGuardCleanupRef = useRef<(() => void) | null>(null);

  // ── Video lookahead: hidden <video> element that preloads the NEXT clip ──
  // While clip A is playing we load clip B into preloadVideoRef so that when
  // the transition fires, lastLoadedVideoUrlRef already matches and syncVideo
  // can skip loadMediaSource, going straight to seekMediaElement + play().
  const preloadVideoRef = useRef<HTMLVideoElement | null>(null);
  const preloadedUrlRef = useRef<string | null>(null);

  // Lazily create the hidden preload element once
  function getPreloadElement(): HTMLVideoElement {
    if (!preloadVideoRef.current) {
      const el = document.createElement("video");
      el.preload  = "auto";
      el.muted    = true;
      el.playsInline = true;
      el.style.display = "none";
      document.body.appendChild(el);
      preloadVideoRef.current = el;
    }
    return preloadVideoRef.current;
  }

  /** Attach a timeupdate listener that hard-stops the video element the instant
   *  it passes sourceOutSeconds.  Fires every ~250 ms (browser-driven) so we
   *  catch the boundary even when the RAF is frozen during load/seek.
   *
   *  IMPORTANT: we only PAUSE here — we do NOT reset currentTime.  The RAF loop
   *  does the per-frame clamping.  Resetting currentTime inside timeupdate creates
   *  an infinite loop: set → timeupdate fires → set → … causing the video to
   *  loop at the trim point instead of stopping. */
  function attachTrimGuard(media: HTMLVideoElement, seg: TimelineSegment): void {
    // Remove any previous guard first
    trimGuardCleanupRef.current?.();
    trimGuardCleanupRef.current = null;

    const outTime = seg.sourceOutSeconds;
    const inTime  = seg.sourceInSeconds;

    const onTimeUpdate = () => {
      // Past the out-point — pause so the viewer shows the last valid frame.
      // Do NOT set currentTime here; the RAF loop / syncVideo will re-seek
      // when the next segment loads.
      if (media.currentTime > outTime + 0.016) { // 16 ms ≈ 1 frame at 60fps
        media.pause();
      }
      // If something seeks before the in-point, snap back.
      if (media.currentTime < inTime - 0.016) {
        media.currentTime = inTime;
      }
    };

    media.addEventListener("timeupdate", onTimeUpdate);
    trimGuardCleanupRef.current = () => media.removeEventListener("timeupdate", onTimeUpdate);
  }

  function detachTrimGuard(): void {
    trimGuardCleanupRef.current?.();
    trimGuardCleanupRef.current = null;
  }

  // ── sync video element ────────────────────────────────────────────────────
  async function syncVideo(
    segment: TimelineSegment | null,
    frame: number,
    shouldPlay: boolean
  ): Promise<boolean> {
    // Each syncVideo call gets its own generation number.  If a newer call
    // starts before this one finishes, we abort so stale results are never
    // applied to the video element.
    const myGen = ++syncGenerationRef.current;
    const isStale = () => syncGenerationRef.current !== myGen;

    const media = videoRef.current;
    if (!media) return false;

    if (!segment) {
      // No active segment — stop video completely and clear loaded URL so the
      // next segment always triggers a fresh load (prevents stale frame showing).
      detachTrimGuard();
      media.pause();
      if (media.src) {
        media.removeAttribute("src");
        media.load();
        lastLoadedVideoUrlRef.current = null;
      }
      return false;
    }

    try {
      const nextUrl = segment.asset.previewUrl;
      const urlChanged = lastLoadedVideoUrlRef.current !== nextUrl;
      const targetTime = getTargetCurrentTime(segment, frame, stateRef.current.sequenceFps);

      // ── Determine whether a seek is needed BEFORE hiding ─────────────────
      // We compute needsSeek first so we can hide proactively for ALL seeks,
      // not just URL changes.  The root cause of the frame-0 flash on trimmed
      // clips was: same URL → needsHide=false → video stayed visible → browser
      // painted the previously-buffered frame (often frame 0 or wrong position)
      // before seekMediaElement resolved.  Fix: hide whenever ANY seek happens.
      const timeDrift = Math.abs(media.currentTime - targetTime);
      const outOfBounds = media.currentTime > segment.sourceOutSeconds + framesToSeconds(1, stateRef.current.sequenceFps) ||
        media.currentTime < segment.sourceInSeconds - framesToSeconds(1, stateRef.current.sequenceFps);
      const needsSeek = urlChanged || !shouldPlay || outOfBounds ||
        timeDrift > framesToSeconds(2, stateRef.current.sequenceFps);

      // ── Hide video element during ANY load or seek ────────────────────────
      // Hide BEFORE we start any async work so the browser cannot paint a
      // wrong frame between now and when seeked fires.
      // Covers: new URL load (urlChanged), trim-in/out change (same URL, different
      // targetTime), scrub, out-of-bounds recovery, and play-start on any clip.
      if (urlChanged || needsSeek) {
        media.style.visibility = "hidden";
      }

      if (urlChanged) {
        detachTrimGuard();
        // ── Fast path when the lookahead pre-loaded this URL ─────────────
        const preEl = preloadVideoRef.current;
        const wasPreloaded =
          preEl !== null &&
          preloadedUrlRef.current === nextUrl &&
          preEl.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
        if (wasPreloaded) {
          preloadedUrlRef.current = null; // slot is now consumed
        }
        // Set the loading flag so the emptied listener ignores this reset.
        syncVideoLoadingRef.current = true;
        try {
          // loadMediaSource is always called — when the browser cache is warm
          // the canplay event fires in <10 ms, making this effectively instant.
          await loadMediaSource(media, nextUrl, segment.asset.name);
        } finally {
          syncVideoLoadingRef.current = false;
        }
        lastLoadedVideoUrlRef.current = nextUrl;
        if (isStale()) { media.style.visibility = "visible"; return false; }
      }

      if (needsSeek) {
        await seekMediaElement(media, targetTime, stateRef.current.sequenceFps);
        if (isStale()) { media.style.visibility = "visible"; return false; }
      }

      // Load + seek complete — the correct frame is decoded and ready.
      // Restore visibility so the first painted frame is always correct.
      media.style.visibility = "visible";

      if (shouldPlay) {
        const clipSpeed = Math.max(0.25, Math.min(4, segment.clip.speed ?? 1));
        media.playbackRate = clipSpeed;
        // Video element is muted — audio is handled by useMultiTrackAudio
        media.muted = true;
        media.volume = 1;
        // Attach trim guard BEFORE play() so the boundary is enforced from frame 1
        attachTrimGuard(media, segment);
        await media.play();
      } else {
        detachTrimGuard();
        media.pause();
      }

      stateRef.current.onPlaybackMessage?.(null);
      return true;
    } catch (error) {
      // Always restore visibility on error to avoid leaving the viewer blank
      if (videoRef.current) videoRef.current.style.visibility = "visible";
      stateRef.current.onPlaybackMessage?.(getPlaybackErrorMessage(error));
      return false;
    }
  }

  // ── pause ─────────────────────────────────────────────────────────────────
  function pausePlayback() {
    videoRef.current?.pause();
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
    // the scrub effect's syncVideo call is skipped.  This prevents the scrub
    // effect (triggered by setPlayheadFrame below) from winning the generation
    // counter and leaving the video paused instead of playing.
    startingPlaybackRef.current = true;

    // Reset anchor; null out timestamp so RAF doesn't run ahead during load/seek
    stateRef.current.playbackAnchorFrame = frame;
    stateRef.current.playbackStartedAt = null;   // ← set AFTER load completes
    stateRef.current.playheadFrame = frame;
    stateRef.current.setPlayheadFrame(frame);

    try {
      // Load, seek and play video + audio.  This may take a moment
      // (canplay + seeked events).  We MUST NOT start the RAF clock until
      // both are ready, otherwise elapsed time accumulates during load and
      // the playhead jumps forward the moment playback actually begins.
      await Promise.all([
        syncVideo(targetVideo, frame, true),
        startAudio(frame)
      ]);

      // ↓ Stamp the clock AFTER media is loaded & playing — this is the
      //   authoritative zero-point for the RAF loop.
      stateRef.current.playbackStartedAt = performance.now();
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
  // This fires synchronously on the React render cycle, ensuring both the
  // video element and all audio slots are silenced before the next effects run.
  useEffect(() => {
    if (!isPlaying) {
      // Pause the video element right away — don't wait for syncVideo effect
      const video = videoRef.current;
      if (video && !video.paused) {
        video.pause();
      }
      // Pause all audio slots immediately (same as pausePlayback, but driven
      // by external store change rather than user action)
      pauseAudio();
      // Reset RAF anchor so next play starts from the correct position
      stateRef.current.playbackStartedAt = null;
      stateRef.current.playbackAnchorFrame = stateRef.current.playheadFrame;
      lastRafTimestampRef.current = null; // clear stall-detection history
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

      // BUG #25 fix: guard against corrupted project with fps=0 which would
      // produce Infinity/NaN in framesToSeconds and elapsedFrames calculations.
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
      //    When the browser freezes the RAF loop (e.g. during a fullscreen
      //    animation) the next frame arrives with a large timestamp gap.
      //    Without compensation, elapsedFrames shoots way ahead and the
      //    playhead jumps forward, desyncing audio from video.
      //
      //    Heuristic: any gap > 200 ms between consecutive RAF frames is
      //    treated as a stall.  We shift playbackStartedAt forward by the
      //    stall duration (minus one normal frame interval) so the elapsed
      //    time calculation stays accurate.
      {
        const prevTs = lastRafTimestampRef.current;
        const oneFrameMs = 1000 / fps;
        if (prevTs !== null && timestamp - prevTs > 200) {
          // Stall detected: amount of "lost" time beyond a normal frame gap
          const stallMs = (timestamp - prevTs) - oneFrameMs;
          stateRef.current.playbackStartedAt = playbackStartedAt + stallMs;
        }
        lastRafTimestampRef.current = timestamp;
      }

      // Re-read playbackStartedAt in case stall detection adjusted it above
      const startedAt = stateRef.current.playbackStartedAt ?? playbackStartedAt;

      const elapsedFrames = ((timestamp - startedAt) / 1000) * fps;
      const nextFrame = Math.min(total - 1, Math.round(playbackAnchorFrame + elapsedFrames));

      if (nextFrame !== stateRef.current.playheadFrame) {
        stateRef.current.playheadFrame = nextFrame;
        stateRef.current.setPlayheadFrame(nextFrame);
      }

      // ── TRIM ENFORCEMENT ──────────────────────────────────────────────────
      // The HTML <video> element plays the raw source file and has no concept
      // of trimStartFrames/trimEndFrames.  If it overshoots the trim end:
      //   • Pause it so no new frames are decoded/rendered past the cut.
      //   • Do NOT reset currentTime here — that causes a loop (reset→play
      //     past end→reset→…).  The next syncVideo call will seek correctly.
      const video = videoRef.current;
      if (video && seg && !video.paused) {
        const outTime = seg.sourceOutSeconds;
        if (video.currentTime > outTime + framesToSeconds(1, fps)) {
          video.pause();
        }
      }

      // ── VIDEO LOOKAHEAD PREFETCH ──────────────────────────────────────────
      // When playing, look ahead LOOKAHEAD_FRAMES for the next video clip with
      // a DIFFERENT source URL and start loading it into the hidden preload
      // element.  This eliminates the canplay wait in syncVideo when the seam
      // arrives, turning it into a near-instant seek + play swap.
      if (seg) {
        const VIDEO_LOOKAHEAD_FRAMES = 90; // ~3 s at 30 fps
        const lookaheadFrame = nextFrame + VIDEO_LOOKAHEAD_FRAMES;
        const segs = stateRef.current.segments;
        // Find the next video segment that starts within the lookahead window
        // and has a different source URL than the current clip.
        const upcomingSeg = segs.find(
          (s) =>
            s.track.kind === "video" &&
            s.clip.isEnabled &&
            !s.track.muted &&
            s.startFrame > nextFrame &&
            s.startFrame <= lookaheadFrame &&
            s.asset.previewUrl !== seg.asset.previewUrl
        );
        if (upcomingSeg) {
          const nextUrl = upcomingSeg.asset.previewUrl;
          if (nextUrl && preloadedUrlRef.current !== nextUrl) {
            preloadedUrlRef.current = nextUrl;
            const preEl = getPreloadElement();
            if (preEl.src !== nextUrl) {
              preEl.src = nextUrl;
              preEl.load();
              // Once enough data is buffered, seek the preload element to the
              // clip's in-point so the decode pipeline is warm at exactly the
              // right position.  This makes the subsequent seek on the main
              // element near-instant (browser serves from decode cache).
              preEl.addEventListener("canplay", () => {
                if (preEl.src === nextUrl) {
                  preEl.currentTime = upcomingSeg.sourceInSeconds;
                }
              }, { once: true });
            }
          }
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

  // ── sync when NOT playing (scrub / seek) ──────────────────────────────────
  // This is the SOLE loader/seeker for the video element when not playing.
  // It fires whenever: playhead moves (scrub), active clip changes, trim
  // changes (sourceInSeconds/sourceOutSeconds), or asset URL changes.
  // The generation counter inside syncVideo ensures concurrent calls from
  // rapid scrubbing don't produce stale seeks that overwrite the latest frame.
  useEffect(() => {
    if (isPlaying) return;
    // Skip if startPlaybackAtFrame is in progress — the play-start syncVideo
    // owns the generation counter during startup and must not be interrupted
    // by this effect firing when playheadFrame is updated by setPlayheadFrame.
    if (startingPlaybackRef.current) return;
    void syncVideo(activeSegment, playheadFrame, false);
    // Audio scrub is handled by useMultiTrackAudio's own effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegment?.clip.id, activeSegment?.asset.previewUrl, activeSegment?.sourceInSeconds, activeSegment?.sourceOutSeconds, isPlaying, playheadFrame]);

  // ── FIX 4: Immediately apply playback speed change to video element ────────
  // When clip speed changes while playing, update playbackRate in-place
  // without seeking (no stutter, instant feedback).
  useEffect(() => {
    const video = videoRef.current;
    const seg = activeSegment;
    if (!video || !seg) return;
    const newRate = Math.max(0.25, Math.min(4, seg.clip.speed ?? 1));
    if (Math.abs(video.playbackRate - newRate) > 0.001) {
      video.playbackRate = newRate;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegment?.clip.speed]);

  // ── sync when PLAYING and video segment changes ───────────────────────────
  // When the active clip changes mid-play (different clip.id OR url changed due
  // to track-switch OR trim point changed) we need to reload/seek the video element.
  // Also handles the case where the active segment disappears (clip removed from timeline):
  // in that case activeSegment is null and syncVideo will clear the video element.
  useEffect(() => {
    if (!isPlaying) return;
    const frameAtChange = stateRef.current.playheadFrame;
    if (!activeSegment) {
      // Clip was removed from timeline while playing — stop everything cleanly
      stateRef.current.playbackStartedAt = null;
      void syncVideo(null, frameAtChange, false);
      pausePlayback();
      return;
    }

    const media = videoRef.current;
    const newUrl = activeSegment.asset.previewUrl;
    const urlChanged = lastLoadedVideoUrlRef.current !== newUrl;
    // For same-URL segment changes (e.g. split clip seam), check if the video
    // is already at the right position. If drift < 2 frames, skip the
    // playbackStartedAt freeze entirely — the RAF keeps running uninterrupted,
    // which eliminates the 1-3 frame video stutter at split seams.
    if (!urlChanged && media) {
      const targetTime = getTargetCurrentTime(activeSegment, frameAtChange, stateRef.current.sequenceFps);
      const timeDrift = Math.abs(media.currentTime - targetTime);
      const twoFrames = framesToSeconds(2, stateRef.current.sequenceFps);
      if (timeDrift < twoFrames && !media.paused) {
        // Video is already playing at the right position — just update the
        // trim guard for the new segment and keep the RAF clock running.
        attachTrimGuard(media, activeSegment);
        // Re-anchor so accumulated drift is zeroed out from this frame forward.
        stateRef.current.playbackAnchorFrame = frameAtChange;
        stateRef.current.playbackStartedAt = performance.now();
        lastRafTimestampRef.current = null; // reset stall history after re-anchor
        return;
      }
    }

    stateRef.current.playbackStartedAt = null;  // freeze RAF during load/seek
    lastRafTimestampRef.current = null; // reset stall history during freeze
    void syncVideo(activeSegment, frameAtChange, true).then(() => {
      // Re-anchor from the frame we were at when the segment changed
      stateRef.current.playbackAnchorFrame = stateRef.current.playheadFrame;
      stateRef.current.playbackStartedAt = performance.now();
      lastRafTimestampRef.current = null; // start fresh after re-anchor
    });
    // Audio segment changes are handled by useMultiTrackAudio
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegment?.clip.id, activeSegment?.asset.previewUrl, activeSegment?.sourceInSeconds, activeSegment?.sourceOutSeconds, isPlaying]);

  // NOTE: The separate "preload on mount" effect that previously lived here
  // was removed.  The scrub effect at line ~602 already handles load + seek
  // whenever activeSegment appears or playheadFrame changes while not playing.
  // Having two concurrent loaders caused a race where they both called
  // loadMediaSource on the same element, the second call canceling the first
  // and leaving the video at currentTime=0 (source frame 0) instead of the
  // correct trim in-point.

  // ── cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      detachTrimGuard();
      videoRef.current?.pause();
      stopAudio();
      // Dispose AudioScheduler — releases AudioContext and cached buffers
      schedulerRef.current?.dispose();
      schedulerRef.current = null;
      // Clean up hidden preload element
      const preEl = preloadVideoRef.current;
      if (preEl) {
        preEl.pause();
        preEl.src = "";
        preEl.load();
        preEl.parentNode?.removeChild(preEl);
        preloadVideoRef.current = null;
        preloadedUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { togglePlayback, pausePlayback, stopPlayback, audioEngineRef };
}
