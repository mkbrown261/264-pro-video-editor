/**
 * BeatSyncPanel — ClawFlow Beat Detection + Auto-Cut to Music
 * ─────────────────────────────────────────────────────────────
 * Detects beats in a selected audio track (using RMS energy peaks)
 * and either adds timeline markers or auto-cuts video clips at beat
 * positions.
 */

import React, { useState, useRef, useCallback } from "react";
import type { TimelineTrack, TimelineMarker, MediaAsset } from "../../shared/models";
import { createId } from "../../shared/models";

export interface BeatSyncPanelProps {
  audioTracks: TimelineTrack[];
  assets: MediaAsset[];
  fps: number;
  onAddMarkers: (markers: Omit<TimelineMarker, "id">[]) => void;
  onSplitClipsAtBeats: (beatFrames: number[]) => void;
  onClose: () => void;
}

type BeatDivision = 1 | 2 | 4;

async function detectBeats(audioBuffer: AudioBuffer): Promise<number[]> {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const windowSize = Math.floor(sampleRate * 0.04); // 40ms window
  const minBeatInterval = Math.floor(sampleRate * 0.3); // min 300ms between beats

  let maxAmplitude = 0;
  for (let i = 0; i < channelData.length; i++) {
    const abs = Math.abs(channelData[i]);
    if (abs > maxAmplitude) maxAmplitude = abs;
  }

  const threshold = maxAmplitude * 0.55;
  const beats: number[] = [];
  let lastBeat = -minBeatInterval;

  for (let i = windowSize; i < channelData.length - windowSize; i += windowSize) {
    let sum = 0;
    for (let j = i; j < i + windowSize; j++) {
      sum += channelData[j] * channelData[j];
    }
    const rms = Math.sqrt(sum / windowSize);

    if (rms > threshold && (i - lastBeat) > minBeatInterval) {
      beats.push(i / sampleRate);
      lastBeat = i;
    }
  }

  return beats;
}

export function BeatSyncPanel({
  audioTracks,
  assets,
  fps,
  onAddMarkers,
  onSplitClipsAtBeats,
  onClose,
}: BeatSyncPanelProps) {
  const [selectedTrackId, setSelectedTrackId] = useState<string>(audioTracks[0]?.id ?? "");
  const [beatDivision, setBeatDivision] = useState<BeatDivision>(1);
  const [applyToAll, setApplyToAll] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [detectedBeats, setDetectedBeats] = useState<number[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const selectedTrack = audioTracks.find(t => t.id === selectedTrackId);

  // Find first audio asset for the selected track
  const findAssetForTrack = useCallback((): MediaAsset | null => {
    if (!selectedTrack) return null;
    // Find clips on this track and get their asset
    return assets.find(a => a.hasAudio) ?? null;
  }, [selectedTrack, assets]);

  const handleDetectBeats = useCallback(async () => {
    const asset = findAssetForTrack();
    if (!asset?.sourcePath) {
      setStatus("⚠️ No audio file found for selected track. Add an audio clip first.");
      return;
    }

    setIsAnalyzing(true);
    setStatus("🎵 Analyzing audio waveform for beats…");
    setDetectedBeats([]);

    try {
      // Close previous context if any
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      const response = await fetch(`file://${asset.sourcePath}`);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      const allBeats = await detectBeats(audioBuffer);
      // Apply division filter
      const filteredBeats = allBeats.filter((_, idx) => idx % beatDivision === 0);
      setDetectedBeats(filteredBeats);
      setStatus(`✅ Found ${filteredBeats.length} beats (division: every ${beatDivision} beat${beatDivision > 1 ? "s" : ""})`);

      ctx.close().catch(() => {});
      audioCtxRef.current = null;
    } catch (err) {
      setStatus(`❌ Beat detection failed: ${err instanceof Error ? err.message : String(err)}`);
      setIsAnalyzing(false);
    } finally {
      setIsAnalyzing(false);
    }
  }, [findAssetForTrack, beatDivision]);

  const handleAddMarkers = useCallback(() => {
    if (detectedBeats.length === 0) {
      setStatus("⚠️ Run beat detection first.");
      return;
    }
    const markers: Omit<TimelineMarker, "id">[] = detectedBeats.map((time, idx) => ({
      frame: Math.round(time * fps),
      label: `Beat ${idx + 1}`,
      color: "#a855f7",
    }));
    onAddMarkers(markers);
    setStatus(`✅ Added ${markers.length} beat markers to timeline`);
  }, [detectedBeats, fps, onAddMarkers]);

  const handleAutocut = useCallback(() => {
    if (detectedBeats.length === 0) {
      setStatus("⚠️ Run beat detection first.");
      return;
    }
    const beatFrames = detectedBeats.map(t => Math.round(t * fps));
    onSplitClipsAtBeats(beatFrames);
    setStatus(`✅ Applied ${beatFrames.length} cuts to video clips`);
  }, [detectedBeats, fps, onSplitClipsAtBeats]);

  const btnBase: React.CSSProperties = {
    padding: "6px 12px",
    borderRadius: 7,
    border: "none",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  };

  return (
    <div style={{
      background: "#0d1117",
      border: "1px solid rgba(124,58,237,0.3)",
      borderRadius: 12,
      padding: 16,
      width: 320,
      color: "#e2e8f0",
      fontFamily: "inherit",
      boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 16 }}>🥁</span>
        <span style={{ fontWeight: 800, fontSize: 14, color: "#fff" }}>Beat Sync</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#7c3aed", fontWeight: 700 }}>CLAWFLOW AI</span>
        <button
          type="button"
          onClick={onClose}
          style={{ marginLeft: 8, background: "none", border: "none", color: "#64748b", fontSize: 14, cursor: "pointer", lineHeight: 1 }}
        >✕</button>
      </div>

      {/* Music track selector */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 4 }}>
          Music Track
        </label>
        <select
          value={selectedTrackId}
          onChange={e => setSelectedTrackId(e.target.value)}
          style={{ width: "100%", padding: "6px 8px", borderRadius: 6, background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0", fontSize: 12 }}
        >
          {audioTracks.length === 0 && <option value="">No audio tracks</option>}
          {audioTracks.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      {/* Beat division */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 6 }}>
          Cut on every
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          {([1, 2, 4] as BeatDivision[]).map(div => (
            <button
              key={div}
              type="button"
              onClick={() => setBeatDivision(div)}
              style={{
                ...btnBase,
                flex: 1,
                background: beatDivision === div ? "#7c3aed" : "rgba(255,255,255,0.06)",
                color: beatDivision === div ? "#fff" : "#94a3b8",
                border: beatDivision === div ? "1px solid #7c3aed" : "1px solid rgba(255,255,255,0.1)",
              }}
            >
              {div === 1 ? "Beat" : div === 2 ? "2 Beats" : "4 Beats"}
            </button>
          ))}
        </div>
      </div>

      {/* Apply to */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 6 }}>
          Apply to
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          {[true, false].map(all => (
            <button
              key={String(all)}
              type="button"
              onClick={() => setApplyToAll(all)}
              style={{
                ...btnBase,
                flex: 1,
                background: applyToAll === all ? "rgba(79,142,247,0.2)" : "rgba(255,255,255,0.06)",
                color: applyToAll === all ? "#4f8ef7" : "#94a3b8",
                border: applyToAll === all ? "1px solid rgba(79,142,247,0.4)" : "1px solid rgba(255,255,255,0.1)",
              }}
            >
              {all ? "All Video Clips" : "Selected Clips"}
            </button>
          ))}
        </div>
      </div>

      {/* Status */}
      {status && (
        <div style={{ padding: "8px 10px", background: "rgba(124,58,237,0.1)", borderRadius: 6, fontSize: 11, color: "#c4b5fd", marginBottom: 12, border: "1px solid rgba(124,58,237,0.2)" }}>
          {status}
        </div>
      )}

      {/* Detected count badge */}
      {detectedBeats.length > 0 && (
        <div style={{ padding: "6px 10px", background: "rgba(47,199,122,0.1)", borderRadius: 6, fontSize: 11, color: "#2fc77a", marginBottom: 12, border: "1px solid rgba(47,199,122,0.2)", textAlign: "center" }}>
          {detectedBeats.length} beats detected
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          type="button"
          onClick={handleDetectBeats}
          disabled={isAnalyzing || !selectedTrackId}
          style={{
            ...btnBase,
            width: "100%",
            padding: "10px",
            background: isAnalyzing ? "rgba(124,58,237,0.3)" : "linear-gradient(135deg,#7c3aed,#a855f7)",
            color: "#fff",
            fontSize: 13,
            opacity: !selectedTrackId ? 0.5 : 1,
          }}
        >
          {isAnalyzing ? "⏳ Analyzing…" : "🎵 Detect Beats + Add Markers"}
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={handleAddMarkers}
            disabled={detectedBeats.length === 0}
            style={{
              ...btnBase,
              flex: 1,
              background: detectedBeats.length > 0 ? "rgba(79,142,247,0.15)" : "rgba(255,255,255,0.04)",
              color: detectedBeats.length > 0 ? "#4f8ef7" : "#475569",
              border: `1px solid ${detectedBeats.length > 0 ? "rgba(79,142,247,0.4)" : "rgba(255,255,255,0.08)"}`,
            }}
          >
            📌 Add Markers
          </button>
          <button
            type="button"
            onClick={handleAutocut}
            disabled={detectedBeats.length === 0}
            style={{
              ...btnBase,
              flex: 1,
              background: detectedBeats.length > 0 ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.04)",
              color: detectedBeats.length > 0 ? "#f87171" : "#475569",
              border: `1px solid ${detectedBeats.length > 0 ? "rgba(239,68,68,0.4)" : "rgba(255,255,255,0.08)"}`,
            }}
          >
            ✂️ Auto-Cut
          </button>
        </div>
      </div>
    </div>
  );
}
