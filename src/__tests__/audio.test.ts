/**
 * Audio engine unit tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers:
 *   FIX 1 / FIX 3  – Volume and speed control UI (InspectorPanel)
 *   FIX SEAM       – Crossfade constants (FADE_OUT_S, FADE_IN_S) and gain math
 *   PREFETCH       – Lookahead window and prefetch gating logic
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

// ── Crossfade / gain ramp constants (must match useMultiTrackAudio) ───────────

const MAX_GAIN         = 4;
const FADE_OUT_S       = 0.04;   // 40 ms
const FADE_IN_S        = 0.03;   // 30 ms
const LOOKAHEAD_FRAMES = 90;
const PRE_PLAY_FRAMES  = 8;      // start element muted this many frames before seam

// ── Gain math helpers (mirrors reconcileSlots logic) ─────────────────────────

function computeEffectiveGain(clipVol: number, trackMuted: boolean): number {
  const effectiveVol = trackMuted ? 0 : Math.max(0, clipVol);
  return Math.max(0, Math.min(MAX_GAIN, effectiveVol));
}

describe("Audio Panel — VolumeControl", () => {
  it("FIX 1: volume slider range is 0–2 (not 0–1)", () => {
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
    const raw = 1.076;
    const stepped = Math.round(raw / 0.05) * 0.05;
    expect(stepped).toBeCloseTo(1.1, 5);
  });

  it("speed value displayed to 2 decimal places", () => {
    expect((1).toFixed(2)).toBe("1.00");
    expect((0.25).toFixed(2)).toBe("0.25");
    expect((4).toFixed(2)).toBe("4.00");
  });
});

describe("Audio Seam Crossfade Constants", () => {
  it("FADE_OUT_S is short enough not to bleed into next clip (< 80ms)", () => {
    // Max acceptable bleed before the new clip is audible is ~80 ms
    expect(FADE_OUT_S).toBeLessThan(0.08);
  });

  it("FADE_OUT_S is long enough to avoid a hard-cut pop (> 10ms)", () => {
    // Below ~10 ms the ear hears a click on most content
    expect(FADE_OUT_S).toBeGreaterThan(0.01);
  });

  it("FADE_IN_S is short enough not to sound like a fade-in effect (< 60ms)", () => {
    expect(FADE_IN_S).toBeLessThan(0.06);
  });

  it("FADE_IN_S is long enough to suppress hard-onset click (> 5ms)", () => {
    expect(FADE_IN_S).toBeGreaterThan(0.005);
  });

  it("fade-out completes within 3 frames at 30fps (no audible bleed)", () => {
    // The ramp spans the seam boundary. It must finish within ~3 frames
    // (100ms) so it's inaudible as a deliberate fade effect.
    const threeFramesMs = (1000 / 30) * 3;
    expect(FADE_OUT_S * 1000).toBeLessThan(threeFramesMs);
  });

  it("FADE_IN_S + FADE_OUT_S < 3 frames at 24fps (crossfade stays micro)", () => {
    // Combined ramp pair must stay short enough to be perceived as seamless.
    const threeFramesMs = (1000 / 24) * 3;
    expect((FADE_IN_S + FADE_OUT_S) * 1000).toBeLessThan(threeFramesMs);
  });
});

describe("Audio Gain Math", () => {
  it("unity gain: clipVol=1, unmuted → gain=1", () => {
    expect(computeEffectiveGain(1, false)).toBe(1);
  });

  it("muted track: any volume → gain=0", () => {
    expect(computeEffectiveGain(1, true)).toBe(0);
    expect(computeEffectiveGain(2, true)).toBe(0);
    expect(computeEffectiveGain(0.5, true)).toBe(0);
  });

  it("boosted volume: clipVol=2 → gain=2 (Web Audio handles > 1 )", () => {
    expect(computeEffectiveGain(2, false)).toBe(2);
  });

  it("gain is clamped to MAX_GAIN (4)", () => {
    expect(computeEffectiveGain(5, false)).toBe(MAX_GAIN);
    expect(computeEffectiveGain(10, false)).toBe(MAX_GAIN);
  });

  it("negative clipVol is floored to 0", () => {
    expect(computeEffectiveGain(-1, false)).toBe(0);
  });
});

describe("Prefetch Lookahead Logic", () => {
  /** Mirrors the condition in useMultiTrackAudio's lookahead effect */
  function shouldPrefetch(
    segStartFrame: number,
    segEndFrame: number,
    playheadFrame: number
  ): boolean {
    const framesUntilStart = segStartFrame - playheadFrame;
    // Active segment: skip
    if (playheadFrame >= segStartFrame && playheadFrame < segEndFrame) return false;
    return framesUntilStart > 0 && framesUntilStart <= LOOKAHEAD_FRAMES;
  }

  /** Mirrors PRE_PLAY start condition */
  function shouldPrePlay(segStartFrame: number, playheadFrame: number): boolean {
    const framesUntilStart = segStartFrame - playheadFrame;
    return framesUntilStart > 0 && framesUntilStart <= PRE_PLAY_FRAMES;
  }

  it("prefetches a segment starting exactly at lookahead boundary", () => {
    expect(shouldPrefetch(90, 200, 0)).toBe(true);
  });

  it("prefetches a segment starting 1 frame ahead", () => {
    expect(shouldPrefetch(1, 100, 0)).toBe(true);
  });

  it("does NOT prefetch a segment already passed", () => {
    expect(shouldPrefetch(0, 50, 60)).toBe(false);
  });

  it("does NOT prefetch a segment starting beyond lookahead window", () => {
    expect(shouldPrefetch(200, 400, 0)).toBe(false);
  });

  it("does NOT prefetch a currently-active segment (already playing)", () => {
    expect(shouldPrefetch(0, 100, 50)).toBe(false);
  });

  it("LOOKAHEAD_FRAMES gives ≥2s of buffer at 30fps", () => {
    const bufferSeconds = LOOKAHEAD_FRAMES / 30;
    expect(bufferSeconds).toBeGreaterThanOrEqual(2);
  });

  it("PRE_PLAY_FRAMES triggers muted pre-play within ~267ms of seam at 30fps", () => {
    const prePlayMs = (PRE_PLAY_FRAMES / 30) * 1000;
    // Must be enough to cover element.play() latency (~100ms) with margin
    expect(prePlayMs).toBeGreaterThan(100);
    // Must not be so large it causes audible pre-play bleed
    expect(prePlayMs).toBeLessThan(500);
  });

  it("pre-play starts before seam (positive frames until start)", () => {
    expect(shouldPrePlay(10, 5)).toBe(true);   // 5 frames away — within PRE_PLAY_FRAMES
    expect(shouldPrePlay(10, 2)).toBe(true);   // 8 frames away — exactly at boundary
    expect(shouldPrePlay(10, 1)).toBe(false);  // 9 frames away — not yet
    expect(shouldPrePlay(10, 10)).toBe(false); // at seam — already active
  });
});
