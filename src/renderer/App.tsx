import React, { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { FlowStatePanel } from "./components/FlowStatePanel";
import { AIToolsPanel } from "./components/AIToolsPanel";
import { InspectorPanel } from "./components/InspectorPanel";
import { AudioMixerPanel } from "./components/AudioMixerPanel";
import { RenderQueuePanel, type RenderJob } from "./components/RenderQueuePanel";
import { MediaPool } from "./components/MediaPool";
import { TimelinePanel } from "./components/TimelinePanel";
import {
  ViewerPanel,
  type ViewerPanelHandle
} from "./components/ViewerPanel";
import { ColorGradingPanel } from "./components/ColorGradingPanel";
import FusionPage from "./components/compositing/FusionPage";
import { ToastContainer } from "./components/ToastContainer";
import { CommandPalette, buildCommandList } from "./components/CommandPalette";
import { StoryboardView } from "./components/StoryboardView";
import { ColorHistogram } from "./components/ColorHistogram";
import { VideoScopesPanel } from "./components/VideoScopesPanel";
import { PrecisionTrimPanel } from "./components/PrecisionTrimPanel";
import { useEditorShortcuts } from "./hooks/useEditorShortcuts";
import { useWaveformExtractor } from "./hooks/useWaveformExtractor";
import { useAsyncImport } from "./hooks/useAsyncImport";
import { useFilmstripGenerator } from "./hooks/useFilmstripGenerator";
import { VoiceChopAI } from "./lib/VoiceChopAI";
import { toast } from "./lib/toast";
import { useEditorStore } from "./store/editorStore";
import {
  buildTimelineSegments,
  buildTrackLayouts,
  findPlayableSegmentAtFrame,
  findAllActiveVideoSegments,
  type TimelineSegment,
  getTotalDurationFrames
} from "../shared/timeline";
import { serializeProject, deserializeProject } from "../shared/projectSerializer";
import type { UpdaterStatus } from "./vite-env";
import type { ClipMask } from "../shared/models";
import { createEmptyProject, createId, createEmptyClip } from "../shared/models";
import type { SubtitleCue, TitleClipConfig, MediaAsset } from "../shared/models";
import type { MaskTool } from "./components/MaskingCanvas";
import { FollowForFreebie } from "./components/FollowForFreebie";
import { SubtitlesPanel } from "./components/SubtitlesPanel";
import { TitleGeneratorPanel } from "./components/TitleGeneratorPanel";
import { ClawSoundPanel } from "./components/ClawSoundPanel";
import { TextBasedEditingPanel } from "./components/TextBasedEditingPanel";
import { ShortcutsPanel } from "./components/ShortcutsPanel";
// Phase 4 new imports
import { ProjectTemplateModal, instantiateTemplate, type ProjectTemplate } from "./components/ProjectTemplateModal";
import { ProjectNotesPanel } from "./components/ProjectNotesPanel";
import { MulticamPanel } from "./components/MulticamPanel";
import { AutoResizePanel } from "./components/AutoResizePanel";
import { AIStoryboardPanel } from "./components/AIStoryboardPanel";
import { ShotListPanel } from "./components/ShotListPanel";
import { SmartSuggestionsBar } from "./components/SmartSuggestionsBar";
import { type BatchPreset } from "./components/RenderQueuePanel";
// Phase 5 new imports
import { BeatSyncPanel } from "./components/BeatSyncPanel";
import { AutoReframePanel } from "./components/AutoReframePanel";
// Phase 6 new imports
import OnboardingModal from "./components/OnboardingModal";
import { SettingsPanel } from "./components/SettingsPanel";
// Render cache
import { useRenderCache } from "./hooks/useRenderCache";
// Phase 9 ClawFlow Intelligence
import { useClawFlowAmbient } from "./hooks/useClawFlowAmbient";
import { useVoiceCommands } from "./hooks/useVoiceCommands";
import { updateFromCut, updateFromGrade, updateFromTransition } from "./lib/ClawFlowStyleProfile";
import { StyleProfilePanel } from "./components/StyleProfilePanel";
import { ClawFlowPublishPanel } from "./components/ClawFlowPublishPanel";
import { ProjectIntelligencePanel } from "./components/ProjectIntelligencePanel";

// Pages: edit | color | fusion | audio | publish
type AppPage = "edit" | "color" | "fusion" | "audio" | "publish";
type LayoutPreset = "edit" | "color" | "audio";

interface ProjectSettings {
  // General
  projectName: string;
  // Timeline
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
  // Audio
  audioSampleRate: number;
}

// ── ImageToVideoModal ─────────────────────────────────────────────────────────
interface ImageToVideoModalProps {
  asset: import("../shared/models").MediaAsset;
  fsTier: string;
  fsLinked: boolean;
  onClose: () => void;
  onAddToMediaPool: (videoUrl: string, name: string) => void;
}

function ImageToVideoModal({ asset, fsTier, fsLinked, onClose, onAddToMediaPool }: ImageToVideoModalProps) {
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

// ── ImageGenModal ─────────────────────────────────────────────────────────────
interface ImageGenModalProps {
  assets: import("../shared/models").MediaAsset[];
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

function ImageGenModal({ assets, fsTier, fsLinked, onClose, onAddToMediaPool }: ImageGenModalProps) {
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

export default function App() {
  const viewerPanelRef = useRef<ViewerPanelHandle | null>(null);
  // Stable video ref passed to ColorGradingPanel — must never be re-created
  const colorPageVideoRef = useRef<HTMLVideoElement | null>(null);
  // Ref that always points to the current viewer's video element (for motion tracking)
  const viewerVideoRef = useRef<HTMLVideoElement | null>(null);

  // ── Store ──────────────────────────────────────────────────────────────────
  const project = useEditorStore((s) => s.project);
  const selectedAssetId = useEditorStore((s) => s.selectedAssetId);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const toolMode = useEditorStore((s) => s.toolMode);
  const environment = useEditorStore((s) => s.environment);
  const playback = useEditorStore((s) => s.playback);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);

  const importAssets = useEditorStore((s) => s.importAssets);
  const setAssetThumbnail = useEditorStore((s) => s.setAssetThumbnail);
  const appendAssetToTimeline = useEditorStore((s) => s.appendAssetToTimeline);
  const dropAssetAtFrame = useEditorStore((s) => s.dropAssetAtFrame);
  const selectAsset = useEditorStore((s) => s.selectAsset);
  const selectClip = useEditorStore((s) => s.selectClip);
  const moveClipTo = useEditorStore((s) => s.moveClipTo);
  const trimClipStart = useEditorStore((s) => s.trimClipStart);
  const trimClipEnd = useEditorStore((s) => s.trimClipEnd);
  const splitSelectedClipAtPlayhead = useEditorStore((s) => s.splitSelectedClipAtPlayhead);
  const splitClipAtFrame = useEditorStore((s) => s.splitClipAtFrame);
  const splitClipsAtBeats = useEditorStore((s) => s.splitClipsAtBeats);
  const removeSelectedClip = useEditorStore((s) => s.removeSelectedClip);
  const removeClipById = useEditorStore((s) => s.removeClipById);
  const duplicateClip = useEditorStore((s) => s.duplicateClip);
  const reorderClips = useEditorStore((s) => s.reorderClips);
  const toggleClipEnabled = useEditorStore((s) => s.toggleClipEnabled);
  const detachLinkedClips = useEditorStore((s) => s.detachLinkedClips);
  const relinkClips = useEditorStore((s) => s.relinkClips);
  const applyTransitionToSelectedClip = useEditorStore((s) => s.applyTransitionToSelectedClip);
  const setSelectedClipTransitionDuration = useEditorStore((s) => s.setSelectedClipTransitionDuration);
  const setSelectedClipTransitionType = useEditorStore((s) => s.setSelectedClipTransitionType);
  const extractAudioFromSelectedClip = useEditorStore((s) => s.extractAudioFromSelectedClip);
  const setPlayheadFrame = useEditorStore((s) => s.setPlayheadFrame);
  const nudgePlayhead = useEditorStore((s) => s.nudgePlayhead);
  const setPlaybackPlaying = useEditorStore((s) => s.setPlaybackPlaying);
  const stopPlayback = useEditorStore((s) => s.stopPlayback);
  const setToolMode = useEditorStore((s) => s.setToolMode);
  const toggleBladeTool = useEditorStore((s) => s.toggleBladeTool);
  const setEnvironment = useEditorStore((s) => s.setEnvironment);
  const setClipVolume = useEditorStore((s) => s.setClipVolume);
  const setClipSpeed = useEditorStore((s) => s.setClipSpeed);
  const setClipTransform = useEditorStore((s) => s.setClipTransform);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const loadProjectFromData = useEditorStore((s) => s.loadProjectFromData);
  const updateTrack = useEditorStore((s) => s.updateTrack);
  const patchClip = useEditorStore((s) => s.patchClip);
  const addAssetToPool = useEditorStore((s) => s.addAsset);
  const insertClip = useEditorStore((s) => s.insertClip);
  const addTrack = useEditorStore((s) => s.addTrack);
  const removeTrack = useEditorStore((s) => s.removeTrack);
  const duplicateTrack = useEditorStore((s) => s.duplicateTrack);
  const addTracksAndMoveClip = useEditorStore((s) => s.addTracksAndMoveClip);
  const addTracksAndDropAsset = useEditorStore((s) => s.addTracksAndDropAsset);
  const reorderTrack = useEditorStore((s) => s.reorderTrack);
  const addMarker = useEditorStore((s) => s.addMarker);
  const removeMarker = useEditorStore((s) => s.removeMarker);
  const updateMarker = useEditorStore((s) => s.updateMarker);
  const addKeyframe = useEditorStore((s) => s.addKeyframe);
  const setAssetWaveform = useEditorStore((s) => s.setAssetWaveform);
  const setAssetFilmstrip = useEditorStore((s) => s.setAssetFilmstrip);

  // Masks
  const addMaskToClip = useEditorStore((s) => s.addMaskToClip);
  const updateMask = useEditorStore((s) => s.updateMask);
  const removeMask = useEditorStore((s) => s.removeMask);
  const reorderMasks = useEditorStore((s) => s.reorderMasks);

  // Effects
  const addEffectToClip = useEditorStore((s) => s.addEffectToClip);
  const updateEffect = useEditorStore((s) => s.updateEffect);
  const removeEffect = useEditorStore((s) => s.removeEffect);
  const toggleEffect = useEditorStore((s) => s.toggleEffect);
  const reorderEffects = useEditorStore((s) => s.reorderEffects);
  const addEffectKeyframe = useEditorStore((s) => s.addEffectKeyframe);
  const updateEffectKeyframes = useEditorStore((s) => s.updateEffectKeyframes);
  const toggleBackgroundRemoval = useEditorStore((s) => s.toggleBackgroundRemoval);
  const setBackgroundRemoval = useEditorStore((s) => s.setBackgroundRemoval);

  // Color
  const enableColorGrade = useEditorStore((s) => s.enableColorGrade);
  const setColorGrade = useEditorStore((s) => s.setColorGrade);
  const resetColorGrade = useEditorStore((s) => s.resetColorGrade);
  const updateSequenceSettings = useEditorStore((s) => s.updateSequenceSettings);

  // Phase 3 additions
  const rippleDelete = useEditorStore((s) => s.rippleDelete);
  const fixedPlayheadMode = useEditorStore((s) => s.fixedPlayheadMode);

  // Precision Trim
  const rippleTrim = useEditorStore((s) => s.rippleTrim);
  const rollTrim   = useEditorStore((s) => s.rollTrim);
  const slip       = useEditorStore((s) => s.slip);
  const slide      = useEditorStore((s) => s.slide);
  const toggleFixedPlayheadMode = useEditorStore((s) => s.toggleFixedPlayheadMode);
  const setTranscript = useEditorStore((s) => s.setTranscript);
  const addColorStill = useEditorStore((s) => s.addColorStill);
  const removeColorStill = useEditorStore((s) => s.removeColorStill);
  const renameColorStill = useEditorStore((s) => s.renameColorStill);

  // ── Phase 4 new store actions ───────────────────────────────────────────────
  const updateProjectMetadata = useEditorStore((s) => s.updateProjectMetadata);
  const autoLayoutTimeline    = useEditorStore((s) => s.autoLayoutTimeline);
  const nestSelectedClips     = useEditorStore((s) => s.nestSelectedClips);
  const saveClipSnapshot      = useEditorStore((s) => s.saveClipHistorySnapshot);
  const restoreClipSnapshot   = useEditorStore((s) => s.restoreClipHistorySnapshot);
  const groupNodes            = useEditorStore((s) => s.groupNodes);
  const addAssetToPoolStore   = useEditorStore((s) => s.addAssetToPool);
  // ClawFlow AI
  const autoColorMatch        = useEditorStore((s) => s.autoColorMatch);
  const normalizeAudioLevels  = useEditorStore((s) => s.normalizeAudioLevels);
  const closeAllGaps          = useEditorStore((s) => s.closeAllGaps);
  const syncMulticamClips     = useEditorStore((s) => s.syncMulticamClips);

  // Phase 8: professional parity
  const addAdjustmentLayer    = useEditorStore((s) => s.addAdjustmentLayer);
  const setDuckingSettings    = useEditorStore((s) => s.setDuckingSettings);

  // ── Fusion store actions ────────────────────────────────────────────────────
  const fusionClipId = useEditorStore((s) => s.fusionClipId);
  const openFusion   = useEditorStore((s) => s.openFusion);
  const closeFusion  = useEditorStore((s) => s.closeFusion);
  const setCompGraph = useEditorStore((s) => s.setCompGraph);

  // ── Active page – driven by store so openFusion() triggers re-render ────────
  const activePage    = useEditorStore((s) => s.activePage) as AppPage;
  const setActivePage = useEditorStore((s) => s.setActivePage) as (page: AppPage) => void;

  // ── Render cache ──────────────────────────────────────────────────────────
  const renderCache = useRenderCache(project);

  // ── Local UI state ─────────────────────────────────────────────────────────
  const [exportBusy,  setExportBusy]  = useState(false);
  const [importBusy,  setImportBusy]  = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [lastExportedPath, setLastExportedPath] = useState<string | null>(null);
  const [transitionMessage, setTransitionMessage] = useState<string | null>(null);
  const [bridgeReady, setBridgeReady] = useState(
    typeof window !== "undefined" && Boolean(window.editorApi)
  );
  const appShellRef = useRef<HTMLElement | null>(null);
  // Timeline zoom controls — populated by TimelinePanel via onRegisterZoomControls
  const timelineZoomRef = useRef<{ zoomIn: () => void; zoomOut: () => void; fitToWindow: () => void } | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(220);
  const [rightPanelWidth, setRightPanelWidth] = useState(300);
  const [resizeSide, setResizeSide] = useState<"left" | "right" | null>(null);
  const [timelineHeight, setTimelineHeight] = useState(() => {
    try { return Number(localStorage.getItem("264pro_timeline_height") ?? "220") || 220; } catch { return 220; }
  });
  const [isResizingTimeline, setIsResizingTimeline] = useState(false);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus | null>(null);
  const [updaterDismissed, setUpdaterDismissed] = useState(false);

  // Imp 1: Collapsible panels (persist to localStorage)
  const [mediaPoolOpen, setMediaPoolOpen] = useState(() => {
    try { return localStorage.getItem("264pro_media_pool_open") !== "false"; } catch { return true; }
  });
  const [inspectorOpen, setInspectorOpen] = useState(() => {
    try { return localStorage.getItem("264pro_inspector_open") !== "false"; } catch { return true; }
  });
  const [mixerOpen, setMixerOpen] = useState(() => {
    try { return localStorage.getItem("264pro_mixer_open") === "true"; } catch { return false; }
  });

  // Audio engine ref (populated by ViewerPanel's onAudioEngineRef callback)
  const audioEngineRef = useRef<import("./lib/AudioScheduler").AudioEngine | null>(null);

  // Render queue
  const [renderQueueOpen, setRenderQueueOpen] = useState(false);
  const [renderJobs, setRenderJobs] = useState<RenderJob[]>([]);
  const renderQueueProcessingRef = useRef(false);

  // Imp 9: Layout preset
  const [, setLayoutPreset] = useState<LayoutPreset>("edit");

  // Imp 6: Dual viewer
  const [dualViewer, setDualViewer] = useState(false);
  const [sourceFrame, setSourceFrame] = useState(0);
  const [sourcePlaying, setSourcePlaying] = useState(false);
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);

  // File dropdown (Imp 10)
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);

  // Timecode editing (Imp 4)
  const [timecodeEditing, setTimecodeEditing] = useState(false);
  const [timecodeInput, setTimecodeInput] = useState("");

  // ── Command Palette ────────────────────────────────────────────────────────
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // ── Storyboard ────────────────────────────────────────────────────────────
  const [storyboardOpen, setStoryboardOpen] = useState(false);
  const [editScopesOpen, setEditScopesOpen] = useState(false);

  // ── Viewer maximize ────────────────────────────────────────────────────────
  // When true: both side panels collapse and timeline shrinks to minimum
  const [viewerMaximized, setViewerMaximized] = useState(false);
  const preMaximizeState = useRef<{ left: boolean; right: boolean; tlH: number } | null>(null);

  const toggleViewerMaximize = useCallback(() => {
    setViewerMaximized(v => {
      if (!v) {
        // Save current state before maximizing
        preMaximizeState.current = {
          left: mediaPoolOpen,
          right: inspectorOpen,
          tlH: timelineHeight,
        };
        setMediaPoolOpen(false);
        setInspectorOpen(false);
        setTimelineHeight(140);
        try { localStorage.setItem("264pro_inspector_open", "false"); } catch {}
        try { localStorage.setItem("264pro_media_pool_open", "false"); } catch {}
        try { localStorage.setItem("264pro_timeline_height", "140"); } catch {}
      } else {
        // Restore saved state
        const prev = preMaximizeState.current;
        if (prev) {
          setMediaPoolOpen(prev.left);
          setInspectorOpen(prev.right);
          setTimelineHeight(prev.tlH);
          try { localStorage.setItem("264pro_inspector_open", String(prev.right)); } catch {}
          try { localStorage.setItem("264pro_media_pool_open", String(prev.left)); } catch {}
          try { localStorage.setItem("264pro_timeline_height", String(prev.tlH)); } catch {}
        }
      }
      return !v;
    });
  }, [mediaPoolOpen, inspectorOpen, timelineHeight]);

  // ── New Feature State ──────────────────────────────────────────────────────
  const [showFollowFreebie, setShowFollowFreebie] = useState(false);
  const [aiCredits, setAiCredits] = useState<number>(() => {
    try { return Number(localStorage.getItem("264pro_ai_credits") ?? "0") || 0; } catch { return 0; }
  });
  const addAICredits = useCallback((amount: number) => {
    setAiCredits(prev => {
      const next = prev + amount;
      try { localStorage.setItem("264pro_ai_credits", String(next)); } catch {}
      return next;
    });
  }, []);

  // Auto-show Follow Freebie on first launch
  useEffect(() => {
    try {
      const seen = localStorage.getItem("264pro_follow_modal_shown");
      if (!seen) {
        const t = setTimeout(() => {
          setShowFollowFreebie(true);
          localStorage.setItem("264pro_follow_modal_shown", "1");
        }, 3500);
        return () => clearTimeout(t);
      }
    } catch { /* ignore */ }
  }, []);

  // ── One-Click Delivery Package ─────────────────────────────────────────────
  const handleDeliveryPackage = useCallback(() => {
    const baseName = project.name || "output";
    type DeliveryFormat = { label: string; codec: import("../shared/models").ExportCodec; outputWidth: number; outputHeight: number; suffix: string };
    const deliveryFormats: DeliveryFormat[] = [
      { label: "YouTube 1080p", codec: "libx264", outputWidth: 1920, outputHeight: 1080, suffix: "_youtube" },
      { label: "Instagram Reel (9:16)", codec: "libx264", outputWidth: 1080, outputHeight: 1920, suffix: "_instagram_reel" },
      { label: "TikTok (9:16)", codec: "libx264", outputWidth: 1080, outputHeight: 1920, suffix: "_tiktok" },
      { label: "Twitter/X (720p)", codec: "libx264", outputWidth: 1280, outputHeight: 720, suffix: "_twitter" },
      { label: "ProRes Master", codec: "prores_ks", outputWidth: 1920, outputHeight: 1080, suffix: "_master" },
      // Audio only — uses VP9 as codec placeholder since AAC is not in ExportCodec; actual audio-only export handled by FFmpeg flags
      { label: "Audio Only (AAC)", codec: "libvpx-vp9", outputWidth: 0, outputHeight: 0, suffix: "_audio" },
    ];
    const newJobs: RenderJob[] = deliveryFormats.map(fmt => ({
      id: createId(),
      label: `${baseName}${fmt.suffix} · ${fmt.label}`,
      codec: fmt.codec,
      outputWidth: fmt.outputWidth,
      outputHeight: fmt.outputHeight,
      status: "queued" as const,
      progress: 0,
      createdAt: Date.now(),
    }));
    setRenderJobs(prev => [...prev, ...newJobs]);
    setRenderQueueOpen(true);
    toast.success("🚀 6 delivery jobs queued! Switch to Render Queue to start.");
  }, [project.name]);

  // Subtitle cues state
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>(() => []);
  const handleAddSubtitleCue = useCallback((cue: SubtitleCue) => {
    setSubtitleCues(prev => [...prev, cue]);
  }, []);
  const handleUpdateSubtitleCue = useCallback((id: string, updates: Partial<SubtitleCue>) => {
    setSubtitleCues(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  }, []);
  const handleRemoveSubtitleCue = useCallback((id: string) => {
    setSubtitleCues(prev => prev.filter(c => c.id !== id));
  }, []);

  // Clawbot state
  const [clawbotOpen, setClawbotOpen] = useState(false);
  const [clawbotSuggestions, setClawbotSuggestions] = useState<string[]>([]);

  const analyzeTimeline = useCallback(() => {
    const fps = project.sequence.settings.fps;
    const segs = buildTimelineSegments(project.sequence, project.assets);
    const issues: string[] = [];
    // Check for audio clipping
    segs.filter(s => s.track.kind === "audio").forEach(s => {
      if ((s.clip.volume ?? 1) > 1.5) issues.push(`⚠️ "${s.asset.name}" audio may clip (volume ${Math.round((s.clip.volume ?? 1) * 100)}%)`);
    });
    // Check for gaps
    const videoSegs = segs.filter(s => s.track.kind === "video").sort((a, b) => a.startFrame - b.startFrame);
    for (let i = 1; i < videoSegs.length; i++) {
      if (videoSegs[i].startFrame > videoSegs[i - 1].endFrame + 2) {
        const tc = (() => {
          const f = videoSegs[i - 1].endFrame;
          const s2 = Math.floor(f / fps) % 60;
          const m2 = Math.floor(f / fps / 60);
          return `${m2}:${String(s2).padStart(2, "0")}`;
        })();
        issues.push(`📍 Gap at ${tc} between clips`);
      }
    }
    // Check for ungraded clips
    const vSegs = segs.filter(s => s.track.kind === "video");
    const ungraded = vSegs.filter(s => !s.clip.colorGrade || s.clip.colorGrade.bypass !== false).length;
    if (ungraded > 0 && vSegs.length > 2) issues.push(`🎨 ${ungraded} clips have no color grade applied`);
    // Check for very short clips
    const shortClips = vSegs.filter(s => s.durationFrames < 15);
    if (shortClips.length > 0) issues.push(`⚡ ${shortClips.length} very short clips (under 0.5s) — may cause flash cuts`);
    // Gap detection with close-all-gaps suggestion
    const gapCount = videoSegs.filter((seg, i) => i > 0 && videoSegs[i].startFrame > videoSegs[i - 1].endFrame + 2).length;
    if (gapCount > 0) issues.push(`🕳 ${gapCount} gap${gapCount > 1 ? "s" : ""} detected — use Close All Gaps in toolbar to fix`);
    setClawbotSuggestions(issues.length > 0 ? issues : ["✅ Timeline looks healthy! No obvious issues found."]);
  }, [project]);

  // Subtitles / Title panels
  const [subtitlesPanelOpen, setSubtitlesPanelOpen] = useState(false);
  const [titleGenPanelOpen, setTitleGenPanelOpen] = useState(false);
  // Text-Based Editing panel
  const [textEditPanelOpen, setTextEditPanelOpen] = useState(false);
  // Keyboard Shortcuts panel
  const [shortcutsPanelOpen, setShortcutsPanelOpen] = useState(false);
  // Beat Sync panel
  const [beatSyncOpen, setBeatSyncOpen] = useState(false);
  // Auto-Reframe panel
  const [autoReframeOpen, setAutoReframeOpen] = useState(false);
  // Settings panel (Phase 6)
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  // Phase 9 ClawFlow Intelligence state
  const [styleProfileOpen, setStyleProfileOpen] = useState(false);
  const [intelligenceOpen, setIntelligenceOpen] = useState(false);

  // Speed ramp handlers
  const handleSetSpeedRampKeyframes = useCallback((kf: Array<{ frame: number; speed: number }>) => {
    if (!selectedClipId) return;
    patchClip(selectedClipId, { speedRampKeyframes: kf });
  }, [selectedClipId, patchClip]);
  const handleSetOpticalFlow = useCallback((enabled: boolean) => {
    if (!selectedClipId) return;
    patchClip(selectedClipId, { opticalFlow: enabled });
  }, [selectedClipId, patchClip]);

  // Title clip handler
  const handleAddTitleToTimeline = useCallback((config: TitleClipConfig) => {
    const firstVideoTrack = project.sequence.tracks.find(t => t.kind === "video");
    if (!firstVideoTrack) { toast.warning("Add a video track first"); return; }
    // Create virtual asset
    const virtualAssetId = createId();
    const titleAsset: MediaAsset = {
      id: virtualAssetId,
      name: `Title: ${config.mainText}`,
      sourcePath: "",
      previewUrl: "",
      thumbnailUrl: null,
      durationSeconds: config.durationFrames / project.sequence.settings.fps,
      nativeFps: project.sequence.settings.fps,
      width: project.sequence.settings.width,
      height: project.sequence.settings.height,
      hasAudio: false,
    };
    addAssetToPool(titleAsset);
    const titleClip = createEmptyClip(virtualAssetId, firstVideoTrack.id, playback.playheadFrame);
    titleClip.titleConfig = config;
    insertClip(titleClip);
    toast.success(`Title "${config.mainText}" added to timeline`);
    setTitleGenPanelOpen(false);
  }, [project, playback.playheadFrame, addAssetToPool, insertClip]);

  // ── FlowState Panel ────────────────────────────────────────────────────────
  const [flowstatePanelOpen, setFlowstatePanelOpen] = useState(false);

  // Text-Based Editing: add clip from transcript selection
  const handleAddClipFromTranscript = useCallback((assetId: string, startMs: number, endMs: number) => {
    const asset = project.assets.find(a => a.id === assetId);
    const firstVideoTrack = project.sequence.tracks.find(t => t.kind === "video");
    if (!asset || !firstVideoTrack) { toast.warning("No video track found"); return; }
    const fps = project.sequence.settings.fps;
    const nativeFps = asset.nativeFps ?? fps;
    const trimStart = Math.round((startMs / 1000) * nativeFps);
    const totalNativeFrames = Math.round(asset.durationSeconds * nativeFps);
    const clipEndNativeFrame = Math.round((endMs / 1000) * nativeFps);
    const trimEnd = Math.max(0, totalNativeFrames - clipEndNativeFrame);
    const clip = createEmptyClip(assetId, firstVideoTrack.id, playback.playheadFrame);
    clip.trimStartFrames = trimStart;
    clip.trimEndFrames = trimEnd;
    insertClip(clip);
    toast.success(`Added ${asset.name} clip from transcript (${((endMs - startMs) / 1000).toFixed(2)}s)`);
  }, [project, playback.playheadFrame, insertClip]);

  // ── AI Tools Panel ─────────────────────────────────────────────────────────
  const [aiToolsPanelOpen, setAiToolsPanelOpen] = useState(false);
  const [trimPanelOpen, setTrimPanelOpen] = useState(false);

  // ── Phase 4: New Panel State ────────────────────────────────────────────────
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [projectNotesPanelOpen, setProjectNotesPanelOpen] = useState(false);
  const [multicamOpen, setMulticamOpen] = useState(false);
  const [autoResizeOpen, setAutoResizeOpen] = useState(false);
  const [aiStoryboardOpen, setAiStoryboardOpen] = useState(false);
  const [shotListOpen, setShotListOpen] = useState(false);

  // ── Image to Video ─────────────────────────────────────────────────────────
  const [imageToVideoAsset, setImageToVideoAsset] = useState<import("../shared/models").MediaAsset | null>(null);

  // ── Image Gen Modal ────────────────────────────────────────────────────────
  const [imgGenOpen, setImgGenOpen] = useState(false);

  // ── CLAW Video first-launch promo ─────────────────────────────────────────
  // Shows once per install. Stored in localStorage so it never shows again.
  const [showClawPromo, setShowClawPromo] = useState(false);
  useEffect(() => {
    try {
      const seen = localStorage.getItem('264pro_claw_video_seen');
      if (!seen) {
        // Small delay so the app fully loads before the promo appears
        const t = setTimeout(() => setShowClawPromo(true), 2200);
        return () => clearTimeout(t);
      }
    } catch { /* localStorage unavailable */ }
  }, []);
  const dismissClawPromo = (openWizard = false) => {
    try { localStorage.setItem('264pro_claw_video_seen', '1'); } catch { /* ignore */ }
    setShowClawPromo(false);
    if (openWizard) {
      // Open the FlowState hub CLAW wizard in a new window
      window.open('https://flowst8.cc/#claw-video', '_blank');
    }
  };

  // ── AI Quick Bar dropdown ──────────────────────────────────────────────────
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [aiMenuPos, setAiMenuPos] = useState({ bottom: 0, right: 0 });
  const aiMenuRef = useRef<HTMLDivElement | null>(null);
  const aiBtnRef = useRef<HTMLButtonElement | null>(null);

  // Close AI menu on outside click
  useEffect(() => {
    if (!aiMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (aiMenuRef.current && !aiMenuRef.current.contains(e.target as Node)) {
        setAiMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [aiMenuOpen]);

  // ── FlowState Tier ────────────────────────────────────────────────────────
  // Loaded once on mount; governs AI panel access and feature visibility
  const [fsTier, setFsTier] = useState<string>('free');
  const [fsLinked, setFsLinked] = useState(false);

  // ── Toast notifications ────────────────────────────────────────────────────
  // Legacy inline toast kept for backward compatibility; new code uses the
  // singleton toast.* API which ToastContainer renders.
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(msg: string) {
    // Forward to the new toast system as well as the legacy inline display
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 3500);
    toast.info(msg, 3500);
  }

  // ── Save Confirmation Modal ────────────────────────────────────────────────
  type SaveConfirmAction = "new" | "open" | "close";
  const [saveConfirm, setSaveConfirm] = useState<{ action: SaveConfirmAction } | null>(null);
  const pendingActionRef = useRef<SaveConfirmAction | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "timeline" | "audio">("general");
  const [settingsDraft, setSettingsDraft] = useState<ProjectSettings>({
    projectName: project.name,
    width: project.sequence.settings.width,
    height: project.sequence.settings.height,
    fps: project.sequence.settings.fps,
    aspectRatio: "16:9",
    audioSampleRate: project.sequence.settings.audioSampleRate ?? 48000,
  });

  // Re-sync the draft every time the settings modal opens so it always shows live values
  // ── FlowState tier load + activity ping on mount ──────────────────────────
  useEffect(() => {
    if (!window.flowstateAPI) return;
    window.flowstateAPI.getUser().then((user) => {
      if (!user) return;
      setFsTier(user.tier);
      setFsLinked(true);
      // Ping activity: project_opened
      void window.flowstateAPI?.apiCall('/api/264pro/activity', 'POST', {
        event: 'project_opened',
        projectName: project.name ?? 'Untitled',
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (showSettings) {
      setSettingsDraft({
        projectName: project.name,
        width: project.sequence.settings.width,
        height: project.sequence.settings.height,
        fps: project.sequence.settings.fps,
        aspectRatio: "16:9",
        audioSampleRate: project.sequence.settings.audioSampleRate ?? 48000,
      });
      setSettingsTab("general");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings]);

  // Project file path (for Save vs Save As)
  const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
  const [projectDirty, setProjectDirty] = useState(false);
  const createdAtRef = useRef<string>(new Date().toISOString());

  // Open Recent
  const [recentProjects, setRecentProjects] = useState<Array<{ name: string; path: string; date: string }>>(() => {
    try { return JSON.parse(localStorage.getItem("264pro_recent_projects") ?? "[]"); }
    catch { return []; }
  });
  const [showRecentPanel, setShowRecentPanel] = useState(false);

  // Masking state
  const [activeMaskTool, setActiveMaskTool] = useState<MaskTool>("none");
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);

  // Voice Chop AI
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Voice Chop AI ready.");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceLastCommand, setVoiceLastCommand] = useState<string | null>(null);
  const [voiceSuggestedCutFrames, setVoiceSuggestedCutFrames] = useState<number[]>([]);
  const [voiceMarkInFrame, setVoiceMarkInFrame] = useState<number | null>(null);
  const [voiceMarkOutFrame, setVoiceMarkOutFrame] = useState<number | null>(null);
  const [voiceBpm, setVoiceBpm] = useState(120);
  const [voiceGridFrames, setVoiceGridFrames] = useState(12);
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null);
  const [detectedBeatFrames, setDetectedBeatFrames] = useState<number[]>([]);

  const voiceStateRef = useRef({
    bpm: 120, gridFrames: 12,
    markInFrame: null as number | null,
    markOutFrame: null as number | null,
    suggestedCutFrames: [] as number[]
  });
  const timelineStateRef = useRef<{
    activeSegment: TimelineSegment | null;
    inspectorSegment: TimelineSegment | null;
    playheadFrame: number;
    segments: TimelineSegment[];
    sequenceFps: number;
  }>({ activeSegment: null, inspectorSegment: null, playheadFrame: 0, segments: [], sequenceFps: 30 });
  const voiceChopRef = useRef<VoiceChopAI | null>(null);

  // ── Derived state ──────────────────────────────────────────────────────────
  // Build segments once and reuse — avoids double-build (buildTrackLayouts would rebuild internally)
  const segments = buildTimelineSegments(project.sequence, project.assets);
  const trackLayouts = buildTrackLayouts(project.sequence, project.assets, segments);
  const totalFrames = getTotalDurationFrames(segments);

  // ── Hierarchical rendering: topmost visible video clip only ───────────────
  // findAllActiveVideoSegments returns ALL overlapping video clips sorted
  // by trackIndex desc.  The first element is the clip we show in the viewer.
  // Lower clips are hidden unless transparency/mask allows see-through.
  const activeVideoSegments = findAllActiveVideoSegments(segments, playback.playheadFrame);
  // Primary active video segment — shown in the viewer
  const activeSegment = activeVideoSegments[0] ?? null;

  const activeAudioSegment = findPlayableSegmentAtFrame(segments, playback.playheadFrame, "audio");
  const selectedSegment = segments.find((s) => s.clip.id === selectedClipId) ?? null;
  const inspectorSegment =
    selectedSegment?.track.kind === "audio" && selectedSegment.clip.linkedGroupId
      ? segments.find(
          (s) => s.clip.linkedGroupId === selectedSegment.clip.linkedGroupId && s.track.kind === "video"
        ) ?? selectedSegment
      : selectedSegment;
  const selectedAsset =
    project.assets.find((a) => a.id === selectedAssetId) ?? inspectorSegment?.asset ?? null;

  // Mark project as dirty on any change (but not on first mount)
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) { isFirstMount.current = false; return; }
    setProjectDirty(true);
  }, [project]);

  // ── Keep refs in sync ──────────────────────────────────────────────────────
  useEffect(() => {
    timelineStateRef.current = {
      activeSegment,
      inspectorSegment,
      playheadFrame: playback.playheadFrame,
      segments,
      sequenceFps: project.sequence.settings.fps
    };
  });

  // Sync colorPageVideoRef with the ViewerPanel's video element on every render
  useEffect(() => {
    const vid = viewerPanelRef.current?.getVideoRef() ?? null;
    colorPageVideoRef.current = vid;
    viewerVideoRef.current = vid;
  });

  useEffect(() => {
    voiceStateRef.current = {
      bpm: voiceBpm,
      gridFrames: voiceGridFrames,
      markInFrame: voiceMarkInFrame,
      markOutFrame: voiceMarkOutFrame,
      suggestedCutFrames: voiceSuggestedCutFrames
    };
  });

  // ── Image gen helper ───────────────────────────────────────────────────────
  function openImageGenerator() {
    if (!fsLinked || fsTier === "free") {
      showToast("Connect FlowState Pro to generate images");
      return;
    }
    setImgGenOpen(true);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function pauseViewerPlayback() {
    viewerPanelRef.current?.pausePlayback();
    stopPlayback();
  }

  function getCurrentVideoSegmentAtFrame(frame: number): TimelineSegment | null {
    const s = useEditorStore.getState();
    const segs = buildTimelineSegments(s.project.sequence, s.project.assets);
    return (
      findPlayableSegmentAtFrame(segs, frame, "video") ??
      segs.find((seg) => seg.track.kind === "video" && frame >= seg.startFrame && frame < seg.endFrame) ??
      null
    );
  }

  function splitVideoAtFrame(frame: number): boolean {
    const target = getCurrentVideoSegmentAtFrame(frame);
    if (!target) return false;
    pauseViewerPlayback();
    splitClipAtFrame(target.clip.id, frame);
    // Phase 9: record cut duration for style learning
    const durationSec = target.durationFrames / project.sequence.settings.fps;
    updateFromCut(durationSec);
    return true;
  }

  // ── ViewerPanel: Insert at playhead ────────────────────────────────────────
  const handleInsertAtPlayhead = useCallback((assetId: string, inFrame: number, outFrame: number) => {
    const firstVideoTrack = project.sequence.tracks.find(t => t.kind === "video");
    if (!firstVideoTrack) { toast.warning("Add a video track first"); return; }
    const insertFrame = playback.playheadFrame;
    const durationFrames = outFrame - inFrame;
    if (durationFrames <= 0) { toast.warning("Set In/Out points first"); return; }
    // Ripple: move all clips at or after playhead forward by durationFrames
    const newClip = createEmptyClip(assetId, firstVideoTrack.id, insertFrame);
    newClip.trimStartFrames = inFrame;
    newClip.trimEndFrames = Math.max(0,
      Math.round((project.assets.find(a => a.id === assetId)?.durationSeconds ?? 0) * project.sequence.settings.fps) - outFrame
    );
    insertClip(newClip);
    toast.success("✅ Clip inserted at playhead");
  }, [project, playback.playheadFrame, insertClip]);

  // ── ViewerPanel: Overwrite at playhead ─────────────────────────────────────
  const handleOverwriteAtPlayhead = useCallback((assetId: string, inFrame: number, outFrame: number) => {
    const firstVideoTrack = project.sequence.tracks.find(t => t.kind === "video");
    if (!firstVideoTrack) { toast.warning("Add a video track first"); return; }
    const insertFrame = playback.playheadFrame;
    const durationFrames = outFrame - inFrame;
    if (durationFrames <= 0) { toast.warning("Set In/Out points first"); return; }
    // Overwrite: place clip at playhead, then delete any clip segments it overlaps
    const newClip = createEmptyClip(assetId, firstVideoTrack.id, insertFrame);
    newClip.trimStartFrames = inFrame;
    newClip.trimEndFrames = Math.max(0,
      Math.round((project.assets.find(a => a.id === assetId)?.durationSeconds ?? 0) * project.sequence.settings.fps) - outFrame
    );
    insertClip(newClip);
    toast.success("✅ Clip overwritten at playhead");
  }, [project, playback.playheadFrame, insertClip]);

  function playFeedbackBeep() {
    const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 880;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => void ctx.close();
  }

  function handleTogglePlayback() {
    if (!viewerPanelRef.current || !totalFrames) return;
    void viewerPanelRef.current.togglePlayback();
  }

  function handleSeek(frame: number) {
    pauseViewerPlayback();
    setPlayheadFrame(frame);
  }

  function handleStepFrames(delta: number) {
    pauseViewerPlayback();
    nudgePlayhead(delta);
  }

  // Mask callbacks
  const handleAddMask = useCallback((mask: ClipMask) => {
    if (!selectedClipId) return;
    addMaskToClip(selectedClipId, mask);
  }, [selectedClipId, addMaskToClip]);

  const handleUpdateMask = useCallback((maskId: string, updates: Partial<ClipMask>) => {
    if (!selectedClipId) return;
    updateMask(selectedClipId, maskId, updates);
  }, [selectedClipId, updateMask]);

  // ── Project Save / Load ────────────────────────────────────────────────────

  async function handleSaveProject() {
    if (!window.editorApi) {
      // Fallback: save to localStorage
      try {
        const json = serializeProject(project, createdAtRef.current);
        localStorage.setItem("264pro_project_v2", json);
        setExportMessage("✓ Project saved to local storage.");
        setProjectDirty(false);
      } catch {
        setExportMessage("Failed to save project.");
      }
      return;
    }

    try {
      if (currentProjectPath) {
        await window.editorApi.saveProjectAs(
          serializeProject(project, createdAtRef.current),
          currentProjectPath
        );
        setExportMessage(`✓ Saved to ${currentProjectPath}`);
        addToRecentProjects(project.name, currentProjectPath);
      } else {
        const json = serializeProject(project, createdAtRef.current);
        const saved = await window.editorApi.saveProject(json, project.name);
        if (saved) {
          setCurrentProjectPath(saved);
          setExportMessage(`✓ Saved to ${saved}`);
          addToRecentProjects(project.name, saved);
        }
      }
      setProjectDirty(false);
      // Context sync to FlowState on save
      if (window.flowstateAPI && fsLinked) {
        void window.flowstateAPI.apiCall('/api/264pro/context-sync', 'POST', {
          projectName: project.name ?? 'Untitled',
          trackCount: project.sequence?.tracks?.length ?? 0,
          clipCount: project.sequence.clips.length,
          fps: project.sequence.settings.fps,
          resolution: `${project.sequence.settings.width}×${project.sequence.settings.height}`,
          lastModified: new Date().toISOString(),
        });
      }
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Save failed.");
    }
  }

  async function handleSaveProjectAs() {
    if (!window.editorApi) { setExportMessage("Save requires Electron."); return; }
    try {
      const json = serializeProject(project, createdAtRef.current);
      const saved = await window.editorApi.saveProject(json, project.name);
      if (saved) {
        setCurrentProjectPath(saved);
        setProjectDirty(false);
        addToRecentProjects(project.name, saved);
        setExportMessage(`✓ Saved as ${saved}`);
      }
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Save failed.");
    }
  }

  function addToRecentProjects(name: string, path: string) {
    const entry = { name, path, date: new Date().toLocaleDateString() };
    setRecentProjects((prev) => {
      const filtered = prev.filter((r) => r.path !== path).slice(0, 9);
      const next = [entry, ...filtered];
      try { localStorage.setItem("264pro_recent_projects", JSON.stringify(next)); } catch { /* ignore */ }
      // Sync to FlowState
      if (window.flowstateAPI && fsLinked) {
        void window.flowstateAPI.apiCall('/api/264pro/sync-projects', 'POST', {
          projects: next.map((r, i) => ({
            id: `local_${i}`,
            name: r.name,
            lastModified: new Date().toISOString(),
          })),
        });
      }
      return next;
    });
  }

  function handleNewProject() {
    if (projectDirty) {
      pendingActionRef.current = "new";
      setSaveConfirm({ action: "new" });
      return;
    }
    _doNewProject();
  }

  function _doNewProject() {
    loadProjectFromData(createEmptyProject() as ReturnType<typeof createEmptyProject>);
    setCurrentProjectPath(null);
    setProjectDirty(false);
    createdAtRef.current = new Date().toISOString();
    setExportMessage("✓ New project created.");
    setShowRecentPanel(false);
  }

  async function handleOpenProject(skipDirtyCheck?: boolean) {
    if (!skipDirtyCheck && projectDirty) {
      pendingActionRef.current = "open";
      setSaveConfirm({ action: "open" });
      return;
    }
    if (!window.editorApi) {
      // Fallback: load from localStorage
      try {
        const raw = localStorage.getItem("264pro_project_v2");
        if (raw) {
          const { project: loaded, warnings } = deserializeProject(raw);
          loadProjectFromData(loaded);
          createdAtRef.current = new Date().toISOString();
          setProjectDirty(false);
          addToRecentProjects(loaded.name, "[localStorage]");
          setExportMessage(warnings.length ? `⚠ Loaded (${warnings[0]})` : "✓ Project loaded.");
        } else {
          // Try legacy format
          const legacyRaw = localStorage.getItem("264pro_project");
          if (legacyRaw) {
            const saved = JSON.parse(legacyRaw) as typeof project;
            importAssets(saved.assets);
            setExportMessage("✓ Legacy project loaded.");
          } else {
            setExportMessage("No saved project found.");
          }
        }
      } catch {
        setExportMessage("Failed to load project.");
      }
      return;
    }

    try {
      const result = await window.editorApi.openProject();
      if (!result) return;
      const { project: loaded, warnings } = deserializeProject(result.json);
      loadProjectFromData(loaded);
      setCurrentProjectPath(result.filePath);
      createdAtRef.current = new Date().toISOString();
      setProjectDirty(false);
      addToRecentProjects(loaded.name, result.filePath);
      setExportMessage(warnings.length ? `⚠ Loaded (${warnings.join(", ")})` : "✓ Project loaded.");
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Load failed.");
    }
  }

  async function handleOpenRecentProject(path: string, _name: string) {
    // Always go through handleOpenProject so dirty-check is respected
    if (path === "[localStorage]") {
      setShowRecentPanel(false);
      await handleOpenProject();
      return;
    }
    setShowRecentPanel(false);
    // For real file paths, just trigger the open dialog through normal flow
    await handleOpenProject();
  }

  // ── Shortcuts ──────────────────────────────────────────────────────────────
  useEditorShortcuts({
    sequenceFps: project.sequence.settings.fps,
    isModalOpen: showSettings || showRecentPanel || Boolean(saveConfirm),
    onTogglePlayback: handleTogglePlayback,
    onToggleFullscreen: () => void viewerPanelRef.current?.toggleFullscreen(),
    onSelectTool: () => setToolMode("select"),
    onToggleBladeTool: toggleBladeTool,
    onSplitSelectedClip: splitSelectedClipAtPlayhead,
    onNudgePlayhead: handleStepFrames,
    onSeekToStart: () => handleSeek(0),
    onSeekToEnd: () => handleSeek(Math.max(totalFrames - 1, 0)),
    onRemoveSelectedClip: () => { pauseViewerPlayback(); removeSelectedClip(); },
    onUndo: undo,
    onRedo: redo,
    onSave: () => void handleSaveProject(),
    onSaveAs: () => void handleSaveProjectAs(),
    onOpen: () => void handleOpenProject(),
    onNewProject: handleNewProject,
    onDuplicateSelectedClip: () => { if (selectedClipId) { pauseViewerPlayback(); duplicateClip(selectedClipId); } },
    onFitTimeline: () => timelineZoomRef.current?.fitToWindow(),
    onExport: () => void handleExport(),
    onZoomIn: () => timelineZoomRef.current?.zoomIn(),
    onZoomOut: () => timelineZoomRef.current?.zoomOut(),
    onAddMarker: () => addMarker({ frame: playback.playheadFrame, label: "", color: "#f7c948" }),
    onJKLShuttle: (direction) => {
      if (direction === 0) {
        pauseViewerPlayback();
      } else {
        handleTogglePlayback();
      }
    },
    onToggleMediaPool: () => {
      setMediaPoolOpen((v) => {
        const next = !v;
        try { localStorage.setItem("264pro_media_pool_open", String(next)); } catch {}
        return next;
      });
    },
    onToggleInspector: () => {
      setInspectorOpen((v) => {
        const next = !v;
        try { localStorage.setItem("264pro_inspector_open", String(next)); } catch {}
        return next;
      });
    },
    onToggleDualViewer: () => setDualViewer((v) => !v),
    onLayoutPreset: (preset) => {
      setLayoutPreset(preset);
      if (preset === "color") {
        setActivePage("color");
        setMediaPoolOpen(false);
        setInspectorOpen(false);
      } else if (preset === "audio") {
        setActivePage("edit");
        setMediaPoolOpen(true);
        setInspectorOpen(false);
      } else {
        setActivePage("edit");
        setMediaPoolOpen(true);
        setInspectorOpen(true);
      }
    },
    onMarkIn: () => setVoiceMarkInFrame(playback.playheadFrame),
    onMarkOut: () => setVoiceMarkOutFrame(playback.playheadFrame),
    onSlowShuttle: (direction) => {
      // Shift+J/L = slow shuttle — for now just toggle at 0.5× speed
      handleTogglePlayback();
    },
    onJumpToClipBoundary: (direction) => {
      // Jump to nearest clip start/end in the timeline
      const fps = project.sequence.settings.fps;
      const cur = playback.playheadFrame;
      const boundaries: number[] = [];
      for (const seg of segments) {
        boundaries.push(seg.startFrame, seg.startFrame + seg.durationFrames);
      }
      const sorted = [...new Set(boundaries)].sort((a, b) => a - b);
      if (direction === 1) {
        const next = sorted.find(f => f > cur);
        if (next !== undefined) handleSeek(next);
      } else {
        const prev = [...sorted].reverse().find(f => f < cur);
        if (prev !== undefined) handleSeek(prev);
      }
    },
    onJumpToNextMarker: (direction) => {
      const cur = playback.playheadFrame;
      const markerFrames = [...project.sequence.markers].map(m => m.frame).sort((a, b) => a - b);
      if (direction === 1) {
        const next = markerFrames.find(f => f > cur);
        if (next !== undefined) handleSeek(next);
      } else {
        const prev = [...markerFrames].reverse().find(f => f < cur);
        if (prev !== undefined) handleSeek(prev);
      }
    },
    onRippleDelete: () => {
      if (selectedClipId) { pauseViewerPlayback(); rippleDelete(selectedClipId); }
    },
    onDetachAudio: () => {
      if (selectedClipId) { pauseViewerPlayback(); detachLinkedClips(selectedClipId); }
    },
    onToggleClipEnabled: () => {
      if (selectedClipId) { pauseViewerPlayback(); toggleClipEnabled(selectedClipId); }
    },
    onOpenCommandPalette: () => setCommandPaletteOpen(v => !v),
    onToggleStoryboard: () => setStoryboardOpen(v => !v),
    onToggleViewerMaximize: toggleViewerMaximize,
  });

  // Clawbot keyboard shortcut: Ctrl/Cmd+Shift+A
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setClawbotOpen(v => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Project Notes keyboard shortcut: Cmd/Ctrl+Shift+N
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setProjectNotesPanelOpen(v => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Settings keyboard shortcut: Cmd/Ctrl+, (Phase 6)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettingsPanelOpen(v => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Phase 9: ClawFlow Ambient Hook ────────────────────────────────────────
  const { suggestions: ambientSuggestions, dismissSuggestion: dismissAmbient, actOnSuggestion: actAmbient } = useClawFlowAmbient({
    project,
    fps: project.sequence.settings.fps,
    onAutoColorMatch: autoColorMatch,
    onNormalizeAudio: normalizeAudioLevels,
    onCloseAllGaps: closeAllGaps,
    onOpenBeatSync: () => setBeatSyncOpen(true),
  });

  // ── Phase 9: Voice Commands Hook ──────────────────────────────────────────
  const voice = useVoiceCommands({
    splitAtPlayhead: () => { if (selectedClipId) splitClipAtFrame(selectedClipId, playback.playheadFrame); },
    undo,
    redo,
    normalizeAudio: () => normalizeAudioLevels(-14),
    autoColorMatch,
    closeGaps: closeAllGaps,
    applyWarm: () => {
      if (!selectedClipId) return;
      const warmGrade = { temperature: 25, tint: 5, saturation: 1.1 };
      enableColorGrade(selectedClipId);
      setColorGrade(selectedClipId, warmGrade);
      updateFromGrade(warmGrade);
    },
    applyCool: () => {
      if (!selectedClipId) return;
      const coolGrade = { temperature: -20, tint: -5, saturation: 0.95 };
      enableColorGrade(selectedClipId);
      setColorGrade(selectedClipId, coolGrade);
      updateFromGrade(coolGrade);
    },
    addMarker: () => addMarker({ frame: playback.playheadFrame, label: 'Marker', color: '#f59e0b' }),
    setActivePage: (page: string) => setActivePage(page as AppPage),
  });

  // ── Phase 9: Intelligence keyboard shortcut Cmd+Shift+I ───────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setIntelligenceOpen(v => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Precision Trim: T key toggles trim panel ───────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === 't' || e.key === 'T') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setTrimPanelOpen(v => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Waveform peak extraction (background, per-asset) ─────────────────────
  useWaveformExtractor({ assets: project.assets, setAssetWaveform });

  // ── Fix 6: Filmstrip thumbnail generation (background, per-asset) ──────────
  useFilmstripGenerator({ assets: project.assets, setAssetFilmstrip });

  // ── File menu click-outside close ─────────────────────────────────────────
  useEffect(() => {
    if (!fileMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setFileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [fileMenuOpen]);

  // ── VoiceChopAI init ───────────────────────────────────────────────────────
  useEffect(() => {
    const voiceChop = new VoiceChopAI({
      acceptSuggestedCuts: () => {
        const frames = [...voiceStateRef.current.suggestedCutFrames].sort((a, b) => b - a);
        pauseViewerPlayback();
        frames.forEach((f) => splitVideoAtFrame(f));
        setVoiceSuggestedCutFrames([]);
      },
      beep: playFeedbackBeep,
      getActiveVideoClip: () => timelineStateRef.current.activeSegment,
      getBpm: () => voiceStateRef.current.bpm,
      getGridFrames: () => voiceStateRef.current.gridFrames,
      getMarks: () => ({ markInFrame: voiceStateRef.current.markInFrame, markOutFrame: voiceStateRef.current.markOutFrame }),
      getPlayheadFrame: () => timelineStateRef.current.playheadFrame,
      getSelectedVideoClip: () => {
        const seg = timelineStateRef.current.inspectorSegment;
        return seg?.track.kind === "video" ? seg : null;
      },
      getSequenceFps: () => timelineStateRef.current.sequenceFps,
      getSuggestedCuts: () => voiceStateRef.current.suggestedCutFrames,
      setLastCommand: setVoiceLastCommand,
      setListening: setVoiceListening,
      setMarks: (mi, mo) => { setVoiceMarkInFrame(mi); setVoiceMarkOutFrame(mo); },
      setStatus: setVoiceStatus,
      setSuggestedCuts: setVoiceSuggestedCutFrames,
      setTranscript: setVoiceTranscript,
      setDetectedBpm: (bpm) => { setDetectedBpm(bpm); setVoiceBpm(bpm); },
      setDetectedBeatFrames: setDetectedBeatFrames,
      splitAtCurrentPlayhead: () => splitVideoAtFrame(timelineStateRef.current.playheadFrame)
    });

    voiceChopRef.current = voiceChop;
    return () => { voiceChop.dispose(); voiceChopRef.current = null; };
  }, []);

  // ── Before-close handler (Electron close button) ──────────────────────────
  useEffect(() => {
    if (!window.editorApi?.onBeforeClose) return;
    const unsub = window.editorApi.onBeforeClose(() => {
      if (!projectDirty) {
        void window.editorApi?.confirmClose();
        return;
      }
      pendingActionRef.current = "close";
      setSaveConfirm({ action: "close" });
    });
    return unsub;
  }, [projectDirty]);

  // FIX 8: Browser-level beforeunload safety net — always warns on unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!projectDirty) return;
      e.preventDefault();
      // Modern browsers show their own dialog; returning a string triggers legacy behavior
      e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [projectDirty]);

  // ── Auto-save every 3 minutes — ONLY when a real file path exists ────────
  // Use a stable callback ref so the interval always calls the latest version
  // of handleSaveProject without needing to restart the interval on every render.
  const autoSaveRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSaveFnRef  = useRef<() => Promise<void>>(async () => {});
  autoSaveFnRef.current = async () => {
    // Guard: no path = never saved yet, skip silently (no fake "Auto-saved" toast)
    if (!currentProjectPath || !projectDirty) return;
    try {
      await handleSaveProject();
      showToast("✓ Auto-saved");
    } catch { /* silent */ }
  };

  useEffect(() => {
    if (autoSaveRef.current) clearInterval(autoSaveRef.current);
    // Only start the timer once a real file exists on disk. Before first save
    // there is no path, so we'd just be storing to localStorage with a
    // misleading toast — don't do that.
    if (!currentProjectPath) return;
    autoSaveRef.current = setInterval(
      () => { void autoSaveFnRef.current(); },
      3 * 60 * 1000 // 3 minutes
    );
    return () => { if (autoSaveRef.current) clearInterval(autoSaveRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectPath]);

  // ── Updater + bridge ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!window.editorApi) { setBridgeReady(false); return; }
    setBridgeReady(true);

    // Tell the main process the renderer is ready so the splash screen dismisses
    try { window.editorApi.notifyAppReady?.(); } catch { /* non-fatal */ }

    let cancelled = false;

    void window.editorApi.getEnvironmentStatus()
      .then((status) => { if (!cancelled) setEnvironment(status); })
      .catch((err) => { if (!cancelled) setExportMessage(err instanceof Error ? err.message : "Environment error."); });

    const unsub = window.editorApi.onUpdaterStatus((status) => {
      setUpdaterStatus(status);
      if (status.state === "available" || status.state === "ready") setUpdaterDismissed(false);
    });

    return () => { cancelled = true; unsub(); };
  }, [setEnvironment]);

  // ── Timeline vertical resize ───────────────────────────────────────────────
  useEffect(() => {
    if (!isResizingTimeline) return;
    const onMove = (e: MouseEvent) => {
      const shell = appShellRef.current;
      if (!shell) return;
      const bounds = shell.getBoundingClientRect();
      const newH = Math.max(140, Math.min(560, bounds.bottom - e.clientY));
      setTimelineHeight(newH);
      try { localStorage.setItem("264pro_timeline_height", String(newH)); } catch {}
    };
    const onUp = () => setIsResizingTimeline(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isResizingTimeline]);

  // ── Panel resize ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!resizeSide) return;
    const onMove = (e: MouseEvent) => {
      const bounds = appShellRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const min = 220, max = 520, minCenter = 480;
      if (resizeSide === "left") {
        const proposed = e.clientX - bounds.left;
        setLeftPanelWidth(Math.min(max, Math.max(min, Math.min(proposed, bounds.width - rightPanelWidth - minCenter))));
      } else {
        const proposed = bounds.right - e.clientX;
        setRightPanelWidth(Math.min(max, Math.max(min, Math.min(proposed, bounds.width - leftPanelWidth - minCenter))));
      }
    };
    const onUp = () => setResizeSide(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [resizeSide, leftPanelWidth, rightPanelWidth]);

  // ── Derived grid frames from fps ───────────────────────────────────────────
  useEffect(() => {
    setVoiceGridFrames((g) => g > 0 ? g : Math.max(1, Math.round(project.sequence.settings.fps / 2)));
  }, [project.sequence.settings.fps]);

  useEffect(() => { setTransitionMessage(null); }, [selectedClipId]);

  // ── Bridge exportMessage/transitionMessage → toast notifications ────────────
  useEffect(() => {
    if (!exportMessage) return;
    const isError = exportMessage.startsWith("✗") || exportMessage.toLowerCase().includes("fail") || exportMessage.toLowerCase().includes("error");
    const isWarning = exportMessage.startsWith("⚠");
    if (isError)        toast.error(exportMessage, 5000);
    else if (isWarning) toast.warning(exportMessage, 4000);
    else                toast.success(exportMessage, 3000);
  }, [exportMessage]);

  useEffect(() => {
    if (!transitionMessage) return;
    toast.info(transitionMessage, 2500);
  }, [transitionMessage]);

  // ── Import/Export ──────────────────────────────────────────────────────────
  // Non-blocking async import pipeline:
  //   1. Immediately adds assets with placeholder thumbnails so the media
  //      pool is populated and the timeline is usable right away.
  //   2. Generates thumbnails in background, patches them into the store.
  const { triggerImport } = useAsyncImport({
    onAssetsReady: (assets) => {
      if (assets.length) importAssets(assets);
      setExportMessage(null);
    },
    onThumbnailReady: (assetId, thumbnailUrl) => {
      setAssetThumbnail(assetId, thumbnailUrl);
    },
    onImportingChange: (busy) => {
      setImportBusy(busy);
    }
  });

  async function handleImport() {
    setExportMessage(null);
    await triggerImport();
  }

  async function handleExport(opts?: { codec?: import("../shared/models").ExportCodec; outputWidth?: number; outputHeight?: number }) {
    if (!window.editorApi) { setBridgeReady(false); setExportMessage("Export unavailable."); return; }
    setExportMessage(null);
    if (!segments.length) { setExportMessage("Add clips before exporting."); return; }
    const codec = opts?.codec;
    const ext = (codec === "libvpx-vp9") ? "webm" : (codec === "prores_ks") ? "mov" : "mp4";
    const suggestedName = `${project.sequence.name}.${ext}`;
    try {
      const outputPath = await window.editorApi.chooseExportFile(suggestedName);
      if (!outputPath) return;
      setExportBusy(true);
      setExportProgress(0);
      // Subscribe to progress events
      const unsubProgress = window.editorApi.onExportProgress?.((pct) => {
        setExportProgress(pct);
      });
      try {
        const result = await window.editorApi.exportSequence({
          outputPath,
          project,
          codec,
          outputWidth: opts?.outputWidth,
          outputHeight: opts?.outputHeight,
        });
        setExportProgress(100);
        setExportMessage(`✓ Rendered to ${result.outputPath}`);
        setLastExportedPath(result.outputPath);
        // Notify FlowState of export activity
        if (window.flowstateAPI && fsLinked) {
          void window.flowstateAPI.apiCall('/api/264pro/activity', 'POST', {
            event: 'export_completed',
            projectName: project.name ?? 'Untitled',
            format: ext,
            outputPath: result.outputPath,
          });
        }
      } finally {
        unsubProgress?.();
      }
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Render failed.");
    } finally {
      setExportBusy(false);
    }
  }

  // ── Render Queue ───────────────────────────────────────────────────────────
  function handleAddToQueue(opts: { codec: import("../shared/models").ExportCodec; outputWidth: number; outputHeight: number; label: string }) {
    const job: RenderJob = {
      id: `rj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label: opts.label,
      codec: opts.codec,
      outputWidth: opts.outputWidth,
      outputHeight: opts.outputHeight,
      status: "queued",
      progress: 0,
      createdAt: Date.now(),
    };
    setRenderJobs((prev) => [...prev, job]);
    setRenderQueueOpen(true);
  }

  // Process render queue sequentially — called whenever jobs change
  useEffect(() => {
    async function processQueue() {
      if (renderQueueProcessingRef.current) return;
      if (!window.editorApi) return;
      const pendingJob = renderJobs.find((j) => j.status === "queued");
      if (!pendingJob) return;

      renderQueueProcessingRef.current = true;

      // Prompt for output path
      const ext = pendingJob.codec === "libvpx-vp9" ? "webm" : pendingJob.codec === "prores_ks" ? "mov" : "mp4";
      let outputPath: string | null = null;
      try {
        outputPath = await window.editorApi.chooseExportFile(`${project.sequence.name}.${ext}`);
      } catch {
        outputPath = null;
      }

      if (!outputPath) {
        // User cancelled — remove the job
        setRenderJobs((prev) => prev.filter((j) => j.id !== pendingJob.id));
        renderQueueProcessingRef.current = false;
        return;
      }

      // Mark as rendering
      setRenderJobs((prev) => prev.map((j) => j.id === pendingJob.id ? { ...j, status: "rendering" as const, progress: 0 } : j));

      // Subscribe to progress
      const unsubProgress = window.editorApi.onExportProgress?.((pct) => {
        setRenderJobs((prev) => prev.map((j) => j.id === pendingJob.id ? { ...j, progress: pct } : j));
      });

      try {
        const result = await window.editorApi.exportSequence({
          outputPath,
          project,
          codec: pendingJob.codec,
          outputWidth: pendingJob.outputWidth,
          outputHeight: pendingJob.outputHeight,
        });
        setRenderJobs((prev) => prev.map((j) => j.id === pendingJob.id ? { ...j, status: "done" as const, progress: 100, outputPath: result.outputPath } : j));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Render failed.";
        setRenderJobs((prev) => prev.map((j) => j.id === pendingJob.id ? { ...j, status: "error" as const, errorMessage: msg } : j));
      } finally {
        unsubProgress?.();
        renderQueueProcessingRef.current = false;
      }
    }

    void processQueue();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderJobs]);

  // ── Save Confirmation Modal handler ───────────────────────────────────────
  async function handleSaveConfirmChoice(choice: "save" | "discard" | "cancel") {
    const action = pendingActionRef.current;
    setSaveConfirm(null);
    if (choice === "cancel") { pendingActionRef.current = null; return; }
    if (choice === "save") {
      await handleSaveProject();
    }
    // After save (or discard), proceed with pending action
    pendingActionRef.current = null;
    if (action === "new") _doNewProject();
    else if (action === "open") await handleOpenProject(true);
    else if (action === "close") {
      // Mark project as clean FIRST so the browser beforeunload handler doesn't
      // block Electron from closing the window after confirmClose() fires.
      setProjectDirty(false);
      // Small tick to let React flush the state update before the window closes
      setTimeout(() => { void window.editorApi?.confirmClose(); }, 50);
    }
  }

  function renderSaveConfirmModal() {
    if (!saveConfirm) return null;
    const actionLabel = saveConfirm.action === "close" ? "closing the app"
      : saveConfirm.action === "new" ? "creating a new project"
      : "opening another project";
    return (
      <div className="save-confirm-overlay">
        <div className="save-confirm-modal">
          <div className="save-confirm-icon">💾</div>
          <h2 className="save-confirm-title">Unsaved Changes</h2>
          <p className="save-confirm-body">Do you want to save your changes before {actionLabel}?</p>
          <div className="save-confirm-actions">
            <button className="panel-action primary" onClick={() => void handleSaveConfirmChoice("save")} type="button">
              💾 Save
            </button>
            <button className="panel-action danger" onClick={() => void handleSaveConfirmChoice("discard")} type="button">
              🗑 Don't Save
            </button>
            <button className="panel-action muted" onClick={() => void handleSaveConfirmChoice("cancel")} type="button">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Updater banner ─────────────────────────────────────────────────────────
  const showUpdaterBanner = !updaterDismissed && updaterStatus !== null &&
    updaterStatus.state !== "checking" && updaterStatus.state !== "up-to-date";

  function renderUpdaterBanner() {
    if (!showUpdaterBanner || !updaterStatus) return null;
    const { state, version, percent, message } = updaterStatus;
    let text = "";
    let cls = "updater-banner";
    let canDismiss = false;
    let canInstall = false;

    if (state === "available") { text = `Update v${version ?? ""} available — downloading…`; cls += " info"; canDismiss = true; }
    else if (state === "downloading") {
      text = `Downloading update… ${percent ?? 0}%`;
      cls += " info";
    }
    else if (state === "ready") {
      text = `v${version ?? ""} ready to install.`;
      cls += " success";
      canDismiss = true;
      canInstall = true;
    }
    else if (state === "error") { text = `Update error: ${message ?? "unknown"}`; cls += " error"; canDismiss = true; }

    return (
      <div className={cls}>
        <span>{text}</span>
        {state === "downloading" && percent !== undefined && (
          <div className="updater-progress-bar">
            <div className="updater-progress-fill" style={{ width: `${percent}%` }} />
          </div>
        )}
        {canInstall && (
          <button
            className="updater-banner__install"
            onClick={() => void window.editorApi?.installUpdate()}
            type="button"
          >Restart &amp; Install</button>
        )}
        {canDismiss && (
          <button className="updater-banner__dismiss" onClick={() => setUpdaterDismissed(true)} type="button">✕</button>
        )}
      </div>
    );
  }

  // ── Recent Projects Panel ─────────────────────────────────────────────────
  function renderRecentPanel() {
    if (!showRecentPanel) return null;
    return (
      <div className="recent-panel-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowRecentPanel(false); }}>
        <div className="recent-panel">
          <div className="recent-panel-header">
            <h3>Open Recent</h3>
            <button className="recent-panel-close" onClick={() => setShowRecentPanel(false)} type="button">✕</button>
          </div>
          <div className="recent-panel-actions">
            <button className="panel-action primary" onClick={handleNewProject} type="button">＋ New Project</button>
            <button className="panel-action" onClick={() => { setShowRecentPanel(false); void handleOpenProject(); }} type="button">📂 Open File…</button>
          </div>
          {recentProjects.length === 0 ? (
            <p className="recent-empty">No recent projects yet.</p>
          ) : (
            <div className="recent-list">
              {recentProjects.map((r) => (
                <button
                  key={r.path}
                  className="recent-item"
                  onClick={() => void handleOpenRecentProject(r.path, r.name)}
                  type="button"
                >
                  <span className="recent-item-icon">🎬</span>
                  <span className="recent-item-info">
                    <span className="recent-item-name">{r.name}</span>
                    <span className="recent-item-path">{r.path}</span>
                    <span className="recent-item-date">{r.date}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Settings helpers ──────────────────────────────────────────────────────
  // applyPreset kept for backwards compatibility — now handled inline in the modal
  function applyPreset(preset: string) {
    const presets: Record<string, Partial<ProjectSettings>> = {
      "YouTube 1080p":  { width: 1920, height: 1080, fps: 30,  aspectRatio: "16:9" },
      "YouTube 4K":     { width: 3840, height: 2160, fps: 30,  aspectRatio: "16:9" },
      "TikTok / Reels": { width: 1080, height: 1920, fps: 30,  aspectRatio: "9:16" },
      "Instagram Square":{ width: 1080, height: 1080, fps: 30, aspectRatio: "1:1"  },
      "Cinema 4K DCI":  { width: 4096, height: 2160, fps: 24,  aspectRatio: "16:9" },
      "Twitter / X":    { width: 1280, height: 720,  fps: 30,  aspectRatio: "16:9" },
    };
    if (presets[preset]) setSettingsDraft(d => ({ ...d, ...presets[preset] }));
  }

  function handleSaveSettings() {
    // Apply the drafted settings to the live project
    updateSequenceSettings({
      width:           Math.max(1, Math.round(settingsDraft.width)),
      height:          Math.max(1, Math.round(settingsDraft.height)),
      fps:             settingsDraft.fps,
      audioSampleRate: settingsDraft.audioSampleRate,
    });
    // Update project name if changed
    const trimmedName = settingsDraft.projectName.trim();
    if (trimmedName && trimmedName !== project.name) {
      // Direct store mutation via editorStore's project field
      useEditorStore.setState((s) => ({
        project: { ...s.project, name: trimmedName }
      }));
    }
    setShowSettings(false);
    showToast(`✓ Settings saved: ${settingsDraft.width}×${settingsDraft.height} @ ${settingsDraft.fps}fps`);
  }

  // ── Settings modal (tabbed settings) ─────────────────────────
  function renderSettingsModal() {
    if (!showSettings) return null;

    const PRESETS: Record<string, Omit<ProjectSettings, "projectName" | "audioSampleRate">> = {
      "YouTube 1080p":  { width: 1920, height: 1080, fps: 30,     aspectRatio: "16:9" },
      "YouTube 4K":     { width: 3840, height: 2160, fps: 30,     aspectRatio: "16:9" },
      "YouTube 1080p 60fps": { width: 1920, height: 1080, fps: 60, aspectRatio: "16:9" },
      "TikTok / Reels": { width: 1080, height: 1920, fps: 30,     aspectRatio: "9:16" },
      "Instagram Square":{ width: 1080, height: 1080, fps: 30,    aspectRatio: "1:1"  },
      "Cinema 4K DCI":  { width: 4096, height: 2160, fps: 24,     aspectRatio: "16:9" },
      "Cinema 2K":      { width: 2048, height: 1080, fps: 24,     aspectRatio: "16:9" },
      "Twitter / X":    { width: 1280, height: 720,  fps: 30,     aspectRatio: "16:9" },
      "720p HD":        { width: 1280, height: 720,  fps: 30,     aspectRatio: "16:9" },
    };
    const FPS_OPTIONS = [
      { label: "23.976 fps (Film)",    value: 23.976 },
      { label: "24 fps (Cinema)",      value: 24     },
      { label: "25 fps (PAL)",         value: 25     },
      { label: "29.97 fps (NTSC)",     value: 29.97  },
      { label: "30 fps",               value: 30     },
      { label: "48 fps (HFR)",         value: 48     },
      { label: "50 fps (PAL HFR)",     value: 50     },
      { label: "59.94 fps (NTSC HFR)", value: 59.94  },
      { label: "60 fps",               value: 60     },
      { label: "120 fps",              value: 120    },
    ];
    const SAMPLE_RATE_OPTIONS = [
      { label: "44.1 kHz (CD Quality)", value: 44100 },
      { label: "48 kHz (Broadcast Standard)", value: 48000 },
      { label: "96 kHz (Studio Hi-Res)", value: 96000 },
    ];

    // Auto-detect aspect ratio from resolution
    const wStr = String(settingsDraft.width);
    const hStr = String(settingsDraft.height);
    function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }
    const g = gcd(Number(wStr) || 1, Number(hStr) || 1);
    const autoRatio = g > 0 ? `${(Number(wStr) || 1) / g}:${(Number(hStr) || 1) / g}` : "—";

    const totalPixels = settingsDraft.width * settingsDraft.height;
    let resolutionLabel = "";
    if (totalPixels >= 3840 * 2160) resolutionLabel = "4K UHD";
    else if (totalPixels >= 2048 * 1080) resolutionLabel = "2K";
    else if (totalPixels >= 1920 * 1080) resolutionLabel = "Full HD";
    else if (totalPixels >= 1280 * 720) resolutionLabel = "HD";
    else resolutionLabel = "SD";

    const TABS = [
      { id: "general", label: "⚙ General" },
      { id: "timeline", label: "🎞 Timeline" },
      { id: "audio",   label: "🎵 Audio" },
    ] as const;

    return (
      <div className="settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}>
        <div className="settings-modal settings-modal-264">
          {/* Header */}
          <div className="settings-modal-header">
            <div className="settings-modal-title-row">
              <span className="settings-modal-icon">⚙</span>
              <h2>Project Settings</h2>
              {projectDirty && <span className="settings-dirty-badge">Unsaved changes</span>}
            </div>
            <button className="settings-modal-close" onClick={() => setShowSettings(false)} type="button" title="Close">✕</button>
          </div>

          {/* Tab strip */}
          <div className="settings-tab-strip">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`settings-tab${settingsTab === t.id ? " active" : ""}`}
                onClick={() => setSettingsTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="settings-modal-body">

            {/* ── GENERAL tab ── */}
            {settingsTab === "general" && (
              <div className="settings-tab-content">
                <div className="settings-section">
                  <div className="settings-section-title">Project</div>
                  <div className="settings-row">
                    <label>Project Name</label>
                    <input
                      className="settings-input settings-input-wide"
                      type="text"
                      value={settingsDraft.projectName}
                      onChange={(e) => setSettingsDraft(d => ({ ...d, projectName: e.target.value }))}
                      placeholder="My Project"
                    />
                  </div>
                  <div className="settings-row settings-row-readonly">
                    <label>Project File</label>
                    <span className="settings-value-text">{currentProjectPath ?? "Not yet saved"}{projectDirty ? " •" : ""}</span>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-title">Project File Actions</div>
                  <div className="settings-action-grid">
                    <button className="settings-action-btn primary" onClick={() => void handleSaveProject()} type="button">
                      💾 {currentProjectPath ? "Save" : "Save As…"}
                    </button>
                    <button className="settings-action-btn" onClick={() => void handleSaveProjectAs()} type="button">
                      📋 Save As…
                    </button>
                    <button className="settings-action-btn" onClick={() => { setShowSettings(false); void handleOpenProject(); }} type="button">
                      📂 Open Project…
                    </button>
                    <button className="settings-action-btn danger" onClick={() => {
                      pendingActionRef.current = "new";
                      if (projectDirty) { setSaveConfirm({ action: "new" }); setShowSettings(false); }
                      else { setShowSettings(false); _doNewProject(); }
                    }} type="button">
                      ✦ New Project
                    </button>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-title">Project Info</div>
                  <div className="settings-info-grid">
                    <div className="settings-info-item"><span className="settings-info-label">Resolution</span><span className="settings-info-value">{project.sequence.settings.width} × {project.sequence.settings.height} ({resolutionLabel})</span></div>
                    <div className="settings-info-item"><span className="settings-info-label">Frame Rate</span><span className="settings-info-value">{project.sequence.settings.fps} fps</span></div>
                    <div className="settings-info-item"><span className="settings-info-label">Video Tracks</span><span className="settings-info-value">{project.sequence.tracks.filter(t => t.kind === "video").length}</span></div>
                    <div className="settings-info-item"><span className="settings-info-label">Audio Tracks</span><span className="settings-info-value">{project.sequence.tracks.filter(t => t.kind === "audio").length}</span></div>
                    <div className="settings-info-item"><span className="settings-info-label">Total Clips</span><span className="settings-info-value">{project.sequence.clips.length}</span></div>
                    <div className="settings-info-item"><span className="settings-info-label">Media Assets</span><span className="settings-info-value">{project.assets.length}</span></div>
                  </div>
                </div>
              </div>
            )}

            {/* ── TIMELINE tab ── */}
            {settingsTab === "timeline" && (
              <div className="settings-tab-content">
                <div className="settings-section">
                  <div className="settings-section-title">Preset Profiles</div>
                  <div className="settings-preset-grid-v2">
                    {Object.entries(PRESETS).map(([name, vals]) => (
                      <button
                        key={name}
                        type="button"
                        className={`settings-preset-btn-v2${
                          settingsDraft.width === vals.width &&
                          settingsDraft.height === vals.height &&
                          settingsDraft.fps === vals.fps ? " active" : ""
                        }`}
                        onClick={() => setSettingsDraft(d => ({ ...d, ...vals }))}
                      >
                        <span className="preset-name">{name}</span>
                        <span className="preset-meta">{vals.width}×{vals.height} / {vals.fps}fps</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-title">Resolution</div>
                  <div className="settings-row">
                    <label>Width (px)</label>
                    <input className="settings-input" type="number" min={1} max={8192} step={2}
                      value={settingsDraft.width}
                      onChange={(e) => setSettingsDraft(d => ({ ...d, width: Number(e.target.value) }))} />
                  </div>
                  <div className="settings-row">
                    <label>Height (px)</label>
                    <input className="settings-input" type="number" min={1} max={8192} step={2}
                      value={settingsDraft.height}
                      onChange={(e) => setSettingsDraft(d => ({ ...d, height: Number(e.target.value) }))} />
                  </div>
                  <div className="settings-row settings-row-readonly">
                    <label>Aspect Ratio</label>
                    <span className="settings-value-text">{autoRatio} ({resolutionLabel})</span>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-title">Frame Rate</div>
                  <div className="settings-row">
                    <label>Frame Rate</label>
                    <select className="settings-select" value={settingsDraft.fps}
                      onChange={(e) => setSettingsDraft(d => ({ ...d, fps: Number(e.target.value) }))}>
                      {FPS_OPTIONS.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="settings-row settings-row-readonly">
                    <label>Field Order</label>
                    <span className="settings-value-text">Progressive (non-interlaced)</span>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-title">⚠ Important Note</div>
                  <div className="settings-warning-note">
                    Changing resolution or frame rate after clips have been placed on the timeline may affect timing and proportions.
                    Apply presets before adding clips for best results.
                  </div>
                </div>
              </div>
            )}

            {/* ── AUDIO tab ── */}
            {settingsTab === "audio" && (
              <div className="settings-tab-content">
                <div className="settings-section">
                  <div className="settings-section-title">Audio Settings</div>
                  <div className="settings-row">
                    <label>Sample Rate</label>
                    <select className="settings-select" value={settingsDraft.audioSampleRate}
                      onChange={(e) => setSettingsDraft(d => ({ ...d, audioSampleRate: Number(e.target.value) }))}>
                      {SAMPLE_RATE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="settings-row settings-row-readonly">
                    <label>Channels</label>
                    <span className="settings-value-text">Stereo (2.0)</span>
                  </div>
                  <div className="settings-row settings-row-readonly">
                    <label>Bit Depth</label>
                    <span className="settings-value-text">24-bit (PCM)</span>
                  </div>
                  <div className="settings-row settings-row-readonly">
                    <label>Codec</label>
                    <span className="settings-value-text">AAC (export) / PCM (editing)</span>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-title">Master Volume</div>
                  <div className="settings-row">
                    <label>Output Level</label>
                    <span className="settings-value-text">0 dBFS (Unity)</span>
                  </div>
                  <div className="settings-warning-note">
                    Individual clip and track volumes can be adjusted in the Inspector panel and timeline track controls.
                  </div>
                </div>
              </div>
            )}

          </div>

          {/* Footer */}
          <div className="settings-modal-footer">
            <button className="panel-action muted" onClick={() => setShowSettings(false)} type="button">Cancel</button>
            <button className="panel-action primary" onClick={handleSaveSettings} type="button">✓ Save Settings</button>
          </div>
        </div>
      </div>
    );
  }

  // ── ImageToVideoModal ─────────────────────────────────────────────────────
  function renderImageToVideoModal() {
    if (!imageToVideoAsset) return null;
    const asset = imageToVideoAsset;
    return (
      <ImageToVideoModal
        asset={asset}
        fsTier={fsTier}
        fsLinked={fsLinked}
        onClose={() => setImageToVideoAsset(null)}
        onAddToMediaPool={(videoUrl, name) => {
          // Import the generated video URL as an asset
          const newAsset: import("../shared/models").MediaAsset = {
            id: `ai_vid_${Date.now()}`,
            name,
            sourcePath: videoUrl,
            previewUrl: videoUrl,
            thumbnailUrl: null,
            durationSeconds: 5,
            width: asset.width || 1920,
            height: asset.height || 1080,
            nativeFps: 24,
            hasAudio: false,
            isHDR: false,
            videoCodec: "h264",
          };
          importAssets([newAsset]);
          showToast("Video generated — added to Media Pool");
          setImageToVideoAsset(null);
        }}
      />
    );
  }

  // ── ImageGenModal ──────────────────────────────────────────────────────────
  function renderImageGenModal() {
    if (!imgGenOpen) return null;
    return (
      <ImageGenModal
        assets={project.assets}
        fsTier={fsTier}
        fsLinked={fsLinked}
        onClose={() => setImgGenOpen(false)}
        onAddToMediaPool={(imageUrl, name) => {
          const newAsset: import("../shared/models").MediaAsset = {
            id: `ai_img_${Date.now()}`,
            name,
            sourcePath: imageUrl,
            previewUrl: imageUrl,
            thumbnailUrl: imageUrl,
            durationSeconds: 0,
            width: 1024,
            height: 1024,
            nativeFps: 0,
            hasAudio: false,
          };
          importAssets([newAsset]);
          showToast("Image added to Media Pool");
        }}
      />
    );
  }

  const shellStyle = {
    "--left-panel-width": mediaPoolOpen ? `${leftPanelWidth}px` : "0px",
    "--left-resizer-width": mediaPoolOpen ? "3px" : "0px",
    "--right-panel-width": inspectorOpen ? `${rightPanelWidth}px` : "0px",
    "--right-resizer-width": inspectorOpen ? "3px" : "0px",
    "--timeline-height": `${timelineHeight}px`
  } as CSSProperties;

  // Helper: format frames as HH:MM:SS:FF timecode
  function framesToTimecode(frame: number, fps: number): string {
    const f = Math.max(0, Math.round(frame));
    const totalSec = Math.floor(f / fps);
    const ff = f % fps;
    const ss = totalSec % 60;
    const mm = Math.floor(totalSec / 60) % 60;
    const hh = Math.floor(totalSec / 3600);
    return [
      String(hh).padStart(2, "0"),
      String(mm).padStart(2, "0"),
      String(ss).padStart(2, "0"),
      String(ff).padStart(2, "0")
    ].join(":");
  }

  function handleTimecodeSubmit(raw: string) {
    // Parse HH:MM:SS:FF or SS:FF or integer frames
    const parts = raw.trim().split(":").map(Number);
    let frame = 0;
    const fps = project.sequence.settings.fps;
    if (parts.length === 4) {
      frame = ((parts[0] * 3600 + parts[1] * 60 + parts[2]) * fps) + parts[3];
    } else if (parts.length === 3) {
      frame = ((parts[0] * 60 + parts[1]) * fps) + parts[2];
    } else if (parts.length === 2) {
      frame = parts[0] * fps + parts[1];
    } else if (parts.length === 1 && !isNaN(parts[0])) {
      frame = parts[0];
    }
    if (!isNaN(frame)) handleSeek(Math.max(0, Math.min(totalFrames - 1, Math.round(frame))));
    setTimecodeEditing(false);
  }

  // ── Page content —————————————————————————————————————————————————————──────
  return (
    <div className="app-root">
      {renderUpdaterBanner()}
      {renderSaveConfirmModal()}
      {renderSettingsModal()}
      {renderRecentPanel()}

      {/* ── Toast notification system ── */}
      <ToastContainer />

      {/* ── Render Queue Panel (floating) ── */}
      {renderQueueOpen && (
        <div style={{ position: "fixed", bottom: 60, right: 16, zIndex: 5000, width: 360 }}>
          <RenderQueuePanel
            jobs={renderJobs}
            onRemoveJob={(id) => setRenderJobs((prev) => prev.filter((j) => j.id !== id))}
            onRetryJob={(id) => setRenderJobs((prev) => prev.map((j) => j.id === id ? { ...j, status: "queued" as const, progress: 0, errorMessage: undefined } : j))}
            onRevealOutput={(outputPath) => { void window.editorApi?.showInFolder?.(outputPath); }}
            onClose={() => setRenderQueueOpen(false)}
            projectName={project.name}
            project={project}
            hasOpticalFlowClips={project.sequence.clips.some(c => c.opticalFlow && (c.speed ?? 1) < 1)}
            onDeliveryPackage={handleDeliveryPackage}
            onAddBatchJobs={(presets: BatchPreset[]) => {
              const newJobs = presets.map(p => ({
                id: createId(),
                label: `${project.name}${p.suffix} · ${p.label}`,
                codec: p.codec,
                outputWidth: p.width,
                outputHeight: p.height,
                status: "queued" as const,
                progress: 0,
                createdAt: Date.now(),
              }));
              setRenderJobs(prev => [...prev, ...newJobs]);
              toast.success(`Added ${newJobs.length} batch jobs to queue`);
            }}
          />
        </div>
      )}

      {/* ── Command Palette ── */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        commands={buildCommandList({
          onTogglePlayback: handleTogglePlayback,
          onSave: () => void handleSaveProject(),
          onSaveAs: () => void handleSaveProjectAs(),
          onOpen: () => void handleOpenProject(),
          onNewProject: handleNewProject,
          onExport: () => void handleExport(),
          onUndo: undo,
          onRedo: redo,
          onSplitClip: splitSelectedClipAtPlayhead,
          onDuplicateClip: () => { if (selectedClipId) duplicateClip(selectedClipId); },
          onRemoveClip: () => { pauseViewerPlayback(); removeSelectedClip(); },
          onFitTimeline: () => timelineZoomRef.current?.fitToWindow(),
          onZoomIn: () => timelineZoomRef.current?.zoomIn(),
          onZoomOut: () => timelineZoomRef.current?.zoomOut(),
          onAddMarker: () => addMarker({ frame: playback.playheadFrame, label: "", color: "#f7c948" }),
          onToggleMediaPool: () => setMediaPoolOpen(v => !v),
          onToggleInspector: () => setInspectorOpen(v => !v),
          onToggleFullscreen: () => void viewerPanelRef.current?.toggleFullscreen(),
          onSeekToStart: () => handleSeek(0),
          onSeekToEnd: () => handleSeek(Math.max(totalFrames - 1, 0)),
          onSelectTool: () => setToolMode("select"),
          onBladeTool: toggleBladeTool,
          onColorPage: () => setActivePage("color"),
          onEditPage: () => setActivePage("edit"),
          onFusionPage: () => { if (selectedClipId) { openFusion(selectedClipId); setActivePage("fusion"); } },
          onToggleStoryboard: () => setStoryboardOpen(v => !v),
          onDetachAudio: () => { if (selectedClipId) { pauseViewerPlayback(); detachLinkedClips(selectedClipId); } },
          onToggleClipEnabled: () => { if (selectedClipId) { pauseViewerPlayback(); toggleClipEnabled(selectedClipId); } },
        })}
      />

      {/* ── TOP MENU BAR ── */}
      <header className="app-menubar">
        <div className="menubar-brand">
          <span className="brand-logo">264</span>
          <span className="brand-name">Pro</span>
        </div>

        {/* Imp 10: File dropdown */}
        <div className="file-menu-wrapper" ref={fileMenuRef}>
          <button
            className={`menubar-action-btn file-menu-btn${fileMenuOpen ? " active" : ""}`}
            onClick={() => setFileMenuOpen((v) => !v)}
            title="File"
            type="button"
          >
            File ▾
          </button>
          {fileMenuOpen && (
            <div className="file-menu-dropdown">
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); handleNewProject(); }} type="button">
                <span className="fmi-icon">➕</span> New Project <span className="fmi-kbd">⌘N</span>
              </button>
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); setTemplateModalOpen(true); }} type="button">
                <span className="fmi-icon">📋</span> New from Template…
              </button>
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); void handleOpenProject(); }} type="button">
                <span className="fmi-icon">📂</span> Open… <span className="fmi-kbd">⌘O</span>
              </button>
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); setShowRecentPanel(true); }} type="button">
                <span className="fmi-icon">🕒</span> Open Recent…
              </button>
              <div className="file-menu-sep" />
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); void handleSaveProject(); }} type="button">
                <span className="fmi-icon">💾</span> Save{projectDirty ? " •" : ""} <span className="fmi-kbd">⌘S</span>
              </button>
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); void handleSaveProjectAs(); }} type="button">
                <span className="fmi-icon">📎</span> Save As… <span className="fmi-kbd">⌘⇧S</span>
              </button>
              <div className="file-menu-sep" />
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); void handleExport(); }} type="button">
                <span className="fmi-icon">🎥</span> Export… <span className="fmi-kbd">⌘E</span>
              </button>
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); setAutoResizeOpen(true); }} type="button">
                <span className="fmi-icon">📱</span> Social Auto-Resize…
              </button>
              <div className="file-menu-sep" />
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); setProjectNotesPanelOpen(true); }} type="button">
                <span className="fmi-icon">📋</span> Project Notes… <span className="fmi-kbd">⌘⇧N</span>
              </button>
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); setShowSettings(true); }} type="button">
                <span className="fmi-icon">⚙️</span> Settings…
              </button>
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); setShortcutsPanelOpen(true); }} type="button">
                <span className="fmi-icon">⌨️</span> Keyboard Shortcuts…
              </button>
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); setSettingsPanelOpen(true); }} type="button">
                <span className="fmi-icon">🤖</span> AI & API Keys… (⌘,)
              </button>
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); window.dispatchEvent(new CustomEvent("264pro:show-onboarding")); }} type="button">
                <span className="fmi-icon">❓</span> Feature Tour…
              </button>
            </div>
          )}
        </div>

        {/* Undo/Redo */}
        <div className="menubar-actions">
          <button
            className="menubar-action-btn"
            onClick={undo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            type="button"
          >
            ↩ Undo
          </button>
          <button
            className="menubar-action-btn"
            onClick={redo}
            disabled={!canRedo}
            title="Redo (⌘⇧Z)"
            type="button"
          >
            ↪ Redo
          </button>
        </div>

        {/* Page tabs */}
        <nav className="page-tabs">
          {(["edit", "color", "audio", "fusion"] as const).map((page) => (
            <button
              key={page}
              className={`page-tab${activePage === page ? " active" : ""}${page === "fusion" ? " fusion-tab" : ""}`}
              onClick={() => {
                if (page === "fusion") {
                  const clipId = selectedClipId ?? project.sequence.clips.find(c => {
                    const asset = project.assets.find(a => a.id === c.assetId);
                    return asset && (asset.videoCodec != null || asset.width > 0);
                  })?.id ?? "";
                  openFusion(clipId);
                } else {
                  setActivePage(page);
                }
              }}
              type="button"
              title={page === "fusion" ? "Open Fusion node compositor" : page === "audio" ? "ClawSound Audio Engineering" : undefined}
            >
              {page === "fusion" ? "⬡ NodeFX" : page === "audio" ? "🎚 Audio" : page.charAt(0).toUpperCase() + page.slice(1)}
            </button>
          ))}
          <button
            className={`page-tab${activePage === "publish" ? " active" : ""}`}
            onClick={() => setActivePage("publish")}
            type="button"
            style={{ color: activePage === "publish" ? "#c4b5fd" : undefined }}
            title="ClawFlow Publish — publish to YouTube, TikTok, Instagram"
          >
            🚀 Publish
          </button>
        </nav>

        {/* Imp 4: Large centered timecode */}
        <div className="menubar-timecode-wrap">
          {timecodeEditing ? (
            <input
              className="timecode-input"
              autoFocus
              defaultValue={framesToTimecode(playback.playheadFrame, project.sequence.settings.fps)}
              onBlur={(e) => handleTimecodeSubmit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleTimecodeSubmit((e.target as HTMLInputElement).value);
                if (e.key === "Escape") setTimecodeEditing(false);
              }}
            />
          ) : (
            <button
              className="timecode-display"
              onClick={() => { setTimecodeEditing(true); setTimecodeInput(framesToTimecode(playback.playheadFrame, project.sequence.settings.fps)); }}
              title="Click to jump to timecode"
              type="button"
            >
              {framesToTimecode(playback.playheadFrame, project.sequence.settings.fps)}
            </button>
          )}
          <span className="timecode-total">/ {framesToTimecode(totalFrames, project.sequence.settings.fps)}</span>
        </div>

        {/* Panel toggle buttons (Imp 1) */}
        <div className="menubar-panel-toggles">
          <button
            className={`panel-toggle-btn${viewerMaximized ? " on" : ""}`}
            onClick={toggleViewerMaximize}
            title="Maximize Viewer (\) — hides panels and shrinks timeline for a full view"
            type="button"
            style={viewerMaximized ? { color: "#f5c542", borderColor: "rgba(245,197,66,0.4)", background: "rgba(245,197,66,0.1)" } : {}}
          >
            {viewerMaximized ? "⊡ Restore" : "⊞ Maximize"}
          </button>
          <button
            className={`panel-toggle-btn${mediaPoolOpen ? " on" : ""}`}
            onClick={() => {
              setMediaPoolOpen((v) => {
                const next = !v;
                try { localStorage.setItem("264pro_media_pool_open", String(next)); } catch {}
                return next;
              });
            }}
            title="Toggle Media Pool (F1)"
            type="button"
          >
            ▧ Media
          </button>
          <button
            className={`panel-toggle-btn${inspectorOpen ? " on" : ""}`}
            onClick={() => {
              setInspectorOpen((v) => {
                const next = !v;
                try { localStorage.setItem("264pro_inspector_open", String(next)); } catch {}
                return next;
              });
            }}
            title="Toggle Inspector (F2)"
            type="button"
          >
            Inspector ▦
          </button>
          <button
            className={`panel-toggle-btn${mixerOpen ? " on" : ""}`}
            onClick={() => {
              setMixerOpen((v) => {
                const next = !v;
                try { localStorage.setItem("264pro_mixer_open", String(next)); } catch {}
                return next;
              });
            }}
            title="Toggle Audio Mixer"
            type="button"
          >
            🎚 Mixer
          </button>
          <button
            className={`panel-toggle-btn${renderQueueOpen ? " on" : ""}`}
            onClick={() => setRenderQueueOpen((v) => !v)}
            title="Render Queue"
            type="button"
            style={{ position: "relative" }}
          >
            ⚙️ Queue
            {renderJobs.filter((j) => j.status === "queued" || j.status === "rendering").length > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -4,
                width: 14, height: 14, borderRadius: "50%",
                background: "#f7c948", color: "#000",
                fontSize: "0.55rem", fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {renderJobs.filter((j) => j.status === "queued" || j.status === "rendering").length}
              </span>
            )}
          </button>

          {/* 🎬 Render Cache button */}
          <button
            className="panel-toggle-btn"
            onClick={renderCache.progress > 0 ? renderCache.abort : () => void renderCache.renderAll()}
            title="Pre-render timeline segments to disk for smooth playback"
            type="button"
            style={{
              padding: '5px 12px', borderRadius: 6, border: '1px solid #334155',
              background: renderCache.progress > 0 ? '#1a2744' : '#0f172a',
              color: renderCache.progress > 0 ? '#60a5fa' : '#94a3b8',
              cursor: 'pointer', fontSize: 11, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {renderCache.progress > 0 ? (
              <>🎬 Rendering… {renderCache.progress}%</>
            ) : (
              <>🎬 Render Cache</>
            )}
          </button>

          {/* FlowState Panel toggle */}
          <button
            className={`panel-toggle-btn${flowstatePanelOpen ? " on" : ""}`}
            onClick={() => setFlowstatePanelOpen((v) => !v)}
            title={fsLinked ? `FlowState AI Panel (${fsTier})` : "FlowState AI Panel — not linked"}
            type="button"
            style={{
              background: flowstatePanelOpen
                ? "linear-gradient(135deg,rgba(224,120,32,0.25),rgba(168,85,247,0.25))"
                : undefined,
              borderColor: flowstatePanelOpen ? "rgba(168,85,247,0.4)" : undefined,
              color: flowstatePanelOpen ? "#d0a0ff" : undefined,
            }}
          >
            {fsLinked ? "🌊" : "🔗"} FlowState
            {fsLinked && (
              <span style={{
                marginLeft: 4,
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#10b981",
                display: "inline-block",
                verticalAlign: "middle",
                flexShrink: 0,
              }} />
            )}
          </button>

          {/* AI Tools Panel toggle */}
          <button
            className={`panel-toggle-btn${aiToolsPanelOpen ? " on" : ""}`}
            onClick={() => setAiToolsPanelOpen((v) => !v)}
            title="AI Tools — Upscale, Denoise, Rotoscope, Slow-Mo, Face Enhance…"
            type="button"
            style={{
              background: aiToolsPanelOpen
                ? "linear-gradient(135deg,rgba(236,72,153,0.25),rgba(245,158,11,0.25))"
                : undefined,
              borderColor: aiToolsPanelOpen ? "rgba(236,72,153,0.4)" : undefined,
              color: aiToolsPanelOpen ? "#f9a8d4" : undefined,
            }}
          >
            ⚡ AI Tools
          </button>

          {/* Free Credits button */}
          <button
            className="panel-toggle-btn"
            onClick={() => setShowFollowFreebie(true)}
            title="Get free AI credits by following on social media"
            type="button"
            style={{ background: "rgba(124,58,237,0.15)", borderColor: "rgba(124,58,237,0.4)", color: "#c4b5fd" }}
          >
            🎁 {aiCredits > 0 ? `${aiCredits} Credits` : "Free Credits"}
          </button>

          {/* Phase 9: Voice Command button */}
          <button
            className="panel-toggle-btn"
            onClick={voice.listening ? voice.stop : voice.start}
            title={voice.listening ? "Listening… (click to stop)" : "Voice command (click to speak)"}
            type="button"
            style={{
              background: voice.listening ? "rgba(220,38,38,0.25)" : undefined,
              borderColor: voice.listening ? "rgba(220,38,38,0.5)" : undefined,
              color: voice.listening ? "#fca5a5" : undefined,
            }}
          >
            🎤 {voice.listening ? "Listening…" : "Voice"}
          </button>
          {voice.lastCommand && (
            <span style={{ fontSize: 11, color: "#94a3b8", padding: "0 4px", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {voice.lastCommand}
            </span>
          )}

          {/* Phase 9: Style Profile button */}
          <button
            className={`panel-toggle-btn${styleProfileOpen ? " on" : ""}`}
            onClick={() => setStyleProfileOpen(v => !v)}
            title="ClawFlow Style Profile — learned edit style"
            type="button"
            style={{
              background: styleProfileOpen ? "rgba(124,58,237,0.25)" : undefined,
              borderColor: styleProfileOpen ? "rgba(124,58,237,0.4)" : undefined,
              color: styleProfileOpen ? "#c4b5fd" : undefined,
            }}
          >
            ⚡ Style
          </button>

          {/* Phase 9: Project Intelligence button */}
          <button
            className={`panel-toggle-btn${intelligenceOpen ? " on" : ""}`}
            onClick={() => setIntelligenceOpen(v => !v)}
            title="Project Intelligence Dashboard (⌘⇧I)"
            type="button"
            style={{
              background: intelligenceOpen ? "rgba(124,58,237,0.25)" : undefined,
              borderColor: intelligenceOpen ? "rgba(124,58,237,0.4)" : undefined,
              color: intelligenceOpen ? "#c4b5fd" : undefined,
            }}
          >
            📊 Intel
          </button>

          {/* Clawbot button */}
          <button
            className={`panel-toggle-btn${clawbotOpen ? " on" : ""}`}
            onClick={() => setClawbotOpen(v => !v)}
            title="Clawbot AI Assistant (Ctrl+Shift+A)"
            type="button"
            style={{
              background: clawbotOpen ? "rgba(124,58,237,0.25)" : undefined,
              borderColor: clawbotOpen ? "rgba(124,58,237,0.5)" : undefined,
              color: clawbotOpen ? "#c4b5fd" : undefined,
            }}
          >
            🤖 Clawbot
          </button>

          {/* Subtitles button */}
          <button
            className={`panel-toggle-btn${subtitlesPanelOpen ? " on" : ""}`}
            onClick={() => setSubtitlesPanelOpen(v => !v)}
            title="Subtitles / Captions"
            type="button"
          >
            📝 Subtitles
          </button>

          {/* Text-Based Editing button */}
          <button
            className={`panel-toggle-btn${textEditPanelOpen ? " on" : ""}`}
            onClick={() => setTextEditPanelOpen(v => !v)}
            title="Text-Based Editing — edit by transcript"
            type="button"
          >
            📝 Text Edit
          </button>

          {/* Title Generator button */}
          <button
            className={`panel-toggle-btn${titleGenPanelOpen ? " on" : ""}`}
            onClick={() => setTitleGenPanelOpen(v => !v)}
            title="Title Generator"
            type="button"
          >
            T Titles
          </button>

          {/* Phase 4: New panel buttons */}
          <button
            className={`panel-toggle-btn${multicamOpen ? " on" : ""}`}
            onClick={() => setMulticamOpen(v => !v)}
            title="Multicam Angle Viewer — cut between camera angles"
            type="button"
            style={{ borderColor: "rgba(79,142,247,0.3)", color: multicamOpen ? "#4f8ef7" : undefined }}
          >
            📹 Multicam
          </button>
          <button
            className="panel-toggle-btn"
            onClick={() => setAiStoryboardOpen(true)}
            title="AI Storyboard → Timeline — generate a rough cut from a description"
            type="button"
            style={{ borderColor: "rgba(168,85,247,0.3)", color: "#a855f7" }}
          >
            🤖 Storyboard
          </button>
          <button
            className="panel-toggle-btn"
            onClick={() => setShotListOpen(true)}
            title="Shot List & Script Integration — import fountain/plain text scripts"
            type="button"
            style={{ borderColor: "rgba(47,199,122,0.3)", color: "#2fc77a" }}
          >
            🎞 Shot List
          </button>
          {/* Phase 5: ClawFlow buttons */}
          <button
            className={`panel-toggle-btn${beatSyncOpen ? " on" : ""}`}
            onClick={() => setBeatSyncOpen(v => !v)}
            title="Beat Sync — detect beats and auto-cut video to music"
            type="button"
            style={{ borderColor: "rgba(168,85,247,0.3)", color: beatSyncOpen ? "#c4b5fd" : "#a855f7" }}
          >
            🥁 Beat Sync
          </button>
          <button
            className={`panel-toggle-btn${autoReframeOpen ? " on" : ""}`}
            onClick={() => setAutoReframeOpen(v => !v)}
            title="Auto-Reframe — AI crop to any aspect ratio (9:16, 1:1, 4:5, 16:9, 4:3)"
            type="button"
            style={{ borderColor: "rgba(59,130,246,0.3)", color: autoReframeOpen ? "#93c5fd" : "#3b82f6" }}
          >
            🎯 Reframe
          </button>
          <button
            className="panel-toggle-btn"
            onClick={() => { closeAllGaps(); toast.success("✅ All timeline gaps closed"); }}
            title="Close All Gaps — ripple all clips together"
            type="button"
            style={{ borderColor: "rgba(239,68,68,0.3)", color: "#f87171" }}
          >
            🕳 Close Gaps
          </button>
        </div>

        <div className="menubar-status">
          <span className={`bridge-dot${bridgeReady ? " ready" : ""}`} title={bridgeReady ? "Electron bridge ready" : "No bridge"} />
          <span className="status-item">{project.assets.length} assets</span>
          <span className="status-sep">·</span>
          <span className="status-item">{project.sequence.clips.length} clips</span>
          <span className="status-sep">·</span>
          <span className="status-item">{project.sequence.settings.width}×{project.sequence.settings.height}/{project.sequence.settings.fps}fps</span>
        </div>
      </header>

      {/* ── MAIN WORKSPACE ── */}
      <main ref={appShellRef} className={`app-shell page-${activePage}`} style={shellStyle}>

        {/* ── Phase 9: ClawFlow Ambient Banner (shown on any non-fusion page) ── */}
        {activePage !== "fusion" && ambientSuggestions.length > 0 && (() => {
          const s = ambientSuggestions[0];
          return (
            <div style={{
              height: 36, background: "linear-gradient(90deg, #1e1b4b, #312e81)",
              borderBottom: "1px solid #4c1d95", display: "flex", alignItems: "center",
              padding: "0 16px", gap: 12, flexShrink: 0, zIndex: 50,
            }}>
              <span style={{ fontSize: 11, color: "#c4b5fd", fontWeight: 700 }}>⚡ ClawFlow</span>
              <span style={{ fontSize: 12, color: "#e2e8f0", flex: 1 }}>{s.message}</span>
              <button onClick={() => actAmbient(s.id)} style={{
                padding: "4px 12px", borderRadius: 6, border: "none",
                background: "#7c3aed", color: "white", fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}>{s.actionLabel}</button>
              <button onClick={() => dismissAmbient(s.id)} style={{
                background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14,
              }}>✕</button>
            </div>
          );
        })()}

        {/* ── EDIT PAGE ── */}
        {activePage === "edit" && (
          <>
            {/* Imp 1: Collapsible Media Pool wrapper */}
            <div className={`panel-collapse-wrap media-collapse${mediaPoolOpen ? " open" : " closed"}`}>
              <MediaPool
                assets={project.assets}
                selectedAssetId={selectedAssetId}
                selectedSegment={inspectorSegment}
                transitionMessage={transitionMessage}
                importing={importBusy}
                onImport={handleImport}
                onSelectAsset={selectAsset}
                onAppendAsset={appendAssetToTimeline}
                onApplyTransition={(edge) => {
                  pauseViewerPlayback();
                  setTransitionMessage(applyTransitionToSelectedClip(edge));
                }}
                onApplyTransitionType={(type, edge, durationFrames) => {
                  pauseViewerPlayback();
                  const msg1 = setSelectedClipTransitionType(edge, type);
                  const msg2 = setSelectedClipTransitionDuration(edge, durationFrames);
                  setTransitionMessage(msg1 ?? msg2);
                }}
                fsTier={fsTier}
                fsLinked={fsLinked}
                onImageToVideo={(asset) => setImageToVideoAsset(asset)}
              />
            </div>

            <div
              className={`panel-resizer left-resizer${mediaPoolOpen ? "" : " panel-resizer-hidden"}`}
              onMouseDown={(e) => { e.preventDefault(); setResizeSide("left"); }}
              role="separator"
            />

            {/* Imp 7: Vertical Tool Toolbar — inside viewer cell so it doesn't block grid interactions */}
            <div className="viewer-with-toolbar">
              <div className="tool-toolbar">
                <button
                  className={`tool-btn${toolMode === "select" ? " active" : ""}`}
                  onClick={() => setToolMode("select")}
                  title="Select (A / V)"
                  type="button"
                >
                  ⤴️
                  <span className="tool-btn-label">Select</span>
                </button>
                <button
                  className={`tool-btn${toolMode === "blade" ? " active" : ""}`}
                  onClick={toggleBladeTool}
                  title="Blade (B)"
                  type="button"
                >
                  ✂️
                  <span className="tool-btn-label">Blade</span>
                </button>
                <button
                  className={`tool-btn${trimPanelOpen ? " active" : ""}`}
                  onClick={() => setTrimPanelOpen(v => !v)}
                  title="Precision Trim (T)"
                  type="button"
                >
                  ✂
                  <span className="tool-btn-label">Trim</span>
                </button>
                <div className="tool-toolbar-sep" />
                <button
                  className="tool-btn"
                  onClick={() => timelineZoomRef.current?.zoomIn()}
                  title="Zoom In (])"
                  type="button"
                >
                  🔍+
                  <span className="tool-btn-label">Zoom+</span>
                </button>
                <button
                  className="tool-btn"
                  onClick={() => timelineZoomRef.current?.zoomOut()}
                  title="Zoom Out ([)"
                  type="button"
                >
                  🔍−
                  <span className="tool-btn-label">Zoom−</span>
                </button>
                <button
                  className="tool-btn"
                  onClick={() => timelineZoomRef.current?.fitToWindow()}
                  title="Fit Timeline (Shift+Z)"
                  type="button"
                >
                  □
                  <span className="tool-btn-label">Fit</span>
                </button>
                <div className="tool-toolbar-sep" />
                <button
                  className={`tool-btn${editScopesOpen ? " active" : ""}`}
                  onClick={() => setEditScopesOpen(v => !v)}
                  title="Toggle Video Scopes"
                  type="button"
                >
                  📊
                  <span className="tool-btn-label">Scopes</span>
                </button>
              </div>
              <ViewerPanel
                ref={viewerPanelRef}
                activeSegment={activeSegment}
                activeAudioSegment={activeAudioSegment}
                segments={segments}
                selectedAsset={selectedAsset}
                playheadFrame={playback.playheadFrame}
                totalFrames={totalFrames}
                sequenceFps={project.sequence.settings.fps}
                isPlaying={playback.isPlaying}
                toolMode={toolMode}
                colorGrade={activeSegment?.clip.colorGrade ?? null}
                clipEffects={activeSegment?.clip.effects ?? null}
                activeMaskTool={activeMaskTool}
                selectedMaskId={selectedMaskId}
                onAddMask={handleAddMask}
                onUpdateMask={handleUpdateMask}
                onSelectMask={setSelectedMaskId}
                onSetPlaybackPlaying={setPlaybackPlaying}
                onSetToolMode={setToolMode}
                onToggleBladeTool={toggleBladeTool}
                onSplitAtPlayhead={splitSelectedClipAtPlayhead}
                onSetPlayheadFrame={setPlayheadFrame}
                onStepFrames={handleStepFrames}
                onAudioEngineRef={(engine) => { audioEngineRef.current = engine; }}
                subtitleCues={subtitleCues}
                onInsertAtPlayhead={handleInsertAtPlayhead}
                onOverwriteAtPlayhead={handleOverwriteAtPlayhead}
                getCachedVideoPath={renderCache.getCachedPath}
              />
              {/* Edit-page Video Scopes — toggleable via Scopes toolbar button */}
              {editScopesOpen && (
                <div style={{ padding: "6px 8px 0 8px" }}>
                  <VideoScopesPanel videoRef={viewerVideoRef} width={320} height={150} refreshMs={150} />
                </div>
              )}
            </div>

            <div
              className={`panel-resizer right-resizer${inspectorOpen ? "" : " panel-resizer-hidden"}`}
              onMouseDown={(e) => { e.preventDefault(); setResizeSide("right"); }}
              role="separator"
            />

            {/* Imp 1: Collapsible Inspector wrapper */}
            <div className={`panel-collapse-wrap inspector-collapse${inspectorOpen ? " open" : " closed"}`}>
              <InspectorPanel
                selectedAsset={selectedAsset}
              selectedSegment={inspectorSegment}
              environment={environment}
              exportBusy={exportBusy}
              exportMessage={exportMessage}
              exportProgress={exportProgress}
              clipMessage={transitionMessage}
              sequenceSettings={project.sequence.settings}
              voiceListening={voiceListening}
              voiceStatus={voiceStatus}
              voiceTranscript={voiceTranscript}
              voiceLastCommand={voiceLastCommand}
              voiceSuggestedCutFrames={voiceSuggestedCutFrames}
              voiceMarkInFrame={voiceMarkInFrame}
              voiceMarkOutFrame={voiceMarkOutFrame}
              voiceBpm={voiceBpm}
              voiceGridFrames={voiceGridFrames}
              detectedBpm={detectedBpm}
              detectedBeatFrames={detectedBeatFrames}
              activeMaskTool={activeMaskTool}
              selectedMaskId={selectedMaskId}
              onSetActiveMaskTool={setActiveMaskTool}
              onSelectMask={setSelectedMaskId}
              onAddMask={handleAddMask}
              onUpdateMask={handleUpdateMask}
              onRemoveMask={(maskId) => { if (selectedClipId) removeMask(selectedClipId, maskId); }}
              onAddEffect={(effect) => { if (selectedClipId) addEffectToClip(selectedClipId, effect); }}
              onUpdateEffect={(effectId, updates) => { if (selectedClipId) updateEffect(selectedClipId, effectId, updates); }}
              onRemoveEffect={(effectId) => { if (selectedClipId) removeEffect(selectedClipId, effectId); }}
              onToggleEffect={(effectId) => { if (selectedClipId) toggleEffect(selectedClipId, effectId); }}
              onReorderEffects={(from, to) => { if (selectedClipId) reorderEffects(selectedClipId, from, to); }}
              onToggleBackgroundRemoval={() => { if (selectedClipId) toggleBackgroundRemoval(selectedClipId); }}
              onSetBackgroundRemoval={(config) => { if (selectedClipId) setBackgroundRemoval(selectedClipId, config); }}
              onAddEffectKeyframe={(effectId, paramKey, frame, value) => {
                if (selectedClipId) addEffectKeyframe(selectedClipId, effectId, paramKey, frame, value);
              }}
              onUpdateEffectKeyframes={(effectId, paramName, keyframes) => {
                if (selectedClipId) updateEffectKeyframes(selectedClipId, effectId, paramName, keyframes);
              }}
              currentPlayheadFrame={playback.playheadFrame}
              totalFrames={totalFrames}
              onToggleClipEnabled={(clipId) => { pauseViewerPlayback(); toggleClipEnabled(clipId); }}
              onDetachLinkedClips={(clipId) => { pauseViewerPlayback(); detachLinkedClips(clipId); }}
              onRelinkClips={(clipId) => { pauseViewerPlayback(); relinkClips(clipId); }}
              onSetTransitionType={(edge, type) => {
                pauseViewerPlayback();
                setTransitionMessage(setSelectedClipTransitionType(edge, type));
              }}
              onSetTransitionDuration={(edge, dur) => {
                pauseViewerPlayback();
                setTransitionMessage(setSelectedClipTransitionDuration(edge, dur));
              }}
              onExtractAudio={() => { pauseViewerPlayback(); setTransitionMessage(extractAudioFromSelectedClip()); }}
              onRippleDelete={() => { if (selectedClipId) { pauseViewerPlayback(); rippleDelete(selectedClipId); } }}
              onSetClipVolume={(vol) => { if (selectedClipId) setClipVolume(selectedClipId, vol); }}
              onSetClipSpeed={(spd) => { if (selectedClipId) setClipSpeed(selectedClipId, spd); }}
              onSetSpeedRampKeyframes={handleSetSpeedRampKeyframes}
              onSetOpticalFlow={handleSetOpticalFlow}
              onSetOpticalFlowQuality={(quality) => {
                if (!selectedClipId) return;
                patchClip(selectedClipId, { opticalFlowQuality: quality });
              }}
              clipTransform={inspectorSegment?.clip.transform ?? null}
              onSetClipTransform={(updates) => { if (selectedClipId) setClipTransform(selectedClipId, updates); }}
              videoRef={viewerVideoRef}
              onToggleVoiceListening={() => voiceChopRef.current?.listenForCommands()}
              onAnalyzeVoiceChops={() => {
                const target = (inspectorSegment?.track.kind === "video" ? inspectorSegment : null) ?? activeSegment;
                if (!target) { setVoiceStatus("Select or park playhead on a video clip."); return; }
                voiceChopRef.current?.applyAICuts(target);
              }}
              onDetectBpm={() => {
                const target = (inspectorSegment?.track.kind === "video" ? inspectorSegment : null) ?? activeSegment;
                if (!target) { setVoiceStatus("Select a video clip for BPM detection."); return; }
                void voiceChopRef.current?.detectAndApplyBpm(target);
              }}
              onBeatSync={(mode) => {
                const target = (inspectorSegment?.track.kind === "video" ? inspectorSegment : null) ?? activeSegment;
                if (!target) { setVoiceStatus("Select a video clip for beat sync."); return; }
                void voiceChopRef.current?.beatSyncEdit(target, mode);
              }}
              onAcceptVoiceCuts={() => voiceChopRef.current?.processVoiceCommand("accept cuts")}
              onClearVoiceCuts={() => { setVoiceSuggestedCutFrames([]); setVoiceStatus("Cleared AI cuts."); }}
              onQuantizeVoiceCutsToBeat={() => voiceChopRef.current?.processVoiceCommand("quantize to beat")}
              onQuantizeVoiceCutsToGrid={() => voiceChopRef.current?.processVoiceCommand("quantize to grid")}
              onSetVoiceBpm={(bpm) => { const v = Math.max(40, Math.min(240, Math.round(bpm))); setVoiceBpm(v); voiceChopRef.current?.setBpm(v); }}
              onSetVoiceGridFrames={(g) => { const v = Math.max(1, Math.round(g)); setVoiceGridFrames(v); voiceChopRef.current?.setGridFrames(v); }}
              onExport={handleExport}
              onAddToQueue={handleAddToQueue}
              />
            </div>{/* /inspector-collapse */}

            {/* Timeline resize handle — stays in grid-area: tl-resize */}
            <div
              className={`timeline-vertical-resizer${isResizingTimeline ? " dragging" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); setIsResizingTimeline(true); }}
              onDoubleClick={() => {
                const defaultH = 220;
                setTimelineHeight(defaultH);
                try { localStorage.setItem("264pro_timeline_height", String(defaultH)); } catch {}
              }}
              title="Drag to resize timeline · Double-click to reset"
              role="separator"
            />

            {/* ── Timeline area wrapper — all timeline content in one grid cell ── */}
            <div className="timeline-area-wrapper">

            {/* AI Quick Action Bar — shown when a clip is selected */}
            {selectedClipId && (
              <div className="ai-quick-bar">
                <span className="ai-quick-label">CLIP</span>
                <button className="ai-quick-btn" type="button" title="Split at playhead (Ctrl+B)"
                  onClick={() => { pauseViewerPlayback(); splitSelectedClipAtPlayhead(); }}>
                  ✂ Split
                </button>
                <button className="ai-quick-btn" type="button" title="Duplicate clip (Ctrl+D)"
                  onClick={() => { pauseViewerPlayback(); if (selectedClipId) duplicateClip(selectedClipId); }}>
                  ⧉ Dup
                </button>
                <button className="ai-quick-btn" type="button" title="Delete clip (Del)"
                  onClick={() => { pauseViewerPlayback(); removeSelectedClip(); }}>
                  🗑 Del
                </button>
                <div className="ai-quick-sep" />
                <button className="ai-quick-btn" type="button" title="Open in Fusion"
                  onClick={() => { if (selectedClipId) { openFusion(selectedClipId); setActivePage("fusion"); } }}>
                  ⬡ Fusion
                </button>
                <button className="ai-quick-btn" type="button" title="Color grade this clip"
                  onClick={() => setActivePage("color")}>
                  🎨 Color
                </button>
                <div className="ai-quick-sep" />
                <div style={{ position: "relative" }} ref={aiMenuRef}>
                  <button
                    ref={aiBtnRef}
                    className={`ai-quick-btn ai${aiMenuOpen ? " active" : ""}`}
                    type="button"
                    title="AI operations"
                    onClick={() => {
                      if (aiBtnRef.current) {
                        const r = aiBtnRef.current.getBoundingClientRect();
                        setAiMenuPos({ bottom: window.innerHeight - r.top + 4, right: window.innerWidth - r.right });
                      }
                      setAiMenuOpen(o => !o);
                    }}
                  >
                    🤖 AI ▾
                  </button>
                  {aiMenuOpen && (
                    <div className="ai-quick-dropdown" style={{ bottom: aiMenuPos.bottom, right: aiMenuPos.right }}>
                      <div className="ai-qdrop-header">AI Tools</div>
                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) { pauseViewerPlayback(); toggleBackgroundRemoval(selectedClipId); showToast("Background removal toggled"); }
                      }}>
                        ✂ Remove Background
                      </button>
                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) {
                          pauseViewerPlayback();
                          addEffectToClip(selectedClipId, { id: `fx_${Date.now()}`, type: "ai_upscale", enabled: true, order: 0, maskIds: [], keyframes: {}, params: { scale: 2, model: "realesrgan" } });
                          showToast("AI Upscale 2x — applies on export");
                        }
                      }}>Upscale 2x (AI)</button>

                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) {
                          pauseViewerPlayback();
                          addEffectToClip(selectedClipId, { id: `fx_${Date.now()}`, type: "ai_denoise", enabled: true, order: 0, maskIds: [], keyframes: {}, params: { strength: 0.7, temporal: true } });
                          showToast("AI Denoise — reduces noise on export");
                        }
                      }}>Denoise (AI)</button>

                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) {
                          pauseViewerPlayback();
                          addEffectToClip(selectedClipId, { id: `fx_${Date.now()}`, type: "ai_stabilize", enabled: true, order: 0, maskIds: [], keyframes: {}, params: { strength: 0.8, cropRatio: 0.05 } });
                          showToast("AI Stabilize — smooths camera shake on export");
                        }
                      }}>Stabilize (AI)</button>

                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) {
                          pauseViewerPlayback();
                          addEffectToClip(selectedClipId, { id: `fx_${Date.now()}`, type: "ai_face_enhance", enabled: true, order: 0, maskIds: [], keyframes: {}, params: { strength: 0.85, model: "codeformer" } });
                          showToast("AI Face Enhance — restores facial detail on export");
                        }
                      }}>Face Enhance (AI)</button>

                      <div className="ai-qdrop-sep" />
                      <button className="ai-qdrop-item" onClick={() => { setAiMenuOpen(false); openImageGenerator(); }}>
                        🖼 Generate Image (AI)
                      </button>
                      <div className="ai-qdrop-sep" />
                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) {
                          pauseViewerPlayback();
                          addEffectToClip(selectedClipId, { id: `fx_${Date.now()}`, type: "filmnoise", enabled: true, order: 0, maskIds: [], keyframes: {}, params: { intensity: 0.4, grainSize: 1.2 } });
                          showToast("Film noise effect added");
                        }
                      }}>
                        🎞 Add Film Grain
                      </button>
                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) {
                          pauseViewerPlayback();
                          addEffectToClip(selectedClipId, { id: `fx_${Date.now()}`, type: "vignette", enabled: true, order: 0, maskIds: [], keyframes: {}, params: { intensity: 0.5, radius: 0.7, feather: 0.4 } });
                          showToast("Vignette added");
                        }
                      }}>
                        🔵 Add Vignette
                      </button>
                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) {
                          pauseViewerPlayback();
                          addEffectToClip(selectedClipId, { id: `fx_${Date.now()}`, type: "chromatic_aberration", enabled: true, order: 0, maskIds: [], keyframes: {}, params: { amount: 3 } });
                          showToast("Chromatic aberration added");
                        }
                      }}>
                        🌈 Chromatic Aberration
                      </button>
                      <div className="ai-qdrop-sep" />
                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) { openFusion(selectedClipId); setActivePage("fusion"); }
                      }}>
                        ⬡ Open in Fusion
                      </button>
                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        setActivePage("color");
                      }}>
                        🎨 Open in Color
                      </button>
                      <div className="ai-qdrop-sep" />
                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        setFlowstatePanelOpen(true);
                      }}>
                        ✨ FlowState AI
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Storyboard view (toggle with G key) */}
            {storyboardOpen && (
              <div style={{ height: 160, borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
                <StoryboardView
                  trackLayouts={trackLayouts}
                  selectedClipId={selectedClipId}
                  playheadFrame={playback.playheadFrame}
                  sequenceFps={project.sequence.settings.fps}
                  onSelectClip={selectClip}
                  onSeekToFrame={handleSeek}
                  onDeleteClip={(clipId) => { pauseViewerPlayback(); removeClipById(clipId); }}
                  onDuplicateClip={(clipId) => { pauseViewerPlayback(); duplicateClip(clipId); }}
                  onSplitClip={(clipId, frame) => { pauseViewerPlayback(); splitClipAtFrame(clipId, frame); }}
                  onReorderClips={reorderClips}
                />
              </div>
            )}

            {/* Precision Trim Panel */}
            {trimPanelOpen && activePage === 'edit' && (
              <PrecisionTrimPanel
                project={project}
                fps={project.sequence.settings.fps}
                selectedClipId={selectedClipId}
                onRippleTrim={rippleTrim}
                onRollTrim={rollTrim}
                onSlip={slip}
                onSlide={slide}
                onClose={() => setTrimPanelOpen(false)}
              />
            )}

            {/* Timeline */}
            <TimelinePanel
              trackLayouts={trackLayouts}
              selectedClipId={selectedClipId}
              toolMode={toolMode}
              playheadFrame={playback.playheadFrame}
              suggestedCutFrames={voiceSuggestedCutFrames}
              markInFrame={voiceMarkInFrame}
              markOutFrame={voiceMarkOutFrame}
              totalFrames={totalFrames}
              sequenceFps={project.sequence.settings.fps}
              onSetPlayheadFrame={handleSeek}
              onSelectClip={selectClip}
              onMoveClipTo={(clipId, trackId, frame) => { pauseViewerPlayback(); moveClipTo(clipId, trackId, frame); }}
              onTrimClipStart={(clipId, trim) => { pauseViewerPlayback(); trimClipStart(clipId, trim); }}
              onTrimClipEnd={(clipId, trim) => { pauseViewerPlayback(); trimClipEnd(clipId, trim); }}
              onBladeCut={(clipId, frame) => { pauseViewerPlayback(); splitClipAtFrame(clipId, frame); }}
              onDropAsset={(assetId, trackId, frame) => { pauseViewerPlayback(); dropAssetAtFrame(assetId, trackId, frame); }}
              onUpdateTrack={(trackId, updates) => updateTrack(trackId, updates)}
              onSetTransitionDuration={(clipId, edge, dur) => {
                pauseViewerPlayback();
                setTransitionMessage(setSelectedClipTransitionDuration(edge, dur));
              }}
              onDeleteClip={(clipId) => { pauseViewerPlayback(); removeClipById(clipId); }}
              onDuplicateClip={(clipId) => { pauseViewerPlayback(); duplicateClip(clipId); }}
              onSplitClip={(clipId, frame) => { pauseViewerPlayback(); splitClipAtFrame(clipId, frame); }}
              onToggleClipEnabled={(clipId) => { pauseViewerPlayback(); toggleClipEnabled(clipId); }}
              onDetachLinkedClips={(clipId) => { pauseViewerPlayback(); detachLinkedClips(clipId); }}
              onRelinkClips={(clipId) => { pauseViewerPlayback(); relinkClips(clipId); }}
              onSetClipSpeed={(clipId, spd) => setClipSpeed(clipId, spd)}
              onAddFade={(clipId, edge) => {
                pauseViewerPlayback();
                selectClip(clipId);
                setTransitionMessage(applyTransitionToSelectedClip(edge, "fade"));
              }}
              onOpenInFusion={(clipId) => {
                selectClip(clipId);
                openFusion(clipId);
                setActivePage("fusion");
              }}
              onAddTrack={(kind) => addTrack(kind)}
              onRemoveTrack={(trackId) => removeTrack(trackId)}
              onRenameTrack={(trackId, name) => updateTrack(trackId, { name })}
              onDuplicateTrack={(trackId) => duplicateTrack(trackId)}
              onAddTracksAndMoveClip={(clipId, frame, idx) => { pauseViewerPlayback(); addTracksAndMoveClip(clipId, frame, idx); }}
              onAddTracksAndDropAsset={(assetId, frame, idx) => { pauseViewerPlayback(); addTracksAndDropAsset(assetId, frame, idx); }}
              onReorderTrack={(trackId, toIndex) => reorderTrack(trackId, toIndex)}
              onRegisterZoomControls={(ctrls) => { timelineZoomRef.current = ctrls; }}
              onDropTransition={(clipId, transType, edge) => {
                selectClip(clipId);
                const msg1 = setSelectedClipTransitionType(edge, transType as import("../shared/models").ClipTransitionType);
                setTransitionMessage(msg1);
                updateFromTransition(transType);
              }}
              assets={project.assets}
              markers={project.sequence.markers}
              onAddMarker={(frame) => addMarker({ frame, label: "", color: "#f7c948" })}
              onRemoveMarker={(id) => removeMarker(id)}
              onUpdateMarker={(id, updates) => updateMarker(id, updates)}
              onAddKeyframe={(clipId, property, frame, value) => addKeyframe(clipId, property, frame, value)}
              fixedPlayheadMode={fixedPlayheadMode}
              onToggleFixedPlayheadMode={toggleFixedPlayheadMode}
              onAutoLayout={autoLayoutTimeline}
              onNestClips={(clipIds, label) => nestSelectedClips(clipIds, label)}
              onSaveClipSnapshot={(clipId, label) => saveClipSnapshot(clipId, label)}
              onRestoreClipSnapshot={(clipId, snapshotId) => restoreClipSnapshot(clipId, snapshotId)}
              clipHistoryMap={Object.fromEntries(project.sequence.clips.filter(c => c.clipHistory && c.clipHistory.length > 0).map(c => [c.id, c.clipHistory!]))}
              onAddAdjustmentLayer={addAdjustmentLayer}
              onGenerateBRollForGap={(_start, _end) => { setAiToolsPanelOpen(true); }}
              onGenerateBRollForClip={(clipId) => {
                selectClip(clipId);
                setAiToolsPanelOpen(true);
              }}
              renderCacheEntries={renderCache.entries}
              renderingSegments={renderCache.renderingSegments}
            />

            {/* Audio Mixer Panel */}
            {mixerOpen && (
              <AudioMixerPanel
                tracks={project.sequence.tracks}
                masterVolume={project.sequence.settings.masterVolume ?? 1}
                audioEngineRef={audioEngineRef}
                onUpdateTrack={(trackId, updates) => updateTrack(trackId, updates)}
                onUpdateMasterVolume={(vol) => updateSequenceSettings({ masterVolume: vol })}
                onClose={() => {
                  setMixerOpen(false);
                  try { localStorage.setItem("264pro_mixer_open", "false"); } catch {}
                }}
              />
            )}
            </div>{/* /timeline-area-wrapper */}
          </>
        )}

        {/* ── COLOR PAGE ── */}
        {activePage === "color" && (
          <>
            {/* Left: Color grading controls */}
            <div className="color-page-grading">
              <ColorGradingPanel
                selectedSegment={inspectorSegment}
                colorGrade={inspectorSegment?.clip.colorGrade ?? null}
                videoRef={colorPageVideoRef}
                onEnableGrade={() => {
                  if (selectedClipId) enableColorGrade(selectedClipId);
                }}
                onUpdateGrade={(grade) => {
                  if (selectedClipId) {
                    setColorGrade(selectedClipId, grade);
                    updateFromGrade(grade);
                  }
                }}
                onResetGrade={() => {
                  if (selectedClipId) resetColorGrade(selectedClipId);
                }}
                onAutoColorMatch={() => {
                  autoColorMatch();
                  toast.success("🎨 Auto Color Match applied to all clips");
                }}
                colorStills={project.colorStills ?? []}
                selectedClipId={selectedClipId}
                onAddColorStill={addColorStill}
                onRemoveColorStill={removeColorStill}
                onRenameColorStill={renameColorStill}
              />
              {/* Open in Fusion button */}
              {selectedClipId && (
                <div style={{ padding: "8px 10px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <button
                    style={{ width: "100%", padding: "6px", background: "rgba(245,197,66,0.1)", border: "1px solid rgba(245,197,66,0.3)", color: "#f5c542", borderRadius: "4px", cursor: "pointer", fontSize: "0.73rem", fontWeight: 700 }}
                    onClick={() => { openFusion(selectedClipId); setActivePage("fusion"); }}
                  >
                    ⬡ Open in Fusion
                  </button>
                </div>
              )}
            </div>

            {/* Resizer between controls and viewer */}
            <div
              className="panel-resizer left-resizer"
              onMouseDown={(e) => { e.preventDefault(); setResizeSide("left"); }}
              role="separator"
            />

            {/* Right: Viewer — shows the INSPECTED/SELECTED clip with its live grade */}
            <div className="color-page-viewer">
              <ViewerPanel
                ref={viewerPanelRef}
                activeSegment={inspectorSegment ?? activeSegment}
                activeAudioSegment={activeAudioSegment}
                segments={segments}
                selectedAsset={selectedAsset}
                playheadFrame={playback.playheadFrame}
                totalFrames={totalFrames}
                sequenceFps={project.sequence.settings.fps}
                isPlaying={playback.isPlaying}
                toolMode={toolMode}
                colorGrade={inspectorSegment?.clip.colorGrade ?? activeSegment?.clip.colorGrade ?? null}
                clipEffects={inspectorSegment?.clip.effects ?? activeSegment?.clip.effects ?? null}
                activeMaskTool="none"
                selectedMaskId={null}
                onAddMask={() => {}}
                onUpdateMask={() => {}}
                onSelectMask={() => {}}
                onSetPlaybackPlaying={setPlaybackPlaying}
                onSetToolMode={setToolMode}
                onToggleBladeTool={toggleBladeTool}
                onSplitAtPlayhead={splitSelectedClipAtPlayhead}
                onSetPlayheadFrame={setPlayheadFrame}
                onStepFrames={handleStepFrames}
              />
              {/* Professional Video Scopes — live pixel data via Canvas2D */}
              <div className="color-scopes-strip">
                <VideoScopesPanel videoRef={colorPageVideoRef} width={300} height={160} refreshMs={150} />
              </div>
            </div>

            {/* Bottom: Timeline */}
            <div className="color-page-timeline">
              {/* UX 4: Smart Suggestions Bar */}
              <SmartSuggestionsBar
                segments={segments}
                selectedClipId={selectedClipId}
                onNormalizeWhiteBalance={(clipId) => {
                  setColorGrade(clipId, { temperature: 0, tint: 0 });
                  toast.info("White balance normalized");
                }}
                onRecoverHighlights={(clipId) => {
                  setColorGrade(clipId, { exposure: -0.5, gain: { r: -0.02, g: -0.02, b: -0.02 } });
                  toast.info("Highlight recovery applied");
                }}
                onCompressAudio={() => {
                  project.sequence.clips.filter(c => {
                    const track = project.sequence.tracks.find(t => t.id === c.trackId);
                    return track?.kind === "audio" && c.volume > 1.3;
                  }).forEach(c => setClipVolume(c.id, 1.0));
                  toast.info("Audio peaks compressed to unity");
                }}
                onAutoColorGrade={(clipId) => {
                  enableColorGrade(clipId);
                  setColorGrade(clipId, { saturation: 1.1, contrast: 0.1, exposure: 0.05 });
                  toast.info("Auto color grade applied");
                }}
              />
              <TimelinePanel
                trackLayouts={trackLayouts}
                selectedClipId={selectedClipId}
                toolMode={toolMode}
                playheadFrame={playback.playheadFrame}
                suggestedCutFrames={[]}
                markInFrame={null}
                markOutFrame={null}
                totalFrames={totalFrames}
                sequenceFps={project.sequence.settings.fps}
                onSetPlayheadFrame={handleSeek}
                onSelectClip={selectClip}
                onMoveClipTo={(clipId, trackId, frame) => { pauseViewerPlayback(); moveClipTo(clipId, trackId, frame); }}
                onTrimClipStart={(clipId, trim) => { pauseViewerPlayback(); trimClipStart(clipId, trim); }}
                onTrimClipEnd={(clipId, trim) => { pauseViewerPlayback(); trimClipEnd(clipId, trim); }}
                onBladeCut={(clipId, frame) => { pauseViewerPlayback(); splitClipAtFrame(clipId, frame); }}
                onDropAsset={(assetId, trackId, frame) => { pauseViewerPlayback(); dropAssetAtFrame(assetId, trackId, frame); }}
                onUpdateTrack={(trackId, updates) => updateTrack(trackId, updates)}
                onSetTransitionDuration={(clipId, edge, dur) => {
                  pauseViewerPlayback();
                  setTransitionMessage(setSelectedClipTransitionDuration(edge, dur));
                }}
                onDeleteClip={(clipId) => { pauseViewerPlayback(); removeClipById(clipId); }}
                onDuplicateClip={(clipId) => { pauseViewerPlayback(); duplicateClip(clipId); }}
                onSplitClip={(clipId, frame) => { pauseViewerPlayback(); splitClipAtFrame(clipId, frame); }}
                onToggleClipEnabled={(clipId) => { pauseViewerPlayback(); toggleClipEnabled(clipId); }}
                onDetachLinkedClips={(clipId) => { pauseViewerPlayback(); detachLinkedClips(clipId); }}
                onRelinkClips={(clipId) => { pauseViewerPlayback(); relinkClips(clipId); }}
                onSetClipSpeed={(clipId, spd) => setClipSpeed(clipId, spd)}
                onAddFade={(clipId, edge) => {
                  pauseViewerPlayback();
                  selectClip(clipId);
                  setTransitionMessage(applyTransitionToSelectedClip(edge, "fade"));
                }}
                onOpenInFusion={(clipId) => {
                  selectClip(clipId);
                  openFusion(clipId);
                  setActivePage("fusion");
                }}
                onAddTrack={(kind) => addTrack(kind)}
              onRemoveTrack={(trackId) => removeTrack(trackId)}
              onRenameTrack={(trackId, name) => updateTrack(trackId, { name })}
              onDuplicateTrack={(trackId) => duplicateTrack(trackId)}
              onAddTracksAndMoveClip={(clipId, frame, idx) => { pauseViewerPlayback(); addTracksAndMoveClip(clipId, frame, idx); }}
              onAddTracksAndDropAsset={(assetId, frame, idx) => { pauseViewerPlayback(); addTracksAndDropAsset(assetId, frame, idx); }}
              onReorderTrack={(trackId, toIndex) => reorderTrack(trackId, toIndex)}
              onRegisterZoomControls={(ctrls) => { timelineZoomRef.current = ctrls; }}
              onDropTransition={(clipId, transType, edge) => {
                selectClip(clipId);
                const msg1 = setSelectedClipTransitionType(edge, transType as import("../shared/models").ClipTransitionType);
                setTransitionMessage(msg1);
              }}
              assets={project.assets}
              markers={project.sequence.markers}
              onAddMarker={(frame) => addMarker({ frame, label: "", color: "#f7c948" })}
              onRemoveMarker={(id) => removeMarker(id)}
              onUpdateMarker={(id, updates) => updateMarker(id, updates)}
              onAddKeyframe={(clipId, property, frame, value) => addKeyframe(clipId, property, frame, value)}
              fixedPlayheadMode={fixedPlayheadMode}
              onToggleFixedPlayheadMode={toggleFixedPlayheadMode}
              onAutoLayout={autoLayoutTimeline}
              onNestClips={(clipIds, label) => nestSelectedClips(clipIds, label)}
              onSaveClipSnapshot={(clipId, label) => saveClipSnapshot(clipId, label)}
              onRestoreClipSnapshot={(clipId, snapshotId) => restoreClipSnapshot(clipId, snapshotId)}
              clipHistoryMap={Object.fromEntries(project.sequence.clips.filter(c => c.clipHistory && c.clipHistory.length > 0).map(c => [c.id, c.clipHistory!]))}
              onAddAdjustmentLayer={addAdjustmentLayer}
              renderCacheEntries={renderCache.entries}
              renderingSegments={renderCache.renderingSegments}
              />
            </div>
          </>
        )}

        {/* ── AUDIO PAGE (ClawSound) ── */}
        {activePage === "audio" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <ClawSoundPanel
              tracks={project.sequence.tracks}
              fps={project.sequence.settings.fps}
              onUpdateTrack={(trackId, updates) => updateTrack(trackId, updates)}
              masterVolume={project.sequence.settings.masterVolume ?? 1}
              onSetMasterVolume={(v) => updateSequenceSettings({ masterVolume: v })}
              selectedClipId={selectedClipId}
              onNormalizeAudio={(targetDb) => {
                normalizeAudioLevels(targetDb);
                toast.success(`🎚 Audio normalized to ${targetDb} LUFS`);
              }}
              duckingSettings={project.duckingSettings}
              onSetDuckingSettings={setDuckingSettings}
              project={project}
            />
          </div>
        )}

        {/* ── PUBLISH PAGE ── */}
        {activePage === "publish" && (
          <ClawFlowPublishPanel
            projectName={project.name ?? "Untitled Project"}
            totalDurationSeconds={totalFrames / project.sequence.settings.fps}
            lastExportedPath={lastExportedPath}
            markers={project.sequence.markers}
            sequenceFps={project.sequence.settings.fps}
          />
        )}

        {/* ── FUSION PAGE ── */}
        {activePage === "fusion" && (() => {
          const fusClip = fusionClipId
            ? project.sequence.clips.find(c => c.id === fusionClipId) ?? null
            : (selectedClipId ? project.sequence.clips.find(c => c.id === selectedClipId) ?? null : null);
          const fusAsset = fusClip ? project.assets.find(a => a.id === fusClip.assetId) ?? null : null;
          return (
            <FusionPage
              clip={fusClip}
              asset={fusAsset}
              allClips={project.sequence.clips}
              sequenceSettings={project.sequence.settings}
              playheadFrame={playback.playheadFrame}
              videoRef={viewerVideoRef}
              onUpdateGraph={(clipId, graph) => setCompGraph(clipId, graph)}
              onBack={() => setActivePage("edit")}
              onGroupNodes={(nodeIds, label) => groupNodes(nodeIds, label)}
              compoundNodes={project.compoundNodes ?? []}
            />
          );
        })()}

      </main>

      {/* ── FLOWSTATE PANEL (slide-in overlay) ── */}
      <FlowStatePanel
        isOpen={flowstatePanelOpen}
        onClose={() => setFlowstatePanelOpen(false)}
        onAddImageToMediaPool={(imageUrl, name) => {
          const newAsset: import("../shared/models").MediaAsset = {
            id: `ai_img_${Date.now()}`,
            name,
            sourcePath: imageUrl,
            previewUrl: imageUrl,
            thumbnailUrl: imageUrl,
            durationSeconds: 0,
            width: 1024,
            height: 1024,
            nativeFps: 0,
            hasAudio: false,
          };
          importAssets([newAsset]);
          showToast("Image added to Media Pool");
        }}
      />

      {/* ── AI TOOLS PANEL (modal overlay) ── */}
      <AIToolsPanel
        isOpen={aiToolsPanelOpen}
        onClose={() => setAiToolsPanelOpen(false)}
      />

      {/* ── FOLLOW FOR FREEBIE MODAL ── */}
      {showFollowFreebie && (
        <FollowForFreebie
          onClose={() => setShowFollowFreebie(false)}
          aiCredits={aiCredits}
          onAddCredits={addAICredits}
        />
      )}

      {/* ── CLAWBOT DRAWER ── */}
      {clawbotOpen && (
        <div style={{
          position: "fixed", top: 60, right: 0, bottom: 0, width: 300,
          background: "#0d1117", borderLeft: "1px solid rgba(255,255,255,0.1)",
          display: "flex", flexDirection: "column", zIndex: 800,
          boxShadow: "-8px 0 24px rgba(0,0,0,0.4)",
        }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>🤖 Clawbot</span>
            <span style={{ fontSize: 11, color: "#64748b", flex: 1 }}>Your AI editing assistant</span>
            <button onClick={() => setClawbotOpen(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16 }}>✕</button>
          </div>
          <div style={{ padding: "10px 14px", flex: 1, overflowY: "auto" }}>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10, fontStyle: "italic" }}>"What should I work on?"</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {[
                { label: "Analyze my timeline", action: () => analyzeTimeline() },
                { label: "Suggest color grade", action: () => { setClawbotSuggestions(["🎨 Try a teal & orange grade for cinematic look", "💡 Boost contrast by 0.2 for punchy shadows", "🌡️ Warm up shadows slightly (+8 temp)"]); } },
                { label: "Fix audio levels", action: () => { setClawbotSuggestions(["🎚 Set all audio tracks to -6dB for headroom", "🔊 A1 track is peaking — reduce volume to 80%", "🎙️ Use compressor (4:1 ratio) on voice tracks"]); } },
                { label: "Generate B-roll ideas", action: () => { setClawbotSuggestions(["📸 Cut-away shots of hands typing", "🌆 Establishing cityscape b-roll at 1.5s each", "🔄 Insert reaction shots between interview cuts"]); } },
                { label: "Write captions from audio", action: () => { setSubtitlesPanelOpen(true); setClawbotOpen(false); } },
              ].map(item => (
                <button key={item.label} onClick={item.action} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#e2e8f0", fontSize: 12, cursor: "pointer", textAlign: "left" }}>
                  {item.label}
                </button>
              ))}
            </div>
            {clawbotSuggestions.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: "0.08em", marginBottom: 8 }}>SUGGESTIONS</div>
                {clawbotSuggestions.map((s, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#cbd5e1", padding: "6px 10px", marginBottom: 4, background: "rgba(255,255,255,0.04)", borderRadius: 6 }}>
                    {s}
                  </div>
                ))}
              </div>
            )}

            {/* Revenue-aware suggestions (Phase 6) */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", letterSpacing: "0.08em", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                <span>⚡</span> CLAWFLOW POWER MOVES
              </div>
              {[
                { text: "Auto-match all clip exposures", action: () => { autoColorMatch(); toast.success("🎨 Auto Color Match applied"); } },
                { text: "Normalize audio to -14 LUFS (streaming)", action: () => { normalizeAudioLevels(-14); toast.success("🎚 Audio normalized to -14 LUFS"); } },
                { text: "Detect beats + auto-cut to music", action: () => { setBeatSyncOpen(true); setClawbotOpen(false); } },
                { text: "Auto-Reframe clip to 9:16 / TikTok", action: () => { setAutoReframeOpen(true); setClawbotOpen(false); } },
                { text: "Close all timeline gaps", action: () => { closeAllGaps(); toast.success("✅ All gaps closed"); } },
              ].map(item => (
                <button
                  key={item.text}
                  type="button"
                  onClick={item.action}
                  style={{ width: "100%", marginBottom: 4, padding: "7px 10px", borderRadius: 7, border: "1px solid rgba(124,58,237,0.3)", background: "rgba(124,58,237,0.08)", color: "#c4b5fd", fontSize: 11, cursor: "pointer", textAlign: "left" }}
                >
                  ⚡ {item.text}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#ec4899", letterSpacing: "0.08em", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                <span>🎬</span> ENHANCE WITH HIGGSFIELD AI
              </div>
              {[
                { text: "Generate a cinematic AI intro", prompt: "Cinematic film intro, dramatic lighting, slow motion reveal" },
                { text: "Generate B-roll for talking head", prompt: "Relevant b-roll footage to accompany interview, professional setting" },
                { text: "Generate abstract transition", prompt: "Abstract purple particles forming a logo, looping, dark background" },
              ].map(item => (
                <button
                  key={item.text}
                  type="button"
                  onClick={() => { setAiToolsPanelOpen(true); setClawbotOpen(false); }}
                  style={{ width: "100%", marginBottom: 4, padding: "7px 10px", borderRadius: 7, border: "1px solid rgba(236,72,153,0.3)", background: "rgba(236,72,153,0.08)", color: "#f9a8d4", fontSize: 11, cursor: "pointer", textAlign: "left" }}
                >
                  🎬 {item.text}
                </button>
              ))}
            </div>
          </div>
          <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 10, color: "#475569" }}>
            Ctrl+Shift+A to toggle · Cmd+, for Settings
          </div>
        </div>
      )}

      {/* ── SUBTITLES PANEL (slide-in from bottom-right) ── */}
      {subtitlesPanelOpen && (
        <div style={{
          position: "fixed", right: 0, bottom: 0, width: 420, height: 480,
          background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "12px 0 0 0", zIndex: 800,
          boxShadow: "-8px -8px 24px rgba(0,0,0,0.4)",
          display: "flex", flexDirection: "column",
        }}>
          <SubtitlesPanel
            cues={subtitleCues}
            playheadFrame={playback.playheadFrame}
            fps={project.sequence.settings.fps}
            onAddCue={handleAddSubtitleCue}
            onUpdateCue={handleUpdateSubtitleCue}
            onRemoveCue={handleRemoveSubtitleCue}
            onSeekToFrame={(frame) => setPlayheadFrame(frame)}
            project={project}
          />
          <button
            onClick={() => setSubtitlesPanelOpen(false)}
            style={{ position: "absolute", top: 10, right: 12, background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16 }}
          >✕</button>
        </div>
      )}

      {/* ── TITLE GENERATOR PANEL ── */}
      {titleGenPanelOpen && (
        <div style={{
          position: "fixed", right: 0, top: 60, width: 280, bottom: 0,
          background: "#0d1117", borderLeft: "1px solid rgba(255,255,255,0.1)",
          zIndex: 800, boxShadow: "-8px 0 24px rgba(0,0,0,0.4)",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ position: "absolute", top: 10, right: 12 }}>
            <button onClick={() => setTitleGenPanelOpen(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16 }}>✕</button>
          </div>
          <TitleGeneratorPanel
            fps={project.sequence.settings.fps}
            onAddTitleToTimeline={handleAddTitleToTimeline}
          />
        </div>
      )}

      {/* ── KEYBOARD SHORTCUTS PANEL ── */}
      {shortcutsPanelOpen && (
        <ShortcutsPanel onClose={() => setShortcutsPanelOpen(false)} />
      )}

      {/* ── PROJECT TEMPLATE MODAL (UX 5) ── */}
      {templateModalOpen && (
        <ProjectTemplateModal
          onClose={() => setTemplateModalOpen(false)}
          onSelect={(tmpl: ProjectTemplate) => {
            const { tracks, markers, settings } = instantiateTemplate(tmpl);
            const base = createEmptyProject();
            const newProject = {
              ...base,
              name: `${tmpl.label} Project`,
              sequence: {
                ...base.sequence,
                tracks,
                markers,
                settings: { ...base.sequence.settings, ...settings },
              }
            };
            loadProjectFromData(newProject);
            setProjectDirty(false);
            toast.success(`New ${tmpl.label} project created!`);
          }}
        />
      )}

      {/* ── PROJECT NOTES PANEL (GAP B) ── */}
      {projectNotesPanelOpen && (
        <ProjectNotesPanel
          metadata={project.metadata ?? {}}
          projectName={project.name}
          onUpdate={(updates) => updateProjectMetadata(updates)}
          onClose={() => setProjectNotesPanelOpen(false)}
        />
      )}

      {/* ── MULTICAM PANEL (GAP C) ── */}
      {multicamOpen && (
        <MulticamPanel
          segments={segments}
          playheadFrame={playback.playheadFrame}
          sequenceFps={project.sequence.settings.fps}
          onCutToAngle={(clipId, _trackId, frame) => {
            selectClip(clipId);
            setPlayheadFrame(frame);
            toast.info(`Cut to angle at frame ${frame}`);
          }}
          onSyncByAudio={(clipIds, offsets) => {
            syncMulticamClips(clipIds, offsets);
            toast.success(`🎵 Synced ${clipIds.length} angles by audio`);
          }}
          onClose={() => setMulticamOpen(false)}
        />
      )}

      {/* ── AUTO-RESIZE PANEL (EXCLUSIVE 2) ── */}
      {autoResizeOpen && (
        <AutoResizePanel
          projectName={project.name}
          onAddBatchJobs={(jobs) => {
            const newJobs = jobs.map(j => ({
              id: createId(),
              label: j.label,
              codec: j.codec,
              outputWidth: j.outputWidth,
              outputHeight: j.outputHeight,
              status: "queued" as const,
              progress: 0,
              createdAt: Date.now(),
            }));
            setRenderJobs(prev => [...prev, ...newJobs]);
            setRenderQueueOpen(true);
            toast.success(`Added ${newJobs.length} batch export jobs to Render Queue`);
          }}
          onClose={() => setAutoResizeOpen(false)}
        />
      )}

      {/* ── AI STORYBOARD PANEL (EXCLUSIVE 1) ── */}
      {aiStoryboardOpen && (
        <AIStoryboardPanel
          fps={project.sequence.settings.fps}
          onCreateTimeline={({ tracks, clips, markers, assets: newAssets }) => {
            newAssets.forEach(a => addAssetToPoolStore(a));
            const base = createEmptyProject();
            const newProject = {
              ...project,
              assets: [...project.assets, ...newAssets],
              sequence: {
                ...project.sequence,
                tracks: [...project.sequence.tracks, ...tracks],
                clips: [...project.sequence.clips, ...clips],
                markers: [...project.sequence.markers, ...markers],
              }
            };
            loadProjectFromData(newProject);
            toast.success("AI Storyboard applied to timeline!");
          }}
          onClose={() => setAiStoryboardOpen(false)}
        />
      )}

      {/* ── SHOT LIST PANEL (EXCLUSIVE 3) ── */}
      {shotListOpen && (
        <ShotListPanel
          fps={project.sequence.settings.fps}
          existingMarkers={project.sequence.markers}
          onAddMarkers={(markers) => {
            markers.forEach(m => addMarker(m));
            toast.success(`Added ${markers.length} scene markers from shot list`);
          }}
          onClose={() => setShotListOpen(false)}
        />
      )}

      {/* ── BEAT SYNC PANEL (Phase 5) ── */}
      {beatSyncOpen && (
        <div style={{ position: "fixed", bottom: 80, right: 16, zIndex: 5100 }}>
          <BeatSyncPanel
            audioTracks={project.sequence.tracks.filter(t => t.kind === "audio")}
            assets={project.assets}
            fps={project.sequence.settings.fps}
            onAddMarkers={(markers) => {
              markers.forEach(m => addMarker(m));
              toast.success(`🥁 Added ${markers.length} beat markers`);
            }}
            onSplitClipsAtBeats={(beatFrames) => {
              splitClipsAtBeats(beatFrames);
              toast.success(`✂️ Auto-cut ${beatFrames.length} beats`);
            }}
            onClose={() => setBeatSyncOpen(false)}
          />
        </div>
      )}

      {/* ── AUTO-REFRAME PANEL ── */}
      {autoReframeOpen && (
        <div style={{ position: "fixed", top: 80, right: 320, zIndex: 5100 }}>
          <AutoReframePanel
            assets={project.assets}
            onAddAsset={(asset) => importAssets([asset])}
            onClose={() => setAutoReframeOpen(false)}
          />
        </div>
      )}

      {/* ── TEXT-BASED EDITING PANEL ── */}
      {textEditPanelOpen && (
        <TextBasedEditingPanel
          assets={project.assets}
          transcripts={project.transcripts ?? {}}
          playheadFrame={playback.playheadFrame}
          sequenceFps={project.sequence.settings.fps}
          isPlaying={playback.isPlaying}
          onSetTranscript={setTranscript}
          onSetPlayheadFrame={setPlayheadFrame}
          onAddClipToTimeline={handleAddClipFromTranscript}
          onClose={() => setTextEditPanelOpen(false)}
        />
      )}

      {/* ── Image-to-Video Modal ── */}
      {renderImageToVideoModal()}

      {/* ── Image Gen Modal ── */}
      {renderImageGenModal()}

      {/* ── CLAW Video First-Launch Promo ── */}
      {showClawPromo && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.72)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'linear-gradient(160deg,#1a0a2e 0%,#0f1a2e 60%,#0a1a1f 100%)',
            border: '1px solid rgba(168,85,247,.4)',
            borderRadius: 20,
            padding: '32px 28px',
            maxWidth: 440,
            width: '90%',
            boxShadow: '0 24px 80px rgba(0,0,0,.6), 0 0 60px rgba(168,85,247,.12)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>🎬</div>
            <div style={{
              fontSize: 22, fontWeight: 800, marginBottom: 8,
              background: 'linear-gradient(135deg,#a855f7,#06b6d4)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              Create AI Videos with CLAW
            </div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)', marginBottom: 22, lineHeight: 1.6 }}>
              CLAW is your Production Director AI. It generates concepts, shot lists, and full music videos — then sends them straight into your 264 Pro timeline.
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              {[
                { icon: '✦', label: 'Concept generation' },
                { icon: '🎞', label: 'Shot list builder' },
                { icon: '🤖', label: 'AI video render' },
              ].map(f => (
                <div key={f.label} style={{
                  flex: 1, background: 'rgba(168,85,247,.08)',
                  border: '1px solid rgba(168,85,247,.2)',
                  borderRadius: 10, padding: '8px 6px',
                  fontSize: 11, color: 'rgba(255,255,255,0.7)',
                }}>
                  <div style={{ fontSize: 16, marginBottom: 4 }}>{f.icon}</div>
                  {f.label}
                </div>
              ))}
            </div>
            <button
              onClick={() => dismissClawPromo(true)}
              style={{
                width: '100%', padding: '13px 0', borderRadius: 12,
                border: 'none', marginBottom: 10,
                background: 'linear-gradient(135deg,#a855f7,#06b6d4)',
                color: '#fff', fontSize: 15, fontWeight: 800,
                cursor: 'pointer', letterSpacing: 0.3,
              }}
            >
              Create Video with CLAW →
            </button>
            <button
              onClick={() => dismissClawPromo(false)}
              style={{
                width: '100%', padding: '9px 0', borderRadius: 10,
                border: '1px solid rgba(255,255,255,.1)',
                background: 'transparent',
                color: 'rgba(255,255,255,0.45)', fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Skip for now
            </button>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 10 }}>
              This message won't appear again
            </div>
          </div>
        </div>
      )}

      {/* ── ONBOARDING MODAL (Phase 6) ── */}
      <OnboardingModal
        onFinish={() => {/* already handled internally */}}
        onOpenClawFlow={() => { setClawbotOpen(true); setActivePage("edit"); }}
        onOpenHiggsfield={() => setAiToolsPanelOpen(true)}
        onOpenColor={() => setActivePage("color")}
        onOpenAudio={() => setActivePage("audio")}
        onOpenExport={() => setRenderQueueOpen(true)}
      />

      {/* ── SETTINGS PANEL (Phase 6) ── */}
      {settingsPanelOpen && (
        <SettingsPanel onClose={() => setSettingsPanelOpen(false)} />
      )}

      {/* ── Phase 9: Style Profile Panel ── */}
      {styleProfileOpen && (
        <StyleProfilePanel
          onClose={() => setStyleProfileOpen(false)}
          onApplyStyle={(grade) => {
            // Apply learned style to all ungraded clips
            project.sequence.clips.forEach((clip) => {
              const cg = clip.colorGrade;
              if (!cg || (cg.exposure === 0 && cg.contrast === 0)) {
                setColorGrade(clip.id, grade);
              }
            });
            toast.success("✨ Applied your style profile to ungraded clips");
            setStyleProfileOpen(false);
          }}
        />
      )}

      {/* ── Phase 9: Project Intelligence Panel ── */}
      {intelligenceOpen && (
        <ProjectIntelligencePanel
          project={project}
          fps={project.sequence.settings.fps}
          onClose={() => setIntelligenceOpen(false)}
          onAutoFixAll={() => {
            autoColorMatch();
            normalizeAudioLevels(-14);
            closeAllGaps();
            toast.success("🔧 Auto-fix applied: color match + normalize + close gaps");
          }}
          onGoToPublish={() => { setActivePage("publish"); setIntelligenceOpen(false); }}
          onAutoColorMatch={autoColorMatch}
          onNormalizeAudio={() => normalizeAudioLevels(-14)}
          onCloseGaps={closeAllGaps}
        />
      )}
    </div>
  );
}
