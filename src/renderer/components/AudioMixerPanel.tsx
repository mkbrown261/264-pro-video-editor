/**
 * AudioMixerPanel
 * ─────────────────────────────────────────────────────────────────────────────
 * Collapsible multi-track audio mixer showing:
 *   • Per-track vertical fader (0–200%), mute/solo buttons, track name
 *   • Master fader controlling sequence.settings.masterVolume
 *   • Real-time VU peak meter per track (via the shared AudioEngine ref)
 *
 * The component is rendered inside the timeline-area when mixerOpen=true.
 * It is horizontally scrollable so all tracks are always accessible.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { TimelineTrack, EQBand, AutomationLane, CompressorSettings } from "../../shared/models";
import type { AudioEngine } from "../lib/AudioScheduler";

// ── Default EQ bands (3-band: low shelf / peak mid / high shelf) ───────────────
const defaultEQBands: EQBand[] = [
  { id: "low",  type: "lowshelf",  frequency: 80,    gain: 0, q: 0.7, enabled: true },
  { id: "mid",  type: "peak",      frequency: 1000,  gain: 0, q: 1.0, enabled: true },
  { id: "high", type: "highshelf", frequency: 10000, gain: 0, q: 0.7, enabled: true },
];

// ── Types ──────────────────────────────────────────────────────────────────────

interface AudioMixerPanelProps {
  tracks: TimelineTrack[];
  masterVolume: number;       // 0–2, from sequence.settings.masterVolume
  audioEngineRef: React.MutableRefObject<AudioEngine | null>;
  onUpdateTrack: (trackId: string, updates: Partial<TimelineTrack>) => void;
  onUpdateMasterVolume: (vol: number) => void;
  onClose: () => void;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

interface FaderProps {
  value: number;          // 0–2
  onChange: (v: number) => void;
  color?: string;
  disabled?: boolean;
}

function VerticalFader({ value, onChange, color = "#3b8af7", disabled }: FaderProps) {
  const pct = Math.round(Math.max(0, Math.min(200, value * 100)));

  return (
    <div className="mixer-fader-col">
      <div className="mixer-fader-track-wrap">
        <input
          type="range"
          className="mixer-fader"
          min={0}
          max={200}
          step={1}
          value={pct}
          disabled={disabled}
          style={{ "--fader-color": color } as React.CSSProperties}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          onDoubleClick={() => onChange(1)}
          title="Double-click to reset to 100%"
          aria-label={`Volume ${pct}%`}
        />
      </div>
    </div>
  );
}

interface ChannelStripProps {
  track: TimelineTrack;
  onMute: () => void;
  onSolo: () => void;
  onVolumeChange: (v: number) => void;
  onUpdateEQ?: (bands: EQBand[]) => void;
  onUpdateCompressor?: (settings: import('../../shared/models').CompressorSettings) => void;
  /** Live RMS level 0–1 from AnalyserNode, or null when not playing */
  liveLevel: number | null;
  /** Total sequence frames (for automation lane width) */
  totalFrames?: number;
  /** Playhead frame for automation read-position indicator */
  playheadFrame?: number;
  onToggleAutomation?: (param: 'volume' | 'pan') => void;
}

function ChannelStrip({ track, onMute, onSolo, onVolumeChange, onUpdateEQ, onUpdateCompressor, liveLevel, totalFrames = 1000, playheadFrame = 0, onToggleAutomation }: ChannelStripProps) {
  const isAudio = track.kind === "audio";
  const vol = track.volume ?? 1;
  // Show live level when playing, fall back to gain-based display otherwise
  const displayLevel = liveLevel !== null ? liveLevel : (track.muted ? 0 : vol * 0.5);

  // Collapsible EQ section ───────────────────────────────────────────────────
  const [eqOpen, setEqOpen] = useState(false);

  // Collapsible Compressor section
  const [compOpen, setCompOpen] = useState(false);
  const defaultComp: CompressorSettings = { enabled: true, threshold: -24, ratio: 4, attack: 10, release: 100, makeupGain: 0, knee: 6 };
  const comp = track.compressor ?? defaultComp;
  const setComp = (patch: Partial<CompressorSettings>) => {
    onUpdateCompressor?.({ ...comp, ...patch });
  };

  return (
    <div className={`mixer-channel${track.muted ? " mixer-channel--muted" : ""}${track.solo ? " mixer-channel--solo" : ""}`}>
      {/* Track name */}
      <div className="mixer-channel-name" title={track.name}>
        <span>{track.kind === "audio" ? "🎵" : "🎬"}</span>
        <span className="mixer-channel-name-text">{track.name || (track.kind === "audio" ? "Audio" : "Video")}</span>
      </div>

      {/* VU bars — live RMS level when playing, static gain otherwise */}
      <div className="mixer-vu-simple">
        <div
          className="mixer-vu-fill"
          style={{
            height: `${Math.min(100, displayLevel * 100)}%`,
            background: displayLevel > 0.8 ? "#e53935" : displayLevel > 0.55 ? "#f7c948" : "#2fc77a",
            transition: liveLevel !== null ? "none" : "height 0.1s",
          }}
        />
      </div>

      {/* Fader */}
      <VerticalFader
        value={vol}
        onChange={onVolumeChange}
        disabled={!isAudio}
        color={isAudio ? "#3b8af7" : "#888"}
      />

      {/* Volume readout */}
      <div className="mixer-vol-readout">{Math.round(vol * 100)}%</div>

      {/* Mute / Solo / EQ */}
      <div className="mixer-channel-btns">
        <button
          className={`mixer-btn mixer-mute${track.muted ? " active" : ""}`}
          onClick={onMute}
          title="Mute"
          type="button"
        >
          M
        </button>
        <button
          className={`mixer-btn mixer-solo${track.solo ? " active" : ""}`}
          onClick={onSolo}
          title="Solo"
          type="button"
        >
          S
        </button>
        {isAudio && (
          <button
            className={`mixer-btn mixer-eq-btn${eqOpen ? " active" : ""}`}
            onClick={() => setEqOpen((v) => !v)}
            title="EQ"
            type="button"
          >
            EQ
          </button>
        )}
        {isAudio && (
          <button
            className={`mixer-btn${compOpen ? " active" : ""}`}
            onClick={() => setCompOpen((v) => !v)}
            title="Compressor"
            type="button"
            style={{ fontSize: 9, padding: '2px 4px', background: comp.enabled && compOpen ? 'rgba(251,146,60,0.25)' : undefined, borderColor: comp.enabled ? 'rgba(251,146,60,0.5)' : undefined, color: comp.enabled ? '#fb923c' : undefined }}
          >
            CMP
          </button>
        )}
      </div>

      {/* Collapsible 3-band EQ strip ─────────────────────────────────────── */}
      {eqOpen && (
        <div className="mixer-eq-strip">
          {defaultEQBands.map((band, i) => {
            const currentBands = track.eq ?? defaultEQBands;
            const live = currentBands[i] ?? band;
            const gain = live?.gain ?? 0;
            const freqLabel = band.frequency >= 1000 ? `${band.frequency / 1000}k` : `${band.frequency}`;
            return (
              <div key={band.id} className="mixer-eq-band">
                <span className="mixer-eq-label">{freqLabel}</span>
                <input
                  type="range"
                  min={-18}
                  max={18}
                  step={0.5}
                  value={gain}
                  onChange={(e) => {
                    const bands: EQBand[] = (track.eq ?? defaultEQBands).map((b) => ({ ...b }));
                    if (!bands[i]) bands[i] = { ...defaultEQBands[i] };
                    bands[i] = { ...bands[i], gain: Number(e.target.value) };
                    onUpdateEQ?.(bands);
                  }}
                  className="mixer-eq-slider"
                  title={`${freqLabel}Hz: ${gain}dB`}
                />
                <span className="mixer-eq-val">{gain > 0 ? "+" : ""}{gain}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Compressor strip */}
      {compOpen && isAudio && (
        <div style={{ padding: '8px 6px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {/* Enable toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#fb923c', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Compressor</span>
            <button type="button" onClick={() => setComp({ enabled: !comp.enabled })}
              style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: comp.enabled ? 'rgba(251,146,60,0.25)' : 'rgba(255,255,255,0.05)', border: '1px solid rgba(251,146,60,0.4)', color: comp.enabled ? '#fb923c' : 'rgba(255,255,255,0.4)', cursor: 'pointer' }}>
              {comp.enabled ? 'ON' : 'OFF'}
            </button>
          </div>
          {/* Threshold */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', width: 40 }}>THR</span>
            <input type="range" min={-60} max={0} step={1} value={comp.threshold} onChange={e => setComp({ threshold: Number(e.target.value) })} style={{ flex: 1 }} disabled={!comp.enabled} />
            <span style={{ fontSize: 9, color: '#fb923c', width: 28, textAlign: 'right' }}>{comp.threshold}dB</span>
          </div>
          {/* Ratio */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', width: 40 }}>RATIO</span>
            <input type="range" min={1} max={20} step={0.5} value={comp.ratio} onChange={e => setComp({ ratio: Number(e.target.value) })} style={{ flex: 1 }} disabled={!comp.enabled} />
            <span style={{ fontSize: 9, color: '#fb923c', width: 28, textAlign: 'right' }}>{comp.ratio}:1</span>
          </div>
          {/* Attack */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', width: 40 }}>ATK</span>
            <input type="range" min={1} max={200} step={1} value={comp.attack} onChange={e => setComp({ attack: Number(e.target.value) })} style={{ flex: 1 }} disabled={!comp.enabled} />
            <span style={{ fontSize: 9, color: '#fb923c', width: 28, textAlign: 'right' }}>{comp.attack}ms</span>
          </div>
          {/* Release */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', width: 40 }}>REL</span>
            <input type="range" min={10} max={1000} step={10} value={comp.release} onChange={e => setComp({ release: Number(e.target.value) })} style={{ flex: 1 }} disabled={!comp.enabled} />
            <span style={{ fontSize: 9, color: '#fb923c', width: 28, textAlign: 'right' }}>{comp.release}ms</span>
          </div>
          {/* Makeup Gain */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', width: 40 }}>MKUP</span>
            <input type="range" min={0} max={24} step={0.5} value={comp.makeupGain} onChange={e => setComp({ makeupGain: Number(e.target.value) })} style={{ flex: 1 }} disabled={!comp.enabled} />
            <span style={{ fontSize: 9, color: '#fb923c', width: 28, textAlign: 'right' }}>+{comp.makeupGain}dB</span>
          </div>
          {/* Knee */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', width: 40 }}>KNEE</span>
            <input type="range" min={0} max={10} step={0.5} value={comp.knee} onChange={e => setComp({ knee: Number(e.target.value) })} style={{ flex: 1 }} disabled={!comp.enabled} />
            <span style={{ fontSize: 9, color: '#fb923c', width: 28, textAlign: 'right' }}>{comp.knee}dB</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AudioMixerPanel({
  tracks,
  masterVolume,
  audioEngineRef,
  onUpdateTrack,
  onUpdateMasterVolume,
  onClose,
}: AudioMixerPanelProps) {

  // ── Real-time VU levels — updated every animation frame ─────────────────
  const [trackLevels, setTrackLevels] = useState<Record<string, number>>({});
  const [masterLevel, setMasterLevel] = useState<number | null>(null);
  const [lufs, setLufs] = useState<number>(-70);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const engine = audioEngineRef.current;
      if (engine) {
        const levels: Record<string, number> = {};
        for (const track of tracks) {
          levels[track.id] = engine.getTrackLevel(track.id);
        }
        setTrackLevels(levels);
        setMasterLevel(engine.getMasterLevel());
        setLufs(engine.getLUFS?.() ?? -70);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [audioEngineRef, tracks]);

  const handleTrackVolume = useCallback((trackId: string, vol: number) => {
    onUpdateTrack(trackId, { volume: vol });
    // Apply immediately to the live audio engine (if playing)
    audioEngineRef.current?.setTrackVolume(trackId, vol);
  }, [onUpdateTrack, audioEngineRef]);

  const handleTrackEQ = useCallback((trackId: string, bands: EQBand[]) => {
    onUpdateTrack(trackId, { eq: bands });
    // Apply immediately to the live audio engine
    audioEngineRef.current?.setTrackEQ?.(trackId, bands);
  }, [onUpdateTrack, audioEngineRef]);

  const handleTrackCompressor = useCallback((trackId: string, settings: CompressorSettings) => {
    onUpdateTrack(trackId, { compressor: settings });
    audioEngineRef.current?.setTrackCompressor?.(trackId, settings);
  }, [onUpdateTrack, audioEngineRef]);

  const handleMasterVolume = useCallback((vol: number) => {
    onUpdateMasterVolume(vol);
    audioEngineRef.current?.setMasterVolume(vol);
  }, [onUpdateMasterVolume, audioEngineRef]);

  const handleMute = useCallback((track: TimelineTrack) => {
    onUpdateTrack(track.id, { muted: !track.muted });
    // If muting, set track gain to 0; if unmuting restore volume
    const engine = audioEngineRef.current;
    if (engine) {
      engine.setTrackVolume(track.id, track.muted ? (track.volume ?? 1) : 0);
    }
  }, [onUpdateTrack, audioEngineRef]);

  const handleSolo = useCallback((track: TimelineTrack) => {
    onUpdateTrack(track.id, { solo: !track.solo });
  }, [onUpdateTrack]);

  const masterPct = Math.round(Math.max(0, Math.min(200, masterVolume * 100)));

  return (
    <div className="audio-mixer-panel">
      {/* Header */}
      <div className="mixer-header">
        <span className="mixer-title">🎚 Mixer</span>
        <button className="mixer-close-btn" onClick={onClose} type="button" title="Close Mixer">
          ✕
        </button>
      </div>

      {/* Channel strips */}
      <div className="mixer-channels-scroll">
        <div className="mixer-channels">
          {tracks.map((track) => (
            <ChannelStrip
              key={track.id}
              track={track}
              onMute={() => handleMute(track)}
              onSolo={() => handleSolo(track)}
              onVolumeChange={(v) => handleTrackVolume(track.id, v)}
              onUpdateEQ={(bands) => handleTrackEQ(track.id, bands)}
              onUpdateCompressor={(settings) => handleTrackCompressor(track.id, settings)}
              liveLevel={trackLevels[track.id] ?? null}
            />
          ))}

          {/* Separator */}
          <div className="mixer-master-sep" />

          {/* Master channel */}
          <div className="mixer-channel mixer-channel--master">
            <div className="mixer-channel-name">
              <span>🔊</span>
              <span className="mixer-channel-name-text">Master</span>
            </div>

            <div className="mixer-vu-simple">
              <div
                className="mixer-vu-fill"
                style={{
                  height: masterLevel !== null
                    ? `${Math.min(100, masterLevel * 100)}%`
                    : `${Math.min(100, masterVolume * 50)}%`,
                  background: (masterLevel ?? masterVolume * 0.5) > 0.8 ? "#e53935"
                    : (masterLevel ?? masterVolume * 0.5) > 0.55 ? "#f7c948" : "#2fc77a",
                  transition: masterLevel !== null ? "none" : "height 0.1s",
                }}
              />
            </div>

            <VerticalFader
              value={masterVolume}
              onChange={handleMasterVolume}
              color="#a855f7"
            />

            <div className="mixer-vol-readout">{masterPct}%</div>

            {/* LUFS integrated loudness meter */}
            <div style={{ padding: '4px 4px 2px', borderTop: '1px solid rgba(255,255,255,0.07)', textAlign: 'center' }}>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>LUFS</div>
              <div style={{
                fontSize: 11, fontWeight: 700, fontFamily: 'monospace',
                color: lufs > -6 ? '#ef4444' : lufs > -14 ? '#f7c948' : lufs > -23 ? '#22c55e' : 'rgba(255,255,255,0.4)',
              }}>
                {lufs <= -60 ? '–∞' : lufs.toFixed(1)}
              </div>
              {/* LUFS bar */}
              <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, marginTop: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.max(0, Math.min(100, (lufs + 60) / 54 * 100))}%`,
                  background: lufs > -6 ? '#ef4444' : lufs > -14 ? '#f7c948' : '#22c55e',
                  transition: 'width 0.1s',
                }} />
              </div>
              {/* Target zones */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 1 }}>
                <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.2)' }}>-23</span>
                <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.2)' }}>-16</span>
                <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.2)' }}>-6</span>
              </div>
            </div>

            <div className="mixer-channel-btns">
              <button
                className="mixer-btn"
                onClick={() => handleMasterVolume(1)}
                title="Reset master to 100%"
                type="button"
                style={{ fontSize: "0.6rem" }}
              >
                ↺
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
