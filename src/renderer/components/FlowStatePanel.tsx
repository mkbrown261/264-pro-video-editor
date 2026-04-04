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
    };
    editorApi?: { notifyAppReady?: () => void };
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

// ── Main component ────────────────────────────────────────────────────────────
interface FlowStatePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = "assistant" | "projects" | "session";

export function FlowStatePanel({ isOpen, onClose }: FlowStatePanelProps) {
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
    const clips = project.tracks.flatMap((t) => t.clips);
    const ctx = {
      projectId: `local_${Date.now()}`,
      projectName: project.name ?? "Untitled Project",
      totalDurationSec: project.durationFrames / (project.fps || 30),
      trackCount: project.tracks.length,
      clipCount: clips.length,
      assetTypes: [...new Set(clips.map((c) => (c as any).assetType ?? "video"))],
      fps: project.fps,
      resolution: `${project.width}×${project.height}`,
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
    const userMsg: ChatMessage = { role: "user", content: text, ts: Date.now() };
    setMessages((m) => [...m, userMsg]);
    setChatBusy(true);
    try {
      const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
      const res = (await fsApi.apiCall("/api/264pro/ai-chat", "POST", {
        messages: history,
        projectContext: {
          projectName: project.name ?? "Untitled",
          trackCount: project.tracks.length,
          fps: project.fps,
          resolution: `${project.width}×${project.height}`,
        },
      })) as any;
      const reply = res?.reply ?? res?.message ?? "Sorry, I couldn't get a response.";
      setMessages((m) => [...m, { role: "assistant", content: reply, ts: Date.now() }]);
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
            {(["assistant", "projects", "session"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1,
                  padding: "9px 4px",
                  background: "none",
                  border: "none",
                  borderBottom: `2px solid ${tab === t ? "#a855f7" : "transparent"}`,
                  color: tab === t ? "#d0a0ff" : "rgba(255,255,255,0.4)",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "color 0.15s",
                  textTransform: "capitalize",
                }}
              >
                {t === "assistant" ? "🤖 AI" : t === "projects" ? "📁 Projects" : "⚡ Session"}
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
                📎 Context: {project.name ?? "Untitled"} · {project.tracks.length} tracks ·{" "}
                {project.fps}fps · {project.width}×{project.height}
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
                  {project.tracks.length} tracks · {project.fps}fps · {project.width}×{project.height}
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
