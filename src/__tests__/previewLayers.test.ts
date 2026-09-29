import { describe, it, expect } from "vitest";
import { createEmptyClip, type MediaAsset, type TimelineClip, type TimelineSequence } from "../shared/models";
import { buildTimelineSegments } from "../shared/timeline";
import { computePreviewUnits } from "../shared/previewLayers";

const asset = (id: string, secs = 4): MediaAsset => ({
  id, name: id, sourcePath: `/m/${id}.mp4`, previewUrl: "", thumbnailUrl: null,
  durationSeconds: secs, nativeFps: 30, width: 1920, height: 1080, hasAudio: false,
});
const track = (id: string) => ({ id, name: id, kind: "video" as const, muted: false, locked: false, solo: false, height: 50, color: "" });

function units(clips: TimelineClip[], frame: number) {
  const seq = { id: "s", name: "s", clips, beatSync: null, markers: [], tracks: [track("V2"), track("V1")], settings: { width: 1920, height: 1080, fps: 30, audioSampleRate: 48000 } } as TimelineSequence;
  return computePreviewUnits(buildTimelineSegments(seq, [asset("a"), asset("b")]), frame, 30);
}
const clip = (a: string, t: string, start: number, p: Partial<TimelineClip> = {}) => ({ ...createEmptyClip(a, t, start), ...p });

describe("computePreviewUnits", () => {
  it("orders layers bottom to top", () => {
    const u = units([clip("a", "V1", 0), clip("b", "V2", 0)], 10);
    expect(u.map((x) => x.to?.segment.clip.assetId)).toEqual(["a", "b"]);
  });

  it("blends the outgoing tail with the incoming clip during a transition", () => {
    const u = units([clip("a", "V1", 0), clip("b", "V1", 120, { transitionIn: { type: "crossDissolve", durationFrames: 30 } })], 135);
    expect(u).toHaveLength(1);
    expect(u[0].transition?.name).toBe("fade");
    expect(u[0].transition?.progress).toBeCloseTo(15.5 / 30);
    expect(u[0].from?.key).toMatch(/:tail$/);
    expect(u[0].from?.sourceTime).toBeCloseTo(4.5 + 1 / 60); // beyond clip A's out point (handle)
  });

  it("returns nothing in gaps", () => {
    expect(units([clip("a", "V1", 300)], 10)).toEqual([]);
  });

  it("resolves keyframed transforms at the frame", () => {
    const u = units([clip("a", "V1", 0, { keyframes: { posX: { property: "posX", keyframes: [{ frame: 0, value: 0 }, { frame: 100, value: 1 }] } } })], 50);
    expect(u[0].to?.transform.posX).toBeCloseTo(0.5);
  });
});

import { rampSourceProgress, rampRate } from "../shared/timeline";
describe("speed ramps", () => {
  it("keeps in/out points and redistributes time", () => {
    const kfs = [{ frame: 0, speed: 1 }, { frame: 300, speed: 3 }];
    expect(rampSourceProgress(kfs, 0)).toBe(0);
    expect(rampSourceProgress(kfs, 1)).toBeCloseTo(1);
    // speed rises, so the first half covers less than half the source
    expect(rampSourceProgress(kfs, 0.5)).toBeCloseTo((0.5 * (1 + 2) / 2) / 2);
    expect(rampRate(kfs, 1) / rampRate(kfs, 0)).toBeCloseTo(3);
  });
  it("is linear without a ramp", () => {
    expect(rampSourceProgress([], 0.3)).toBe(0.3);
  });
});
