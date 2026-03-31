import { useState } from "react";
import type {
  BackgroundRemovalConfig,
  ClipEffect,
  ClipMask,
  ClipTransitionType,
  ColorGrade,
  EnvironmentStatus,
  MediaAsset
} from "../../shared/models";
import { ALL_TRANSITION_TYPES } from "../../shared/models";
import type { TimelineSegment } from "../../shared/timeline";
import { formatDuration, formatTimecode } from "../lib/format";
import { MaskInspector, type MaskTool } from "./MaskingCanvas";
import { EffectsPanel } from "./EffectsPanel";

type InspectorTab = "clip" | "masks" | "effects" | "audio" | "voice" | "export";

interface InspectorPanelProps {
  // State
  selectedAsset: MediaAsset | null;
  selectedSegment: TimelineSegment | null;
  environment: EnvironmentStatus | null;
  exportBusy: boolean;
  exportMessage: string | null;
  clipMessage: string | null;
  sequenceSettings: { width: number; height: number; fps: number; audioSampleRate: number };

  // Voice Chop AI
  voiceListening: boolean;
  voiceStatus: string;
  voiceTranscript: string;
  voiceLastCommand: string | null;
  voiceSuggestedCutFrames: number[];
  voiceMarkInFrame: number | null;
  voiceMarkOutFrame: number | null;
  voiceBpm: number;
  voiceGridFrames: number;
  detectedBpm: number | null;
  detectedBeatFrames: number[];

  // Masks
  activeMaskTool: MaskTool;
  selectedMaskId: string | null;
  onSetActiveMaskTool: (tool: MaskTool) => void;
  onSelectMask: (id: string | null) => void;
  onAddMask: (mask: ClipMask) => void;
  onUpdateMask: (maskId: string, updates: Partial<ClipMask>) => void;
  onRemoveMask: (maskId: string) => void;

  // Effects
  onAddEffect: (effect: ClipEffect) => void;
  onUpdateEffect: (effectId: string, updates: Partial<ClipEffect>) => void;
  onRemoveEffect: (effectId: string) => void;
  onToggleEffect: (effectId: string) => void;
  onReorderEffects: (from: number, to: number) => void;
  onToggleBackgroundRemoval: () => void;
  onSetBackgroundRemoval: (config: Partial<BackgroundRemovalConfig>) => void;

  // Clip actions
  onToggleClipEnabled: (clipId: string) => void;
  onDetachLinkedClips: (clipId: string) => void;
  onRelinkClips?: (clipId: string) => void;
  onSetTransitionType: (edge: "in" | "out", type: ClipTransitionType) => void;
  onSetTransitionDuration: (edge: "in" | "out", durationFrames: number) => void;
  onExtractAudio: () => void;
  onRippleDelete: () => void;
  onSetClipVolume: (volume: number) => void;
  onSetClipSpeed: (speed: number) => void;

  // Voice Chop AI
  onToggleVoiceListening: () => void;
  onAnalyzeVoiceChops: () => void;
  onDetectBpm: () => void;
  onBeatSync: (mode: "everyBeat" | "every2" | "every4") => void;
  onAcceptVoiceCuts: () => void;
  onClearVoiceCuts: () => void;
  onQuantizeVoiceCutsToBeat: () => void;
  onQuantizeVoiceCutsToGrid: () => void;
  onSetVoiceBpm: (bpm: number) => void;
  onSetVoiceGridFrames: (gridFrames: number) => void;

  // Export
  onExport: () => Promise<void>;

  // Color grade (for effects page display)
  colorGrade?: ColorGrade | null;
}

// Transition icon map for visual representation
const TRANSITION_ICONS: Record<ClipTransitionType, string> = {
  cut:         "│",
  fade:        "↔",
  dipBlack:    "▼",
  dipWhite:    "▽",
  crossDissolve: "✕",
  wipe:        "→",
  wipeLeft:    "◀",
  wipeRight:   "▶",
  wipeUp:      "▲",
  wipeDown:    "▼",
  push:        "⇒",
  pushLeft:    "⇐",
  pushRight:   "⇒",
  zoom:        "⊕",
  zoomIn:      "⊕",
  zoomOut:     "⊖",
  blur:        "◎",
  shake:       "≋",
  rumble:      "~",
  glitch:      "▣",
  filmBurn:    "🎞",
  lensFlare:   "✦"
};

const TRANSITION_CATEGORIES = Array.from(new Set(ALL_TRANSITION_TYPES.map((t) => t.category)));

export function InspectorPanel({
  selectedAsset,
  selectedSegment,
  environment,
  exportBusy,
  exportMessage,
  clipMessage,
  sequenceSettings,
  voiceListening,
  voiceStatus,
  voiceTranscript,
  voiceLastCommand,
  voiceSuggestedCutFrames,
  voiceMarkInFrame,
  voiceMarkOutFrame,
  voiceBpm,
  voiceGridFrames,
  detectedBpm,
  detectedBeatFrames,
  activeMaskTool,
  selectedMaskId,
  onSetActiveMaskTool,
  onSelectMask,
  onAddMask,
  onUpdateMask,
  onRemoveMask,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  onToggleEffect,
  onReorderEffects,
  onToggleBackgroundRemoval,
  onSetBackgroundRemoval,
  onToggleClipEnabled,
  onDetachLinkedClips,
  onRelinkClips,
  onSetTransitionType,
  onSetTransitionDuration,
  onExtractAudio,
  onRippleDelete,
  onSetClipVolume,
  onSetClipSpeed,
  onToggleVoiceListening,
  onAnalyzeVoiceChops,
  onDetectBpm,
  onBeatSync,
  onAcceptVoiceCuts,
  onClearVoiceCuts,
  onQuantizeVoiceCutsToBeat,
  onQuantizeVoiceCutsToGrid,
  onSetVoiceBpm,
  onSetVoiceGridFrames,
  onExport
}: InspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("clip");
  const [transitionCategory, setTransitionCategory] = useState("Basic");
  const [transitionEdge, setTransitionEdge] = useState<"in" | "out">("in");

  const fps = sequenceSettings.fps;
  const maxFadeFrames = selectedSegment
    ? Math.max(0, Math.min(Math.round(fps * 2), selectedSegment.durationFrames - 1))
    : 0;
  const fadeInFrames = selectedSegment?.clip.transitionIn?.durationFrames ?? 0;
  const fadeOutFrames = selectedSegment?.clip.transitionOut?.durationFrames ?? 0;
  const fadeInType = selectedSegment?.clip.transitionIn?.type ?? null;
  const fadeOutType = selectedSegment?.clip.transitionOut?.type ?? null;
  const activeTransType = transitionEdge === "in" ? fadeInType : fadeOutType;
  const activeTransFrames = transitionEdge === "in" ? fadeInFrames : fadeOutFrames;

  const TABS: Array<{ id: InspectorTab; label: string; icon: string }> = [
    { id: "clip",    label: "Clip",    icon: "📋" },
    { id: "masks",   label: "Masks",   icon: "⬡" },
    { id: "effects", label: "Effects", icon: "✦" },
    { id: "audio",   label: "Audio",   icon: "🎵" },
    { id: "voice",   label: "Voice AI",icon: "🎤" },
    { id: "export",  label: "Export",  icon: "📤" }
  ];

  return (
    <section className="panel inspector-panel">
      {/* Tabs */}
      <div className="inspector-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`inspector-tab${activeTab === tab.id ? " active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
            type="button"
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="inspector-body">

        {/* ── CLIP TAB ── */}
        {activeTab === "clip" && (
          <div className="inspector-stack">
            {/* Sequence info */}
            <div className="inspector-card">
              <p className="inspector-label">Sequence</p>
              <strong>{sequenceSettings.width}×{sequenceSettings.height} / {fps}fps</strong>
              <span>{sequenceSettings.audioSampleRate / 1000}kHz audio</span>
            </div>

            {selectedSegment ? (
              <>
                {/* Clip info */}
                <div className="inspector-card">
                  <p className="inspector-label">Selected Clip</p>
                  <strong>{selectedSegment.asset.name}</strong>
                  <div className="clip-meta-grid">
                    <span>Track</span><strong>{selectedSegment.track.name}</strong>
                    <span>In</span><strong>{formatTimecode(selectedSegment.startFrame, fps)}</strong>
                    <span>Duration</span><strong>{formatDuration(selectedSegment.durationSeconds)}</strong>
                    <span>Status</span>
                    <strong className={selectedSegment.clip.isEnabled ? "text-success" : "text-muted"}>
                      {selectedSegment.clip.isEnabled ? "Active" : "Disabled"}
                    </strong>
                    <span>Linked</span><strong>{selectedSegment.clip.linkedGroupId ? "Yes" : "No"}</strong>
                    {(selectedSegment.clip.effects?.length ?? 0) > 0 && (
                      <>
                        <span>Effects</span>
                        <strong>
                          {selectedSegment.clip.effects.filter((e) => e.enabled).length}/{selectedSegment.clip.effects.length} active
                        </strong>
                      </>
                    )}
                  </div>
                </div>

                {/* Transitions */}
                <div className="inspector-card">
                  <p className="inspector-label">Transitions</p>

                  {/* In/Out edge selector */}
                  <div className="transition-edge-tabs">
                    <button
                      className={`transition-edge-btn${transitionEdge === "in" ? " active" : ""}`}
                      onClick={() => setTransitionEdge("in")}
                      type="button"
                    >
                      <span>▶ Transition In</span>
                      {fadeInType && <span className="trans-edge-badge">{TRANSITION_ICONS[fadeInType]}</span>}
                    </button>
                    <button
                      className={`transition-edge-btn${transitionEdge === "out" ? " active" : ""}`}
                      onClick={() => setTransitionEdge("out")}
                      type="button"
                    >
                      <span>◀ Transition Out</span>
                      {fadeOutType && <span className="trans-edge-badge">{TRANSITION_ICONS[fadeOutType]}</span>}
                    </button>
                  </div>

                  {/* Duration control for active edge */}
                  <div className="field">
                    <label className="field-header">
                      <span>{transitionEdge === "in" ? "In Duration" : "Out Duration"}</span>
                      <strong>{(activeTransFrames / fps).toFixed(2)}s ({activeTransFrames}f)</strong>
                    </label>
                    <input
                      disabled={maxFadeFrames === 0}
                      max={maxFadeFrames} min={0} step={1}
                      type="range"
                      className="transition-duration-range"
                      value={Math.min(activeTransFrames, maxFadeFrames)}
                      onChange={(e) => onSetTransitionDuration(transitionEdge, Number(e.target.value))}
                    />
                  </div>

                  {/* Category tabs */}
                  <div className="transition-category-tabs">
                    {TRANSITION_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        className={`trans-cat-btn${transitionCategory === cat ? " active" : ""}`}
                        onClick={() => setTransitionCategory(cat)}
                        type="button"
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  {/* Transition grid */}
                  <div className="transition-grid">
                    {ALL_TRANSITION_TYPES
                      .filter((t) => t.category === transitionCategory)
                      .map((t) => {
                        const isActive = activeTransType === t.value;
                        return (
                          <button
                            key={t.value}
                            className={`transition-btn${isActive ? " active" : ""}`}
                            onClick={() => onSetTransitionType(transitionEdge, t.value)}
                            title={`Apply ${t.label} to ${transitionEdge === "in" ? "in" : "out"} point`}
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("transition/type", t.value);
                              e.dataTransfer.setData("transition/edge", transitionEdge);
                            }}
                          >
                            <span className="trans-btn-icon">{TRANSITION_ICONS[t.value]}</span>
                            <span className="trans-btn-label">{t.label}</span>
                          </button>
                        );
                      })}
                  </div>

                  {/* Current transition display */}
                  {(fadeInType || fadeOutType) && (
                    <div className="transition-current-row">
                      {fadeInType && (
                        <div className="transition-current-item">
                          <span className="trans-cur-label">In:</span>
                          <span className="trans-cur-name">{ALL_TRANSITION_TYPES.find((t) => t.value === fadeInType)?.label ?? fadeInType}</span>
                          <span className="trans-cur-dur">{(fadeInFrames / fps).toFixed(1)}s</span>
                          <button
                            className="trans-clear-btn"
                            onClick={() => { onSetTransitionDuration("in", 0); onSetTransitionType("in", "cut"); }}
                            type="button"
                            title="Clear transition in"
                          >✕</button>
                        </div>
                      )}
                      {fadeOutType && (
                        <div className="transition-current-item">
                          <span className="trans-cur-label">Out:</span>
                          <span className="trans-cur-name">{ALL_TRANSITION_TYPES.find((t) => t.value === fadeOutType)?.label ?? fadeOutType}</span>
                          <span className="trans-cur-dur">{(fadeOutFrames / fps).toFixed(1)}s</span>
                          <button
                            className="trans-clear-btn"
                            onClick={() => { onSetTransitionDuration("out", 0); onSetTransitionType("out", "cut"); }}
                            type="button"
                            title="Clear transition out"
                          >✕</button>
                        </div>
                      )}
                    </div>
                  )}

                  {clipMessage && <span className="clip-message">{clipMessage}</span>}
                </div>

                {/* Actions */}
                <div className="inspector-card">
                  <p className="inspector-label">Clip Actions</p>
                  <div className="inline-actions">
                    <button
                      className={`panel-action${!selectedSegment.clip.isEnabled ? " primary" : ""}`}
                      onClick={() => onToggleClipEnabled(selectedSegment.clip.id)}
                      type="button"
                    >
                      {selectedSegment.clip.isEnabled ? "Disable" : "Enable"}
                    </button>
                    {selectedSegment.clip.linkedGroupId && (
                      <button
                        className="panel-action muted"
                        onClick={() => onDetachLinkedClips(selectedSegment.clip.id)}
                        title="Unlink audio from video — allows independent movement"
                        type="button"
                      >
                        🔗 Unlink A/V
                      </button>
                    )}
                    {!selectedSegment.clip.linkedGroupId && (
                      <button
                        className="panel-action muted"
                        onClick={() => onRelinkClips?.(selectedSegment.clip.id)}
                        title="Relink to matching audio/video clip at same time position"
                        type="button"
                      >
                        🔗 Relink A/V
                      </button>
                    )}
                    {selectedSegment.asset.hasAudio && (
                      <button className="panel-action muted" onClick={onExtractAudio} type="button">
                        Extract Audio
                      </button>
                    )}
                    <button className="panel-action danger" onClick={onRippleDelete} type="button">
                      Ripple Delete
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="inspector-card">
                <p className="inspector-label">No Clip Selected</p>
                <span>Click a clip in the timeline to inspect and edit it.</span>
              </div>
            )}

            {/* Asset info */}
            {selectedAsset && (
              <div className="inspector-card">
                <p className="inspector-label">Source Media</p>
                <strong>{selectedAsset.name}</strong>
                <div className="clip-meta-grid">
                  <span>Duration</span><strong>{formatDuration(selectedAsset.durationSeconds)}</strong>
                  <span>Size</span><strong>{selectedAsset.width}×{selectedAsset.height}</strong>
                  <span>FPS</span><strong>{selectedAsset.nativeFps.toFixed(2)}</strong>
                  <span>Audio</span><strong>{selectedAsset.hasAudio ? "Yes" : "No"}</strong>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── MASKS TAB ── */}
        {activeTab === "masks" && (
          <div className="inspector-stack">
            {selectedSegment ? (
              <div className="inspector-card">
                <p className="inspector-label">Masking Tools</p>
                <MaskInspector
                  clipId={selectedSegment.clip.id}
                  masks={selectedSegment.clip.masks}
                  selectedMaskId={selectedMaskId}
                  activeTool={activeMaskTool}
                  playheadFrame={selectedSegment.startFrame}
                  onSelectMask={onSelectMask}
                  onSetActiveTool={onSetActiveMaskTool}
                  onAddMask={onAddMask}
                  onUpdateMask={onUpdateMask}
                  onRemoveMask={onRemoveMask}
                />
                <p className="hint-text">
                  Select a mask tool above, then draw on the viewer canvas.<br />
                  Masks apply to color grading and effects.
                </p>
              </div>
            ) : (
              <div className="inspector-card">
                <p className="inspector-label">No Clip Selected</p>
                <span>Select a video clip to add and edit masks.</span>
              </div>
            )}
          </div>
        )}

        {/* ── EFFECTS TAB ── */}
        {activeTab === "effects" && (
          <div className="inspector-stack effects-tab-body">
            <EffectsPanel
              selectedSegment={selectedSegment}
              effects={selectedSegment?.clip.effects ?? []}
              aiBackgroundRemoval={selectedSegment?.clip.aiBackgroundRemoval ?? null}
              onAddEffect={onAddEffect}
              onUpdateEffect={onUpdateEffect}
              onRemoveEffect={onRemoveEffect}
              onToggleEffect={onToggleEffect}
              onReorderEffects={onReorderEffects}
              onToggleBackgroundRemoval={onToggleBackgroundRemoval}
              onSetBackgroundRemoval={onSetBackgroundRemoval}
            />
          </div>
        )}

        {/* ── AUDIO TAB ── */}
        {activeTab === "audio" && (
          <div className="inspector-stack">
            {selectedSegment ? (
              <div className="inspector-card">
                <p className="inspector-label">Audio Controls</p>
                <div className="field">
                  <label className="field-header">
                    <span>Volume</span>
                    <strong>{Math.round((selectedSegment.clip.volume ?? 1) * 100)}%</strong>
                  </label>
                  <input
                    type="range" min={0} max={2} step={0.01}
                    value={selectedSegment.clip.volume ?? 1}
                    onChange={(e) => onSetClipVolume(Number(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label className="field-header">
                    <span>Speed</span>
                    <strong>{(selectedSegment.clip.speed ?? 1).toFixed(2)}×</strong>
                  </label>
                  <input
                    type="range" min={0.1} max={4} step={0.05}
                    value={selectedSegment.clip.speed ?? 1}
                    onChange={(e) => onSetClipSpeed(Number(e.target.value))}
                  />
                </div>
                {selectedSegment.asset.hasAudio && (
                  <button className="panel-action muted" onClick={onExtractAudio} type="button">
                    Extract Audio to Track
                  </button>
                )}
              </div>
            ) : (
              <div className="inspector-card">
                <p className="inspector-label">No Clip Selected</p>
                <span>Select a clip to adjust audio settings.</span>
              </div>
            )}
          </div>
        )}

        {/* ── VOICE AI TAB ── */}
        {activeTab === "voice" && (
          <div className="inspector-stack">
            {/* Status */}
            <div className="inspector-card">
              <p className="inspector-label">Voice Chop AI</p>
              <div className="voice-status-row">
                <span className={`status-pill${voiceListening ? " live" : ""}`}>
                  {voiceListening ? "🔴 Listening" : "● Ready"}
                </span>
              </div>
              <span className="voice-status-text">{voiceStatus}</span>
              {voiceTranscript && <span className="voice-transcript">"{voiceTranscript}"</span>}
              {voiceLastCommand && <span className="voice-last-cmd">Last: {voiceLastCommand}</span>}

              <div className="inline-actions">
                <button
                  className={`panel-action${voiceListening ? " primary" : ""}`}
                  onClick={onToggleVoiceListening}
                  type="button"
                >
                  {voiceListening ? "⏹ Stop Mic" : "🎤 Start Mic"}
                </button>
                <button className="panel-action muted" onClick={onAnalyzeVoiceChops} type="button">
                  Chop For Me
                </button>
              </div>
            </div>

            {/* BPM Detection */}
            <div className="inspector-card">
              <p className="inspector-label">BPM & Beat Sync</p>
              {detectedBpm !== null && (
                <div className="bpm-display">
                  <span className="bpm-value">{detectedBpm}</span>
                  <span className="bpm-unit">BPM</span>
                  <span className="bpm-beats">{detectedBeatFrames.length} beats detected</span>
                </div>
              )}
              <div className="field">
                <label className="field-header">
                  <span>Manual BPM</span>
                  <strong>{voiceBpm}</strong>
                </label>
                <input
                  type="range" min={40} max={240} step={1}
                  value={voiceBpm}
                  onChange={(e) => onSetVoiceBpm(Number(e.target.value))}
                />
              </div>
              <div className="field">
                <label className="field-header">
                  <span>Grid Frames</span>
                  <strong>{voiceGridFrames}fr</strong>
                </label>
                <input
                  type="range" min={1} max={Math.max(fps * 2, 24)} step={1}
                  value={voiceGridFrames}
                  onChange={(e) => onSetVoiceGridFrames(Number(e.target.value))}
                />
              </div>
              <div className="inline-actions">
                <button className="panel-action" onClick={onDetectBpm} type="button">
                  Detect BPM
                </button>
                <button className="panel-action muted" onClick={() => onBeatSync("everyBeat")} type="button">
                  Every Beat
                </button>
                <button className="panel-action muted" onClick={() => onBeatSync("every2")} type="button">
                  Every 2
                </button>
                <button className="panel-action muted" onClick={() => onBeatSync("every4")} type="button">
                  Every 4
                </button>
              </div>
            </div>

            {/* Cut Actions */}
            <div className="inspector-card">
              <p className="inspector-label">Cut Suggestions</p>
              <span>
                {voiceSuggestedCutFrames.length
                  ? `${voiceSuggestedCutFrames.length} suggested cut${voiceSuggestedCutFrames.length === 1 ? "" : "s"}`
                  : "No suggestions yet"}
              </span>
              <div className="inline-actions">
                <button
                  className="panel-action"
                  disabled={!voiceSuggestedCutFrames.length}
                  onClick={onAcceptVoiceCuts}
                  type="button"
                >
                  Apply Cuts
                </button>
                <button
                  className="panel-action muted"
                  disabled={!voiceSuggestedCutFrames.length}
                  onClick={onClearVoiceCuts}
                  type="button"
                >
                  Clear
                </button>
                <button
                  className="panel-action muted"
                  disabled={!voiceSuggestedCutFrames.length}
                  onClick={onQuantizeVoiceCutsToBeat}
                  type="button"
                >
                  ⌀ Beat
                </button>
                <button
                  className="panel-action muted"
                  disabled={!voiceSuggestedCutFrames.length}
                  onClick={onQuantizeVoiceCutsToGrid}
                  type="button"
                >
                  ⌀ Grid
                </button>
              </div>
              <span className="marks-display">
                Mark In: {voiceMarkInFrame !== null ? formatTimecode(voiceMarkInFrame, fps) : "—"}
                {" · "}
                Mark Out: {voiceMarkOutFrame !== null ? formatTimecode(voiceMarkOutFrame, fps) : "—"}
              </span>
              <p className="hint-text">
                Say: "cut here" · "mark start/end" · "chop for me" · "detect bpm" · "apply cuts"
              </p>
            </div>
          </div>
        )}

        {/* ── EXPORT TAB ── */}
        {activeTab === "export" && (
          <div className="inspector-stack">
            <div className="inspector-card">
              <p className="inspector-label">Render</p>
              <strong>MP4 H.264 / AAC</strong>
              <div className="clip-meta-grid">
                <span>Resolution</span>
                <strong>{sequenceSettings.width}×{sequenceSettings.height}</strong>
                <span>Frame Rate</span>
                <strong>{sequenceSettings.fps} fps</strong>
                <span>Audio</span>
                <strong>{sequenceSettings.audioSampleRate / 1000} kHz</strong>
              </div>
              <button
                className="panel-action primary export-btn"
                disabled={exportBusy}
                onClick={() => void onExport()}
                type="button"
              >
                {exportBusy ? "⏳ Rendering…" : "▶ Export MP4"}
              </button>
              {exportMessage && (
                <span className={`export-message${exportMessage.startsWith("✓") ? " success" : " error"}`}>
                  {exportMessage}
                </span>
              )}
            </div>

            <div className="inspector-card">
              <p className="inspector-label">Environment</p>
              <strong className={environment?.ffmpegAvailable ? "text-success" : "text-warning"}>
                {environment?.ffmpegAvailable ? "✓ FFmpeg Ready" : "⚠ FFmpeg Unavailable"}
              </strong>
              <span>FFmpeg: {environment?.ffmpegPath ?? "not found"}</span>
              <span>FFprobe: {environment?.ffprobePath ?? "not found"}</span>
              {environment?.warnings.map((w) => (
                <span key={w} className="warning-text">{w}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
