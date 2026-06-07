import { useCallback, useEffect, useRef, useState } from 'react';
import { buildTimelineSegments } from '../../shared/timeline';
import type { EditorProject } from '../../shared/models';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AmbientSuggestion {
  id: string;
  type: 'grade_spread' | 'beat_grid' | 'audio_peak' | 'gap' | 'ungraded' | 'pacing' | 'sync_group';
  message: string;
  actionLabel: string;
  action: () => void;
  dismissable: boolean;
  priority: 'low' | 'medium' | 'high';
  createdAt: number;
}

interface UseClawFlowAmbientOptions {
  project: EditorProject;
  fps: number;
  onAutoColorMatch?: () => void;
  onNormalizeAudio?: (targetDb: -14 | -23) => void;
  onCloseAllGaps?: () => void;
  onOpenBeatSync?: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useClawFlowAmbient({
  project,
  fps,
  onAutoColorMatch,
  onNormalizeAudio,
  onCloseAllGaps,
  onOpenBeatSync,
}: UseClawFlowAmbientOptions) {
  const [suggestions, setSuggestions] = useState<AmbientSuggestion[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissedRef = useRef<Set<string>>(new Set());

  // Store project and callbacks in refs so `analyze` never needs to be recreated
  // when they change. This is the key fix for the infinite re-render loop:
  //
  // OLD (broken): analyze had [project, fps, onAutoColorMatch, ...] in deps.
  //   - `project` is a Zustand object — new reference on every store mutation
  //     (every clip drag, every playhead tick, every keystroke).
  //   - `onOpenBeatSync` was an inline arrow in App.tsx — new ref every render.
  //   - So: any store change → new `analyze` → useEffect fires → setSuggestions
  //     → App re-renders → new `analyze` → loop. Logged as "Maximum update depth exceeded".
  //
  // FIX: Keep project and all callbacks in refs. `analyze` reads from refs at
  // call-time (inside the setTimeout) so it always has fresh values without
  // being a dep itself. The debounce useEffect only depends on `clipCount` and
  // `fps` — stable primitives that only change when the timeline actually changes.
  const projectRef = useRef(project);
  projectRef.current = project;
  const onAutoColorMatchRef = useRef(onAutoColorMatch);
  onAutoColorMatchRef.current = onAutoColorMatch;
  const onNormalizeAudioRef = useRef(onNormalizeAudio);
  onNormalizeAudioRef.current = onNormalizeAudio;
  const onCloseAllGapsRef = useRef(onCloseAllGaps);
  onCloseAllGapsRef.current = onCloseAllGaps;
  const onOpenBeatSyncRef = useRef(onOpenBeatSync);
  onOpenBeatSyncRef.current = onOpenBeatSync;

  const dismissSuggestion = useCallback((id: string) => {
    dismissedRef.current.add(id);
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const actOnSuggestion = useCallback(
    (id: string) => {
      setSuggestions((prev) => {
        const sug = prev.find((s) => s.id === id);
        if (sug) {
          sug.action();
          dismissedRef.current.add(id);
          return prev.filter((s) => s.id !== id);
        }
        return prev;
      });
    },
    []
  );

  // analyze reads everything from refs — stable function, never recreated.
  const analyze = useCallback(() => {
    const proj = projectRef.current;
    if (!proj?.sequence?.tracks) return;

    const segments = buildTimelineSegments(proj.sequence, proj.assets);
    const videoSegs = segments
      .filter((s) => s.track.kind === 'video')
      .sort((a, b) => a.startFrame - b.startFrame);
    const audioSegs = segments.filter((s) => s.track.kind === 'audio');

    const newSugs: AmbientSuggestion[] = [];
    const add = (sug: Omit<AmbientSuggestion, 'createdAt'>) => {
      if (dismissedRef.current.has(sug.id)) return;
      newSugs.push({ ...sug, createdAt: Date.now() });
    };

    // 1. Beat Grid: music track added but no BeatSyncConfig
    const hasLongAudio = audioSegs.some((s) => s.asset.durationSeconds > 30 && s.asset.hasAudio);
    if (hasLongAudio && !proj.sequence.beatSync) {
      add({
        id: 'beat_grid_needed',
        type: 'beat_grid',
        message: '🎵 Music detected — draw beat grid?',
        actionLabel: 'Open Beat Sync',
        action: () => onOpenBeatSyncRef.current?.(),
        dismissable: true,
        priority: 'medium',
      });
    }

    // 2. Grade Spread: exposure difference > 0.3 between consecutive clips
    if (videoSegs.length >= 3) {
      let spreadCount = 0;
      for (let i = 1; i < videoSegs.length; i++) {
        const expA = videoSegs[i - 1].clip.colorGrade?.exposure ?? 0;
        const expB = videoSegs[i].clip.colorGrade?.exposure ?? 0;
        if (Math.abs(expA - expB) > 0.3) spreadCount++;
      }
      if (spreadCount >= 2) {
        add({
          id: 'grade_spread',
          type: 'grade_spread',
          message: `🎨 ${spreadCount + 1} clips have inconsistent exposure`,
          actionLabel: 'Auto-Match',
          action: () => onAutoColorMatchRef.current?.(),
          dismissable: true,
          priority: 'high',
        });
      }
    }

    // 3. Audio Peak: any audio clip with volume > 1.5
    const peakingClips = audioSegs.filter((s) => (s.clip.volume ?? 1) > 1.5);
    if (peakingClips.length > 0) {
      add({
        id: 'audio_peak',
        type: 'audio_peak',
        message: `🔊 ${peakingClips.length} clip${peakingClips.length > 1 ? 's' : ''} peak above safe level`,
        actionLabel: 'Normalize to -14 LUFS',
        action: () => onNormalizeAudioRef.current?.(-14),
        dismissable: true,
        priority: 'high',
      });
    }

    // 4. Pacing Alert: avg clip duration > 5s for fast-style project names
    if (videoSegs.length >= 3) {
      const avgDuration = videoSegs.reduce((sum, s) => sum + s.durationSeconds, 0) / videoSegs.length;
      const nameLower = (proj.name ?? '').toLowerCase();
      const isFastStyle =
        nameLower.includes('vlog') || nameLower.includes('travel') ||
        nameLower.includes('reel') || nameLower.includes('social');
      if (avgDuration > 5 && isFastStyle) {
        add({
          id: 'pacing_slow',
          type: 'pacing',
          message: `⚡ Avg cut is ${avgDuration.toFixed(1)}s — fast cuts perform better for this style`,
          actionLabel: 'Tighten Pacing',
          action: () => onOpenBeatSyncRef.current?.(),
          dismissable: true,
          priority: 'medium',
        });
      }
    }

    // 5. Ungraded Clips: 3+ clips with no color grade
    const ungradedSegs = videoSegs.filter((s) => {
      const cg = s.clip.colorGrade;
      return (
        !cg ||
        (cg.exposure === 0 &&
          cg.contrast === 0 &&
          (cg.saturation === 1 || cg.saturation === undefined) &&
          cg.temperature === 0 &&
          !cg.lutPath)
      );
    });
    if (ungradedSegs.length >= 3) {
      add({
        id: 'ungraded_clips',
        type: 'ungraded',
        message: `🎬 ${ungradedSegs.length} clips are ungraded`,
        actionLabel: 'Quick Grade All',
        action: () => onAutoColorMatchRef.current?.(),
        dismissable: true,
        priority: 'low',
      });
    }

    // 6. Gap Detection: gaps > 1s between video clips
    let gapCount = 0;
    for (let i = 1; i < videoSegs.length; i++) {
      const gapFrames = videoSegs[i].startFrame - videoSegs[i - 1].endFrame;
      if (gapFrames > fps) gapCount++;
    }
    if (gapCount > 0) {
      add({
        id: `gap_detected`,
        type: 'gap',
        message: `🕳 ${gapCount} gap${gapCount > 1 ? 's' : ''} in timeline`,
        actionLabel: 'Close Gaps',
        action: () => onCloseAllGapsRef.current?.(),
        dismissable: true,
        priority: 'medium',
      });
    }

    if (newSugs.length === 0) return;

    const priorityOrder: Record<AmbientSuggestion['priority'], number> = { high: 0, medium: 1, low: 2 };
    setSuggestions((prev) => {
      const existingIds = new Set(prev.map((s) => s.id));
      const toAdd = newSugs.filter((s) => !existingIds.has(s.id));
      if (toAdd.length === 0) return prev;
      return [...prev, ...toAdd].sort(
        (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
      );
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ^ Intentionally empty: analyze reads project/callbacks from refs at call-time.
  // This makes analyze a stable function reference that never triggers re-renders.

  // Re-run analysis only when the timeline meaningfully changes — clip count and
  // fps are cheap primitives. Playhead changes, volume tweaks, etc. do NOT
  // trigger re-analysis (they don't affect the suggestions anyway).
  const clipCount = project.sequence.clips.length;
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(analyze, 3000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [clipCount, fps, analyze]);

  return { suggestions, dismissSuggestion, actOnSuggestion };
}
