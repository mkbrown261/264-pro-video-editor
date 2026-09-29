import { describe, it, expect, beforeEach, vi } from "vitest";
import { useEditorStore } from "../renderer/store/editorStore";
import { createEmptyClip, createEmptyProject, type MediaAsset, type TimelineClip } from "../shared/models";
import { buildTimelineSegments } from "../shared/timeline";

const asset = (id: string, secs = 10, extra: Partial<MediaAsset> = {}): MediaAsset => ({
  id, name: id, sourcePath: `/m/${id}.mp4`, previewUrl: "", thumbnailUrl: null,
  durationSeconds: secs, nativeFps: 30, width: 1920, height: 1080, hasAudio: false, ...extra,
});
const track = (id: string, kind: "video" | "audio") => ({ id, name: id, kind, muted: false, locked: false, solo: false, height: 50, color: "" });
// 2-second clips (60 frames) cut from a 10 s source
const clip = (id: string, trackId: string, start: number, p: Partial<TimelineClip> = {}): TimelineClip =>
  ({ ...createEmptyClip("a", trackId, start), id, trimStartFrames: 30, trimEndFrames: 210, ...p });

function load(clips: TimelineClip[], assets = [asset("a")]) {
  const base = createEmptyProject();
  useEditorStore.setState({
    project: { ...base, assets, sequence: { ...base.sequence, clips, tracks: [track("V1", "video"), track("A1", "audio")], settings: { ...base.sequence.settings, fps: 30 } } },
    undoStack: [], redoStack: [], canUndo: false, canRedo: false, selectedClipId: null,
    playback: { isPlaying: false, playheadFrame: 0 },
  });
}
const S = () => useEditorStore.getState();
const seg = (id: string) => buildTimelineSegments(S().project.sequence, S().project.assets).find((s) => s.clip.id === id)!;

describe("timeline editing", () => {
  beforeEach(() => { vi.useRealTimers(); });

  it("splits a clip into two that cover the same range", () => {
    load([clip("c1", "V1", 0)]);
    S().splitClipAtFrame("c1", 20);
    const segs = buildTimelineSegments(S().project.sequence, S().project.assets).sort((x, y) => x.startFrame - y.startFrame);
    expect(segs.map((s) => [s.startFrame, s.endFrame])).toEqual([[0, 20], [20, 60]]);
    expect(segs[1].sourceInSeconds).toBeCloseTo((30 + 20) / 30);
  });

  it("ripple delete closes the gap", () => {
    load([clip("c1", "V1", 0), clip("c2", "V1", 60), clip("c3", "V1", 120)]);
    S().rippleDelete("c2");
    expect(seg("c3").startFrame).toBe(60);
  });

  it("ripple trim start shortens the head without overlapping the next clip", () => {
    load([clip("c1", "V1", 0), clip("c2", "V1", 60)]);
    S().rippleTrim("c1", "start", 10);
    expect([seg("c1").startFrame, seg("c1").endFrame]).toEqual([0, 50]);
    expect(seg("c2").startFrame).toBe(50);
  });

  it("ripple trim end extends the tail and pushes later clips, linked audio too", () => {
    load([
      clip("v1", "V1", 0, { linkedGroupId: "g" }), clip("a1", "A1", 0, { linkedGroupId: "g" }),
      clip("v2", "V1", 60), clip("a2", "A1", 60),
    ]);
    S().rippleTrim("v1", "end", 15);
    expect(seg("v1").endFrame).toBe(75);
    expect(seg("a1").endFrame).toBe(75);
    expect(seg("v2").startFrame).toBe(75);
    expect(seg("a2").startFrame).toBe(75);
  });

  it("ripple trim respects clip speed", () => {
    load([clip("c1", "V1", 0, { speed: 2 }), clip("c2", "V1", 30)]); // 2 s of source at 2× = 30 frames
    S().rippleTrim("c1", "end", 10);
    expect(seg("c1").endFrame).toBe(40);
    expect(seg("c2").startFrame).toBe(40);
  });

  it("roll trim moves the edit point without gaps or overlaps", () => {
    load([clip("c1", "V1", 0), clip("c2", "V1", 60), clip("c3", "V1", 120)]);
    S().rollTrim("c1", 12);
    expect(seg("c1").endFrame).toBe(72);
    expect([seg("c2").startFrame, seg("c2").endFrame]).toEqual([72, 120]);
    expect(seg("c3").startFrame).toBe(120);
  });

  it("dropping over a clip overwrites it (split around the drop)", () => {
    load([clip("long", "V1", 0, { trimStartFrames: 0, trimEndFrames: 0 })], [asset("a"), asset("b", 1)]);
    S().dropAssetAtFrame("b", "V1", 100);
    const segs = buildTimelineSegments(S().project.sequence, S().project.assets).sort((x, y) => x.startFrame - y.startFrame);
    expect(segs.map((s) => [s.asset.id, s.startFrame, s.endFrame])).toEqual([["a", 0, 100], ["b", 100, 130], ["a", 130, 300]]);
  });

  it("audio-only assets land on an audio track", () => {
    load([], [asset("song", 5, { width: 0, height: 0, hasAudio: true, sourcePath: "/m/song.mp3" })]);
    S().appendAssetToTimeline("song");
    const clips = S().project.sequence.clips;
    expect(clips).toHaveLength(1);
    expect(S().project.sequence.tracks.find((t) => t.id === clips[0].trackId)?.kind).toBe("audio");
  });

  it("undo and redo restore edits", () => {
    load([clip("c1", "V1", 0), clip("c2", "V1", 60)]);
    S().rippleDelete("c1");
    expect(seg("c2").startFrame).toBe(0);
    S().undo();
    expect(seg("c2").startFrame).toBe(60);
    S().redo();
    expect(seg("c2").startFrame).toBe(0);
  });

  it("rapid repeats of one action are a single undo step", () => {
    vi.useFakeTimers();
    load([clip("c1", "V1", 0)]);
    for (let v = 1; v <= 5; v++) { S().setClipVolume("c1", v / 10); vi.advanceTimersByTime(50); }
    expect(S().undoStack).toHaveLength(1);
    S().undo();
    expect(S().project.sequence.clips[0].volume).toBe(1);
    vi.advanceTimersByTime(2000);
    S().setClipVolume("c1", 0.3);
    vi.advanceTimersByTime(2000);
    S().setClipVolume("c1", 0.4);
    expect(S().undoStack.length).toBe(2);
  });

  it("insert edit ripples later clips and splits the one under the playhead", () => {
    load([clip("c1", "V1", 0), clip("c2", "V1", 60)], [asset("a"), asset("b")]);
    S().editAtFrame("b", 30, 0, 45, "insert");
    const segs = buildTimelineSegments(S().project.sequence, S().project.assets).sort((x, y) => x.startFrame - y.startFrame);
    expect(segs.map((s) => [s.asset.id, s.startFrame, s.endFrame])).toEqual([["a", 0, 30], ["b", 30, 75], ["a", 75, 105], ["a", 105, 165]]);
    expect(segs[2].sourceInSeconds).toBeCloseTo((30 + 30) / 30); // right half continues where the left stopped
  });

  it("overwrite edit replaces what's underneath without moving later clips", () => {
    load([clip("c1", "V1", 0), clip("c2", "V1", 60)], [asset("a"), asset("b")]);
    S().editAtFrame("b", 30, 0, 45, "overwrite");
    const segs = buildTimelineSegments(S().project.sequence, S().project.assets).sort((x, y) => x.startFrame - y.startFrame);
    expect(segs.map((s) => [s.asset.id, s.startFrame, s.endFrame])).toEqual([["a", 0, 30], ["b", 30, 75], ["a", 75, 120]]);
  });

  it("source edits bring linked audio", () => {
    load([], [asset("b", 10, { hasAudio: true })]);
    S().editAtFrame("b", 0, 30, 90, "overwrite");
    const clips = S().project.sequence.clips;
    expect(clips).toHaveLength(2);
    expect(clips[0].linkedGroupId).toBeTruthy();
    expect(clips[0].linkedGroupId).toBe(clips[1].linkedGroupId);
    expect(seg(clips[1].id).track.kind).toBe("audio");
    expect([seg(clips[1].id).startFrame, seg(clips[1].id).endFrame]).toEqual([0, 60]);
  });

  it("dropping over a sped-up clip trims it by source frames", () => {
    load([clip("fast", "V1", 0, { speed: 2, trimStartFrames: 0, trimEndFrames: 0 })], [asset("a"), asset("b", 1)]); // 300 src frames → 150
    S().dropAssetAtFrame("b", "V1", 50);
    const segs = buildTimelineSegments(S().project.sequence, S().project.assets).sort((x, y) => x.startFrame - y.startFrame);
    expect(segs.map((s) => [s.asset.id, s.startFrame, s.endFrame])).toEqual([["a", 0, 50], ["b", 50, 80], ["a", 80, 150]]);
    expect(segs[2].sourceInSeconds).toBeCloseTo(160 / 30);
  });

  it("close all gaps ripples every track together and keeps linked audio in sync", () => {
    load([
      clip("v1", "V1", 30, { linkedGroupId: "g1" }), clip("a1", "A1", 30, { linkedGroupId: "g1" }),
      clip("v2", "V1", 150, { linkedGroupId: "g2" }), clip("a2", "A1", 150, { linkedGroupId: "g2" }),
    ]);
    S().closeAllGaps();
    expect([seg("v1").startFrame, seg("a1").startFrame, seg("v2").startFrame, seg("a2").startFrame]).toEqual([0, 0, 60, 60]);
  });

  it("close all gaps keeps a gap that has audio under it", () => {
    load([clip("v1", "V1", 0), clip("music", "A1", 0, { trimEndFrames: 0 }), clip("v2", "V1", 100)]);
    S().closeAllGaps();
    expect(seg("v2").startFrame).toBe(100);
  });

  it("duplicate lands in the first free spot instead of on top of the next clip", () => {
    load([clip("c1", "V1", 0, { linkedGroupId: "g" }), clip("a1", "A1", 0, { linkedGroupId: "g" }), clip("c2", "V1", 60), clip("c3", "A1", 150)]);
    S().duplicateClip("c1");
    const copies = S().project.sequence.clips.filter((c) => !["c1", "a1", "c2", "c3"].includes(c.id));
    expect(copies).toHaveLength(2);
    expect(copies.map((c) => seg(c.id).startFrame)).toEqual([210, 210]); // V1 busy to 120, A1 busy 150–210
  });

  it("moving a linked clip over others overwrites on every track and keeps sync", () => {
    load([
      clip("v", "V1", 0, { linkedGroupId: "g" }), clip("a", "A1", 0, { linkedGroupId: "g" }),
      clip("v2", "V1", 100), clip("a2", "A1", 100),
    ]);
    S().moveClipTo("v", "V1", 130);
    expect([seg("v").startFrame, seg("a").startFrame]).toEqual([130, 130]);
    expect([seg("v2").startFrame, seg("v2").endFrame]).toEqual([100, 130]);
    expect([seg("a2").startFrame, seg("a2").endFrame]).toEqual([100, 130]);
  });

  it("splitting a sped-up clip keeps both halves contiguous", () => {
    load([clip("c1", "V1", 0, { speed: 2 })]); // 60 src frames at 2× → 0–30
    S().splitClipAtFrame("c1", 20);
    const segs = buildTimelineSegments(S().project.sequence, S().project.assets).sort((x, y) => x.startFrame - y.startFrame);
    expect(segs.map((s) => [s.startFrame, s.endFrame])).toEqual([[0, 20], [20, 30]]);
    expect(segs[1].sourceInSeconds).toBeCloseTo((30 + 40) / 30);
  });

  it("trimming the head of a sped-up clip keeps its out point", () => {
    load([clip("c1", "V1", 0, { speed: 2 })]);
    S().trimClipStart("c1", 60); // +30 source frames = 15 timeline frames
    expect([seg("c1").startFrame, seg("c1").endFrame]).toEqual([15, 30]);
  });

  it("keyframes move with the clip, but not when it's only trimmed", () => {
    const keyframes = { opacity: { property: "opacity", keyframes: [{ frame: 10, value: 0 }, { frame: 40, value: 1 }] } };
    load([clip("c1", "V1", 0, { keyframes })]);
    S().moveClipTo("c1", "V1", 100);
    expect(S().project.sequence.clips[0].keyframes?.opacity?.keyframes.map((k) => k.frame)).toEqual([110, 140]);
    S().trimClipStart("c1", 40);
    expect(S().project.sequence.clips[0].keyframes?.opacity?.keyframes.map((k) => k.frame)).toEqual([110, 140]);
    S().duplicateClip("c1");
    const copy = S().project.sequence.clips.find((c) => c.id !== "c1")!;
    expect(copy.keyframes?.opacity?.keyframes.map((k) => k.frame)).toEqual([160, 190]);
  });

  it("slip keeps position and duration, clamps to the media, and slips linked audio", () => {
    load([clip("v", "V1", 0, { linkedGroupId: "g" }), clip("a", "A1", 0, { linkedGroupId: "g" })]);
    S().slip("v", 50);
    expect([seg("v").startFrame, seg("v").endFrame, seg("a").endFrame]).toEqual([0, 60, 60]);
    expect(seg("v").sourceInSeconds).toBeCloseTo(80 / 30);
    expect(seg("a").sourceInSeconds).toBeCloseTo(80 / 30);
    S().slip("v", -500);
    expect(seg("v").sourceInSeconds).toBeCloseTo(0);
    expect(seg("v").endFrame).toBe(60);
  });

  it("slide moves a clip between its neighbours without changing its source range", () => {
    load([clip("p", "V1", 0), clip("c", "V1", 60), clip("n", "V1", 120)]);
    S().slide("c", 10);
    expect([seg("p").endFrame, seg("c").startFrame, seg("c").endFrame, seg("n").startFrame, seg("n").endFrame]).toEqual([70, 70, 130, 130, 180]);
    expect(seg("c").sourceInSeconds).toBeCloseTo(1);
    expect(seg("n").sourceInSeconds).toBeCloseTo(40 / 30);
  });

  it("auto-layout keeps layering and sync, drops empty tracks, one undo step", () => {
    load([clip("v1", "V1", 30, { linkedGroupId: "g" }), clip("a1", "A1", 30, { linkedGroupId: "g" })]);
    S().addTrack("video"); S().addTrack("audio");
    useEditorStore.setState({ undoStack: [] });
    S().autoLayoutTimeline();
    expect(S().project.sequence.tracks.map((t) => t.id)).toEqual(["V1", "A1"]);
    expect([seg("v1").startFrame, seg("a1").startFrame]).toEqual([0, 0]);
    expect(S().undoStack).toHaveLength(1);
    S().undo();
    expect(S().project.sequence.tracks).toHaveLength(4);
    expect(seg("v1").startFrame).toBe(30);
  });

  it("titles go on the top track, or a new top track when it's occupied", () => {
    load([clip("c1", "V1", 0)], [asset("a"), asset("t", 2, { sourcePath: "" })]);
    S().insertClipOnTop({ ...createEmptyClip("t", "V1", 10), id: "title" });
    const tracks = S().project.sequence.tracks;
    expect(tracks).toHaveLength(3);
    expect(seg("title").track.id).toBe(tracks[0].id);
    expect(seg("c1").track.id).toBe("V1");
    S().insertClipOnTop({ ...createEmptyClip("t", "V1", 100), id: "title2" });
    expect(S().project.sequence.tracks).toHaveLength(3); // free spot on the (new) top track
  });
});

import { analyzeTimelineHealth, pictureGaps } from "../shared/timelineHealth";
describe("timeline health", () => {
  it("finds gaps in the picture, not per-track holes covered by another track", () => {
    load([clip("c1", "V1", 0), clip("b", "V2" as string, 60), clip("c2", "V1", 200)]);
    S().addTrack("video");
    const p = S().project;
    const v2 = p.sequence.tracks.find((t) => t.kind === "video" && t.id !== "V1")!.id;
    const proj = { ...p, sequence: { ...p.sequence, clips: p.sequence.clips.map((c) => c.id === "b" ? { ...c, trackId: v2 } : c) } };
    expect(pictureGaps(proj)).toEqual([{ start: 120, end: 200 }]);
    const msgs = analyzeTimelineHealth(proj);
    expect(msgs.filter((m) => /gap/.test(m))).toHaveLength(1);
  });
});
