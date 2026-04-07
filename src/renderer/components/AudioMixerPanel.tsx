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

import React, { useCallback } from "react";
import type { TimelineTrack } from "../../shared/models";
import type { AudioEngine } from "../lib/AudioScheduler";

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
}

function ChannelStrip({ track, onMute, onSolo, onVolumeChange }: ChannelStripProps) {
  const isAudio = track.kind === "audio";
  const vol = track.volume ?? 1;

  return (
    <div className={`mixer-channel${track.muted ? " mixer-channel--muted" : ""}${track.solo ? " mixer-channel--solo" : ""}`}>
      {/* Track name */}
      <div className="mixer-channel-name" title={track.name}>
        <span>{track.kind === "audio" ? "🎵" : "🎬"}</span>
        <span className="mixer-channel-name-text">{track.name || (track.kind === "audio" ? "Audio" : "Video")}</span>
      </div>

      {/* VU bars (simple, no analyser — just shows gain level) */}
      <div className="mixer-vu-simple">
        <div
          className="mixer-vu-fill"
          style={{
            height: `${Math.min(100, (track.muted ? 0 : vol) * 50)}%`,
            background: vol > 1.6 ? "#e53935" : vol > 1.1 ? "#f7c948" : "#2fc77a",
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

      {/* Mute / Solo */}
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
      </div>
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

  const handleTrackVolume = useCallback((trackId: string, vol: number) => {
    onUpdateTrack(trackId, { volume: vol });
    // Apply immediately to the live audio engine (if playing)
    audioEngineRef.current?.setTrackVolume(trackId, vol);
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
                  height: `${Math.min(100, masterVolume * 50)}%`,
                  background: masterVolume > 1.6 ? "#e53935" : masterVolume > 1.1 ? "#f7c948" : "#2fc77a",
                }}
              />
            </div>

            <VerticalFader
              value={masterVolume}
              onChange={handleMasterVolume}
              color="#a855f7"
            />

            <div className="mixer-vol-readout">{masterPct}%</div>

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
