import React, { useState, useEffect, useRef } from "react";
import type { TimelineTrack, EQBand, CompressorSettings } from "../../shared/models";
import { createId } from "../../shared/models";

interface FairlightPanelProps {
  tracks: TimelineTrack[];
  fps: number;
  onUpdateTrack: (trackId: string, updates: Partial<TimelineTrack>) => void;
  masterVolume: number;
  onSetMasterVolume: (v: number) => void;
}

const DEFAULT_EQ_BANDS: EQBand[] = [
  { id: "hp",  type: "highpass",  frequency: 80,   gain: 0, q: 0.7, enabled: false },
  { id: "ls",  type: "lowshelf",  frequency: 200,  gain: 0, q: 0.7, enabled: true  },
  { id: "pk1", type: "peak",      frequency: 1000, gain: 0, q: 1.0, enabled: true  },
  { id: "hs",  type: "highshelf", frequency: 8000, gain: 0, q: 0.7, enabled: true  },
  { id: "lp",  type: "lowpass",   frequency: 16000,gain: 0, q: 0.7, enabled: false },
];

const DEFAULT_COMPRESSOR: CompressorSettings = {
  enabled: false,
  threshold: -24,
  ratio: 4,
  attack: 10,
  release: 100,
  makeupGain: 0,
  knee: 3,
};

function computeEQResponse(bands: EQBand[], freqs: number[]): number[] {
  return freqs.map(f => {
    let totalGain = 0;
    for (const band of bands) {
      if (!band.enabled) continue;
      const w = f / band.frequency;
      switch (band.type) {
        case "peak": {
          const logW = Math.log10(w);
          totalGain += band.gain * Math.exp(-logW * logW * band.q * 4);
          break;
        }
        case "lowshelf":
          totalGain += band.gain / (1 + Math.pow(f / band.frequency, 2));
          break;
        case "highshelf":
          totalGain += band.gain / (1 + Math.pow(band.frequency / f, 2));
          break;
        default:
          break;
      }
    }
    return Math.max(-18, Math.min(18, totalGain));
  });
}

interface TrackState {
  eq: EQBand[];
  compressor: CompressorSettings;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  armed: boolean;
  vuLevel: number;
}

export function FairlightPanel({ tracks, fps, onUpdateTrack, masterVolume, onSetMasterVolume }: FairlightPanelProps) {
  const audioTracks = tracks.filter(t => t.kind === "audio");
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(audioTracks[0]?.id ?? null);
  const [trackStates, setTrackStates] = useState<Record<string, TrackState>>(() => {
    const init: Record<string, TrackState> = {};
    tracks.forEach(t => {
      init[t.id] = {
        eq: t.eq ? [...t.eq] : DEFAULT_EQ_BANDS.map(b => ({ ...b, id: createId() })),
        compressor: t.compressor ? { ...t.compressor } : { ...DEFAULT_COMPRESSOR },
        volume: t.volume ?? 1,
        pan: 0,
        muted: t.muted,
        solo: t.solo,
        armed: false,
        vuLevel: 0,
      };
    });
    return init;
  });
  const [masterLimiter, setMasterLimiter] = useState(false);
  const [masterVuL, setMasterVuL] = useState(0);
  const [masterVuR, setMasterVuR] = useState(0);
  const animFrameRef = useRef<number>(0);
  const eqCanvasRef = useRef<HTMLCanvasElement>(null);

  const selectedState = selectedTrackId ? trackStates[selectedTrackId] : null;
  const selectedTrack = audioTracks.find(t => t.id === selectedTrackId);

  // Simulate VU meters
  useEffect(() => {
    let frame = 0;
    const animate = () => {
      frame++;
      if (frame % 4 === 0) {
        setMasterVuL(Math.random() * 0.6 + 0.1);
        setMasterVuR(Math.random() * 0.6 + 0.1);
        setTrackStates(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(id => {
            next[id] = { ...next[id], vuLevel: Math.random() * 0.5 + 0.05 };
          });
          return next;
        });
      }
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  // Draw EQ curve
  useEffect(() => {
    const canvas = eqCanvasRef.current;
    if (!canvas || !selectedState) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0a0e1a";
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 0.5;
    [0, 0.25, 0.5, 0.75, 1].forEach(y => {
      ctx.beginPath();
      ctx.moveTo(0, y * H);
      ctx.lineTo(W, y * H);
      ctx.stroke();
    });

    // EQ curve
    const freqs: number[] = [];
    for (let x = 0; x < W; x++) {
      freqs.push(20 * Math.pow(1000, x / W)); // 20Hz to 20kHz log
    }
    const gains = computeEQResponse(selectedState.eq, freqs);
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 2;
    ctx.beginPath();
    gains.forEach((g, x) => {
      const y = H / 2 - (g / 18) * (H / 2 - 4);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Zero line
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Band dots
    selectedState.eq.forEach(band => {
      if (!band.enabled) return;
      const x = (Math.log10(band.frequency / 20) / Math.log10(1000)) * W;
      const y = H / 2 - (band.gain / 18) * (H / 2 - 4);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#a855f7";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }, [selectedState]);

  function updateTrackState(trackId: string, updates: Partial<TrackState>) {
    setTrackStates(prev => ({ ...prev, [trackId]: { ...prev[trackId], ...updates } }));
    const ts = { ...trackStates[trackId], ...updates };
    onUpdateTrack(trackId, {
      volume: ts.volume,
      muted: ts.muted,
      solo: ts.solo,
      eq: ts.eq,
      compressor: ts.compressor,
    });
  }

  function updateEQBand(trackId: string, bandId: string, updates: Partial<EQBand>) {
    const eq = (trackStates[trackId]?.eq ?? DEFAULT_EQ_BANDS).map(b =>
      b.id === bandId ? { ...b, ...updates } : b
    );
    updateTrackState(trackId, { eq });
  }

  function updateCompressor(trackId: string, updates: Partial<CompressorSettings>) {
    const comp = { ...(trackStates[trackId]?.compressor ?? DEFAULT_COMPRESSOR), ...updates };
    updateTrackState(trackId, { compressor: comp });
  }

  const sliderStyle: React.CSSProperties = { accentColor: "#7c3aed", width: "100%" };
  const labelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3, display: "block" };

  function VUMeter({ level, width = 8, height = 60 }: { level: number; width?: number; height?: number }) {
    return (
      <div style={{ width, height, background: "#0a0e1a", borderRadius: 3, overflow: "hidden", position: "relative" }}>
        <div style={{
          position: "absolute",
          bottom: 0,
          width: "100%",
          height: `${level * 100}%`,
          background: level > 0.85 ? "#ef4444" : level > 0.65 ? "#f59e0b" : "#22c55e",
          transition: "height 0.05s",
        }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0d1117", color: "#e2e8f0", fontSize: 12, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>🎚 Fairlight Audio</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#7c3aed", fontWeight: 700, letterSpacing: "0.08em" }}>264 PRO AUDIO</span>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Track list */}
        <div style={{ width: 120, borderRight: "1px solid rgba(255,255,255,0.07)", overflowY: "auto", padding: "6px 0" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", padding: "4px 10px", letterSpacing: "0.08em" }}>TRACKS</div>
          {audioTracks.map(t => {
            const ts = trackStates[t.id];
            return (
              <div
                key={t.id}
                onClick={() => setSelectedTrackId(t.id)}
                style={{
                  padding: "6px 10px",
                  cursor: "pointer",
                  background: selectedTrackId === t.id ? "rgba(124,58,237,0.2)" : "transparent",
                  borderLeft: selectedTrackId === t.id ? "2px solid #7c3aed" : "2px solid transparent",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: selectedTrackId === t.id ? "#c4b5fd" : "#94a3b8" }}>{t.name}</span>
                <VUMeter level={ts?.vuLevel ?? 0} width={6} height={20} />
              </div>
            );
          })}
        </div>

        {/* EQ + Compressor */}
        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {selectedState && selectedTrackId && (
            <>
              {/* 5-band EQ */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ ...labelStyle, marginBottom: 8 }}>Parametric EQ (5-Band)</div>
                <canvas
                  ref={eqCanvasRef}
                  width={320} height={100}
                  style={{ width: "100%", height: 100, borderRadius: 6, display: "block", marginBottom: 8 }}
                />
                <div style={{ display: "flex", gap: 4 }}>
                  {selectedState.eq.map(band => (
                    <div key={band.id} style={{ flex: 1, background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: 6 }}>
                      <div style={{ fontSize: 9, color: "#64748b", fontWeight: 700, textAlign: "center", marginBottom: 4 }}>
                        {band.type.toUpperCase().slice(0, 2)}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 2 }}>
                          <input
                            type="checkbox" checked={band.enabled}
                            onChange={e => updateEQBand(selectedTrackId, band.id, { enabled: e.target.checked })}
                            style={{ accentColor: "#7c3aed", width: 10, height: 10 }}
                          />
                          <span style={{ fontSize: 9, color: "#94a3b8" }}>on</span>
                        </label>
                        <span style={{ fontSize: 9, color: "#a855f7", fontWeight: 700 }}>{band.gain > 0 ? "+" : ""}{band.gain.toFixed(1)} dB</span>
                        <input type="range" min={-18} max={18} step={0.5} value={band.gain}
                          onChange={e => updateEQBand(selectedTrackId, band.id, { gain: Number(e.target.value) })}
                          style={{ ...sliderStyle, width: "100%", height: 60, writingMode: "vertical-lr" as const, direction: "rtl" }} />
                        <span style={{ fontSize: 8, color: "#475569" }}>{band.frequency >= 1000 ? `${band.frequency / 1000}k` : band.frequency}Hz</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Compressor */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ ...labelStyle, marginBottom: 0 }}>Compressor</span>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={selectedState.compressor.enabled}
                      onChange={e => updateCompressor(selectedTrackId, { enabled: e.target.checked })}
                      style={{ accentColor: "#7c3aed" }}
                    />
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>Enable</span>
                  </label>
                </div>
                {selectedState.compressor.enabled && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {([
                      ["Threshold", "threshold", -60, 0, " dB"],
                      ["Ratio", "ratio", 1, 20, ":1"],
                      ["Attack", "attack", 0.1, 300, " ms"],
                      ["Release", "release", 1, 1000, " ms"],
                      ["Makeup", "makeupGain", 0, 24, " dB"],
                      ["Knee", "knee", 0, 10, " dB"],
                    ] as [string, keyof CompressorSettings, number, number, string][]).map(([lbl, key, min, max, unit]) => (
                      <div key={key}>
                        <span style={labelStyle}>{lbl}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <input type="range" min={min} max={max} step={(max - min) / 100}
                            value={selectedState.compressor[key] as number}
                            onChange={e => updateCompressor(selectedTrackId, { [key]: Number(e.target.value) })}
                            style={sliderStyle}
                          />
                          <span style={{ fontSize: 10, color: "#a855f7", minWidth: 40, textAlign: "right" }}>
                            {(selectedState.compressor[key] as number).toFixed(key === "ratio" ? 0 : 1)}{unit}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Channel strips */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "8px 12px", display: "flex", gap: 8, overflowX: "auto" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", letterSpacing: "0.08em", alignSelf: "center", minWidth: 80 }}>CHANNEL STRIP</div>
        {audioTracks.map(t => {
          const ts = trackStates[t.id];
          if (!ts) return null;
          return (
            <div key={t.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 56, padding: "6px 8px", background: "rgba(255,255,255,0.04)", borderRadius: 8, border: selectedTrackId === t.id ? "1px solid rgba(124,58,237,0.4)" : "1px solid transparent" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8" }}>{t.name}</span>
              <VUMeter level={ts.vuLevel} width={10} height={40} />
              <input type="range" min={0} max={2} step={0.01} value={ts.volume}
                onChange={e => updateTrackState(t.id, { volume: Number(e.target.value) })}
                style={{ width: 10, height: 60, writingMode: "vertical-lr" as const, direction: "rtl", accentColor: "#7c3aed" }}
              />
              <span style={{ fontSize: 9, color: "#64748b" }}>{Math.round(ts.volume * 100)}%</span>
              <div style={{ display: "flex", gap: 3 }}>
                <button
                  onClick={() => updateTrackState(t.id, { muted: !ts.muted })}
                  style={{ padding: "2px 4px", borderRadius: 3, border: "none", background: ts.muted ? "#ef4444" : "rgba(255,255,255,0.08)", color: ts.muted ? "#fff" : "#94a3b8", cursor: "pointer", fontSize: 9, fontWeight: 700 }}
                  title="Mute"
                >M</button>
                <button
                  onClick={() => updateTrackState(t.id, { solo: !ts.solo })}
                  style={{ padding: "2px 4px", borderRadius: 3, border: "none", background: ts.solo ? "#f59e0b" : "rgba(255,255,255,0.08)", color: ts.solo ? "#000" : "#94a3b8", cursor: "pointer", fontSize: 9, fontWeight: 700 }}
                  title="Solo"
                >S</button>
                <button
                  onClick={() => updateTrackState(t.id, { armed: !ts.armed })}
                  style={{ padding: "2px 4px", borderRadius: 3, border: "none", background: ts.armed ? "#ef4444" : "rgba(255,255,255,0.08)", color: ts.armed ? "#fff" : "#94a3b8", cursor: "pointer", fontSize: 9, fontWeight: 700 }}
                  title="Record Arm"
                >●</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Master bus */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "8px 12px", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#475569", letterSpacing: "0.08em", minWidth: 50 }}>MASTER</span>
        <div style={{ display: "flex", gap: 3 }}>
          <VUMeter level={masterVuL} height={20} />
          <VUMeter level={masterVuR} height={20} />
        </div>
        <input type="range" min={0} max={2} step={0.01} value={masterVolume}
          onChange={e => onSetMasterVolume(Number(e.target.value))}
          style={{ ...sliderStyle, flex: 1 }}
        />
        <span style={{ fontSize: 10, color: "#a855f7", minWidth: 30 }}>{Math.round(masterVolume * 100)}%</span>
        <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input type="checkbox" checked={masterLimiter} onChange={e => setMasterLimiter(e.target.checked)} style={{ accentColor: "#7c3aed" }} />
          <span style={{ fontSize: 10, color: "#94a3b8" }}>Limiter</span>
        </label>
      </div>
    </div>
  );
}
