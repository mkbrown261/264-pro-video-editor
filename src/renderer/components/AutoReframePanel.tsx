import React, { useState } from "react";
import { toast } from "../lib/toast";
import type { MediaAsset } from "../../shared/models";

interface AutoReframePanelProps {
  assets: MediaAsset[];
  onAddAsset: (asset: MediaAsset) => void;
  onClose: () => void;
}

type AspectRatio = "9:16" | "1:1" | "4:5" | "16:9" | "4:3";
type TrackingMode = "center" | "face" | "motion";

const ASPECT_OPTIONS: { value: AspectRatio; label: string; icon: string; desc: string }[] = [
  { value: "9:16", label: "9:16", icon: "📱", desc: "TikTok / Reels / Shorts" },
  { value: "1:1",  label: "1:1",  icon: "⬛", desc: "Instagram Square" },
  { value: "4:5",  label: "4:5",  icon: "🖼", desc: "Instagram Portrait" },
  { value: "16:9", label: "16:9", icon: "🖥", desc: "YouTube / Landscape" },
  { value: "4:3",  label: "4:3",  icon: "📺", desc: "Classic / Broadcast" },
];

const TRACKING_OPTIONS: { value: TrackingMode; label: string; desc: string }[] = [
  { value: "face",   label: "👤 Face",   desc: "Center on faces (best for talking heads)" },
  { value: "motion", label: "🎯 Motion", desc: "Follow main subject movement" },
  { value: "center", label: "⊕ Center", desc: "Static center crop" },
];

export function AutoReframePanel({ assets, onAddAsset, onClose }: AutoReframePanelProps) {
  // Filter to video assets (width > 0 indicates a video/image with dimensions)
  const videoAssets = assets.filter(a => a.width > 0 && a.durationSeconds > 0);

  const [selectedAssetId, setSelectedAssetId] = useState(videoAssets[0]?.id ?? "");
  const [targetAspect, setTargetAspect]       = useState<AspectRatio>("9:16");
  const [trackingMode, setTrackingMode]       = useState<TrackingMode>("face");
  const [reframing, setReframing]             = useState(false);
  const [progress, setProgress]               = useState("");

  async function handleReframe() {
    const asset = videoAssets.find(a => a.id === selectedAssetId);
    if (!asset?.sourcePath) {
      toast.error("Select a video clip first");
      return;
    }

    setReframing(true);
    setProgress("🔍 Analyzing clip…");

    try {
      // Build output path: same dir, _reframe_9x16 suffix
      const aspectSuffix = targetAspect.replace(":", "x");
      const dotIdx = asset.sourcePath.lastIndexOf(".");
      const base   = dotIdx >= 0 ? asset.sourcePath.slice(0, dotIdx) : asset.sourcePath;
      const ext    = dotIdx >= 0 ? asset.sourcePath.slice(dotIdx)    : ".mp4";
      const outputPath = `${base}_reframe_${aspectSuffix}${ext}`;

      setProgress("⚙️ Reframing with FFmpeg…");

      const result = await window.electronAPI?.reframeAnalyzeAndExport?.({
        sourcePath: asset.sourcePath,
        targetAspect,
        outputPath,
        trackingMode,
      });

      if (!result?.success) {
        toast.error(result?.error ?? "Reframe failed");
        return;
      }

      // Derive a stable new asset id
      const newId = `${asset.id}_reframe_${aspectSuffix}_${Date.now()}`;

      const newAsset: MediaAsset = {
        ...asset,
        id:           newId,
        name:         `${asset.name} [${targetAspect}]`,
        sourcePath:   result.outputPath!,
        previewUrl:   `media://${result.outputPath}`,
        thumbnailUrl: null,
        width:        result.cropW  ?? asset.width,
        height:       result.cropH  ?? asset.height,
        filmstripThumbs: undefined,
      };

      onAddAsset(newAsset);
      toast.success(`✅ Reframed to ${targetAspect} — added to Media Pool`);
      setProgress("");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reframe failed");
    } finally {
      setReframing(false);
    }
  }

  return (
    <div
      style={{
        background: "#0d1117",
        border: "1px solid rgba(59,130,246,0.3)",
        borderRadius: 12,
        padding: 20,
        width: 340,
        color: "#e2e8f0",
        fontFamily: "inherit",
        boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
        <span style={{ fontSize: 18 }}>🎯</span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#fff" }}>Auto-Reframe</div>
          <div style={{ fontSize: 10, color: "#3b82f6", letterSpacing: "0.06em" }}>
            AI CROP INTELLIGENCE
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            marginLeft: "auto",
            background: "none",
            border: "none",
            color: "#64748b",
            fontSize: 14,
            cursor: "pointer",
            padding: "2px 6px",
          }}
        >
          ✕
        </button>
      </div>

      {/* ── Source clip selector ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
          Source Clip
        </div>
        <select
          value={selectedAssetId}
          onChange={e => setSelectedAssetId(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 7,
            background: "#1e293b",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#e2e8f0",
            fontSize: 12,
          }}
        >
          {videoAssets.length === 0 && <option value="">No video clips in media pool</option>}
          {videoAssets.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      {/* ── Target aspect ratio ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
          Target Format
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {ASPECT_OPTIONS.map(opt => (
            <div
              key={opt.value}
              onClick={() => setTargetAspect(opt.value)}
              style={{
                padding: "8px 6px",
                borderRadius: 8,
                border: `1px solid ${targetAspect === opt.value ? "#3b82f6" : "#1e293b"}`,
                background: targetAspect === opt.value ? "rgba(59,130,246,0.15)" : "#0f172a",
                cursor: "pointer",
                textAlign: "center",
                transition: "all 0.15s",
                userSelect: "none",
              }}
            >
              <div style={{ fontSize: 16, marginBottom: 2 }}>{opt.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: targetAspect === opt.value ? "#93c5fd" : "#94a3b8" }}>
                {opt.label}
              </div>
              <div style={{ fontSize: 9, color: "#475569", marginTop: 1, lineHeight: 1.3 }}>
                {opt.desc}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tracking mode ── */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
          Tracking Mode
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {TRACKING_OPTIONS.map(opt => (
            <div
              key={opt.value}
              onClick={() => setTrackingMode(opt.value)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                borderRadius: 7,
                cursor: "pointer",
                border: `1px solid ${trackingMode === opt.value ? "#3b82f6" : "#1e293b"}`,
                background: trackingMode === opt.value ? "rgba(59,130,246,0.1)" : "#0f172a",
                transition: "all 0.15s",
                userSelect: "none",
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  border: `2px solid ${trackingMode === opt.value ? "#3b82f6" : "#334155"}`,
                  background: trackingMode === opt.value ? "#3b82f6" : "transparent",
                  flexShrink: 0,
                }}
              />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: trackingMode === opt.value ? "#93c5fd" : "#94a3b8" }}>
                  {opt.label}
                </div>
                <div style={{ fontSize: 10, color: "#475569" }}>{opt.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Progress indicator ── */}
      {progress && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            background: "rgba(59,130,246,0.1)",
            border: "1px solid rgba(59,130,246,0.2)",
            fontSize: 11,
            color: "#93c5fd",
            marginBottom: 12,
          }}
        >
          {progress}
        </div>
      )}

      {/* ── Reframe button ── */}
      <button
        type="button"
        onClick={handleReframe}
        disabled={reframing || !selectedAssetId}
        style={{
          width: "100%",
          padding: "12px",
          borderRadius: 8,
          border: "none",
          background: reframing
            ? "rgba(59,130,246,0.3)"
            : "linear-gradient(135deg, #1d4ed8, #3b82f6)",
          color: "#fff",
          fontSize: 13,
          fontWeight: 700,
          cursor: reframing || !selectedAssetId ? "not-allowed" : "pointer",
          opacity: !selectedAssetId ? 0.5 : 1,
        }}
      >
        {reframing ? "⏳ Reframing…" : `🎯 Reframe to ${targetAspect}`}
      </button>
    </div>
  );
}
