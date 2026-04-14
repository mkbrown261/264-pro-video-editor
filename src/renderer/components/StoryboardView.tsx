/**
 * StoryboardView — card-based clip overview for the Edit page.
 * Shows every clip on the primary video track as a thumbnail card.
 * Supports: click-to-seek, drag-to-reorder, right-click context menu.
 */
import React, { useCallback, useRef, useState } from "react";
import type { TimelineTrackLayout, TimelineSegment } from "../../shared/timeline";
import { formatDuration } from "../lib/format";

interface StoryboardViewProps {
  trackLayouts: TimelineTrackLayout[];
  selectedClipId: string | null;
  playheadFrame: number;
  sequenceFps: number;
  onSelectClip: (clipId: string) => void;
  onSeekToFrame: (frame: number) => void;
  onDeleteClip?: (clipId: string) => void;
  onDuplicateClip?: (clipId: string) => void;
  onSplitClip?: (clipId: string, frame: number) => void;
  onReorderClips?: (draggedId: string, targetId: string) => void;
}

interface SBContextMenu {
  x: number;
  y: number;
  clipId: string;
}

export const StoryboardView: React.FC<StoryboardViewProps> = ({
  trackLayouts,
  selectedClipId,
  playheadFrame,
  sequenceFps,
  onSelectClip,
  onSeekToFrame,
  onDeleteClip,
  onDuplicateClip,
  onSplitClip,
  onReorderClips,
}) => {
  const [contextMenu, setContextMenu] = useState<SBContextMenu | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Collect all video segments from primary video track (lowest index video track)
  const videoTrackLayouts = trackLayouts.filter(l => l.track.kind === "video");
  const primaryVideoLayout = videoTrackLayouts[videoTrackLayouts.length - 1]; // bottom-most = primary
  const segments = (primaryVideoLayout?.segments ?? []).slice().sort((a, b) => a.startFrame - b.startFrame);

  const handleDragStart = useCallback((e: React.DragEvent, clipId: string) => {
    setDraggedId(clipId);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, clipId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(clipId);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetClipId: string) => {
    e.preventDefault();
    if (draggedId && draggedId !== targetClipId && onReorderClips) {
      onReorderClips(draggedId, targetClipId);
    }
    setDraggedId(null);
    setDragOverId(null);
  }, [draggedId, onReorderClips]);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDragOverId(null);
  }, []);

  // Close context menu on outside click
  React.useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".sb-ctx-menu")) setContextMenu(null);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  if (segments.length === 0) {
    return (
      <div className="storyboard-empty">
        <div className="storyboard-empty-icon">▦</div>
        <div>No clips on primary video track</div>
        <div style={{ fontSize: "0.7rem", opacity: 0.5, marginTop: 4 }}>Drop media to get started</div>
      </div>
    );
  }

  return (
    <div className="storyboard-view" ref={containerRef}>
      {/* Context menu */}
      {contextMenu && (
        <div
          className="sb-ctx-menu"
          style={{ position: "fixed", left: contextMenu.x, top: contextMenu.y, zIndex: 9999 }}
          onContextMenu={e => e.preventDefault()}
        >
          <div className="sb-ctx-item" onClick={() => { onSeekToFrame(segments.find(s => s.clip.id === contextMenu.clipId)?.startFrame ?? 0); setContextMenu(null); }}>
            ▶ Jump to Clip
          </div>
          <div className="sb-ctx-item" onClick={() => { onSplitClip?.(contextMenu.clipId, playheadFrame); setContextMenu(null); }}>
            ✂ Split at Playhead
          </div>
          <div className="sb-ctx-sep" />
          <div className="sb-ctx-item" onClick={() => { onDuplicateClip?.(contextMenu.clipId); setContextMenu(null); }}>
            ⧉ Duplicate
          </div>
          <div className="sb-ctx-item danger" onClick={() => { onDeleteClip?.(contextMenu.clipId); setContextMenu(null); }}>
            🗑 Delete
          </div>
        </div>
      )}

      <div className="storyboard-header">
        <span className="sb-title">▦ Storyboard</span>
        <span className="sb-count">{segments.length} clip{segments.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="storyboard-cards">
        {segments.map((seg, idx) => {
          const isSelected = seg.clip.id === selectedClipId;
          const isPlaying = playheadFrame >= seg.startFrame && playheadFrame < seg.startFrame + seg.durationFrames;
          const isDragging = draggedId === seg.clip.id;
          const isDragTarget = dragOverId === seg.clip.id;
          const thumb = seg.asset.thumbnailUrl ?? seg.asset.filmstripThumbs?.[0] ?? null;

          return (
            <div
              key={seg.clip.id}
              className={[
                "sb-card",
                isSelected ? "sb-card-selected" : "",
                isPlaying ? "sb-card-playing" : "",
                isDragging ? "sb-card-dragging" : "",
                isDragTarget ? "sb-card-drag-target" : "",
              ].filter(Boolean).join(" ")}
              draggable
              onDragStart={e => handleDragStart(e, seg.clip.id)}
              onDragOver={e => handleDragOver(e, seg.clip.id)}
              onDrop={e => handleDrop(e, seg.clip.id)}
              onDragEnd={handleDragEnd}
              onClick={() => { onSelectClip(seg.clip.id); onSeekToFrame(seg.startFrame); }}
              onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, clipId: seg.clip.id }); }}
              title={`${seg.asset.name} • ${formatDuration(seg.durationSeconds)}`}
              aria-label={`Clip: ${seg.asset.name}`}
            >
              {/* Clip number badge */}
              <div className="sb-card-num">{idx + 1}</div>

              {/* Thumbnail */}
              <div className="sb-thumb-wrap">
                {thumb ? (
                  <img
                    className="sb-thumb"
                    src={thumb}
                    alt={seg.asset.name}
                    loading="lazy"
                    draggable={false}
                  />
                ) : (
                  <div className="sb-thumb-placeholder">
                    <span>🎬</span>
                  </div>
                )}
                {/* Playing indicator */}
                {isPlaying && <div className="sb-playing-indicator" />}
                {/* Duration badge */}
                <div className="sb-duration-badge">{formatDuration(seg.durationSeconds)}</div>
              </div>

              {/* Caption */}
              <div className="sb-caption">
                <span className="sb-clip-name">{seg.asset.name}</span>
                {seg.clip.speed !== 1 && (
                  <span className="sb-speed-tag">{seg.clip.speed.toFixed(1)}×</span>
                )}
                {!seg.clip.isEnabled && (
                  <span className="sb-disabled-tag">OFF</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
