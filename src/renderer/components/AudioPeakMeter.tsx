/**
 * AudioPeakMeter — Real-time VU meters using Web Audio API AnalyserNode.
 * Shows L/R channel levels with peak hold, clipping warning, and dB scale.
 */
import React, { useEffect, useRef, useCallback } from "react";

interface AudioPeakMeterProps {
  /** The audio context to attach the analyser to */
  audioContext: AudioContext | null;
  /** Source node to analyse (e.g., destination or a gain node) */
  sourceNode?: AudioNode | null;
  /** Number of channels to show (1=mono, 2=stereo) */
  channels?: number;
}

const DECAY_RATE = 0.92;
const PEAK_HOLD_MS = 1500;
const CLIP_THRESHOLD = 0.98; // above this = clip

interface MeterState {
  rms: number;
  peak: number;
  peakTime: number;
  clipping: boolean;
}

const DB_SCALE = [-60, -48, -36, -24, -18, -12, -9, -6, -3, 0];

function rmsToDb(rms: number): number {
  if (rms <= 0) return -Infinity;
  return 20 * Math.log10(rms);
}

function dbToNorm(db: number): number {
  // Map -60..0 dB → 0..1
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

function MeterBar({ level, peak, clipping, label }: {
  level: number;
  peak: number;
  clipping: boolean;
  label?: string;
}) {
  const COLOR_SAFE = "#2fc77a";
  const COLOR_WARN = "#f7c948";
  const COLOR_CLIP = "#e53935";

  const meterColor = clipping
    ? COLOR_CLIP
    : level > 0.85
    ? COLOR_WARN
    : COLOR_SAFE;

  return (
    <div className="vu-meter-bar-wrap" aria-label={`Level: ${Math.round(level * 100)}%`}>
      {label && <div className="vu-label">{label}</div>}
      <div className="vu-bar-bg">
        {/* Filled level */}
        <div
          className="vu-bar-fill"
          style={{
            height: `${level * 100}%`,
            background: meterColor,
            boxShadow: clipping ? `0 0 6px ${COLOR_CLIP}` : undefined,
          }}
        />
        {/* Peak hold indicator */}
        {peak > 0.01 && (
          <div
            className="vu-peak-hold"
            style={{
              bottom: `${peak * 100}%`,
              background: peak > 0.85 ? COLOR_CLIP : COLOR_WARN,
            }}
          />
        )}
        {/* Clip indicator at top */}
        <div className={`vu-clip-indicator${clipping ? " vu-clipping" : ""}`} title="Clip" />
      </div>
    </div>
  );
}

export const AudioPeakMeter: React.FC<AudioPeakMeterProps> = ({
  audioContext,
  sourceNode,
  channels = 2,
}) => {
  const analyserRef = useRef<AnalyserNode | null>(null);
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const analysersRef = useRef<AnalyserNode[]>([]);
  const rafRef = useRef<number | null>(null);
  const stateRef = useRef<MeterState[]>(
    Array.from({ length: channels }, () => ({ rms: 0, peak: 0, peakTime: 0, clipping: false }))
  );
  const [levels, setLevels] = React.useState<MeterState[]>(stateRef.current);

  // Setup analyser nodes
  useEffect(() => {
    if (!audioContext || !sourceNode) return;
    const fftSize = 256;

    // Stereo splitter
    const splitter = audioContext.createChannelSplitter(channels);
    const analysers = Array.from({ length: channels }, () => {
      const a = audioContext.createAnalyser();
      a.fftSize = fftSize;
      a.smoothingTimeConstant = 0.5;
      return a;
    });

    try {
      sourceNode.connect(splitter);
      analysers.forEach((a, i) => {
        try { splitter.connect(a, i, 0); } catch {}
      });
    } catch {}

    splitterRef.current = splitter;
    analysersRef.current = analysers;

    return () => {
      try { sourceNode.disconnect(splitter); } catch {}
      analysers.forEach(a => { try { a.disconnect(); } catch {} });
    };
  }, [audioContext, sourceNode, channels]);

  // Animation loop
  const tick = useCallback(() => {
    const now = Date.now();
    const newStates = analysersRef.current.map((analyser, i) => {
      const buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buf);
      // Compute RMS
      let sum = 0;
      for (let j = 0; j < buf.length; j++) sum += buf[j] * buf[j];
      const rms = Math.sqrt(sum / buf.length);

      const prev = stateRef.current[i];
      // Decay
      const decayedRms = Math.max(rms, prev.rms * DECAY_RATE);
      // Peak hold
      let peak = prev.peak;
      let peakTime = prev.peakTime;
      if (rms > peak) {
        peak = rms;
        peakTime = now;
      } else if (now - peakTime > PEAK_HOLD_MS) {
        peak = Math.max(0, peak - 0.005);
      }
      const clipping = rms > CLIP_THRESHOLD;
      return { rms: decayedRms, peak, peakTime, clipping };
    });
    stateRef.current = newStates;
    setLevels([...newStates]);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (!audioContext) return;
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [audioContext, tick]);

  // Fallback: no analyser — just show static bars
  const showFallback = !audioContext || analysersRef.current.length === 0;
  const displayLevels = showFallback
    ? Array.from({ length: channels }, () => ({ rms: 0, peak: 0, peakTime: 0, clipping: false }))
    : levels;

  return (
    <div className="vu-meter-container" aria-label="Audio levels">
      <div className="vu-db-scale">
        {DB_SCALE.map(db => (
          <div key={db} className="vu-db-tick" style={{ bottom: `${dbToNorm(db) * 100}%` }}>
            <span>{db}</span>
          </div>
        ))}
      </div>
      <div className="vu-bars">
        {displayLevels.map((state, i) => (
          <MeterBar
            key={i}
            level={dbToNorm(rmsToDb(state.rms))}
            peak={dbToNorm(rmsToDb(state.peak))}
            clipping={state.clipping}
            label={channels === 2 ? (i === 0 ? "L" : "R") : undefined}
          />
        ))}
      </div>
    </div>
  );
};
