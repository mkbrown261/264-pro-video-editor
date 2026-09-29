import { describe, it, expect } from "vitest";
import { generateEDL, generateFCPXML } from "../../electron/edl-export";
import { createEmptyClip, createEmptyProject, type EditorProject, type MediaAsset, type TimelineClip } from "../shared/models";

const asset = (id: string, secs = 10): MediaAsset => ({ id, name: `${id}.mov`, sourcePath: `/media/My Clips/${id}.mov`, previewUrl: "", thumbnailUrl: null, durationSeconds: secs, nativeFps: 30, width: 1920, height: 1080, hasAudio: true });
const track = (id: string, kind: "video" | "audio") => ({ id, name: id, kind, muted: false, locked: false, solo: false, height: 50, color: "" });
function project(clips: TimelineClip[], fps = 30): EditorProject {
  const base = createEmptyProject();
  return { ...base, name: "Cut", assets: [asset("a"), asset("b")], sequence: { ...base.sequence, clips, tracks: [track("V2", "video"), track("V1", "video"), track("A1", "audio")], settings: { ...base.sequence.settings, fps } } };
}
const clip = (a: string, t: string, start: number, p: Partial<TimelineClip> = {}) => ({ ...createEmptyClip(a, t, start), trimStartFrames: 30, trimEndFrames: 150, ...p }); // 120 src frames

describe("EDL export", () => {
  it("uses timeline durations for sped-up clips and writes an M2 line", () => {
    const edl = generateEDL(project([clip("a", "V2", 0, { speed: 2 }), clip("b", "V2", 60)]));
    expect(edl).toMatch(/001  AMOV     V {5}C {8}00:00:01:00 00:00:05:00 00:00:00:00 00:00:02:00/);
    expect(edl).toMatch(/M2   AMOV           060\.0/);
    expect(edl).toMatch(/002  BMOV     V {5}C {8}00:00:01:00 00:00:05:00 00:00:02:00 00:00:06:00/);
  });

  it("writes dissolves as a cut + D pair and exports audio events", () => {
    const edl = generateEDL(project([
      clip("a", "V2", 0), clip("b", "V2", 120, { transitionIn: { type: "crossDissolve", durationFrames: 15 } }), clip("a", "A1", 0),
    ]));
    expect(edl).toMatch(/002  AMOV     V {5}C {8}00:00:05:00 00:00:05:00 00:00:04:00 00:00:04:00/);
    expect(edl).toMatch(/002  BMOV     V {5}D {4}015 00:00:01:00 00:00:05:00 00:00:04:00 00:00:08:00/);
    expect(edl).toMatch(/003  AMOV     A {5}C/);
  });
});

describe("FCPXML export", () => {
  it("puts every track on its own lane with correct offsets and encoded paths", () => {
    const xml = generateFCPXML(project([clip("a", "V1", 0), clip("b", "V2", 30), clip("a", "A1", 0)]));
    expect(xml).toContain('src="file:///media/My%20Clips/a.mov"');
    expect(xml).toMatch(/<asset-clip name="b\.mov" ref="r_b" lane="2" offset="30\/30s" duration="120\/30s" start="30\/30s"/);
    expect(xml).toMatch(/ref="r_a" lane="1" offset="0s|ref="r_a" lane="1" offset="0\/30s"/);
    expect(xml).toMatch(/lane="-1"[^>]*srcEnable="audio"/);
    expect(xml).toMatch(/<gap name="Gap" offset="0s" duration="150\/30s"/);
  });

  it("uses NTSC rational time at 29.97", () => {
    const xml = generateFCPXML(project([clip("a", "V1", 0)], 29.97));
    expect(xml).toContain('frameDuration="1001/30000s"');
    expect(xml).toContain('duration="120120/30000s"');
  });
});
