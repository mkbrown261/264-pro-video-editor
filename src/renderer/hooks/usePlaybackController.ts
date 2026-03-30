import {
  useEffect,
  useEffectEvent,
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
  const expectedTime =
    segment.sourceInSeconds + framesToSeconds(segmentOffsetFrames, sequenceFps);

  return Math.min(
    Math.max(expectedTime, segment.sourceInSeconds),
    Math.max(
      segment.sourceInSeconds,
      segment.sourceOutSeconds - framesToSeconds(1, sequenceFps)
    )
  );
}

function getPlaybackErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Playback could not start for this media source.";
}

function getEnabledSegments(segments: TimelineSegment[]): TimelineSegment[] {
  return segments.filter((segment) => segment.clip.isEnabled);
}

function findActivePlayableSegmentAtFrame(
  segments: TimelineSegment[],
  frame: number,
  trackKind: TimelineTrackKind
): TimelineSegment | null {
  const coveringSegments = segments.filter(
    (segment) =>
      segment.track.kind === trackKind &&
      segment.clip.isEnabled &&
      frame >= segment.startFrame &&
      frame < segment.endFrame
  );

  if (!coveringSegments.length) {
    return null;
  }

  return coveringSegments.sort((left, right) => right.trackIndex - left.trackIndex)[0];
}

async function loadMediaSource(
  element: HTMLMediaElement,
  sourceUrl: string,
  assetName: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handleLoadedData = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error(`Failed to load ${assetName} into playback.`));
    };
    const cleanup = () => {
      element.removeEventListener("loadeddata", handleLoadedData);
      element.removeEventListener("error", handleError);
    };

    element.pause();
    element.addEventListener("loadeddata", handleLoadedData, {
      once: true
    });
    element.addEventListener("error", handleError, { once: true });
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
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 350);
    const handleSeeked = () => {
      cleanup();
      resolve();
    };
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
  const playheadRef = useRef(playheadFrame);
  const activeSegmentRef = useRef(activeSegment);
  const activeAudioSegmentRef = useRef(activeAudioSegment);
  const segmentsRef = useRef(segments);
  const isPlayingRef = useRef(isPlaying);
  const playbackAnchorFrameRef = useRef(playheadFrame);
  const playbackStartedAtRef = useRef<number | null>(null);
  const lastLoadedVideoUrlRef = useRef<string | null>(null);
  const lastLoadedAudioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    playheadRef.current = playheadFrame;
  }, [playheadFrame]);

  useEffect(() => {
    activeSegmentRef.current = activeSegment;
  }, [activeSegment]);

  useEffect(() => {
    activeAudioSegmentRef.current = activeAudioSegment;
  }, [activeAudioSegment]);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const reportPlaybackMessage = useEffectEvent((message: string | null) => {
    onPlaybackMessage?.(message);
  });

  const syncMediaElementToSegment = useEffectEvent(
    async (
      mediaRef: RefObject<HTMLMediaElement | null>,
      segment: TimelineSegment | null,
      frame: number,
      shouldPlayAfterSync: boolean,
      lastLoadedSourceUrlRef: MutableRefObject<string | null>
    ) => {
      const media = mediaRef.current;

      if (!media) {
        return false;
      }

      if (!segment) {
        media.pause();
        return false;
      }

      try {
        const nextSourceUrl = segment.asset.previewUrl;
        const sourceChanged = lastLoadedSourceUrlRef.current !== nextSourceUrl;
        const targetTime = getTargetCurrentTime(segment, frame, sequenceFps);

        if (sourceChanged) {
          await loadMediaSource(media, nextSourceUrl, segment.asset.name);
          lastLoadedSourceUrlRef.current = nextSourceUrl;
        }

        if (
          sourceChanged ||
          !shouldPlayAfterSync ||
          Math.abs(media.currentTime - targetTime) > framesToSeconds(1, sequenceFps)
        ) {
          await seekMediaElement(media, targetTime, sequenceFps);
        }

        if (shouldPlayAfterSync) {
          await media.play();
        } else {
          media.pause();
        }

        reportPlaybackMessage(null);
        return true;
      } catch (error) {
        reportPlaybackMessage(getPlaybackErrorMessage(error));
        return false;
      }
    }
  );

  const pausePlayback = useEffectEvent(() => {
    videoRef.current?.pause();
    audioRef.current?.pause();
    playbackAnchorFrameRef.current = playheadRef.current;
    playbackStartedAtRef.current = null;

    if (isPlayingRef.current) {
      isPlayingRef.current = false;
      setPlaybackPlaying(false);
    }
  });

  const startPlaybackAtFrame = useEffectEvent(async (frame: number) => {
    const targetVideoSegment = findActivePlayableSegmentAtFrame(
      segmentsRef.current,
      frame,
      "video"
    );
    const targetAudioSegment = findActivePlayableSegmentAtFrame(
      segmentsRef.current,
      frame,
      "audio"
    );

    playbackAnchorFrameRef.current = frame;
    playbackStartedAtRef.current = performance.now();
    playheadRef.current = frame;
    setPlayheadFrame(frame);

    await Promise.all([
      syncMediaElementToSegment(
        videoRef,
        targetVideoSegment,
        frame,
        true,
        lastLoadedVideoUrlRef
      ),
      syncMediaElementToSegment(
        audioRef,
        targetAudioSegment,
        frame,
        true,
        lastLoadedAudioUrlRef
      )
    ]);

    if (!isPlayingRef.current) {
      isPlayingRef.current = true;
      setPlaybackPlaying(true);
    }
  });

  const togglePlayback = useEffectEvent(async () => {
    if (isPlayingRef.current) {
      pausePlayback();
      return;
    }

    const enabledSegments = getEnabledSegments(segmentsRef.current);

    if (!enabledSegments.length || totalFrames <= 0) {
      return;
    }

    let targetFrame = playheadRef.current;
    const hasMediaAtPlayhead =
      Boolean(activeSegmentRef.current) || Boolean(activeAudioSegmentRef.current);

    if (targetFrame >= totalFrames - 1) {
      const firstSegment = enabledSegments[0];

      targetFrame = firstSegment.startFrame;
    } else if (!hasMediaAtPlayhead) {
      const nextSegment =
        findNextSegmentAtOrAfterFrame(enabledSegments, targetFrame) ??
        enabledSegments[0];

      targetFrame = nextSegment.startFrame;
    }

    await startPlaybackAtFrame(targetFrame);
  });

  const stopPlayback = useEffectEvent(() => {
    pausePlayback();
  });

  useEffect(() => {
    if (isPlaying) {
      return;
    }

    if (activeSegment) {
      void syncMediaElementToSegment(
        videoRef,
        activeSegment,
        playheadFrame,
        false,
        lastLoadedVideoUrlRef
      );
    }

    if (activeAudioSegment) {
      void syncMediaElementToSegment(
        audioRef,
        activeAudioSegment,
        playheadFrame,
        false,
        lastLoadedAudioUrlRef
      );
    } else {
      audioRef.current?.pause();
    }
  }, [
    activeAudioSegment?.clip.id,
    activeSegment?.clip.id,
    isPlaying,
    playheadFrame,
    syncMediaElementToSegment
  ]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    void syncMediaElementToSegment(
      videoRef,
      activeSegment,
      playheadFrame,
      true,
      lastLoadedVideoUrlRef
    );
    void syncMediaElementToSegment(
      audioRef,
      activeAudioSegment,
      playheadFrame,
      true,
      lastLoadedAudioUrlRef
    );
  }, [
    activeAudioSegment?.clip.id,
    activeSegment?.clip.id,
    isPlaying,
    playheadFrame,
    syncMediaElementToSegment
  ]);

  useEffect(() => {
    if (!isPlaying || totalFrames <= 0) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const step = (timestamp: number) => {
      const startedAt = playbackStartedAtRef.current ?? timestamp;
      const elapsedFrames = ((timestamp - startedAt) / 1000) * sequenceFps;
      const nextFrame = Math.min(
        totalFrames - 1,
        Math.round(playbackAnchorFrameRef.current + elapsedFrames)
      );

      if (nextFrame !== playheadRef.current) {
        playheadRef.current = nextFrame;
        setPlayheadFrame(nextFrame);
      }

      if (nextFrame >= totalFrames - 1) {
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
  }, [
    isPlaying,
    pausePlayback,
    sequenceFps,
    setPlayheadFrame,
    totalFrames
  ]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }

      videoRef.current?.pause();
      audioRef.current?.pause();
    };
  }, [audioRef, videoRef]);

  return {
    togglePlayback,
    pausePlayback,
    stopPlayback
  };
}
