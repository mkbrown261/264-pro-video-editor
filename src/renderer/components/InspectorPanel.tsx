import type {
  ClipTransitionType,
  EnvironmentStatus,
  MediaAsset
} from "../../shared/models";
import type { TimelineSegment } from "../../shared/timeline";
import { formatDuration, formatTimecode } from "../lib/format";

const TRANSITION_OPTIONS: Array<{
  label: string;
  value: ClipTransitionType;
}> = [
  { label: "Fade", value: "fade" },
  { label: "Dip Black", value: "dipBlack" },
  { label: "Wipe", value: "wipe" },
  { label: "Shake", value: "shake" },
  { label: "Rumble", value: "rumble" },
  { label: "Glitch", value: "glitch" }
];

interface InspectorPanelProps {
  selectedAsset: MediaAsset | null;
  selectedSegment: TimelineSegment | null;
  environment: EnvironmentStatus | null;
  exportBusy: boolean;
  exportMessage: string | null;
  clipMessage: string | null;
  sequenceSettings: {
    width: number;
    height: number;
    fps: number;
    audioSampleRate: number;
  };
  voiceListening: boolean;
  voiceStatus: string;
  voiceTranscript: string;
  voiceLastCommand: string | null;
  voiceSuggestedCutFrames: number[];
  voiceMarkInFrame: number | null;
  voiceMarkOutFrame: number | null;
  voiceBpm: number;
  voiceGridFrames: number;
  onToggleClipEnabled: (clipId: string) => void;
  onDetachLinkedClips: (clipId: string) => void;
  onSetTransitionType: (
    edge: "in" | "out",
    type: ClipTransitionType
  ) => void;
  onSetTransitionDuration: (
    edge: "in" | "out",
    durationFrames: number
  ) => void;
  onExtractAudio: () => void;
  onRippleDelete: () => void;
  onToggleVoiceListening: () => void;
  onAnalyzeVoiceChops: () => void;
  onAcceptVoiceCuts: () => void;
  onClearVoiceCuts: () => void;
  onQuantizeVoiceCutsToBeat: () => void;
  onQuantizeVoiceCutsToGrid: () => void;
  onSetVoiceBpm: (bpm: number) => void;
  onSetVoiceGridFrames: (gridFrames: number) => void;
  onExport: () => Promise<void>;
}

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
  onToggleClipEnabled,
  onDetachLinkedClips,
  onSetTransitionType,
  onSetTransitionDuration,
  onExtractAudio,
  onRippleDelete,
  onToggleVoiceListening,
  onAnalyzeVoiceChops,
  onAcceptVoiceCuts,
  onClearVoiceCuts,
  onQuantizeVoiceCutsToBeat,
  onQuantizeVoiceCutsToGrid,
  onSetVoiceBpm,
  onSetVoiceGridFrames,
  onExport
}: InspectorPanelProps) {
  const maxFadeFrames = selectedSegment
    ? Math.max(
        0,
        Math.min(
          Math.round(sequenceSettings.fps * 2),
          selectedSegment.durationFrames - 1
        )
      )
    : 0;
  const fadeInFrames = selectedSegment?.clip.transitionIn?.durationFrames ?? 0;
  const fadeOutFrames = selectedSegment?.clip.transitionOut?.durationFrames ?? 0;
  const fadeInType = selectedSegment?.clip.transitionIn?.type ?? "fade";
  const fadeOutType = selectedSegment?.clip.transitionOut?.type ?? "fade";

  return (
    <section className="panel inspector-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Details</p>
          <h2>Inspector</h2>
        </div>
      </div>

      <div className="inspector-stack">
        <div className="inspector-card">
          <p className="inspector-label">Sequence</p>
          <strong>{sequenceSettings.width}x{sequenceSettings.height}</strong>
          <span>{sequenceSettings.fps} fps timeline</span>
          <span>{sequenceSettings.audioSampleRate / 1000} kHz audio</span>
        </div>

        {selectedSegment ? (
          <div className="inspector-card">
            <p className="inspector-label">Selected Clip</p>
            <strong>{selectedSegment.asset.name}</strong>
            <span>
              {selectedSegment.track.name} {selectedSegment.track.kind} clip at{" "}
              {formatTimecode(selectedSegment.startFrame, sequenceSettings.fps)}
            </span>
            <span>{formatDuration(selectedSegment.durationSeconds)} on timeline</span>
            <span>
              {selectedSegment.clip.isEnabled ? "Clip is active" : "Clip is disabled"}
            </span>
            <span>
              {selectedSegment.clip.linkedGroupId
                ? "Linked A/V behavior is active"
                : "Independent clip behavior"}
            </span>
            <div className="field">
              <label className="field-header">
                <span>Transition In</span>
                <strong>{(fadeInFrames / sequenceSettings.fps).toFixed(2)} sec</strong>
              </label>
              <select
                className="field-select"
                onChange={(event) =>
                  onSetTransitionType(
                    "in",
                    event.target.value as ClipTransitionType
                  )
                }
                value={fadeInType}
              >
                {TRANSITION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                disabled={maxFadeFrames === 0}
                max={maxFadeFrames}
                min={0}
                onChange={(event) =>
                  onSetTransitionDuration("in", Number(event.target.value))
                }
                step={1}
                type="range"
                value={Math.min(fadeInFrames, maxFadeFrames)}
              />
            </div>
            <div className="field">
              <label className="field-header">
                <span>Transition Out</span>
                <strong>{(fadeOutFrames / sequenceSettings.fps).toFixed(2)} sec</strong>
              </label>
              <select
                className="field-select"
                onChange={(event) =>
                  onSetTransitionType(
                    "out",
                    event.target.value as ClipTransitionType
                  )
                }
                value={fadeOutType}
              >
                {TRANSITION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                disabled={maxFadeFrames === 0}
                max={maxFadeFrames}
                min={0}
                onChange={(event) =>
                  onSetTransitionDuration("out", Number(event.target.value))
                }
                step={1}
                type="range"
                value={Math.min(fadeOutFrames, maxFadeFrames)}
              />
            </div>
            <div className="inline-actions">
              <button
                className="panel-action"
                onClick={() => onToggleClipEnabled(selectedSegment.clip.id)}
                type="button"
              >
                {selectedSegment.clip.isEnabled ? "Disable Clip" : "Enable Clip"}
              </button>
              {selectedSegment.clip.linkedGroupId ? (
                <button
                  className="panel-action muted"
                  onClick={() => onDetachLinkedClips(selectedSegment.clip.id)}
                  type="button"
                >
                  Unlink A/V
                </button>
              ) : null}
              {selectedSegment.asset.hasAudio ? (
                <button
                  className="panel-action muted"
                  onClick={onExtractAudio}
                  type="button"
                >
                  Extract Audio
                </button>
              ) : null}
              <button
                className="panel-action muted"
                onClick={onRippleDelete}
                type="button"
              >
                Ripple Delete
              </button>
            </div>
            {clipMessage ? <span>{clipMessage}</span> : null}
            <span>Use the timeline handles to trim. Use the inspector to change behavior.</span>
          </div>
        ) : null}

        {selectedAsset ? (
          <div className="inspector-card">
            <p className="inspector-label">Selected Media</p>
            <strong>{selectedAsset.name}</strong>
            <span>{formatDuration(selectedAsset.durationSeconds)}</span>
            <span>
              {selectedAsset.width}x{selectedAsset.height} at {selectedAsset.nativeFps.toFixed(2)} fps
            </span>
            <span>{selectedAsset.hasAudio ? "Contains audio" : "Silent source"}</span>
          </div>
        ) : null}

        <div className="inspector-card">
          <p className="inspector-label">Voice Chop AI</p>
          <div className="voice-status-row">
            <strong>{voiceListening ? "Listening" : "Ready"}</strong>
            <span className={`status-pill${voiceListening ? " live" : ""}`}>
              {voiceListening ? "Mic Live" : "Mic Idle"}
            </span>
          </div>
          <span>{voiceStatus}</span>
          {voiceTranscript ? <span>Transcript: {voiceTranscript}</span> : null}
          {voiceLastCommand ? <span>Last command: {voiceLastCommand}</span> : null}
          <div className="field">
            <label className="field-header">
              <span>Beat Grid</span>
              <strong>{voiceBpm} BPM</strong>
            </label>
            <input
              min={40}
              max={240}
              onChange={(event) => onSetVoiceBpm(Number(event.target.value))}
              step={1}
              type="range"
              value={voiceBpm}
            />
          </div>
          <div className="field">
            <label className="field-header">
              <span>Timeline Grid</span>
              <strong>{voiceGridFrames} fr</strong>
            </label>
            <input
              min={1}
              max={Math.max(sequenceSettings.fps * 2, 24)}
              onChange={(event) => onSetVoiceGridFrames(Number(event.target.value))}
              step={1}
              type="range"
              value={voiceGridFrames}
            />
          </div>
          <div className="inline-actions">
            <button className="panel-action" onClick={onToggleVoiceListening} type="button">
              {voiceListening ? "Stop Voice" : "Start Voice"}
            </button>
            <button className="panel-action muted" onClick={onAnalyzeVoiceChops} type="button">
              Chop For Me
            </button>
            <button
              className="panel-action muted"
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
          </div>
          <div className="inline-actions">
            <button
              className="panel-action muted"
              disabled={!voiceSuggestedCutFrames.length}
              onClick={onQuantizeVoiceCutsToBeat}
              type="button"
            >
              Quantize Beat
            </button>
            <button
              className="panel-action muted"
              disabled={!voiceSuggestedCutFrames.length}
              onClick={onQuantizeVoiceCutsToGrid}
              type="button"
            >
              Quantize Grid
            </button>
          </div>
          <span>
            Marks: {voiceMarkInFrame !== null ? formatTimecode(voiceMarkInFrame, sequenceSettings.fps) : "--:--:--:--"} to{" "}
            {voiceMarkOutFrame !== null ? formatTimecode(voiceMarkOutFrame, sequenceSettings.fps) : "--:--:--:--"}
          </span>
          <span>
            Suggested cuts: {voiceSuggestedCutFrames.length ? voiceSuggestedCutFrames.map((frame) => formatTimecode(frame, sequenceSettings.fps)).join(", ") : "none yet"}
          </span>
          <span>Say “cut here”, “mark start”, “mark end”, “quantize to beat”, or “chop for me”.</span>
        </div>

        <div className="inspector-card">
          <p className="inspector-label">Render</p>
          <strong>MP4 H.264</strong>
          <span>Export renders enabled video clips, linked audio, and clip fade transitions.</span>
          <button
            className="panel-action"
            disabled={exportBusy}
            onClick={() => void onExport()}
            type="button"
          >
            {exportBusy ? "Rendering..." : "Export MP4"}
          </button>
          {exportMessage ? <span>{exportMessage}</span> : null}
        </div>

        <div className="inspector-card">
          <p className="inspector-label">Environment</p>
          <strong>{environment?.ffmpegAvailable ? "Ready" : "Needs setup"}</strong>
          <span>FFmpeg: {environment?.ffmpegPath ?? "unknown"}</span>
          <span>FFprobe: {environment?.ffprobePath ?? "unknown"}</span>
          {environment?.warnings.map((warning) => (
            <span key={warning} className="warning-text">
              {warning}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
