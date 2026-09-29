import { describe, it, expect } from "vitest";
import { trackBeats } from "../shared/beatTrack";

const SR = 22050;
function track(bpm: number, seconds: number, offset: number, opts: { hats?: boolean; drift?: number } = {}) {
  const out = new Float32Array(seconds * SR);
  let s = 42;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < out.length; i++) out[i] = (rnd() - 0.5) * 0.02;
  const truth: number[] = [];
  const hit = (t: number, amp: number, freq: number, len = 0.06) => {
    const st = Math.floor(t * SR);
    for (let j = 0; j < len * SR && st + j < out.length; j++) out[st + j] += amp * Math.sin((2 * Math.PI * freq * j) / SR) * Math.exp(-j / (0.015 * SR));
  };
  let period = 60 / bpm;
  for (let t = offset; t < seconds - 0.2; t += period) {
    truth.push(t);
    hit(t, 0.9, 60);
    if (opts.hats) hit(t + period / 2, 0.25, 6000, 0.02);
    if (opts.drift) period *= 1 + opts.drift;
  }
  return { pcm: out, truth };
}
const within = (beats: number[], truth: number[], tol: number) =>
  truth.filter((t) => beats.some((b) => Math.abs(b - t) < tol)).length / truth.length;

describe("beat tracking", () => {
  it("finds tempo and beats of a 128 BPM track with off-beat hats", () => {
    const { pcm, truth } = track(128, 30, 0.25, { hats: true });
    const r = trackBeats(pcm, SR);
    expect(Math.abs(r.bpm - 128)).toBeLessThan(1.5);
    expect(within(r.beats, truth, 0.03)).toBeGreaterThan(0.9);
    expect(r.beats.length).toBeLessThan(truth.length * 1.1); // not double-time
  });

  it("handles a slow tempo", () => {
    const { pcm, truth } = track(84, 30, 0.6);
    const r = trackBeats(pcm, SR);
    expect(Math.abs(r.bpm - 84)).toBeLessThan(1.5);
    expect(within(r.beats, truth, 0.03)).toBeGreaterThan(0.9);
  });

  it("follows slight tempo drift", () => {
    const { pcm, truth } = track(120, 40, 0.1, { drift: 0.0008 });
    const r = trackBeats(pcm, SR);
    expect(within(r.beats, truth, 0.035)).toBeGreaterThan(0.85);
  });

  it("returns nothing for silence", () => {
    expect(trackBeats(new Float32Array(SR * 10), SR).beats).toEqual([]);
  });
});
