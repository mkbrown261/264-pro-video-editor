/**
 * Audio sync by cross-correlation (multicam / dual-system sound).
 *
 * Raw waveforms from different microphones differ in phase and tone, so we
 * correlate onset envelopes instead: RMS per 10 ms hop → log energy → positive
 * change. Normalised cross-correlation over the overlap picks the lag, and a
 * parabolic fit refines it below one hop.
 */

const HOP_SECONDS = 0.01;

export function onsetEnvelope(pcm: Float32Array, sampleRate: number): Float32Array {
  const hop = Math.max(1, Math.round(sampleRate * HOP_SECONDS));
  const n = Math.floor(pcm.length / hop);
  const env = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * hop, e = j + hop; j < e; j++) sum += pcm[j] * pcm[j];
    const level = Math.log(1e-4 + Math.sqrt(sum / hop));
    env[i] = i === 0 ? 0 : Math.max(0, level - prev);
    prev = level;
  }
  return env;
}

export interface SyncEstimate {
  /** Seconds by which `other`'s content lags `reference` (event at t in reference is at t + lag in other). */
  lagSeconds: number;
  /** Peak normalised correlation, 0–1. Below ~0.2 the match is unreliable. */
  confidence: number;
}

export function estimateAudioOffset(
  reference: Float32Array, other: Float32Array, sampleRate: number, maxLagSeconds = 60,
): SyncEstimate {
  const a = onsetEnvelope(reference, sampleRate);
  const b = onsetEnvelope(other, sampleRate);
  const maxLag = Math.min(Math.round(maxLagSeconds / HOP_SECONDS), Math.max(a.length, b.length));
  const minOverlap = Math.min(a.length, b.length, Math.round(2 / HOP_SECONDS));
  const score = (lag: number): number => {
    // Pearson correlation of a[j] and b[j + lag] over their overlap.
    const start = Math.max(0, -lag), end = Math.min(a.length, b.length - lag);
    const n = end - start;
    if (n < minOverlap || n <= 1) return -1;
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let j = start; j < end; j++) {
      const x = a[j], y = b[j + lag];
      sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y;
    }
    const cov = sab - (sa * sb) / n;
    const va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
    return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : -1;
  };
  let best = 0, bestScore = -Infinity;
  const scores = new Map<number, number>();
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const s = score(lag);
    scores.set(lag, s);
    if (s > bestScore) { bestScore = s; best = lag; }
  }
  // Parabolic interpolation around the peak.
  const l = scores.get(best - 1) ?? bestScore, r = scores.get(best + 1) ?? bestScore;
  const denom = l - 2 * bestScore + r;
  const frac = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / denom)) : 0;
  return { lagSeconds: (best + frac) * HOP_SECONDS, confidence: Math.max(0, bestScore) };
}
