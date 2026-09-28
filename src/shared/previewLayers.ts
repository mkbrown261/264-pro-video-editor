/**
 * previewLayers — what the viewer must draw at a given timeline frame.
 *
 * Uses exactly the same rules as the export compositor (exportGraph):
 * tracks bottom → top, transitions as runs of adjacent clips, the outgoing
 * clip's tail extending under the incoming clip, lone edges transitioning
 * against the layers below. The viewer's GPU compositor consumes this list.
 */

import type { TimelineClip } from "./models.js";
import {
  getClipTransitionDurationFrames,
  interpolateKeyframe,
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
}

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

function layerAt(seg: TimelineSegment, frame: number, fps: number, tail = false): PreviewLayer {
  const srcDur = Math.max(1 / fps, seg.sourceOutSeconds - seg.sourceInSeconds);
  const rate = srcDur / Math.max(1e-6, seg.durationSeconds);
  return {
    key: tail ? `${seg.clip.id}:tail` : seg.clip.id,
    segment: seg,
    sourceTime: seg.sourceInSeconds + ((frame - seg.startFrame) / fps) * rate,
    rate,
    transform: resolveTransform(seg.clip, frame),
  };
}

const unitKind = (clip: TimelineClip): PreviewUnit["kind"] =>
  clip.clipType === "adjustment" ? "adjustment" :
  clip.titleConfig || clip.clipType === "caption" ? "text" : "media";

/**
 * Units to composite at `frame`, ordered bottom → top.
 */
export function computePreviewUnits(segments: TimelineSegment[], frame: number, fps: number): PreviewUnit[] {
  const video = playable(segments, "video");
  const trackIdxs = [...new Set(video.map((s) => s.trackIndex))].sort((a, b) => b - a);
  const units: PreviewUnit[] = [];

  for (const ti of trackIdxs) {
    const track = video.filter((s) => s.trackIndex === ti).sort((a, b) => a.startFrame - b.startFrame);
    // Adjustment layers first (they process what is below this track).
    for (const adj of track) {
      if (adj.clip.clipType !== "adjustment" || frame < adj.startFrame || frame >= adj.endFrame) continue;
      units.push({ trackIndex: ti, kind: "adjustment", from: null, to: layerAt(adj, frame, fps), transition: null });
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
        from: layerAt(prev!, frame, fps, true),
        to: layerAt(cur, frame, fps),
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
        trackIndex: ti, kind, from: null, to: layerAt(cur, frame, fps),
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
        trackIndex: ti, kind, from: layerAt(cur, frame, fps), to: null,
        transition: { name: outName, progress: (frame - (cur.endFrame - outFrames) + 0.5) / outFrames },
      });
      continue;
    }
    units.push({ trackIndex: ti, kind, from: null, to: layerAt(cur, frame, fps), transition: null });
  }
  return units;
}
