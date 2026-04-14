/**
 * ShotListPanel — EXCLUSIVE 3: Shot List & Script Integration
 * Import .fountain or plain text → parse scenes → create markers + shot list.
 * Check off shots as you edit.
 */
import React, { useCallback, useRef, useState } from "react";
import { createId } from "../../shared/models";
import type { TimelineMarker } from "../../shared/models";

export interface ShotItem {
  id: string;
  sceneNumber: number;
  slug: string;           // INT. OFFICE - DAY
  description: string;
  characters: string[];
  checked: boolean;
  markerFrame: number;
  color: string;
}

const SLUG_COLORS = ["#ef5350","#f7c948","#2fc77a","#4f8ef7","#a855f7","#e07820"];

function parseFountain(text: string, fps: number): ShotItem[] {
  const lines = text.split("\n");
  const shots: ShotItem[] = [];
  let sceneNum = 0;

  // Simple fountain parser: look for scene headings (INT./EXT.)
  const sceneHeadingRegex = /^(INT|EXT|INT\.?\/EXT|I\/E)[\.\s]/i;
  const charRegex = /^[A-Z][A-Z\s]+(\([^)]*\))?$/;

  let currentChars: string[] = [];
  let currentDesc: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { currentChars = []; currentDesc = []; continue; }

    if (sceneHeadingRegex.test(line)) {
      sceneNum++;
      // Estimate position: 60 seconds per scene as default
      const markerFrame = (sceneNum - 1) * 60 * fps;
      shots.push({
        id: createId(),
        sceneNumber: sceneNum,
        slug: line,
        description: "",
        characters: [],
        checked: false,
        markerFrame,
        color: SLUG_COLORS[sceneNum % SLUG_COLORS.length],
      });
      currentChars = [];
      currentDesc = [];
    } else if (shots.length > 0) {
      const last = shots[shots.length - 1];
      // Collect characters
      if (charRegex.test(line) && line.length < 40) {
        currentChars.push(line.split("(")[0].trim());
        last.characters = [...new Set(currentChars)];
      } else if (line.length > 0 && !line.startsWith("(")) {
        currentDesc.push(line);
        last.description = currentDesc.slice(0, 2).join(" · ");
      }
    }
  }

  return shots;
}

function parsePlainText(text: string, fps: number): ShotItem[] {
  // For plain text: each line is a shot/scene
  const lines = text.split("\n").filter(l => l.trim().length > 0);
  return lines.slice(0, 50).map((line, i) => ({
    id: createId(),
    sceneNumber: i + 1,
    slug: line.trim().slice(0, 60),
    description: "",
    characters: [],
    checked: false,
    markerFrame: i * 60 * fps,
    color: SLUG_COLORS[i % SLUG_COLORS.length],
  }));
}

interface Props {
  fps: number;
  existingMarkers: TimelineMarker[];
  onAddMarkers: (markers: Omit<TimelineMarker, "id">[]) => void;
  onClose: () => void;
}

export function ShotListPanel({ fps, existingMarkers, onAddMarkers, onClose }: Props) {
  const [shots, setShots] = useState<ShotItem[]>([]);
  const [scriptText, setScriptText] = useState("");
  const [showImport, setShowImport] = useState(shots.length === 0);
  const fileRef = useRef<HTMLInputElement>(null);

  const parseAndLoad = useCallback((text: string) => {
    const isFountain = /^(INT|EXT|INT\.?\/EXT)/im.test(text);
    const parsed = isFountain ? parseFountain(text, fps) : parsePlainText(text, fps);
    setShots(parsed);
    setShowImport(false);
  }, [fps]);

  function handleFileLoad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setScriptText(text);
      parseAndLoad(text);
    };
    reader.readAsText(file);
  }

  function handleTextParse() {
    if (!scriptText.trim()) return;
    parseAndLoad(scriptText);
  }

  function toggleCheck(id: string) {
    setShots(prev => prev.map(s => s.id === id ? { ...s, checked: !s.checked } : s));
  }

  function handleAddMarkers() {
    onAddMarkers(shots.map(s => ({ frame: s.markerFrame, label: `Sc. ${s.sceneNumber}: ${s.slug.slice(0, 30)}`, color: s.color })));
  }

  const done = shots.filter(s => s.checked).length;
  const pct = shots.length > 0 ? Math.round((done / shots.length) * 100) : 0;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.76)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 8100 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#1a1a1f", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, width: 620, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#e8e8e8" }}>🎞 Shot List & Script</div>
            {shots.length > 0 && (
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                {done}/{shots.length} shots checked — {pct}% complete
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setShowImport(true)} style={{ padding: "5px 10px", borderRadius: 6, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)", fontSize: 11, cursor: "pointer" }} type="button">Import Script</button>
            {shots.length > 0 && (
              <button onClick={handleAddMarkers} style={{ padding: "5px 10px", borderRadius: 6, background: "rgba(79,142,247,0.15)", border: "1px solid rgba(79,142,247,0.3)", color: "#4f8ef7", fontSize: 11, cursor: "pointer" }} type="button">Add Markers</button>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16 }} type="button">✕</button>
          </div>
        </div>

        {/* Progress bar */}
        {shots.length > 0 && (
          <div style={{ height: 3, background: "rgba(255,255,255,0.06)" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg,#2fc77a,#4f8ef7)", transition: "width 0.3s" }} />
          </div>
        )}

        {/* Import panel */}
        {showImport && (
          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
              Import a <strong style={{ color: "#e8e8e8" }}>.fountain</strong> script or paste plain text (one scene/shot per line).
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => fileRef.current?.click()}
                style={{ flex: 1, padding: "10px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px dashed rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.55)", fontSize: 12, cursor: "pointer", textAlign: "center" }}
                type="button"
              >
                📄 Choose .fountain or .txt file
              </button>
            </div>
            <input ref={fileRef} type="file" accept=".fountain,.txt,.fdx" style={{ display: "none" }} onChange={handleFileLoad} />
            <textarea
              value={scriptText}
              onChange={e => setScriptText(e.target.value)}
              placeholder="Or paste your script / shot list here…"
              rows={6}
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e8e8", fontSize: 11, padding: "10px 12px", resize: "vertical", outline: "none", fontFamily: "monospace" }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {shots.length > 0 && <button onClick={() => setShowImport(false)} style={{ padding: "7px 14px", borderRadius: 7, background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.5)", fontSize: 12, cursor: "pointer" }} type="button">Cancel</button>}
              <button
                onClick={handleTextParse}
                disabled={!scriptText.trim()}
                style={{ padding: "7px 16px", borderRadius: 7, background: scriptText.trim() ? "linear-gradient(135deg,#4f8ef7,#7c3aed)" : "rgba(255,255,255,0.08)", border: "none", color: "#fff", fontSize: 12, fontWeight: 700, cursor: scriptText.trim() ? "pointer" : "not-allowed" }}
                type="button"
              >
                Parse Script
              </button>
            </div>
          </div>
        )}

        {/* Shot list */}
        {!showImport && shots.length > 0 && (
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            {shots.map((shot) => (
              <div
                key={shot.id}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "8px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)",
                  opacity: shot.checked ? 0.45 : 1, transition: "opacity 0.2s",
                }}
              >
                <div
                  style={{ width: 3, alignSelf: "stretch", borderRadius: 2, flexShrink: 0, background: shot.color, marginTop: 2 }}
                />
                <button
                  onClick={() => toggleCheck(shot.id)}
                  style={{
                    flexShrink: 0, width: 18, height: 18, borderRadius: 4,
                    border: `1.5px solid ${shot.checked ? "#2fc77a" : "rgba(255,255,255,0.2)"}`,
                    background: shot.checked ? "#2fc77a" : "transparent",
                    cursor: "pointer", color: "#fff", fontSize: 10, padding: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    marginTop: 1,
                  }}
                  type="button"
                >
                  {shot.checked ? "✓" : ""}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 1 }}>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>#{shot.sceneNumber}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: shot.checked ? "rgba(255,255,255,0.4)" : "#e8e8e8", textDecoration: shot.checked ? "line-through" : "none" }}>
                      {shot.slug}
                    </span>
                  </div>
                  {shot.description && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{shot.description}</div>}
                  {shot.characters.length > 0 && (
                    <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
                      {shot.characters.slice(0, 4).map(c => (
                        <span key={c} style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.06)", padding: "1px 5px", borderRadius: 3 }}>{c}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!showImport && shots.length === 0 && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center" }}>
            <div>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🎞</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>No script loaded yet.</div>
              <button onClick={() => setShowImport(true)} style={{ marginTop: 12, padding: "7px 14px", borderRadius: 7, background: "rgba(79,142,247,0.15)", border: "1px solid rgba(79,142,247,0.3)", color: "#4f8ef7", fontSize: 12, cursor: "pointer" }} type="button">Import Script</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
