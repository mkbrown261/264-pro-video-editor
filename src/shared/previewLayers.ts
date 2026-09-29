/**
 * previewLayers — what the viewer must draw at a given timeline frame.
 *
 * Uses exactly the same rules as the export compositor (exportGraph):
 * tracks bottom → top, transitions as runs of adjacent clips, the outgoing
 * clip's tail extending under the incoming clip, lone edges transitioning
 * against the layers below. The viewer's GPU compositor consumes this list.
 */

import type { ClipMask, Keyframe, TimelineClip } from "./models.js";
import {
  getClipTransitionDurationFrames,
  hasSpeedRamp,
  interpolateKeyframe,
  rampRate,
  rampSourceProgress,
  type TimelineSegment,
} from "./timeline.js";
import { playable, transitionBetween, xfadeName } from "./exportGraph.js";

export interface LayerTransform {
  posX: number; posY: number;
  scaleX: number; scaleY: number;
  rotation: number;
  anchorX: number; anchorY: number;
  opacity: number;
}

export interface PreviewLayer {
  /** Stable key for video-element pooling: clip id (+ ":tail"). */
  key: string;
  segment: TimelineSegment;
  /** Source media time to show, in seconds. */
  sourceTime: number;
  /** Playback rate of the source relative to the timeline. */
  rate: number;
  transform: LayerTransform;
  /** Timeline frame (of this layer's own sequence) the layer was evaluated at. */
  frame: number;
  /** For nested-sequence clips: the inner sequence's units at the matching frame. */
  nested?: PreviewUnit[];
}

/** Resolves a nested clip to its inner sequence's segments (null if missing). */
export type NestedResolver = (clip: TimelineClip) => TimelineSegment[] | null;

export interface PreviewTransition {
  /** xfade transition name (fade, wipeleft, fadeblack, …). */
  name: string;
  /** 0 → only `from` visible, 1 → only `to` visible. */
  progress: number;
}

/** One composited unit: a single layer, or two layers blending through a transition. */
export interface PreviewUnit {
  trackIndex: number;
  kind: "media" | "adjustment" | "text";
  /** Outgoing layer (null = transparent, i.e. the layers below). */
  from: PreviewLayer | null;
  /** Incoming / current layer (null = transparent). */
  to: PreviewLayer | null;
  transition: PreviewTransition | null;
}

export function resolveTransform(clip: TimelineClip, frame: number): LayerTransform {
  const t = clip.transform;
  const kf = clip.keyframes ?? {};
  const pick = (k: keyof NonNullable<TimelineClip["keyframes"]>, fallback: number) => {
    const track = kf[k];
    return track && track.keyframes?.length ? interpolateKeyframe(track, frame) : fallback;
  };
  return {
    posX: pick("posX", t?.posX ?? 0),
    posY: pick("posY", t?.posY ?? 0),
    scaleX: pick("scaleX", t?.scaleX ?? 1),
    scaleY: pick("scaleY", t?.scaleY ?? 1),
    rotation: pick("rotation", t?.rotation ?? 0),
    opacity: Math.min(1, Math.max(0, pick("opacity", t?.opacity ?? 1))),
    anchorX: t?.anchorX ?? 0.5,
    anchorY: t?.anchorY ?? 0.5,
  };
}

function layerAt(seg: TimelineSegment, frame: number, fps: number, tail = false, resolveNested?: NestedResolver, depth = 0): PreviewLayer {
  const srcDur = Math.max(1 / fps, seg.sourceOutSeconds - seg.sourceInSeconds);
  const avgRate = srcDur / Math.max(1e-6, seg.durationSeconds);
  // Middle of the source frame (exact n/fps boundaries can decode the previous frame).
  const halfFrame = 0.5 / Math.max(fps, seg.asset.nativeFps || fps);
  const kfs = seg.clip.speedRampKeyframes;
  let sourceTime: number;
  let rate = avgRate;
  if (kfs && hasSpeedRamp(seg.clip)) {
    const p = (frame - seg.startFrame + 0.5) / Math.max(1, seg.durationFrames);
    sourceTime = seg.sourceInSeconds + srcDur * rampSourceProgress(kfs, p);
    rate = avgRate * rampRate(kfs, p);
  } else {
    sourceTime = seg.sourceInSeconds + ((frame - seg.startFrame) / fps) * avgRate + halfFrame;
  }
  const layer: PreviewLayer = {
    key: tail ? `${seg.clip.id}:tail` : seg.clip.id,
    segment: seg,
    sourceTime,
    rate,
    transform: resolveTransform(seg.clip, frame),
    frame,
  };
  if (seg.clip.nestedSequenceId && resolveNested && depth < 4) {
    const inner = resolveNested(seg.clip);
    if (inner) layer.nested = computePreviewUnits(inner, Math.floor(sourceTime * fps), fps, resolveNested, depth + 1);
  }
  return layer;
}

const unitKind = (clip: TimelineClip): PreviewUnit["kind"] =>
  clip.clipType === "adjustment" ? "adjustment" :
  clip.titleConfig || clip.clipType === "caption" ? "text" : "media";

/**
 * Units to composite at `frame`, ordered bottom → top.
 */
export function computePreviewUnits(
  segments: TimelineSegment[],
  frame: number,
  fps: number,
  resolveNested?: NestedResolver,
  depth = 0,
): PreviewUnit[] {
  const at = (seg: TimelineSegment, f: number, tail = false) => layerAt(seg, f, fps, tail, resolveNested, depth);
  const video = playable(segments, "video");
  const trackIdxs = [...new Set(video.map((s) => s.trackIndex))].sort((a, b) => b - a);
  const units: PreviewUnit[] = [];

  for (const ti of trackIdxs) {
    const track = video.filter((s) => s.trackIndex === ti).sort((a, b) => a.startFrame - b.startFrame);
    // Adjustment layers first (they process what is below this track).
    for (const adj of track) {
      if (adj.clip.clipType !== "adjustment" || frame < adj.startFrame || frame >= adj.endFrame) continue;
      units.push({ trackIndex: ti, kind: "adjustment", from: null, to: at(adj, frame), transition: null });
    }
    const media = track.filter((s) => s.clip.clipType !== "adjustment");
    const i = media.findIndex((s) => frame >= s.startFrame && frame < s.endFrame);
    if (i < 0) continue;
    const cur = media[i];
    const prev = i > 0 ? media[i - 1] : null;
    const next = i < media.length - 1 ? media[i + 1] : null;
    const kind = unitKind(cur.clip);

    // Joined transition from the previous clip (its tail runs under us).
    const join = prev ? transitionBetween(prev, cur) : null;
    if (join && frame < cur.startFrame + join.frames) {
      units.push({
        trackIndex: ti, kind,
        from: at(prev!, frame, true),
        to: at(cur, frame),
        transition: { name: join.name, progress: (frame - cur.startFrame + 0.5) / join.frames },
      });
      continue;
    }
    // Lone incoming edge.
    const joinedIn = !!join;
    const tin = cur.clip.transitionIn;
    const inName = !joinedIn ? xfadeName(tin?.type) : null;
    const inFrames = inName && tin ? getClipTransitionDurationFrames(tin, cur.durationFrames) : 0;
    if (inName && inFrames > 0 && frame < cur.startFrame + inFrames) {
      units.push({
        trackIndex: ti, kind, from: null, to: at(cur, frame),
        transition: { name: inName, progress: (frame - cur.startFrame + 0.5) / inFrames },
      });
      continue;
    }
    // Lone outgoing edge (only when the next clip does not take over the transition).
    const joinedOut = next ? !!transitionBetween(cur, next) : false;
    const tout = cur.clip.transitionOut;
    const outName = !joinedOut ? xfadeName(tout?.type) : null;
    const outFrames = outName && tout ? getClipTransitionDurationFrames(tout, cur.durationFrames) : 0;
    if (outName && outFrames > 0 && frame >= cur.endFrame - outFrames) {
      units.push({
        trackIndex: ti, kind, from: at(cur, frame), to: null,
        transition: { name: outName, progress: (frame - (cur.endFrame - outFrames) + 0.5) / outFrames },
      });
      continue;
    }
    units.push({ trackIndex: ti, kind, from: null, to: at(cur, frame), transition: null });
  }
  return units;
}

// ── Masks at a frame (keyframes + tracking) ───────────────────────────────────

function kfValue(list: Keyframe<number>[] | undefined, frame: number, fallback: number): number {
  if (!list || list.length === 0) return fallback;
  return interpolateKeyframe({ property: "", keyframes: list }, frame);
}

/** A mask with animated properties and tracking offsets resolved at `frame`. */
export function maskAtFrame(mask: ClipMask, frame: number): ClipMask {
  const k = mask.keyframes ?? {};
  const animated = Object.values(k).some((l) => (l?.length ?? 0) > 0);
  const track = mask.trackingEnabled && mask.trackingData?.length ? mask.trackingData : null;
  if (!animated && !track) return mask;
  let dx = 0, dy = 0;
  if (track) {
    const sorted = [...track].sort((a, b) => a.frame - b.frame);
    dx = kfValue(sorted.map((t) => ({ frame: t.frame, value: t.dx })), frame, 0);
    dy = kfValue(sorted.map((t) => ({ frame: t.frame, value: t.dy })), frame, 0);
  }
  const s = mask.shape;
  const x = kfValue(k.x, frame, s.x) + dx;
  const y = kfValue(k.y, frame, s.y) + dy;
  return {
    ...mask,
    feather: kfValue(k.feather, frame, mask.feather),
    opacity: kfValue(k.opacity, frame, mask.opacity),
    expansion: kfValue(k.expansion, frame, mask.expansion),
    shape: {
      ...s,
      x, y,
      width: kfValue(k.width, frame, s.width),
      height: kfValue(k.height, frame, s.height),
      rotation: kfValue(k.rotation, frame, s.rotation),
      points: (dx || dy) && s.points?.length
        ? s.points.map((p) => ({
            point: { x: p.point.x + dx, y: p.point.y + dy },
            handleIn: { x: p.handleIn.x + dx, y: p.handleIn.y + dy },
            handleOut: { x: p.handleOut.x + dx, y: p.handleOut.y + dy },
          }))
        : s.points,
    },
  };
}
