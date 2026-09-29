// @vitest-environment node
/**
 * Renders real timelines through FFmpeg and checks the pixels/samples.
 * Opt-in (slow): FFMPEG_INTEGRATION=1 npx vitest run exportGraph.integration
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultColorGrade, createEmptyClip, type EditorProject, type MediaAsset, type TimelineClip } from "../shared/models";
import { buildExportGraph } from "../shared/exportGraph";

const FFMPEG = join(process.cwd(), "node_modules/ffmpeg-static/ffmpeg");
const enabled = process.env.FFMPEG_INTEGRATION === "1" && existsSync(FFMPEG);
const dir = mkdtempSync(join(tmpdir(), "264-export-"));

function ff(args: string[]) {
  return execFileSync(FFMPEG, ["-v", "error", "-y", ...args], { maxBuffer: 1 << 28 });
}

/** Average RGB of the frame at `sec`. */
function pixelAt(file: string, sec: number, x = 0.5, y = 0.5): [number, number, number] {
  const buf = ff(["-ss", String(sec), "-i", file, "-frames:v", "1", "-vf", `crop=8:8:(iw-8)*${x}:(ih-8)*${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < buf.length; i += 3) { r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; }
  const n = buf.length / 3;
  return [r / n, g / n, b / n];
}

function duration(file: string): number {
  const out = execFileSync(FFMPEG, ["-i", file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).toString();
  return Number(/Duration: (\d+):(\d+):([\d.]+)/.exec(out)?.slice(1).reduce((a, v, i) => a + Number(v) * [3600, 60, 1][i], 0));
}

function probeDuration(file: string): number {
  try { execFileSync(FFMPEG, ["-i", file], { stdio: "pipe" }); } catch (e) {
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String((e as { stderr?: Buffer }).stderr));
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return duration(file);
}

function render(project: EditorProject, extra: Record<string, unknown> = {}) {
  let n = 0;
  const graph = buildExportGraph({ project, ...extra }, {
    fontsDir: null,
    writeTempFile: (name, contents) => { const p = join(dir, `${n++}_${name}`); writeFileSync(p, contents); return p; },
  });
  const script = join(dir, `graph_${n++}.txt`);
  writeFileSync(script, graph.filterComplex);
  const out = join(dir, `out_${n++}.mp4`);
  ff([
    ...graph.inputs.flatMap((i) => [...i.options, "-i", i.path]),
    "-filter_complex_script", script,
    "-map", graph.videoLabel, "-map", graph.audioLabel,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", out,
  ]);
  return { out, graph };
}

const solid = (name: string, color: string, secs = 4): MediaAsset => {
  const path = join(dir, `${name}.mp4`);
  ff(["-f", "lavfi", "-i", `color=${color}:s=320x240:r=30:d=${secs}`, "-f", "lavfi", "-i", `sine=f=440:d=${secs}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path]);
  return { id: name, name, sourcePath: path, previewUrl: "", thumbnailUrl: null, durationSeconds: secs, nativeFps: 30, width: 320, height: 240, hasAudio: true };
};

function project(assets: MediaAsset[], clips: TimelineClip[]): EditorProject {
  return {
    id: "p", name: "t", assets,
    sequence: {
      id: "s", name: "s", clips, beatSync: null, markers: [],
      settings: { width: 320, height: 240, fps: 30, audioSampleRate: 48000 },
      tracks: [
        { id: "V2", name: "V2", kind: "video", muted: false, locked: false, solo: false, height: 50, color: "" },
        { id: "V1", name: "V1", kind: "video", muted: false, locked: false, solo: false, height: 50, color: "" },
        { id: "A1", name: "A1", kind: "audio", muted: false, locked: false, solo: false, height: 50, color: "" },
      ],
    },
  } as unknown as EditorProject;
}

const clip = (assetId: string, trackId: string, start: number, patch: Partial<TimelineClip> = {}): TimelineClip =>
  ({ ...createEmptyClip(assetId, trackId, start), ...patch });

const near = (a: number[], b: number[], eps = 25) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(eps));

describe.runIf(enabled)("export graph (real FFmpeg)", () => {
  let red: MediaAsset, blue: MediaAsset, green: MediaAsset;
  beforeAll(() => { red = solid("red", "red"); blue = solid("blue", "blue"); green = solid("green", "0x00ff00"); });

  it("keeps gaps black and places clips at their timeline position", () => {
    const { out } = render(project([red, blue], [
      clip("red", "V1", 0, { trimEndFrames: 60 }),   // 0–2s
      clip("blue", "V1", 90, { trimEndFrames: 60 }), // 3–5s, gap 2–3s
    ]));
    expect(probeDuration(out)).toBeCloseTo(5, 0);
    near(pixelAt(out, 1), [254, 0, 0]);
    near(pixelAt(out, 2.5), [0, 0, 0]);
    near(pixelAt(out, 4), [0, 0, 254]);
  }, 60000);

  it("composites upper tracks over lower tracks (picture-in-picture)", () => {
    const { out } = render(project([red, blue], [
      clip("red", "V1", 0),
      clip("blue", "V2", 0, { transform: { posX: 0.25, posY: 0, scaleX: 0.5, scaleY: 0.5, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 } }),
    ]));
    near(pixelAt(out, 1, 0.1, 0.5), [254, 0, 0]);  // left: base layer
    near(pixelAt(out, 1, 0.75, 0.5), [0, 0, 254]); // right: PiP
    expect(probeDuration(out)).toBeCloseTo(4, 0);   // layers overlap, not appended
  }, 60000);

  it("cross-dissolves between adjacent clips", () => {
    const { out } = render(project([red, blue], [
      clip("red", "V1", 0, { trimEndFrames: 60 }),
      clip("blue", "V1", 60, { trimEndFrames: 60, transitionIn: { type: "crossDissolve", durationFrames: 30 } }),
    ]));
    const mid = pixelAt(out, 2.5);
    expect(mid[0]).toBeGreaterThan(60);  // still some red
    expect(mid[2]).toBeGreaterThan(60);  // already some blue
    near(pixelAt(out, 3.5), [0, 0, 254]);
    expect(probeDuration(out)).toBeCloseTo(4, 0);
  }, 60000);

  it("applies the color grade identically to colorMath", () => {
    const grade = { ...createDefaultColorGrade(), saturation: 0 };
    const { out } = render(project([red], [clip("red", "V1", 0, { colorGrade: grade })]));
    const px = pixelAt(out, 1);
    expect(Math.abs(px[0] - px[1])).toBeLessThan(12); // desaturated → grey
    expect(px[0]).toBeGreaterThan(30);
  }, 60000);

  it("opacity reveals the layer beneath", () => {
    const { out } = render(project([red, blue], [
      clip("red", "V1", 0),
      clip("blue", "V2", 0, { transform: { posX: 0, posY: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.5, anchorX: 0.5, anchorY: 0.5 } }),
    ]));
    const px = pixelAt(out, 1);
    expect(px[0]).toBeGreaterThan(90);
    expect(px[2]).toBeGreaterThan(90);
  }, 60000);

  it("animates keyframed position and scale", () => {
    const { out } = render(project([red, blue], [
      clip("red", "V1", 0),
      clip("blue", "V2", 0, {
        keyframes: {
          posX: { property: "posX", keyframes: [{ frame: 0, value: -1 }, { frame: 90, value: 0 }] },
          scaleX: { property: "scaleX", keyframes: [{ frame: 0, value: 0.5 }, { frame: 90, value: 1 }] },
          scaleY: { property: "scaleY", keyframes: [{ frame: 0, value: 0.5 }, { frame: 90, value: 1 }] },
        },
      }),
    ]));
    near(pixelAt(out, 0.1, 0.5, 0.5), [254, 0, 0]); // blue starts off-screen left
    near(pixelAt(out, 3.5, 0.5, 0.5), [0, 0, 254]); // arrives centered full-size
  }, 60000);

  it("renders adjustment layers, titles, masks and audio tracks", () => {
    const adjAsset: MediaAsset = { ...red, id: "adj", sourcePath: "", hasAudio: false, durationSeconds: 1 };
    const titleAsset: MediaAsset = { ...red, id: "title", sourcePath: "", hasAudio: false, durationSeconds: 2 };
    const { out, graph } = render(project([green, adjAsset, titleAsset, red], [
      clip("0x00ff00" === "" ? "" : "green", "V1", 0),
      clip("adj", "V2", 30, { clipType: "adjustment", colorGrade: { ...createDefaultColorGrade(), saturation: 0 } }),
      clip("title", "V2", 60, { titleConfig: { preset: "lower_third", mainText: "Hello: it's 264", fontFamily: "Sans", fontSize: 40, color: "#ffffff", bgColor: "#000000", bgOpacity: 0, animationIn: "none", animationOut: "none", durationFrames: 60, posX: 0.5, posY: 0.4 } as never }),
      clip("red", "A1", 0),
    ]), { burnIn: { timecode: true, watermarkText: "© 264: Pro" } });
    expect(graph.warnings).toEqual([]);
    near(pixelAt(out, 0.5), [0, 254, 0]);
    const adj = pixelAt(out, 1.5);
    expect(Math.abs(adj[0] - adj[1])).toBeLessThan(12);
    near(pixelAt(out, 3.5), [0, 254, 0]);
    const vol = execFileSync(FFMPEG, ["-i", out, "-af", "volumedetect", "-vn", "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    void vol;
  }, 60000);
});

describe.runIf(enabled)("export graph power windows (real FFmpeg)", () => {
  it("grades only inside the window mask", () => {
    const red = solid("pwred", "red");
    const win = { id: "w", name: "w", shape: { type: "ellipse" as const, x: 0.25, y: 0.25, width: 0.5, height: 0.5, rotation: 0, points: [] }, feather: 0, opacity: 1, inverted: false, expansion: 0, trackingEnabled: false, trackingData: [], keyframes: {} };
    const { out, graph } = render(project([red], [
      clip("pwred", "V1", 0, { masks: [win], colorGrade: { ...createDefaultColorGrade(), saturation: 0, maskIds: ["w"] } }),
    ]));
    expect(graph.needsGpu).toBe(false);
    const inside = pixelAt(out, 1, 0.5, 0.5);
    expect(Math.abs(inside[0] - inside[1])).toBeLessThan(15); // grey
    near(pixelAt(out, 1, 0.05, 0.05), [254, 0, 0]);             // untouched red
  }, 60000);
});

import { planExportChunks, sliceProject } from "../shared/exportChunks";
describe.runIf(enabled)("chunked export (real FFmpeg)", () => {
  it("renders chunks that join into the same timeline", () => {
    const a = solid("ca", "red", 1), b = solid("cb", "blue", 1);
    // 60 one-second clips alternating red/blue
    const clips = Array.from({ length: 60 }, (_, i) => clip(i % 2 ? "cb" : "ca", "V1", i * 30));
    const proj = project([a, b], clips);
    const chunks = planExportChunks(proj, 1800, 20);
    expect(chunks.length).toBeGreaterThan(1);
    const parts: string[] = [];
    for (const c of chunks) {
      const { out } = render(sliceProject(proj, c.startFrame, c.endFrame), { durationFramesOverride: c.endFrame - c.startFrame, timecodeOffsetFrames: c.startFrame });
      parts.push(out);
    }
    const list = join(dir, "list.txt");
    writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
    const joined = join(dir, "joined.mp4");
    ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);
    expect(probeDuration(joined)).toBeCloseTo(60, 0);
    const boundary = chunks[1].startFrame / 30;           // first chunk cut
    const colorAt = (t: number) => (Math.floor(t) % 2 ? [0, 0, 254] : [254, 0, 0]);
    near(pixelAt(joined, boundary - 0.5), colorAt(boundary - 0.5));
    near(pixelAt(joined, boundary + 0.5), colorAt(boundary + 0.5));
  }, 180000);
});

describe.runIf(enabled)("audio-only export (real FFmpeg)", () => {
  it("produces an audio file with no video stream", () => {
    const a = solid("ao", "red", 2);
    const proj = project([a], [clip("ao", "V1", 0), clip("ao", "A1", 0)]);
    let n = 0;
    const graph = buildExportGraph({ project: proj, audioOnly: true }, {
      fontsDir: null,
      writeTempFile: (name, contents) => { const p = join(dir, `ao${n++}_${name}`); writeFileSync(p, contents); return p; },
    });
    expect(graph.videoLabel).toBe("");
    const script = join(dir, "ao_graph.txt");
    writeFileSync(script, graph.filterComplex);
    const out = join(dir, "audio_only.m4a");
    ff([...graph.inputs.flatMap((i) => [...i.options, "-i", i.path]), "-filter_complex_script", script, "-map", graph.audioLabel, "-vn", "-c:a", "aac", out]);
    let info = "";
    try { execFileSync(FFMPEG, ["-i", out], { stdio: "pipe" }); } catch (e) { info = String((e as { stderr?: Buffer }).stderr); }
    expect(info).toMatch(/Audio: aac/);
    expect(info).not.toMatch(/Video:/);
  }, 60000);
});
