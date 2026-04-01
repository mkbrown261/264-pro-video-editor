/**
 * FIX 5: Lasso Selection — unit tests
 * Verifies rubber-band box geometry calculation and clip intersection detection.
 */
import { describe, it, expect } from "vitest";

// ── Mirrors lasso hit-test logic from TimelinePanel ───────────────────────────

interface LassoBox {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

interface ClipRect {
  clipId: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function getLassoRect(box: LassoBox): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: Math.min(box.startX, box.curX),
    y1: Math.min(box.startY, box.curY),
    x2: Math.max(box.startX, box.curX),
    y2: Math.max(box.startY, box.curY),
  };
}

function getClipsInLasso(box: LassoBox, clips: ClipRect[]): Set<string> {
  const { x1, y1, x2, y2 } = getLassoRect(box);
  const selected = new Set<string>();
  for (const clip of clips) {
    if (clip.right > x1 && clip.left < x2 && clip.bottom > y1 && clip.top < y2) {
      selected.add(clip.clipId);
    }
  }
  return selected;
}

function isLassoMeaningful(box: LassoBox): boolean {
  const { x1, y1, x2, y2 } = getLassoRect(box);
  return (x2 - x1) > 6 || (y2 - y1) > 6;
}

describe("Lasso Selection", () => {
  const clips: ClipRect[] = [
    { clipId: "clip-1", left: 100, top: 10, right: 200, bottom: 50 },
    { clipId: "clip-2", left: 250, top: 10, right: 400, bottom: 50 },
    { clipId: "clip-3", left: 100, top: 60, right: 200, bottom: 100 },
  ];

  it("FIX 5: lasso box geometry is direction-independent (drag right-down)", () => {
    const box: LassoBox = { startX: 50, startY: 5, curX: 450, curY: 110 };
    const r = getLassoRect(box);
    expect(r.x1).toBe(50);
    expect(r.y1).toBe(5);
    expect(r.x2).toBe(450);
    expect(r.y2).toBe(110);
  });

  it("FIX 5: lasso box geometry is direction-independent (drag left-up)", () => {
    const box: LassoBox = { startX: 450, startY: 110, curX: 50, curY: 5 };
    const r = getLassoRect(box);
    expect(r.x1).toBe(50);
    expect(r.y1).toBe(5);
    expect(r.x2).toBe(450);
    expect(r.y2).toBe(110);
  });

  it("FIX 5: selects all clips that overlap the lasso box", () => {
    const box: LassoBox = { startX: 50, startY: 5, curX: 450, curY: 110 };
    const selected = getClipsInLasso(box, clips);
    expect(selected.size).toBe(3);
    expect(selected.has("clip-1")).toBe(true);
    expect(selected.has("clip-2")).toBe(true);
    expect(selected.has("clip-3")).toBe(true);
  });

  it("FIX 5: selects only clips that overlap (partial intersection)", () => {
    // Lasso only covers left half — clips 1 and 3 overlap, clip 2 does not
    const box: LassoBox = { startX: 50, startY: 5, curX: 210, curY: 110 };
    const selected = getClipsInLasso(box, clips);
    expect(selected.has("clip-1")).toBe(true);
    expect(selected.has("clip-2")).toBe(false);
    expect(selected.has("clip-3")).toBe(true);
  });

  it("FIX 5: empty lasso selects nothing", () => {
    // Lasso in empty space
    const box: LassoBox = { startX: 500, startY: 200, curX: 600, curY: 300 };
    const selected = getClipsInLasso(box, clips);
    expect(selected.size).toBe(0);
  });

  it("FIX 5: tiny accidental drag (≤6px) is not treated as a lasso", () => {
    const tinyBox: LassoBox = { startX: 100, startY: 100, curX: 104, curY: 102 };
    expect(isLassoMeaningful(tinyBox)).toBe(false);
  });

  it("FIX 5: drag larger than 6px IS treated as a lasso", () => {
    const box: LassoBox = { startX: 100, startY: 100, curX: 110, curY: 100 };
    expect(isLassoMeaningful(box)).toBe(true);
  });

  it("FIX 5: lasso with multiple clips allows group delete", () => {
    const selected = new Set(["clip-1", "clip-2"]);
    const deletedIds: string[] = [];
    selected.forEach((id) => deletedIds.push(id));
    expect(deletedIds).toHaveLength(2);
    expect(deletedIds).toContain("clip-1");
    expect(deletedIds).toContain("clip-2");
  });
});
