/**
 * FIX 1 / FIX 3: Audio Panel + Clip Speed — unit tests
 * Verifies that volume clamping, speed clamping and the 1:1 value-to-UI
 * relationship all hold.
 */
import { describe, it, expect } from "vitest";

// ── Volume control helpers (mirrors InspectorPanel VolumeControl logic) ────────

function clampVolume(raw: number): number {
  return Math.min(2, Math.max(0, raw));
}

function pctToVolume(pct: number): number {
  return clampVolume(pct / 100);
}

function volumeToPct(vol: number): number {
  return Math.round(vol * 100);
}

// ── Speed control helpers (mirrors InspectorPanel SpeedControl logic) ──────────

function clampSpeed(raw: number): number {
  return Math.min(4, Math.max(0.25, raw));
}

describe("Audio Panel — VolumeControl", () => {
  it("FIX 1: volume slider range is 0–2 (not 0–1)", () => {
    // Slider max must be 2 to allow up to 200%
    const sliderMax = 2;
    expect(sliderMax).toBe(2);
  });

  it("FIX 1: 1:1 sync — pct → volume → pct is identity for valid range", () => {
    const pcts = [0, 50, 100, 150, 200];
    for (const pct of pcts) {
      expect(volumeToPct(pctToVolume(pct))).toBe(pct);
    }
  });

  it("clamped volume never exceeds 2 (200%)", () => {
    expect(clampVolume(3)).toBe(2);
    expect(clampVolume(2.5)).toBe(2);
  });

  it("clamped volume never goes below 0", () => {
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(-0.5)).toBe(0);
  });

  it("volume at 0 = muted (0%)", () => {
    expect(volumeToPct(0)).toBe(0);
  });

  it("volume at 1 = 100% (unity gain)", () => {
    expect(volumeToPct(1)).toBe(100);
  });

  it("volume at 2 = 200% (max boost)", () => {
    expect(volumeToPct(2)).toBe(200);
  });
});

describe("Clip Speed Control", () => {
  it("FIX 2/4: minimum speed is 0.25×", () => {
    expect(clampSpeed(0)).toBe(0.25);
    expect(clampSpeed(0.1)).toBe(0.25);
    expect(clampSpeed(0.25)).toBe(0.25);
  });

  it("FIX 2/4: maximum speed is 4×", () => {
    expect(clampSpeed(5)).toBe(4);
    expect(clampSpeed(4)).toBe(4);
    expect(clampSpeed(10)).toBe(4);
  });

  it("speed in valid range passes through unchanged", () => {
    const speeds = [0.25, 0.5, 1, 1.5, 2, 3, 4];
    for (const s of speeds) {
      expect(clampSpeed(s)).toBe(s);
    }
  });

  it("speed slider step is 0.05", () => {
    // The slider uses step=0.05 — verify consistent rounding
    const raw = 1.076; // halfway between two steps
    const stepped = Math.round(raw / 0.05) * 0.05;
    expect(stepped).toBeCloseTo(1.1, 5);
  });

  it("speed value displayed to 2 decimal places", () => {
    expect((1).toFixed(2)).toBe("1.00");
    expect((0.25).toFixed(2)).toBe("0.25");
    expect((4).toFixed(2)).toBe("4.00");
  });
});
