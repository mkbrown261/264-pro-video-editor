// ─────────────────────────────────────────────────────────────────────────────
// 264 Pro – Media Pool  (Media tab + Transitions tab)
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import type { ClipTransitionType, MediaAsset } from "../../shared/models";
import type { TimelineSegment } from "../../shared/timeline";
import { formatDuration } from "../lib/format";
import { TransitionsPanel } from "./TransitionsPanel";

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
}

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
}: MediaPoolProps) {
  const [activeTab, setActiveTab] = useState<"media" | "transitions">("media");

  const handleApplyTransitionType = (
    type: ClipTransitionType,
    edge: "in" | "out",
    durationFrames: number
  ) => {
    if (onApplyTransitionType) {
      onApplyTransitionType(type, edge, durationFrames);
    } else {
      // Fallback: use legacy apply (only supports fade)
      onApplyTransition(edge);
    }
  };

  return (
    <section className="panel media-pool">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Editorial</p>
          <h2>Media Pool</h2>
        </div>
        {activeTab === "media" && (
          <button
            className="panel-action"
            onClick={() => void onImport()}
            disabled={importing}
            type="button"
          >
            {importing ? (
              <><span className="import-spinner" /> Importing…</>
            ) : "Import Media"}
          </button>
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
        <div className="media-list">
          {assets.length === 0 ? (
            <div className="empty-card">
              <p>No source clips yet.</p>
              <span>Import footage to start building the timeline.</span>
            </div>
          ) : null}

          {assets.map((asset) => (
            <button
              key={asset.id}
              className={`media-card${selectedAssetId === asset.id ? " selected" : ""}`}
              onClick={() => onSelectAsset(asset.id)}
              onDoubleClick={() => onAppendAsset(asset.id)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-asset-id", asset.id);
                e.dataTransfer.effectAllowed = "copy";
              }}
              type="button"
            >
              {asset.thumbnailUrl ? (
                <div
                  className="media-card-preview"
                  style={{
                    backgroundImage: `linear-gradient(180deg, rgba(8, 17, 26, 0.08), rgba(8, 17, 26, 0.42)), url(${asset.thumbnailUrl})`
                  }}
                />
              ) : null}
              <div className="media-card-meta">
                <strong>{asset.name}</strong>
                <span>{formatDuration(asset.durationSeconds)}</span>
              </div>
              <div className="media-card-detail">
                <span>{asset.width}x{asset.height}</span>
                <span>{asset.nativeFps.toFixed(2)} fps</span>
              </div>
              <div className="media-card-detail">
                <span>{asset.hasAudio ? "Video + audio" : "Video only"}</span>
                <span>Add with double-click</span>
              </div>
            </button>
          ))}

          {transitionMessage && (
            <div className="empty-card transition-message">
              <span>{transitionMessage}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Transitions tab ── */}
      {activeTab === "transitions" && (
        <div className="transitions-panel-wrapper">
          {/* Selected clip indicator */}
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
