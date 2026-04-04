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
  type RefObject
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
}

// ── helpers ───────────────────────────────────────────────────────────────────

function getTargetCurrentTime(
  segment: TimelineSegment,
  playheadFrame: number,
  sequenceFps: number
): number {
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

function applyGain(media: HTMLMediaElement, volume: number): void {
  try {
    let entry = gainNodeMap.get(media);
    if (!entry) {
      const ctx  = new AudioContext();
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
    const timeoutId = window.setTimeout(() => { cleanup(); resolve(); }, 2000);
    const handleSeeked = () => { cleanup(); resolve(); };
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      element.removeEventListener("seeked", handleSeeked);
    };
    element.addEventListener("seeked", handleSeeked, { once: true });
    element.currentTime = targetTime;
    if (Math.abs(element.currentTime - targetTime) < framesToSeconds(1, sequenceFps)) {
      cleanup();
      resolve();
    }
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

  const { startAudio, stopAudio, pauseAudio } = useMultiTrackAudio({
    activeAudioSegments,
    allSegments: segments,   // pass ALL segments for lookahead prefetch
    isPlaying,
    playheadFrame,
    sequenceFps
  });

  const lastLoadedVideoUrlRef = useRef<string | null>(null);
  // Cleanup handle for the trim-boundary timeupdate listener
  const trimGuardCleanupRef = useRef<(() => void) | null>(null);

  /** Attach a timeupdate listener that hard-stops the video element the instant
   *  it passes sourceOutSeconds.  This is the authoritative trim-end enforcer —
   *  the RAF loop does a coarser correction, but timeupdate fires every ~250 ms
   *  at native resolution and catches the boundary precisely. */
  function attachTrimGuard(media: HTMLVideoElement, seg: TimelineSegment): void {
    // Remove any previous guard first
    trimGuardCleanupRef.current?.();
    trimGuardCleanupRef.current = null;

    const outTime = seg.sourceOutSeconds;
    const inTime  = seg.sourceInSeconds;

    const onTimeUpdate = () => {
      // If the element runs past the out-point, park it exactly there.
      if (media.currentTime > outTime + 0.016) { // 16 ms ≈ 1 frame at 60fps
        media.currentTime = outTime;
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

      if (urlChanged) {
        detachTrimGuard();
        await loadMediaSource(media, nextUrl, segment.asset.name);
        lastLoadedVideoUrlRef.current = nextUrl;
      }

      // Always seek when:
      //   - URL just changed (new clip loaded)
      //   - Not playing (scrub / trim preview — always snap to exact position)
      //   - Drift exceeds 2 frames while playing (clock correction)
      const timeDrift = Math.abs(media.currentTime - targetTime);
      const needsSeek = urlChanged || !shouldPlay ||
        timeDrift > framesToSeconds(2, stateRef.current.sequenceFps);
      if (needsSeek) {
        await seekMediaElement(media, targetTime, stateRef.current.sequenceFps);
      }

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

    // Reset anchor; null out timestamp so RAF doesn't run ahead during load/seek
    stateRef.current.playbackAnchorFrame = frame;
    stateRef.current.playbackStartedAt = null;   // ← set AFTER load completes
    stateRef.current.playheadFrame = frame;
    stateRef.current.setPlayheadFrame(frame);

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

    if (!stateRef.current.isPlaying) {
      stateRef.current.isPlaying = true;
      stateRef.current.setPlaybackPlaying(true);
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

      // If playbackStartedAt is null, media is still loading — skip this
      // frame so the playhead doesn't drift forward during load/seek.
      if (playbackStartedAt === null) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      const startedAt = playbackStartedAt;

      const elapsedFrames = ((timestamp - startedAt) / 1000) * fps;
      const nextFrame = Math.min(total - 1, Math.round(playbackAnchorFrame + elapsedFrames));

      if (nextFrame !== stateRef.current.playheadFrame) {
        stateRef.current.playheadFrame = nextFrame;
        stateRef.current.setPlayheadFrame(nextFrame);
      }

      // ── TRIM ENFORCEMENT ──────────────────────────────────────────────────
      // The HTML <video> element plays the raw source file and has no concept
      // of trimStartFrames/trimEndFrames.  If the clip has a trim-end, the
      // element will keep rendering frames past sourceOutSeconds even though
      // the playhead (driven by wall clock) has already moved on.  Clamp it.
      const video = videoRef.current;
      if (video && seg && !video.paused) {
        const outTime = seg.sourceOutSeconds;
        if (video.currentTime > outTime + framesToSeconds(1, fps)) {
          // Overshot the trim end — hard-park the frame at the out-point so
          // the viewer doesn't flash source frames past the cut.
          video.currentTime = outTime;
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
  // Dependencies include sourceInSeconds so trim changes re-seek immediately.
  useEffect(() => {
    if (isPlaying) return;
    void syncVideo(activeSegment, playheadFrame, false);
    // Audio scrub is handled by useMultiTrackAudio's own effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegment?.clip.id, activeSegment?.sourceInSeconds, activeSegment?.sourceOutSeconds, isPlaying, playheadFrame]);

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
    stateRef.current.playbackStartedAt = null;  // freeze RAF during load
    if (!activeSegment) {
      // Clip was removed from timeline while playing — stop everything cleanly
      void syncVideo(null, frameAtChange, false);
      pausePlayback();
      return;
    }
    void syncVideo(activeSegment, frameAtChange, true).then(() => {
      // Re-anchor from the frame we were at when the segment changed
      stateRef.current.playbackAnchorFrame = stateRef.current.playheadFrame;
      stateRef.current.playbackStartedAt = performance.now();
    });
    // Audio segment changes are handled by useMultiTrackAudio
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegment?.clip.id, activeSegment?.asset.previewUrl, activeSegment?.sourceInSeconds, activeSegment?.sourceOutSeconds, isPlaying]);

  // ── Preload on mount / when activeSegment first becomes non-null ──────────
  // Silently loads the video src so the browser decode pipeline is warm
  // before the user hits Play, eliminating the first-play freeze.
  // After load we also seek to the correct trim position so the first frame
  // shown is the in-point of the clip, not frame 0 of the raw asset.
  useEffect(() => {
    if (isPlaying) return;
    if (!activeSegment) return;
    const video = videoRef.current;
    if (!video) return;
    if (lastLoadedVideoUrlRef.current === activeSegment.asset.previewUrl) {
      // URL already loaded — but seek to correct trim position in case
      // trim was adjusted since the last load (handles Bug 3: trim ignored)
      const seg = activeSegment;
      const frame = stateRef.current.playheadFrame;
      const targetTime = getTargetCurrentTime(seg, frame, stateRef.current.sequenceFps);
      void seekMediaElement(video, targetTime, stateRef.current.sequenceFps);
      return;
    }
    // Fire-and-forget: load the src decoded, then seek to in-point
    const seg = activeSegment;
    const frame = stateRef.current.playheadFrame;
    void loadMediaSource(video, seg.asset.previewUrl, seg.asset.name)
      .then(async () => {
        lastLoadedVideoUrlRef.current = seg.asset.previewUrl;
        // Seek to the correct in-point after load so viewer shows the right frame
        const targetTime = getTargetCurrentTime(seg, frame, stateRef.current.sequenceFps);
        await seekMediaElement(video, targetTime, stateRef.current.sequenceFps);
      })
      .catch(() => { /* ignore silent preload errors */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegment?.asset.previewUrl, activeSegment?.sourceInSeconds, isPlaying]);

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { togglePlayback, pausePlayback, stopPlayback };
}
