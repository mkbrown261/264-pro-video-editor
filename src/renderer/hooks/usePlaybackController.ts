import {
  useEffect,
  useRef,
  type MutableRefObject,
  type RefObject
} from "react";
import {
  findNextSegmentAtOrAfterFrame,
  framesToSeconds,
  type TimelineSegment
} from "../../shared/timeline";
import type { TimelineTrackKind } from "../../shared/models";

interface PlaybackControllerOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
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

function getTargetCurrentTime(
  segment: TimelineSegment,
  playheadFrame: number,
  sequenceFps: number
): number {
  const segmentOffsetFrames = Math.max(0, playheadFrame - segment.startFrame);
  const expectedTime = segment.sourceInSeconds + framesToSeconds(segmentOffsetFrames, sequenceFps);
  return Math.min(
    Math.max(expectedTime, segment.sourceInSeconds),
    Math.max(segment.sourceInSeconds, segment.sourceOutSeconds - framesToSeconds(1, sequenceFps))
  );
}

function getPlaybackErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Playback could not start for this media source.";
}

function getEnabledSegments(segments: TimelineSegment[]): TimelineSegment[] {
  return segments.filter((s) => s.clip.isEnabled);
}

function findActivePlayableSegmentAtFrame(
  segments: TimelineSegment[],
  frame: number,
  trackKind: TimelineTrackKind
): TimelineSegment | null {
  const covering = segments.filter(
    (s) =>
      s.track.kind === trackKind &&
      s.clip.isEnabled &&
      frame >= s.startFrame &&
      frame < s.endFrame
  );
  if (!covering.length) return null;
  return covering.sort((a, b) => b.trackIndex - a.trackIndex)[0];
}

async function loadMediaSource(element: HTMLMediaElement, sourceUrl: string, assetName: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handleLoadedData = () => { cleanup(); resolve(); };
    const handleError = () => { cleanup(); reject(new Error(`Failed to load ${assetName} into playback.`)); };
    const cleanup = () => {
      element.removeEventListener("loadeddata", handleLoadedData);
      element.removeEventListener("error", handleError);
    };
    element.pause();
    element.addEventListener("loadeddata", handleLoadedData, { once: true });
    element.addEventListener("error", handleError, { once: true });
    element.src = sourceUrl;
    element.load();
  });
}

async function seekMediaElement(element: HTMLMediaElement, targetTime: number, sequenceFps: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeoutId = window.setTimeout(() => { cleanup(); resolve(); }, 400);
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

export function usePlaybackController({
  videoRef,
  audioRef,
  activeSegment,
  activeAudioSegment,
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
    activeAudioSegment,
    segments,
    sequenceFps,
    totalFrames,
    setPlayheadFrame,
    setPlaybackPlaying,
    onPlaybackMessage,
    playbackAnchorFrame: playheadFrame,
    playbackStartedAt: null as number | null,
    lastLoadedVideoUrl: null as string | null,
    lastLoadedAudioUrl: null as string | null
  });

  // Keep stateRef in sync with latest props
  useEffect(() => {
    stateRef.current.isPlaying = isPlaying;
    stateRef.current.playheadFrame = playheadFrame;
    stateRef.current.activeSegment = activeSegment;
    stateRef.current.activeAudioSegment = activeAudioSegment;
    stateRef.current.segments = segments;
    stateRef.current.sequenceFps = sequenceFps;
    stateRef.current.totalFrames = totalFrames;
    stateRef.current.setPlayheadFrame = setPlayheadFrame;
    stateRef.current.setPlaybackPlaying = setPlaybackPlaying;
    stateRef.current.onPlaybackMessage = onPlaybackMessage;
  });

  // ── sync media element ─────────────────────────────────────────────────────
  async function syncMedia(
    mediaRef: RefObject<HTMLMediaElement | null>,
    segment: TimelineSegment | null,
    frame: number,
    shouldPlay: boolean,
    lastLoadedUrlRef: MutableRefObject<string | null>
  ): Promise<boolean> {
    const media = mediaRef.current;
    if (!media) return false;

    if (!segment) {
      media.pause();
      return false;
    }

    try {
      const nextUrl = segment.asset.previewUrl;
      const urlChanged = lastLoadedUrlRef.current !== nextUrl;
      const targetTime = getTargetCurrentTime(segment, frame, stateRef.current.sequenceFps);

      if (urlChanged) {
        await loadMediaSource(media, nextUrl, segment.asset.name);
        lastLoadedUrlRef.current = nextUrl;
      }

      const timeDrift = Math.abs(media.currentTime - targetTime);
      if (urlChanged || !shouldPlay || timeDrift > framesToSeconds(2, stateRef.current.sequenceFps)) {
        await seekMediaElement(media, targetTime, stateRef.current.sequenceFps);
      }

      if (shouldPlay) {
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

  const lastLoadedVideoUrlRef = useRef<string | null>(null);
  const lastLoadedAudioUrlRef = useRef<string | null>(null);

  // ── pause ─────────────────────────────────────────────────────────────────
  function pausePlayback() {
    videoRef.current?.pause();
    audioRef.current?.pause();
    stateRef.current.playbackAnchorFrame = stateRef.current.playheadFrame;
    stateRef.current.playbackStartedAt = null;

    if (stateRef.current.isPlaying) {
      stateRef.current.isPlaying = false;
      stateRef.current.setPlaybackPlaying(false);
    }
  }

  // ── stop (same as pause for now) ──────────────────────────────────────────
  function stopPlayback() {
    pausePlayback();
  }

  // ── start playback ────────────────────────────────────────────────────────
  async function startPlaybackAtFrame(frame: number): Promise<void> {
    const { segments: segs, sequenceFps: fps } = stateRef.current;
    const targetVideo = findActivePlayableSegmentAtFrame(segs, frame, "video");
    const targetAudio = findActivePlayableSegmentAtFrame(segs, frame, "audio");

    stateRef.current.playbackAnchorFrame = frame;
    stateRef.current.playbackStartedAt = performance.now();
    stateRef.current.playheadFrame = frame;
    stateRef.current.setPlayheadFrame(frame);

    await Promise.all([
      syncMedia(videoRef, targetVideo, frame, true, lastLoadedVideoUrlRef),
      syncMedia(audioRef, targetAudio, frame, true, lastLoadedAudioUrlRef)
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
      findActivePlayableSegmentAtFrame(enabledSegs, targetFrame, "video") !== null ||
      findActivePlayableSegmentAtFrame(enabledSegs, targetFrame, "audio") !== null;

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
      const { playbackStartedAt, playbackAnchorFrame, sequenceFps: fps, totalFrames: total } = stateRef.current;
      const startedAt = playbackStartedAt ?? timestamp;

      // Update startedAt in ref if it was null
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
  }, [isPlaying, totalFrames]);

  // ── sync when NOT playing (scrub / seek) ──────────────────────────────────
  useEffect(() => {
    if (isPlaying) return;

    void syncMedia(videoRef, activeSegment, playheadFrame, false, lastLoadedVideoUrlRef);

    if (activeAudioSegment) {
      void syncMedia(audioRef, activeAudioSegment, playheadFrame, false, lastLoadedAudioUrlRef);
    } else {
      audioRef.current?.pause();
    }
  }, [
    activeSegment?.clip.id,
    activeAudioSegment?.clip.id,
    isPlaying,
    playheadFrame
  ]);

  // ── sync when PLAYING and segment changes ─────────────────────────────────
  useEffect(() => {
    if (!isPlaying) return;

    void syncMedia(videoRef, activeSegment, playheadFrame, true, lastLoadedVideoUrlRef);
    void syncMedia(audioRef, activeAudioSegment, playheadFrame, true, lastLoadedAudioUrlRef);
  }, [
    activeSegment?.clip.id,
    activeAudioSegment?.clip.id,
    isPlaying
  ]);

  // ── cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      videoRef.current?.pause();
      audioRef.current?.pause();
    };
  }, []);

  return { togglePlayback, pausePlayback, stopPlayback };
}
