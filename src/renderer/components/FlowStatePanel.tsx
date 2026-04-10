import React, { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";

// ── Types ─────────────────────────────────────────────────────────────────────
interface FSUser {
  name: string;
  email: string;
  picture: string;
  tier: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

interface RecentProject {
  id: string;
  name: string;
  lastModified: string;
  duration?: number;
  trackCount?: number;
}

// ── flowstateAPI shim (fallback when not in Electron) ────────────────────────
declare global {
  interface Window {
    flowstateAPI?: {
      getToken: () => Promise<string | null>;
      getUser: () => Promise<FSUser | null>;
      apiCall: (path: string, method: string, body?: unknown) => Promise<unknown>;
      runAITool?: (tool: string, options: { imageUrl?: string; videoUrl?: string; params?: Record<string, unknown> }) => Promise<unknown>;
      pollAITool?: (predictionId: string) => Promise<unknown>;
      // ── Video Generation ──────────────────────────────────────────────
      generateVideo?: (params: {
        model: string;
        prompt: string;
        imageUrl?: string;
        duration?: number;
        resolution?: string;
        aspectRatio?: string;
        quality?: string;
        cameraMotion?: string;
        style?: string;
        negativePrompt?: string;
      }) => Promise<unknown>;
      pollVideoGen?: (requestId: string, provider: string) => Promise<unknown>;
      // ── Media picker ─────────────────────────────────────────────────
      pickMediaFile?: () => Promise<{ filePath: string; name: string } | null>;
      signOut?: () => Promise<{ ok: boolean }>;
      cloudSave?: (data: unknown) => Promise<unknown>;
      cloudList?: () => Promise<unknown>;
      cloudLoad?: (key: string) => Promise<unknown>;
      cloudDelete?: (key: string) => Promise<unknown>;
    };
    // editorApi is declared in vite-env.d.ts with the full type
  }
}

const fsApi = {
  getToken: (): Promise<string | null> =>
    window.flowstateAPI?.getToken() ?? Promise.resolve(null),
  getUser: (): Promise<FSUser | null> =>
    window.flowstateAPI?.getUser() ?? Promise.resolve(null),
  apiCall: (path: string, method = "GET", body?: unknown): Promise<unknown> =>
    window.flowstateAPI?.apiCall(path, method, body) ?? Promise.resolve({ error: "Not in Electron" }),
};

const FS_BASE = "https://flowstate-67g.pages.dev";

// ── Tier badge ────────────────────────────────────────────────────────────────
const TIER_LABEL: Record<string, string> = {
  free: "Free",
  personal_pro: "Pro",
  team_starter: "Team",
  team_growth: "Growth",
  enterprise: "Enterprise",
};
const TIER_COLOR: Record<string, string> = {
  free: "#6b7280",
  personal_pro: "#8b5cf6",
  team_starter: "#3b82f6",
  team_growth: "#10b981",
  enterprise: "#f59e0b",
};

// ── Learning Intelligence Engine ──────────────────────────────────────────────
interface LearningObservation {
  message: string;
  ts: number;
  wasError: boolean;
}

interface GeneratedResource {
  id: string;
  type: "video_script" | "explanation" | "cheat_sheet";
  topic: string;
  level: "beginner" | "intermediate" | "advanced";
  content: string;
  ts: number;
}

interface LearningState {
  observations: LearningObservation[];
  detectedLevel: "beginner" | "intermediate" | "advanced" | null;
  confusionTopic: string | null;
  suggestionPending: boolean;
  lastSuggestionTs: number;
  generatedResources: GeneratedResource[];
}

class LearningEngine {
  state: LearningState = {
    observations: [],
    detectedLevel: null,
    confusionTopic: null,
    suggestionPending: false,
    lastSuggestionTs: 0,
    generatedResources: [],
  };

  observe(message: string): void {
    const isError = /error|why|not working|broken|how do i|doesn.t work|confused|stuck|help|wrong|fail/i.test(message);
    this.state.observations = [
      ...this.state.observations.slice(-9),
      { message, ts: Date.now(), wasError: isError },
    ];
  }

  detectConfusion(): { confused: boolean; topic: string | null } {
    const recent = this.state.observations.slice(-5);
    if (recent.length < 2) return { confused: false, topic: null };
    const errorCount = recent.filter(o => o.wasError).length;
    if (errorCount >= 2) {
      const topic = this.extractTopic(recent.filter(o => o.wasError).map(o => o.message).join(" "));
      return { confused: true, topic };
    }
    const words = recent.map(o => new Set(o.message.toLowerCase().split(/\s+/).filter((w: string) => w.length > 4)));
    let overlapCount = 0;
    for (let i = 0; i < words.length - 1; i++) {
      const overlap = [...words[i]].filter(w => words[i+1].has(w));
      if (overlap.length >= 2) overlapCount++;
    }
    if (overlapCount >= 2) {
      return { confused: true, topic: this.extractTopic(recent.map(o => o.message).join(" ")) };
    }
    return { confused: false, topic: null };
  }

  detectLevel(): "beginner" | "intermediate" | "advanced" {
    const msgs = this.state.observations.map(o => o.message.toLowerCase()).join(" ");
    if (/architect|optimize|scale|performance|typescript|async|concurrent|race condition|memory leak|refactor|design system/.test(msgs)) return "advanced";
    if (/function|component|state|props|hook|useeffect|async|promise|fetch|loop|array|object|class/.test(msgs)) return "intermediate";
    if (/how do i|what is|where is|getting started|install|first time|don.t understand|explain|what does/.test(msgs)) return "beginner";
    return "intermediate";
  }

  private extractTopic(text: string): string {
    const stopWords = new Set(["the","is","a","an","to","for","in","on","at","of","and","or","but","not","this","that","with","from","how","what","why","when","where"]);
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
    const freq: Record<string, number> = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] ?? "this topic";
  }

  shouldSuggest(): boolean {
    if (this.state.suggestionPending) return false;
    if (Date.now() - this.state.lastSuggestionTs < 60000) return false;
    return this.detectConfusion().confused;
  }

  markSuggested(): void {
    this.state.suggestionPending = true;
    this.state.lastSuggestionTs = Date.now();
    this.state.confusionTopic = this.detectConfusion().topic;
  }

  markDismissed(): void { this.state.suggestionPending = false; }

  addResource(resource: GeneratedResource): void {
    this.state.generatedResources = [resource, ...this.state.generatedResources].slice(0, 20);
    this.state.suggestionPending = false;
  }

  get resources(): GeneratedResource[] { return this.state.generatedResources; }
  get topic(): string | null { return this.state.confusionTopic; }
  get level(): "beginner" | "intermediate" | "advanced" { return this.state.detectedLevel ?? this.detectLevel(); }
  get pendingSuggestion(): boolean { return this.state.suggestionPending; }
}

const learningEngine = new LearningEngine();

// ── Main component ────────────────────────────────────────────────────────────
interface FlowStatePanelProps {
  isOpen: boolean;
  onClose: () => void;
  onAddImageToMediaPool?: (imageUrl: string, name: string) => void;
}

type Tab = "assistant" | "projects" | "session" | "learn" | "generate";

// ── Generate tab types ────────────────────────────────────────────────────────
interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  model: string;
  aspectRatio: string;
  ts: number;
}

const IMAGE_MODELS = [
  { value: "dall-e-3",          label: "DALL·E 3" },
  { value: "stable-diffusion",  label: "Stable Diffusion" },
  { value: "flux",              label: "Flux" },
];

const ASPECT_RATIOS = [
  { value: "1:1",  label: "1:1" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "4:3",  label: "4:3" },
];

export function FlowStatePanel({ isOpen, onClose, onAddImageToMediaPool }: FlowStatePanelProps) {
  const [user, setUser] = useState<FSUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("assistant");

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Projects state
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  // Session state
  const [sessionMsg, setSessionMsg] = useState<string | null>(null);

  // Learning state
  const [suggestionBanner, setSuggestionBanner] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeResource, setActiveResource] = useState<GeneratedResource | null>(null);
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  // Generate tab state
  const [genPrompt, setGenPrompt] = useState("");
  const [genModel, setGenModel] = useState("dall-e-3");
  const [genAspect, setGenAspect] = useState("1:1");
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genImages, setGenImages] = useState<GeneratedImage[]>([]);

  const project = useEditorStore((s) => s.project);

  // ── Load user ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fsApi.getUser().then((u) => {
      setUser(u);
      setLoading(false);
    });
  }, [isOpen]);

  // ── Sync project context when panel opens ──────────────────────────────────
  useEffect(() => {
    if (!isOpen || !user) return;
    const tracks = project.sequence?.tracks ?? [];
    const clips = project.sequence?.clips ?? [];
    const settings = project.sequence?.settings ?? {};
    const fps = settings.fps || 30;
    const width = settings.width || 1920;
    const height = settings.height || 1080;
    const ctx = {
      projectId: `local_${Date.now()}`,
      projectName: project.name ?? "Untitled Project",
      totalDurationSec: clips.length > 0 ? (Math.max(...clips.map((c: any) => (c.startFrame ?? 0) + (c.durationFrames ?? 0))) / fps) : 0,
      trackCount: tracks.length,
      clipCount: clips.length,
      assetTypes: [...new Set(clips.map((c: any) => c.assetType ?? "video"))],
      fps,
      resolution: `${width}×${height}`,
      lastModified: new Date().toISOString(),
    };
    void fsApi.apiCall("/api/264pro/context-sync", "POST", ctx);
  }, [isOpen, user, project]);

  // ── Load recent projects ───────────────────────────────────────────────────
  useEffect(() => {
    if (tab !== "projects" || !user) return;
    setProjectsLoading(true);
    fsApi
      .apiCall("/api/264pro/projects", "GET")
      .then((res: any) => {
        setProjects(Array.isArray(res?.projects) ? res.projects : []);
      })
      .finally(() => setProjectsLoading(false));
  }, [tab, user]);

  // ── Chat scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Send chat ──────────────────────────────────────────────────────────────
  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    setChatInput("");
    learningEngine.observe(text);
    const userMsg: ChatMessage = { role: "user", content: text, ts: Date.now() };
    setMessages((m) => [...m, userMsg]);
    setChatBusy(true);
    try {
      const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
      const res = (await fsApi.apiCall("/api/264pro/ai-chat", "POST", {
        messages: history,
        projectContext: {
          projectName: project.name ?? "Untitled",
          trackCount: project.sequence?.tracks?.length ?? 0,
          fps: project.sequence?.settings?.fps ?? 30,
          resolution: `${project.sequence?.settings?.width ?? 1920}×${project.sequence?.settings?.height ?? 1080}`,
        },
      })) as any;
      const reply = res?.reply ?? res?.message ?? "Sorry, I couldn't get a response.";
      setMessages((m) => [...m, { role: "assistant", content: reply, ts: Date.now() }]);
      if (learningEngine.shouldSuggest()) {
        learningEngine.markSuggested();
        setSuggestionBanner(learningEngine.topic ?? "this topic");
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Network error — please try again.", ts: Date.now() },
      ]);
    } finally {
      setChatBusy(false);
    }
  }, [chatInput, chatBusy, messages, project]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendChat();
    }
  };

  // ── Activity send ──────────────────────────────────────────────────────────
  const sendActivity = useCallback((eventType: string, payload?: Record<string, unknown>) => {
    void fsApi.apiCall("/api/264pro/activity", "POST", {
      event: eventType,
      projectName: project.name ?? "Untitled",
      ...payload,
    });
  }, [project]);

  // ── Generate learning resource ─────────────────────────────────────────────
  async function handleGenerateResource(topicOverride?: string) {
    const topic = topicOverride ?? learningEngine.topic ?? "this concept";
    const level = learningEngine.level;
    const durationDesc = level === "beginner" ? "5-6 minute" : level === "intermediate" ? "5-7 minute" : "6-8 minute";
    const styleDesc = level === "beginner" ? "getting-started overview" : level === "intermediate" ? "practical walkthrough" : "architecture and system-level explanation";

    const prompt = `You are generating a learning resource for a ${level} developer confused about: "${topic}".

Generate a ${durationDesc} ${styleDesc}. Use this structure:

## ${topic} — ${styleDesc}

**Duration:** ${durationDesc}
**Level:** ${level}

### The Core Idea
[2-3 sentences that cut through the confusion]

### What You Need First
[3-5 bullet prerequisite points]

### Step by Step
[5-8 numbered clear steps]

### Common Mistakes
[3 concrete mistakes with fixes]

### Quick Reference
[Code snippet if relevant]

### The Takeaway
[One sentence that locks in the learning]

Be specific, not generic. Surprising insights only.`;

    setIsGenerating(true);
    try {
      const result = await fsApi.apiCall("/api/chat/stream", "POST", {
        messages: [{ role: "user", content: prompt }],
        model: "gpt-4o",
      }) as { content?: string; choices?: Array<{ message: { content: string } }> };
      const content = (result as any)?.content ?? (result as any)?.choices?.[0]?.message?.content ?? "Unable to generate resource.";
      const resource: GeneratedResource = {
        id: `res_${Date.now()}`,
        type: level === "advanced" ? "explanation" : level === "intermediate" ? "explanation" : "video_script",
        topic,
        level,
        content,
        ts: Date.now(),
      };
      learningEngine.addResource(resource);
      setActiveResource(resource);
      setTab("learn");
    } catch {
      // silent fail
    } finally {
      setIsGenerating(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: 340,
        height: "100vh",
        background: "#0f1117",
        borderLeft: "1px solid rgba(255,255,255,0.10)",
        display: "flex",
        flexDirection: "column",
        zIndex: 9999,
        fontFamily: "'Inter', 'SF Pro Text', system-ui, sans-serif",
        boxShadow: "-8px 0 32px rgba(0,0,0,0.6)",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 18 }}>🌊</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: "#e8e8e8", flex: 1 }}>FlowState</span>
        {user && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 7px",
              borderRadius: 99,
              background: TIER_COLOR[user.tier] ?? "#6b7280",
              color: "#fff",
              letterSpacing: "0.05em",
            }}
          >
            {TIER_LABEL[user.tier] ?? user.tier}
          </span>
        )}
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.4)",
            cursor: "pointer",
            fontSize: 16,
            padding: "2px 4px",
            lineHeight: 1,
          }}
          title="Close panel"
        >
          ✕
        </button>
      </div>

      {/* ── Not linked ── */}
      {!loading && !user && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 28,
            gap: 14,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 36 }}>🔗</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#e8e8e8" }}>
            Not linked to FlowState
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
            Link your account to access the AI assistant, Notion sync, and project tracking.
          </div>
          <a
            href={`${FS_BASE}?ref=264pro`}
            target="_blank"
            rel="noreferrer"
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              background: "linear-gradient(135deg,#e07820,#a855f7)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            Open FlowState
          </a>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(255,255,255,0.3)",
            fontSize: 13,
          }}
        >
          Loading…
        </div>
      )}

      {/* ── Linked UI ── */}
      {!loading && user && (
        <>
          {/* User bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 14px",
              gap: 9,
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              flexShrink: 0,
            }}
          >
            {user.picture ? (
              <img
                src={user.picture}
                style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover" }}
                alt=""
              />
            ) : (
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg,#e07820,#a855f7)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#fff",
                }}
              >
                {user.name?.[0] ?? "?"}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#e8e8e8",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {user.name}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.35)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {user.email}
              </div>
            </div>
          </div>

          {/* Tab bar */}
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
              flexShrink: 0,
            }}
          >
            {(["assistant", "projects", "session", "learn", "generate"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1,
                  padding: "9px 2px",
                  background: "none",
                  border: "none",
                  borderBottom: `2px solid ${tab === t ? "#a855f7" : "transparent"}`,
                  color: tab === t ? "#d0a0ff" : "rgba(255,255,255,0.4)",
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "color 0.15s",
                  textTransform: "capitalize",
                }}
              >
                {t === "assistant" ? "🤖 AI" : t === "projects" ? "📁" : t === "session" ? "⚡" : t === "learn" ? "📚" : "🖼 Gen"}
              </button>
            ))}
          </div>

          {/* ── Tab: AI Assistant ── */}
          {tab === "assistant" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* Project context pill */}
              <div
                style={{
                  padding: "8px 12px",
                  background: "rgba(168,85,247,0.08)",
                  borderBottom: "1px solid rgba(168,85,247,0.12)",
                  fontSize: 10,
                  color: "rgba(168,85,247,0.8)",
                  flexShrink: 0,
                }}
              >
                📎 Context: {project.name ?? "Untitled"} · {project.sequence?.tracks?.length ?? 0} tracks ·{" "}
                {project.sequence?.settings?.fps ?? 30}fps · {project.sequence?.settings?.width ?? 1920}×{project.sequence?.settings?.height ?? 1080}
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 4px" }}>
                {messages.length === 0 && (
                  <div
                    style={{
                      color: "rgba(255,255,255,0.3)",
                      fontSize: 12,
                      textAlign: "center",
                      marginTop: 24,
                      lineHeight: 1.7,
                    }}
                  >
                    Ask me anything about your project, color grading, effects, or editing workflow.
                  </div>
                )}
                {messages.map((msg) => (
                  <div
                    key={msg.ts}
                    style={{
                      marginBottom: 10,
                      display: "flex",
                      flexDirection: msg.role === "user" ? "row-reverse" : "row",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        maxWidth: "85%",
                        padding: "8px 11px",
                        borderRadius: msg.role === "user" ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
                        background:
                          msg.role === "user"
                            ? "linear-gradient(135deg,#7c3aed,#a855f7)"
                            : "rgba(255,255,255,0.07)",
                        color: "#e8e8e8",
                        fontSize: 12,
                        lineHeight: 1.55,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                {chatBusy && (
                  <div style={{ color: "rgba(168,85,247,0.6)", fontSize: 11, marginBottom: 8 }}>
                    ● ● ●
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Suggestion banner */}
              {suggestionBanner && (
                <div className="fs-learn-banner">
                  <span>Want me to break down <strong>{suggestionBanner}</strong>?</span>
                  <button onClick={() => { void handleGenerateResource(); setSuggestionBanner(null); }}>
                    Generate
                  </button>
                  <button className="fs-learn-dismiss" onClick={() => { setSuggestionBanner(null); learningEngine.markDismissed(); }}>
                    x
                  </button>
                </div>
              )}

              {/* Input */}
              <div
                style={{
                  padding: "10px 12px",
                  borderTop: "1px solid rgba(255,255,255,0.07)",
                  display: "flex",
                  gap: 8,
                  flexShrink: 0,
                }}
              >
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about your project…"
                  rows={2}
                  style={{
                    flex: 1,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 9,
                    padding: "8px 10px",
                    color: "#e8e8e8",
                    fontSize: 12,
                    fontFamily: "inherit",
                    resize: "none",
                    outline: "none",
                    lineHeight: 1.5,
                  }}
                />
                <button
                  onClick={() => void sendChat()}
                  disabled={chatBusy || !chatInput.trim()}
                  style={{
                    padding: "0 13px",
                    borderRadius: 9,
                    background: chatBusy ? "rgba(168,85,247,0.3)" : "linear-gradient(135deg,#7c3aed,#a855f7)",
                    border: "none",
                    color: "#fff",
                    fontSize: 16,
                    cursor: chatBusy ? "not-allowed" : "pointer",
                    flexShrink: 0,
                  }}
                  title="Send (Enter)"
                >
                  ↑
                </button>
              </div>
            </div>
          )}

          {/* ── Tab: Projects ── */}
          {tab === "projects" && (
            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {projectsLoading && (
                <div
                  style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, textAlign: "center", marginTop: 24 }}
                >
                  Loading projects…
                </div>
              )}
              {!projectsLoading && projects.length === 0 && (
                <div
                  style={{
                    color: "rgba(255,255,255,0.3)",
                    fontSize: 12,
                    textAlign: "center",
                    marginTop: 24,
                    lineHeight: 1.7,
                  }}
                >
                  No recent projects synced yet.
                  <br />
                  Open a project in 264 Pro and it will appear here.
                </div>
              )}
              {projects.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 9,
                    padding: "10px 12px",
                    marginBottom: 8,
                    cursor: "default",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#e0e0e0",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      marginBottom: 4,
                    }}
                  >
                    🎬 {p.name}
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", display: "flex", gap: 10 }}>
                    {p.trackCount != null && <span>{p.trackCount} tracks</span>}
                    {p.duration != null && <span>{Math.round(p.duration)}s</span>}
                    <span>{new Date(p.lastModified).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Tab: Session ── */}
          {tab === "session" && (
            <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
              <div
                style={{
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  marginBottom: 12,
                }}
              >
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>
                  CURRENT PROJECT
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#e0e0e0", marginBottom: 6 }}>
                  {project.name ?? "Untitled Project"}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.7 }}>
                  {project.sequence?.tracks?.length ?? 0} tracks · {project.sequence?.settings?.fps ?? 30}fps · {project.sequence?.settings?.width ?? 1920}×{project.sequence?.settings?.height ?? 1080}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <ActionButton
                  icon="📤"
                  label="Log export to FlowState"
                  onClick={() => {
                    sendActivity("export_completed", { format: "mp4" });
                    setSessionMsg("Export logged ✓");
                    setTimeout(() => setSessionMsg(null), 2500);
                  }}
                />
                <ActionButton
                  icon="📂"
                  label="Log project open"
                  onClick={() => {
                    sendActivity("project_opened");
                    setSessionMsg("Activity logged ✓");
                    setTimeout(() => setSessionMsg(null), 2500);
                  }}
                />
                <ActionButton
                  icon="⏱"
                  label="Start focus session"
                  onClick={() => {
                    sendActivity("session_start", { source: "264pro" });
                    setSessionMsg("Session started in FlowState ✓");
                    setTimeout(() => setSessionMsg(null), 2500);
                  }}
                />
                <ActionButton
                  icon="🔗"
                  label="Open FlowState dashboard"
                  onClick={() => window.open(FS_BASE, "_blank")}
                />
              </div>

              {sessionMsg && (
                <div
                  style={{
                    marginTop: 14,
                    padding: "9px 12px",
                    background: "rgba(16,185,129,0.12)",
                    border: "1px solid rgba(16,185,129,0.25)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "#6ee7b7",
                    textAlign: "center",
                  }}
                >
                  {sessionMsg}
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Generate ── */}
          {tab === "generate" && (
            <div className="fs-gen-tab">
              {user.tier === "free" ? (
                <div className="fs-gen-locked">
                  <div style={{ fontSize: 32 }}>🔒</div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#e8e8e8", marginTop: 10 }}>
                    Pro Feature
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.6, marginTop: 8, textAlign: "center" }}>
                    AI Image Generation is available for Pro, Team, and Enterprise subscribers.
                  </div>
                  <a
                    href={`${FS_BASE}/upgrade?ref=264pro-imagegen`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      marginTop: 16,
                      padding: "9px 20px",
                      borderRadius: 9,
                      background: "linear-gradient(135deg,#e07820,#a855f7)",
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: 13,
                      textDecoration: "none",
                      display: "inline-block",
                    }}
                  >
                    Upgrade to Pro
                  </a>
                </div>
              ) : (
                <>
                  {/* Prompt */}
                  <div style={{ padding: "12px 12px 8px" }}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 6, fontWeight: 600 }}>PROMPT</div>
                    <textarea
                      className="fs-gen-prompt"
                      value={genPrompt}
                      onChange={e => setGenPrompt(e.target.value)}
                      placeholder="Describe the image you want to generate…"
                      rows={3}
                    />
                  </div>

                  {/* Options */}
                  <div className="fs-gen-opts">
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4, fontWeight: 600 }}>MODEL</div>
                      <select
                        value={genModel}
                        onChange={e => setGenModel(e.target.value)}
                        style={{
                          width: "100%",
                          background: "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          borderRadius: 6,
                          color: "#e8e8e8",
                          fontSize: 11,
                          padding: "5px 7px",
                        }}
                      >
                        {IMAGE_MODELS.map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4, fontWeight: 600 }}>RATIO</div>
                      <div style={{ display: "flex", gap: 4 }}>
                        {ASPECT_RATIOS.map(ar => (
                          <button
                            key={ar.value}
                            onClick={() => setGenAspect(ar.value)}
                            style={{
                              padding: "4px 7px",
                              borderRadius: 5,
                              border: `1px solid ${genAspect === ar.value ? "rgba(168,85,247,0.6)" : "rgba(255,255,255,0.12)"}`,
                              background: genAspect === ar.value ? "rgba(168,85,247,0.2)" : "rgba(255,255,255,0.05)",
                              color: genAspect === ar.value ? "#d0a0ff" : "rgba(255,255,255,0.55)",
                              fontSize: 10,
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            {ar.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Generate button */}
                  <div style={{ padding: "0 12px 12px" }}>
                    <button
                      onClick={async () => {
                        const prompt = genPrompt.trim();
                        if (!prompt || genBusy) return;
                        setGenBusy(true);
                        setGenError(null);
                        try {
                          const res = await fsApi.apiCall("/api/264pro/generate-image", "POST", {
                            prompt,
                            model: genModel,
                            aspectRatio: genAspect,
                          }) as { imageUrl?: string; error?: string };
                          if (res?.error) throw new Error(res.error);
                          const url = res?.imageUrl;
                          if (!url) throw new Error("No image returned");
                          setGenImages(prev => [{
                            id: `gi_${Date.now()}`,
                            url,
                            prompt,
                            model: genModel,
                            aspectRatio: genAspect,
                            ts: Date.now(),
                          }, ...prev]);
                        } catch (err) {
                          setGenError(err instanceof Error ? err.message : "Generation failed");
                        } finally {
                          setGenBusy(false);
                        }
                      }}
                      disabled={genBusy || !genPrompt.trim()}
                      style={{
                        width: "100%",
                        padding: "9px",
                        borderRadius: 9,
                        background: genBusy || !genPrompt.trim()
                          ? "rgba(168,85,247,0.2)"
                          : "linear-gradient(135deg,#7c3aed,#a855f7)",
                        border: "none",
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: genBusy || !genPrompt.trim() ? "not-allowed" : "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 7,
                      }}
                    >
                      {genBusy ? (
                        <><span className="import-spinner" style={{ width: 12, height: 12 }} /> Generating…</>
                      ) : "✨ Generate Image"}
                    </button>
                    {genError && (
                      <div style={{ marginTop: 8, fontSize: 11, color: "#f87171", textAlign: "center" }}>{genError}</div>
                    )}
                    <div style={{ marginTop: 6, fontSize: 10, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
                      Powered by FlowState · Uses subscription tokens
                    </div>
                  </div>

                  {/* Results grid */}
                  {genImages.length > 0 && (
                    <div className="fs-gen-results">
                      {genImages.map(img => (
                        <div key={img.id} className="fs-gen-thumb">
                          <img
                            src={img.url}
                            alt={img.prompt}
                            style={{ width: "100%", display: "block", borderRadius: "6px 6px 0 0" }}
                          />
                          <div style={{ padding: "6px 8px", background: "rgba(0,0,0,0.5)", borderRadius: "0 0 6px 6px" }}>
                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 5 }}>
                              {img.model} · {img.aspectRatio} · {new Date(img.ts).toLocaleTimeString()}
                            </div>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button
                                onClick={() => onAddImageToMediaPool?.(img.url, `AI_${img.model}_${Date.now()}.png`)}
                                style={{
                                  flex: 1,
                                  padding: "4px 6px",
                                  borderRadius: 5,
                                  background: "rgba(168,85,247,0.2)",
                                  border: "1px solid rgba(168,85,247,0.4)",
                                  color: "#d0a0ff",
                                  fontSize: 10,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                }}
                              >
                                + Media Pool
                              </button>
                              <a
                                href={img.url}
                                download={`ai_image_${img.ts}.png`}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: 5,
                                  background: "rgba(255,255,255,0.07)",
                                  border: "1px solid rgba(255,255,255,0.12)",
                                  color: "rgba(255,255,255,0.7)",
                                  fontSize: 10,
                                  fontWeight: 600,
                                  textDecoration: "none",
                                  display: "inline-flex",
                                  alignItems: "center",
                                }}
                              >
                                ⬇
                              </a>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Tab: Learn ── */}
          {tab === "learn" && (
            <div className="fs-learn-tab">
              <div className="fs-learn-header">
                <span>Learning Resources</span>
                <button
                  className="fs-learn-gen-btn"
                  onClick={() => {
                    const topic = window.prompt("What do you want to learn about?");
                    if (topic) void handleGenerateResource(topic);
                  }}
                  disabled={isGenerating}
                >
                  {isGenerating ? "Generating..." : "+ Generate"}
                </button>
              </div>
              <div className="fs-learn-level-row">
                <span className="fs-learn-level-label">Level:</span>
                {(["beginner", "intermediate", "advanced"] as const).map(lvl => (
                  <button
                    key={lvl}
                    className={"fs-learn-level-btn" + (learningEngine.level === lvl ? " active" : "")}
                    onClick={() => { learningEngine.state.detectedLevel = lvl; forceUpdate(); }}
                  >
                    {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                  </button>
                ))}
              </div>
              {activeResource ? (
                <div className="fs-learn-resource">
                  <div className="fs-resource-meta">
                    <span className="fs-resource-type">{activeResource.type.replace("_", " ")}</span>
                    <span className="fs-resource-level">{activeResource.level}</span>
                    <span className="fs-resource-topic">{activeResource.topic}</span>
                    <button className="fs-resource-back" onClick={() => setActiveResource(null)}>Back</button>
                  </div>
                  <div className="fs-resource-content">
                    {activeResource.content.split(/\n(?=#{1,3} )/).map((section, i) => {
                      const lines = section.split("\n");
                      const heading = lines[0].replace(/^#{1,3}\s*/, "");
                      const body = lines.slice(1).join("\n");
                      const isH1 = lines[0].startsWith("# ");
                      const isH2 = lines[0].startsWith("## ");
                      return (
                        <div key={i} className={"fs-section " + (isH1 ? "h1" : isH2 ? "h2" : "h3")}>
                          <div className="fs-section-heading">{heading}</div>
                          <div className="fs-section-body">{body}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="fs-learn-list">
                  {learningEngine.resources.length === 0 ? (
                    <div className="fs-learn-empty">
                      <p>No resources yet.</p>
                      <p>Chat with the AI assistant and it will automatically detect when you need help and offer to generate a breakdown.</p>
                      <p>Or click Generate above to create one on any topic.</p>
                    </div>
                  ) : (
                    learningEngine.resources.map(r => (
                      <button key={r.id} className="fs-resource-card" onClick={() => setActiveResource(r)}>
                        <div className="fs-rc-type">{r.type.replace("_", " ")}</div>
                        <div className="fs-rc-topic">{r.topic}</div>
                        <div className="fs-rc-meta">{r.level} - {new Date(r.ts).toLocaleDateString()}</div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Helper: action button ──────────────────────────────────────────────────────
function ActionButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "10px 12px",
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: 9,
        color: "#d0d0d0",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        textAlign: "left",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.09)")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)")}
    >
      <span style={{ fontSize: 15, flexShrink: 0 }}>{icon}</span>
      {label}
    </button>
  );
}
