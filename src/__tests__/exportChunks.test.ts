import { describe, it, expect } from "vitest";
import { createEmptyClip, type EditorProject, type MediaAsset, type TimelineClip } from "../shared/models";
import { buildTimelineSegments } from "../shared/timeline";
import { planExportChunks, sliceProject } from "../shared/exportChunks";

const asset: MediaAsset = { id: "a", name: "a", sourcePath: "/a.mp4", previewUrl: "", thumbnailUrl: null, durationSeconds: 10, nativeFps: 30, width: 1920, height: 1080, hasAudio: true };
const track = (id: string, kind: "video" | "audio") => ({ id, name: id, kind, muted: false, locked: false, solo: false, height: 50, color: "" });
function project(clips: TimelineClip[]): EditorProject {
  return { id: "p", name: "p", assets: [asset], sequence: { id: "s", name: "s", clips, beatSync: null, markers: [], tracks: [track("V1", "video"), track("A1", "audio")], settings: { width: 1920, height: 1080, fps: 30, audioSampleRate: 48000 } } } as unknown as EditorProject;
}
// 1-second clips back to back: trimEnd = 300 - 30 frames
const oneSec = (i: number, p: Partial<TimelineClip> = {}) => ({ ...createEmptyClip("a", "V1", i * 30), trimStartFrames: 30, trimEndFrames: 240, ...p });

describe("planExportChunks", () => {
  it("keeps short timelines in one chunk", () => {
    expect(planExportChunks(project([oneSec(0)]), 30)).toEqual([{ startFrame: 0, endFrame: 30 }]);
  });

  it("splits long timelines and covers every frame", () => {
    const clips = Array.from({ length: 100 }, (_, i) => oneSec(i));
    const chunks = planExportChunks(project(clips), 3000, 40);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].startFrame).toBe(0);
    expect(chunks[chunks.length - 1].endFrame).toBe(3000);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].startFrame).toBe(chunks[i - 1].endFrame);
  });

  it("never cuts through a joined transition", () => {
    const clips = Array.from({ length: 100 }, (_, i) =>
      oneSec(i, i === 41 ? { transitionIn: { type: "crossDissolve", durationFrames: 10 } } : {}));
    const cuts = planExportChunks(project(clips), 3000, 40).map((c) => c.startFrame);
    expect(cuts).not.toContain(41 * 30);
  });
});

describe("sliceProject", () => {
  it("trims clips crossing the range and re-times them", () => {
    const p = project([{ ...createEmptyClip("a", "V1", 0), trimStartFrames: 0, trimEndFrames: 0, speed: 2 }]); // 150 frames long
    const sliced = sliceProject(p, 50, 100);
    const [seg] = buildTimelineSegments(sliced.sequence, sliced.assets);
    expect(seg.startFrame).toBe(0);
    expect(seg.durationFrames).toBe(50);
    expect(seg.sourceInSeconds).toBeCloseTo((50 * 2) / 30); // 2x speed consumes 2 source frames per frame
  });

  it("shifts timeline-absolute keyframes", () => {
    const p = project([{ ...createEmptyClip("a", "V1", 0), keyframes: { posX: { property: "posX", keyframes: [{ frame: 60, value: 1 }] } } }]);
    expect(sliceProject(p, 30, 90).sequence.clips[0].keyframes?.posX?.keyframes[0].frame).toBe(30);
  });
});
