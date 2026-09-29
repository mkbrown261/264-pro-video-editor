/** AI image generation modal (extracted from App.tsx). */
import React, { useEffect, useRef, useState } from "react";
import { toast } from "../lib/toast";

// ── ImageGenModal ─────────────────────────────────────────────────────────────
interface ImageGenModalProps {
  assets: import("../../shared/models").MediaAsset[];
  fsTier: string;
  fsLinked: boolean;
  onClose: () => void;
  onAddToMediaPool: (imageUrl: string, name: string) => void;
}

const IMG_GEN_MODELS = [
  { value: "dall-e-3",         label: "DALL·E 3" },
  { value: "stable-diffusion", label: "Stable Diffusion" },
  { value: "flux",             label: "Flux" },
];
const IMG_GEN_RATIOS = [
  { value: "1:1",  label: "1:1" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "4:3",  label: "4:3" },
];

export function ImageGenModal({ assets, fsTier, fsLinked, onClose, onAddToMediaPool }: ImageGenModalProps) {
  const [sourceMode, setSourceMode] = React.useState<"text" | "media">("text");
  const [prompt, setPrompt] = React.useState("");
  const [refAssetId, setRefAssetId] = React.useState<string | null>(null);
  const [refLocalFile, setRefLocalFile] = React.useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = React.useState("1:1");
  const [model, setModel] = React.useState("dall-e-3");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<Array<{ id: string; url: string; ts: number }>>([]);

  const isSubscribed = fsLinked && fsTier !== "free";

  const refAsset = refAssetId ? assets.find(a => a.id === refAssetId) : null;
  const referenceImageUrl = refLocalFile ?? refAsset?.previewUrl ?? refAsset?.sourcePath ?? undefined;

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  async function handleGenerate() {
    if (busy) return;
    if (!prompt.trim() && !referenceImageUrl) return;
    setBusy(true);
    setError(null);
    try {
      const res = (await (window.flowstateAPI?.apiCall(
        "/api/264pro/generate-image",
        "POST",
        { prompt: prompt.trim() || "(image reference)", referenceImageUrl, aspectRatio, model }
      ) ?? Promise.resolve({ error: "Not in Electron" }))) as { imageUrl?: string; error?: string };
      if (res?.error) throw new Error(res.error);
      const url = res?.imageUrl;
      if (!url) throw new Error("No image returned");
      setResults(prev => [{ id: `gi_${Date.now()}`, url, ts: Date.now() }, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="imggen-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="imggen-modal">
        <div className="img2vid-header">
          <span style={{ fontWeight: 700, fontSize: 14, color: "#e8e8e8" }}>🖼 AI Image Generation</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        {!isSubscribed ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e8e8e8", marginBottom: 8 }}>Pro Feature</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
              AI Image Generation requires a FlowState Pro subscription.
            </div>
            <a
              href="https://flowstate-67g.pages.dev/upgrade?ref=264pro-imggen"
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-block", marginTop: 16, padding: "9px 20px", borderRadius: 9, background: "linear-gradient(135deg,#e07820,#a855f7)", color: "#fff", fontWeight: 700, fontSize: 13, textDecoration: "none" }}
            >
              Upgrade to Pro
            </a>
          </div>
        ) : (
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Source toggle */}
            <div className="imggen-source-toggle">
              <button
                onClick={() => setSourceMode("text")}
                style={{ flex: 1, padding: "7px", borderRadius: "7px 0 0 7px", border: `1px solid ${sourceMode === "text" ? "rgba(168,85,247,0.6)" : "rgba(255,255,255,0.1)"}`, background: sourceMode === "text" ? "rgba(168,85,247,0.2)" : "rgba(255,255,255,0.04)", color: sourceMode === "text" ? "#d0a0ff" : "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                ✍ Text Prompt
              </button>
              <button
                onClick={() => setSourceMode("media")}
                style={{ flex: 1, padding: "7px", borderRadius: "0 7px 7px 0", border: `1px solid ${sourceMode === "media" ? "rgba(168,85,247,0.6)" : "rgba(255,255,255,0.1)"}`, background: sourceMode === "media" ? "rgba(168,85,247,0.2)" : "rgba(255,255,255,0.04)", color: sourceMode === "media" ? "#d0a0ff" : "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                🎬 From Media Pool
              </button>
            </div>

            {/* Text prompt */}
            {sourceMode === "text" && (
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Describe the image you want to generate…"
                rows={4}
                style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "9px 11px", color: "#e8e8e8", fontSize: 12, fontFamily: "inherit", resize: "vertical", outline: "none", lineHeight: 1.5, boxSizing: "border-box" }}
              />
            )}

            {/* Media pool picker */}
            {sourceMode === "media" && (
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, fontWeight: 600 }}>
                  SELECT REFERENCE IMAGE FROM MEDIA POOL
                </div>
                {assets.length === 0 ? (
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "20px 0" }}>No media assets in project yet.</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, maxHeight: 200, overflowY: "auto" }}>
                    {assets.map(a => (
                      <button
                        key={a.id}
                        onClick={() => setRefAssetId(a.id === refAssetId ? null : a.id)}
                        style={{ aspectRatio: "1", borderRadius: 6, border: `2px solid ${refAssetId === a.id ? "#a855f7" : "rgba(255,255,255,0.08)"}`, background: "rgba(255,255,255,0.04)", padding: 2, cursor: "pointer", overflow: "hidden", position: "relative" }}
                      >
                        {(a.thumbnailUrl || a.previewUrl) ? (
                          <img src={a.thumbnailUrl ?? a.previewUrl} alt={a.name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 4 }} />
                        ) : (
                          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontSize: 18 }}>🎬</div>
                        )}
                        {refAssetId === a.id && (
                          <div style={{ position: "absolute", inset: 0, background: "rgba(168,85,247,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>✓</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const url = URL.createObjectURL(file);
                        setRefLocalFile(url);
                        setRefAssetId(null);
                      }
                    }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{ padding: "6px 12px", borderRadius: 6, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.7)", fontSize: 12, cursor: "pointer" }}
                  >
                    📁 Browse File…
                  </button>
                  {refLocalFile && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <img src={refLocalFile} alt="ref" style={{ height: 28, borderRadius: 4, objectFit: "cover" }} />
                      <button onClick={() => setRefLocalFile(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 13 }}>✕</button>
                    </div>
                  )}
                </div>
                {/* Also show a text prompt option */}
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="Optional: describe modifications or style…"
                  rows={2}
                  style={{ marginTop: 10, width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "8px 10px", color: "#e8e8e8", fontSize: 12, fontFamily: "inherit", resize: "none", outline: "none", lineHeight: 1.5, boxSizing: "border-box" }}
                />
              </div>
            )}

            {/* Options row */}
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4, fontWeight: 600 }}>MODEL</div>
                <select
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#e8e8e8", fontSize: 11, padding: "5px 7px" }}
                >
                  {IMG_GEN_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4, fontWeight: 600 }}>RATIO</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {IMG_GEN_RATIOS.map(ar => (
                    <button
                      key={ar.value}
                      onClick={() => setAspectRatio(ar.value)}
                      style={{ padding: "4px 7px", borderRadius: 5, border: `1px solid ${aspectRatio === ar.value ? "rgba(168,85,247,0.6)" : "rgba(255,255,255,0.12)"}`, background: aspectRatio === ar.value ? "rgba(168,85,247,0.2)" : "rgba(255,255,255,0.05)", color: aspectRatio === ar.value ? "#d0a0ff" : "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: 600, cursor: "pointer" }}
                    >
                      {ar.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Generate button */}
            <button
              onClick={() => void handleGenerate()}
              disabled={busy || (!prompt.trim() && !referenceImageUrl)}
              style={{ padding: "10px", borderRadius: 9, background: (busy || (!prompt.trim() && !referenceImageUrl)) ? "rgba(168,85,247,0.2)" : "linear-gradient(135deg,#7c3aed,#a855f7)", border: "none", color: "#fff", fontSize: 13, fontWeight: 700, cursor: (busy || (!prompt.trim() && !referenceImageUrl)) ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              {busy ? <><span className="import-spinner" style={{ width: 12, height: 12 }} /> Generating…</> : "✨ Generate Image"}
            </button>

            {error && <div style={{ fontSize: 11, color: "#f87171", textAlign: "center" }}>{error}</div>}

            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
              Powered by FlowState · Uses subscription tokens
            </div>

            {/* Results */}
            {results.length > 0 && (
              <div className="imggen-results">
                {results.map(img => (
                  <div key={img.id} className="imggen-thumb">
                    <img src={img.url} alt="Generated" style={{ width: "100%", display: "block", borderRadius: "6px 6px 0 0" }} />
                    <div style={{ padding: "6px 8px", background: "rgba(0,0,0,0.4)", borderRadius: "0 0 6px 6px", display: "flex", gap: 4 }}>
                      <button
                        onClick={() => onAddToMediaPool(img.url, `AI_gen_${img.ts}.png`)}
                        style={{ flex: 1, padding: "4px 6px", borderRadius: 5, background: "rgba(168,85,247,0.2)", border: "1px solid rgba(168,85,247,0.4)", color: "#d0a0ff", fontSize: 10, fontWeight: 600, cursor: "pointer" }}
                      >
                        + Media Pool
                      </button>
                      <a
                        href={img.url}
                        download={`ai_image_${img.ts}.png`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ padding: "4px 8px", borderRadius: 5, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center" }}
                      >
                        ⬇
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
