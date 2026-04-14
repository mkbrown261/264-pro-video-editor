import React, { useState } from "react";
import type { TitleClipConfig, TitlePreset } from "../../shared/models";
import { createId } from "../../shared/models";

interface TitleGeneratorPanelProps {
  fps: number;
  onAddTitleToTimeline: (config: TitleClipConfig) => void;
}

const PRESET_DEFAULTS: Record<TitlePreset, Partial<TitleClipConfig>> = {
  lower_third:  { posX: 0.05, posY: 0.72, bgOpacity: 0.75, animationIn: "slide_up", animationOut: "fade" },
  full_screen:  { posX: 0.5, posY: 0.5, bgOpacity: 0.9, animationIn: "fade", animationOut: "fade" },
  kinetic_text: { posX: 0.5, posY: 0.45, bgOpacity: 0, animationIn: "slide_right", animationOut: "slide_left" },
  minimal:      { posX: 0.5, posY: 0.82, bgOpacity: 0, animationIn: "fade", animationOut: "fade" },
  broadcast:    { posX: 0.05, posY: 0.68, bgOpacity: 0.92, animationIn: "slide_up", animationOut: "fade" },
  credits:      { posX: 0.5, posY: 1.0, bgOpacity: 0, animationIn: "none", animationOut: "none" },
};

const PRESET_LABELS: Record<TitlePreset, string> = {
  lower_third:  "Lower Third",
  full_screen:  "Full Screen",
  kinetic_text: "Kinetic Text",
  minimal:      "Minimal",
  broadcast:    "Broadcast",
  credits:      "End Credits",
};

const FONTS = ["Space Grotesk", "Arial", "Impact", "Helvetica", "Georgia", "Courier New"];

export function TitleGeneratorPanel({ fps, onAddTitleToTimeline }: TitleGeneratorPanelProps) {
  const [preset, setPreset] = useState<TitlePreset>("lower_third");
  const [mainText, setMainText] = useState("John Smith");
  const [subText, setSubText] = useState("Senior Developer");
  const [fontFamily, setFontFamily] = useState("Space Grotesk");
  const [fontSize, setFontSize] = useState(42);
  const [color, setColor] = useState("#ffffff");
  const [bgColor, setBgColor] = useState("#000000");
  const [bgOpacity, setBgOpacity] = useState(0.7);
  const [animationIn, setAnimationIn] = useState<TitleClipConfig["animationIn"]>("slide_up");
  const [animationOut, setAnimationOut] = useState<TitleClipConfig["animationOut"]>("fade");
  const [durationSecs, setDurationSecs] = useState(3.0);

  function handlePresetChange(p: TitlePreset) {
    setPreset(p);
    const defaults = PRESET_DEFAULTS[p];
    if (defaults.bgOpacity !== undefined) setBgOpacity(defaults.bgOpacity);
    if (defaults.animationIn) setAnimationIn(defaults.animationIn);
    if (defaults.animationOut) setAnimationOut(defaults.animationOut);
  }

  function handleAdd() {
    const pDefaults = PRESET_DEFAULTS[preset];
    const config: TitleClipConfig = {
      preset,
      mainText,
      subText: subText || undefined,
      fontFamily,
      fontSize,
      color,
      bgColor,
      bgOpacity,
      animationIn,
      animationOut,
      durationFrames: Math.round(durationSecs * fps),
      posX: pDefaults.posX ?? 0.5,
      posY: pDefaults.posY ?? 0.5,
    };
    onAddTitleToTimeline(config);
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: "#64748b",
    textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, display: "block",
  };

  const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 5,
    color: "#e2e8f0",
    fontSize: 12,
    padding: "5px 8px",
    width: "100%",
    boxSizing: "border-box" as const,
  };

  const selectStyle = { ...inputStyle };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0d1117", color: "#e2e8f0", fontSize: 12 }}>
      {/* Header */}
      <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 800 }}>T</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Title Generator</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {/* Preset */}
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Preset</label>
          <select value={preset} onChange={e => handlePresetChange(e.target.value as TitlePreset)} style={selectStyle}>
            {(Object.keys(PRESET_LABELS) as TitlePreset[]).map(p => (
              <option key={p} value={p}>{PRESET_LABELS[p]}</option>
            ))}
          </select>
        </div>

        {/* Main text */}
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Main Text</label>
          <input value={mainText} onChange={e => setMainText(e.target.value)} style={inputStyle} placeholder="Enter main title text" />
        </div>

        {/* Sub text */}
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Sub Text</label>
          <input value={subText} onChange={e => setSubText(e.target.value)} style={inputStyle} placeholder="Optional subtitle/role" />
        </div>

        {/* Font & size */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Font</label>
            <select value={fontFamily} onChange={e => setFontFamily(e.target.value)} style={selectStyle}>
              {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Size</label>
            <input type="number" min={12} max={200} value={fontSize} onChange={e => setFontSize(Number(e.target.value))}
              style={{ ...inputStyle, width: 60 }} />
          </div>
        </div>

        {/* Color & BG */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Text Color</label>
            <input type="color" value={color} onChange={e => setColor(e.target.value)}
              style={{ width: "100%", height: 32, borderRadius: 5, border: "none", cursor: "pointer" }} />
          </div>
          <div>
            <label style={labelStyle}>BG Color</label>
            <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
              style={{ width: "100%", height: 32, borderRadius: 5, border: "none", cursor: "pointer" }} />
          </div>
        </div>

        {/* BG opacity */}
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>BG Opacity ({Math.round(bgOpacity * 100)}%)</label>
          <input type="range" min={0} max={1} step={0.05} value={bgOpacity} onChange={e => setBgOpacity(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#7c3aed" }} />
        </div>

        {/* Animation in/out */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Anim In</label>
            <select value={animationIn} onChange={e => setAnimationIn(e.target.value as TitleClipConfig["animationIn"])} style={selectStyle}>
              <option value="fade">Fade</option>
              <option value="slide_up">Slide Up</option>
              <option value="slide_right">Slide Right</option>
              <option value="typewriter">Typewriter</option>
              <option value="none">None</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Anim Out</label>
            <select value={animationOut} onChange={e => setAnimationOut(e.target.value as TitleClipConfig["animationOut"])} style={selectStyle}>
              <option value="fade">Fade</option>
              <option value="slide_down">Slide Down</option>
              <option value="slide_left">Slide Left</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>

        {/* Duration */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Duration</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="number" min={0.5} max={30} step={0.5} value={durationSecs} onChange={e => setDurationSecs(Number(e.target.value))}
              style={{ ...inputStyle, width: 80 }} />
            <span style={{ color: "#64748b", fontSize: 11 }}>seconds</span>
          </div>
        </div>

        {/* Preview */}
        <div style={{
          marginBottom: 16,
          background: "#000",
          borderRadius: 8,
          height: 80,
          display: "flex",
          alignItems: preset === "lower_third" || preset === "broadcast" ? "flex-end" : "center",
          justifyContent: "center",
          padding: 8,
          position: "relative",
          overflow: "hidden",
        }}>
          <div style={{
            fontFamily,
            color,
            background: bgOpacity > 0 ? `${bgColor}${Math.round(bgOpacity * 255).toString(16).padStart(2,"0")}` : "transparent",
            padding: "4px 12px",
            borderRadius: 4,
            textAlign: "center",
          }}>
            <div style={{ fontWeight: 800, fontSize: Math.min(fontSize * 0.35, 18) }}>{mainText || "Title Text"}</div>
            {subText && <div style={{ fontSize: Math.min(fontSize * 0.35 * 0.6, 11), opacity: 0.85 }}>{subText}</div>}
          </div>
        </div>

        {/* Add button */}
        <button
          onClick={handleAdd}
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: 8,
            border: "none",
            background: "linear-gradient(135deg,#7c3aed,#a855f7)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          + Add to Timeline
        </button>
      </div>
    </div>
  );
}
