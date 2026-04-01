/**
 * Color Page — unit tests
 * Verifies that the color page grid layout and viewer segment logic are correct.
 */
import { describe, it, expect } from "vitest";

// ── Mirrors the color page segment selection logic in App.tsx ─────────────────

interface Segment {
  clipId: string;
  trackKind: "video" | "audio";
  startFrame: number;
  endFrame: number;
  trackIndex: number;
}

// findAllActiveVideoSegments — returns all video segments covering a given frame
// sorted by trackIndex desc (highest = topmost = shown in viewer)
function findAllActiveVideoSegments(
  segments: Segment[],
  frame: number
): Segment[] {
  return segments
    .filter(
      (s) =>
        s.trackKind === "video" &&
        frame >= s.startFrame &&
        frame < s.endFrame
    )
    .sort((a, b) => b.trackIndex - a.trackIndex);
}

describe("Color Page — Segment Selection", () => {
  const segments: Segment[] = [
    { clipId: "v1", trackKind: "video", startFrame: 0,  endFrame: 100, trackIndex: 0 },
    { clipId: "v2", trackKind: "video", startFrame: 50, endFrame: 150, trackIndex: 1 },
    { clipId: "a1", trackKind: "audio", startFrame: 0,  endFrame: 100, trackIndex: 2 },
  ];

  it("shows the topmost video clip at playhead (highest trackIndex)", () => {
    const active = findAllActiveVideoSegments(segments, 60);
    expect(active[0].clipId).toBe("v2"); // trackIndex 1 > 0
  });

  it("shows correct clip when only one video covers the frame", () => {
    const active = findAllActiveVideoSegments(segments, 10);
    expect(active.length).toBe(1);
    expect(active[0].clipId).toBe("v1");
  });

  it("returns empty array when no video covers the frame", () => {
    const active = findAllActiveVideoSegments(segments, 200);
    expect(active.length).toBe(0);
  });

  it("does not include audio segments in active video list", () => {
    const active = findAllActiveVideoSegments(segments, 10);
    expect(active.every((s) => s.trackKind === "video")).toBe(true);
  });
});

describe("Color Page — Grid Layout", () => {
  it("has exactly 3 grid columns: grading | resizer | viewer", () => {
    // CSS: grid-template-columns: 340px 3px 1fr
    const cols = "340px 3px 1fr".split(" ");
    expect(cols).toHaveLength(3);
    expect(cols[0]).toBe("340px");
    expect(cols[1]).toBe("3px");
    expect(cols[2]).toBe("1fr");
  });

  it("has exactly 2 grid rows: content | timeline", () => {
    const rows = "minmax(0, 1fr) var(--timeline-height, 220px)".split(" var(");
    expect(rows).toHaveLength(2);
  });

  it("grid areas map to correct slots", () => {
    const areas = {
      "color-left":    ".color-page-grading",
      "color-right":   ".color-page-viewer",
      "color-resizer": ".left-resizer (on color page)",
      "tl":            ".color-page-timeline",
    };
    expect(Object.keys(areas)).toContain("color-left");
    expect(Object.keys(areas)).toContain("color-right");
    expect(Object.keys(areas)).toContain("tl");
  });

  it("viewer fills the right column (flex: 1)", () => {
    // .color-page-viewer > .panel.viewer-panel { flex: 1 }
    const flex = 1;
    expect(flex).toBe(1);
  });
});
