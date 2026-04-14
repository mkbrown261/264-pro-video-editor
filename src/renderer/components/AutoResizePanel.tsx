/**
 * AutoResizePanel — EXCLUSIVE 2: Social Media Auto-Resize
 * Shows 4 format variants (16:9, 9:16, 1:1, 4:5) with preview thumbnails.
 * "Export All Formats" adds batch render jobs for all 4 simultaneously.
 */
import React, { useState } from "react";
import type { ExportCodec } from "../../shared/models";
import type { RenderJob } from "./RenderQueuePanel";

interface FormatVariant {
  id: string;
  label: string;
  platform: string;
  icon: string;
  width: number;
  height: number;
  suffix: string;
  codec: ExportCodec;
}

const VARIANTS: FormatVariant[] = [
  { id: "16x9",  label: "16:9",  platform: "YouTube / Desktop",  icon: "🖥",  width: 1920, height: 1080, suffix: "_youtube",    codec: "libx264" },
  { id: "9x16",  label: "9:16",  platform: "TikTok / Reels",      icon: "📱",  width: 1080, height: 1920, suffix: "_reels",      codec: "libx264" },
  { id: "1x1",   label: "1:1",   platform: "Instagram Square",    icon: "⬛", width: 1080, height: 1080, suffix: "_instagram",  codec: "libx264" },
  { id: "4x5",   label: "4:5",   platform: "Instagram Feed",       icon: "📷",  width: 1080, height: 1350, suffix: "_feed",       codec: "libx264" },
];

interface Props {
  projectName: string;
  onAddBatchJobs: (jobs: Omit<RenderJob, "id" | "createdAt" | "progress" | "status">[]) => void;
  onClose: () => void;
}

export function AutoResizePanel({ projectName, onAddBatchJobs, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(VARIANTS.map(v => v.id)));
  const [outputDir, setOutputDir] = useState("");

  function toggleVariant(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  function handleExportAll() {
    const jobs = VARIANTS.filter(v => selected.has(v.id)).map(v => ({
      label: `${projectName}${v.suffix} · ${v.label} · ${v.platform}`,
      codec: v.codec,
      outputWidth: v.width,
      outputHeight: v.height,
    }));
    onAddBatchJobs(jobs);
    onClose();
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 8200 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#1a1a1f", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 28, width: 600, maxWidth: "95vw" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#e8e8e8" }}>📱 Social Media Auto-Resize</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>
              Automatically crop and export your project for multiple platforms
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 18 }} type="button">✕</button>
        </div>

        {/* Format grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
          {VARIANTS.map(v => {
            const isSelected = selected.has(v.id);
            // Visual frame ratio
            const maxH = 90;
            const ratio = v.width / v.height;
            const frameW = Math.min(80, maxH * ratio);
            const frameH = frameW / ratio;

            return (
              <button
                key={v.id}
                type="button"
                onClick={() => toggleVariant(v.id)}
                style={{
                  background: isSelected ? "rgba(79,142,247,0.12)" : "rgba(255,255,255,0.04)",
                  border: `2px solid ${isSelected ? "#4f8ef7" : "rgba(255,255,255,0.1)"}`,
                  borderRadius: 10,
                  padding: "12px 8px",
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "all 0.15s",
                }}
              >
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginBottom: 8, minHeight: maxH }}>
                  <div
                    style={{
                      width: frameW,
                      height: frameH,
                      background: isSelected ? "rgba(79,142,247,0.25)" : "rgba(255,255,255,0.06)",
                      border: `1px solid ${isSelected ? "rgba(79,142,247,0.5)" : "rgba(255,255,255,0.15)"}`,
                      borderRadius: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 20,
                    }}
                  >
                    {v.icon}
                  </div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#e8e8e8", marginBottom: 3 }}>{v.label}</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>{v.platform}</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>{v.width}×{v.height}</div>
                <div style={{ marginTop: 6 }}>
                  <div
                    style={{
                      display: "inline-block",
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      border: `2px solid ${isSelected ? "#4f8ef7" : "rgba(255,255,255,0.2)"}`,
                      background: isSelected ? "#4f8ef7" : "transparent",
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        {/* Crop mode info */}
        <div style={{ background: "rgba(79,142,247,0.07)", border: "1px solid rgba(79,142,247,0.15)", borderRadius: 8, padding: "10px 14px", marginBottom: 18, fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
          <strong style={{ color: "rgba(255,255,255,0.7)" }}>Auto-crop mode:</strong> Center crop — the most important action stays in frame.
          All variants are exported simultaneously to the Render Queue.
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{ padding: "8px 16px", borderRadius: 8, background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.5)", fontSize: 12, cursor: "pointer" }}
            type="button"
          >
            Cancel
          </button>
          <button
            onClick={handleExportAll}
            disabled={selected.size === 0}
            style={{
              padding: "8px 18px", borderRadius: 8,
              background: selected.size > 0 ? "linear-gradient(135deg,#4f8ef7,#7c3aed)" : "rgba(255,255,255,0.08)",
              border: "none", color: "#fff", fontSize: 12, fontWeight: 700, cursor: selected.size > 0 ? "pointer" : "not-allowed"
            }}
            type="button"
          >
            🚀 Export {selected.size} Format{selected.size !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
