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
  // Highest trackIndex wins (V3 > V2 > V1 rendering hierarchy)
  return covering.sort((a, b) => b.trackIndex - a.trackIndex)[0];
}

async function loadMediaSource(
  element: HTMLMediaElement,
  sourceUrl: string,
  assetName: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handleCanPlay = () => { cleanup(); resolve(); };
    const handleError   = () => { cleanup(); reject(new Error(`Failed to load ${assetName} into playback.`)); };
    const cleanup = () => {
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

  // ── Multi-track audio engine ───────────────────────────────────────────────
  // Compute all active audio segments (across ALL tracks) at the current frame
  const activeAudioSegments = findAllActiveAudioSegments(segments, playheadFrame);

  const { startAudio, stopAudio, pauseAudio } = useMultiTrackAudio({
    activeAudioSegments,
    isPlaying,
    playheadFrame,
    sequenceFps
  });

  const lastLoadedVideoUrlRef = useRef<string | null>(null);

  // ── sync video element ────────────────────────────────────────────────────
  async function syncVideo(
    segment: TimelineSegment | null,
    frame: number,
    shouldPlay: boolean
  ): Promise<boolean> {
    const media = videoRef.current;
    if (!media) return false;

    if (!segment) {
      media.pause();
      return false;
    }

    try {
      const nextUrl = segment.asset.previewUrl;
      const urlChanged = lastLoadedVideoUrlRef.current !== nextUrl;
      const targetTime = getTargetCurrentTime(segment, frame, stateRef.current.sequenceFps);

      if (urlChanged) {
        await loadMediaSource(media, nextUrl, segment.asset.name);
        lastLoadedVideoUrlRef.current = nextUrl;
      }

      const timeDrift = Math.abs(media.currentTime - targetTime);
      if (urlChanged || !shouldPlay || timeDrift > framesToSeconds(2, stateRef.current.sequenceFps)) {
        await seekMediaElement(media, targetTime, stateRef.current.sequenceFps);
      }

      if (shouldPlay) {
        const clipSpeed = Math.max(0.25, Math.min(4, segment.clip.speed ?? 1));
        media.playbackRate = clipSpeed;
        // Video element is muted — audio is handled by useMultiTrackAudio
        media.muted = true;
        media.volume = 1;
        await media.play();
      } else {
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
    const { segments: segs, sequenceFps: fps } = stateRef.current;
    const targetVideo = findActiveVideoSegmentAtFrame(segs, frame);

    stateRef.current.playbackAnchorFrame = frame;
    stateRef.current.playbackStartedAt = performance.now();
    stateRef.current.playheadFrame = frame;
    stateRef.current.setPlayheadFrame(frame);

    // Start video and audio concurrently
    await Promise.all([
      syncVideo(targetVideo, frame, true),
      startAudio(frame)
    ]);

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
        totalFrames: total
      } = stateRef.current;

      const startedAt = playbackStartedAt ?? timestamp;
      if (!stateRef.current.playbackStartedAt) {
        stateRef.current.playbackStartedAt = timestamp;
      }

      const elapsedFrames = ((timestamp - startedAt) / 1000) * fps;
      const nextFrame = Math.min(total - 1, Math.round(playbackAnchorFrame + elapsedFrames));

      if (nextFrame !== stateRef.current.playheadFrame) {
        stateRef.current.playheadFrame = nextFrame;
        stateRef.current.setPlayheadFrame(nextFrame);
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
  useEffect(() => {
    if (isPlaying) return;
    void syncVideo(activeSegment, playheadFrame, false);
    // Audio scrub is handled by useMultiTrackAudio's own effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegment?.clip.id, isPlaying, playheadFrame]);

  // ── sync when PLAYING and video segment changes ───────────────────────────
  useEffect(() => {
    if (!isPlaying) return;
    void syncVideo(activeSegment, playheadFrame, true);
    // Audio segment changes are handled by useMultiTrackAudio
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegment?.clip.id, isPlaying]);

  // ── cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      videoRef.current?.pause();
      stopAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { togglePlayback, pausePlayback, stopPlayback };
}
