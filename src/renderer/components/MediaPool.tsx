import { useState } from "react";
import type { MediaAsset } from "../../shared/models";
import type { TimelineSegment } from "../../shared/timeline";
import { formatDuration } from "../lib/format";

interface MediaPoolProps {
  assets: MediaAsset[];
  selectedAssetId: string | null;
  selectedSegment: TimelineSegment | null;
  transitionMessage: string | null;
  onImport: () => Promise<void>;
  onSelectAsset: (assetId: string) => void;
  onAppendAsset: (assetId: string) => void;
  onApplyTransition: (edge: "in" | "out") => void;
}

export function MediaPool({
  assets,
  selectedAssetId,
  selectedSegment,
  transitionMessage,
  onImport,
  onSelectAsset,
  onAppendAsset,
  onApplyTransition
}: MediaPoolProps) {
  const [activeTab, setActiveTab] = useState<"media" | "transitions">("media");

  return (
    <section className="panel media-pool">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Editorial</p>
          <h2>Media Pool</h2>
        </div>
        <button className="panel-action" onClick={() => void onImport()}>
          Import Media
        </button>
      </div>

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

      <div className="media-list">
        {activeTab === "media" ? (
          <>
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
                  <span>
                    {asset.width}x{asset.height}
                  </span>
                  <span>{asset.nativeFps.toFixed(2)} fps</span>
                </div>
                <div className="media-card-detail">
                  <span>{asset.hasAudio ? "Video + audio" : "Video only"}</span>
                  <span>Add with double-click</span>
                </div>
              </button>
            ))}
          </>
        ) : (
          <>
            <div className="inspector-card">
              <p className="inspector-label">Transition Target</p>
              <strong>{selectedSegment?.asset.name ?? "No timeline clip selected"}</strong>
              <span>
                {selectedSegment
                  ? "Transitions apply to the selected video clip in the sequence."
                  : "Select a clip in the timeline, then add a transition from here."}
              </span>
              {selectedSegment ? (
                <>
                  <span>
                    In:{" "}
                    {selectedSegment.clip.transitionIn
                      ? `Fade ${selectedSegment.clip.transitionIn.durationFrames}f`
                      : "None"}
                  </span>
                  <span>
                    Out:{" "}
                    {selectedSegment.clip.transitionOut
                      ? `Fade ${selectedSegment.clip.transitionOut.durationFrames}f`
                      : "None"}
                  </span>
                </>
              ) : null}
            </div>

            <button
              className="media-card transition-card"
              onClick={() => onApplyTransition("in")}
              type="button"
            >
              <div className="transition-swatch fade-in" />
              <div className="media-card-meta">
                <strong>Fade In</strong>
                <span>Clip start</span>
              </div>
              <div className="media-card-detail">
                <span>Preview + export supported</span>
                <span>0.5 sec default</span>
              </div>
            </button>

            <button
              className="media-card transition-card"
              onClick={() => onApplyTransition("out")}
              type="button"
            >
              <div className="transition-swatch fade-out" />
              <div className="media-card-meta">
                <strong>Fade Out</strong>
                <span>Clip end</span>
              </div>
              <div className="media-card-detail">
                <span>Preview + export supported</span>
                <span>0.5 sec default</span>
              </div>
            </button>

            {transitionMessage ? (
              <div className="empty-card transition-message">
                <span>{transitionMessage}</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
