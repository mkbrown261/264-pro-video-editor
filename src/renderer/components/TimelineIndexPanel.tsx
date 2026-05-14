/**
 * TimelineIndexPanel — searchable index of all clips, markers, and transcripts
 * DaVinci Resolve has a "Timeline Index" panel; this is our equivalent.
 * Shows: all clips (name, track, in/out), markers (color-coded), transcript lines
 * Click any row → jumps playhead to that frame
 */

import React, { useMemo, useState, useCallback } from "react";
import type { TimelineClip, TimelineTrack, TimelineMarker, MediaAsset } from "../../shared/models";

interface TimelineIndexProps {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  markers: TimelineMarker[];
  assets: MediaAsset[];
  fps: number;
  playheadFrame: number;
  onSeek: (frame: number) => void;
  onSelectClip?: (clipId: string) => void;
}

type IndexTab = "clips" | "markers" | "tags";

function frameToTC(frame: number, fps: number): string {
  const totalSec = Math.floor(frame / fps);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const f = frame % Math.round(fps);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")};${String(f).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")};${String(f).padStart(2, "0")}`;
}

const MARKER_COLORS: Record<string, string> = {
  red: "#ef4444", orange: "#f97316", yellow: "#f7c948",
  green: "#22c55e", blue: "#3b82f6", purple: "#a855f7",
  pink: "#ec4899", cyan: "#06b6d4",
};

export function TimelineIndexPanel({
  clips,
  tracks,
  markers,
  assets,
  fps,
  playheadFrame,
  onSeek,
  onSelectClip,
}: TimelineIndexProps) {
  const [tab, setTab]       = useState<IndexTab>("clips");
  const [query, setQuery]   = useState("");
  const [sortBy, setSortBy] = useState<"tc" | "name" | "track">("tc");

  const trackMap = useMemo(() => new Map(tracks.map(t => [t.id, t])), [tracks]);
  const assetMap = useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);

  // Clip rows
  const clipRows = useMemo(() => {
    const q = query.toLowerCase();
    let rows = clips.map(clip => {
      const asset = assetMap.get(clip.assetId);
      const track = trackMap.get(clip.trackId);
      return { clip, asset, track };
    }).filter(({ asset, track }) => {
      if (!q) return true;
      return (
        (asset?.name ?? "").toLowerCase().includes(q) ||
        (track?.name ?? "").toLowerCase().includes(q)
      );
    });
    if (sortBy === "tc") rows.sort((a, b) => a.clip.startFrame - b.clip.startFrame);
    else if (sortBy === "name") rows.sort((a, b) => (a.asset?.name ?? "").localeCompare(b.asset?.name ?? ""));
    else rows.sort((a, b) => (a.track?.name ?? "").localeCompare(b.track?.name ?? ""));
    return rows;
  }, [clips, assets, tracks, query, sortBy, assetMap, trackMap]);

  // Marker rows
  const markerRows = useMemo(() => {
    const q = query.toLowerCase();
    return [...markers]
      .filter(m => !q || (m.label ?? "").toLowerCase().includes(q) || false /* note field not on TimelineMarker */)
      .sort((a, b) => a.frame - b.frame);
  }, [markers, query]);

  const handleSeek = useCallback((frame: number) => {
    onSeek(frame);
  }, [onSeek]);

  const isAtPlayhead = useCallback((startFrame: number, endFrame: number) =>
    playheadFrame >= startFrame && playheadFrame < endFrame, [playheadFrame]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--panel-bg, #0f1117)", color: "var(--text-p, #e0e0e0)", fontSize: 12 }}>
      {/* Header */}
      <div style={{ padding: "8px 10px 4px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div style={{ fontWeight: 700, fontSize: 11, letterSpacing: "0.06em", color: "rgba(255,255,255,0.5)", textTransform: "uppercase", marginBottom: 6 }}>
          Timeline Index
        </div>
        {/* Search */}
        <input
          type="text"
          placeholder="Search clips, markers…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", fontSize: 11, padding: "4px 8px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "var(--text-p, #e0e0e0)", outline: "none" }}
        />
        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
          {(["clips", "markers", "tags"] as IndexTab[]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.1)", background: tab === t ? "rgba(168,85,247,0.2)" : "rgba(255,255,255,0.04)", color: tab === t ? "#c084fc" : "var(--text-s, #888)", cursor: "pointer", textTransform: "capitalize" }}
            >{t}</button>
          ))}
          {tab === "clips" && (
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as "tc" | "name" | "track")}
              style={{ marginLeft: "auto", fontSize: 10, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "var(--text-s, #888)", padding: "1px 4px", cursor: "pointer" }}
            >
              <option value="tc">Sort: TC</option>
              <option value="name">Sort: Name</option>
              <option value="track">Sort: Track</option>
            </select>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "clips" && (
          <>
            {clipRows.length === 0 && (
              <div style={{ padding: "20px 12px", color: "var(--text-s, #888)", textAlign: "center", fontSize: 11 }}>
                {query ? "No clips match your search" : "No clips in timeline"}
              </div>
            )}
            {clipRows.map(({ clip, asset, track }) => {
              const clipAsset = assets.find(a => a.id === clip.assetId);
              const clipDur = clipAsset ? Math.round(clipAsset.durationSeconds * fps) : 0;
              const durationFrames = Math.max(0, clipDur - clip.trimStartFrames - clip.trimEndFrames);
              const active = isAtPlayhead(clip.startFrame, clip.startFrame + durationFrames);
              return (
                <div
                  key={clip.id}
                  onClick={() => { handleSeek(clip.startFrame); onSelectClip?.(clip.id); }}
                  style={{
                    display: "flex", flexDirection: "column", padding: "5px 10px",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    background: active ? "rgba(168,85,247,0.1)" : "none",
                    cursor: "pointer",
                    borderLeft: active ? "2px solid #c084fc" : "2px solid transparent",
                  }}
                  title={`${asset?.name ?? "Unknown"} on ${track?.name ?? "Unknown"} — ${frameToTC(clip.startFrame, fps)}`}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", width: 14 }}>
                      {track?.kind === "audio" ? "🎵" : "🎥"}
                    </span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
                      {asset?.name ?? clip.id.slice(0, 8)}
                    </span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
                      {frameToTC(clip.startFrame, fps)}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 2, fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                    <span>{track?.name ?? "—"}</span>
                    <span style={{ marginLeft: "auto" }}>{(durationFrames / fps).toFixed(2)}s</span>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {tab === "markers" && (
          <>
            {markerRows.length === 0 && (
              <div style={{ padding: "20px 12px", color: "var(--text-s, #888)", textAlign: "center", fontSize: 11 }}>
                {query ? "No markers match your search" : "No markers — press M to add"}
              </div>
            )}
            {markerRows.map(marker => (
              <div
                key={marker.id}
                onClick={() => handleSeek(marker.frame)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  cursor: "pointer",
                  background: Math.abs(playheadFrame - marker.frame) < 2 ? "rgba(247,201,72,0.08)" : "none",
                }}
                title={marker.label ?? "Marker"}
              >
                <span style={{ width: 10, height: 10, borderRadius: 2, background: MARKER_COLORS[marker.color ?? "yellow"] ?? "#f7c948", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>{marker.label ?? "Marker"}</div>
                  {/* note field not available on TimelineMarker */}
                </div>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", flexShrink: 0 }}>
                  {frameToTC(marker.frame, fps)}
                </span>
              </div>
            ))}
          </>
        )}

        {tab === "tags" && (
          <div style={{ padding: "12px" }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>Clips by tag / color label</div>
            {["red", "orange", "yellow", "green", "blue", "purple"].map(color => {
              const tagged = clips.filter(c => (c as any).color === color);
              if (tagged.length === 0) return null;
              return (
                <div key={color} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: MARKER_COLORS[color], flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: "capitalize", color: MARKER_COLORS[color] }}>{color} ({tagged.length})</span>
                  </div>
                  {tagged.map(clip => {
                    const asset = assetMap.get(clip.assetId);
                    return (
                      <div
                        key={clip.id}
                        onClick={() => { handleSeek(clip.startFrame); onSelectClip?.(clip.id); }}
                        style={{ padding: "3px 6px 3px 16px", fontSize: 10, color: "rgba(255,255,255,0.5)", cursor: "pointer" }}
                      >
                        {asset?.name ?? clip.id.slice(0, 8)} — {frameToTC(clip.startFrame, fps)}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {clips.filter(c => (c as any).color).length === 0 && (
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>No color-labeled clips yet. Right-click a clip to assign a color.</div>
            )}
          </div>
        )}
      </div>

      {/* Footer — clip/marker count */}
      <div style={{ padding: "4px 10px", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 10, color: "rgba(255,255,255,0.3)", display: "flex", gap: 10 }}>
        <span>{clips.length} clips</span>
        <span>{markers.length} markers</span>
        <span style={{ marginLeft: "auto" }}>▶ {frameToTC(playheadFrame, fps)}</span>
      </div>
    </div>
  );
}
