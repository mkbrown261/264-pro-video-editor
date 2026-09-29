import { describe, it, expect } from "vitest";
import { estimateAudioOffset } from "../shared/audioSync";

const SR = 8000;
// Deterministic pseudo-random bursts (speech-like onsets over room tone).
function scene(seconds: number, seed = 1): Float32Array {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out = new Float32Array(seconds * SR);
  for (let i = 0; i < out.length; i++) out[i] = (rnd() - 0.5) * 0.01;
  for (let t = 0.3; t < seconds - 0.5; t += 0.2 + rnd() * 0.9) {
    const start = Math.floor(t * SR), len = Math.floor((0.05 + rnd() * 0.3) * SR), amp = 0.2 + rnd() * 0.6;
    for (let j = 0; j < len && start + j < out.length; j++) out[start + j] += amp * Math.sin(j * (0.05 + rnd() * 0.3)) * Math.exp(-j / len);
  }
  return out;
}
/** The same scene as heard by another mic: starts `delay` s later, different gain + its own noise and tone. */
function otherMic(src: Float32Array, delay: number, seconds: number, seed: number): Float32Array {
  const out = new Float32Array(seconds * SR);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const d = Math.round(delay * SR);
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    const x = src[i - d] ?? 0;
    lp = lp * 0.6 + x * 0.4; // duller mic
    out[i] = 0.5 * lp + (rnd() - 0.5) * 0.03;
  }
  return out;
}

describe("audio sync", () => {
  it("finds a positive lag between two mics", () => {
    const ref = scene(40);
    const r = estimateAudioOffset(ref, otherMic(ref, 2.37, 40, 7), SR, 10);
    expect(r.lagSeconds).toBeCloseTo(2.37, 1);
    expect(Math.abs(r.lagSeconds - 2.37)).toBeLessThan(0.02);
    expect(r.confidence).toBeGreaterThan(0.3);
  });

  it("finds a negative lag (other camera started earlier)", () => {
    const ref = scene(40, 3);
    const early = otherMic(ref, -4.1, 40, 11);
    const r = estimateAudioOffset(ref, early, SR, 10);
    expect(Math.abs(r.lagSeconds + 4.1)).toBeLessThan(0.02);
  });

  it("reports low confidence for unrelated audio", () => {
    const r = estimateAudioOffset(scene(30, 5), scene(30, 99), SR, 10);
    expect(r.confidence).toBeLessThan(0.2);
  });
});
