import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuthGate, AuthGateModal, AuthGateWrapper, type RequiredAccess } from "./AuthGateModal";
import { useEditorStore } from "../store/editorStore";
import { notifyToolUsed } from "../lib/projectMemoryBridge";

// ── Types ─────────────────────────────────────────────────────────────────────
type PanelTab = "enhance" | "generate";

type AITool =
  | "upscale"
  | "face_enhance"
  | "slow_mo"
  | "rotoscope"
  | "colorize"
  | "depth_map"
  | "video_denoise"
  | "video_upscale"
  | "object_remove";

type VideoGenModel =
  | "seedance_t2v"
  | "seedance_i2v"
  | "higgsfield_t2v"
  | "higgsfield_i2v"
  | "nano_banana_2k"
  | "nano_banana_4k"
  | "wan_t2v"
  | "wan_i2v";

interface VideoGenModelDef {
  id: VideoGenModel;
  label: string;
  provider: string;
  providerColor: string;
  badge: string;
  badgeColor: string;
  icon: string;
  desc: string;
  mode: "t2v" | "i2v";
  maxDuration: number;
  resolutions: string[];
  aspectRatios: string[];
  features: string[];
  proOnly?: boolean;
}

const VIDEO_GEN_MODELS: VideoGenModelDef[] = [
  {
    id: "seedance_t2v",
    label: "Seedance 2.0",
    provider: "ByteDance × fal.ai",
    providerColor: "#06b6d4",
    badge: "TEXT → VIDEO",
    badgeColor: "#06b6d4",
    icon: "🎬",
    desc: "Director-level camera control, native audio, realistic physics. Up to 15s cinematic multi-shot video in one pass.",
    mode: "t2v",
    maxDuration: 15,
    resolutions: ["720p", "1080p"],
    aspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
    features: ["Native Audio", "Multi-shot", "Physics Engine", "Lip Sync"],
  },
  {
    id: "seedance_i2v",
    label: "Seedance 2.0",
    provider: "ByteDance × fal.ai",
    providerColor: "#06b6d4",
    badge: "IMAGE → VIDEO",
    badgeColor: "#3b82f6",
    icon: "🖼→🎬",
    desc: "Animate any still image into cinematic motion. Preserves your composition, adds physics + audio.",
    mode: "i2v",
    maxDuration: 10,
    resolutions: ["720p", "1080p"],
    aspectRatios: ["16:9", "9:16", "4:3", "1:1"],
    features: ["Image Reference", "Motion Control", "Audio Sync", "Character Lock"],
  },
  {
    id: "higgsfield_t2v",
    label: "Higgsfield ✦ Seedance 2.0",
    provider: "Higgsfield AI",
    providerColor: "#00d4ff",
    badge: "✦ HIGGSFIELD PRO",
    badgeColor: "#00d4ff",
    icon: "✦",
    desc: "Higgsfield's production pipeline powered by Seedance 2.0 — cinematic multi-shot, native audio, 100+ models. Pro members only.",
    mode: "t2v",
    maxDuration: 15,
    resolutions: ["720p", "1080p"],
    aspectRatios: ["16:9", "9:16", "4:3", "3:4"],
    features: ["Multi-Camera", "Native Audio", "100+ Models", "Pro Grade"],
    proOnly: true,
  },
  {
    id: "higgsfield_i2v",
    label: "Higgsfield ✦ Image→Video",
    provider: "Higgsfield AI",
    providerColor: "#00d4ff",
    badge: "✦ HIGGSFIELD PRO",
    badgeColor: "#00ffa3",
    icon: "✦",
    desc: "Higgsfield image-to-video — animate reference frames with character consistency, cinematic motion, native audio. Pro only.",
    mode: "i2v",
    maxDuration: 10,
    resolutions: ["720p", "1080p"],
    aspectRatios: ["16:9", "9:16", "4:3"],
    features: ["Character Lock", "Style Preserve", "Audio Sync", "Pro Only"],
    proOnly: true,
  },
  {
    id: "nano_banana_2k",
    label: "Nano Banana 2K",
    provider: "Gemini × fal.ai",
    providerColor: "#10b981",
    badge: "2K ULTRA",
    badgeColor: "#10b981",
    icon: "🍌",
    desc: "Nano Banana powered by Gemini — 2560×1440 ultra-resolution with silky motion synthesis and deep detail.",
    mode: "t2v",
    maxDuration: 10,
    resolutions: ["2K (2560×1440)"],
    aspectRatios: ["16:9", "9:16", "4:3", "1:1"],
    features: ["2K Resolution", "High Fidelity", "Gemini Powered", "Fast Gen"],
  },
  {
    id: "nano_banana_4k",
    label: "Nano Banana 4K",
    provider: "Gemini × fal.ai",
    providerColor: "#f59e0b",
    badge: "4K CINEMA",
    badgeColor: "#f59e0b",
    icon: "🍌✨",
    desc: "Nano Banana 4K — 3840×2160 cinematic ultra-resolution. The highest fidelity video generation available.",
    mode: "t2v",
    maxDuration: 10,
    resolutions: ["4K (3840×2160)"],
    aspectRatios: ["16:9", "9:16"],
    features: ["4K UHD", "Cinema Grade", "Max Quality", "Gemini Pro"],
  },
  {
    id: "wan_t2v",
    label: "Wan 2.6",
    provider: "Wan × fal.ai",
    providerColor: "#ec4899",
    badge: "TEXT → VIDEO",
    badgeColor: "#ec4899",
    icon: "🌊",
    desc: "Wan 2.6 — excellent character animation, smooth motion, 720p/1080p. Best for character-driven content.",
    mode: "t2v",
    maxDuration: 10,
    resolutions: ["720p", "1080p"],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3"],
    features: ["Character Animation", "Smooth Motion", "720p/1080p"],
  },
  {
    id: "wan_i2v",
    label: "Wan 2.6",
    provider: "Wan × fal.ai",
    providerColor: "#ec4899",
    badge: "IMAGE → VIDEO",
    badgeColor: "#db2777",
    icon: "🌊",
    desc: "Wan 2.6 image-to-video — animate your reference image with precise motion control.",
    mode: "i2v",
    maxDuration: 10,
    resolutions: ["720p", "1080p"],
    aspectRatios: ["16:9", "9:16", "4:3", "1:1"],
    features: ["Image Reference", "Motion Control", "Character Consistency"],
  },
];

// ── Clawbot Camera Motion Presets ─────────────────────────────────────────────
const CAMERA_PRESETS = [
  { label: "Slow dolly in", value: "Slow dolly in toward subject" },
  { label: "Tracking shot", value: "Smooth tracking shot following subject" },
  { label: "Orbit 360°", value: "360 degree orbit around subject" },
  { label: "Crane up", value: "Crane shot rising up dramatically" },
  { label: "Handheld", value: "Handheld camera movement, organic" },
  { label: "Dutch angle", value: "Dutch tilt camera angle" },
  { label: "Crash zoom", value: "Fast crash zoom toward subject" },
  { label: "Static wide", value: "Static wide angle establishing shot" },
];

const STYLE_PRESETS = [
  { label: "Cinematic", value: "cinematic film look, shallow depth of field, anamorphic lens" },
  { label: "4K HDR", value: "4K HDR, high dynamic range, vivid colors, sharp detail" },
  { label: "Music Video", value: "music video style, dynamic cuts, vibrant lighting, stylized" },
  { label: "Documentary", value: "documentary style, natural lighting, realistic" },
  { label: "Noir", value: "film noir, high contrast black and white, dramatic shadows" },
  { label: "Neon Cyberpunk", value: "neon cyberpunk, night city, rain reflections, glowing signs" },
  { label: "Golden Hour", value: "golden hour lighting, warm tones, lens flares" },
  { label: "Clean & Minimal", value: "clean minimal composition, neutral background, professional" },
];

type ToolStatus = "idle" | "running" | "polling" | "complete" | "error";

interface ToolResult {
  outputUrl?: string;
  outputBase64?: string;
  contentType?: string;
  predictionId?: string;
  message?: string;
  error?: string;
}

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS: Array<{
  id: AITool;
  label: string;
  icon: string;
  desc: string;
  inputType: "image" | "video" | "both";
  category: "quality" | "motion" | "creative" | "utility";
  params?: Array<{ key: string; label: string; type: "range" | "number" | "checkbox"; min?: number; max?: number; step?: number; defaultValue: number | boolean }>;
}> = [
  {
    id: "upscale",
    label: "AI Upscale",
    icon: "⬆",
    desc: "Real-ESRGAN — upscale to 4× with AI detail enhancement",
    inputType: "image",
    category: "quality",
    params: [
      { key: "scale", label: "Scale", type: "range", min: 2, max: 4, step: 1, defaultValue: 4 },
      { key: "faceEnhance", label: "Enhance Faces", type: "checkbox", defaultValue: false },
    ],
  },
  {
    id: "video_upscale",
    label: "Video Upscale",
    icon: "🎬",
    desc: "Upscale video frames to 4K using Real-ESRGAN",
    inputType: "video",
    category: "quality",
    params: [
      { key: "scale", label: "Scale", type: "range", min: 2, max: 4, step: 1, defaultValue: 2 },
    ],
  },
  {
    id: "face_enhance",
    label: "Face Enhance",
    icon: "😊",
    desc: "CodeFormer — restore and sharpen degraded faces",
    inputType: "image",
    category: "quality",
    params: [
      { key: "fidelity", label: "Fidelity", type: "range", min: 0, max: 1, step: 0.1, defaultValue: 0.7 },
      { key: "upscale", label: "Upscale ×", type: "number", min: 1, max: 4, defaultValue: 2 },
      { key: "backgroundEnhance", label: "Enhance BG", type: "checkbox", defaultValue: true },
    ],
  },
  {
    id: "slow_mo",
    label: "AI Slow-Mo",
    icon: "🐌",
    desc: "DAIN frame interpolation — buttery 2×–8× slow motion",
    inputType: "video",
    category: "motion",
    params: [
      { key: "multiplier", label: "Slowdown ×", type: "range", min: 2, max: 8, step: 2, defaultValue: 2 },
    ],
  },
  {
    id: "rotoscope",
    label: "Rotoscope / BG Remove",
    icon: "✂",
    desc: "rembg + SAM — remove background from any frame",
    inputType: "image",
    category: "creative",
  },
  {
    id: "colorize",
    label: "AI Colorize",
    icon: "🎨",
    desc: "DeOldify — add color to black & white footage",
    inputType: "image",
    category: "creative",
    params: [
      { key: "renderFactor", label: "Render Factor", type: "range", min: 10, max: 40, step: 5, defaultValue: 35 },
    ],
  },
  {
    id: "depth_map",
    label: "Depth Map",
    icon: "🌊",
    desc: "MiDaS — generate depth info for parallax & 3D effects",
    inputType: "image",
    category: "creative",
  },
  {
    id: "video_denoise",
    label: "Video Denoise",
    icon: "🔇",
    desc: "Temporal noise suppression for cleaner footage",
    inputType: "video",
    category: "quality",
  },
  {
    id: "object_remove",
    label: "Object Remove",
    icon: "🪄",
    desc: "LaMa inpainting — seamlessly remove unwanted objects",
    inputType: "image",
    category: "utility",
    params: [
      { key: "steps", label: "Quality Steps", type: "range", min: 15, max: 50, step: 5, defaultValue: 30 },
    ],
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  quality: "🔧 Quality Enhancement",
  motion: "⚡ Motion",
  creative: "🎨 Creative",
  utility: "🛠 Utility",
};

// AIToolsPanel uses flowstateAPI declared in FlowStatePanel.tsx (same global interface Window merge)
// All AI tools require ClawFlow — sign-in + subscription gated at click-time via AuthGateModal

// ── Main Component ─────────────────────────────────────────────────────────────
export interface InlineModeConfig {
  active: boolean;
  targetStartFrame: number;
  targetEndFrame: number;
  suggestedPrompt: string;
  suggestedDuration: number;
  onPlaced: (clipId: string) => void;
}

interface AIToolsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  inlineMode?: InlineModeConfig;
}

export function AIToolsPanel({ isOpen, onClose, inlineMode }: AIToolsPanelProps) {
  // Read selected clip from editor — auto-fills the media input
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedAssetId = useEditorStore((s) => s.selectedAssetId);
  const project = useEditorStore((s) => s.project);

  // ── Tab state ───────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<PanelTab>("generate");

  // ── Enhancement Tools state ─────────────────────────────────────────────────
  const [selectedTool, setSelectedTool] = useState<AITool>("upscale");
  const [inputUrl, setInputUrl] = useState("");
  const [inputFileName, setInputFileName] = useState<string | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, number | boolean>>({});
  const [status, setStatus] = useState<ToolStatus>("idle");
  const [result, setResult] = useState<ToolResult | null>(null);
  const [progress, setProgress] = useState(0);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Video Generation Studio state ───────────────────────────────────────────
  const [vgModel, setVgModel] = useState<VideoGenModel>("seedance_t2v");
  const [vgPrompt, setVgPrompt] = useState("");
  const [vgNegPrompt, setVgNegPrompt] = useState("");
  const [vgImageUrl, setVgImageUrl] = useState("");
  const [vgImageName, setVgImageName] = useState<string | null>(null);
  const [vgDuration, setVgDuration] = useState(5);
  const [vgResolution, setVgResolution] = useState("720p");
  const [vgAspectRatio, setVgAspectRatio] = useState("16:9");
  const [vgQuality, setVgQuality] = useState<"basic" | "high">("high");
  const [vgCameraMotion, setVgCameraMotion] = useState("");
  const [vgStyle, setVgStyle] = useState("");
  const [vgStatus, setVgStatus] = useState<ToolStatus>("idle");
  const [vgResult, setVgResult] = useState<{ videoUrl?: string; requestId?: string; provider?: string; message?: string; error?: string } | null>(null);
  const [vgProgress, setVgProgress] = useState(0);
  const vgPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const vgModelDef = VIDEO_GEN_MODELS.find((m) => m.id === vgModel)!;

  // Reset resolution/aspect when model changes
  useEffect(() => {
    setVgResolution(vgModelDef.resolutions[0]);
    setVgAspectRatio(vgModelDef.aspectRatios[0]);
    setVgDuration(Math.min(vgDuration, vgModelDef.maxDuration));
    if (vgModelDef.mode === "t2v") { setVgImageUrl(""); setVgImageName(null); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vgModel]);

  // ── Auth gate — shown when user clicks Run without access ───────────────────
  const { modal, checkAndRun, closeModal } = useAuthGate();

  const tool = TOOLS.find((t) => t.id === selectedTool)!;

  const getParam = (key: string, defaultValue: number | boolean) => {
    return paramValues[key] !== undefined ? paramValues[key] : defaultValue;
  };

  const setParam = (key: string, value: number | boolean) => {
    setParamValues((p) => ({ ...p, [key]: value }));
  };

  const runTool = useCallback(async () => {
    if (!inputUrl.trim()) return;
    setStatus("running");
    setResult(null);
    setProgress(0);

    // Record in Clawbot memory so it knows which enhancement tools this user runs
    notifyToolUsed(selectedTool);

    if (!window.flowstateAPI?.runAITool) {
      setStatus("error");
      setResult({ error: "Not running in Electron — AI tools require the desktop app." });
      return;
    }

    // Build params from current values
    const params: Record<string, unknown> = {};
    if (tool.params) {
      for (const p of tool.params) {
        params[p.key] = getParam(p.key, p.defaultValue);
      }
    }

    const options: { imageUrl?: string; videoUrl?: string; params: Record<string, unknown> } = { params };
    if (tool.inputType === "image" || tool.inputType === "both") options.imageUrl = inputUrl;
    if (tool.inputType === "video" || tool.inputType === "both") options.videoUrl = inputUrl;

    try {
      const res = (await window.flowstateAPI?.runAITool?.(selectedTool, options)) as any;

      if (res.error && !res.predictionId) {
        setStatus("error");
        setResult({ error: res.error, message: res.message });
        return;
      }

      if (res.status === "complete" && (res.outputUrl || res.outputBase64)) {
        setStatus("complete");
        setResult(res);
        return;
      }

      if (res.status === "queued" && res.predictionId) {
        setStatus("polling");
        setResult({ predictionId: res.predictionId, message: res.message });
        startPolling(res.predictionId);
        return;
      }

      // Fallback
      setStatus("error");
      setResult({ error: res.error || "Unknown response from AI tool." });
    } catch (e: any) {
      setStatus("error");
      setResult({ error: e.message });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTool, inputUrl, paramValues, tool]);

  const startPolling = (predId: string) => {
    let attempts = 0;
    const maxAttempts = 90; // 3 minutes

    const poll = async () => {
      if (attempts >= maxAttempts) {
        setStatus("error");
        setResult({ error: "Processing timed out. The job may still be running on Replicate — check back later." });
        return;
      }
      attempts++;
      setProgress(Math.min(95, (attempts / maxAttempts) * 100));

      if (!window.flowstateAPI?.pollAITool) return;
      const res = (await window.flowstateAPI.pollAITool(predId)) as any;

      if (res.status === "complete" && res.outputUrl) {
        setStatus("complete");
        setResult(res);
        return;
      }
      if (res.status === "error" || res.error) {
        setStatus("error");
        setResult({ error: res.error || "Processing failed." });
        return;
      }
      if (res.percent != null) setProgress(res.percent);

      pollRef.current = setTimeout(poll, 3000);
    };

    pollRef.current = setTimeout(poll, 3000);
  };

  const reset = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    setStatus("idle");
    setResult(null);
    setProgress(0);
  };

  // ── Video Generation — run ─────────────────────────────────────────────────
  const runVideoGen = useCallback(async () => {
    if (!vgPrompt.trim()) return;
    if (vgPollRef.current) clearTimeout(vgPollRef.current);
    setVgStatus("running");
    setVgResult(null);
    setVgProgress(0);

    // Record in Clawbot memory so it knows which video gen models this user runs
    notifyToolUsed(vgModel);

    if (!window.flowstateAPI?.generateVideo) {
      setVgStatus("error");
      setVgResult({ error: "Not running in Electron — video generation requires the desktop app." });
      return;
    }

    try {
      const res = (await window.flowstateAPI.generateVideo({
        model: vgModel,
        prompt: vgPrompt.trim(),
        imageUrl: vgModelDef.mode === "i2v" ? vgImageUrl || undefined : undefined,
        duration: vgDuration,
        resolution: vgResolution,
        aspectRatio: vgAspectRatio,
        quality: vgQuality,
        cameraMotion: vgCameraMotion || undefined,
        style: vgStyle || undefined,
        negativePrompt: vgNegPrompt || undefined,
      })) as any;

      if (res.error) {
        setVgStatus("error");
        setVgResult({ error: res.error });
        return;
      }
      if (res.status === "complete" && res.videoUrl) {
        setVgStatus("complete");
        setVgResult({ videoUrl: res.videoUrl });
        return;
      }
      if (res.status === "queued" && res.requestId) {
        setVgStatus("polling");
        setVgResult({ requestId: res.requestId, provider: res.provider, message: res.message });
        startVgPolling(res.requestId, res.provider || "fal");
        return;
      }
      setVgStatus("error");
      setVgResult({ error: res.error || "Unknown response from video generation." });
    } catch (e: any) {
      setVgStatus("error");
      setVgResult({ error: e.message });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vgModel, vgPrompt, vgNegPrompt, vgImageUrl, vgDuration, vgResolution, vgAspectRatio, vgQuality, vgCameraMotion, vgStyle]);

  const startVgPolling = (requestId: string, provider: string) => {
    let attempts = 0;
    const maxAttempts = 120; // 6 minutes

    const poll = async () => {
      if (attempts >= maxAttempts) {
        setVgStatus("error");
        setVgResult({ error: "Generation timed out. Your job may still be processing — try again or check your API dashboard." });
        return;
      }
      attempts++;
      setVgProgress(Math.min(92, (attempts / maxAttempts) * 100 + 5));

      if (!window.flowstateAPI?.pollVideoGen) return;
      const res = (await window.flowstateAPI.pollVideoGen(requestId, provider)) as any;

      if (res.status === "complete" && res.videoUrl) {
        setVgProgress(100);
        setVgStatus("complete");
        setVgResult({ videoUrl: res.videoUrl });
        return;
      }
      if (res.status === "error" || res.error) {
        setVgStatus("error");
        setVgResult({ error: res.error || "Generation failed." });
        return;
      }
      if (res.percent != null) setVgProgress(res.percent);

      vgPollRef.current = setTimeout(poll, 4000);
    };

    vgPollRef.current = setTimeout(poll, 5000);
  };

  const resetVg = () => {
    if (vgPollRef.current) clearTimeout(vgPollRef.current);
    setVgStatus("idle");
    setVgResult(null);
    setVgProgress(0);
  };

  if (!isOpen) return null;

  const categories = [...new Set(TOOLS.map((t) => t.category))];

  return (
    <>
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        fontFamily: "'Inter', 'SF Pro Text', system-ui, sans-serif",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) { reset(); onClose(); } }}
    >
      <div
        style={{
          width: 720,
          maxWidth: "95vw",
          maxHeight: "88vh",
          background: "#0f1117",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 18,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0,0,0,0.8)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "14px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 18, marginRight: 8 }}>⚡</span>
          <span style={{ fontWeight: 800, fontSize: 15, color: "#e8e8e8", flex: 1 }}>
            264 Pro AI Studio
          </span>
          {/* Tab switcher */}
          <div style={{ display: "flex", gap: 4, marginRight: 12 }}>
            {(["generate", "enhance"] as PanelTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => tab === "enhance" ? (reset(), setActiveTab(tab)) : (resetVg(), setActiveTab(tab))}
                style={{
                  padding: "5px 12px", borderRadius: 7, border: "1px solid",
                  borderColor: activeTab === tab ? "rgba(168,85,247,0.5)" : "rgba(255,255,255,0.1)",
                  background: activeTab === tab ? "rgba(168,85,247,0.15)" : "transparent",
                  color: activeTab === tab ? "#c084fc" : "rgba(255,255,255,0.4)",
                  fontSize: 11, fontWeight: 700, cursor: "pointer",
                  textTransform: "uppercase", letterSpacing: "0.06em",
                }}
              >
                {tab === "generate" ? "🎬 Generate" : "🔧 Enhance"}
              </button>
            ))}
          </div>
          <button
            onClick={() => { reset(); resetVg(); onClose(); }}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* ═══════════════════════ VIDEO GENERATION STUDIO ═══════════════════════ */}
        {activeTab === "generate" && (
          <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
            {/* Model selector sidebar */}
            <div style={{ width: 220, borderRight: "1px solid rgba(255,255,255,0.07)", overflowY: "auto", padding: "10px 8px", flexShrink: 0 }}>

              {/* ✦ Higgsfield AI section — Pro-only, top placement */}
              <div style={{ marginBottom: 6, padding: "7px 8px 4px", borderRadius: 8, background: "linear-gradient(135deg,rgba(0,212,255,0.06),rgba(0,255,163,0.04))", border: "1px solid rgba(0,212,255,0.15)" }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: "#00d4ff", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5, display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 11 }}>✦</span> Higgsfield AI <span style={{ marginLeft: "auto", fontSize: 8, background: "rgba(0,212,255,0.15)", color: "#00d4ff", padding: "1px 5px", borderRadius: 3, border: "1px solid rgba(0,212,255,0.3)" }}>PRO</span>
                </div>
                {VIDEO_GEN_MODELS.filter((m) => m.proOnly).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { setVgModel(m.id); resetVg(); }}
                    style={{
                      display: "flex", flexDirection: "column", width: "100%", padding: "8px 8px",
                      borderRadius: 8,
                      background: vgModel === m.id ? "rgba(0,212,255,0.14)" : "transparent",
                      border: `1px solid ${vgModel === m.id ? "rgba(0,212,255,0.5)" : "transparent"}`,
                      cursor: "pointer", textAlign: "left", marginBottom: 2, transition: "all 0.12s",
                      boxShadow: vgModel === m.id ? "0 0 10px rgba(0,212,255,0.15)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 11, color: "#00d4ff" }}>✦</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: vgModel === m.id ? "#00d4ff" : "rgba(255,255,255,0.75)" }}>{m.label}</span>
                      <span style={{ marginLeft: "auto", fontSize: 8, fontWeight: 800, padding: "1px 5px", borderRadius: 3, background: `${m.badgeColor}18`, color: m.badgeColor }}>
                        {m.mode === "i2v" ? "I2V" : "T2V"}
                      </span>
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(0,212,255,0.5)", paddingLeft: 17 }}>{m.provider}</div>
                  </button>
                ))}
              </div>

              {/* Standard T2V group */}
              <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "8px 8px 4px" }}>
                Text → Video
              </div>
              {VIDEO_GEN_MODELS.filter((m) => m.mode === "t2v" && !m.proOnly).map((m) => (
                <button
                  key={m.id}
                  onClick={() => { setVgModel(m.id); resetVg(); }}
                  style={{
                    display: "flex", flexDirection: "column", width: "100%", padding: "9px 10px",
                    borderRadius: 9, background: vgModel === m.id ? "rgba(168,85,247,0.14)" : "transparent",
                    border: `1px solid ${vgModel === m.id ? "rgba(168,85,247,0.4)" : "transparent"}`,
                    cursor: "pointer", textAlign: "left", marginBottom: 2, transition: "all 0.12s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
                    <span style={{ fontSize: 13 }}>{m.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: vgModel === m.id ? "#d0a0ff" : "rgba(255,255,255,0.7)" }}>{m.label}</span>
                    <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4, background: `${m.badgeColor}22`, color: m.badgeColor }}>
                      {m.badge.split(" ")[0]}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", paddingLeft: 20 }}>{m.provider}</div>
                </button>
              ))}

              {/* I2V group */}
              <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "12px 8px 4px" }}>
                Image → Video
              </div>
              {VIDEO_GEN_MODELS.filter((m) => m.mode === "i2v" && !m.proOnly).map((m) => (
                <button
                  key={m.id}
                  onClick={() => { setVgModel(m.id); resetVg(); }}
                  style={{
                    display: "flex", flexDirection: "column", width: "100%", padding: "9px 10px",
                    borderRadius: 9, background: vgModel === m.id ? "rgba(168,85,247,0.14)" : "transparent",
                    border: `1px solid ${vgModel === m.id ? "rgba(168,85,247,0.4)" : "transparent"}`,
                    cursor: "pointer", textAlign: "left", marginBottom: 2, transition: "all 0.12s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
                    <span style={{ fontSize: 13 }}>{m.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: vgModel === m.id ? "#d0a0ff" : "rgba(255,255,255,0.7)" }}>{m.label}</span>
                    <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4, background: `${m.badgeColor}22`, color: m.badgeColor }}>
                      I2V
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", paddingLeft: 20 }}>{m.provider}</div>
                </button>
              ))}
            </div>

            {/* Main generation area */}
            <div style={{
              flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14,
              // Higgsfield gets a cyan/teal glow background
              background: vgModelDef.proOnly
                ? "linear-gradient(160deg, rgba(0,212,255,0.03) 0%, rgba(0,255,163,0.02) 100%)"
                : undefined,
            }}>
              {/* Higgsfield Pro banner */}
              {vgModelDef.proOnly && (
                <div style={{
                  background: "linear-gradient(135deg,rgba(0,212,255,0.08),rgba(0,255,163,0.06))",
                  border: "1px solid rgba(0,212,255,0.2)",
                  borderRadius: 12, padding: "10px 14px",
                  display: "flex", alignItems: "center", gap: 10,
                }}>
                  <span style={{ fontSize: 20, color: "#00d4ff" }}>✦</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#00d4ff", marginBottom: 2 }}>Higgsfield AI — Pro Members Only</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>100+ cinematic models · Seedance 2.0 · Native audio · Multi-shot storytelling</div>
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 800, padding: "3px 8px", borderRadius: 5, background: "rgba(0,212,255,0.15)", color: "#00d4ff", border: "1px solid rgba(0,212,255,0.3)" }}>PRO</span>
                </div>
              )}

              {/* Model header */}
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 12,
                padding: vgModelDef.proOnly ? "12px 14px" : "0",
                borderRadius: vgModelDef.proOnly ? 12 : 0,
                background: vgModelDef.proOnly ? "rgba(0,212,255,0.05)" : "transparent",
                border: vgModelDef.proOnly ? "1px solid rgba(0,212,255,0.12)" : "none",
              }}>
                <div style={{ fontSize: 28, lineHeight: 1, color: vgModelDef.proOnly ? "#00d4ff" : undefined }}>{vgModelDef.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 800, fontSize: 16, color: vgModelDef.proOnly ? "#00d4ff" : "#e8e8e8" }}>{vgModelDef.label}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 5, background: `${vgModelDef.badgeColor}22`, color: vgModelDef.badgeColor, border: `1px solid ${vgModelDef.badgeColor}44` }}>
                      {vgModelDef.badge}
                    </span>
                    <span style={{ fontSize: 10, color: vgModelDef.proOnly ? "rgba(0,212,255,0.4)" : "rgba(255,255,255,0.3)", marginLeft: "auto" }}>{vgModelDef.provider}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.6, marginBottom: 6 }}>{vgModelDef.desc}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {vgModelDef.features.map((f) => (
                      <span key={f} style={{
                        fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                        background: vgModelDef.proOnly ? "rgba(0,212,255,0.1)" : "rgba(168,85,247,0.1)",
                        color: vgModelDef.proOnly ? "#00d4ff" : "#a855f7",
                        border: `1px solid ${vgModelDef.proOnly ? "rgba(0,212,255,0.2)" : "rgba(168,85,247,0.2)"}`,
                      }}>{f}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Image input for i2v */}
              {vgModelDef.mode === "i2v" && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 8 }}>
                    Reference Image
                  </label>
                  {vgImageUrl ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 9, padding: "10px 12px", marginBottom: 8 }}>
                      <img src={vgImageUrl} alt="ref" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, color: "#10b981", fontWeight: 700, marginBottom: 2 }}>✓ REFERENCE LOADED</div>
                        <div style={{ fontSize: 11, color: "#e8e8e8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vgImageName ?? vgImageUrl}</div>
                      </div>
                      <button onClick={() => { setVgImageUrl(""); setVgImageName(null); }} style={{ padding: "4px 8px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#6b7280", fontSize: 10, cursor: "pointer" }}>Clear</button>
                    </div>
                  ) : null}
                  <button
                    onClick={async () => {
                      const r = await (window as any).flowstateAPI?.pickMediaFile?.();
                      if (r?.filePath) { setVgImageUrl(`media://localhost?path=${encodeURIComponent(r.filePath)}`); setVgImageName(r.name); }
                    }}
                    style={{ width: "100%", padding: "10px", borderRadius: 9, border: "1px dashed rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.5)", fontSize: 12, cursor: "pointer" }}
                  >
                    📂 Browse Image / Frame…
                  </button>
                </div>
              )}

              {/* Prompt */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Prompt
                  </label>
                  <span style={{ fontSize: 10, color: vgPrompt.length > 900 ? "#ef4444" : "rgba(255,255,255,0.2)" }}>{vgPrompt.length}/1000</span>
                </div>
                <textarea
                  value={vgPrompt}
                  onChange={(e) => setVgPrompt(e.target.value.slice(0, 1000))}
                  placeholder={`Describe your video... (e.g. "A lone figure walks through a neon-lit rainy street at night, cinematic slow dolly, 8K")`}
                  rows={4}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "#e8e8e8", fontSize: 12, lineHeight: 1.6, resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                />
              </div>

              {/* Camera motion & style presets */}
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Camera Motion</label>
                  <select
                    value={vgCameraMotion}
                    onChange={(e) => setVgCameraMotion(e.target.value)}
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)", background: "#1a1a2e", color: "#e8e8e8", fontSize: 11, outline: "none" }}
                  >
                    <option value="">None / Prompt-driven</option>
                    {CAMERA_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Style</label>
                  <select
                    value={vgStyle}
                    onChange={(e) => setVgStyle(e.target.value)}
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)", background: "#1a1a2e", color: "#e8e8e8", fontSize: 11, outline: "none" }}
                  >
                    <option value="">None</option>
                    {STYLE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Negative prompt */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>Negative Prompt <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
                <input
                  value={vgNegPrompt}
                  onChange={(e) => setVgNegPrompt(e.target.value)}
                  placeholder="blurry, distorted, low quality, watermark…"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "#9ca3af", fontSize: 12, outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
                />
              </div>

              {/* Config row: duration, resolution, aspect, quality */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                {/* Duration */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>Duration</label>
                  <select value={vgDuration} onChange={(e) => setVgDuration(Number(e.target.value))} style={{ width: "100%", padding: "7px 8px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)", background: "#1a1a2e", color: "#e8e8e8", fontSize: 11, outline: "none" }}>
                    {[5, 10, ...(vgModelDef.maxDuration >= 15 ? [15] : [])].filter((d) => d <= vgModelDef.maxDuration).map((d) => <option key={d} value={d}>{d}s</option>)}
                  </select>
                </div>
                {/* Resolution */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>Resolution</label>
                  <select value={vgResolution} onChange={(e) => setVgResolution(e.target.value)} style={{ width: "100%", padding: "7px 8px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)", background: "#1a1a2e", color: "#e8e8e8", fontSize: 11, outline: "none" }}>
                    {vgModelDef.resolutions.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                {/* Aspect Ratio */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>Aspect</label>
                  <select value={vgAspectRatio} onChange={(e) => setVgAspectRatio(e.target.value)} style={{ width: "100%", padding: "7px 8px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)", background: "#1a1a2e", color: "#e8e8e8", fontSize: 11, outline: "none" }}>
                    {vgModelDef.aspectRatios.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                {/* Quality */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>Quality</label>
                  <select value={vgQuality} onChange={(e) => setVgQuality(e.target.value as "basic" | "high")} style={{ width: "100%", padding: "7px 8px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)", background: "#1a1a2e", color: "#e8e8e8", fontSize: 11, outline: "none" }}>
                    <option value="basic">Basic (fast)</option>
                    <option value="high">High (best)</option>
                  </select>
                </div>
              </div>

              {/* Generate button */}
              <button
                onClick={() => {
                  checkAndRun(
                    { toolName: `${vgModelDef.label} Video Gen`, toolIcon: vgModelDef.icon, requiredAccess: "pro" as RequiredAccess, description: vgModelDef.desc },
                    () => void runVideoGen(),
                  );
                }}
                disabled={vgStatus === "running" || vgStatus === "polling" || !vgPrompt.trim() || (vgModelDef.mode === "i2v" && !vgImageUrl)}
                style={{
                  padding: "13px 24px", borderRadius: 11,
                  background: vgStatus === "running" || vgStatus === "polling"
                    ? `rgba(0,0,0,0.3)`
                    : !vgPrompt.trim()
                    ? "rgba(255,255,255,0.07)"
                    : vgModelDef.proOnly
                    ? "linear-gradient(135deg, #00d4ff, #00ffa3)"
                    : `linear-gradient(135deg, ${vgModelDef.providerColor}cc, ${vgModelDef.providerColor})`,
                  border: "none",
                  color: !vgPrompt.trim() ? "rgba(255,255,255,0.3)" : vgModelDef.proOnly ? "#000" : "#fff",
                  fontSize: 14, fontWeight: 800,
                  cursor: vgStatus === "running" || vgStatus === "polling" || !vgPrompt.trim() ? "not-allowed" : "pointer",
                  transition: "all 0.15s", alignSelf: "flex-start",
                  boxShadow: vgModelDef.proOnly && vgPrompt.trim() ? "0 0 18px rgba(0,212,255,0.3)" : "none",
                }}
              >
                {vgStatus === "running" ? "⏳ Queuing…"
                  : vgStatus === "polling" ? `⏳ Generating… ${vgProgress > 0 ? Math.round(vgProgress) + "%" : ""}`
                  : vgModelDef.proOnly ? `✦ Generate ${vgDuration}s — Higgsfield`
                  : `🎬 Generate ${vgDuration}s Video`}
              </button>

              {/* Progress bar */}
              {(vgStatus === "running" || vgStatus === "polling") && (
                <div>
                  <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden", height: 6, marginBottom: 6 }}>
                    <div style={{ height: "100%", width: `${vgStatus === "running" ? 8 : vgProgress}%`, background: `linear-gradient(90deg, ${vgModelDef.providerColor}88, ${vgModelDef.providerColor})`, transition: "width 0.8s ease", borderRadius: 99 }} />
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
                    {vgResult?.message ?? `${vgModelDef.label} is rendering your video — this usually takes 1–3 minutes`}
                  </div>
                </div>
              )}

              {/* Result */}
              {vgResult && (vgStatus === "complete" || vgStatus === "error") && (
                <div style={{ background: vgStatus === "error" ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.08)", border: `1px solid ${vgStatus === "error" ? "rgba(239,68,68,0.25)" : "rgba(16,185,129,0.25)"}`, borderRadius: 12, padding: 16 }}>
                  {vgStatus === "error" && (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#fca5a5", marginBottom: 6 }}>✕ Generation Failed</div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>{vgResult.error}</div>
                      <button onClick={resetVg} style={{ marginTop: 10, padding: "7px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(255,255,255,0.5)", fontSize: 12, cursor: "pointer" }}>Try Again</button>
                    </>
                  )}
                  {vgStatus === "complete" && vgResult.videoUrl && (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#6ee7b7", marginBottom: 10 }}>✓ Video Ready!</div>
                      <video
                        src={vgResult.videoUrl}
                        controls autoPlay muted loop
                        style={{ width: "100%", borderRadius: 10, background: "#000", maxHeight: 240, objectFit: "contain" }}
                      />
                      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                        <a href={vgResult.videoUrl} target="_blank" rel="noreferrer" style={{ padding: "8px 14px", borderRadius: 8, background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)", color: "#6ee7b7", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
                          Download Video ↗
                        </a>
                        <button onClick={() => navigator.clipboard.writeText(vgResult!.videoUrl!).catch(() => {})} style={{ padding: "8px 14px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Copy URL</button>
                        <button onClick={resetVg} style={{ padding: "8px 14px", borderRadius: 8, background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.4)", fontSize: 12, cursor: "pointer" }}>Generate Another</button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Model info footer */}
              <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.05)", marginTop: "auto" }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", lineHeight: 1.7 }}>
                  <strong style={{ color: "rgba(255,255,255,0.3)" }}>Note:</strong> Video generation takes 1–4 minutes depending on model and duration.
                  {" "}Generated videos expire after 24 hours on fal.ai — download immediately.
                  {" "}Requires Pro plan + FAL_AI_KEY or HIGGSFIELD_API_KEY configured on your FlowState account.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════ ENHANCEMENT TOOLS ═══════════════════════ */}
        {activeTab === "enhance" && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Tool selector */}
          <div
            style={{
              width: 200,
              borderRight: "1px solid rgba(255,255,255,0.07)",
              overflowY: "auto",
              padding: "10px 8px",
              flexShrink: 0,
            }}
          >
            {categories.map((cat) => (
              <div key={cat}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "rgba(255,255,255,0.35)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    padding: "8px 8px 4px",
                  }}
                >
                  {CATEGORY_LABELS[cat]}
                </div>
                {TOOLS.filter((t) => t.category === cat).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setSelectedTool(t.id); reset(); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: selectedTool === t.id ? "rgba(168,85,247,0.15)" : "transparent",
                      border: `1px solid ${selectedTool === t.id ? "rgba(168,85,247,0.4)" : "transparent"}`,
                      color: selectedTool === t.id ? "#d0a0ff" : "rgba(255,255,255,0.6)",
                      fontSize: 12,
                      fontWeight: selectedTool === t.id ? 700 : 500,
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.12s",
                      marginBottom: 2,
                    }}
                  >
                    <span style={{ fontSize: 14, flexShrink: 0 }}>{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Tool config & output */}
          <div style={{ flex: 1, padding: "18px 20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Tool description */}
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#e8e8e8", marginBottom: 4 }}>
                {tool.icon} {tool.label}
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
                {tool.desc}
              </div>
            </div>

            {/* Media Input — auto-fill from timeline selection or browse local files */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
                {tool.inputType === "video" ? "Source Video" : tool.inputType === "both" ? "Source Media" : "Source Image"}
              </label>

              {/* Auto-fill from timeline selected clip */}
              {(() => {
                // Find the asset for the selected clip
                const clip = project.sequence.clips.find((c) => c.id === selectedClipId);
                const asset = clip
                  ? project.assets.find((a) => a.id === clip.assetId)
                  : project.assets.find((a) => a.id === selectedAssetId);

                if (asset && asset.sourcePath) {
                  const assetMediaUrl = `media://localhost?path=${encodeURIComponent(asset.sourcePath)}`;
                  const isCurrentlySet = inputUrl === assetMediaUrl;
                  return (
                    <div style={{
                      background: isCurrentlySet ? "rgba(16,185,129,0.08)" : "rgba(168,85,247,0.06)",
                      border: `1px solid ${isCurrentlySet ? "rgba(16,185,129,0.25)" : "rgba(168,85,247,0.2)"}`,
                      borderRadius: 9, padding: "10px 12px", marginBottom: 8,
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 10, color: isCurrentlySet ? "#10b981" : "#a855f7", fontWeight: 700, marginBottom: 2 }}>
                          {isCurrentlySet ? "✓ LOADED" : "SELECTED CLIP"}
                        </div>
                        <div style={{ fontSize: 11, color: "#e8e8e8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {asset.name}
                        </div>
                      </div>
                      {!isCurrentlySet && (
                        <button
                          onClick={() => { setInputUrl(assetMediaUrl); setInputFileName(asset.name); }}
                          style={{
                            padding: "5px 12px", borderRadius: 7, border: "none",
                            background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                            color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0,
                          }}
                        >
                          Use This
                        </button>
                      )}
                    </div>
                  );
                }
                return null;
              })()}

              {/* Currently loaded file display */}
              {inputUrl && (
                <div style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 9, padding: "8px 12px", marginBottom: 8,
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                }}>
                  <div style={{ fontSize: 11, color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    📂 {inputFileName ?? inputUrl.split('?path=').pop() ?? inputUrl}
                  </div>
                  <button
                    onClick={() => { setInputUrl(""); setInputFileName(null); }}
                    style={{ padding: "3px 8px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#6b7280", fontSize: 10, cursor: "pointer", flexShrink: 0 }}
                  >
                    Clear
                  </button>
                </div>
              )}

              {/* Browse button */}
              <button
                onClick={async () => {
                  const result = await (window as any).flowstateAPI?.pickMediaFile?.();
                  if (result?.filePath) {
                    const url = `media://localhost?path=${encodeURIComponent(result.filePath)}`;
                    setInputUrl(url);
                    setInputFileName(result.name);
                  }
                }}
                style={{
                  width: "100%", padding: "10px", borderRadius: 9,
                  border: "1px dashed rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.03)",
                  color: "rgba(255,255,255,0.5)", fontSize: 12, cursor: "pointer",
                  transition: "all 0.15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}
                onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(168,85,247,0.08)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(168,85,247,0.3)"; (e.currentTarget as HTMLButtonElement).style.color = "#a855f7"; }}
                onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.03)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.15)"; (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.5)"; }}
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <rect x="1" y="4" width="11" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M4 4V3a2.5 2.5 0 015 0v1" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M6.5 7v2.5M5 8.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                Browse Files…
              </button>

              {!inputUrl && !selectedClipId && !selectedAssetId && (
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 6, lineHeight: 1.5, textAlign: "center" }}>
                  Select a clip on the timeline to auto-fill, or browse your device
                </div>
              )}
            </div>

            {/* Parameters */}
            {tool.params && tool.params.length > 0 && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 10 }}>
                  Parameters
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {tool.params.map((p) => (
                    <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", width: 130, flexShrink: 0 }}>
                        {p.label}
                      </label>
                      {p.type === "checkbox" ? (
                        <input
                          type="checkbox"
                          checked={getParam(p.key, p.defaultValue) as boolean}
                          onChange={(e) => setParam(p.key, e.target.checked)}
                          style={{ width: 16, height: 16, accentColor: "#a855f7", cursor: "pointer" }}
                        />
                      ) : p.type === "range" ? (
                        <>
                          <input
                            type="range"
                            min={p.min}
                            max={p.max}
                            step={p.step}
                            value={getParam(p.key, p.defaultValue) as number}
                            onChange={(e) => setParam(p.key, Number(e.target.value))}
                            style={{ flex: 1, accentColor: "#a855f7" }}
                          />
                          <span style={{ fontSize: 12, color: "#c084fc", width: 32, textAlign: "right", fontWeight: 700 }}>
                            {getParam(p.key, p.defaultValue) as number}
                          </span>
                        </>
                      ) : (
                        <input
                          type="number"
                          min={p.min}
                          max={p.max}
                          value={getParam(p.key, p.defaultValue) as number}
                          onChange={(e) => setParam(p.key, Number(e.target.value))}
                          style={{
                            width: 70,
                            padding: "6px 8px",
                            background: "rgba(255,255,255,0.07)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            borderRadius: 6,
                            color: "#e8e8e8",
                            fontSize: 12,
                            outline: "none",
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Run button */}
            <button
              onClick={() => {
                checkAndRun(
                  {
                    toolName: tool.label,
                    toolIcon: tool.icon,
                    requiredAccess: "clawflow" as RequiredAccess,
                    description: tool.desc,
                  },
                  () => void runTool(),
                );
              }}
              disabled={status === "running" || status === "polling" || !inputUrl.trim()}
              style={{
                padding: "12px 24px",
                borderRadius: 10,
                background:
                  status === "running" || status === "polling"
                    ? "rgba(168,85,247,0.3)"
                    : !inputUrl.trim()
                    ? "rgba(255,255,255,0.07)"
                    : "linear-gradient(135deg, #7c3aed, #a855f7)",
                border: "none",
                color: !inputUrl.trim() ? "rgba(255,255,255,0.3)" : "#fff",
                fontSize: 14,
                fontWeight: 700,
                cursor: status === "running" || status === "polling" || !inputUrl.trim() ? "not-allowed" : "pointer",
                transition: "all 0.15s",
                alignSelf: "flex-start",
              }}
            >
              {status === "running"
                ? "⏳ Starting…"
                : status === "polling"
                ? `⏳ Processing… ${progress > 0 ? Math.round(progress) + "%" : ""}`
                : `⚡ Run ${tool.label}`}
            </button>

            {/* Progress bar */}
            {(status === "running" || status === "polling") && (
              <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden", height: 4 }}>
                <div
                  style={{
                    height: "100%",
                    width: `${status === "running" ? 10 : progress}%`,
                    background: "linear-gradient(90deg, #7c3aed, #a855f7)",
                    transition: "width 0.5s ease",
                    borderRadius: 99,
                  }}
                />
              </div>
            )}

            {/* Result */}
            {result && (
              <div
                style={{
                  background: status === "error" ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.08)",
                  border: `1px solid ${status === "error" ? "rgba(239,68,68,0.25)" : "rgba(16,185,129,0.25)"}`,
                  borderRadius: 10,
                  padding: 14,
                }}
              >
                {status === "error" && (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#fca5a5", marginBottom: 4 }}>
                      ✕ Error
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
                      {result.error}
                    </div>
                    {result.message && (
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 6 }}>
                        {result.message}
                      </div>
                    )}
                  </>
                )}
                {status === "polling" && result.message && (
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
                    ⏳ {result.message}
                    {result.predictionId && (
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 4 }}>
                        Prediction: {result.predictionId}
                      </div>
                    )}
                  </div>
                )}
                {status === "complete" && (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#6ee7b7", marginBottom: 8 }}>
                      ✓ Complete
                    </div>
                    {result.outputUrl && (
                      <div>
                        <img
                          src={result.outputUrl}
                          alt="AI output"
                          style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 8, objectFit: "contain", background: "#000" }}
                        />
                        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                          <a
                            href={result.outputUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              padding: "8px 14px",
                              borderRadius: 8,
                              background: "rgba(16,185,129,0.15)",
                              border: "1px solid rgba(16,185,129,0.3)",
                              color: "#6ee7b7",
                              fontSize: 12,
                              fontWeight: 700,
                              textDecoration: "none",
                            }}
                          >
                            Open Output ↗
                          </a>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(result.outputUrl!).catch(() => {});
                            }}
                            style={{
                              padding: "8px 14px",
                              borderRadius: 8,
                              background: "rgba(255,255,255,0.06)",
                              border: "1px solid rgba(255,255,255,0.12)",
                              color: "rgba(255,255,255,0.6)",
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Copy URL
                          </button>
                          <button
                            onClick={reset}
                            style={{
                              padding: "8px 14px",
                              borderRadius: 8,
                              background: "transparent",
                              border: "1px solid rgba(255,255,255,0.12)",
                              color: "rgba(255,255,255,0.4)",
                              fontSize: 12,
                              cursor: "pointer",
                            }}
                          >
                            Run Again
                          </button>
                        </div>
                      </div>
                    )}
                    {result.outputBase64 && (
                      <div>
                        <img
                          src={`data:${result.contentType || "image/png"};base64,${result.outputBase64}`}
                          alt="AI output"
                          style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 8, objectFit: "contain" }}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Info footer */}
            <div
              style={{
                marginTop: "auto",
                padding: "10px 12px",
                background: "rgba(255,255,255,0.03)",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", lineHeight: 1.7 }}>
                <strong style={{ color: "rgba(255,255,255,0.35)" }}>Tips:</strong> AI tools run on
                Replicate's GPU cloud — processing takes 15s–3min depending on the model and file size.
                Large video files may take longer. Results are hosted on Replicate and expire after 1 hour —
                download immediately. Requires an active FlowState account.
              </div>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>

    {/* Auth Gate Modal — rendered outside the panel so it covers the full screen */}
    {modal && (
      <AuthGateModal
        config={modal.config}
        auth={modal.auth}
        onClose={closeModal}
        onGranted={modal.onGranted}
      />
    )}
    </>
  );
}
