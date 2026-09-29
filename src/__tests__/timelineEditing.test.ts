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
});
