import type { EditorProject, MediaAsset, TimelineClip } from "../../shared/models";
import { isColorGradeDefault } from "../../shared/models";
import { buildTimelineSegments, getTotalDurationFrames } from "../../shared/timeline";
import { pictureGaps } from "../../shared/timelineHealth";
import React, { useEffect, useState, useRef } from 'react';

interface Issue {
  severity: 'high' | 'medium' | 'low';
  label: string;
  detail: string;
  fixLabel: string;
  onFix: () => void;
}

interface ProjectIntelligencePanelProps {
  project: EditorProject;
  fps: number;
  onClose: () => void;
  onAutoFixAll: () => void;
  onGoToPublish: () => void;
  onAutoColorMatch: () => void;
  onNormalizeAudio: () => void;
  onCloseGaps: () => void;
}

function analyzeProject(project: EditorProject, fps: number) {
  if (!project?.sequence?.tracks) {
    return { score: 100, issues: [], checks: [] };
  }

  const assets: MediaAsset[] = project.assets ?? [];
  const allClips: TimelineClip[] = project.sequence.clips ?? [];

  const videoTracks = project.sequence.tracks.filter((t) => t.kind === 'video');
  const audioTracks = project.sequence.tracks.filter((t) => t.kind === 'audio');
  const videoTrackIds = new Set<string>(videoTracks.map((t) => t.id));
  const audioTrackIds = new Set<string>(audioTracks.map((t) => t.id));
  const allVideoClips = allClips.filter((c) => videoTrackIds.has(c.trackId));
  const allAudioClips = allClips.filter((c) => audioTrackIds.has(c.trackId));

  const issues: Array<{ severity: 'high' | 'medium' | 'low'; label: string; detail: string; fixLabel: string }> = [];
  const checks: string[] = [];

  // Ungraded footage (any active grade or grade node counts)
  const segs = buildTimelineSegments(project.sequence, assets).filter((g) => g.clip.isEnabled);
  const footage = segs.filter((g) => g.track.kind === 'video' && g.asset.sourcePath && !g.clip.titleConfig && !g.clip.nestedSequenceId);
  const ungradedCount = footage.filter((g) =>
    !((g.clip.colorGrade && !g.clip.colorGrade.bypass && !isColorGradeDefault(g.clip.colorGrade)) || (g.clip.gradeNodes?.length ?? 0) > 0)
  ).length;
  if (ungradedCount > 0) {
    issues.push({
      severity: 'medium',
      label: 'COLOR',
      detail: `${ungradedCount} clip${ungradedCount > 1 ? 's' : ''} ungraded — inconsistent look`,
      fixLabel: 'Auto-Match All',
    });
  } else {
    checks.push('All clips are color graded');
  }

  // Audio peaks
  const peakingCount = allAudioClips.filter((c) => (c.volume ?? 1) > 1.3).length;
  if (peakingCount > 0) {
    issues.push({
      severity: 'high',
      label: 'AUDIO',
      detail: `${peakingCount} audio clip${peakingCount > 1 ? 's' : ''} peak above safe level`,
      fixLabel: 'Normalize to -14 LUFS',
    });
  } else {
    checks.push('Audio levels are safe');
  }

  // Black gaps in the composed picture
  const gapCount = pictureGaps(project, 5).length;
  if (gapCount > 0) {
    issues.push({
      severity: 'low',
      label: 'GAPS',
      detail: `${gapCount} black gap${gapCount > 1 ? 's' : ''} in the picture`,
      fixLabel: 'Close Gaps',
    });
  } else {
    checks.push('No timeline gaps');
  }

  // Avg cut duration
  if (allVideoClips.length >= 3) {
    const avgCutSec = footage.reduce((sum: number, g) => sum + g.durationFrames / fps, 0) / Math.max(1, footage.length);
    if (avgCutSec > 6) {
      issues.push({
        severity: 'medium',
        label: 'PACING',
        detail: `Avg cut: ${avgCutSec.toFixed(1)}s — slow for high-engagement content`,
        fixLabel: 'Open Beat Sync',
      });
    } else {
      checks.push(`Good pacing (avg ${avgCutSec.toFixed(1)}s cuts)`);
    }
  }

  // Compute score
  let score = 100;
  const hasHigh = issues.some(i => i.severity === 'high');
  const hasMed = issues.some(i => i.severity === 'medium');
  const hasLow = issues.some(i => i.severity === 'low');
  if (hasHigh) score -= 25;
  if (hasMed) score -= 15 * issues.filter(i => i.severity === 'medium').length;
  if (hasLow) score -= 5;
  score = Math.max(0, score);

  return { score, issues, checks };
}

export function ProjectIntelligencePanel({
  project, fps, onClose, onAutoFixAll, onGoToPublish,
  onAutoColorMatch, onNormalizeAudio, onCloseGaps,
}: ProjectIntelligencePanelProps) {
  const [analysis, setAnalysis] = useState<{ score: number; issues: Array<{ severity: 'high' | 'medium' | 'low'; label: string; detail: string; fixLabel: string }>; checks: string[] }>({ score: 100, issues: [], checks: [] });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setAnalysis(analyzeProject(project, fps));
    }, 800);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [project, fps]);

  const { score, issues, checks } = analysis;

  const scoreColor = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : score >= 40 ? '#f97316' : '#ef4444';
  const scoreLabel = score >= 80 ? '🟢 Ready to publish' : score >= 60 ? '🟡 Almost there' : score >= 40 ? '🟠 Needs attention' : '🔴 Significant issues';

  const severityIcon = (s: 'high' | 'medium' | 'low') =>
    s === 'high' ? '🔴' : s === 'medium' ? '🟡' : '🟢';

  function getFixHandler(fixLabel: string) {
    if (fixLabel === 'Auto-Match All') return onAutoColorMatch;
    if (fixLabel === 'Normalize to -14 LUFS') return onNormalizeAudio;
    if (fixLabel === 'Close Gaps') return onCloseGaps;
    return () => {};
  }

  const projectName = project?.name ?? 'Untitled Project';
  const clipCount = project?.sequence?.clips?.length ?? 0;
  const totalDurationFrames = project?.sequence ? getTotalDurationFrames(buildTimelineSegments(project.sequence, project.assets ?? [])) : 0;
  const totalMinutes = Math.floor(totalDurationFrames / fps / 60);
  const totalSeconds = Math.floor((totalDurationFrames / fps) % 60);

  return (
    <div style={{
      position: 'fixed', right: 16, top: 60, width: 380, zIndex: 200,
      background: '#1a1a2e', border: '1px solid #312e81',
      borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
      fontFamily: 'inherit', color: '#e2e8f0', maxHeight: 'calc(100vh - 80px)',
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>📋 Project Intelligence</span>
            <span style={{ fontSize: 10, color: '#c4b5fd', fontWeight: 700,
              background: 'rgba(124,58,237,0.2)', padding: '1px 6px', borderRadius: 4 }}>⚡ ClawFlow</span>
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#c4b5fd' }}>"{projectName}"</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
            {totalMinutes}:{totalSeconds.toString().padStart(2, '0')} · {clipCount} clips
          </div>
        </div>
        {/* Score */}
        <div style={{ textAlign: 'center', marginLeft: 12 }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: scoreColor, lineHeight: 1 }}>{score}</div>
          <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>/ 100</div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16, marginLeft: 8,
        }}>✕</button>
      </div>

      {/* Score label */}
      <div style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span style={{ fontSize: 11, fontWeight: 600 }}>{scoreLabel}</span>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Issues */}
        {issues.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              ⚡ Issues Found ({issues.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {issues.map((issue, i) => (
                <div key={i} style={{
                  background: 'rgba(255,255,255,0.03)', borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.06)', padding: '10px 12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>
                      {severityIcon(issue.severity)} {issue.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#e2e8f0', marginBottom: 8 }}>{issue.detail}</div>
                  <button
                    onClick={getFixHandler(issue.fixLabel)}
                    style={{
                      padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', fontSize: 11, fontWeight: 600,
                    }}
                  >
                    {issue.fixLabel}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Passing checks */}
        {checks.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              ✅ Looks Good
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {checks.map((c, i) => (
                <div key={i} style={{ fontSize: 12, color: '#64748b' }}>• {c}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div style={{
        padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', gap: 8,
      }}>
        <button
          onClick={onAutoFixAll}
          style={{
            flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #7c3aed, #2563eb)',
            color: 'white', fontSize: 12, fontWeight: 700,
          }}
        >
          🔧 Auto-Fix All Issues
        </button>
        <button
          onClick={onGoToPublish}
          style={{
            flex: 1, padding: '9px 0', borderRadius: 8,
            border: '1px solid rgba(124,58,237,0.4)',
            background: 'rgba(124,58,237,0.1)', color: '#c4b5fd', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >
          📤 Go to Publish
        </button>
      </div>
    </div>
  );
}
