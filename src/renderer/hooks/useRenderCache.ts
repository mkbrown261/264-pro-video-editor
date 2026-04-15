import { useState, useCallback, useRef } from 'react';
import type { EditorProject, RenderCacheEntry, TimelineClip } from '../../shared/models';

// ── Local accessor for render-cache IPC ──────────────────────────────────────
// We cast through unknown to avoid conflicts with narrow Window augmentations
// in other modules (AuthGateModal, FlowStatePanel) that only declare a subset
// of electronAPI properties.
interface RenderCacheAPI {
  renderCacheSegment?: (args: {
    projectId: string;
    segmentHash: string;
    inputPath: string;
    startSeconds: number;
    durationSeconds: number;
    grade: Record<string, number>;
    speed: number;
  }) => Promise<{ success: boolean; filePath?: string; cached?: boolean; error?: string }>;
  clearRenderCache?: (projectId: string) => Promise<{ success: boolean; error?: string }>;
}
function getRenderCacheAPI(): RenderCacheAPI {
  return (window as unknown as { electronAPI?: RenderCacheAPI }).electronAPI ?? {};
}

// ── Segment hash ──────────────────────────────────────────────────────────────
// A stable hash string that changes whenever grade/effects/trim/speed change.
// Used as the cache key and the output filename.

export function computeSegmentHash(clip: TimelineClip): string {
  const grade = clip.colorGrade ?? {};
  const effects = clip.effects ?? [];
  const key = [
    clip.id,
    clip.trimStartFrames ?? 0,
    clip.trimEndFrames ?? 0,
    clip.speed ?? 1,
    JSON.stringify(grade),
    effects.map(e => `${e.type}:${JSON.stringify(e.params)}`).join('|'),
  ].join('__');

  // djb2 hash
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h) ^ key.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface RenderCacheState {
  entries: Record<string, RenderCacheEntry>;
  renderingSegments: Set<string>;
  progress: number; // 0-100
}

export function useRenderCache(project: EditorProject) {
  const [entries, setEntries] = useState<Record<string, RenderCacheEntry>>({});
  const [renderingSegments, setRenderingSegments] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState(0);
  const abortRef = useRef(false);

  const projectId = project.id ?? 'default';

  // ── Helpers ────────────────────────────────────────────────────────────────

  const isSegmentCached = useCallback(
    (clipId: string): boolean => {
      const clip = project.sequence.clips.find(c => c.id === clipId);
      if (!clip) return false;
      const hash = computeSegmentHash(clip);
      return !!entries[hash]?.valid;
    },
    [entries, project.sequence.clips]
  );

  const getCachedPath = useCallback(
    (clipId: string): string | null => {
      const clip = project.sequence.clips.find(c => c.id === clipId);
      if (!clip) return null;
      const hash = computeSegmentHash(clip);
      const entry = entries[hash];
      return entry?.valid ? entry.filePath : null;
    },
    [entries, project.sequence.clips]
  );

  // ── Render all uncached video clips ───────────────────────────────────────

  const renderAll = useCallback(async () => {
    abortRef.current = false;

    const videoClips = project.sequence.clips.filter(c => {
      const track = project.sequence.tracks.find(t => t.id === c.trackId);
      return (
        track?.kind === 'video' &&
        c.clipType !== 'adjustment' &&
        c.isEnabled !== false
      );
    });

    const uncached = videoClips.filter(c => {
      const hash = computeSegmentHash(c);
      return !entries[hash]?.valid;
    });

    if (uncached.length === 0) return;

    setRenderingSegments(new Set(uncached.map(c => c.id)));
    let done = 0;

    for (const clip of uncached) {
      if (abortRef.current) break;

      const asset = project.assets.find(a => a.id === clip.assetId);
      if (!asset?.sourcePath) {
        done++;
        setProgress(Math.round((done / uncached.length) * 100));
        continue;
      }

      const hash = computeSegmentHash(clip);
      const fps = project.sequence.settings.fps;
      const startSeconds = (clip.trimStartFrames ?? 0) / fps;
      const assetDur = asset.durationSeconds ?? 0;
      const trimEndSecs = (clip.trimEndFrames ?? 0) / fps;
      const durationSeconds = Math.max(
        0.1,
        (assetDur - startSeconds - trimEndSecs) / (clip.speed ?? 1)
      );

      // Flatten ColorGrade to the flat Record<string, number> that ffmpeg.ts uses
      const g = clip.colorGrade;
      const gradeFlat: Record<string, number> = g
        ? {
            exposure: g.exposure ?? 0,
            contrast: g.contrast ?? 0,
            saturation: g.saturation ?? 1,
            temperature: g.temperature ?? 0,
          }
        : {};

      try {
        const result = await getRenderCacheAPI().renderCacheSegment?.({
          projectId,
          segmentHash: hash,
          inputPath: asset.sourcePath,
          startSeconds,
          durationSeconds,
          grade: gradeFlat,
          speed: clip.speed ?? 1,
        });

        if (result?.success && result.filePath) {
          const entry: RenderCacheEntry = {
            segmentHash: hash,
            filePath: result.filePath,
            startFrame: clip.startFrame,
            endFrame:
              clip.startFrame + Math.round(durationSeconds * fps),
            fps,
            createdAt: Date.now(),
            valid: true,
          };
          setEntries(prev => {
            const next = { ...prev, [hash]: entry };
            // Trim to at most 500 entries (evict oldest by createdAt)
            const keys = Object.keys(next);
            if (keys.length > 500) {
              const sorted = keys.sort(
                (a, b) => (next[a].createdAt ?? 0) - (next[b].createdAt ?? 0)
              );
              const toEvict = sorted.slice(0, keys.length - 500);
              for (const k of toEvict) delete next[k];
            }
            return next;
          });
        }
      } catch {
        /* skip failed segments silently */
      }

      done++;
      setProgress(Math.round((done / uncached.length) * 100));
    }

    setRenderingSegments(new Set());
    setProgress(100);
    setTimeout(() => setProgress(0), 2000);
  }, [project, entries, projectId]);

  // ── Clear all cache ────────────────────────────────────────────────────────

  const clearCache = useCallback(async () => {
    await getRenderCacheAPI().clearRenderCache?.(projectId);
    setEntries({});
    setProgress(0);
  }, [projectId]);

  // ── Abort in-progress render ───────────────────────────────────────────────

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  return {
    entries,
    renderingSegments,
    progress,
    isSegmentCached,
    getCachedPath,
    renderAll,
    clearCache,
    abort,
  };
}
