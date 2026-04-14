import React, { useState, useRef } from "react";
import type { SubtitleCue, SubtitleStyle } from "../../shared/models";
import { DEFAULT_SUBTITLE_STYLE, createId } from "../../shared/models";
import { toast } from "../lib/toast";

interface SubtitlesPanelProps {
  cues: SubtitleCue[];
  playheadFrame: number;
  fps: number;
  onAddCue: (cue: SubtitleCue) => void;
  onUpdateCue: (id: string, updates: Partial<SubtitleCue>) => void;
  onRemoveCue: (id: string) => void;
  onSeekToFrame: (frame: number) => void;
}

function framesTo_SRT_Time(frames: number, fps: number): string {
  const totalMs = Math.round((frames / fps) * 1000);
  const ms = totalMs % 1000;
  const s = Math.floor(totalMs / 1000) % 60;
  const m = Math.floor(totalMs / 60000) % 60;
  const h = Math.floor(totalMs / 3600000);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
}

function framesToDisplay(frames: number, fps: number): string {
  const secs = frames / fps;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2,"0")}`;
}

function srtTimeToMs(time: string): number {
  // 00:00:01,000
  const [hms, ms] = time.split(",");
  const parts = hms.split(":").map(Number);
  return parts[0] * 3600000 + parts[1] * 60000 + parts[2] * 1000 + Number(ms);
}

function parseSRT(srt: string, fps: number): SubtitleCue[] {
  const blocks = srt.trim().split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 3) continue;
    const timeLine = lines.find(l => l.includes("-->"));
    if (!timeLine) continue;
    const [startStr, endStr] = timeLine.split("-->").map(s => s.trim());
    const startMs = srtTimeToMs(startStr);
    const endMs = srtTimeToMs(endStr);
    const text = lines.filter(l => !l.includes("-->") && !/^\d+$/.test(l.trim())).join("\n");
    cues.push({
      id: createId(),
      startFrame: Math.round((startMs / 1000) * fps),
      endFrame: Math.round((endMs / 1000) * fps),
      text: text.trim(),
      style: { ...DEFAULT_SUBTITLE_STYLE },
    });
  }
  return cues;
}

function generateSRT(cues: SubtitleCue[], fps: number): string {
  return [...cues]
    .sort((a, b) => a.startFrame - b.startFrame)
    .map((cue, i) => `${i + 1}\n${framesTo_SRT_Time(cue.startFrame, fps)} --> ${framesTo_SRT_Time(cue.endFrame, fps)}\n${cue.text}`)
    .join("\n\n");
}

export function SubtitlesPanel({ cues, playheadFrame, fps, onAddCue, onUpdateCue, onRemoveCue, onSeekToFrame }: SubtitlesPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [globalStyle, setGlobalStyle] = useState<SubtitleStyle>({ ...DEFAULT_SUBTITLE_STYLE });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sorted = [...cues].sort((a, b) => a.startFrame - b.startFrame);

  function handleAdd() {
    const startFrame = playheadFrame;
    const endFrame = startFrame + Math.round(fps * 2);
    const cue: SubtitleCue = {
      id: createId(),
      startFrame,
      endFrame,
      text: "New subtitle",
      style: { ...globalStyle },
    };
    onAddCue(cue);
    setEditingId(cue.id);
  }

  function handleAITranscribe() {
    toast.warning("AI transcription requires API key. Add your key in Settings → AI.");
  }

  function handleImportSRT() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const imported = parseSRT(text, fps);
      imported.forEach(cue => onAddCue(cue));
      toast.success(`Imported ${imported.length} subtitle cues from SRT`);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleExportSRT() {
    const srtContent = generateSRT(cues, fps);
    const blob = new Blob([srtContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "subtitles.srt";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Subtitles exported as SRT");
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: "#64748b",
    textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4,
  };

  const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 5,
    color: "#e2e8f0",
    fontSize: 12,
    padding: "4px 8px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0d1117", color: "#e2e8f0", fontSize: 12 }}>
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept=".srt" style={{ display: "none" }} onChange={handleFileChange} />

      {/* Header toolbar */}
      <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginRight: 6 }}>📝 Subtitles</span>
        <button
          onClick={handleAdd}
          style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: "linear-gradient(135deg,#7c3aed,#a855f7)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
        >
          + Add Cue
        </button>
        <button
          onClick={handleAITranscribe}
          style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(168,85,247,0.3)", background: "rgba(168,85,247,0.1)", color: "#d0a0ff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
        >
          🤖 AI Transcribe
        </button>
        <button
          onClick={handleImportSRT}
          style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "#94a3b8", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
        >
          Import SRT
        </button>
        <button
          onClick={handleExportSRT}
          style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "#94a3b8", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
        >
          Export SRT
        </button>
      </div>

      {/* Cue list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
        {sorted.length === 0 && (
          <div style={{ textAlign: "center", color: "#475569", padding: "24px 0", fontSize: 12 }}>
            No subtitle cues. Click "+ Add Cue" or "Import SRT" to get started.
          </div>
        )}
        {sorted.map((cue) => (
          <div
            key={cue.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 8px",
              borderRadius: 6,
              marginBottom: 4,
              background: playheadFrame >= cue.startFrame && playheadFrame < cue.endFrame
                ? "rgba(124,58,237,0.18)"
                : "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.07)",
              cursor: "pointer",
            }}
            onClick={() => onSeekToFrame(cue.startFrame)}
          >
            <span style={{ fontSize: 11, color: "#64748b", minWidth: 42, fontFamily: "monospace" }}>
              {framesToDisplay(cue.startFrame, fps)}
            </span>
            <span style={{ fontSize: 11, color: "#64748b", minWidth: 42, fontFamily: "monospace" }}>
              {framesToDisplay(cue.endFrame, fps)}
            </span>
            {editingId === cue.id ? (
              <input
                autoFocus
                value={cue.text}
                onChange={e => onUpdateCue(cue.id, { text: e.target.value })}
                onBlur={() => setEditingId(null)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") setEditingId(null); }}
                style={{ ...inputStyle, flex: 1 }}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span style={{ flex: 1, fontSize: 12, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {cue.text}
              </span>
            )}
            <button
              onClick={e => { e.stopPropagation(); setEditingId(cue.id); }}
              style={{ padding: "2px 6px", borderRadius: 4, border: "none", background: "rgba(255,255,255,0.06)", color: "#94a3b8", cursor: "pointer", fontSize: 11 }}
              title="Edit"
            >✏</button>
            <button
              onClick={e => { e.stopPropagation(); onRemoveCue(cue.id); }}
              style={{ padding: "2px 6px", borderRadius: 4, border: "none", background: "rgba(239,68,68,0.12)", color: "#f87171", cursor: "pointer", fontSize: 11 }}
              title="Delete"
            >🗑</button>
          </div>
        ))}
      </div>

      {/* Style controls */}
      <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
        <div style={{ ...labelStyle, marginBottom: 8 }}>Style Controls</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <div style={labelStyle}>Font</div>
            <select
              value={globalStyle.fontFamily}
              onChange={e => setGlobalStyle(s => ({ ...s, fontFamily: e.target.value }))}
              style={{ ...inputStyle, width: "100%" }}
            >
              {["Arial", "Impact", "Helvetica", "Space Grotesk", "Georgia", "Courier New"].map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={labelStyle}>Size</div>
            <input
              type="number" min={12} max={120}
              value={globalStyle.fontSize}
              onChange={e => setGlobalStyle(s => ({ ...s, fontSize: Number(e.target.value) }))}
              style={{ ...inputStyle, width: "100%" }}
            />
          </div>
          <div>
            <div style={labelStyle}>Color</div>
            <input type="color" value={globalStyle.color}
              onChange={e => setGlobalStyle(s => ({ ...s, color: e.target.value }))}
              style={{ width: "100%", height: 28, borderRadius: 5, border: "none", cursor: "pointer" }}
            />
          </div>
          <div>
            <div style={labelStyle}>Position</div>
            <select
              value={globalStyle.position}
              onChange={e => setGlobalStyle(s => ({ ...s, position: e.target.value as SubtitleStyle["position"] }))}
              style={{ ...inputStyle, width: "100%" }}
            >
              <option value="bottom">Bottom</option>
              <option value="center">Center</option>
              <option value="top">Top</option>
            </select>
          </div>
          <div>
            <div style={labelStyle}>Alignment</div>
            <select
              value={globalStyle.alignment}
              onChange={e => setGlobalStyle(s => ({ ...s, alignment: e.target.value as SubtitleStyle["alignment"] }))}
              style={{ ...inputStyle, width: "100%" }}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div>
            <div style={labelStyle}>Outline Width</div>
            <input type="number" min={0} max={4}
              value={globalStyle.outlineWidth}
              onChange={e => setGlobalStyle(s => ({ ...s, outlineWidth: Number(e.target.value) }))}
              style={{ ...inputStyle, width: "100%" }}
            />
          </div>
        </div>
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={globalStyle.bold} onChange={e => setGlobalStyle(s => ({ ...s, bold: e.target.checked }))} style={{ accentColor: "#7c3aed" }} />
            <span style={{ fontSize: 11, color: "#94a3b8" }}>Bold</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={globalStyle.italic} onChange={e => setGlobalStyle(s => ({ ...s, italic: e.target.checked }))} style={{ accentColor: "#7c3aed" }} />
            <span style={{ fontSize: 11, color: "#94a3b8" }}>Italic</span>
          </label>
        </div>
      </div>
    </div>
  );
}
