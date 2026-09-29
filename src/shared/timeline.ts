import type {
  ClipTransition,
  KeyframeTrack,
  MediaAsset,
  TimelineClip,
  TimelineSequence,
  TimelineTrack,
  TimelineTrackKind
} from "./models.js";
import { createEmptyClip, createId } from "./models.js";

/**
 * interpolateKeyframe
 * ─────────────────────────────────────────────────────────────────────────────
 * Linear interpolation between keyframes on a numeric track.
 * - Before the first keyframe → returns the first value.
 * - After the last keyframe  → returns the last value.
 * - Between two keyframes    → linear lerp.
 */
export function interpolateKeyframe(
  track: KeyframeTrack<number>,
  frame: number
): number {
  const kfs = track.keyframes;
  if (!kfs || kfs.length === 0) return 0;
  if (kfs.length === 1) return kfs[0].value;

  // Sort by frame (defensive – callers may not guarantee order)
  const sorted = [...kfs].sort((a, b) => a.frame - b.frame);

  if (frame <= sorted[0].frame) return sorted[0].value;
  if (frame >= sorted[sorted.length - 1].frame) return sorted[sorted.length - 1].value;

  // Find the surrounding pair
  let lo = sorted[0];
  let hi = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].frame <= frame && sorted[i + 1].frame >= frame) {
      lo = sorted[i];
      hi = sorted[i + 1];
      break;
    }
  }

  const range = hi.frame - lo.frame;
  if (range <= 0) return lo.value;
  const t = (frame - lo.frame) / range;
  return lo.value + t * (hi.value - lo.value);
}

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
    // Lowest trackIndex = topmost visual row = highest priority
    if (left.trackIndex !== right.trackIndex) {
      return left.trackIndex - right.trackIndex;
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
  const kindSegments = segments.filter(
    (segment) => segment.track.kind === trackKind && segment.clip.isEnabled && !segment.track.muted
  );
  // Solo: if any track of this kind has solo=true, only play those solo tracks
  const hasSolo = kindSegments.some((s) => s.track.solo);
  if (hasSolo) {
    return kindSegments.filter((s) => s.track.solo);
  }
  return kindSegments;
}

export function findPlayableSegmentAtFrame(
  segments: TimelineSegment[],
  playheadFrame: number,
  trackKind: TimelineTrackKind
): TimelineSegment | null {
  return findSegmentAtFrame(filterPlayableSegments(segments, trackKind), playheadFrame);
}

/**
 * findAllActiveVideoSegments
 * ─────────────────────────────────────────────────────────────────────────────
 * Returns ALL enabled, non-muted video segments that overlap the current
 * playhead — sorted by trackIndex descending (highest priority first).
 *
 * Used by the hierarchical rendering engine:
 *   - segments[0] = topmost clip (rendered on the visible video element)
 *   - segments[1..n] = lower clips (rendered as composited layers, visible
 *     only through opacity < 1 / masks / alpha on the clip above them)
 *
 * Solo semantics match filterPlayableSegments.
 */
export function findAllActiveVideoSegments(
  segments: TimelineSegment[],
  playheadFrame: number
): TimelineSegment[] {
  const playable = filterPlayableSegments(segments, "video");
  const covering = playable.filter(
    (s) => playheadFrame >= s.startFrame && playheadFrame < s.endFrame
  );
  // Sort LOWEST trackIndex first — track index 0 is the topmost visual row
  // in the timeline panel (rendered first by trackLayouts.map()), so it has
  // the highest playback priority.  Higher-numbered tracks are below it visually.
  return covering.sort((a, b) => {
    if (a.trackIndex !== b.trackIndex) return a.trackIndex - b.trackIndex;
    return b.startFrame - a.startFrame;
  });
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

// ── Speed ramps (time remap) ──────────────────────────────────────────────────
// Keyframes are {frame, speed} on a 0–SPEED_RAMP_SPAN scale spanning the whole
// clip (the Inspector's ramp editor). The clip keeps its in/out points and
// timeline length; the ramp redistributes source time inside it, so the speed
// at each point is proportional to the curve.

export const SPEED_RAMP_SPAN = 300;

function rampPoints(kfs: Array<{ frame: number; speed: number }>): Array<[number, number]> {
  const span = Math.max(SPEED_RAMP_SPAN, ...kfs.map((k) => k.frame));
  const pts = [...kfs]
    .sort((a, b) => a.frame - b.frame)
    .map((k) => [Math.min(1, Math.max(0, k.frame / span)), Math.max(0.01, k.speed)] as [number, number]);
  if (pts[0][0] > 0) pts.unshift([0, pts[0][1]]);
  if (pts[pts.length - 1][0] < 1) pts.push([1, pts[pts.length - 1][1]]);
  return pts;
}

/** ∫₀ᵖ speed(u) du for the piecewise-linear ramp. */
function rampIntegral(pts: Array<[number, number]>, p: number): number {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [u0, s0] = pts[i];
    const [u1, s1] = pts[i + 1];
    if (p <= u0) break;
    const end = Math.min(p, u1);
    const span = u1 - u0 || 1;
    const sEnd = s0 + ((end - u0) / span) * (s1 - s0);
    acc += ((s0 + sEnd) / 2) * (end - u0);
  }
  return acc;
}

export function hasSpeedRamp(clip: TimelineClip): boolean {
  return (clip.speedRampKeyframes?.length ?? 0) >= 2;
}

/**
 * Source progress (0–1 of the clip's source range) at clip progress p (0–1).
 * Beyond the clip (transition tails) it continues at the end speed.
 */
export function rampSourceProgress(kfs: Array<{ frame: number; speed: number }>, p: number): number {
  if (kfs.length < 2) return p;
  const pts = rampPoints(kfs);
  const total = rampIntegral(pts, 1) || 1;
  if (p <= 0) return (p * pts[0][1]) / total;
  if (p >= 1) return 1 + ((p - 1) * pts[pts.length - 1][1]) / total;
  return rampIntegral(pts, p) / total;
}

/** Instantaneous source-rate multiplier (relative to the clip's average rate). */
export function rampRate(kfs: Array<{ frame: number; speed: number }>, p: number): number {
  if (kfs.length < 2) return 1;
  const pts = rampPoints(kfs);
  const total = rampIntegral(pts, 1) || 1;
  const q = Math.min(1, Math.max(0, p));
  for (let i = 0; i < pts.length - 1; i++) {
    const [u0, s0] = pts[i];
    const [u1, s1] = pts[i + 1];
    if (q >= u0 && q <= u1) return (s0 + ((q - u0) / ((u1 - u0) || 1)) * (s1 - s0)) / total;
  }
  return pts[pts.length - 1][1] / total;
}
