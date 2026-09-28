import { describe, it, expect } from "vitest";
import { createDefaultColorGrade, createEmptyClip, type EditorProject, type MediaAsset, type TimelineClip } from "../shared/models";
import { assText, buildExportGraph, cssFilterToFfmpeg, keyframeExpr, xfadeName } from "../shared/exportGraph";

const asset = (id: string, secs = 4, extra: Partial<MediaAsset> = {}): MediaAsset => ({
  id, name: id, sourcePath: `/media/${id}.mp4`, previewUrl: "", thumbnailUrl: null,
  durationSeconds: secs, nativeFps: 30, width: 1920, height: 1080, hasAudio: true, ...extra,
});

function project(assets: MediaAsset[], clips: TimelineClip[]): EditorProject {
  const track = (id: string, kind: "video" | "audio") => ({ id, name: id, kind, muted: false, locked: false, solo: false, height: 50, color: "" });
  return {
    id: "p", name: "p", assets,
    sequence: {
      id: "s", name: "s", clips, beatSync: null, markers: [],
      settings: { width: 1920, height: 1080, fps: 30, audioSampleRate: 48000 },
      tracks: [track("V2", "video"), track("V1", "video"), track("A1", "audio")],
    },
  } as unknown as EditorProject;
}

const files: Record<string, string> = {};
const env = { fontsDir: null, writeTempFile: (n: string, c: string) => { files[n] = c; return `/tmp/${n}`; } };
const clip = (a: string, t: string, start: number, p: Partial<TimelineClip> = {}) => ({ ...createEmptyClip(a, t, start), ...p });

describe("buildExportGraph", () => {
  it("spans the full timeline including gaps", () => {
    const g = buildExportGraph({ project: project([asset("a")], [clip("a", "V1", 300)]) }, env);
    expect(g.totalFrames).toBe(420);
    expect(g.durationSeconds).toBe(14);
    expect(g.filterComplex).toMatch(/color=c=black:s=1920x1080:r=30:d=14/);
  });

  it("takes audio from audio tracks only (no doubled audio)", () => {
    const g = buildExportGraph({ project: project([asset("a")], [clip("a", "V1", 0), clip("a", "A1", 0)]) }, env);
    const audioChains = g.filterComplex.split(";\n").filter((p) => /^\[\d+:a\]/.test(p));
    expect(audioChains).toHaveLength(1);
  });

  it("composites layers bottom to top with overlay, never concat", () => {
    const g = buildExportGraph({ project: project([asset("a"), asset("b")], [clip("a", "V1", 0), clip("b", "V2", 0)]) }, env);
    expect(g.filterComplex).not.toMatch(/concat=/);
    const v1 = g.inputs.findIndex((i) => i.path.endsWith("a.mp4"));
    const v2 = g.inputs.findIndex((i) => i.path.endsWith("b.mp4"));
    expect(v1).toBeLessThan(v2); // lower track (V1) built first
  });

  it("uses xfade between adjacent clips joined by a transition", () => {
    const g = buildExportGraph({ project: project([asset("a"), asset("b")], [
      clip("a", "V1", 0),
      clip("b", "V1", 120, { transitionIn: { type: "wipeLeft", durationFrames: 15 } }),
    ]) }, env);
    expect(g.filterComplex).toMatch(/xfade=transition=wipeleft:duration=0\.5:offset=4/);
  });

  it("seeks each clip at its source in-point", () => {
    const g = buildExportGraph({ project: project([asset("a", 10)], [clip("a", "V1", 0, { trimStartFrames: 60 })]) }, env);
    expect(g.inputs[0].options).toEqual(expect.arrayContaining(["-ss", "2"]));
  });

  it("bakes the grade chain into a .cube LUT", () => {
    const g = buildExportGraph({ project: project([asset("a")], [clip("a", "V1", 0, { colorGrade: { ...createDefaultColorGrade(), exposure: 1 } })]) }, env);
    expect(g.filterComplex).toMatch(/lut3d=file=/);
    const cube = Object.entries(files).find(([n]) => n.endsWith(".cube"))![1];
    expect(cube).toMatch(/LUT_3D_SIZE 33/);
  });

  it("renders text with libass, never drawtext", () => {
    const g = buildExportGraph({
      project: project([asset("a"), asset("t", 2, { sourcePath: "", hasAudio: false })], [
        clip("a", "V1", 0),
        clip("t", "V2", 0, { titleConfig: { preset: "x", mainText: "Hi {there}", fontFamily: "Inter", fontSize: 40, color: "#ffffff", bgColor: "#000000", bgOpacity: 0, animationIn: "fade", animationOut: "none", durationFrames: 60, posX: 0.5, posY: 0.5 } as never }),
      ]),
      burnIn: { timecode: true, watermarkText: "wm" },
    }, env);
    expect(g.filterComplex).not.toMatch(/drawtext/);
    expect(g.filterComplex).toMatch(/ass=filename=/);
  });

  it("throws on an empty timeline", () => {
    expect(() => buildExportGraph({ project: project([], []) }, env)).toThrow(/Nothing is on the timeline/);
  });
});

describe("helpers", () => {
  it("keyframeExpr interpolates linearly and clamps", () => {
    const e = keyframeExpr([{ frame: 0, value: 0 }, { frame: 10, value: 1 }], "F");
    const evalAt = (F: number) =>
      // eslint-disable-next-line no-new-func
      new Function("F", "if_", "lt", `return ${e.replace(/if\(/g, "if_(")}`)(F, (c: boolean, a: number, b: number) => (c ? a : b), (a: number, b: number) => a < b);
    expect(evalAt(-5)).toBe(0);
    expect(evalAt(5)).toBeCloseTo(0.5);
    expect(evalAt(50)).toBe(1);
  });

  it("maps transitions to xfade names", () => {
    expect(xfadeName("crossDissolve")).toBe("fade");
    expect(xfadeName("dipBlack")).toBe("fadeblack");
    expect(xfadeName("cut")).toBeNull();
  });

  it("translates CSS filter functions", () => {
    const f = cssFilterToFfmpeg("blur(4px) saturate(0) hue-rotate(90deg) brightness(1.2)", 2);
    expect(f[0]).toBe("gblur=sigma=8");
    expect(f[1]).toMatch(/^colorchannelmixer=rr=0\.213/);
    expect(f).toHaveLength(4);
  });

  it("escapes ASS override braces and newlines", () => {
    expect(assText("a{b}\nc")).toBe("a(b)\\Nc");
  });
});
