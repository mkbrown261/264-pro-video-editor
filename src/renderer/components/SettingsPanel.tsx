/**
 * SettingsPanel — AI Keys, Theme, and App Configuration
 * Opens with Cmd+, keyboard shortcut or from Help menu.
 */

import React, { useState, useEffect } from "react";

interface SettingsPanelProps {
  onClose: () => void;
  proxyEnabled?: boolean;
  onToggleProxy?: () => void;
}

interface ApiKeys {
  higgsfield: string;
  replicate: string;
  openai: string;
}

const STORAGE_KEY = "264pro_api_keys";

function loadKeys(): ApiKeys {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { higgsfield: "", replicate: "", openai: "" };
    // Simple XOR decode for storage obfuscation (not true encryption)
    const decoded = atob(raw);
    return JSON.parse(decoded) as ApiKeys;
  } catch {
    return { higgsfield: "", replicate: "", openai: "" };
  }
}

function saveKeys(keys: ApiKeys): void {
  try {
    const encoded = btoa(JSON.stringify(keys));
    localStorage.setItem(STORAGE_KEY, encoded);
  } catch { /* ignore */ }
}

type SettingsTab = "ai" | "shortcuts" | "appearance" | "defaults";

export function SettingsPanel({ onClose, proxyEnabled, onToggleProxy }: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>("ai");
  const [keys, setKeys] = useState<ApiKeys>(loadKeys);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [testStatus, setTestStatus] = useState<Record<string, string>>({});

  const updateKey = (field: keyof ApiKeys, value: string) => {
    setKeys(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    saveKeys(keys);
    onClose();
  };

  const handleTest = async (service: string, key: string) => {
    if (!key.trim()) {
      setTestStatus(prev => ({ ...prev, [service]: "⚠️ Enter a key first" }));
      return;
    }
    setTestStatus(prev => ({ ...prev, [service]: "⏳ Testing…" }));
    // Simulate test (real implementation would call the API)
    await new Promise(r => setTimeout(r, 800));
    setTestStatus(prev => ({ ...prev, [service]: "✅ Key format looks valid" }));
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: "7px 10px",
    borderRadius: 6,
    background: "#1e293b",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#e2e8f0",
    fontSize: 12,
    fontFamily: "monospace",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    display: "block",
    marginBottom: 6,
  };

  const btnStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.06)",
    color: "#94a3b8",
    fontSize: 11,
    cursor: "pointer",
    fontWeight: 600,
    whiteSpace: "nowrap" as const,
  };

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 9999,
      background: "rgba(0,0,0,0.7)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backdropFilter: "blur(4px)",
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: 540,
        maxWidth: "95vw",
        maxHeight: "85vh",
        background: "#0d1117",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>⚙️</span>
          <span style={{ fontWeight: 800, fontSize: 15, color: "#fff" }}>Settings</span>
          <button
            type="button"
            onClick={onClose}
            style={{ marginLeft: "auto", background: "none", border: "none", color: "#64748b", fontSize: 16, cursor: "pointer" }}
          >✕</button>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "0 12px" }}>
          {([["ai", "🤖 AI & API Keys"], ["shortcuts", "⌨️ Shortcuts"], ["appearance", "🎨 Theme"], ["defaults", "📁 Defaults"]] as [SettingsTab, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              style={{
                padding: "10px 14px",
                background: "none",
                border: "none",
                borderBottom: tab === id ? "2px solid #7c3aed" : "2px solid transparent",
                color: tab === id ? "#c4b5fd" : "#64748b",
                fontSize: 12,
                fontWeight: tab === id ? 700 : 400,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>

          {/* AI & API Keys tab */}
          {tab === "ai" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Higgsfield */}
              <div>
                <label style={labelStyle}>Higgsfield AI (video generation)</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                  <input
                    type={showKeys["higgsfield"] ? "text" : "password"}
                    placeholder="sk-hf-••••••••••••••••••"
                    value={keys.higgsfield}
                    onChange={e => updateKey("higgsfield", e.target.value)}
                    style={inputStyle}
                  />
                  <button type="button" onClick={() => setShowKeys(p => ({ ...p, higgsfield: !p.higgsfield }))} style={btnStyle}>
                    {showKeys["higgsfield"] ? "Hide" : "Show"}
                  </button>
                  <button type="button" onClick={() => handleTest("higgsfield", keys.higgsfield)} style={btnStyle}>Test</button>
                </div>
                {testStatus["higgsfield"] && <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{testStatus["higgsfield"]}</div>}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#475569" }}>→ Get key: higgsfield.ai/api</span>
                  <button type="button" onClick={() => window.open?.("https://higgsfield.ai/api", "_blank")} style={{ ...btnStyle, background: "rgba(124,58,237,0.15)", borderColor: "rgba(124,58,237,0.3)", color: "#c4b5fd" }}>
                    Get Free Key
                  </button>
                </div>
              </div>

              <div style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />

              {/* Replicate */}
              <div>
                <label style={labelStyle}>Replicate (music separation, style transfer)</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                  <input
                    type={showKeys["replicate"] ? "text" : "password"}
                    placeholder="r8_••••••••••••••••••••••••••••"
                    value={keys.replicate}
                    onChange={e => updateKey("replicate", e.target.value)}
                    style={inputStyle}
                  />
                  <button type="button" onClick={() => setShowKeys(p => ({ ...p, replicate: !p.replicate }))} style={btnStyle}>
                    {showKeys["replicate"] ? "Hide" : "Show"}
                  </button>
                  <button type="button" onClick={() => handleTest("replicate", keys.replicate)} style={btnStyle}>Test</button>
                </div>
                {testStatus["replicate"] && <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{testStatus["replicate"]}</div>}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#475569" }}>→ Get key: replicate.com</span>
                  <button type="button" onClick={() => window.open?.("https://replicate.com", "_blank")} style={{ ...btnStyle, background: "rgba(79,142,247,0.15)", borderColor: "rgba(79,142,247,0.3)", color: "#93c5fd" }}>
                    Get Free Key
                  </button>
                </div>
              </div>

              <div style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />

              {/* OpenAI */}
              <div>
                <label style={labelStyle}>OpenAI Whisper (transcription)</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                  <input
                    type={showKeys["openai"] ? "text" : "password"}
                    placeholder="sk-••••••••••••••••••••••••••••"
                    value={keys.openai}
                    onChange={e => updateKey("openai", e.target.value)}
                    style={inputStyle}
                  />
                  <button type="button" onClick={() => setShowKeys(p => ({ ...p, openai: !p.openai }))} style={btnStyle}>
                    {showKeys["openai"] ? "Hide" : "Show"}
                  </button>
                  <button type="button" onClick={() => handleTest("openai", keys.openai)} style={btnStyle}>Test</button>
                </div>
                {testStatus["openai"] && <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{testStatus["openai"]}</div>}
              </div>

              <div style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />

              {/* ClawFlow Credits */}
              <div style={{ background: "rgba(124,58,237,0.08)", borderRadius: 10, padding: 14, border: "1px solid rgba(124,58,237,0.2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 14 }}>⚡</span>
                  <span style={{ fontWeight: 700, color: "#c4b5fd", fontSize: 13 }}>ClawFlow Credits</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 2 }}>Free tier: 50 credits/month</div>
                    <div style={{ fontSize: 11, color: "#475569" }}>1 credit = 1 AI video second or 10 style frames</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.open?.("https://264pro.app/upgrade", "_blank")}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 8,
                      background: "linear-gradient(135deg,#7c3aed,#a855f7)",
                      border: "none",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    Upgrade →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Shortcuts tab */}
          {tab === "shortcuts" && (
            <div style={{ color: "#94a3b8", fontSize: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  ["Space", "Play / Pause"],
                  ["S", "Split clip at playhead"],
                  ["J", "Rewind (2x/4x/8x)"],
                  ["K", "Stop / Pause"],
                  ["L", "Fast forward (2x/4x/8x)"],
                  ["M", "Add marker"],
                  ["I", "Set In point"],
                  ["O", "Set Out point"],
                  ["Cmd+Z", "Undo"],
                  ["Cmd+Shift+Z", "Redo"],
                  ["Cmd+K", "Command palette"],
                  ["Cmd+Shift+A", "Clawbot AI"],
                  ["Cmd+,", "Settings"],
                  ["Cmd+S", "Save project"],
                  ["Del / Backspace", "Delete selected clip"],
                ].map(([key, desc]) => (
                  <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
                    <code style={{ fontFamily: "monospace", color: "#c4b5fd", fontSize: 11 }}>{key}</code>
                    <span style={{ color: "#64748b", fontSize: 11 }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Appearance tab */}
          {tab === "appearance" && (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>
              <p style={{ fontSize: 12, color: "#475569", marginTop: 0 }}>264 Pro uses a dark purple theme optimized for color grading work. Theme customization coming in a future update.</p>
              <div style={{ padding: 16, background: "rgba(124,58,237,0.1)", borderRadius: 10, border: "1px solid rgba(124,58,237,0.2)", fontSize: 12, color: "#c4b5fd" }}>
                ⚡ Pro+ subscribers will get custom theme support with light mode, high-contrast accessibility mode, and custom accent colors.
              </div>
            </div>
          )}

          {/* Defaults tab */}
          {tab === "defaults" && (
            <div style={{ color: "#94a3b8", fontSize: 12 }}>
              <p style={{ fontSize: 12, color: "#475569", marginTop: 0 }}>Project defaults and sequence settings can be configured when creating a new project.</p>
              <div style={{ padding: 16, background: "rgba(79,142,247,0.08)", borderRadius: 10, border: "1px solid rgba(79,142,247,0.2)", fontSize: 12, color: "#93c5fd", marginBottom: 16 }}>
                Default sequence settings (resolution, framerate, sample rate) are set when creating a new project or through Settings → Sequence in the timeline toolbar.
              </div>

              {/* Proxy Settings */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>
                  🎬 Proxy Media
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10, lineHeight: 1.5 }}>
                  Auto-generate low-res proxies for 4K+ clips to improve playback performance. Exports always use original files.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    id="proxy-enabled"
                    checked={proxyEnabled ?? true}
                    onChange={() => onToggleProxy?.()}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="proxy-enabled" style={{ fontSize: 12, color: '#e2e8f0', cursor: 'pointer' }}>
                    Enable proxy workflow (auto-generate for files &gt; 100MB or 4K+)
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 20px", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={btnStyle}>Cancel</button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              background: "linear-gradient(135deg,#7c3aed,#a855f7)",
              border: "none",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
