/**
 * AIStoryboardPanel — EXCLUSIVE 1: AI Storyboard-to-Timeline
 * User types a text description → generates storyboard structure →
 * one-click creates labeled placeholder clips on the timeline.
 */
import React, { useState } from "react";
import { createId } from "../../shared/models";
import type { TimelineTrack, TimelineClip, TimelineMarker, MediaAsset } from "../../shared/models";

interface StoryboardScene {
  id: string;
  label: string;
  durationSeconds: number;
  description: string;
  color: string;
  broll?: string;
  musicMood?: string;
}

const SCENE_COLORS = ["#ef5350","#f7c948","#2fc77a","#4f8ef7","#a855f7","#e07820","#00bcd4","#ff5722"];

interface Props {
  fps: number;
  onCreateTimeline: (params: {
    tracks: TimelineTrack[];
    clips: TimelineClip[];
    markers: TimelineMarker[];
    assets: MediaAsset[];
  }) => void;
  onClose: () => void;
}

// Simple local parser — no AI call needed for basic structure
function parsePromptToScenes(prompt: string, fps: number): StoryboardScene[] {
  const lower = prompt.toLowerCase();
  const scenes: StoryboardScene[] = [];
  let colorIdx = 0;

  // Extract total duration hint
  const durMatch = lower.match(/(\d+)\s*[-–]?\s*minute/);
  const targetMinutes = durMatch ? parseInt(durMatch[1]) : 3;
  const totalSeconds = targetMinutes * 60;

  // Detect structure keywords
  const hasIntro   = lower.includes("intro") || lower.includes("hook");
  const hasOutro   = lower.includes("outro") || lower.includes("end") || lower.includes("cta");
  const hasBridge  = lower.includes("bridge") || lower.includes("transition");
  const destMatch  = lower.match(/(\d+)\s*destination/);
  const destCount  = destMatch ? parseInt(destMatch[1]) : 0;
  const topicMatch = lower.match(/(\d+)\s*topic/);
  const topicCount = topicMatch ? parseInt(topicMatch[1]) : 0;
  const actMatch   = lower.match(/(\d+)\s*act/);
  const actCount   = actMatch ? parseInt(actMatch[1]) : 0;

  const addScene = (label: string, dur: number, desc: string, broll?: string, mood?: string) => {
    scenes.push({
      id: createId(),
      label,
      durationSeconds: dur,
      description: desc,
      color: SCENE_COLORS[colorIdx++ % SCENE_COLORS.length],
      broll,
      musicMood: mood,
    });
  };

  // Build scene list from parsed keywords
  let remaining = totalSeconds;

  if (hasIntro) {
    const d = Math.min(20, remaining * 0.12);
    addScene("Intro / Hook", d, "Opening shot, hook the audience", "B-roll establishing shots", "Upbeat, energetic");
    remaining -= d;
  }

  if (destCount > 0) {
    const perDest = (remaining * 0.8) / destCount;
    for (let i = 1; i <= destCount; i++) {
      addScene(`Destination ${i}`, perDest, `Explore location ${i}`, `B-roll of destination ${i}`, "Adventurous, inspiring");
      remaining -= perDest;
    }
  } else if (topicCount > 0) {
    const perTopic = (remaining * 0.7) / topicCount;
    for (let i = 1; i <= topicCount; i++) {
      addScene(`Topic ${i}`, perTopic, `Cover topic ${i} in depth`, undefined, "Thoughtful");
      remaining -= perTopic;
    }
  } else if (actCount > 0) {
    const perAct = (remaining * 0.8) / actCount;
    for (let i = 1; i <= actCount; i++) {
      addScene(`Act ${i}`, perAct, `Narrative act ${i}`, undefined, i === 1 ? "Build tension" : i === actCount ? "Resolution" : "Rising action");
      remaining -= perAct;
    }
  } else {
    // Fallback: generic 3-part structure
    const part = remaining * 0.33;
    addScene("Main Content A", part, "First section of main content", undefined, "Engaging");
    addScene("Main Content B", part, "Second section of main content", undefined, "Building");
    remaining -= part * 2;
  }

  if (hasBridge && remaining > 0) {
    const d = Math.min(15, remaining * 0.15);
    addScene("Bridge / Transition", d, "Transition between sections", "Creative B-roll", "Mellow, reflective");
    remaining -= d;
  }

  if (hasOutro && remaining > 0) {
    addScene("Outro / CTA", Math.max(10, remaining), "Call to action, subscribe, links", "End card animation", "Warm, satisfied");
  } else if (remaining > 5) {
    addScene("Conclusion", remaining, "Wrap up, final thoughts", undefined, "Resolving");
  }

  return scenes.length > 0 ? scenes : [
    { id: createId(), label: "Opening", durationSeconds: totalSeconds * 0.2, description: "Opening sequence", color: SCENE_COLORS[0] },
    { id: createId(), label: "Main Content", durationSeconds: totalSeconds * 0.6, description: "Main section", color: SCENE_COLORS[1] },
    { id: createId(), label: "Closing", durationSeconds: totalSeconds * 0.2, description: "Closing sequence", color: SCENE_COLORS[2] },
  ];
}

export function AIStoryboardPanel({ fps, onCreateTimeline, onClose }: Props) {
  const [prompt, setPrompt] = useState("");
  const [scenes, setScenes] = useState<StoryboardScene[] | null>(null);
  const [generating, setGenerating] = useState(false);

  function handleGenerate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    // Simulate brief AI "thinking" delay
    setTimeout(() => {
      const generated = parsePromptToScenes(prompt, fps);
      setScenes(generated);
      setGenerating(false);
    }, 800);
  }

  function handleCreateTimeline() {
    if (!scenes) return;

    const videoTrackId = createId();
    const audioTrackId = createId();

    const videoTrack: TimelineTrack = {
      id: videoTrackId, name: "V1 — Story", kind: "video",
      muted: false, locked: false, solo: false, height: 56, color: "#4f8ef7"
    };
    const audioTrack: TimelineTrack = {
      id: audioTrackId, name: "A1 — Music", kind: "audio",
      muted: false, locked: false, solo: false, height: 44, color: "#f7c948"
    };

    const assets: MediaAsset[] = [];
    const clips: TimelineClip[] = [];
    const markers: TimelineMarker[] = [];
    let cursor = 0;

    for (const scene of scenes) {
      const durationFrames = Math.round(scene.durationSeconds * fps);
      const assetId = createId();

      const asset: MediaAsset = {
        id: assetId,
        name: `[Placeholder] ${scene.label}`,
        sourcePath: "",
        previewUrl: "",
        thumbnailUrl: null,
        durationSeconds: scene.durationSeconds,
        nativeFps: fps,
        width: 1920,
        height: 1080,
        hasAudio: false,
      };
      assets.push(asset);

      clips.push({
        id: createId(),
        assetId,
        trackId: videoTrackId,
        startFrame: cursor,
        trimStartFrames: 0,
        trimEndFrames: 0,
        linkedGroupId: null,
        isEnabled: true,
        transitionIn: null,
        transitionOut: null,
        masks: [],
        effects: [],
        colorGrade: null,
        volume: 1,
        speed: 1,
        transform: null,
        compGraph: null,
        aiBackgroundRemoval: null,
        beatSync: null,
      });

      markers.push({
        id: createId(),
        frame: cursor,
        label: scene.label,
        color: scene.color,
      });

      cursor += durationFrames;
    }

    onCreateTimeline({ tracks: [videoTrack, audioTrack], clips, markers, assets });
    onClose();
  }

  const totalDur = scenes ? scenes.reduce((s, sc) => s + sc.durationSeconds, 0) : 0;
  const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 8300 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#1a1a1f", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 28, width: 640, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#e8e8e8" }}>🤖 AI Storyboard → Timeline</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>
              Describe your video — Clawbot generates a scene structure with placeholder clips
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 18 }} type="button">✕</button>
        </div>

        {/* Prompt input */}
        <div style={{ display: "flex", gap: 8 }}>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={`Examples:\n• 3-minute travel vlog: intro, 3 destinations, outro\n• 5-minute documentary: 3 acts, cold open\n• 60-second product video with hook and CTA`}
            rows={4}
            style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "#e8e8e8", fontSize: 12, padding: "10px 12px", resize: "none", outline: "none", lineHeight: 1.5 }}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
          />
        </div>

        <button
          onClick={handleGenerate}
          disabled={!prompt.trim() || generating}
          style={{
            padding: "9px 18px", borderRadius: 8, alignSelf: "flex-start",
            background: prompt.trim() && !generating ? "linear-gradient(135deg,#7c3aed,#a855f7)" : "rgba(255,255,255,0.08)",
            border: "none", color: "#fff", fontSize: 12, fontWeight: 700,
            cursor: prompt.trim() && !generating ? "pointer" : "not-allowed",
            display: "flex", alignItems: "center", gap: 6,
          }}
          type="button"
        >
          {generating ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⚙️</span> Generating…</> : "✨ Generate Storyboard"}
        </button>

        {/* Scene list */}
        {scenes && (
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.6)", marginBottom: 4 }}>
              Generated Structure · {scenes.length} scenes · {fmtDur(totalDur)} total
            </div>
            {scenes.map((scene, i) => (
              <div
                key={scene.id}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "10px 12px",
                  borderLeft: `3px solid ${scene.color}`,
                }}
              >
                <div style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: scene.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff" }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#e8e8e8" }}>{scene.label}</span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.06)", padding: "1px 5px", borderRadius: 3 }}>{fmtDur(scene.durationSeconds)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{scene.description}</div>
                  {scene.broll && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>B-roll: {scene.broll}</div>}
                  {scene.musicMood && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>Music: {scene.musicMood}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer actions */}
        {scenes && (
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <button
              onClick={() => setScenes(null)}
              style={{ padding: "7px 14px", borderRadius: 7, background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.5)", fontSize: 12, cursor: "pointer" }}
              type="button"
            >
              Regenerate
            </button>
            <button
              onClick={handleCreateTimeline}
              style={{ padding: "7px 18px", borderRadius: 7, background: "linear-gradient(135deg,#4f8ef7,#7c3aed)", border: "none", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              type="button"
            >
              🎬 Create Timeline
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
