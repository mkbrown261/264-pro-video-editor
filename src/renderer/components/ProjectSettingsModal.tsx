/** Project settings modal (extracted from App.tsx). */
import React, { useEffect, useState } from "react";
import type { EditorProject, SequenceSettings } from "../../shared/models";
import { useEditorStore } from "../store/editorStore";

export interface ProjectSettings {
  projectName: string;
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
  audioSampleRate: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  project: EditorProject;
  currentProjectPath: string | null;
  projectDirty: boolean;
  onSaveProject: () => unknown;
  onSaveProjectAs: () => unknown;
  onOpenProject: () => unknown;
  /** New project (the caller handles the unsaved-changes prompt). */
  onNewProject: () => void;
  updateSequenceSettings: (s: Partial<SequenceSettings>) => void;
  showToast: (msg: string) => void;
}

export function ProjectSettingsModal({
  open, onClose, project, currentProjectPath, projectDirty,
  onSaveProject, onSaveProjectAs, onOpenProject, onNewProject,
  updateSequenceSettings, showToast,
}: Props) {
  const showSettings = open;
  const setShowSettings = (v: boolean) => { if (!v) onClose(); };
  const [settingsTab, setSettingsTab] = useState<"general" | "timeline" | "audio">("general");
  const [settingsDraft, setSettingsDraft] = useState<ProjectSettings>({
    projectName: project.name,
    width: project.sequence.settings.width,
    height: project.sequence.settings.height,
    fps: project.sequence.settings.fps,
    aspectRatio: "16:9",
    audioSampleRate: project.sequence.settings.audioSampleRate ?? 48000,
  });

  // Re-sync the draft every time the modal opens so it shows live values
  useEffect(() => {
    if (showSettings) {
      setSettingsDraft({
        projectName: project.name,
        width: project.sequence.settings.width,
        height: project.sequence.settings.height,
        fps: project.sequence.settings.fps,
        aspectRatio: "16:9",
        audioSampleRate: project.sequence.settings.audioSampleRate ?? 48000,
      });
      setSettingsTab("general");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings]);

  // ── Settings helpers ──────────────────────────────────────────────────────
  function handleSaveSettings() {
    // Apply the drafted settings to the live project
    updateSequenceSettings({
      width:           Math.max(1, Math.round(settingsDraft.width)),
      height:          Math.max(1, Math.round(settingsDraft.height)),
      fps:             settingsDraft.fps,
      audioSampleRate: settingsDraft.audioSampleRate,
    });
    // Update project name if changed
    const trimmedName = settingsDraft.projectName.trim();
    if (trimmedName && trimmedName !== project.name) {
      // Direct store mutation via editorStore's project field
      useEditorStore.setState((s) => ({
        project: { ...s.project, name: trimmedName }
      }));
    }
    setShowSettings(false);
    showToast(`✓ Settings saved: ${settingsDraft.width}×${settingsDraft.height} @ ${settingsDraft.fps}fps`);
  }

  // ── Settings modal (tabbed settings) ─────────────────────────
  if (!open) return null;

    const PRESETS: Record<string, Omit<ProjectSettings, "projectName" | "audioSampleRate">> = {
      "YouTube 1080p":  { width: 1920, height: 1080, fps: 30,     aspectRatio: "16:9" },
      "YouTube 4K":     { width: 3840, height: 2160, fps: 30,     aspectRatio: "16:9" },
      "YouTube 1080p 60fps": { width: 1920, height: 1080, fps: 60, aspectRatio: "16:9" },
      "TikTok / Reels": { width: 1080, height: 1920, fps: 30,     aspectRatio: "9:16" },
      "Instagram Square":{ width: 1080, height: 1080, fps: 30,    aspectRatio: "1:1"  },
      "Cinema 4K DCI":  { width: 4096, height: 2160, fps: 24,     aspectRatio: "16:9" },
      "Cinema 2K":      { width: 2048, height: 1080, fps: 24,     aspectRatio: "16:9" },
      "Twitter / X":    { width: 1280, height: 720,  fps: 30,     aspectRatio: "16:9" },
      "720p HD":        { width: 1280, height: 720,  fps: 30,     aspectRatio: "16:9" },
    };
    const FPS_OPTIONS = [
      { label: "23.976 fps (Film)",    value: 23.976 },
      { label: "24 fps (Cinema)",      value: 24     },
      { label: "25 fps (PAL)",         value: 25     },
      { label: "29.97 fps (NTSC)",     value: 29.97  },
      { label: "30 fps",               value: 30     },
      { label: "48 fps (HFR)",         value: 48     },
      { label: "50 fps (PAL HFR)",     value: 50     },
      { label: "59.94 fps (NTSC HFR)", value: 59.94  },
      { label: "60 fps",               value: 60     },
      { label: "120 fps",              value: 120    },
    ];
    const SAMPLE_RATE_OPTIONS = [
      { label: "44.1 kHz (CD Quality)", value: 44100 },
      { label: "48 kHz (Broadcast Standard)", value: 48000 },
      { label: "96 kHz (Studio Hi-Res)", value: 96000 },
    ];

    // Auto-detect aspect ratio from resolution
    const wStr = String(settingsDraft.width);
    const hStr = String(settingsDraft.height);
    function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }
    const g = gcd(Number(wStr) || 1, Number(hStr) || 1);
    const autoRatio = g > 0 ? `${(Number(wStr) || 1) / g}:${(Number(hStr) || 1) / g}` : "—";

    const totalPixels = settingsDraft.width * settingsDraft.height;
    let resolutionLabel = "";
    if (totalPixels >= 3840 * 2160) resolutionLabel = "4K UHD";
    else if (totalPixels >= 2048 * 1080) resolutionLabel = "2K";
    else if (totalPixels >= 1920 * 1080) resolutionLabel = "Full HD";
    else if (totalPixels >= 1280 * 720) resolutionLabel = "HD";
    else resolutionLabel = "SD";

    const TABS = [
      { id: "general", label: "⚙ General" },
      { id: "timeline", label: "🎞 Timeline" },
      { id: "audio",   label: "🎵 Audio" },
    ] as const;

    return (
      <div className="settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}>
        <div className="settings-modal settings-modal-264">
          {/* Header */}
          <div className="settings-modal-header">
            <div className="settings-modal-title-row">
              <span className="settings-modal-icon">⚙</span>
              <h2>Project Settings</h2>
              {projectDirty && <span className="settings-dirty-badge">Unsaved changes</span>}
            </div>
            <button className="settings-modal-close" onClick={() => setShowSettings(false)} type="button" title="Close">✕</button>
          </div>

          {/* Tab strip */}
          <div className="settings-tab-strip">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`settings-tab${settingsTab === t.id ? " active" : ""}`}
                onClick={() => setSettingsTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="settings-modal-body">

            {/* ── GENERAL tab ── */}
            {settingsTab === "general" && (
              <div className="settings-tab-content">
                <div className="settings-section">
                  <div className="settings-section-title">Project</div>
                  <div className="settings-row">
                    <label>Project Name</label>
                    <input
                      className="settings-input settings-input-wide"
                      type="text"
                      value={settingsDraft.projectName}
                      onChange={(e) => setSettingsDraft(d => ({ ...d, projectName: e.target.value }))}
                      placeholder="My Project"
                    />
                  </div>
                  <div className="settings-row settings-row-readonly">
                    <label>Project File</label>
                    <span className="settings-value-text">{currentProjectPath ?? "Not yet saved"}{projectDirty ? " •" : ""}</span>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-title">Project File Actions</div>
                  <div className="settings-action-grid">
                    <button className="settings-action-btn primary" onClick={() => void onSaveProject()} type="button">
                      💾 {currentProjectPath ? "Save" : "Save As…"}
                    </button>
                    <button className="settings-action-btn" onClick={() => void onSaveProjectAs()} type="button">
                      📋 Save As…
                    </button>
                    <button className="settings-action-btn" onClick={() => { setShowSettings(false); void onOpenProject(); }} type="button">
                      📂 Open Project…
                    </button>
                    <button className="settings-action-btn danger" onClick={() => { setShowSettings(false); onNewProject(); }} type="button">
                      ✦ New Project
                    </button>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-title">Project Info</div>
                  <div className="settings-info-grid">
                    <div className="settings-info-item"><span className="settings-info-label">Resolution</span><span className="settings-info-value">{project.sequence.settings.width} × {project.sequence.settings.height} ({resolutionLabel})</span></div>
                    <div className="settings-info-item"><span className="settings-info-label">Frame Rate</span><span className="settings-info-value">{project.sequence.settings.fps} fps</span></div>
                    <div className="settings-info-item"><span className="settings-info-label">Video Tracks</span><span className="settings-info-value">{project.sequence.tracks.filter(t => t.kind === "video").length}</span></div>
                    <div className="settings-info-item"><span className="settings-info-label">Audio Tracks</span><span className="settings-info-value">{project.sequence.tracks.filter(t => t.kind === "audio").length}</span></div>
                    <div className="settings-info-item"><span className="settings-info-label">Total Clips</span><span className="settings-info-value">{project.sequence.clips.length}</span></div>
                    <div className="settings-info-item"><span className="settings-info-label">Media Assets</span><span className="settings-info-value">{project.assets.length}</span></div>
                  </div>
                </div>
              </div>
            )}

            {/* ── TIMELINE tab ── */}
            {settingsTab === "timeline" && (
              <div className="settings-tab-content">
                <div className="settings-section">
                  <div className="settings-section-title">Preset Profiles</div>
                  <div className="settings-preset-grid-v2">
                    {Object.entries(PRESETS).map(([name, vals]) => (
                      <button
                        key={name}
                        type="button"
                        className={`settings-preset-btn-v2${
                          settingsDraft.width === vals.width &&
                          settingsDraft.height === vals.height &&
                          settingsDraft.fps === vals.fps ? " active" : ""
                        }`}
                        onClick={() => setSettingsDraft(d => ({ ...d, ...vals }))}
                      >
                        <span className="preset-name">{name}</span>
                        <span className="preset-meta">{vals.width}×{vals.height} / {vals.fps}fps</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-title">Resolution</div>
                  <div className="settings-row">
                    <label>Width (px)</label>
                    <input className="settings-input" type="number" min={1} max={8192} step={2}
                      value={settingsDraft.width}
                      onChange={(e) => setSettingsDraft(d => ({ ...d, width: Number(e.target.value) }))} />
                  </div>
                  <div className="settings-row">
                    <label>Height (px)</label>
                    <input className="settings-input" type="number" min={1} max={8192} step={2}
                      value={settingsDraft.height}
                      onChange={(e) => setSettingsDraft(d => ({ ...d, height: Number(e.target.value) }))} />
                  </div>
                  <div className="settings-row settings-row-readonly">
                    <label>Aspect Ratio</label>
                    <span className="settings-value-text">{autoRatio} ({resolutionLabel})</span>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-title">Frame Rate</div>
                  <div className="settings-row">
                    <label>Frame Rate</label>
                    <select className="settings-select" value={settingsDraft.fps}
                      onChange={(e) => setSettingsDraft(d => ({ ...d, fps: Number(e.target.value) }))}>
                      {FPS_OPTIONS.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="settings-row settings-row-readonly">
                    <label>Field Order</label>
                    <span className="settings-value-text">Progressive (non-interlaced)</span>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-title">⚠ Important Note</div>
                  <div className="settings-warning-note">
                    Changing resolution or frame rate after clips have been placed on the timeline may affect timing and proportions.
                    Apply presets before adding clips for best results.
                  </div>
                </div>
              </div>
            )}

            {/* ── AUDIO tab ── */}
            {settingsTab === "audio" && (
              <div className="settings-tab-content">
                <div className="settings-section">
                  <div className="settings-section-title">Audio Settings</div>
                  <div className="settings-row">
                    <label>Sample Rate</label>
                    <select className="settings-select" value={settingsDraft.audioSampleRate}
                      onChange={(e) => setSettingsDraft(d => ({ ...d, audioSampleRate: Number(e.target.value) }))}>
                      {SAMPLE_RATE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="settings-row settings-row-readonly">
                    <label>Channels</label>
                    <span className="settings-value-text">Stereo (2.0)</span>
                  </div>
                  <div className="settings-row settings-row-readonly">
                    <label>Bit Depth</label>
                    <span className="settings-value-text">24-bit (PCM)</span>
                  </div>
                  <div className="settings-row settings-row-readonly">
                    <label>Codec</label>
                    <span className="settings-value-text">AAC (export) / PCM (editing)</span>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-title">Master Volume</div>
                  <div className="settings-row">
                    <label>Output Level</label>
                    <span className="settings-value-text">0 dBFS (Unity)</span>
                  </div>
                  <div className="settings-warning-note">
                    Individual clip and track volumes can be adjusted in the Inspector panel and timeline track controls.
                  </div>
                </div>
              </div>
            )}

          </div>

          {/* Footer */}
          <div className="settings-modal-footer">
            <button className="panel-action muted" onClick={() => setShowSettings(false)} type="button">Cancel</button>
            <button className="panel-action primary" onClick={handleSaveSettings} type="button">✓ Save Settings</button>
          </div>
        </div>
      </div>
    );
  }
