import type {
  ClipTransition,
  MediaAsset,
  TimelineClip,
  TimelineSequence,
  TimelineTrack,
  TimelineTrackKind
} from "./models.js";
import { createEmptyClip, createId } from "./models.js";

export interface TimelineSegment {
  clip: TimelineClip;
  track: TimelineTrack;
  trackIndex: number;
  asset: MediaAsset;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  durationSeconds: number;
  sourceInSeconds: number;
  sourceOutSeconds: number;
}

export interface TimelineTrackLayout {
  track: TimelineTrack;
  trackIndex: number;
  segments: TimelineSegment[];
}

export const MIN_CLIP_DURATION_FRAMES = 1;

export function secondsToFrames(seconds: number, fps: number): number {
  return Math.max(0, Math.round(seconds * fps));
}

export function framesToSeconds(frames: number, fps: number): number {
  return fps <= 0 ? 0 : frames / fps;
}

export function normalizeTimelineFps(nativeFps: number): number {
  if (!Number.isFinite(nativeFps) || nativeFps <= 0) {
    return 30;
  }

  return Math.max(24, Math.min(60, Math.round(nativeFps)));
}

export function getAssetDurationFrames(
  asset: MediaAsset,
  timelineFps: number
): number {
  return Math.max(
    MIN_CLIP_DURATION_FRAMES,
    secondsToFrames(asset.durationSeconds, timelineFps)
  );
}

export function getClipDurationFrames(
  clip: TimelineClip,
  asset: MediaAsset,
  timelineFps: number
): number {
  const assetFrames = getAssetDurationFrames(asset, timelineFps);
  const sourceFrames = Math.max(
    MIN_CLIP_DURATION_FRAMES,
    assetFrames - clip.trimStartFrames - clip.trimEndFrames
  );
  // Speed factor: 2x speed means clip occupies half the timeline duration
  const speed = clip.speed ?? 1;
  const clampedSpeed = Math.max(0.25, Math.min(4, speed));
  return Math.max(MIN_CLIP_DURATION_FRAMES, Math.round(sourceFrames / clampedSpeed));
}

export function getClipTransitionDurationFrames(
  transition: ClipTransition | null,
  clipDurationFrames: number
): number {
  if (!transition) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      Math.round(transition.durationFrames),
      Math.max(clipDurationFrames - MIN_CLIP_DURATION_FRAMES, 0)
    )
  );
}

export function getClipEndFrame(
  clip: TimelineClip,
  asset: MediaAsset,
  timelineFps: number
): number {
  return clip.startFrame + getClipDurationFrames(clip, asset, timelineFps);
}

export function buildTimelineSegments(
  sequence: TimelineSequence,
  assets: MediaAsset[]
): TimelineSegment[] {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const tracksById = new Map(
    sequence.tracks.map((track, trackIndex) => [track.id, { track, trackIndex }])
  );

  return sequence.clips
    .flatMap((clip) => {
      const asset = assetsById.get(clip.assetId);
      const trackEntry = tracksById.get(clip.trackId);

      if (!asset || !trackEntry) {
        return [];
      }

      const durationFrames = getClipDurationFrames(
        clip,
        asset,
        sequence.settings.fps
      );
      const sourceInSeconds = framesToSeconds(
        clip.trimStartFrames,
        sequence.settings.fps
      );
      // Source duration is the actual source media consumed, not the timeline duration.
      // At 2x speed, the clip consumes twice as many source frames as timeline frames.
      const clipSpeed = Math.max(0.25, Math.min(4, clip.speed ?? 1));
      const sourceDurationSeconds = framesToSeconds(durationFrames, sequence.settings.fps) * clipSpeed;
      const sourceOutSeconds = Math.min(
        asset.durationSeconds,
        Math.max(
          sourceInSeconds +
            framesToSeconds(MIN_CLIP_DURATION_FRAMES, sequence.settings.fps),
          sourceInSeconds + sourceDurationSeconds
        )
      );

      return [
        {
          clip,
          track: trackEntry.track,
          trackIndex: trackEntry.trackIndex,
          asset,
          startFrame: clip.startFrame,
          endFrame: clip.startFrame + durationFrames,
          durationFrames,
          durationSeconds: framesToSeconds(durationFrames, sequence.settings.fps),
          sourceInSeconds,
          sourceOutSeconds
        }
      ];
    })
    .sort((left, right) => {
      if (left.trackIndex !== right.trackIndex) {
        return left.trackIndex - right.trackIndex;
      }

      if (left.startFrame !== right.startFrame) {
        return left.startFrame - right.startFrame;
      }

      return left.clip.id.localeCompare(right.clip.id);
    });
}

export function buildTrackLayouts(
  sequence: TimelineSequence,
  assets: MediaAsset[],
  prebuiltSegments?: TimelineSegment[]
): TimelineTrackLayout[] {
  const segments = prebuiltSegments ?? buildTimelineSegments(sequence, assets);

  return sequence.tracks.map((track, trackIndex) => ({
    track,
    trackIndex,
    segments: segments.filter((segment) => segment.track.id === track.id)
  }));
}

export function getTotalDurationFrames(segments: TimelineSegment[]): number {
  return segments.reduce(
    (maxFrame, segment) => Math.max(maxFrame, segment.endFrame),
    0
  );
}

export function getTrackEndFrame(
  trackId: string,
  segments: TimelineSegment[]
): number {
  return segments
    .filter((segment) => segment.track.id === trackId)
    .reduce((maxFrame, segment) => Math.max(maxFrame, segment.endFrame), 0);
}

export function findSegmentAtFrame(
  segments: TimelineSegment[],
  playheadFrame: number
): TimelineSegment | null {
  const coveringSegments = segments.filter(
    (segment) =>
      playheadFrame >= segment.startFrame && playheadFrame < segment.endFrame
  );

  if (!coveringSegments.length) {
    return null;
  }

  return coveringSegments.sort((left, right) => {
    if (left.trackIndex !== right.trackIndex) {
      return right.trackIndex - left.trackIndex;
    }

    return right.startFrame - left.startFrame;
  })[0];
}

export function findNextSegmentAtOrAfterFrame(
  segments: TimelineSegment[],
  playheadFrame: number
): TimelineSegment | null {
  const nextSegments = segments
    .filter((segment) => segment.endFrame > playheadFrame)
    .sort((left, right) => {
      if (left.startFrame !== right.startFrame) {
        return left.startFrame - right.startFrame;
      }

      return right.trackIndex - left.trackIndex;
    });

  if (!nextSegments.length) {
    return null;
  }

  const coveringSegment = nextSegments.find(
    (segment) =>
      playheadFrame >= segment.startFrame && playheadFrame < segment.endFrame
  );

  return coveringSegment ?? nextSegments[0];
}

function filterPlayableSegments(
  segments: TimelineSegment[],
  trackKind: TimelineTrackKind
): TimelineSegment[] {
  return segments.filter(
    (segment) => segment.track.kind === trackKind && segment.clip.isEnabled
  );
}

export function findPlayableSegmentAtFrame(
  segments: TimelineSegment[],
  playheadFrame: number,
  trackKind: TimelineTrackKind
): TimelineSegment | null {
  return findSegmentAtFrame(filterPlayableSegments(segments, trackKind), playheadFrame);
}

export function findNextPlayableSegmentAtOrAfterFrame(
  segments: TimelineSegment[],
  playheadFrame: number,
  trackKind: TimelineTrackKind
): TimelineSegment | null {
  return findNextSegmentAtOrAfterFrame(
    filterPlayableSegments(segments, trackKind),
    playheadFrame
  );
}

export function clampTrimStart(
  clip: TimelineClip,
  asset: MediaAsset,
  timelineFps: number,
  nextTrimStartFrames: number
): number {
  const assetFrames = getAssetDurationFrames(asset, timelineFps);
  const maxTrimStart =
    assetFrames - clip.trimEndFrames - MIN_CLIP_DURATION_FRAMES;

  return Math.max(0, Math.min(nextTrimStartFrames, maxTrimStart));
}

export function clampTrimEnd(
  clip: TimelineClip,
  asset: MediaAsset,
  timelineFps: number,
  nextTrimEndFrames: number
): number {
  const assetFrames = getAssetDurationFrames(asset, timelineFps);
  const maxTrimEnd =
    assetFrames - clip.trimStartFrames - MIN_CLIP_DURATION_FRAMES;

  return Math.max(0, Math.min(nextTrimEndFrames, maxTrimEnd));
}

export function splitClipAtPlayhead(
  sequence: TimelineSequence,
  assets: MediaAsset[],
  clipId: string,
  playheadFrame: number
): TimelineSequence {
  return splitClipAtFrame(sequence, assets, clipId, playheadFrame);
}

export function splitClipAtFrame(
  sequence: TimelineSequence,
  assets: MediaAsset[],
  clipId: string,
  splitFrame: number
): TimelineSequence {
  const segments = buildTimelineSegments(sequence, assets);
  const segment = segments.find((candidate) => candidate.clip.id === clipId);

  if (!segment) {
    return sequence;
  }

  if (splitFrame <= segment.startFrame || splitFrame >= segment.endFrame) {
    return sequence;
  }

  const splitOffsetFrames = splitFrame - segment.startFrame;
  const leftDurationFrames = splitOffsetFrames;
  const rightDurationFrames = segment.durationFrames - splitOffsetFrames;

  if (
    leftDurationFrames < MIN_CLIP_DURATION_FRAMES ||
    rightDurationFrames < MIN_CLIP_DURATION_FRAMES
  ) {
    return sequence;
  }

  const nextClips = sequence.clips.flatMap((clip) => {
    if (clip.id !== clipId) {
      return [clip];
    }

    const leftClip: TimelineClip = {
      ...clip,
      trimEndFrames: clip.trimEndFrames + rightDurationFrames,
      transitionOut: null
    };

    const rightClip: TimelineClip = {
      ...clip,
      id: createId(),
      startFrame: splitFrame,
      trimStartFrames: clip.trimStartFrames + leftDurationFrames,
      transitionIn: null
    };

    return [leftClip, rightClip];
  });

  return {
    ...sequence,
    clips: nextClips
  };
}
