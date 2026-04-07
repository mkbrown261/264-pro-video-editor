import React, { useCallback, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
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

// ── Main Component ─────────────────────────────────────────────────────────────
interface AIToolsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AIToolsPanel({ isOpen, onClose }: AIToolsPanelProps) {
  const [selectedTool, setSelectedTool] = useState<AITool>("upscale");
  const [inputUrl, setInputUrl] = useState("");
  const [paramValues, setParamValues] = useState<Record<string, number | boolean>>({});
  const [status, setStatus] = useState<ToolStatus>("idle");
  const [result, setResult] = useState<ToolResult | null>(null);
  const [progress, setProgress] = useState(0);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  if (!isOpen) return null;

  const categories = [...new Set(TOOLS.map((t) => t.category))];

  return (
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
            264 Pro AI Tools
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginRight: 12 }}>
            Powered by Replicate + HuggingFace
          </span>
          <button
            onClick={() => { reset(); onClose(); }}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

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

            {/* Input URL */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
                {tool.inputType === "video" ? "Video URL" : tool.inputType === "both" ? "Image or Video URL" : "Image URL"}
              </label>
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder={tool.inputType === "video" ? "https://... (MP4 URL)" : "https://... (image URL)"}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 9,
                  color: "#e8e8e8",
                  fontSize: 12,
                  fontFamily: "inherit",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 4, lineHeight: 1.5 }}>
                Provide a publicly accessible URL. Export a frame/clip first, upload to a service like Cloudflare R2 or Imgur, then paste the URL here.
              </div>
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
              onClick={() => void runTool()}
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
      </div>
    </div>
  );
}
