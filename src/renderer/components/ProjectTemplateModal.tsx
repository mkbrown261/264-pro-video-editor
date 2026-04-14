/**
 * ProjectTemplateModal — UX 5: File → New from Template
 * Shows 8 template types; each pre-creates tracks + markers.
 */
import React, { useState } from "react";
import { createId } from "../../shared/models";
import type { TimelineTrack, TimelineMarker, SequenceSettings } from "../../shared/models";

export interface ProjectTemplate {
  id: string;
  label: string;
  icon: string;
  description: string;
  tracks: Omit<TimelineTrack, "id">[];
  markers: Omit<TimelineMarker, "id">[];
  settings?: Partial<SequenceSettings>;
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "blank",
    label: "Blank",
    icon: "⬜",
    description: "Start with a clean slate",
    tracks: [
      { name: "V1", kind: "video", muted: false, locked: false, solo: false, height: 56, color: "#4f8ef7" },
      { name: "A1", kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#2fc77a" },
    ],
    markers: [],
  },
  {
    id: "youtube_vlog",
    label: "YouTube Vlog",
    icon: "📺",
    description: "Hook, main content, outro — 1080p 30fps",
    tracks: [
      { name: "V1 — Main",   kind: "video", muted: false, locked: false, solo: false, height: 56, color: "#4f8ef7" },
      { name: "V2 — B-Roll", kind: "video", muted: false, locked: false, solo: false, height: 44, color: "#7c3aed" },
      { name: "A1 — Voice",  kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#2fc77a" },
      { name: "A2 — Music",  kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#f7c948" },
      { name: "A3 — SFX",   kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#e07820" },
    ],
    markers: [
      { frame: 0,    label: "Hook",         color: "#ef5350" },
      { frame: 270,  label: "Intro",        color: "#f7c948" },
      { frame: 900,  label: "Main Content", color: "#2fc77a" },
      { frame: 2700, label: "Outro/CTA",    color: "#4f8ef7" },
    ],
    settings: { width: 1920, height: 1080, fps: 30 },
  },
  {
    id: "short_film",
    label: "Short Film",
    icon: "🎬",
    description: "Cinematic setup — 4K 24fps with dialogue tracks",
    tracks: [
      { name: "V1 — Main",     kind: "video", muted: false, locked: false, solo: false, height: 56, color: "#4f8ef7" },
      { name: "V2 — Insert",   kind: "video", muted: false, locked: false, solo: false, height: 44, color: "#7c3aed" },
      { name: "V3 — Overlay",  kind: "video", muted: false, locked: false, solo: false, height: 44, color: "#a855f7" },
      { name: "A1 — Dialogue", kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#2fc77a" },
      { name: "A2 — FX",       kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#e07820" },
      { name: "A3 — Score",    kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#f7c948" },
    ],
    markers: [
      { frame: 0,    label: "Act 1",         color: "#ef5350" },
      { frame: 1440, label: "Inciting Event", color: "#f7c948" },
      { frame: 2880, label: "Act 2",          color: "#2fc77a" },
      { frame: 5040, label: "Climax",         color: "#4f8ef7" },
      { frame: 6480, label: "Resolution",     color: "#a855f7" },
    ],
    settings: { width: 3840, height: 2160, fps: 24 },
  },
  {
    id: "wedding",
    label: "Wedding Video",
    icon: "💍",
    description: "Ceremony + highlights — warm cinematic look",
    tracks: [
      { name: "V1 — Ceremony",  kind: "video", muted: false, locked: false, solo: false, height: 56, color: "#4f8ef7" },
      { name: "V2 — Highlight", kind: "video", muted: false, locked: false, solo: false, height: 44, color: "#e07820" },
      { name: "V3 — Drone",     kind: "video", muted: false, locked: false, solo: false, height: 44, color: "#7c3aed" },
      { name: "A1 — Ceremony",  kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#2fc77a" },
      { name: "A2 — Music",     kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#f7c948" },
    ],
    markers: [
      { frame: 0,    label: "Intro",         color: "#ef5350" },
      { frame: 450,  label: "Getting Ready", color: "#f7c948" },
      { frame: 1800, label: "Ceremony",      color: "#2fc77a" },
      { frame: 3600, label: "Reception",     color: "#4f8ef7" },
      { frame: 5400, label: "Highlight Reel",color: "#a855f7" },
    ],
    settings: { width: 1920, height: 1080, fps: 24 },
  },
  {
    id: "corporate",
    label: "Corporate",
    icon: "🏢",
    description: "Interview + B-roll — professional presentation",
    tracks: [
      { name: "V1 — Interview", kind: "video", muted: false, locked: false, solo: false, height: 56, color: "#4f8ef7" },
      { name: "V2 — B-Roll",    kind: "video", muted: false, locked: false, solo: false, height: 44, color: "#7c3aed" },
      { name: "A1 — Interview", kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#2fc77a" },
      { name: "A2 — Music",     kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#f7c948" },
    ],
    markers: [
      { frame: 0,    label: "Intro",         color: "#ef5350" },
      { frame: 300,  label: "Main Message",  color: "#f7c948" },
      { frame: 2700, label: "Case Study",    color: "#2fc77a" },
      { frame: 4500, label: "CTA",           color: "#4f8ef7" },
    ],
    settings: { width: 1920, height: 1080, fps: 30 },
  },
  {
    id: "music_video",
    label: "Music Video",
    icon: "🎵",
    description: "Beat-sync cuts — performance + narrative",
    tracks: [
      { name: "V1 — Performance", kind: "video", muted: false, locked: false, solo: false, height: 56, color: "#4f8ef7" },
      { name: "V2 — Narrative",   kind: "video", muted: false, locked: false, solo: false, height: 44, color: "#7c3aed" },
      { name: "V3 — Effects",     kind: "video", muted: false, locked: false, solo: false, height: 44, color: "#a855f7" },
      { name: "A1 — Master Mix",  kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#2fc77a" },
    ],
    markers: [
      { frame: 0,    label: "Intro",   color: "#ef5350" },
      { frame: 720,  label: "Verse 1", color: "#f7c948" },
      { frame: 1440, label: "Chorus",  color: "#2fc77a" },
      { frame: 2160, label: "Verse 2", color: "#4f8ef7" },
      { frame: 2880, label: "Bridge",  color: "#a855f7" },
      { frame: 3600, label: "Outro",   color: "#e07820" },
    ],
    settings: { width: 1920, height: 1080, fps: 24 },
  },
  {
    id: "documentary",
    label: "Documentary",
    icon: "🎥",
    description: "Long-form with narration + archival tracks",
    tracks: [
      { name: "V1 — Primary",   kind: "video", muted: false, locked: false, solo: false, height: 56, color: "#4f8ef7" },
      { name: "V2 — Archival",  kind: "video", muted: false, locked: false, solo: false, height: 44, color: "#7c3aed" },
      { name: "V3 — Titles",    kind: "video", muted: false, locked: false, solo: false, height: 44, color: "#a855f7" },
      { name: "A1 — Narration", kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#2fc77a" },
      { name: "A2 — Interview", kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#2fc77a" },
      { name: "A3 — Ambience",  kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#e07820" },
      { name: "A4 — Score",     kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#f7c948" },
    ],
    markers: [
      { frame: 0,     label: "Cold Open",  color: "#ef5350" },
      { frame: 900,   label: "Chapter 1",  color: "#f7c948" },
      { frame: 5400,  label: "Chapter 2",  color: "#2fc77a" },
      { frame: 10800, label: "Chapter 3",  color: "#4f8ef7" },
      { frame: 16200, label: "Conclusion", color: "#a855f7" },
    ],
    settings: { width: 1920, height: 1080, fps: 24 },
  },
  {
    id: "podcast_video",
    label: "Podcast Video",
    icon: "🎙️",
    description: "Multi-cam podcast — 2 hosts with lower thirds",
    tracks: [
      { name: "V1 — Wide Shot",  kind: "video", muted: false, locked: false, solo: false, height: 56, color: "#4f8ef7" },
      { name: "V2 — Host 1",     kind: "video", muted: false, locked: false, solo: false, height: 44, color: "#7c3aed" },
      { name: "V3 — Host 2",     kind: "video", muted: false, locked: false, solo: false, height: 44, color: "#a855f7" },
      { name: "V4 — Lower 3rds", kind: "video", muted: false, locked: false, solo: false, height: 44, color: "#e07820" },
      { name: "A1 — Host 1",     kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#2fc77a" },
      { name: "A2 — Host 2",     kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#2fc77a" },
      { name: "A3 — Music",      kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#f7c948" },
    ],
    markers: [
      { frame: 0,    label: "Intro",       color: "#ef5350" },
      { frame: 900,  label: "Topic 1",     color: "#f7c948" },
      { frame: 2700, label: "Topic 2",     color: "#2fc77a" },
      { frame: 4500, label: "Guest Seg",   color: "#4f8ef7" },
      { frame: 6300, label: "Outro/Links", color: "#a855f7" },
    ],
    settings: { width: 1920, height: 1080, fps: 30 },
  },
];

interface Props {
  onSelect: (template: ProjectTemplate) => void;
  onClose: () => void;
}

export function ProjectTemplateModal({ onSelect, onClose }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9000 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#1a1a1f", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 28, width: 680, maxWidth: "95vw" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#e8e8e8" }}>New from Template</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>
              Choose a starting point — tracks and markers are pre-configured
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 18, padding: 4 }} type="button">✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {PROJECT_TEMPLATES.map((tmpl) => (
            <button
              key={tmpl.id}
              type="button"
              onClick={() => { onSelect(tmpl); onClose(); }}
              onMouseEnter={() => setHovered(tmpl.id)}
              onMouseLeave={() => setHovered(null)}
              style={{
                background: hovered === tmpl.id ? "rgba(79,142,247,0.15)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${hovered === tmpl.id ? "rgba(79,142,247,0.5)" : "rgba(255,255,255,0.1)"}`,
                borderRadius: 10,
                padding: "14px 10px",
                cursor: "pointer",
                textAlign: "center",
                transition: "all 0.15s",
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 7 }}>{tmpl.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#e8e8e8", marginBottom: 4 }}>{tmpl.label}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", lineHeight: 1.4 }}>{tmpl.description}</div>
              <div style={{ marginTop: 8, fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                {tmpl.tracks.length} tracks · {tmpl.markers.length} markers
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Convert a ProjectTemplate into actual tracks (with real IDs) and markers */
export function instantiateTemplate(template: ProjectTemplate): {
  tracks: import("../../shared/models").TimelineTrack[];
  markers: import("../../shared/models").TimelineMarker[];
  settings: Partial<import("../../shared/models").SequenceSettings>;
} {
  return {
    tracks: template.tracks.map((t) => ({ ...t, id: createId() })),
    markers: template.markers.map((m) => ({ ...m, id: createId() })),
    settings: template.settings ?? {},
  };
}
