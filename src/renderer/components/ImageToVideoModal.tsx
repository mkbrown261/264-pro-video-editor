/** Image → video generation modal (extracted from App.tsx). */
import React, { useEffect, useRef, useState } from "react";
import { toast } from "../lib/toast";

// ── ImageToVideoModal ─────────────────────────────────────────────────────────
interface ImageToVideoModalProps {
  asset: import("../../shared/models").MediaAsset;
  fsTier: string;
  fsLinked: boolean;
  onClose: () => void;
  onAddToMediaPool: (videoUrl: string, name: string) => void;
}

export function ImageToVideoModal({ asset, fsTier, fsLinked, onClose, onAddToMediaPool }: ImageToVideoModalProps) {
  const [prompt, setPrompt] = React.useState("");
  const [duration, setDuration] = React.useState<2 | 3 | 5>(3);
  const [model, setModel] = React.useState("kling/v1.6/standard");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isSubscribed = fsLinked && fsTier !== "free";
  const imageUrl = asset.previewUrl ?? asset.sourcePath;

  const creditEstimates: Record<string, number> = { 2: 10, 3: 15, 5: 25 };
  const creditCost = creditEstimates[duration] ?? 15;

  async function handleGenerate() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = (await (window.flowstateAPI?.apiCall(
        "/api/264pro/image-to-video",
        "POST",
        { imageUrl, prompt, duration, model }
      ) ?? Promise.resolve({ error: "Not in Electron" }))) as { videoUrl?: string; error?: string };
      if (res?.error) throw new Error(res.error);
      const url = res?.videoUrl;
      if (!url) throw new Error("No video URL returned");
      onAddToMediaPool(url, `img2vid_${asset.name}_${Date.now()}.mp4`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="img2vid-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="img2vid-modal">
        <div className="img2vid-header">
          <span style={{ fontWeight: 700, fontSize: 14, color: "#e8e8e8" }}>🎬 Image to Video</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16 }}
          >✕</button>
        </div>

        {!isSubscribed ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>🔒</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e8e8e8", marginBottom: 8 }}>Pro Feature</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
              Image-to-Video requires a FlowState Pro subscription.
            </div>
            <a
              href="https://flowstate-67g.pages.dev/upgrade?ref=264pro-img2vid"
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-block", marginTop: 16, padding: "9px 20px", borderRadius: 9, background: "linear-gradient(135deg,#e07820,#a855f7)", color: "#fff", fontWeight: 700, fontSize: 13, textDecoration: "none" }}
            >
              Upgrade to Pro
            </a>
          </div>
        ) : (
          <>
            {/* Image preview */}
            <div className="img2vid-preview">
              {imageUrl ? (
                <img src={imageUrl} alt={asset.name} style={{ maxWidth: "100%", maxHeight: 160, borderRadius: 8, objectFit: "contain" }} />
              ) : (
                <div style={{ width: "100%", height: 120, background: "rgba(255,255,255,0.05)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontSize: 12 }}>
                  🖼 {asset.name}
                </div>
              )}
            </div>

            {/* Options */}
            <div className="img2vid-opts">
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4, fontWeight: 600 }}>MODEL</div>
                <select
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#e8e8e8", fontSize: 11, padding: "5px 7px" }}
                >
                  <option value="kling/v1.6/standard">Kling v1.6 Standard</option>
                  <option value="kling/v1.6/pro">Kling v1.6 Pro</option>
                  <option value="minimax/video-01">Minimax Video-01</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4, fontWeight: 600 }}>DURATION</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {([2, 3, 5] as const).map(d => (
                    <button
                      key={d}
                      onClick={() => setDuration(d)}
                      style={{ padding: "4px 9px", borderRadius: 5, border: `1px solid ${duration === d ? "rgba(168,85,247,0.6)" : "rgba(255,255,255,0.12)"}`, background: duration === d ? "rgba(168,85,247,0.2)" : "rgba(255,255,255,0.05)", color: duration === d ? "#d0a0ff" : "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                    >
                      {d}s
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Chat area */}
            <div className="img2vid-chat-area">
              <textarea
                className="img2vid-input"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Describe the motion, camera move, or style…"
                rows={3}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleGenerate(); } }}
              />
            </div>

            {/* Footer */}
            <div className="img2vid-input-row">
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                ~{creditCost} credits · Uses subscription credits
              </div>
              <button
                onClick={() => void handleGenerate()}
                disabled={busy || !prompt.trim()}
                style={{ padding: "8px 18px", borderRadius: 8, background: busy || !prompt.trim() ? "rgba(168,85,247,0.2)" : "linear-gradient(135deg,#7c3aed,#a855f7)", border: "none", color: "#fff", fontSize: 12, fontWeight: 700, cursor: busy || !prompt.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}
              >
                {busy ? <><span className="import-spinner" style={{ width: 12, height: 12 }} /> Generating…</> : "🎬 Generate Video"}
              </button>
            </div>

            {error && (
              <div style={{ padding: "8px 16px", fontSize: 11, color: "#f87171", textAlign: "center" }}>{error}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


