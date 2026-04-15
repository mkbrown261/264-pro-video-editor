// ─────────────────────────────────────────────────────────────────────────────
// 264 Pro – Media Pool  (Media tab + Transitions tab)
// UX Polish: hover-scrub, grid/list toggle, search+filter bar
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useCallback, useEffect } from "react";
import ReactDOM from "react-dom";
import type { ClipTransitionType, MediaAsset } from "../../shared/models";
import type { TimelineSegment } from "../../shared/timeline";
import { formatDuration, formatFileSize } from "../lib/format";
import { TransitionsPanel } from "./TransitionsPanel";
import { setDraggedAssetId } from "../lib/mediaDragContext";

interface MediaPoolProps {
  assets: MediaAsset[];
  selectedAssetId: string | null;
  selectedSegment: TimelineSegment | null;
  transitionMessage: string | null;
  importing: boolean;
  onImport: () => Promise<void>;
  onSelectAsset: (assetId: string) => void;
  onAppendAsset: (assetId: string) => void;
  /** Legacy: apply a "fade" transition to in/out edge of selected clip */
  onApplyTransition: (edge: "in" | "out") => void;
  /** New: apply any transition type with explicit duration */
  onApplyTransitionType?: (type: ClipTransitionType, edge: "in" | "out", durationFrames: number) => void;
  /** FlowState subscription tier — gates Image-to-Video */
  fsTier?: string;
  /** Whether user is linked to FlowState */
  fsLinked?: boolean;
  /** Callback when Image-to-Video is requested for an image asset */
  onImageToVideo?: (asset: MediaAsset) => void;
}

// ── Context menu ──────────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  asset: MediaAsset;
}

function MediaContextMenu({
  menu,
  onAppend,
  onImageToVideo,
  isSubscribed,
  onClose,
}: {
  menu: ContextMenuState;
  onAppend: () => void;
  onImageToVideo?: (() => void) | null;
  isSubscribed: boolean;
  onClose: () => void;
}) {
  const isImage = menu.asset.durationSeconds === 0 && !menu.asset.hasAudio;

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const menuEl = (
    <div
      className="media-context-menu"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={e => e.stopPropagation()}
    >
      <button
        className="media-context-item"
        onMouseDown={() => { onAppend(); onClose(); }}
      >
        ▶ Add to Timeline
      </button>
      {isImage && isSubscribed && (
        <>
          <div className="media-context-sep" />
          <button
            className="media-context-item"
            onMouseDown={() => { onImageToVideo?.(); onClose(); }}
          >
            🎬 Image to Video
          </button>
        </>
      )}
    </div>
  );

  return ReactDOM.createPortal(menuEl, document.body);
}

// ── Hover-scrub card ──────────────────────────────────────────────────────────

interface ScrubState {
  assetId: string;
  progress: number; // 0..1
}

function MediaCard({
  asset,
  selected,
  viewMode,
  onSelect,
  onAppend,
  isSubscribed,
  onImageToVideo,
}: {
  asset: MediaAsset;
  selected: boolean;
  viewMode: "grid" | "list";
  onSelect: () => void;
  onAppend: () => void;
  isSubscribed: boolean;
  onImageToVideo?: (asset: MediaAsset) => void;
}) {
  const [scrub, setScrub] = useState<ScrubState | null>(null);
  const [scrubThumb, setScrubThumb] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const isVideo = asset.durationSeconds > 0 && asset.previewUrl;

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      // Close if click is not inside a context menu element
      const target = e.target as HTMLElement;
      if (!target.closest(".media-context-menu")) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  // Create hidden video element for scrubbing
  useEffect(() => {
    if (!isVideo) return;
    const vid = document.createElement("video");
    vid.src = asset.previewUrl;
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = "metadata";
    videoRef.current = vid;
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 135;
    canvasRef.current = canvas;
    return () => {
      vid.src = "";
      videoRef.current = null;
    };
  }, [asset.previewUrl, isVideo]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (!isVideo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setScrub({ assetId: asset.id, progress });

    const vid = videoRef.current;
    const canvas = canvasRef.current;
    if (!vid || !canvas) return;

    const targetTime = progress * asset.durationSeconds;
    if (Math.abs(vid.currentTime - targetTime) > 0.08) {
      vid.currentTime = targetTime;
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (!videoRef.current || !canvasRef.current) return;
      const ctx = canvasRef.current.getContext("2d");
      if (!ctx) return;
      try {
        ctx.drawImage(videoRef.current, 0, 0, 240, 135);
        setScrubThumb(canvasRef.current.toDataURL("image/jpeg", 0.7));
      } catch {
        // cross-origin or not ready — just use thumbnail
      }
    });
  }, [asset.id, asset.durationSeconds, isVideo]);

  const handleMouseLeave = useCallback(() => {
    setScrub(null);
    setScrubThumb(null);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }, []);

  const thumbSrc = (scrub && scrubThumb) ? scrubThumb : (asset.thumbnailUrl ?? null);

  if (viewMode === "list") {
    return (
      <>
        <button
          ref={cardRef}
          className={`media-card media-card-list${selected ? " selected" : ""}`}
          onClick={onSelect}
          onDoubleClick={onAppend}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY });
          }}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/x-asset-id", asset.id);
            e.dataTransfer.effectAllowed = "copy";
          }}
          type="button"
          title={`${asset.name} — double-click to add`}
        >
          {/* List thumbnail with proxy badge overlay */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {thumbSrc ? (
              <div
                className="media-card-list-thumb"
                style={{ backgroundImage: `url(${thumbSrc})`, backgroundSize: "cover", backgroundPosition: "center" }}
              />
            ) : (
              <div className="media-card-list-thumb media-card-list-thumb--empty" />
            )}
            {/* Proxy status badge */}
            {asset.proxyGenerating && (
              <div style={{
                position: 'absolute', top: 2, left: 2,
                background: 'rgba(245,158,11,0.9)',
                borderRadius: 3, padding: '1px 4px',
                fontSize: 8, fontWeight: 700, color: '#000',
              }}>⏳ PROXY</div>
            )}
            {asset.proxyReady && !asset.proxyGenerating && (
              <div style={{
                position: 'absolute', top: 2, left: 2,
                background: 'rgba(34,197,94,0.9)',
                borderRadius: 3, padding: '1px 4px',
                fontSize: 8, fontWeight: 700, color: '#000',
              }}>✓ PROXY</div>
            )}
          </div>
          <div className="media-card-list-info">
            <strong className="media-card-list-name">{asset.name}</strong>
            <span className="media-card-list-meta">
              {formatDuration(asset.durationSeconds)} · {asset.width}×{asset.height} · {asset.nativeFps.toFixed(2)} fps
              {asset.videoCodec ? ` · ${asset.videoCodec.toUpperCase()}` : ""}
              {asset.fileSize ? ` · ${formatFileSize(asset.fileSize)}` : ""}
              {asset.hasAudio ? " · 🔊" : ""}
              {asset.isHDR ? " · HDR" : ""}
            </span>
          </div>
          {scrub && (
            <div className="media-card-scrub-bar">
              <div className="media-card-scrub-fill" style={{ width: `${scrub.progress * 100}%` }} />
            </div>
          )}
        </button>
        {contextMenu && (
          <MediaContextMenu
            menu={{ ...contextMenu, asset }}
            onAppend={onAppend}
            onImageToVideo={onImageToVideo ? () => onImageToVideo(asset) : null}
            isSubscribed={isSubscribed}
            onClose={() => setContextMenu(null)}
          />
        )}
      </>
    );
  }

  // Grid mode
  return (
    <>
      <button
        ref={cardRef}
        className={`media-card${selected ? " selected" : ""}${scrub ? " scrubbing" : ""}`}
        onClick={onSelect}
        onDoubleClick={onAppend}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-asset-id", asset.id);
          e.dataTransfer.effectAllowed = "copy";
          setDraggedAssetId(asset.id);
        }}
        onDragEnd={() => setDraggedAssetId(null)}
        type="button"
        title={`${asset.name} — double-click to add`}
      >
        {/* Thumbnail wrapper with position:relative for proxy badge overlay */}
        <div style={{ position: 'relative' }}>
          {thumbSrc ? (
            <div
              className="media-card-preview"
              style={{
                backgroundImage: `linear-gradient(180deg, rgba(8,17,26,0.06), rgba(8,17,26,0.45)), url(${thumbSrc})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
          ) : (
            <div className="media-card-preview media-card-preview--empty">
              <span className="media-card-no-thumb">🎬</span>
            </div>
          )}

          {/* Proxy status badge */}
          {asset.proxyGenerating && (
            <div style={{
              position: 'absolute', top: 2, left: 2,
              background: 'rgba(245,158,11,0.9)',
              borderRadius: 3, padding: '1px 4px',
              fontSize: 8, fontWeight: 700, color: '#000',
            }}>⏳ PROXY</div>
          )}
          {asset.proxyReady && !asset.proxyGenerating && (
            <div style={{
              position: 'absolute', top: 2, left: 2,
              background: 'rgba(34,197,94,0.9)',
              borderRadius: 3, padding: '1px 4px',
              fontSize: 8, fontWeight: 700, color: '#000',
            }}>✓ PROXY</div>
          )}
        </div>

        {/* Scrub progress bar at bottom of preview */}
        {scrub && (
          <div className="media-card-scrub-bar">
            <div className="media-card-scrub-fill" style={{ width: `${scrub.progress * 100}%` }} />
          </div>
        )}

        <div className="media-card-meta">
          <strong>{asset.name}</strong>
          <span>{formatDuration(asset.durationSeconds)}</span>
        </div>
        <div className="media-card-detail">
          <span>{asset.width}×{asset.height}</span>
          <span>{asset.nativeFps.toFixed(2)} fps</span>
        </div>
        <div className="media-card-detail">
          <span>{asset.hasAudio ? "🔊 Audio" : "Video only"}</span>
          <span className="media-card-hint">dbl-click to add</span>
        </div>
      </button>
      {contextMenu && (
        <MediaContextMenu
          menu={{ ...contextMenu, asset }}
          onAppend={onAppend}
          onImageToVideo={onImageToVideo ? () => onImageToVideo(asset) : null}
          isSubscribed={isSubscribed}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}

// ── Sort options ──────────────────────────────────────────────────────────────

type SortKey = "name" | "duration" | "date";
type SortDir = "asc" | "desc";

function sortAssets(assets: MediaAsset[], key: SortKey, dir: SortDir): MediaAsset[] {
  const sorted = [...assets].sort((a, b) => {
    if (key === "name") return a.name.localeCompare(b.name);
    if (key === "duration") return a.durationSeconds - b.durationSeconds;
    return 0; // date — preserve import order
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

// ── Main component ────────────────────────────────────────────────────────────

export function MediaPool({
  assets,
  selectedAssetId,
  selectedSegment,
  transitionMessage,
  importing,
  onImport,
  onSelectAsset,
  onAppendAsset,
  onApplyTransition,
  onApplyTransitionType,
  fsTier,
  fsLinked,
  onImageToVideo,
}: MediaPoolProps) {
  const isSubscribed = (fsLinked === true) && (fsTier !== undefined) && (fsTier !== "free");
  const [activeTab, setActiveTab] = useState<"media" | "transitions">("media");
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    try { return (localStorage.getItem("264pro_media_view") as "grid" | "list") ?? "grid"; } catch { return "grid"; }
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterType, setFilterType] = useState<"all" | "video" | "audio">("all");

  const toggleViewMode = () => {
    const next = viewMode === "grid" ? "list" : "grid";
    setViewMode(next);
    try { localStorage.setItem("264pro_media_view", next); } catch { /* ignore */ }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const handleApplyTransitionType = (
    type: ClipTransitionType,
    edge: "in" | "out",
    durationFrames: number
  ) => {
    if (onApplyTransitionType) {
      onApplyTransitionType(type, edge, durationFrames);
    } else {
      onApplyTransition(edge);
    }
  };

  // Filter + search + sort
  const filtered = sortAssets(
    assets.filter((a) => {
      const matchesSearch = a.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType =
        filterType === "all" ? true :
        filterType === "audio" ? a.hasAudio && a.durationSeconds < 1 :
        true; // video — show everything for now
      return matchesSearch && matchesType;
    }),
    sortKey,
    sortDir
  );

  return (
    <section className="panel media-pool">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Editorial</p>
          <h2>Media Pool</h2>
        </div>
        {activeTab === "media" && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {/* Grid/List toggle */}
            <button
              className="panel-action muted media-pool-view-btn"
              onClick={toggleViewMode}
              title={viewMode === "grid" ? "Switch to list view" : "Switch to grid view"}
              type="button"
            >
              {viewMode === "grid" ? "≡" : "⊞"}
            </button>
            <button
              className="panel-action"
              onClick={() => void onImport()}
              disabled={importing}
              type="button"
            >
              {importing ? (
                <><span className="import-spinner" /> Importing…</>
              ) : "+ Import"}
            </button>
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="panel-tabs">
        <button
          className={`panel-tab${activeTab === "media" ? " active" : ""}`}
          onClick={() => setActiveTab("media")}
          type="button"
        >
          Media
        </button>
        <button
          className={`panel-tab${activeTab === "transitions" ? " active" : ""}`}
          onClick={() => setActiveTab("transitions")}
          type="button"
        >
          Transitions
        </button>
      </div>

      {/* ── Media tab ── */}
      {activeTab === "media" && (
        <>
          {/* Search + filter bar */}
          {assets.length > 0 && (
            <div className="media-pool-toolbar">
              <div className="media-pool-search-wrap">
                <span className="media-pool-search-icon">🔍</span>
                <input
                  className="media-pool-search"
                  type="text"
                  placeholder="Search clips…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  spellCheck={false}
                />
                {searchQuery && (
                  <button
                    className="media-pool-search-clear"
                    onClick={() => setSearchQuery("")}
                    type="button"
                    title="Clear search"
                  >×</button>
                )}
              </div>
              <div className="media-pool-sort-row">
                <span className="media-pool-sort-label">Sort:</span>
                {(["name", "duration", "date"] as SortKey[]).map((k) => (
                  <button
                    key={k}
                    className={`media-pool-sort-btn${sortKey === k ? " active" : ""}`}
                    onClick={() => toggleSort(k)}
                    type="button"
                  >
                    {k === "date" ? "Added" : k.charAt(0).toUpperCase() + k.slice(1)}
                    {sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={`media-list${viewMode === "list" ? " media-list--list" : ""}`}>
            {assets.length === 0 ? (
              <div className="empty-card">
                <p>No source clips yet.</p>
                <span>Import footage to start building the timeline.</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty-card">
                <p>No results for "{searchQuery}"</p>
                <span>Try a different search term.</span>
              </div>
            ) : null}

            {filtered.map((asset) => (
              <MediaCard
                key={asset.id}
                asset={asset}
                selected={selectedAssetId === asset.id}
                viewMode={viewMode}
                onSelect={() => onSelectAsset(asset.id)}
                onAppend={() => onAppendAsset(asset.id)}
                isSubscribed={isSubscribed}
                onImageToVideo={onImageToVideo}
              />
            ))}

            {transitionMessage && (
              <div className="empty-card transition-message">
                <span>{transitionMessage}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Transitions tab ── */}
      {activeTab === "transitions" && (
        <div className="transitions-panel-wrapper">
          {selectedSegment && (
            <div className="transition-target-info">
              <span className="transition-target-label">Target clip:</span>
              <span className="transition-target-name">{selectedSegment.asset.name}</span>
              <div className="transition-target-current">
                <span>In: {selectedSegment.clip.transitionIn
                  ? `${selectedSegment.clip.transitionIn.type} (${selectedSegment.clip.transitionIn.durationFrames}f)`
                  : "None"}</span>
                <span>Out: {selectedSegment.clip.transitionOut
                  ? `${selectedSegment.clip.transitionOut.type} (${selectedSegment.clip.transitionOut.durationFrames}f)`
                  : "None"}</span>
              </div>
            </div>
          )}

          <TransitionsPanel
            selectedClipId={selectedSegment?.clip.id ?? null}
            onApplyTransition={handleApplyTransitionType}
          />

          {transitionMessage && (
            <div className="empty-card transition-message" style={{ margin: "8px" }}>
              <span>{transitionMessage}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
