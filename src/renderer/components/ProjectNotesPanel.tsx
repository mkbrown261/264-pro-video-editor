/**
 * ProjectNotesPanel — GAP B: Project Notes / Metadata Panel
 * Accessible via Cmd+Shift+N or from the File menu.
 */
import React, { useState } from "react";
import type { ProjectMetadata } from "../../shared/models";

interface Props {
  metadata: ProjectMetadata;
  projectName: string;
  onUpdate: (updates: Partial<ProjectMetadata>) => void;
  onClose: () => void;
}

const FIELD_CFG: Array<{ key: keyof ProjectMetadata; label: string; placeholder: string }> = [
  { key: "director",  label: "Director",  placeholder: "e.g. Jane Smith" },
  { key: "dp",        label: "DP",        placeholder: "e.g. John Doe" },
  { key: "editor",    label: "Editor",    placeholder: "e.g. Alex Kim" },
  { key: "client",    label: "Client",    placeholder: "e.g. Acme Corp" },
  { key: "deadline",  label: "Deadline",  placeholder: "e.g. 2026-05-01" },
];

export function ProjectNotesPanel({ metadata, projectName, onUpdate, onClose }: Props) {
  const [draft, setDraft] = useState<ProjectMetadata>({ ...metadata });

  function handleSave() {
    onUpdate(draft);
    onClose();
  }

  function handlePrint() {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>Project Notes — ${projectName}</title>
      <style>body{font-family:sans-serif;max-width:700px;margin:40px auto;color:#111}
      h1{font-size:22px}table{border-collapse:collapse;width:100%;margin-bottom:24px}
      td,th{border:1px solid #ddd;padding:8px 12px;font-size:14px}
      th{background:#f5f5f5;width:120px}pre{white-space:pre-wrap;font-family:inherit;background:#f9f9f9;padding:14px;border-radius:6px}</style>
      </head><body>
      <h1>Project Notes — ${projectName}</h1>
      <table>
        ${FIELD_CFG.map(f => `<tr><th>${f.label}</th><td>${draft[f.key] ?? ""}</td></tr>`).join("")}
      </table>
      <h2>Notes</h2>
      <pre>${draft.notes ?? ""}</pre>
      </body></html>
    `);
    win.document.close();
    win.print();
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 8500 }}
      onClick={(e) => { if (e.target === e.currentTarget) { handleSave(); } }}
    >
      <div style={{ background: "#1a1a1f", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 28, width: 520, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#e8e8e8" }}>📋 Project Notes</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{projectName}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16 }} type="button">✕</button>
        </div>

        {/* Metadata fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {FIELD_CFG.map(({ key, label, placeholder }) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 70, fontSize: 11, color: "rgba(255,255,255,0.45)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>{label}</div>
              <input
                type="text"
                value={draft[key] ?? ""}
                placeholder={placeholder}
                onChange={(e) => setDraft(prev => ({ ...prev, [key]: e.target.value }))}
                style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#e8e8e8", fontSize: 12, padding: "6px 9px", outline: "none" }}
              />
            </div>
          ))}
        </div>

        {/* Notes textarea */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Notes</div>
          <textarea
            value={draft.notes ?? ""}
            onChange={(e) => setDraft(prev => ({ ...prev, notes: e.target.value }))}
            placeholder="Project notes, creative direction, delivery specs…"
            rows={8}
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e8e8", fontSize: 12, padding: "10px 12px", resize: "vertical", outline: "none", fontFamily: "monospace", lineHeight: 1.6 }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={handlePrint}
            style={{ padding: "7px 14px", borderRadius: 7, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.6)", fontSize: 12, cursor: "pointer" }}
            type="button"
          >
            🖨 Export / Print
          </button>
          <button
            onClick={handleSave}
            style={{ padding: "7px 16px", borderRadius: 7, background: "linear-gradient(135deg,#4f8ef7,#7c3aed)", border: "none", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
            type="button"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
