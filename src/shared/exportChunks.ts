/**
 * exportChunks — split long timelines into independently renderable ranges.
 *
 * One FFmpeg graph opens one input per clip, which falls over with hundreds of
 * clips. Long timelines are rendered as chunks (each a small graph over a
 * sliced project) and joined losslessly. Chunk boundaries are only placed where
 * cutting is invisible: never inside a transition, a speed-ramped clip or a
 * title (whose animation depends on the whole clip).
 */

import type { ClipMask, ColorGrade, EditorProject, Keyframe, KeyframeTrack, TimelineClip } from "./models.js";
import {
  buildTimelineSegments,
  getAssetDurationFrames,
  getClipTransitionDurationFrames,
  hasSpeedRamp,
  type TimelineSegment,
} from "./timeline.js";
import { transitionBetween, xfadeName } from "./exportGraph.js";

export interface ExportChunk {
  startFrame: number;
  endFrame: number;
}

/** Frames where a cut would be visible (half-open intervals, cut at f is invalid when a < f < b). */
function blockedIntervals(segs: TimelineSegment[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const byTrack = new Map<number, TimelineSegment[]>();
  for (const s of segs) {
    const l = byTrack.get(s.trackIndex) ?? [];
    l.push(s);
    byTrack.set(s.trackIndex, l);
  }
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.startFrame - b.startFrame);
    list.forEach((s, i) => {
      if (hasSpeedRamp(s.clip) || s.clip.titleConfig) out.push([s.startFrame, s.endFrame]);
      const prev = list[i - 1];
      const join = prev ? transitionBetween(prev, s) : null;
      // A joined transition needs both clips: the cut point itself is blocked too.
      if (join) out.push([s.startFrame - 1, s.startFrame + join.frames]);
      const tin = s.clip.transitionIn;
      if (!join && tin && xfadeName(tin.type)) out.push([s.startFrame, s.startFrame + getClipTransitionDurationFrames(tin, s.durationFrames)]);
      const tout = s.clip.transitionOut;
      if (tout && xfadeName(tout.type)) out.push([s.endFrame - getClipTransitionDurationFrames(tout, s.durationFrames), s.endFrame]);
    });
  }
  return out;
}

/**
 * Plan chunk ranges covering [0, totalFrames) so each overlaps at most
 * ~`maxClips` clips (it may exceed that when no valid cut exists).
 */
export function planExportChunks(project: EditorProject, totalFrames: number, maxClips = 40): ExportChunk[] {
  const segs = buildTimelineSegments(project.sequence, project.assets).filter((s) => s.clip.isEnabled);
  if (segs.length <= maxClips) return [{ startFrame: 0, endFrame: totalFrames }];
  const blocked = blockedIntervals(segs);
  const valid = (f: number) => blocked.every(([a, b]) => !(f > a && f < b));
  const candidates = [...new Set(segs.flatMap((s) => [s.startFrame, s.endFrame]))]
    .filter((f) => f > 0 && f < totalFrames && valid(f))
    .sort((a, b) => a - b);
  const overlapping = (a: number, b: number) => segs.filter((s) => s.startFrame < b && s.endFrame > a).length;

  const chunks: ExportChunk[] = [];
  let start = 0;
  let i = 0;
  while (start < totalFrames) {
    let end = totalFrames;
    let best: number | null = null;
    for (; i < candidates.length; i++) {
      const c = candidates[i];
      if (c <= start) continue;
      if (overlapping(start, c) > maxClips) break;
      best = c;
    }
    if (best !== null && overlapping(start, totalFrames) > maxClips) end = best;
    else if (best === null && i < candidates.length && overlapping(start, totalFrames) > maxClips) end = candidates[i]; // forced
    chunks.push({ startFrame: start, endFrame: end });
    start = end;
  }
  return chunks;
}

const shiftList = <T extends { frame: number }>(list: T[] | undefined, d: number): T[] | undefined =>
  list ? list.map((k) => ({ ...k, frame: k.frame - d })) : list;
const shiftTrack = (t: KeyframeTrack<number> | undefined, d: number) =>
  t ? { ...t, keyframes: shiftList(t.keyframes, d) as Keyframe<number>[] } : t;

function shiftGrade(g: ColorGrade | null, d: number): ColorGrade | null {
  if (!g?.keyframes) return g;
  const k = g.keyframes;
  return { ...g, keyframes: Object.fromEntries(Object.entries(k).map(([key, v]) => [key, shiftList(v, d)])) as ColorGrade["keyframes"] };
}

function shiftMask(m: ClipMask, d: number): ClipMask {
  return {
    ...m,
    keyframes: Object.fromEntries(Object.entries(m.keyframes ?? {}).map(([key, v]) => [key, shiftList(v, d)])) as ClipMask["keyframes"],
    trackingData: shiftList(m.trackingData, d) ?? [],
  };
}

/**
 * The project restricted to [startFrame, endFrame), re-timed to start at 0.
 * Clips crossing the range edges are trimmed (their source in/out move with
 * them); timeline-absolute keyframes, markers and subtitle cues shift.
 */
export function sliceProject(project: EditorProject, startFrame: number, endFrame: number): EditorProject {
  const seq = project.sequence;
  const fps = seq.settings.fps || 30;
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  const segs = buildTimelineSegments(seq, project.assets);
  const byId = new Map(segs.map((s) => [s.clip.id, s]));
  const clips: TimelineClip[] = [];
  for (const clip of seq.clips) {
    const seg = byId.get(clip.id);
    const asset = assets.get(clip.assetId);
    if (!seg || !asset) continue;
    if (seg.endFrame <= startFrame || seg.startFrame >= endFrame) continue;
    const speed = Math.max(0.25, Math.min(4, clip.speed ?? 1));
    const head = Math.max(0, startFrame - seg.startFrame);
    const newStart = Math.max(seg.startFrame, startFrame) - startFrame;
    const newDur = Math.min(seg.endFrame, endFrame) - Math.max(seg.startFrame, startFrame);
    const trimStart = clip.trimStartFrames + head * speed;
    const assetFrames = getAssetDurationFrames(asset, fps);
    const trimEnd = Math.max(0, assetFrames - trimStart - newDur * speed);
    clips.push({
      ...clip,
      startFrame: newStart,
      trimStartFrames: trimStart,
      trimEndFrames: trimEnd,
      transitionIn: head > 0 ? null : clip.transitionIn,
      transitionOut: seg.endFrame > endFrame ? null : clip.transitionOut,
      keyframes: clip.keyframes
        ? (Object.fromEntries(Object.entries(clip.keyframes).map(([k, t]) => [k, shiftTrack(t, startFrame)])) as TimelineClip["keyframes"])
        : clip.keyframes,
      colorGrade: shiftGrade(clip.colorGrade, startFrame),
      gradeNodes: clip.gradeNodes?.map((n) => ({ ...n, grade: shiftGrade(n.grade, startFrame)! })),
      masks: (clip.masks ?? []).map((m) => shiftMask(m, startFrame)),
    });
  }
  return {
    ...project,
    sequence: {
      ...seq,
      clips,
      tracks: seq.tracks.map((t) => ({
        ...t,
        automation: t.automation?.map((l) => ({ ...l, keyframes: shiftList(l.keyframes, startFrame)! })),
      })),
      markers: (seq.markers ?? []).filter((m) => m.frame >= startFrame && m.frame < endFrame).map((m) => ({ ...m, frame: m.frame - startFrame })),
    },
    subtitleCues: (project.subtitleCues ?? [])
      .filter((c) => c.endFrame > startFrame && c.startFrame < endFrame)
      .map((c) => ({ ...c, startFrame: Math.max(0, c.startFrame - startFrame), endFrame: Math.min(endFrame, c.endFrame) - startFrame })),
  };
}
