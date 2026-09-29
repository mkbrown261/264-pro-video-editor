/**
 * Beat tracking for cutting to music.
 *
 *  1. Onset strength: log-energy rise per ~11.6 ms hop.
 *  2. Tempo: autocorrelation of the onset curve over 60–200 BPM, weighted
 *     toward ~120 BPM so half/double-tempo errors lose to the true pulse.
 *  3. Phase: the grid offset that lands on the most onset energy.
 *  4. Beats: walk the grid, letting each beat snap to the strongest onset
 *     within ±10 % of a period, so slow tempo drift is followed.
 */

export interface BeatTrack {
  bpm: number;
  /** Beat times in seconds. */
  beats: number[];
  /** Onset strength at each beat, 0–1 (relative to the strongest). */
  strengths: number[];
  /** 0–1: how periodic the onsets are. */
  confidence: number;
}

function onsetCurve(pcm: Float32Array, sampleRate: number, hop: number): Float32Array {
  const n = Math.floor(pcm.length / hop);
  const out = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * hop, e = j + hop; j < e; j++) sum += pcm[j] * pcm[j];
    const level = Math.log(1e-5 + Math.sqrt(sum / hop));
    out[i] = i === 0 ? 0 : Math.max(0, level - prev);
    prev = level;
  }
  // Remove the slowly varying part so sustained loud passages don't dominate.
  const w = Math.max(1, Math.round(0.5 * sampleRate / hop));
  const detr = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += out[i];
    if (i >= w) acc -= out[i - w];
    detr[i] = Math.max(0, out[i] - acc / Math.min(i + 1, w));
  }
  return detr;
}

export function trackBeats(pcm: Float32Array, sampleRate: number, minBpm = 60, maxBpm = 200): BeatTrack {
  const hop = Math.max(1, Math.round(sampleRate / 86));
  const fps = sampleRate / hop; // onset frames per second
  const env = onsetCurve(pcm, sampleRate, hop);
  const n = env.length;
  const empty: BeatTrack = { bpm: 0, beats: [], strengths: [], confidence: 0 };
  if (n < fps * 4) return empty;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= n;
  const x = Float32Array.from(env, (v) => v - mean);
  let energy = 0;
  for (let i = 0; i < n; i++) energy += x[i] * x[i];
  if (energy <= 0) return empty;

  // Tempo from autocorrelation, with a log-normal prior centred on 120 BPM.
  const minLag = Math.floor((60 / maxBpm) * fps), maxLag = Math.ceil((60 / minBpm) * fps);
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    ac[lag] = s / energy;
  }
  let bestLag = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const score = ac[lag] * prior;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  const l = ac[bestLag - 1], c = ac[bestLag], r = ac[bestLag + 1];
  const denom = l - 2 * c + r;
  const period = bestLag + (denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / denom)) : 0);

  // Phase: offset whose grid collects the most onset energy.
  let bestPhase = 0, bestSum = -Infinity;
  for (let p = 0; p < period; p += 0.5) {
    let s = 0;
    for (let t = p; t < n; t += period) s += env[Math.round(t)] ?? 0;
    if (s > bestSum) { bestSum = s; bestPhase = p; }
  }

  // Walk the grid, snapping each beat to the local onset peak.
  const win = Math.max(1, Math.round(period * 0.1));
  const beatsF: number[] = [];
  for (let t = bestPhase; t < n; ) {
    const grid = Math.round(t);
    let at = Math.min(n - 1, grid), best = -1;
    for (let k = Math.max(0, grid - win); k <= Math.min(n - 1, grid + win); k++) {
      const score = env[k] * (1 - 0.3 * Math.abs(k - grid) / win); // prefer the grid when unsure
      if (score > best) { best = score; at = k; }
    }
    beatsF.push(at);
    t = at + period;
  }
  let maxS = 0;
  for (const b of beatsF) maxS = Math.max(maxS, env[b]);
  return {
    bpm: Math.round((60 * fps / period) * 10) / 10,
    beats: beatsF.map((f) => (f * hop) / sampleRate),
    strengths: beatsF.map((f) => (maxS > 0 ? env[f] / maxS : 0)),
    confidence: Math.max(0, Math.min(1, c)),
  };
}
