/**
 * FIX 9: Snap Line — unit tests
 * Verifies the magnetic-snap logic: blue line appears only at clip edges,
 * never when snap is disabled, and disappears when no clip is nearby.
 */
import { describe, it, expect } from "vitest";

// ── Mirrors the snap detection logic from TimelinePanel ───────────────────────

interface SnapResult {
  snappedFrame: number | null;
  isClipEdge: boolean;
}

function detectSnap(
  ghostFrame: number,
  clipEdges: number[],
  playheadFrame: number,
  snapEnabled: boolean,
  pixelsPerFrame: number,
  MAGNETIC_SNAP_PX = 10
): SnapResult {
  if (!snapEnabled) return { snappedFrame: null, isClipEdge: false };

  const threshFrames = MAGNETIC_SNAP_PX / pixelsPerFrame;
  const allCandidates = [...clipEdges, playheadFrame];

  let bestFrame: number | null = null;
  let bestDist = threshFrames;
  let bestIsClipEdge = false;

  for (const candidate of allCandidates) {
    const dist = Math.abs(ghostFrame - candidate);
    if (dist < bestDist) {
      bestDist = dist;
      bestFrame = candidate;
      bestIsClipEdge = clipEdges.includes(candidate);
    }
  }

  return { snappedFrame: bestFrame, isClipEdge: bestIsClipEdge };
}

describe("Snap Line Logic", () => {
  const PPF = 6; // 6 pixels per frame — standard zoom
  const clipEdges = [30, 60, 90]; // clip start/end frames

  it("FIX 9: snap indicator is null when snap is disabled", () => {
    const r = detectSnap(30, clipEdges, 45, false, PPF);
    expect(r.snappedFrame).toBeNull();
    expect(r.isClipEdge).toBe(false);
  });

  it("FIX 9: snap indicator shows at clip edge when within threshold", () => {
    // Ghost is 1 frame away from edge at frame 30 (within 10px threshold at PPF=6)
    const r = detectSnap(31, clipEdges, 45, true, PPF);
    expect(r.snappedFrame).toBe(30);
    expect(r.isClipEdge).toBe(true);
  });

  it("FIX 9: snap indicator does NOT show when snapping to playhead (not clip edge)", () => {
    // Ghost is near playhead (frame 45) but no clip edge is close
    const r = detectSnap(46, clipEdges, 45, true, PPF);
    expect(r.snappedFrame).toBe(45);
    // Playhead snap — isClipEdge should be false
    expect(r.isClipEdge).toBe(false);
  });

  it("FIX 9: snap indicator is null when no candidate is within threshold", () => {
    // Ghost is at frame 50, nearest clip edge is 60 (10 frames away, > 10/6 threshold)
    const r = detectSnap(50, clipEdges, 100, true, PPF);
    // threshold = 10/6 ≈ 1.67 frames; 50 → 60 is 10 frames away → no snap
    expect(r.snappedFrame).toBeNull();
  });

  it("snaps to nearest clip edge when two edges are close", () => {
    // Ghost at frame 59 — nearer to 60 than 30
    const r = detectSnap(59, clipEdges, 100, true, PPF);
    expect(r.snappedFrame).toBe(60);
    expect(r.isClipEdge).toBe(true);
  });

  it("snap threshold scales with zoom (larger PPF = tighter threshold in frames)", () => {
    const largePPF = 20;
    // threshold = 10/20 = 0.5 frames — ghost must be within half a frame
    const rFar = detectSnap(31, clipEdges, 100, true, largePPF);
    // 31 is 1 frame from edge 30, but threshold is 0.5 frames → no snap
    expect(rFar.snappedFrame).toBeNull();

    const rClose = detectSnap(30, clipEdges, 100, true, largePPF);
    expect(rClose.snappedFrame).toBe(30);
  });
});
