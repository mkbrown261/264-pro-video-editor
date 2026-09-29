import { describe, it, expect } from "vitest";
import { createDefaultColorGrade, createEmptyClip, createEmptyProject, type EditorProject } from "../shared/models";
import { deserializeProject, serializeProject } from "../shared/projectSerializer";

describe("project files", () => {
  it("round-trip keeps every clip and project field", () => {
    const base = createEmptyProject();
    const clip = {
      ...createEmptyClip("a", base.sequence.tracks[0].id, 10),
      clipType: "title" as const,
      titleConfig: { preset: "x", mainText: "Hi", fontFamily: "Inter", fontSize: 40, color: "#fff", bgColor: "#000", bgOpacity: 0, animationIn: "fade", animationOut: "none", durationFrames: 60, posX: 0.5, posY: 0.5 } as never,
      keyframes: { posX: { property: "posX", keyframes: [{ frame: 0, value: 1 }] } },
      gradeNodes: [{ id: "n", label: "2", enabled: true, grade: createDefaultColorGrade() }],
      speedRampKeyframes: [{ frame: 0, speed: 1 }, { frame: 300, speed: 2 }],
      nestedSequenceId: "nest1",
      captionText: "caption",
    };
    const project: EditorProject = {
      ...base,
      sequence: { ...base.sequence, clips: [clip], settings: { ...base.sequence.settings, masterVolume: 0.8, magneticTimeline: false } },
      subtitleCues: [{ id: "s", startFrame: 0, endFrame: 30, text: "sub", style: {} as never }],
      nestedSequences: { nest1: { ...base.sequence, id: "nest1" } },
      bins: [{ id: "b", name: "Bin", smart: { kind: "audio" } }],
      colorStills: [],
      duckingSettings: [],
    };
    const { project: loaded } = deserializeProject(serializeProject(project));
    expect(loaded).toEqual(project);
  });
});
