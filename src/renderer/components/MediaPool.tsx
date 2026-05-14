// ─────────────────────────────────────────────────────────────────────────────
// 264 Pro – Media Pool  (Media tab + Transitions tab)
// UX Polish: hover-scrub, grid/list toggle, search+filter bar
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useState, useRef, useCallback, useEffect } from "react";
import ReactDOM from "react-dom";
import type { ClipTransitionType, MediaAsset, MediaBin } from "../../shared/models";
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
  /** Media bins (folders) for organizing assets */
  bins?: MediaBin[];
  /** assetId → binId mapping */
  assetBins?: Record<string, string>;
  onCreateBin?: (name: string) => void;
  onRenameBin?: (binId: string, name: string) => void;
  onDeleteBin?: (binId: string) => void;
  onMoveAssetToBin?: (assetId: string, binId: string | null) => void;
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

function MediaPoolImpl({
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
  bins = [],
  assetBins = {},
  onCreateBin,
  onRenameBin,
  onDeleteBin,
  onMoveAssetToBin,
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
  // ── Bin state ──
  const [activeBinId, setActiveBinId] = useState<string | null>(null); // null = show all
  const [collapsedBins, setCollapsedBins] = useState<Set<string>>(new Set());
  const [renamingBinId, setRenamingBinId] = useState<string | null>(null);
  const [renamingBinValue, setRenamingBinValue] = useState("");
  const [newBinName, setNewBinName] = useState("");
  const [showNewBinInput, setShowNewBinInput] = useState(false);
  const [dragOverBinId, setDragOverBinId] = useState<string | null>(null);

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

  // Filter + search + sort + active bin
  const filtered = sortAssets(
    assets.filter((a) => {
      const matchesSearch = a.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType =
        filterType === "all" ? true :
        filterType === "audio" ? a.hasAudio && a.durationSeconds < 1 :
        true; // video — show everything for now
      // Bin filter: null = all, smart bins (__ prefix), or manual bin id
      let matchesBin = true;
      if (activeBinId === '__smart_video') matchesBin = !a.hasAudio || a.durationSeconds >= 1;
      else if (activeBinId === '__smart_audio') matchesBin = a.hasAudio && a.durationSeconds > 0 && !(a.sourcePath?.match(/\.(mp4|mov|avi|mkv|webm|hevc)$/i));
      else if (activeBinId === '__smart_short') matchesBin = a.durationSeconds > 0 && a.durationSeconds < 30;
      else if (activeBinId === '__smart_recent') matchesBin = true; // date sort handled by sortAssets
      else if (activeBinId !== null) matchesBin = assetBins[a.id] === activeBinId;
      return matchesSearch && matchesType && matchesBin;
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
          {/* ── Bin Sidebar ───────────────────────────────────────── */}
          {(bins.length > 0 || onCreateBin) && (
            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 4 }}>
              {/* Bin list */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '4px 8px 2px', gap: 4 }}>
                <span style={{ flex: 1, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-s)', textTransform: 'uppercase' }}>Bins</span>
                {onCreateBin && (
                  <button
                    type="button"
                    title="New bin"
                    style={{ fontSize: 14, lineHeight: 1, background: 'none', border: 'none', color: 'var(--text-s)', cursor: 'pointer', padding: '0 2px' }}
                    onClick={() => setShowNewBinInput(v => !v)}
                  >+</button>
                )}
              </div>
              {showNewBinInput && (
                <form
                  style={{ display: 'flex', gap: 4, padding: '2px 8px 4px' }}
                  onSubmit={e => { e.preventDefault(); if (newBinName.trim()) { onCreateBin?.(newBinName.trim()); setNewBinName(''); setShowNewBinInput(false); } }}
                >
                  <input
                    autoFocus
                    type="text"
                    value={newBinName}
                    onChange={e => setNewBinName(e.target.value)}
                    placeholder="Bin name"
                    style={{ flex: 1, fontSize: 11, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, padding: '2px 6px', color: 'var(--text-p)' }}
                    onBlur={() => { if (!newBinName.trim()) setShowNewBinInput(false); }}
                  />
                  <button type="submit" style={{ fontSize: 11, padding: '2px 7px', background: 'rgba(168,85,247,0.2)', border: '1px solid rgba(168,85,247,0.4)', borderRadius: 4, color: '#c084fc', cursor: 'pointer' }}>Add</button>
                </form>
              )}
              {/* All assets row */}
              <button
                type="button"
                onClick={() => setActiveBinId(null)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', fontSize: 11, background: activeBinId === null ? 'rgba(168,85,247,0.15)' : 'none', border: 'none', cursor: 'pointer', color: activeBinId === null ? '#c084fc' : 'var(--text-s)', textAlign: 'left' }}
              >
                <span style={{ opacity: 0.6 }}>&#128240;</span> All Media <span style={{ marginLeft: 'auto', opacity: 0.4 }}>{assets.length}</span>
              </button>
              {/* Smart Bins — auto-filter virtual bins */}
              {[{
                id: '__smart_video', label: '🎥 Video', filter: (a: import('../../shared/models').MediaAsset) => !a.hasAudio || a.durationSeconds >= 1,
              }, {
                id: '__smart_audio', label: '🎵 Audio', filter: (a: import('../../shared/models').MediaAsset) => a.hasAudio && a.durationSeconds > 0 && !a.sourcePath?.match(/\.(mp4|mov|avi|mkv|webm|hevc)$/i),
              }, {
                id: '__smart_short', label: '⚡ Shorts (<30s)', filter: (a: import('../../shared/models').MediaAsset) => a.durationSeconds > 0 && a.durationSeconds < 30,
              }, {
                id: '__smart_recent', label: '🕒 Recent', filter: (_a: import('../../shared/models').MediaAsset) => true, // show most recent 10
              }].map(smart => {
                const count = smart.id === '__smart_recent' ? Math.min(assets.length, 10) : assets.filter(smart.filter).length;
                if (count === 0 && smart.id !== '__smart_recent') return null;
                return (
                  <button
                    key={smart.id}
                    type="button"
                    onClick={() => setActiveBinId(smart.id as any)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '2px 10px 2px 22px', fontSize: 10, background: activeBinId === smart.id ? 'rgba(59,138,247,0.12)' : 'none', border: 'none', cursor: 'pointer', color: activeBinId === smart.id ? '#3b8af7' : 'var(--text-s)', textAlign: 'left', fontStyle: 'italic' }}
                  >
                    {smart.label} <span style={{ marginLeft: 'auto', opacity: 0.4 }}>{count}</span>
                  </button>
                );
              })}
              {bins.filter(b => !b.parentId).map(bin => {
                const count = Object.values(assetBins).filter(bid => bid === bin.id).length;
                return (
                  <div
                    key={bin.id}
                    onDragOver={e => { e.preventDefault(); setDragOverBinId(bin.id); }}
                    onDragLeave={() => setDragOverBinId(null)}
                    onDrop={e => {
                      e.preventDefault(); setDragOverBinId(null);
                      const assetId = e.dataTransfer.getData('asset-id');
                      if (assetId) onMoveAssetToBin?.(assetId, bin.id);
                    }}
                    style={{ background: dragOverBinId === bin.id ? 'rgba(168,85,247,0.18)' : 'none', borderRadius: 4 }}
                  >
                    {renamingBinId === bin.id ? (
                      <form
                        style={{ display: 'flex', gap: 4, padding: '2px 8px' }}
                        onSubmit={e => { e.preventDefault(); if (renamingBinValue.trim()) { onRenameBin?.(bin.id, renamingBinValue.trim()); } setRenamingBinId(null); }}
                      >
                        <input autoFocus type="text" value={renamingBinValue} onChange={e => setRenamingBinValue(e.target.value)}
                          style={{ flex: 1, fontSize: 11, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, padding: '2px 6px', color: 'var(--text-p)' }}
                          onBlur={() => setRenamingBinId(null)} />
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setActiveBinId(bin.id)}
                        onDoubleClick={() => { setRenamingBinId(bin.id); setRenamingBinValue(bin.name); }}
                        title={`${bin.name} \u2014 Double-click to rename, drag clips here to move`}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px 3px 18px', fontSize: 11, background: activeBinId === bin.id ? 'rgba(168,85,247,0.15)' : 'none', border: 'none', cursor: 'pointer', color: activeBinId === bin.id ? '#c084fc' : 'var(--text-s)', textAlign: 'left' }}
                      >
                        <span style={{ opacity: 0.6 }}>{collapsedBins.has(bin.id) ? '\u25b6' : '\u25bc'}</span>
                        <span
                          onClick={e => { e.stopPropagation(); setCollapsedBins(p => { const n = new Set(p); n.has(bin.id) ? n.delete(bin.id) : n.add(bin.id); return n; }); }}
                          style={{ marginRight: 2 }}
                        />
                        &#128193; {bin.name}
                        <span style={{ marginLeft: 'auto', opacity: 0.4 }}>{count}</span>
                        <button
                          type="button"
                          title="Delete bin"
                          onClick={e => { e.stopPropagation(); onDeleteBin?.(bin.id); if (activeBinId === bin.id) setActiveBinId(null); }}
                          style={{ fontSize: 10, background: 'none', border: 'none', color: 'rgba(239,68,68,0.6)', cursor: 'pointer', padding: '0 2px', marginLeft: 2 }}
                        >\u2715</button>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

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

// Memoised export — props are mostly stable refs, so this avoids re-rendering
// the media pool every time an unrelated piece of editor state changes.
export const MediaPool = memo(MediaPoolImpl);
