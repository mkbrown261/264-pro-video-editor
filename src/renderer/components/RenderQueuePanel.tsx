/**
 * RenderQueuePanel
 * ─────────────────────────────────────────────────────────────────────────────
 * Floating panel that shows queued / rendering / done / error render jobs.
 * Jobs are added via "Add to Queue" in InspectorPanel and processed
 * sequentially by the queue runner in App.tsx.
 */

import React from "react";
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

// ── Panel component ────────────────────────────────────────────────────────────

interface RenderQueuePanelProps {
  jobs: RenderJob[];
  onRemoveJob: (jobId: string) => void;
  onRetryJob: (jobId: string) => void;
  onRevealOutput: (outputPath: string) => void;
  onClose: () => void;
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
}: RenderQueuePanelProps) {
  const activeCount = jobs.filter((j) => j.status === "rendering" || j.status === "queued").length;

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
        <button className="rq-close-btn" onClick={onClose} type="button" title="Close">
          ✕
        </button>
      </div>

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
