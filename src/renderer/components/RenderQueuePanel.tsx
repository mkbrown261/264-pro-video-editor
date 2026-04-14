/**
 * RenderQueuePanel
 * ─────────────────────────────────────────────────────────────────────────────
 * Floating panel that shows queued / rendering / done / error render jobs.
 * Jobs are added via "Add to Queue" in InspectorPanel and processed
 * sequentially by the queue runner in App.tsx.
 */

import React, { useState } from "react";
import type { ExportCodec } from "../../shared/models";

// ── Types ──────────────────────────────────────────────────────────────────────

export type RenderJobStatus = "queued" | "rendering" | "done" | "error";

export interface RenderJob {
  id: string;
  label: string;           // e.g. "YouTube · H.264 · 1080p"
  codec: ExportCodec;
  outputWidth: number;
  outputHeight: number;
  status: RenderJobStatus;
  progress: number;        // 0–100
  outputPath?: string;     // set on success
  errorMessage?: string;   // set on error
  createdAt: number;       // Date.now()
}

// ── Batch Export Presets (GAP D) ──────────────────────────────────────────────

export interface BatchPreset {
  id: string;
  label: string;
  codec: ExportCodec;
  width: number;
  height: number;
  suffix: string;
}

export const BATCH_PRESETS: BatchPreset[] = [
  { id: "youtube",   label: "YouTube (H.264 1080p)",      codec: "libx264",   width: 1920, height: 1080, suffix: "_youtube"   },
  { id: "instagram", label: "Instagram (H.264 1080p sq)", codec: "libx264",   width: 1080, height: 1080, suffix: "_instagram" },
  { id: "prores",    label: "ProRes 4444 (Master)",       codec: "prores_ks", width: 0,    height: 0,    suffix: "_master"    },
  { id: "reels",     label: "Reels / TikTok (9:16)",      codec: "libx264",   width: 1080, height: 1920, suffix: "_reels"     },
  { id: "4k",        label: "4K H.265 (Archive)",         codec: "libx265",   width: 3840, height: 2160, suffix: "_4k"        },
  { id: "vp9",       label: "VP9 WebM (Web)",             codec: "libvpx-vp9",width: 1920, height: 1080, suffix: "_web"       },
];

// ── Panel component ────────────────────────────────────────────────────────────

interface RenderQueuePanelProps {
  jobs: RenderJob[];
  onRemoveJob: (jobId: string) => void;
  onRetryJob: (jobId: string) => void;
  onRevealOutput: (outputPath: string) => void;
  onClose: () => void;
  onAddBatchJobs?: (presets: BatchPreset[]) => void;
  onDeliveryPackage?: () => void;
  projectName?: string;
}

const STATUS_ICONS: Record<RenderJobStatus, string> = {
  queued:    "⏳",
  rendering: "⚙️",
  done:      "✓",
  error:     "✕",
};

const STATUS_COLORS: Record<RenderJobStatus, string> = {
  queued:    "rgba(255,255,255,0.35)",
  rendering: "#f7c948",
  done:      "#2fc77a",
  error:     "#ef5350",
};

function formatAge(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

export function RenderQueuePanel({
  jobs,
  onRemoveJob,
  onRetryJob,
  onRevealOutput,
  onClose,
  onAddBatchJobs,
  onDeliveryPackage,
  projectName = "Project",
}: RenderQueuePanelProps) {
  const [showBatch, setShowBatch] = useState(false);
  const [selectedPresets, setSelectedPresets] = useState<Set<string>>(new Set(["youtube", "prores"]));
  const activeCount = jobs.filter((j) => j.status === "rendering" || j.status === "queued").length;

  function togglePreset(id: string) {
    setSelectedPresets(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function handleAddBatch() {
    if (!onAddBatchJobs) return;
    const presets = BATCH_PRESETS.filter(p => selectedPresets.has(p.id));
    onAddBatchJobs(presets);
    setShowBatch(false);
  }

  return (
    <div className="rq-panel">
      {/* Header */}
      <div className="rq-header">
        <div className="rq-title">
          <span>⚙️ Render Queue</span>
          {activeCount > 0 && (
            <span className="rq-badge">{activeCount}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {onAddBatchJobs && (
            <button
              type="button"
              onClick={() => setShowBatch(v => !v)}
              style={{ padding: "3px 8px", borderRadius: 5, background: showBatch ? "rgba(79,142,247,0.2)" : "rgba(255,255,255,0.07)", border: "1px solid rgba(79,142,247,0.3)", color: "#4f8ef7", fontSize: 10, fontWeight: 600, cursor: "pointer" }}
              title="Add Batch Export Job"
            >
              + Batch Export
            </button>
          )}
          <button className="rq-close-btn" onClick={onClose} type="button" title="Close">
            ✕
          </button>
        </div>
      </div>

      {/* One-Click Delivery Package */}
      {onDeliveryPackage && (
        <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <button
            type="button"
            onClick={onDeliveryPackage}
            style={{
              width: "100%", padding: "12px", borderRadius: 9,
              background: "linear-gradient(135deg,#7c3aed,#a855f7)",
              border: "none", color: "#fff", fontSize: 13, fontWeight: 800,
              cursor: "pointer", letterSpacing: "0.02em",
            }}
            title="Queue all 6 delivery formats simultaneously: YouTube, Instagram Reel, TikTok, Twitter/X, ProRes Master, Audio Only"
          >
            🚀 One-Click Delivery Package (6 Formats)
          </button>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textAlign: "center", marginTop: 5 }}>
            YouTube · Instagram Reel · TikTok · Twitter/X · ProRes Master · Audio Only
          </div>
        </div>
      )}

      {/* Batch export panel */}
      {showBatch && onAddBatchJobs && (
        <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.3)" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.5)", marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.05em" }}>Select Export Formats</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
            {BATCH_PRESETS.map(p => (
              <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer" }}>
                <input type="checkbox" checked={selectedPresets.has(p.id)} onChange={() => togglePreset(p.id)} style={{ accentColor: "#4f8ef7" }} />
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.65)" }}>{p.label}</span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginLeft: "auto" }}>{projectName}{p.suffix}</span>
              </label>
            ))}
          </div>
          <button
            onClick={handleAddBatch}
            disabled={selectedPresets.size === 0}
            type="button"
            style={{ width: "100%", padding: "6px 0", borderRadius: 6, background: selectedPresets.size > 0 ? "linear-gradient(135deg,#4f8ef7,#7c3aed)" : "rgba(255,255,255,0.07)", border: "none", color: "#fff", fontSize: 11, fontWeight: 700, cursor: selectedPresets.size > 0 ? "pointer" : "not-allowed" }}
          >
            Add {selectedPresets.size} Job{selectedPresets.size !== 1 ? "s" : ""} to Queue
          </button>
        </div>
      )}

      {/* Job list */}
      <div className="rq-job-list">
        {jobs.length === 0 ? (
          <div className="rq-empty">
            No jobs in queue.<br />
            <span style={{ opacity: 0.4, fontSize: "0.7rem" }}>
              Use "Add to Queue" in the Export panel.
            </span>
          </div>
        ) : (
          jobs.map((job) => (
            <div
              key={job.id}
              className={`rq-job rq-job--${job.status}`}
            >
              {/* Status icon */}
              <div className="rq-job-icon" style={{ color: STATUS_COLORS[job.status] }}>
                {STATUS_ICONS[job.status]}
              </div>

              {/* Info */}
              <div className="rq-job-info">
                <div className="rq-job-label">{job.label}</div>
                <div className="rq-job-meta">
                  {job.status === "rendering" && (
                    <div className="rq-job-progress-row">
                      <div className="rq-job-progress-bar">
                        <div
                          className="rq-job-progress-fill"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                      <span className="rq-job-pct">{Math.round(job.progress)}%</span>
                    </div>
                  )}
                  {job.status === "queued" && (
                    <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.65rem" }}>
                      Waiting… {formatAge(job.createdAt)}
                    </span>
                  )}
                  {job.status === "done" && job.outputPath && (
                    <span style={{ color: "#2fc77a", fontSize: "0.65rem" }}>
                      ✓ Done · {formatAge(job.createdAt)}
                    </span>
                  )}
                  {job.status === "error" && (
                    <span style={{ color: "#ef5350", fontSize: "0.65rem" }} title={job.errorMessage}>
                      {job.errorMessage ?? "Unknown error"}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="rq-job-actions">
                {job.status === "done" && job.outputPath && (
                  <button
                    className="rq-action-btn"
                    onClick={() => onRevealOutput(job.outputPath!)}
                    title="Reveal in Finder"
                    type="button"
                  >
                    📂
                  </button>
                )}
                {job.status === "error" && (
                  <button
                    className="rq-action-btn"
                    onClick={() => onRetryJob(job.id)}
                    title="Retry"
                    type="button"
                  >
                    ↺
                  </button>
                )}
                {(job.status === "queued" || job.status === "done" || job.status === "error") && (
                  <button
                    className="rq-action-btn rq-remove-btn"
                    onClick={() => onRemoveJob(job.id)}
                    title="Remove"
                    type="button"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer: clear completed */}
      {jobs.some((j) => j.status === "done" || j.status === "error") && (
        <div className="rq-footer">
          <button
            className="rq-clear-btn"
            onClick={() => jobs.filter((j) => j.status === "done" || j.status === "error").forEach((j) => onRemoveJob(j.id))}
            type="button"
          >
            Clear Completed
          </button>
        </div>
      )}
    </div>
  );
}
