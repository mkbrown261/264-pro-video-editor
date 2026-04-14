/**
 * MulticamPanel — GAP C: Multicam Editing (Angle Viewer Grid)
 * Shows sync groups (overlapping clips on different tracks) in a 2/4-up grid.
 * Click an angle to cut to that camera at the current playhead position.
 */
import React, { useMemo, useState } from "react";
import type { TimelineSegment } from "../../shared/timeline";

interface Props {
  segments: TimelineSegment[];
  playheadFrame: number;
  sequenceFps: number;
  onCutToAngle: (clipId: string, trackId: string, frame: number) => void;
  onClose: () => void;
}

interface SyncAngle {
  clipId: string;
  trackId: string;
  trackName: string;
  assetName: string;
  thumbnailUrl: string | null;
  startFrame: number;
  endFrame: number;
}

export function MulticamPanel({ segments, playheadFrame, sequenceFps, onCutToAngle, onClose }: Props) {
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [gridSize, setGridSize] = useState<2 | 4 | 9>(4);

  // Find clips that overlap at the current playhead
  const activeAngles = useMemo<SyncAngle[]>(() => {
    return segments
      .filter(s =>
        s.track.kind === "video" &&
        s.startFrame <= playheadFrame &&
        s.endFrame > playheadFrame
      )
      .map(s => ({
        clipId: s.clip.id,
        trackId: s.track.id,
        trackName: s.track.name,
        assetName: s.asset.name,
        thumbnailUrl: s.asset.thumbnailUrl,
        startFrame: s.startFrame,
        endFrame: s.endFrame,
      }));
  }, [segments, playheadFrame]);

  // Also gather all video segments as possible angles (for timeline nav)
  const allVideoAngles = useMemo<SyncAngle[]>(() => {
    const seen = new Set<string>();
    return segments
      .filter(s => s.track.kind === "video" && !seen.has(s.track.id) && seen.add(s.track.id))
      .map(s => ({
        clipId: s.clip.id,
        trackId: s.track.id,
        trackName: s.track.name,
        assetName: s.asset.name,
        thumbnailUrl: s.asset.thumbnailUrl,
        startFrame: s.startFrame,
        endFrame: s.endFrame,
      }));
  }, [segments]);

  const displayAngles = activeAngles.length > 0 ? activeAngles : allVideoAngles;
  const cols = gridSize === 2 ? 2 : gridSize === 4 ? 2 : 3;
  const angleLimit = gridSize;
  const shown = displayAngles.slice(0, angleLimit);

  function handleAngleClick(angle: SyncAngle) {
    setActiveClipId(angle.clipId);
    onCutToAngle(angle.clipId, angle.trackId, playheadFrame);
  }

  const tc = (f: number) => {
    const fps = sequenceFps || 30;
    const s = Math.floor(f / fps);
    const fr = f % fps;
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}:${String(fr).padStart(2,"0")}`;
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 8000 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#111115", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, width: 740, maxWidth: "96vw", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#e8e8e8" }}>📹 Multicam Angle Viewer</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
              {tc(playheadFrame)} · {displayAngles.length} angle{displayAngles.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {([2, 4, 9] as const).map(n => (
              <button
                key={n}
                onClick={() => setGridSize(n)}
                style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${gridSize === n ? "rgba(79,142,247,0.6)" : "rgba(255,255,255,0.1)"}`, background: gridSize === n ? "rgba(79,142,247,0.2)" : "transparent", color: gridSize === n ? "#4f8ef7" : "rgba(255,255,255,0.4)", fontSize: 11, cursor: "pointer" }}
                type="button"
              >
                {n === 2 ? "2-up" : n === 4 ? "4-up" : "9-up"}
              </button>
            ))}
            <button onClick={onClose} style={{ marginLeft: 6, background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 16 }} type="button">✕</button>
          </div>
        </div>

        {/* Angle Grid */}
        <div style={{ padding: 12, display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8, maxHeight: "60vh", overflowY: "auto" }}>
          {shown.length === 0 ? (
            <div style={{ gridColumn: `span ${cols}`, textAlign: "center", padding: "40px 20px", color: "rgba(255,255,255,0.3)", fontSize: 12 }}>
              No video clips found in timeline.<br />
              <span style={{ fontSize: 10, opacity: 0.6 }}>Import footage and place it on video tracks.</span>
            </div>
          ) : (
            shown.map((angle) => {
              const isActive = activeClipId === angle.clipId;
              return (
                <button
                  key={angle.clipId}
                  type="button"
                  onClick={() => handleAngleClick(angle)}
                  style={{
                    background: isActive ? "rgba(79,142,247,0.2)" : "rgba(255,255,255,0.04)",
                    border: `2px solid ${isActive ? "#4f8ef7" : "rgba(255,255,255,0.1)"}`,
                    borderRadius: 8,
                    cursor: "pointer",
                    padding: 0,
                    overflow: "hidden",
                    position: "relative",
                    aspectRatio: "16/9",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {angle.thumbnailUrl ? (
                    <img
                      src={angle.thumbnailUrl}
                      alt={angle.assetName}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 24 }}>🎬</div>
                  )}
                  {/* Label overlay */}
                  <div style={{
                    position: "absolute", bottom: 0, left: 0, right: 0,
                    background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
                    padding: "16px 8px 6px",
                    textAlign: "left",
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#e8e8e8" }}>{angle.trackName}</div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>{angle.assetName}</div>
                  </div>
                  {isActive && (
                    <div style={{
                      position: "absolute", top: 6, right: 6,
                      background: "#ef5350",
                      color: "#fff",
                      fontSize: 9,
                      fontWeight: 700,
                      padding: "2px 5px",
                      borderRadius: 4,
                    }}>● ACTIVE</div>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer instructions */}
        <div style={{ padding: "10px 16px", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
          Click an angle to cut to that camera at the current playhead position. The cut is inserted into the timeline.
        </div>
      </div>
    </div>
  );
}
