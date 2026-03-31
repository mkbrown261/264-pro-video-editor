/**
 * useWaveformExtractor
 *
 * For each audio/video asset in the project that doesn't yet have
 * waveformPeaks, fires off a Web Audio API decode to extract
 * ~100ms-resolution peak amplitudes and stores them via setAssetWaveform.
 *
 * Peaks are normalised to [0..1].
 * Only runs in browsers that support AudioContext.
 */
import { useEffect, useRef } from "react";
import type { MediaAsset } from "../../shared/models";

interface Options {
  assets: MediaAsset[];
  setAssetWaveform: (assetId: string, peaks: number[]) => void;
}

/** Samples per second for peak extraction (~1 per 100ms = 10 Hz) */
const PEAKS_PER_SECOND = 10;

async function extractPeaks(
  url: string,
  durationSeconds: number
): Promise<number[]> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return [];

  const ctx = new AudioCtx();
  try {
    const response = await fetch(url);
    const arrayBuf = await response.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(arrayBuf);

    // Mix down to mono by averaging all channels
    const numChannels = audioBuf.numberOfChannels;
    const length = audioBuf.length;
    const mono = new Float32Array(length);
    for (let ch = 0; ch < numChannels; ch++) {
      const data = audioBuf.getChannelData(ch);
      for (let i = 0; i < length; i++) mono[i] += data[i] / numChannels;
    }

    // Extract peak-per-block
    const totalPeaks = Math.max(1, Math.round(durationSeconds * PEAKS_PER_SECOND));
    const blockSize = Math.max(1, Math.floor(length / totalPeaks));
    const peaks: number[] = new Array(totalPeaks);
    for (let p = 0; p < totalPeaks; p++) {
      const start = p * blockSize;
      const end = Math.min(start + blockSize, length);
      let peak = 0;
      for (let i = start; i < end; i++) {
        const abs = Math.abs(mono[i]);
        if (abs > peak) peak = abs;
      }
      peaks[p] = peak;
    }

    // Normalise to [0..1]
    const max = Math.max(...peaks, 0.001);
    return peaks.map((v) => v / max);
  } finally {
    await ctx.close();
  }
}

export function useWaveformExtractor({ assets, setAssetWaveform }: Options) {
  const pendingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const asset of assets) {
      if (!asset.hasAudio) continue;
      if (asset.waveformPeaks?.length) continue;         // already extracted
      if (pendingRef.current.has(asset.id)) continue;   // already in-flight

      const url = asset.previewUrl || asset.sourcePath;
      if (!url) continue;

      pendingRef.current.add(asset.id);
      extractPeaks(url, asset.durationSeconds)
        .then((peaks) => {
          if (peaks.length) setAssetWaveform(asset.id, peaks);
        })
        .catch(() => { /* silently skip — waveform is cosmetic */ })
        .finally(() => pendingRef.current.delete(asset.id));
    }
  }, [assets, setAssetWaveform]);
}
