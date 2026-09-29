import { create } from "zustand";
import {
  type ClipEffect,
  type ClipMask,
  type ClipTransitionType,
  type ColorGrade,
  type ColorStill,
  type Transcript,
  type DuckingSettings,
  createDefaultColorGrade,
  createEmptyClip,
  createEmptyProject,
  createId,
  type BeatSyncConfig,
  type BackgroundRemovalConfig,
  type EditorTool,
  type EditorPage,
  type EnvironmentStatus,
  type MediaAsset,
  type TimelineClip,
  type TimelineMarker,
  type TimelineTrack,
  type TimelineTrackKind
} from "../../shared/models";
import {
  buildTimelineSegments,
  shiftClipKeyframes,
  clampTrimEnd,
  clampTrimStart,
  findPlayableSegmentAtFrame,
  findSegmentAtFrame,
  getAssetDurationFrames,
  getClipDurationFrames,
  getClipTransitionDurationFrames,
  getTotalDurationFrames,
  getTrackEndFrame,
  normalizeTimelineFps
} from "../../shared/timeline";

type EditorProjectState = ReturnType<typeof createEmptyProject>;

// ── Undo/Redo Command ─────────────────────────────────────────────────────────

/**
 * A Command captures the full "before" and "after" snapshots of the
 * mutable editor state so undo/redo can precisely restore either.
 * Only project + selection + playback are included — UI-only state
 * (activePage, toolMode, environment) is intentionally excluded.
 */
interface UndoableSnapshot {
  project: EditorProjectState;
  selectedAssetId: string | null;
  selectedClipId: string | null;
  playbackFrame: number;
}

interface Command {
  /** Short human-readable label for display / debugging */
  label: string;
  /** When recorded (ms) — rapid repeats of the same action merge into one step. */
  at?: number;
  before: UndoableSnapshot;
  after: UndoableSnapshot;
}

const MAX_UNDO = 200;
/** Same-label edits closer together than this (slider drags) are one undo step. */
const UNDO_MERGE_MS = 800;

interface EditorStore {
  project: EditorProjectState;
  selectedAssetId: string | null;
  selectedClipId: string | null;
  toolMode: EditorTool;
  activePage: EditorPage;
  environment: EnvironmentStatus | null;
  playback: {
    isPlaying: boolean;
    playheadFrame: number;
  };

  // ── Undo/Redo ──
  undoStack: Command[];
  redoStack: Command[];
  canUndo: boolean;
  canRedo: boolean;

  // ── Asset Management ──
  importAssets: (assets: MediaAsset[]) => void;
  setAssetWaveform: (assetId: string, peaks: number[]) => void;
  /** Patch a thumbnail URL after async generation (non-undoable) */
  setAssetThumbnail: (assetId: string, thumbnailUrl: string) => void;
  /** Fix 6: Store filmstrip thumb data URLs (non-undoable) */
  setAssetFilmstrip: (assetId: string, thumbs: string[]) => void;
  /** Swap previewUrl once background proxy encoding finishes (non-undoable) */
  setAssetPreviewUrl: (assetId: string, previewUrl: string) => void;
  appendAssetToTimeline: (assetId: string) => void;
  dropAssetAtFrame: (assetId: string, trackId: string, startFrame: number) => void;
  /** Subtitle cues live in the project (saved, exported, burnable). */
  addSubtitleCue: (cue: import("../../shared/models").SubtitleCue) => void;
  updateSubtitleCue: (id: string, updates: Partial<import("../../shared/models").SubtitleCue>) => void;
  removeSubtitleCue: (id: string) => void;
  /** Add a recorded (voiceover) asset and place it on a free audio track at startFrame. */
  addRecordedAudio: (asset: MediaAsset, startFrame: number) => void;
  /**
   * Swap a clip's audio for a processed render of it (same timing). `extra`
   * (e.g. the second stem) lands on a free audio track under the clip.
   */
  applyProcessedAudio: (clipId: string, processed: MediaAsset, extra?: MediaAsset | null) => void;
  selectAsset: (assetId: string | null) => void;
  selectClip: (clipId: string | null) => void;

  // ── Clip Movement ──
  moveClip: (clipId: string, direction: -1 | 1) => void;
  moveClipTo: (clipId: string, trackId: string, startFrame: number) => void;
  trimClipStart: (clipId: string, nextTrimStartFrames: number) => void;
  trimClipEnd: (clipId: string, nextTrimEndFrames: number) => void;
  splitSelectedClipAtPlayhead: () => void;
  splitClipAtFrame: (clipId: string, frame: number) => void;
  splitClipsAtBeats: (beatFrames: number[], targetClipIds?: string[]) => void;
  removeSelectedClip: () => void;
  removeClipById: (clipId: string) => void;
  duplicateClip: (clipId: string) => void;
  setMagneticTimeline: (enabled: boolean) => void;
  toggleClipEnabled: (clipId: string) => void;
  detachLinkedClips: (clipId: string) => void;
  relinkClips: (clipId: string) => void;

  // ── Transitions ──
  applyTransitionToSelectedClip: (edge: "in" | "out", type?: ClipTransitionType) => string | null;
  setSelectedClipTransitionType: (edge: "in" | "out", type: ClipTransitionType) => string | null;
  setSelectedClipTransitionDuration: (edge: "in" | "out", durationFrames: number) => string | null;
  clearTransition: (clipId: string, edge: "in" | "out") => void;

  // ── Audio ──
  extractAudioFromSelectedClip: () => string | null;
  setClipVolume: (clipId: string, volume: number) => void;
  setClipSpeed: (clipId: string, speed: number) => void;
  setClipTransform: (clipId: string, updates: Partial<import("../../shared/models").ClipTransform>) => void;

  // ── Keyframes ──
  addKeyframe: (clipId: string, property: "opacity" | "volume" | "posX" | "posY" | "scaleX" | "scaleY" | "rotation", frame: number, value: number) => void;
  removeKeyframe: (clipId: string, property: "opacity" | "volume" | "posX" | "posY" | "scaleX" | "scaleY" | "rotation", frame: number) => void;
  updateKeyframe: (clipId: string, property: "opacity" | "volume" | "posX" | "posY" | "scaleX" | "scaleY" | "rotation", frame: number, value: number) => void;

  // ── Masks ──
  addMaskToClip: (clipId: string, mask: ClipMask) => void;
  updateMask: (clipId: string, maskId: string, updates: Partial<ClipMask>) => void;
  removeMask: (clipId: string, maskId: string) => void;
  reorderMasks: (clipId: string, fromIdx: number, toIdx: number) => void;

  // ── Effects ──
  addEffectToClip: (clipId: string, effect: ClipEffect) => void;
  updateEffect: (clipId: string, effectId: string, updates: Partial<ClipEffect>) => void;
  removeEffect: (clipId: string, effectId: string) => void;
  toggleEffect: (clipId: string, effectId: string) => void;
  reorderEffects: (clipId: string, fromIdx: number, toIdx: number) => void;
  /** Phase 8: Add a keyframe for an effect parameter */
  addEffectKeyframe: (clipId: string, effectId: string, paramKey: string, frame: number, value: number) => void;
  /** Bezier curve editor: replace all keyframes for an effect parameter */
  updateEffectKeyframes: (clipId: string, effectId: string, paramName: string, keyframes: import("../components/KeyframeCurveEditor").CurveKeyframe[]) => void;

  // ── Color Grading ──
  setColorGrade: (clipId: string, grade: Partial<ColorGrade>) => void;
  resetColorGrade: (clipId: string) => void;
  enableColorGrade: (clipId: string) => void;
  /** Switch active grade slot (A/B/C). Stores current grade into current slot first. */
  switchGradeSlot: (clipId: string, slot: 'A' | 'B' | 'C') => void;
  /** Copy the grade from slot A to slot B for quick comparison */
  copyGradeToSlot: (clipId: string, fromSlot: 'A' | 'B' | 'C', toSlot: 'A' | 'B' | 'C') => void;
  /** Grade clipboard: the whole serial chain (node 1 + extra nodes). */
  gradeClipboard: { colorGrade: ColorGrade; gradeNodes: import("../../shared/models").GradeNode[] } | null;
  copyGrade: (clipId: string) => void;
  pasteGrade: (clipIds: string[]) => void;

// ── Background Removal ──
  setBackgroundRemoval: (clipId: string, config: Partial<BackgroundRemovalConfig>) => void;
  toggleBackgroundRemoval: (clipId: string) => void;

  // ── Beat Sync ──
  setBeatSync: (clipId: string | null, config: Partial<BeatSyncConfig>) => void;
  clearBeatSync: (clipId: string | null) => void;

  // ── Tracks ──
  addTrack: (kind: TimelineTrackKind) => void;
  removeTrack: (trackId: string) => void;
  updateTrack: (trackId: string, updates: Partial<TimelineTrack>) => void;
  duplicateTrack: (trackId: string) => void;
  /** Set or update an automation keyframe on a track */
  setAutomationKeyframe: (trackId: string, param: 'volume' | 'pan', frame: number, value: number) => void;
  /** Remove an automation keyframe */
  removeAutomationKeyframe: (trackId: string, param: 'volume' | 'pan', frame: number) => void;
  /** Toggle automation lane enabled */
  toggleAutomationLane: (trackId: string, param: 'volume' | 'pan') => void;
  /** Phase 8: Toggle track locked state */
  toggleTrackLock: (trackId: string) => void;
  /** Phase 8: Toggle track solo state */
  toggleTrackSolo: (trackId: string) => void;
  /** Phase 8: Add adjustment layer at given time range on topmost video track */
  addAdjustmentLayer: (startFrame: number, durationFrames: number) => void;
  /** Phase 8: Set/update ducking settings */
  setDuckingSettings: (settings: import("../../shared/models").DuckingSettings[]) => void;
  /** Patch any fields on a TimelineClip directly (used for new features like speedRamp, titleConfig) */
  patchClip: (clipId: string, updates: Partial<import("../../shared/models").TimelineClip>) => void;
  /** Add an asset to the project pool without appending to timeline */
  addAsset: (asset: import("../../shared/models").MediaAsset) => void;
  /** Directly insert a clip (already constructed) into the timeline */
  insertClip: (clip: import("../../shared/models").TimelineClip) => void;
  /** Put a video clip (titles, graphics) on the top video track, adding a new top track if that spot is taken. */
  insertClipOnTop: (clip: import("../../shared/models").TimelineClip) => void;
  /**
   * Source-viewer edit: put [inFrame, outFrame) of an asset at `frame` on the
   * first unlocked video track (plus its audio on the first unlocked audio
   * track). "insert" ripples everything after `frame` on unlocked tracks;
   * "overwrite" replaces what's under the new clip.
   */
  editAtFrame: (assetId: string, frame: number, inFrame: number, outFrame: number, mode: "insert" | "overwrite") => void;
  /**
   * Atomically: create a new video track (+ paired audio track if the clip
   * has linked audio), move the dragged clip group into those new tracks,
   * preserving start-frame and audio/video sync.
   * @param insertIndex  Position in sequence.tracks[] where the new video
   *                     track is spliced.  0 = top, tracks.length = bottom.
   */
  addTracksAndMoveClip: (clipId: string, startFrame: number, insertIndex: number) => void;

  /**
   * Atomically: create a new video track (+ paired audio track if the asset
   * has audio), drop the media-pool asset into those new tracks at the given
   * frame and insertIndex.  Used when dragging from the media pool to a
   * between-track ghost zone.
   */
  addTracksAndDropAsset: (assetId: string, startFrame: number, insertIndex: number) => void;

  /** Reorder a track by moving it to a new index in sequence.tracks[]. */
  reorderTrack: (trackId: string, toIndex: number) => void;

  /** Swap two clips in the storyboard by exchanging their startFrame (and trackId). */
  reorderClips: (draggedClipId: string, targetClipId: string) => void;

  // ── Markers ──
  addMarker: (marker: Omit<TimelineMarker, "id">) => void;
  removeMarker: (markerId: string) => void;
  updateMarker: (markerId: string, updates: Partial<TimelineMarker>) => void;

  // ── Playhead & Playback ──
  setPlayheadFrame: (playheadFrame: number) => void;
  nudgePlayhead: (deltaFrames: number) => void;
  setPlaybackPlaying: (isPlaying: boolean) => void;
  stopPlayback: () => void;

  // ── Tool & Page ──
  setToolMode: (toolMode: EditorTool) => void;
  toggleBladeTool: () => void;
  setActivePage: (page: EditorPage) => void;
  setEnvironment: (environment: EnvironmentStatus) => void;

  // ── Undo/Redo actions ──
  undo: () => void;
  redo: () => void;

  // ── Project persistence ──
  loadProjectFromData: (project: EditorProjectState) => void;
  getCurrentProjectSnapshot: () => EditorProjectState;

  // ── Sequence settings ──
  updateSequenceSettings: (settings: Partial<{ width: number; height: number; fps: number; aspectRatio: string; audioSampleRate: number; masterVolume: number }>) => void;

  // ── Fusion / Compositing ──
  fusionClipId: string | null;
  openFusion: (clipId: string) => void;
  closeFusion: () => void;
  setCompGraph: (clipId: string, graph: import("../../shared/compositing").CompGraph) => void;
  clearCompGraph: (clipId: string) => void;

  // ── Ripple operations ──
  rippleDelete: (clipId: string) => void;

  // ── Precision Trim operations ──
  rippleTrim: (clipId: string, side: 'start' | 'end', deltaFrames: number) => void;
  rollTrim: (clipId: string, deltaFrames: number) => void;
  slip: (clipId: string, deltaFrames: number) => void;
  slide: (clipId: string, deltaFrames: number) => void;

  // ── Fixed Playhead Mode ──
  fixedPlayheadMode: boolean;
  toggleFixedPlayheadMode: () => void;

  // ── Transcripts (Text-Based Editing) ──
  setTranscript: (assetId: string, transcript: Transcript) => void;

  // ── Color Stills Gallery ──
  addColorStill: (still: ColorStill) => void;
  removeColorStill: (stillId: string) => void;
  renameColorStill: (stillId: string, label: string) => void;

  // ── Project Metadata (GAP B) ──
  updateProjectMetadata: (updates: Partial<import("../../shared/models").ProjectMetadata>) => void;

  // ── Timeline Auto-Layout (UX 2) ──
  autoLayoutTimeline: () => void;

  // ── Timeline Nesting / Compound Clips (GAP E) ──
  nestSelectedClips: (clipIds: string[], label: string) => void;
  /**
   * Add a captions track to the timeline from Whisper word timestamps.
   * Creates a new 'caption' track and inserts one clip per word-group.
   */
  addCaptionsFromTranscript: (
    words: Array<{ word: string; start: number; end: number }>,
    fps: number,
    clipStartFrame: number,
    style?: 'minimal' | 'bold' | 'outline'
  ) => void;
  openNestedSequence: (nestedSequenceId: string) => void;
  exitNestedSequence: () => void;
  activeNestedSequenceId: string | null;

  // ── Clip History (UX 3) ──
  saveClipHistorySnapshot: (clipId: string, label: string) => void;
  restoreClipHistorySnapshot: (clipId: string, snapshotId: string) => void;

  // ── Compound Nodes (GAP A) ──
  groupNodes: (nodeIds: string[], label: string) => void;
  ungroupNodes: (compoundId: string) => void;

  // ── Add asset to pool only ──
  addAssetToPool: (asset: import("../../shared/models").MediaAsset) => void;
  /** Patch any fields on a MediaAsset in the pool (non-undoable, used for proxy workflow) */
  patchAsset: (assetId: string, updates: Partial<import("../../shared/models").MediaAsset>) => void;

  // ── ClawFlow AI ──
  autoColorMatch: () => void;
  /** Measure clip loudness (EBU R128) and set gains to hit the target LUFS. */
  normalizeAudioLevels: (targetDb: -14 | -23) => Promise<void>;
  // ── Media Bins ───────────────────────────────────────────────────────────────
  createBin: (name: string, parentId?: string, smart?: import("../../shared/models").SmartBinRule) => string;
  renameBin: (binId: string, name: string) => void;
  deleteBin: (binId: string) => void;
  moveAssetToBin: (assetId: string, binId: string | null) => void;
  closeAllGaps: () => void;
  // ── Multicam Audio Sync ──
  syncMulticamClips: (clipIds: string[], offsetsSeconds: number[]) => void;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function getPrimaryTrackId(project: EditorProjectState, kind: TimelineTrackKind): string | null {
  return project.sequence.tracks.find((t) => t.kind === kind)?.id ?? null;
}

/**
 * Find the first audio track that has NO clips overlapping [startFrame, endFrame).
 * If every audio track is occupied at that range, create a new audio track and
 * return its id.  The returned project may have an extra track appended.
 *
 * This is the CORRECT industry-standard behavior: each clip's audio gets its own
 * lane — it never silently stacks on top of an unrelated clip.
 */
/**
 * Cut [start, end) out of the given tracks: overlapping clips are trimmed,
 * split around the range, or removed. start === end splits clips at that
 * frame. Trims are in source frames, so timeline frames are scaled by speed.
 */
function carveRange(project: EditorProjectState, trackIds: Set<string>, start: number, end: number): TimelineClip[] {
  const fps = project.sequence.settings.fps;
  const regrouped = new Map<string, string>();
  const regroup = (g: string) => { if (!regrouped.has(g)) regrouped.set(g, createId()); return regrouped.get(g)!; };
  return project.sequence.clips.flatMap((c) => {
    if (!trackIds.has(c.trackId)) return [c];
    const a = project.assets.find((x) => x.id === c.assetId);
    if (!a) return [c];
    const sp = Math.max(0.25, Math.min(4, c.speed ?? 1));
    const cStart = c.startFrame, cEnd = cStart + getClipDurationFrames(c, a, fps);
    const overlaps = start === end ? cStart < start && cEnd > start : cStart < end && cEnd > start;
    if (!overlaps) return [c];
    const out: TimelineClip[] = [];
    if (cStart < start) out.push({ ...c, trimEndFrames: c.trimEndFrames + Math.round((cEnd - start) * sp) });
    if (cEnd > end) {
      const split = out.length > 0;
      out.push({
        ...c,
        id: split ? createId() : c.id,
        startFrame: end,
        trimStartFrames: c.trimStartFrames + Math.round((end - cStart) * sp),
        linkedGroupId: split && c.linkedGroupId ? regroup(c.linkedGroupId) : c.linkedGroupId,
      });
    }
    return out;
  });
}

function findOrCreateFreeAudioTrack(
  project: EditorProjectState,
  asset: MediaAsset,
  startFrame: number
): { project: EditorProjectState; audioTrackId: string } {
  const fps = project.sequence.settings.fps;
  const assetDur = getClipDurationFrames(
    // Estimate duration using a zero-trim placeholder
    { trimStartFrames: 0, trimEndFrames: 0, speed: 1 } as Parameters<typeof getClipDurationFrames>[0],
    asset,
    fps
  );
  const endFrame = startFrame + assetDur;

  const audioTracks = project.sequence.tracks.filter((t) => t.kind === "audio");

  for (const track of audioTracks) {
    // Check every clip in this track for overlap with [startFrame, endFrame)
    const clipsInTrack = project.sequence.clips.filter((c) => c.trackId === track.id);
    const hasOverlap = clipsInTrack.some((c) => {
      const clipAsset = project.assets.find((a) => a.id === c.assetId);
      if (!clipAsset) return false;
      const clipEnd = c.startFrame + getClipDurationFrames(c, clipAsset, fps);
      // Overlaps if: clip starts before endFrame AND clip ends after startFrame
      return c.startFrame < endFrame && clipEnd > startFrame;
    });
    if (!hasOverlap) {
      return { project, audioTrackId: track.id };
    }
  }

  // All existing audio tracks are occupied — create a new one
  const newTrack: TimelineTrack = {
    id: createId(),
    kind: "audio",
    name: `Audio ${audioTracks.length + 1}`,
    muted: false,
    locked: false,
    solo: false,
    height: 44,
    color: "#2fc77a",
  };
  const updatedProject: EditorProjectState = {
    ...project,
    sequence: {
      ...project.sequence,
      tracks: [...project.sequence.tracks, newTrack],
    },
  };
  return { project: updatedProject, audioTrackId: newTrack.id };
}

// ── BUG 4: Clip overlap detection & snap-to-free-position ──────────────────

/**
 * Returns true if placing a clip of `durationFrames` at `startFrame` on
 * `trackId` would overlap any *other* clip (excludes clipId itself).
 */
function wouldOverlap(
  project: EditorProjectState,
  trackId: string,
  startFrame: number,
  durationFrames: number,
  excludeClipId?: string
): boolean {
  const fps = project.sequence.settings.fps;
  const endFrame = startFrame + durationFrames;
  return project.sequence.clips
    .filter((c) => c.trackId === trackId && c.id !== excludeClipId)
    .some((c) => {
      const asset = project.assets.find((a) => a.id === c.assetId);
      if (!asset) return false;
      const cEnd = c.startFrame + getClipDurationFrames(c, asset, fps);
      return c.startFrame < endFrame && cEnd > startFrame;
    });
}

/**
 * Given a desired `startFrame`, find the nearest frame on `trackId` where a
 * clip of `durationFrames` fits without overlapping (searches outward from the
 * target position, prefers earlier positions).  Returns the clamped frame.
 */
function findNearestFreePosition(
  project: EditorProjectState,
  trackId: string,
  startFrame: number,
  durationFrames: number,
  excludeClipId?: string
): number {
  if (!wouldOverlap(project, trackId, startFrame, durationFrames, excludeClipId)) {
    return startFrame;
  }
  const fps = project.sequence.settings.fps;
  const clips = project.sequence.clips
    .filter((c) => c.trackId === trackId && c.id !== excludeClipId)
    .map((c) => {
      const asset = project.assets.find((a) => a.id === c.assetId);
      if (!asset) return { start: c.startFrame, end: c.startFrame };
      return { start: c.startFrame, end: c.startFrame + getClipDurationFrames(c, asset, fps) };
    })
    .sort((a, b) => a.start - b.start);

  // Try before first clip
  const firstGapEnd = clips[0]?.start ?? Infinity;
  if (durationFrames <= firstGapEnd) {
    const candidate = Math.min(startFrame, Math.max(0, firstGapEnd - durationFrames));
    if (!wouldOverlap(project, trackId, candidate, durationFrames, excludeClipId)) {
      return candidate;
    }
  }

  // Try each gap between clips
  for (let i = 0; i < clips.length; i++) {
    const gapStart = clips[i].end;
    const gapEnd = clips[i + 1]?.start ?? Infinity;
    if (gapEnd - gapStart >= durationFrames) {
      const candidate = Math.max(gapStart, Math.min(startFrame, gapEnd - durationFrames));
      if (!wouldOverlap(project, trackId, candidate, durationFrames, excludeClipId)) {
        return candidate;
      }
      // Fallback: snap to gap start
      return gapStart;
    }
  }

  // No free gap found — append after all clips
  const lastEnd = clips[clips.length - 1]?.end ?? 0;
  return lastEnd;
}

function clampPlayhead(project: EditorProjectState, frame: number): number {
  const totalFrames = getTotalDurationFrames(
    buildTimelineSegments(project.sequence, project.assets)
  );
  if (totalFrames <= 0) return 0;
  return Math.max(0, Math.min(Math.round(frame), totalFrames - 1));
}

/**
/**
 * magneticDeleteClips — removes clips and, when magnetic mode is on,
 * closes the gap by rippling all downstream clips left.
 * When magnetic is off it behaves identically to a plain filter.
 */
function magneticDeleteClips(
  state: { project: EditorProjectState; selectedAssetId: string | null; playback: { isPlaying: boolean; playheadFrame: number } },
  clipId: string
) {
  const magnetic = state.project.sequence.settings.magneticTimeline !== false; // default ON
  const linked = getLinkedClips(state.project, clipId);
  if (!linked.length) return state;
  const segs = buildTimelineSegments(state.project.sequence, state.project.assets);
  const segsById = new Map(segs.map((s) => [s.clip.id, s]));
  const linkedIds = new Set(linked.map((c) => c.id));
  const trackIds = linked.map((c) => c.trackId);
  const removedByTrack = new Map<string, Array<{ dur: number; start: number }>>();
  for (const clip of linked) {
    const seg = segsById.get(clip.id);
    if (!seg) continue;
    const arr = removedByTrack.get(clip.trackId) ?? [];
    arr.push({ dur: seg.durationFrames, start: seg.startFrame });
    removedByTrack.set(clip.trackId, arr);
  }
  const filteredClips = state.project.sequence.clips.filter((c) => !linkedIds.has(c.id));
  const rippleClips = magnetic
    ? filteredClips.map((c) => {
        const removed = removedByTrack.get(c.trackId);
        if (!removed?.length) return c;
        const ripple = removed.reduce((t, r) => r.start < c.startFrame ? t + r.dur : t, 0);
        return ripple > 0 ? { ...c, startFrame: Math.max(0, c.startFrame - ripple) } : c;
      })
    : filteredClips;
  const next = resolveTracks(
    { ...state.project, sequence: { ...state.project.sequence, clips: rippleClips } },
    trackIds
  );
  const nextSegs = buildTimelineSegments(next.sequence, next.assets);
  const fallback = findPlayableSegmentAtFrame(nextSegs, state.playback.playheadFrame, "video") ?? nextSegs[0] ?? null;
  return {
    project: next,
    selectedClipId: fallback?.clip.id ?? null,
    selectedAssetId: fallback?.asset.id ?? state.selectedAssetId,
    playback: {
      isPlaying: nextSegs.length ? state.playback.isPlaying : false,
      playheadFrame: clampPlayhead(next, state.playback.playheadFrame)
    }
  };
}

 /**
 * resolveTrackLayout — NON-magnetic layout resolver.
 *
 * Clips keep their requested startFrame positions. We only nudge a clip
 * forward if it actually overlaps the clip that ends immediately before it.
 * Clips that have a gap between them are left in place (no back-filling).
 *
 * This preserves:
 *   - Split clip halves staying at their split positions
 *   - Gaps between clips (intentional black holes)
 *   - Only the moved/dropped clip's neighbours are adjusted
 */
function resolveTrackLayout(project: EditorProjectState, trackId: string): EditorProjectState {
  const assetsById = new Map(project.assets.map((a) => [a.id, a]));
  const fps = project.sequence.settings.fps;
  const ordered = project.sequence.clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => {
      if (a.startFrame !== b.startFrame) return a.startFrame - b.startFrame;
      return project.sequence.clips.findIndex((c) => c.id === a.id) -
             project.sequence.clips.findIndex((c) => c.id === b.id);
    });

  const resolved = new Map<string, TimelineClip>();
  let prevEnd = 0; // end frame of the previously placed clip

  for (const clip of ordered) {
    const asset = assetsById.get(clip.assetId);
    if (!asset) { resolved.set(clip.id, clip); prevEnd = Math.max(prevEnd, clip.startFrame); continue; }
    const dur = getClipDurationFrames(clip, asset, fps);
    // Only push forward if this clip would overlap the previous one.
    // If there's a gap (clip.startFrame >= prevEnd) we keep it as-is.
    const start = Math.max(0, clip.startFrame >= prevEnd ? clip.startFrame : prevEnd);
    resolved.set(clip.id, { ...clip, startFrame: start });
    prevEnd = start + dur;
  }

  return {
    ...project,
    sequence: {
      ...project.sequence,
      clips: project.sequence.clips.map((c) => resolved.get(c.id) ?? c)
    }
  };
}

function resolveTracks(project: EditorProjectState, trackIds: string[]): EditorProjectState {
  return Array.from(new Set(trackIds)).reduce(
    (p, id) => resolveTrackLayout(p, id),
    project
  );
}

function getLinkedClips(project: EditorProjectState, clipId: string): TimelineClip[] {
  const clip = project.sequence.clips.find((c) => c.id === clipId);
  if (!clip) return [];
  if (!clip.linkedGroupId) return [clip];
  return project.sequence.clips.filter((c) => c.linkedGroupId === clip.linkedGroupId);
}

function getTransitionTargetClip(project: EditorProjectState, clipId: string): TimelineClip | null {
  const clip = project.sequence.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const track = project.sequence.tracks.find((t) => t.id === clip.trackId);
  // Video clip — use directly
  if (track?.kind === "video") return clip;
  // Audio clip with a linked video clip — apply to the video (preserves existing behaviour)
  const linkedVideo = getLinkedClips(project, clipId).find((c) => {
    const t = project.sequence.tracks.find((tr) => tr.id === c.trackId);
    return t?.kind === "video";
  });
  if (linkedVideo) return linkedVideo;
  // Standalone audio clip — apply fade directly to the audio clip itself
  if (track?.kind === "audio") return clip;
  return null;
}

function withAssetSequenceDefaults(project: EditorProjectState, asset: MediaAsset): EditorProjectState {
  // Only update sequence settings if this is the very first clip AND the project settings are still defaults
  if (project.sequence.clips.length > 0) return project;
  const defaultFps = 30; // default fps from createEmptyProject
  const shouldAdaptFps = project.sequence.settings.fps === defaultFps && asset.nativeFps && asset.nativeFps > 0;
  return {
    ...project,
    sequence: {
      ...project.sequence,
      settings: {
        ...project.sequence.settings,
        width: asset.width || project.sequence.settings.width,
        height: asset.height || project.sequence.settings.height,
        fps: shouldAdaptFps ? normalizeTimelineFps(asset.nativeFps!) : project.sequence.settings.fps
      }
    }
  };
}

function createTimelineClipsForAsset(
  project: EditorProjectState,
  asset: MediaAsset,
  startFrame: number
): { project: EditorProjectState; clips: TimelineClip[]; selectedClipId: string } {
  // Audio-only assets (music, voiceover) go straight onto an audio track.
  if (!asset.width && asset.hasAudio) {
    const result = findOrCreateFreeAudioTrack(project, asset, startFrame);
    const audioClip = createEmptyClip(asset.id, result.audioTrackId, startFrame);
    return { project: result.project, clips: [audioClip], selectedClipId: audioClip.id };
  }
  const videoTrackId = getPrimaryTrackId(project, "video");
  if (!videoTrackId) throw new Error("No video track is available.");

  let resultProject = project;
  let audioTrackId: string | null = null;

  if (asset.hasAudio) {
    const result = findOrCreateFreeAudioTrack(project, asset, startFrame);
    resultProject = result.project;
    audioTrackId = result.audioTrackId;
  }

  const linkedGroupId = audioTrackId ? createId() : null;
  const videoClip = createEmptyClip(asset.id, videoTrackId, startFrame, { linkedGroupId });
  const clips: TimelineClip[] = [videoClip];
  if (audioTrackId) {
    clips.push(createEmptyClip(asset.id, audioTrackId, startFrame, { linkedGroupId }));
  }
  return { project: resultProject, clips, selectedClipId: videoClip.id };
}

function applyClipMutation(
  state: EditorStore,
  clipId: string,
  mutate: (clip: TimelineClip, asset: MediaAsset) => TimelineClip
): Partial<EditorStore> | EditorStore {
  const linkedClips = getLinkedClips(state.project, clipId);
  if (!linkedClips.length) return state;
  const assetsById = new Map(state.project.assets.map((a) => [a.id, a]));
  const linkedIds = new Set(linkedClips.map((c) => c.id));
  const trackIds = linkedClips.map((c) => c.trackId);
  const next = resolveTracks(
    {
      ...state.project,
      sequence: {
        ...state.project.sequence,
        clips: state.project.sequence.clips.map((c) => {
          if (!linkedIds.has(c.id)) return c;
          const asset = assetsById.get(c.assetId);
          return asset ? mutate(c, asset) : c;
        })
      }
    },
    trackIds
  );
  return {
    project: next,
    playback: {
      ...state.playback,
      playheadFrame: clampPlayhead(next, state.playback.playheadFrame)
    }
  };
}

function splitStateAtFrame(
  state: EditorStore,
  clipId: string,
  frame: number
): Partial<EditorStore> | EditorStore {
  const linkedClips = getLinkedClips(state.project, clipId);
  if (!linkedClips.length) return state;
  const linkedIds = new Set(linkedClips.map((c) => c.id));
  const segsById = new Map(
    buildTimelineSegments(state.project.sequence, state.project.assets).map((s) => [s.clip.id, s])
  );
  const shouldRelink = Boolean(linkedClips[0]?.linkedGroupId) && linkedClips.length > 1;
  const leftGroupId = shouldRelink ? createId() : (linkedClips[0]?.linkedGroupId ?? null);
  const rightGroupId = shouldRelink ? createId() : (linkedClips[0]?.linkedGroupId ?? null);
  let splitOccurred = false;

  const nextSequence = {
    ...state.project.sequence,
    clips: state.project.sequence.clips.flatMap((clip) => {
      if (!linkedIds.has(clip.id)) return [clip];
      const seg = segsById.get(clip.id);
      if (!seg || frame <= seg.startFrame || frame >= seg.endFrame) return [clip];
      const splitOffset = frame - seg.startFrame;
      if (splitOffset <= 0 || splitOffset >= seg.durationFrames) return [clip];
      // Trims are in source frames: scale the timeline offset by the clip's speed.
      const speed = Math.max(0.25, Math.min(4, clip.speed ?? 1));
      const fps = state.project.sequence.settings.fps;
      const sourceFrames = Math.max(1, Math.round((seg.sourceOutSeconds - seg.sourceInSeconds) * fps));
      const leftSrc = Math.min(sourceFrames - 1, Math.max(1, Math.round(splitOffset * speed)));
      splitOccurred = true;
      return [
        { ...clip, trimEndFrames: clip.trimEndFrames + (sourceFrames - leftSrc), linkedGroupId: leftGroupId, transitionOut: null },
        { ...clip, id: createId(), startFrame: frame, trimStartFrames: clip.trimStartFrames + leftSrc, linkedGroupId: rightGroupId, transitionIn: null }
      ];
    })
  };

  if (!splitOccurred) return state;

  const nextProject = { ...state.project, sequence: nextSequence };
  const nextSegs = buildTimelineSegments(nextSequence, state.project.assets);
  const activeSeg =
    findPlayableSegmentAtFrame(nextSegs, frame, "video") ??
    findSegmentAtFrame(nextSegs, frame);

  return {
    project: nextProject,
    selectedClipId: activeSeg?.clip.id ?? state.selectedClipId,
    selectedAssetId: activeSeg?.asset.id ?? state.selectedAssetId,
    playback: {
      ...state.playback,
      playheadFrame: clampPlayhead(nextProject, frame)
    }
  };
}

function updateClipInState(
  state: EditorStore,
  clipId: string,
  updater: (clip: TimelineClip) => TimelineClip
): Partial<EditorStore> {
  return {
    project: {
      ...state.project,
      sequence: {
        ...state.project.sequence,
        clips: state.project.sequence.clips.map((c) => (c.id === clipId ? updater(c) : c))
      }
    }
  };
}

// ── Undo/redo helpers ─────────────────────────────────────────────────────────

/** Capture the undoable portion of the current state */
function snapshot(state: EditorStore): UndoableSnapshot {
  return {
    project: state.project,
    selectedAssetId: state.selectedAssetId,
    selectedClipId: state.selectedClipId,
    playbackFrame: state.playback.playheadFrame
  };
}

/** Apply a snapshot back to the store (undo or redo) */
function applySnapshot(state: EditorStore, snap: UndoableSnapshot): Partial<EditorStore> {
  return {
    project: snap.project,
    selectedAssetId: snap.selectedAssetId,
    selectedClipId: snap.selectedClipId,
    playback: { ...state.playback, playheadFrame: snap.playbackFrame }
  };
}

/**
 * Higher-order helper: run a mutation, capture before/after snapshots,
 * push to undoStack, and clear redoStack.
 * Returns a Zustand set-compatible function.
 */
/** Clips whose content moved in time take their (timeline-absolute) keyframes along. */
function carryKeyframes(state: EditorStore, partial: Partial<EditorStore>): Partial<EditorStore> {
  const nextClips = partial.project?.sequence?.clips;
  const prevClips = state.project.sequence.clips;
  if (!partial.project || !nextClips || nextClips === prevClips) return partial;
  const prevById = new Map(prevClips.map((c) => [c.id, c]));
  let changed = false;
  const clips = nextClips.map((c) => {
    const p = prevById.get(c.id);
    if (!p || p === c || c.startFrame === p.startFrame) return c; // slips/trims don't move the clip
    // Moved minus trimmed: trims keep content in place, speed changes don't move it.
    const speed = Math.max(0.25, Math.min(4, c.speed ?? 1));
    const d = Math.round((c.startFrame - p.startFrame) - (c.trimStartFrames - p.trimStartFrames) / speed);
    if (!d) return c;
    changed = true;
    return shiftClipKeyframes(c, d, p);
  });
  return changed ? { ...partial, project: { ...partial.project, sequence: { ...partial.project.sequence, clips } } } : partial;
}

function withUndo(
  label: string,
  mutate: (state: EditorStore) => Partial<EditorStore> | EditorStore
) {
  return (state: EditorStore): Partial<EditorStore> => {
    const before = snapshot(state);
    let partial = mutate(state) as Partial<EditorStore>;
    // If nothing changed, skip recording
    if (partial === state) return {};
    partial = carryKeyframes(state, partial);

    const merged: EditorStore = { ...state, ...partial };
    const after = snapshot(merged);

    const now = Date.now();
    const last = state.undoStack[state.undoStack.length - 1];
    const newUndo = last && last.label === label && last.at !== undefined && now - last.at < UNDO_MERGE_MS
      ? [...state.undoStack.slice(0, -1), { label, before: last.before, after, at: now }]
      : [...state.undoStack, { label, before, after, at: now }].slice(-MAX_UNDO);

    return {
      ...partial,
      undoStack: newUndo,
      redoStack: [],
      canUndo: true,
      canRedo: false
    };
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useEditorStore = create<EditorStore>((set, get) => ({
  project: createEmptyProject(),
  gradeClipboard: null,
  selectedAssetId: null,
  selectedClipId: null,
  toolMode: "select",
  activePage: "edit",
  environment: null,
  playback: { isPlaying: false, playheadFrame: 0 },
  undoStack: [],
  redoStack: [],
  canUndo: false,
  canRedo: false,
  fusionClipId: null,

  // ── Undo / Redo ───────────────────────────────────────────────────────────

  undo: () => {
    set((state) => {
      if (!state.undoStack.length) return state;
      const stack = [...state.undoStack];
      const cmd = stack.pop()!;
      return {
        ...applySnapshot(state, cmd.before),
        undoStack: stack,
        redoStack: [...state.redoStack, cmd],
        canUndo: stack.length > 0,
        canRedo: true
      };
    });
  },

  redo: () => {
    set((state) => {
      if (!state.redoStack.length) return state;
      const stack = [...state.redoStack];
      const cmd = stack.pop()!;
      return {
        ...applySnapshot(state, cmd.after),
        undoStack: [...state.undoStack, cmd],
        redoStack: stack,
        canUndo: true,
        canRedo: stack.length > 0
      };
    });
  },

  // ── Project persistence ───────────────────────────────────────────────────

  loadProjectFromData: (project) => {
    set({
      project,
      selectedAssetId: project.assets[0]?.id ?? null,
      selectedClipId: project.sequence.clips[0]?.id ?? null,
      playback: { isPlaying: false, playheadFrame: 0 },
      undoStack: [],
      redoStack: [],
      canUndo: false,
      canRedo: false
    });
  },

  getCurrentProjectSnapshot: () => get().project,

  // ── Asset management ──────────────────────────────────────────────────────

  importAssets: (assets) => {
    if (!assets.length) return;
    set(withUndo("Import Assets", (state) => {
      const existingByPath = new Map(state.project.assets.map((a) => [a.sourcePath, a]));
      const imported = assets.map((a) => {
        const existing = existingByPath.get(a.sourcePath);
        return existing ? { ...a, id: existing.id } : a;
      });
      const importedByPath = new Map(imported.map((a) => [a.sourcePath, a]));
      const merged = [
        ...state.project.assets.map((a) => importedByPath.get(a.sourcePath) ?? a),
        ...imported.filter((a) => !existingByPath.has(a.sourcePath))
      ];
      if (!merged.length) return state;

      let nextProject: EditorProjectState = { ...state.project, assets: merged };
      let selectedAssetId = state.selectedAssetId ?? imported[0]?.id ?? null;
      let selectedClipId = state.selectedClipId;

      if (!nextProject.sequence.clips.length) {
        const first = imported[0];
        nextProject = withAssetSequenceDefaults(nextProject, first);
        const { clips, selectedClipId: nextId } = createTimelineClipsForAsset(nextProject, first, 0);
        nextProject = { ...nextProject, sequence: { ...nextProject.sequence, clips } };
        selectedAssetId = first.id;
        selectedClipId = nextId;
      } else if (!selectedAssetId && imported[0]) {
        selectedAssetId = imported[0].id;
      }

      return { project: nextProject, selectedAssetId, selectedClipId };
    }));
  },

  setAssetWaveform: (assetId, peaks) => {
    set((state) => ({
      project: {
        ...state.project,
        assets: state.project.assets.map((a) =>
          a.id === assetId ? { ...a, waveformPeaks: peaks } : a
        )
      }
    }));
  },

  setAssetThumbnail: (assetId, thumbnailUrl) => {
    set((state) => ({
      project: {
        ...state.project,
        assets: state.project.assets.map((a) =>
          a.id === assetId ? { ...a, thumbnailUrl } : a
        )
      }
    }));
  },

  setAssetFilmstrip: (assetId, thumbs) => {
    set((state) => ({
      project: {
        ...state.project,
        assets: state.project.assets.map((a) =>
          a.id === assetId ? { ...a, filmstripThumbs: thumbs } : a
        )
      }
    }));
  },

  setAssetPreviewUrl: (assetId, previewUrl) => {
    set((state) => ({
      project: {
        ...state.project,
        assets: state.project.assets.map((a) =>
          a.id === assetId ? { ...a, previewUrl } : a
        )
      }
    }));
  },

  appendAssetToTimeline: (assetId) => {
    set(withUndo("Append Asset", (state) => {
      const asset = state.project.assets.find((a) => a.id === assetId);
      if (!asset) return state;
      let nextProject = withAssetSequenceDefaults(state.project, asset);
      const primaryTrackId = getPrimaryTrackId(nextProject, "video");
      if (!primaryTrackId) return state;
      const curSegs = buildTimelineSegments(nextProject.sequence, nextProject.assets);
      const startFrame = getTrackEndFrame(primaryTrackId, curSegs);
      const { project: projectWithTrack, clips, selectedClipId } = createTimelineClipsForAsset(
        nextProject, asset, startFrame
      );
      nextProject = {
        ...projectWithTrack,
        sequence: { ...projectWithTrack.sequence, clips: [...projectWithTrack.sequence.clips, ...clips] }
      };
      return {
        project: nextProject,
        selectedAssetId: assetId,
        selectedClipId,
        playback: { isPlaying: false, playheadFrame: clampPlayhead(nextProject, clips[0].startFrame) }
      };
    }));
  },

  selectAsset: (assetId) => set({ selectedAssetId: assetId }),

  addSubtitleCue: (cue) => {
    set(withUndo("Add Subtitle", (state) => ({
      project: { ...state.project, subtitleCues: [...(state.project.subtitleCues ?? []), cue] },
    })));
  },
  updateSubtitleCue: (id, updates) => {
    set(withUndo("Edit Subtitle", (state) => ({
      project: { ...state.project, subtitleCues: (state.project.subtitleCues ?? []).map((c) => (c.id === id ? { ...c, ...updates } : c)) },
    })));
  },
  removeSubtitleCue: (id) => {
    set(withUndo("Remove Subtitle", (state) => ({
      project: { ...state.project, subtitleCues: (state.project.subtitleCues ?? []).filter((c) => c.id !== id) },
    })));
  },

  applyProcessedAudio: (clipId, processed, extra) => {
    set(withUndo("Process Audio", (state) => {
      const seq = state.project.sequence;
      const trackKind = (id: string) => seq.tracks.find((t) => t.id === id)?.kind;
      const clip = seq.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      // The clip itself if it's on an audio track, else its linked audio.
      const target = trackKind(clip.trackId) === "audio" ? clip
        : getLinkedClips(state.project, clipId).find((c) => trackKind(c.trackId) === "audio");
      if (!target) return state;
      let project: EditorProjectState = {
        ...state.project,
        assets: [...state.project.assets, processed, ...(extra ? [extra] : [])],
        sequence: { ...seq, clips: seq.clips.map((c) => c.id === target.id ? { ...c, assetId: processed.id } : c) },
      };
      if (extra) {
        const { project: withTrack, audioTrackId } = findOrCreateFreeAudioTrack(project, extra, target.startFrame);
        project = withTrack;
        const second: TimelineClip = { ...target, id: createId(), assetId: extra.id, trackId: audioTrackId, linkedGroupId: null };
        project = { ...project, sequence: { ...project.sequence, clips: [...project.sequence.clips, second] } };
      }
      return { project, selectedClipId: target.id };
    }));
  },

  addRecordedAudio: (asset, startFrame) => {
    set(withUndo("Record Voiceover", (state) => {
      const withAsset = { ...state.project, assets: [...state.project.assets, asset] };
      const { project, audioTrackId } = findOrCreateFreeAudioTrack(withAsset, asset, Math.max(0, startFrame));
      const clip = createEmptyClip(asset.id, audioTrackId, Math.max(0, startFrame));
      return {
        project: { ...project, sequence: { ...project.sequence, clips: [...project.sequence.clips, clip] } },
        selectedClipId: clip.id,
      };
    }));
  },

  dropAssetAtFrame: (assetId, trackId, startFrame) => {
    set(withUndo("Drop Asset", (state) => {
      const asset = state.project.assets.find((a) => a.id === assetId);
      if (!asset) return state;
      // Audio-only media dropped on a video track lands on a free audio track.
      if (!asset.width && asset.hasAudio && state.project.sequence.tracks.find((t) => t.id === trackId)?.kind === "video") {
        const { project, audioTrackId } = findOrCreateFreeAudioTrack(state.project, asset, Math.max(0, startFrame));
        const clip = createEmptyClip(asset.id, audioTrackId, Math.max(0, startFrame));
        return { ...state, project: { ...project, sequence: { ...project.sequence, clips: [...project.sequence.clips, clip] } }, selectedClipId: clip.id };
      }
      let nextProject = withAssetSequenceDefaults(state.project, asset);
      const track = nextProject.sequence.tracks.find((t) => t.id === trackId);
      if (!track) return state;

      const fps = nextProject.sequence.settings.fps;
      const dur = getClipDurationFrames(
        { trimStartFrames: 0, trimEndFrames: 0, speed: 1 } as Parameters<typeof getClipDurationFrames>[0],
        asset,
        fps
      );
      const dropStart = Math.max(0, startFrame);
      const dropEnd   = dropStart + dur;

      // NLE overwrite: the dropped clip takes exactly its span; overlapped
      // clips are trimmed, split around it, or removed.
      const updatedClips = carveRange(nextProject, new Set([trackId]), dropStart, dropEnd);

      // ── Create the new clip ─────────────────────────────────────────────
      const linkedGroupId = asset.hasAudio && track.kind === "video" ? createId() : null;
      const videoClip = createEmptyClip(asset.id, trackId, dropStart, { linkedGroupId });
      updatedClips.push(videoClip);

      nextProject = { ...nextProject, sequence: { ...nextProject.sequence, clips: updatedClips } };

      if (asset.hasAudio && track.kind === "video") {
        const { project: projWithTrack, audioTrackId } = findOrCreateFreeAudioTrack(nextProject, asset, dropStart);
        nextProject = projWithTrack;
        // Also carve audio track the same way (reuse same logic via updatedClips rebuild)
        const audioClip = createEmptyClip(asset.id, audioTrackId, dropStart, { linkedGroupId });
        nextProject = {
          ...nextProject,
          sequence: { ...nextProject.sequence, clips: [...nextProject.sequence.clips, audioClip] }
        };
      }

      return {
        project: nextProject,
        selectedAssetId: assetId,
        selectedClipId: videoClip.id,
        playback: { isPlaying: false, playheadFrame: clampPlayhead(nextProject, dropStart) }
      };
    }));
  },

  selectClip: (clipId) => {
    set((state) => {
      if (!clipId) return { selectedClipId: null };
      const clip = state.project.sequence.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      return { selectedClipId: clipId, selectedAssetId: clip.assetId };
    });
  },

  // ── Clip Movement ─────────────────────────────────────────────────────────

  moveClip: (clipId, direction) => {
    set(withUndo("Move Clip", (state) => {
      const delta = state.project.sequence.settings.fps * direction;
      return applyClipMutation(state, clipId, (clip) => ({
        ...clip,
        startFrame: Math.max(0, clip.startFrame + delta)
      }));
    }));
  },

  moveClipTo: (clipId, trackId, startFrame) => {
    set(withUndo("Move Clip", (state) => {
      const clip = state.project.sequence.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const fps = state.project.sequence.settings.fps;
      const dropStart = Math.max(0, startFrame);
      // Linked partners move by the same delta (never before frame 0).
      const linked = getLinkedClips(state.project, clipId);
      const linkedIds = new Set(linked.map((c) => c.id));
      const delta = Math.max(dropStart - clip.startFrame, -Math.min(...linked.map((c) => c.startFrame)));
      const moved = linked.map((c) => c.id === clipId
        ? { ...c, trackId, startFrame: clip.startFrame + delta }
        : { ...c, startFrame: c.startFrame + delta });

      // Overwrite at the destination: each moved clip carves its own range.
      let project: EditorProjectState = {
        ...state.project,
        sequence: { ...state.project.sequence, clips: state.project.sequence.clips.filter((c) => !linkedIds.has(c.id)) },
      };
      for (const m of moved) {
        const asset = project.assets.find((a) => a.id === m.assetId);
        if (!asset) continue;
        const end = m.startFrame + getClipDurationFrames(m, asset, fps);
        project = { ...project, sequence: { ...project.sequence, clips: carveRange(project, new Set([m.trackId]), m.startFrame, end) } };
      }
      const nextProject = { ...project, sequence: { ...project.sequence, clips: [...project.sequence.clips, ...moved] } };

      return {
        project: nextProject,
        selectedClipId: clipId,
        selectedAssetId: clip.assetId,
        playback: { ...state.playback, playheadFrame: clampPlayhead(nextProject, state.playback.playheadFrame) }
      };
    }));
  },

  trimClipStart: (clipId, nextTrim) => {
    set(withUndo("Trim Start", (state) => {
      const selectedClip = state.project.sequence.clips.find((c) => c.id === clipId);
      if (!selectedClip) return state;
      const selectedAsset = state.project.assets.find((a) => a.id === selectedClip.assetId);
      if (!selectedAsset) return state;
      const fps = state.project.sequence.settings.fps;
      const clamped = clampTrimStart(selectedClip, selectedAsset, fps, nextTrim);
      const delta = clamped - selectedClip.trimStartFrames;
      return applyClipMutation(state, clipId, (clip, asset) => {
        const nc = clampTrimStart(clip, asset, fps, clip.trimStartFrames + delta);
        const nd = nc - clip.trimStartFrames;
        // Trims are source frames; the start moves by timeline frames so the out point stays put.
        const speed = Math.max(0.25, Math.min(4, clip.speed ?? 1));
        return { ...clip, startFrame: Math.max(0, clip.startFrame + Math.round(nd / speed)), trimStartFrames: nc };
      });
    }));
  },

  trimClipEnd: (clipId, nextTrim) => {
    set(withUndo("Trim End", (state) => {
      const selectedClip = state.project.sequence.clips.find((c) => c.id === clipId);
      if (!selectedClip) return state;
      const selectedAsset = state.project.assets.find((a) => a.id === selectedClip.assetId);
      if (!selectedAsset) return state;
      const fps = state.project.sequence.settings.fps;
      const clamped = clampTrimEnd(selectedClip, selectedAsset, fps, nextTrim);
      const delta = clamped - selectedClip.trimEndFrames;
      return applyClipMutation(state, clipId, (clip, asset) => ({
        ...clip,
        trimEndFrames: clampTrimEnd(clip, asset, fps, clip.trimEndFrames + delta)
      }));
    }));
  },

  splitSelectedClipAtPlayhead: () => {
    set(withUndo("Split Clip", (state) => {
      if (!state.selectedClipId) return state;
      return splitStateAtFrame(state, state.selectedClipId, state.playback.playheadFrame);
    }));
  },

  splitClipAtFrame: (clipId, frame) => {
    set(withUndo("Split Clip", (state) => splitStateAtFrame(state, clipId, frame)));
  },

  splitClipsAtBeats: (beatFrames, targetClipIds) => {
    if (beatFrames.length === 0) return;
    // Sort beats ascending so we process left-to-right; each call to splitStateAtFrame
    // rebuilds segments from current state so IDs stay consistent after each split.
    const sortedBeats = [...beatFrames].sort((a, b) => a - b);
    set(withUndo("Beat Sync Auto-Cut", (state) => {
      let current: EditorStore = state as EditorStore;
      for (const frame of sortedBeats) {
        // Find video clips that straddle this frame
        const segs = buildTimelineSegments(current.project.sequence, current.project.assets)
          .filter(s =>
            s.track.kind === "video" &&
            frame > s.startFrame &&
            frame < s.endFrame &&
            (!targetClipIds || targetClipIds.includes(s.clip.id))
          );
        for (const seg of segs) {
          const next = splitStateAtFrame(current, seg.clip.id, frame);
          current = { ...current, ...(next as Partial<EditorStore>) };
        }
      }
      return current;
    }));
  },

  removeSelectedClip: () => {
    set(withUndo("Delete Clip", (state) => {
      if (!state.selectedClipId) return state;
      return magneticDeleteClips(state, state.selectedClipId);
    }));
  },

  toggleClipEnabled: (clipId) => {
    set(withUndo("Toggle Clip", (state) => {
      const clip = state.project.sequence.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const next = !clip.isEnabled;
      return applyClipMutation(state, clipId, (c) => ({ ...c, isEnabled: next }));
    }));
  },

  detachLinkedClips: (clipId) => {
    set(withUndo("Detach Clips", (state) => {
      const clip = state.project.sequence.clips.find((c) => c.id === clipId);
      if (!clip?.linkedGroupId) return state;
      return {
        project: {
          ...state.project,
          sequence: {
            ...state.project.sequence,
            clips: state.project.sequence.clips.map((c) =>
              c.linkedGroupId === clip.linkedGroupId ? { ...c, linkedGroupId: null } : c
            )
          }
        }
      };
    }));
  },

  relinkClips: (clipId) => {
    set(withUndo("Relink Clips", (state) => {
      const clip = state.project.sequence.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      // Find audio counterpart with same assetId at same startFrame (or close)
      const counterpart = state.project.sequence.clips.find((c) => {
        if (c.id === clipId) return false;
        if (c.assetId !== clip.assetId) return false;
        if (c.linkedGroupId) return false; // already linked to something else
        // Check same start frame (within 2 frames tolerance)
        return Math.abs(c.startFrame - clip.startFrame) <= 2;
      });
      if (!counterpart) return state;
      const newGroupId = createId();
      return {
        project: {
          ...state.project,
          sequence: {
            ...state.project.sequence,
            clips: state.project.sequence.clips.map((c) => {
              if (c.id === clipId || c.id === counterpart.id) {
                return { ...c, linkedGroupId: newGroupId };
              }
              return c;
            })
          }
        }
      };
    }));
  },

  removeClipById: (clipId) => {
    set(withUndo("Delete Clip", (state) => {
      return magneticDeleteClips(state, clipId);
    }));
  },
  setMagneticTimeline: (enabled) => {
    set((state) => ({
      project: {
        ...state.project,
        sequence: {
          ...state.project.sequence,
          settings: { ...state.project.sequence.settings, magneticTimeline: enabled },
        },
      },
    }));
  },

  duplicateClip: (clipId) => {
    set(withUndo("Duplicate Clip", (state) => {
      const clip = state.project.sequence.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const segs = buildTimelineSegments(state.project.sequence, state.project.assets);
      const seg = segs.find((s) => s.clip.id === clipId);
      if (!seg) return state;
      const newLinkedGroupId = clip.linkedGroupId ? createId() : null;
      const linked = clip.linkedGroupId ? getLinkedClips(state.project, clipId) : [clip];
      // First spot at or after the original's end that's free on every involved track.
      const dur = seg.endFrame - seg.startFrame;
      const trackIds = new Set(linked.map((c) => c.trackId));
      const busy = segs.filter((g) => trackIds.has(g.clip.trackId)).sort((a, b) => a.startFrame - b.startFrame);
      let newStartFrame = seg.endFrame;
      for (const g of busy) {
        if (g.endFrame <= newStartFrame) continue;
        if (g.startFrame >= newStartFrame + dur) break;
        newStartFrame = g.endFrame;
      }
      const newClips = linked.map((lc) => shiftClipKeyframes({
        ...lc,
        id: createId(),
        startFrame: newStartFrame,
        linkedGroupId: newLinkedGroupId
      }, newStartFrame - lc.startFrame));
      return {
        project: {
          ...state.project,
          sequence: {
            ...state.project.sequence,
            clips: [...state.project.sequence.clips, ...newClips]
          }
        },
        selectedClipId: newClips[0].id
      };
    }));
  },

  // ── Transitions ───────────────────────────────────────────────────────────

  applyTransitionToSelectedClip: (edge, type = "fade") => {
    const state = useEditorStore.getState();
    if (!state.selectedClipId) return "Select a timeline clip before adding a transition.";
    const target = getTransitionTargetClip(state.project, state.selectedClipId);
    if (!target) return "Transitions apply to video clips.";
    const asset = state.project.assets.find((a) => a.id === target.assetId);
    if (!asset) return "The selected clip is missing its source media.";
    const dur = getClipDurationFrames(target, asset, state.project.sequence.settings.fps);
    const tDur = getClipTransitionDurationFrames(
      { type, durationFrames: Math.max(6, Math.round(state.project.sequence.settings.fps * 0.5)) },
      dur
    );
    if (tDur < 1) return "Clip is too short for that transition.";

    set(withUndo("Apply Transition", (s) => {
      const t = getTransitionTargetClip(s.project, s.selectedClipId!);
      if (!t) return s;
      return {
        project: {
          ...s.project,
          sequence: {
            ...s.project.sequence,
            clips: s.project.sequence.clips.map((c) => {
              if (c.id !== t.id) return c;
              return edge === "in"
                ? { ...c, transitionIn: { type, durationFrames: tDur } }
                : { ...c, transitionOut: { type, durationFrames: tDur } };
            })
          }
        },
        selectedClipId: t.id,
        selectedAssetId: t.assetId
      };
    }));
    return `${type} ${edge === "in" ? "in" : "out"} transition added.`;
  },

  setSelectedClipTransitionType: (edge, type) => {
    const state = useEditorStore.getState();
    if (!state.selectedClipId) return "Select a clip first.";
    const target = getTransitionTargetClip(state.project, state.selectedClipId);
    if (!target) return "Transitions apply to video clips.";
    const asset = state.project.assets.find((a) => a.id === target.assetId);
    if (!asset) return "Missing source media.";
    const fps = state.project.sequence.settings.fps;
    const dur = getClipDurationFrames(target, asset, fps);
    const current = edge === "in" ? target.transitionIn : target.transitionOut;
    const tDur = getClipTransitionDurationFrames(
      { type, durationFrames: current?.durationFrames ?? Math.max(6, Math.round(fps * 0.5)) },
      dur
    );
    if (tDur < 1) return "Clip too short for that transition.";

    set(withUndo("Set Transition Type", (s) => {
      const t = getTransitionTargetClip(s.project, s.selectedClipId!);
      if (!t) return s;
      return {
        project: {
          ...s.project,
          sequence: {
            ...s.project.sequence,
            clips: s.project.sequence.clips.map((c) => {
              if (c.id !== t.id) return c;
              return edge === "in"
                ? { ...c, transitionIn: { type, durationFrames: tDur } }
                : { ...c, transitionOut: { type, durationFrames: tDur } };
            })
          }
        },
        selectedClipId: t.id,
        selectedAssetId: t.assetId
      };
    }));
    return `Transition type updated to ${type}.`;
  },

  setSelectedClipTransitionDuration: (edge, durationFrames) => {
    const state = useEditorStore.getState();
    if (!state.selectedClipId) return "Select a clip first.";
    const target = getTransitionTargetClip(state.project, state.selectedClipId);
    if (!target) return "Transitions apply to video clips.";
    const asset = state.project.assets.find((a) => a.id === target.assetId);
    if (!asset) return "Missing source media.";
    const fps = state.project.sequence.settings.fps;
    const dur = getClipDurationFrames(target, asset, fps);
    const current = edge === "in" ? target.transitionIn : target.transitionOut;
    const tDur = getClipTransitionDurationFrames(
      durationFrames > 0 ? { type: current?.type ?? "fade", durationFrames } : null,
      dur
    );

    set(withUndo("Set Transition Duration", (s) => {
      const t = getTransitionTargetClip(s.project, s.selectedClipId!);
      if (!t) return s;
      // Apply fade to the target clip AND all clips in the same linked group
      // so audio clip gets the same fade as its paired video clip
      const linkedIds = new Set(
        t.linkedGroupId
          ? s.project.sequence.clips
              .filter((c) => c.linkedGroupId === t.linkedGroupId)
              .map((c) => c.id)
          : [t.id]
      );
      return {
        project: {
          ...s.project,
          sequence: {
            ...s.project.sequence,
            clips: s.project.sequence.clips.map((c) => {
              if (!linkedIds.has(c.id)) return c;
              const existingType = (edge === "in" ? c.transitionIn?.type : c.transitionOut?.type) ?? "fade";
              return edge === "in"
                ? { ...c, transitionIn: tDur > 0 ? { type: existingType, durationFrames: tDur } : null }
                : { ...c, transitionOut: tDur > 0 ? { type: existingType, durationFrames: tDur } : null };
            })
          }
        },
        selectedClipId: t.id,
        selectedAssetId: t.assetId
      };
    }));
    return tDur > 0 ? `Transition duration updated.` : `Transition cleared.`;
  },

  clearTransition: (clipId, edge) => {
    set(withUndo("Clear Transition", (state) => updateClipInState(state, clipId, (c) => ({
      ...c,
      transitionIn: edge === "in" ? null : c.transitionIn,
      transitionOut: edge === "out" ? null : c.transitionOut
    }))));
  },

  // ── Audio ─────────────────────────────────────────────────────────────────

  extractAudioFromSelectedClip: () => {
    const state = useEditorStore.getState();
    if (!state.selectedClipId) return "Select a timeline clip first.";
    const target = getTransitionTargetClip(state.project, state.selectedClipId);
    if (!target) return "Select a video clip to extract audio.";
    const asset = state.project.assets.find((a) => a.id === target.assetId);
    if (!asset?.hasAudio) return "This clip has no embedded audio.";
    const linked = getLinkedClips(state.project, target.id);
    const existingAudio = linked.find((c) => {
      const t = state.project.sequence.tracks.find((tr) => tr.id === c.trackId);
      return t?.kind === "audio";
    });

    if (existingAudio) {
      if (!target.linkedGroupId && !existingAudio.linkedGroupId) return "Audio is already extracted.";
      set(withUndo("Extract Audio", (s) => {
        const t2 = getTransitionTargetClip(s.project, s.selectedClipId!);
        if (!t2?.linkedGroupId) return s;
        return {
          project: {
            ...s.project,
            sequence: {
              ...s.project.sequence,
              clips: s.project.sequence.clips.map((c) =>
                c.linkedGroupId === t2.linkedGroupId ? { ...c, linkedGroupId: null } : c
              )
            }
          }
        };
      }));
      return "Audio extracted and independent from video.";
    }

    const audioTrackId = getPrimaryTrackId(state.project, "audio");
    if (!audioTrackId) return "No audio track available.";

    set(withUndo("Extract Audio", (s) => {
      const t2 = getTransitionTargetClip(s.project, s.selectedClipId!);
      if (!t2) return s;
      const audioClip = createEmptyClip(t2.assetId, audioTrackId, t2.startFrame);
      const audioClipFull: TimelineClip = {
        ...audioClip,
        trimStartFrames: t2.trimStartFrames,
        trimEndFrames: t2.trimEndFrames,
        isEnabled: t2.isEnabled
      };
      const next = resolveTracks(
        { ...s.project, sequence: { ...s.project.sequence, clips: [...s.project.sequence.clips, audioClipFull] } },
        [audioTrackId]
      );
      return { project: next };
    }));
    return "Audio extracted onto audio track.";
  },

  setClipVolume: (clipId, volume) => {
    set(withUndo("Set Volume", (state) => updateClipInState(state, clipId, (c) => ({
      ...c,
      volume: Math.max(0, Math.min(2, volume))
    }))));
  },

  setClipSpeed: (clipId, speed) => {
    set(withUndo("Set Speed", (state) => updateClipInState(state, clipId, (c) => ({
      ...c,
      speed: Math.max(0.25, Math.min(4, speed))
    }))));
  },

  setClipTransform: (clipId, updates) => {
    set(withUndo("Set Transform", (state) => updateClipInState(state, clipId, (c) => {
      const existing = c.transform ?? { posX: 0, posY: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 };
      return { ...c, transform: { ...existing, ...updates } };
    })));
  },

  // ── Masks ─────────────────────────────────────────────────────────────────

  addMaskToClip: (clipId, mask) => {
    set(withUndo("Add Mask", (state) => updateClipInState(state, clipId, (c) => ({
      ...c,
      masks: [...c.masks, mask]
    }))));
  },

  updateMask: (clipId, maskId, updates) => {
    set(withUndo("Update Mask", (state) => updateClipInState(state, clipId, (c) => ({
      ...c,
      masks: c.masks.map((m) => (m.id === maskId ? { ...m, ...updates } : m))
    }))));
  },

  removeMask: (clipId, maskId) => {
    set(withUndo("Remove Mask", (state) => updateClipInState(state, clipId, (c) => ({
      ...c,
      masks: c.masks.filter((m) => m.id !== maskId)
    }))));
  },

  reorderMasks: (clipId, fromIdx, toIdx) => {
    set(withUndo("Reorder Masks", (state) => updateClipInState(state, clipId, (c) => {
      const masks = [...c.masks];
      const [removed] = masks.splice(fromIdx, 1);
      masks.splice(toIdx, 0, removed);
      return { ...c, masks };
    })));
  },

  // ── Effects ───────────────────────────────────────────────────────────────

  addEffectToClip: (clipId, effect) => {
    set(withUndo("Add Effect", (state) => updateClipInState(state, clipId, (c) => ({
      ...c,
      effects: [...c.effects, { ...effect, order: c.effects.length }]
    }))));
  },

  updateEffect: (clipId, effectId, updates) => {
    set(withUndo("Update Effect", (state) => updateClipInState(state, clipId, (c) => ({
      ...c,
      effects: c.effects.map((e) => (e.id === effectId ? { ...e, ...updates } : e))
    }))));
  },

  removeEffect: (clipId, effectId) => {
    set(withUndo("Remove Effect", (state) => updateClipInState(state, clipId, (c) => ({
      ...c,
      effects: c.effects.filter((e) => e.id !== effectId).map((e, i) => ({ ...e, order: i }))
    }))));
  },

  toggleEffect: (clipId, effectId) => {
    set(withUndo("Toggle Effect", (state) => updateClipInState(state, clipId, (c) => ({
      ...c,
      effects: c.effects.map((e) => (e.id === effectId ? { ...e, enabled: !e.enabled } : e))
    }))));
  },

  reorderEffects: (clipId, fromIdx, toIdx) => {
    set(withUndo("Reorder Effects", (state) => updateClipInState(state, clipId, (c) => {
      const effects = [...c.effects];
      const [removed] = effects.splice(fromIdx, 1);
      effects.splice(toIdx, 0, removed);
      return { ...c, effects: effects.map((e, i) => ({ ...e, order: i })) };
    })));
  },

  addEffectKeyframe: (clipId, effectId, paramKey, frame, value) => {
    set(withUndo("Add Effect Keyframe", (state) => updateClipInState(state, clipId, (c) => ({
      ...c,
      effects: c.effects.map(e => {
        if (e.id !== effectId) return e;
        const existing = e.keyframes?.[paramKey] ?? [];
        // Replace if same frame exists, otherwise append
        const filtered = existing.filter(kf => kf.frame !== frame);
        return {
          ...e,
          keyframes: {
            ...e.keyframes,
            [paramKey]: [...filtered, { frame, value, easing: "linear" as const }].sort((a, b) => a.frame - b.frame),
          }
        };
      })
    }))));
  },

  updateEffectKeyframes: (clipId, effectId, paramName, keyframes) => {
    set(withUndo("Update Effect Keyframes", (state) => updateClipInState(state, clipId, (c) => ({
      ...c,
      effects: (c.effects ?? []).map(ef => {
        if (ef.id !== effectId) return ef;
        return {
          ...ef,
          keyframes: {
            ...(ef.keyframes ?? {}),
            [paramName]: keyframes as unknown as import("../../shared/models").Keyframe<number>[],
          },
        };
      }),
    }))));
  },

  // ── Color Grading ─────────────────────────────────────────────────────────

  enableColorGrade: (clipId) => {
    set(withUndo("Enable Color Grade", (state) => updateClipInState(state, clipId, (c) => ({
      ...c,
      colorGrade: c.colorGrade ?? createDefaultColorGrade()
    }))));
  },

  setColorGrade: (clipId, grade) => {
    set(withUndo("Color Grade", (state) => updateClipInState(state, clipId, (c) => ({
      ...c,
      colorGrade: { ...(c.colorGrade ?? createDefaultColorGrade()), ...grade }
    }))));
  },

  resetColorGrade: (clipId) => {
    set(withUndo("Reset Color Grade", (state) => updateClipInState(state, clipId, (c) => ({
      ...c,
      colorGrade: createDefaultColorGrade()
    }))));
  },

  // ── Grade Versioning (A/B/C) ────────────────────────────────────────

  // Versions store the whole serial chain: node 1 (colorGrade) + gradeNodes.
  switchGradeSlot: (clipId, slot) => {
    set(withUndo("Switch Grade Version", (state) => updateClipInState(state, clipId, (c) => {
      const currentSlot = c.activeGradeSlot ?? 'A';
      const versions = { ...(c.gradeVersions ?? {}) };
      const nodeVersions = { ...(c.gradeNodeVersions ?? {}) };
      if (c.colorGrade) versions[currentSlot] = { ...c.colorGrade };
      nodeVersions[currentSlot] = c.gradeNodes ?? [];
      const targetGrade = versions[slot] ?? createDefaultColorGrade();
      return { ...c, gradeVersions: versions, gradeNodeVersions: nodeVersions, activeGradeSlot: slot, colorGrade: targetGrade, gradeNodes: nodeVersions[slot] ?? [] };
    })));
  },

  copyGradeToSlot: (clipId, fromSlot, toSlot) => {
    set(withUndo("Copy Grade Version", (state) => updateClipInState(state, clipId, (c) => {
      const versions = { ...(c.gradeVersions ?? {}) };
      const nodeVersions = { ...(c.gradeNodeVersions ?? {}) };
      const currentSlot = c.activeGradeSlot ?? 'A';
      const live = fromSlot === currentSlot;
      versions[toSlot] = { ...(live ? (c.colorGrade ?? createDefaultColorGrade()) : (versions[fromSlot] ?? createDefaultColorGrade())) };
      nodeVersions[toSlot] = (live ? c.gradeNodes : nodeVersions[fromSlot]) ?? [];
      return { ...c, gradeVersions: versions, gradeNodeVersions: nodeVersions };
    })));
  },

  copyGrade: (clipId) => {
    const clip = get().project.sequence.clips.find((c) => c.id === clipId);
    if (!clip) return;
    set({ gradeClipboard: { colorGrade: clip.colorGrade ?? createDefaultColorGrade(), gradeNodes: clip.gradeNodes ?? [] } });
  },

  pasteGrade: (clipIds) => {
    const clip = get().gradeClipboard;
    if (!clip || !clipIds.length) return;
    set(withUndo("Paste Grade", (state) => {
      let next: Partial<EditorStore> | EditorStore = state;
      for (const id of clipIds) {
        next = updateClipInState(next as EditorStore, id, (c) => ({
          ...c,
          colorGrade: JSON.parse(JSON.stringify(clip.colorGrade)),
          gradeNodes: clip.gradeNodes.map((n) => ({ ...JSON.parse(JSON.stringify(n)), id: createId() })),
        }));
      }
      return next;
    }));
  },

  // ── Background Removal ────────────────────────────────────────────────────

  setBackgroundRemoval: (clipId, config) => {
    set(withUndo("Background Removal", (state) => updateClipInState(state, clipId, (c) => ({
      ...c,
      aiBackgroundRemoval: {
        ...(c.aiBackgroundRemoval ?? {
          enabled: true,
          edgeRefinement: 0.5,
          spillSuppression: 0.3,
          backgroundType: "transparent" as const,
          backgroundColor: "#000000",
          backgroundAssetId: null,
          threshold: 0.5
        }),
        ...config
      }
    }))));
  },

  toggleBackgroundRemoval: (clipId) => {
    set(withUndo("Toggle BG Removal", (state) => updateClipInState(state, clipId, (c) => {
      if (!c.aiBackgroundRemoval) {
        return {
          ...c,
          aiBackgroundRemoval: {
            enabled: true,
            edgeRefinement: 0.5,
            spillSuppression: 0.3,
            backgroundType: "transparent" as const,
            backgroundColor: "#000000",
            backgroundAssetId: null,
            threshold: 0.5
          }
        };
      }
      return { ...c, aiBackgroundRemoval: { ...c.aiBackgroundRemoval, enabled: !c.aiBackgroundRemoval.enabled } };
    })));
  },

  // ── Beat Sync ─────────────────────────────────────────────────────────────

  setBeatSync: (clipId, config) => {
    if (clipId === null) {
      set(withUndo("Set Beat Sync", (state) => ({
        project: {
          ...state.project,
          sequence: {
            ...state.project.sequence,
            beatSync: {
              ...(state.project.sequence.beatSync ?? {
                bpm: 120,
                beatsPerMeasure: 4,
                offset: 0,
                detectedBeats: [],
                syncMode: "everyBeat" as const,
                sensitivity: 0.7
              }),
              ...config
            }
          }
        }
      })));
    } else {
      set(withUndo("Set Beat Sync", (state) => updateClipInState(state, clipId, (c) => ({
        ...c,
        beatSync: {
          ...(c.beatSync ?? {
            bpm: 120,
            beatsPerMeasure: 4,
            offset: 0,
            detectedBeats: [],
            syncMode: "everyBeat" as const,
            sensitivity: 0.7
          }),
          ...config
        }
      }))));
    }
  },

  clearBeatSync: (clipId) => {
    if (clipId === null) {
      set(withUndo("Clear Beat Sync", (state) => ({
        project: {
          ...state.project,
          sequence: { ...state.project.sequence, beatSync: null }
        }
      })));
    } else {
      set(withUndo("Clear Beat Sync", (state) => updateClipInState(state, clipId, (c) => ({ ...c, beatSync: null }))));
    }
  },

  // ── Keyframes ─────────────────────────────────────────────────────────────

  addKeyframe: (clipId, property, frame, value) => {
    set(withUndo("Add Keyframe", (state) => updateClipInState(state, clipId, (c) => {
      const kfs = c.keyframes ?? {};
      const existing = kfs[property] ?? { property, keyframes: [] };
      // Remove any existing keyframe at this frame first, then add
      const filtered = existing.keyframes.filter((k) => k.frame !== frame);
      return {
        ...c,
        keyframes: {
          ...kfs,
          [property]: { property, keyframes: [...filtered, { frame, value }].sort((a, b) => a.frame - b.frame) }
        }
      };
    })));
  },

  removeKeyframe: (clipId, property, frame) => {
    set(withUndo("Remove Keyframe", (state) => updateClipInState(state, clipId, (c) => {
      const kfs = c.keyframes ?? {};
      const existing = kfs[property];
      if (!existing) return c;
      return {
        ...c,
        keyframes: {
          ...kfs,
          [property]: { ...existing, keyframes: existing.keyframes.filter((k) => k.frame !== frame) }
        }
      };
    })));
  },

  updateKeyframe: (clipId, property, frame, value) => {
    set(withUndo("Update Keyframe", (state) => updateClipInState(state, clipId, (c) => {
      const kfs = c.keyframes ?? {};
      const existing = kfs[property];
      if (!existing) return c;
      return {
        ...c,
        keyframes: {
          ...kfs,
          [property]: {
            ...existing,
            keyframes: existing.keyframes.map((k) => k.frame === frame ? { ...k, value } : k)
          }
        }
      };
    })));
  },

  // ── Tracks ────────────────────────────────────────────────────────────────

  addTrack: (kind) => {
    set(withUndo("Add Track", (state) => {
      const count = state.project.sequence.tracks.filter((t) => t.kind === kind).length;
      const label = kind === "video" ? "V" : "A";
      const newTrack: TimelineTrack = {
        id: createId(),
        name: `${label}${count + 1}`,
        kind,
        muted: false,
        locked: false,
        solo: false,
        height: kind === "video" ? 56 : 44,
        color: kind === "video" ? "#4f8ef7" : "#2fc77a"
      };
      return {
        project: {
          ...state.project,
          sequence: {
            ...state.project.sequence,
            tracks: [...state.project.sequence.tracks, newTrack]
          }
        }
      };
    }));
  },

  removeTrack: (trackId) => {
    set(withUndo("Remove Track", (state) => ({
      project: {
        ...state.project,
        sequence: {
          ...state.project.sequence,
          tracks: state.project.sequence.tracks.filter((t) => t.id !== trackId),
          clips: state.project.sequence.clips.filter((c) => c.trackId !== trackId)
        }
      }
    })));
  },

  updateTrack: (trackId, updates) => {
    set(withUndo("Update Track", (state) => ({
      project: {
        ...state.project,
        sequence: {
          ...state.project.sequence,
          tracks: state.project.sequence.tracks.map((t) =>
            t.id === trackId ? { ...t, ...updates } : t
          )
        }
      }
    })));
  },

  setAutomationKeyframe: (trackId, param, frame, value) => {
    set(withUndo("Set Automation Point", (state) => ({
      project: {
        ...state.project,
        sequence: {
          ...state.project.sequence,
          tracks: state.project.sequence.tracks.map((t) => {
            if (t.id !== trackId) return t;
            const lanes = [...(t.automation ?? [])];
            const laneIdx = lanes.findIndex(l => l.param === param);
            const newKf = { frame, value };
            if (laneIdx === -1) {
              lanes.push({ param, enabled: true, keyframes: [newKf] });
            } else {
              const kfs = [...lanes[laneIdx].keyframes];
              const existing = kfs.findIndex(k => k.frame === frame);
              if (existing >= 0) kfs[existing] = newKf; else kfs.push(newKf);
              kfs.sort((a, b) => a.frame - b.frame);
              lanes[laneIdx] = { ...lanes[laneIdx], keyframes: kfs };
            }
            return { ...t, automation: lanes };
          }),
        },
      },
    })));
  },

  removeAutomationKeyframe: (trackId, param, frame) => {
    set(withUndo("Remove Automation Point", (state) => ({
      project: {
        ...state.project,
        sequence: {
          ...state.project.sequence,
          tracks: state.project.sequence.tracks.map((t) => {
            if (t.id !== trackId) return t;
            const lanes = (t.automation ?? []).map(l =>
              l.param !== param ? l : { ...l, keyframes: l.keyframes.filter(k => k.frame !== frame) }
            );
            return { ...t, automation: lanes };
          }),
        },
      },
    })));
  },

  toggleAutomationLane: (trackId, param) => {
    set(withUndo("Toggle Automation Lane", (state) => ({
      project: {
        ...state.project,
        sequence: {
          ...state.project.sequence,
          tracks: state.project.sequence.tracks.map((t) => {
            if (t.id !== trackId) return t;
            const lanes = [...(t.automation ?? [])];
            const laneIdx = lanes.findIndex(l => l.param === param);
            if (laneIdx === -1) {
              lanes.push({ param, enabled: true, keyframes: [] });
            } else {
              lanes[laneIdx] = { ...lanes[laneIdx], enabled: !lanes[laneIdx].enabled };
            }
            return { ...t, automation: lanes };
          }),
        },
      },
    })));
  },

  toggleTrackLock: (trackId) => {
    set(withUndo("Toggle Track Lock", (state) => ({
      project: {
        ...state.project,
        sequence: {
          ...state.project.sequence,
          tracks: state.project.sequence.tracks.map((t) =>
            t.id === trackId ? { ...t, locked: !t.locked } : t
          )
        }
      }
    })));
  },

  toggleTrackSolo: (trackId) => {
    set(withUndo("Toggle Track Solo", (state) => ({
      project: {
        ...state.project,
        sequence: {
          ...state.project.sequence,
          tracks: state.project.sequence.tracks.map((t) =>
            t.id === trackId ? { ...t, solo: !t.solo } : t
          )
        }
      }
    })));
  },

  addAdjustmentLayer: (startFrame, durationFrames) => {
    set(withUndo("Add Adjustment Layer", (state) => {
      // Place on topmost video track (first video track)
      const videoTrack = state.project.sequence.tracks.find(t => t.kind === "video");
      if (!videoTrack) return state;
      const fps = state.project.sequence.settings.fps;
      const durationSeconds = durationFrames / fps;
      const virtualAssetId = createId();
      const virtualAsset: import("../../shared/models").MediaAsset = {
        id: virtualAssetId,
        name: "Adjustment Layer",
        sourcePath: "",
        previewUrl: "",
        thumbnailUrl: null,
        durationSeconds,
        nativeFps: fps,
        width: state.project.sequence.settings.width,
        height: state.project.sequence.settings.height,
        hasAudio: false,
      };
      const adjClip: TimelineClip = {
        id: createId(),
        assetId: virtualAssetId,
        trackId: videoTrack.id,
        startFrame,
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
        clipType: "adjustment",
      };
      return {
        ...state,
        project: {
          ...state.project,
          assets: [...state.project.assets, virtualAsset],
          sequence: {
            ...state.project.sequence,
            clips: [...state.project.sequence.clips, adjClip],
          }
        }
      };
    }));
  },

  setDuckingSettings: (settings: DuckingSettings[]) => {
    set(withUndo("Set Ducking Settings", (state) => ({
      project: { ...state.project, duckingSettings: settings }
    })));
  },

  patchClip: (clipId, updates) => {
    set(withUndo("Patch Clip", (state) => updateClipInState(state, clipId, (c) => ({ ...c, ...updates }))));
  },

  addAsset: (asset) => {
    set((state) => ({
      project: {
        ...state.project,
        assets: [...state.project.assets, asset],
      }
    }));
  },

  insertClip: (clip) => {
    set(withUndo("Insert Clip", (state) => ({
      project: {
        ...state.project,
        sequence: {
          ...state.project.sequence,
          clips: [...state.project.sequence.clips, clip],
        }
      },
      selectedClipId: clip.id,
    })));
  },

  editAtFrame: (assetId, frame, inFrame, outFrame, mode) => {
    set(withUndo(mode === "insert" ? "Insert Edit" : "Overwrite Edit", (state) => {
      const asset = state.project.assets.find((a) => a.id === assetId);
      if (!asset) return state;
      let project = withAssetSequenceDefaults(state.project, asset);
      const fps = project.sequence.settings.fps;
      const total = Math.round(asset.durationSeconds * fps);
      const from = Math.max(0, Math.min(inFrame, total - 1));
      const to = Math.max(from + 1, Math.min(outFrame, total));
      const dur = to - from;
      const at = Math.max(0, frame);
      const hasVideo = asset.width > 0 || !asset.hasAudio;

      const tracks = project.sequence.tracks;
      const vTrack = hasVideo ? tracks.find((t) => t.kind === "video" && !t.locked) : undefined;
      if (hasVideo && !vTrack) return state;
      let aTrack = asset.hasAudio ? tracks.find((t) => t.kind === "audio" && !t.locked) : undefined;
      if (asset.hasAudio && !aTrack) {
        aTrack = { id: createId(), name: `A${tracks.filter((t) => t.kind === "audio").length + 1}`, kind: "audio", muted: false, locked: false, solo: false, height: 44, color: "#2fc77a" };
        project = { ...project, sequence: { ...project.sequence, tracks: [...tracks, aTrack] } };
      }

      let clips: TimelineClip[];
      if (mode === "insert") {
        const unlocked = new Set(project.sequence.tracks.filter((t) => !t.locked).map((t) => t.id));
        clips = carveRange(project, unlocked, at, at).map((c) =>
          unlocked.has(c.trackId) && c.startFrame >= at ? { ...c, startFrame: c.startFrame + dur } : c);
      } else {
        const targets = new Set([vTrack?.id, aTrack?.id].filter((x): x is string => !!x));
        clips = carveRange(project, targets, at, at + dur);
      }

      const group = vTrack && aTrack ? createId() : null;
      const make = (trackId: string) => ({
        ...createEmptyClip(asset.id, trackId, at, { linkedGroupId: group }),
        trimStartFrames: from,
        trimEndFrames: Math.max(0, total - to),
      });
      const added = [vTrack && make(vTrack.id), aTrack && make(aTrack.id)].filter((c): c is TimelineClip => !!c);
      const next = { ...project, sequence: { ...project.sequence, clips: [...clips, ...added] } };
      return {
        project: next,
        selectedClipId: added[0].id,
        playback: { ...state.playback, isPlaying: false, playheadFrame: clampPlayhead(next, at + dur) },
      };
    }));
  },

  insertClipOnTop: (clip) => {
    set(withUndo("Insert Clip", (state) => {
      const seq = state.project.sequence;
      const asset = state.project.assets.find((a) => a.id === clip.assetId);
      const fps = seq.settings.fps || 30;
      const len = Math.max(1, Math.round((asset?.durationSeconds ?? 5) * fps) - clip.trimStartFrames - clip.trimEndFrames);
      const start = clip.startFrame, end = start + len;
      const top = seq.tracks.find((t) => t.kind === "video");
      const segs = buildTimelineSegments(seq, state.project.assets);
      const free = top && !top.locked && !segs.some((g) => g.clip.trackId === top.id && g.startFrame < end && g.endFrame > start);
      let tracks = seq.tracks;
      let trackId = top?.id ?? "";
      if (!free) {
        trackId = createId();
        const vCount = seq.tracks.filter((t) => t.kind === "video").length;
        tracks = [{ id: trackId, name: `V${vCount + 1}`, kind: "video", muted: false, locked: false, solo: false, height: 56, color: "#4f8ef7" }, ...seq.tracks];
      }
      return {
        project: { ...state.project, sequence: { ...seq, tracks, clips: [...seq.clips, { ...clip, trackId }] } },
        selectedClipId: clip.id,
      };
    }));
  },

  duplicateTrack: (trackId) => {
    set(withUndo("Duplicate Track", (state) => {
      const src = state.project.sequence.tracks.find((t) => t.id === trackId);
      if (!src) return state;
      const newTrackId = createId();
      const newTrack: TimelineTrack = {
        ...src,
        id: newTrackId,
        name: `${src.name} Copy`,
      };
      // Duplicate clips that belong to the source track
      const clipsToClone = state.project.sequence.clips.filter((c) => c.trackId === trackId);
      const newClips = clipsToClone.map((c) => ({ ...c, id: createId(), trackId: newTrackId, linkedGroupId: null }));
      // Insert the new track directly after the source track
      const trackIndex = state.project.sequence.tracks.findIndex((t) => t.id === trackId);
      const tracks = [...state.project.sequence.tracks];
      tracks.splice(trackIndex + 1, 0, newTrack);
      return {
        project: {
          ...state.project,
          sequence: {
            ...state.project.sequence,
            tracks,
            clips: [...state.project.sequence.clips, ...newClips]
          }
        }
      };
    }));
  },

  addTracksAndMoveClip: (clipId, startFrame, insertIndex) => {
    set(withUndo("Move to New Track", (state) => {
      const seq = state.project.sequence;

      // 1. Find the clip being dragged (video or audio)
      const clip = seq.clips.find((c) => c.id === clipId);
      if (!clip) return state;

      // 2. Collect the full linked group (video + audio)
      const linkedClips = clip.linkedGroupId
        ? seq.clips.filter((c) => c.linkedGroupId === clip.linkedGroupId)
        : [clip];

      // Determine the "primary" clip kind from the dragged clip's track
      const draggedTrack = seq.tracks.find((tr) => tr.id === clip.trackId);
      const draggedKind = draggedTrack?.kind ?? "video";

      // Separate by kind
      const videoClipsInGroup = linkedClips.filter((c) => {
        const t = seq.tracks.find((tr) => tr.id === c.trackId);
        return t?.kind === "video";
      });
      const audioClipsInGroup = linkedClips.filter((c) => {
        const t = seq.tracks.find((tr) => tr.id === c.trackId);
        return t?.kind === "audio";
      });

      // "Primary" clip drives the frame calculation (same kind as dragged clip)
      const primaryClip = draggedKind === "video"
        ? (videoClipsInGroup[0] ?? clip)
        : (audioClipsInGroup[0] ?? clip);

      const needVideoTrack = videoClipsInGroup.length > 0;
      const needAudioTrack = audioClipsInGroup.length > 0;

      // 3. Build new video track (if needed)
      const vCount = seq.tracks.filter((t) => t.kind === "video").length;
      const newVideoTrackId = createId();
      const newVideoTrack: TimelineTrack | null = needVideoTrack ? {
        id: newVideoTrackId,
        name: `V${vCount + 1}`,
        kind: "video",
        muted: false, locked: false, solo: false,
        height: 56,
        color: "#4f8ef7"
      } : null;

      // 4. Build new audio track (if needed)
      const aCount = seq.tracks.filter((t) => t.kind === "audio").length;
      const newAudioTrackId = createId();
      const newAudioTrack: TimelineTrack | null = needAudioTrack ? {
        id: newAudioTrackId,
        name: `A${aCount + 1}`,
        kind: "audio",
        muted: false, locked: false, solo: false,
        height: 44,
        color: "#2fc77a"
      } : null;

      // 5. Compute frame delta (relative to primary clip's start)
      const frameDelta = startFrame - primaryClip.startFrame;

      // 6. Rewrite clips: move each to appropriate new track
      const updatedClips = seq.clips.map((c) => {
        if (needVideoTrack && videoClipsInGroup.some((v) => v.id === c.id)) {
          return { ...c, trackId: newVideoTrackId, startFrame: Math.max(0, c.startFrame + frameDelta) };
        }
        if (needAudioTrack && audioClipsInGroup.some((a) => a.id === c.id)) {
          return { ...c, trackId: newAudioTrackId, startFrame: Math.max(0, c.startFrame + frameDelta) };
        }
        return c;
      });

      // 7. Splice new tracks at the correct position
      //    insertIndex is the desired index in the CURRENT tracks array.
      //    Clamp to valid range.
      const clamped = Math.max(0, Math.min(insertIndex, seq.tracks.length));
      const newTracks = [
        ...seq.tracks.slice(0, clamped),
        // Insert video track first (if present), then audio track below it
        ...(newVideoTrack ? [newVideoTrack] : []),
        ...(newAudioTrack ? [newAudioTrack] : []),
        ...seq.tracks.slice(clamped),
      ];

      const nextProject = resolveTracks(
        {
          ...state.project,
          sequence: { ...seq, tracks: newTracks, clips: updatedClips }
        },
        [
          ...(needVideoTrack ? [newVideoTrackId] : []),
          ...(needAudioTrack ? [newAudioTrackId] : [])
        ]
      );

      return {
        project: nextProject,
        selectedClipId: clipId,
        playback: {
          ...state.playback,
          playheadFrame: clampPlayhead(nextProject, state.playback.playheadFrame)
        }
      };
    }));
  },

  addTracksAndDropAsset: (assetId, startFrame, insertIndex) => {
    set(withUndo("Drop Asset to New Track", (state) => {
      const asset = state.project.assets.find((a) => a.id === assetId);
      if (!asset) return state;

      let nextProject = withAssetSequenceDefaults(state.project, asset);
      const seq = nextProject.sequence;

      const resolvedStart = Math.max(0, startFrame);

      // 1. Build new video track
      const vCount = seq.tracks.filter((t) => t.kind === "video").length;
      const newVideoTrackId = createId();
      const newVideoTrack: TimelineTrack = {
        id: newVideoTrackId,
        name: `V${vCount + 1}`,
        kind: "video",
        muted: false, locked: false, solo: false,
        height: 56,
        color: "#4f8ef7",
      };

      // 2. Build new audio track (only if asset has audio)
      const linkedGroupId = asset.hasAudio ? createId() : null;
      const aCount = seq.tracks.filter((t) => t.kind === "audio").length;
      const newAudioTrackId = createId();
      const newAudioTrack: TimelineTrack | null = asset.hasAudio ? {
        id: newAudioTrackId,
        name: `A${aCount + 1}`,
        kind: "audio",
        muted: false, locked: false, solo: false,
        height: 44,
        color: "#2fc77a",
      } : null;

      // 3. Splice new tracks at insertIndex
      const clamped = Math.max(0, Math.min(insertIndex, seq.tracks.length));
      const newTracks = [
        ...seq.tracks.slice(0, clamped),
        newVideoTrack,
        ...(newAudioTrack ? [newAudioTrack] : []),
        ...seq.tracks.slice(clamped),
      ];

      // 4. Create clips
      const videoClip = createEmptyClip(asset.id, newVideoTrackId, resolvedStart, { linkedGroupId });
      const newClips: TimelineClip[] = [videoClip];
      if (newAudioTrack && linkedGroupId) {
        newClips.push(createEmptyClip(asset.id, newAudioTrackId, resolvedStart, { linkedGroupId }));
      }

      const nextSeq = {
        ...seq,
        tracks: newTracks,
        clips: [...seq.clips, ...newClips],
      };

      const finalProject = resolveTracks(
        { ...nextProject, sequence: nextSeq },
        [newVideoTrackId, ...(newAudioTrack ? [newAudioTrackId] : [])]
      );

      return {
        project: finalProject,
        selectedAssetId: assetId,
        selectedClipId: videoClip.id,
        playback: {
          ...state.playback,
          isPlaying: false,
          playheadFrame: clampPlayhead(finalProject, resolvedStart),
        },
      };
    }));
  },

  reorderTrack: (trackId, toIndex) => {
    set(withUndo("Reorder Track", (state) => {
      const tracks = state.project.sequence.tracks;
      const fromIndex = tracks.findIndex((t) => t.id === trackId);
      if (fromIndex === -1) return state;

      // Remove the track from its current position
      const withoutTrack = [...tracks.slice(0, fromIndex), ...tracks.slice(fromIndex + 1)];
      // Clamp destination
      const dest = Math.max(0, Math.min(toIndex, withoutTrack.length));
      const reordered = [...withoutTrack.slice(0, dest), tracks[fromIndex], ...withoutTrack.slice(dest)];

      return {
        project: resolveTracks(
          {
            ...state.project,
            sequence: { ...state.project.sequence, tracks: reordered }
          },
          []
        )
      };
    }));
  },

  reorderClips: (draggedClipId, targetClipId) => {
    // Storyboard move: the dragged clip takes the target's slot on its track,
    // the track's clips re-pack in the new order (keeping the first clip's
    // start), and every clip's linked partners follow it.
    set(withUndo("Reorder Clips", (state) => {
      const seq = state.project.sequence;
      const segs = buildTimelineSegments(seq, state.project.assets);
      const dragged = segs.find((g) => g.clip.id === draggedClipId);
      const target = segs.find((g) => g.clip.id === targetClipId);
      if (!dragged || !target || dragged === target || dragged.clip.trackId !== target.clip.trackId) return state;
      const row = segs.filter((g) => g.clip.trackId === target.clip.trackId).sort((a, b) => a.startFrame - b.startFrame);
      const order = row.filter((g) => g !== dragged);
      const at = order.indexOf(target) + (dragged.startFrame < target.startFrame ? 1 : 0);
      order.splice(at, 0, dragged);
      const delta = new Map<string, number>();
      let cursor = row[0].startFrame;
      for (const g of order) {
        const d = cursor - g.startFrame;
        for (const c of getLinkedClips(state.project, g.clip.id)) delta.set(c.id, d);
        cursor += g.durationFrames;
      }
      const clips = seq.clips.map((c) => delta.get(c.id) ? { ...c, startFrame: c.startFrame + delta.get(c.id)! } : c);
      return { project: { ...state.project, sequence: { ...seq, clips } } };
    }));
  },

  // ── Markers ───────────────────────────────────────────────────────────────

  addMarker: (marker) => {
    set(withUndo("Add Marker", (state) => ({
      project: {
        ...state.project,
        sequence: {
          ...state.project.sequence,
          markers: [
            ...state.project.sequence.markers,
            { ...marker, id: createId() }
          ]
        }
      }
    })));
  },

  removeMarker: (markerId) => {
    set(withUndo("Remove Marker", (state) => ({
      project: {
        ...state.project,
        sequence: {
          ...state.project.sequence,
          markers: state.project.sequence.markers.filter((m) => m.id !== markerId)
        }
      }
    })));
  },

  updateMarker: (markerId, updates) => {
    set((state) => ({
      project: {
        ...state.project,
        sequence: {
          ...state.project.sequence,
          markers: state.project.sequence.markers.map((m) =>
            m.id === markerId ? { ...m, ...updates } : m
          )
        }
      }
    }));
  },

  // ── Playhead ─────────────────────────────────────────────────────────────

  setPlayheadFrame: (frame) => {
    set((state) => {
      const next = clampPlayhead(state.project, frame);
      if (next === state.playback.playheadFrame) return state;
      return { playback: { ...state.playback, playheadFrame: next } };
    });
  },

  nudgePlayhead: (delta) => {
    set((state) => {
      const next = clampPlayhead(state.project, state.playback.playheadFrame + delta);
      if (next === state.playback.playheadFrame) return state;
      return { playback: { ...state.playback, playheadFrame: next } };
    });
  },

  setPlaybackPlaying: (isPlaying) => {
    set((state) => {
      if (state.playback.isPlaying === isPlaying) return state;
      return { playback: { ...state.playback, isPlaying } };
    });
  },

  stopPlayback: () => {
    set((state) => {
      if (!state.playback.isPlaying) return state;
      return { playback: { ...state.playback, isPlaying: false } };
    });
  },

  // ── Tool & Page ───────────────────────────────────────────────────────────

  setToolMode: (toolMode) => set({ toolMode }),

  toggleBladeTool: () => {
    set((state) => ({ toolMode: state.toolMode === "blade" ? "select" : "blade" }));
  },

  setActivePage: (page) => set({ activePage: page }),

  setEnvironment: (environment) => set({ environment }),

  // ── Sequence settings ────────────────────────────────────────────────────
  updateSequenceSettings: (settings) => {
    set((state) => ({
      project: {
        ...state.project,
        sequence: {
          ...state.project.sequence,
          settings: { ...state.project.sequence.settings, ...settings }
        }
      }
    }));
  },

  // ── Fusion / Compositing ─────────────────────────────────────────────────
  openFusion: (clipId) => {
    set({ fusionClipId: clipId, activePage: "fusion" as import("../../shared/models").EditorPage });
  },

  closeFusion: () => {
    set({ fusionClipId: null, activePage: "edit" as import("../../shared/models").EditorPage });
  },

  setCompGraph: (clipId, graph) => {
    set((state) => ({
      project: {
        ...state.project,
        sequence: {
          ...state.project.sequence,
          clips: state.project.sequence.clips.map((c) =>
            c.id === clipId ? { ...c, compGraph: graph } : c
          ),
        },
      },
    }));
  },

  clearCompGraph: (clipId) => {
    set((state) => ({
      project: {
        ...state.project,
        sequence: {
          ...state.project.sequence,
          clips: state.project.sequence.clips.map((c) =>
            c.id === clipId ? { ...c, compGraph: null } : c
          ),
        },
      },
    }));
  },

  // ── Ripple Delete ─────────────────────────────────────────────────────────
  rippleDelete: (clipId) => {
    set(withUndo("Ripple Delete", (state) => {
      const linked = getLinkedClips(state.project, clipId);
      if (!linked.length) return state;
      const segs = buildTimelineSegments(state.project.sequence, state.project.assets);
      const segsById = new Map(segs.map((s) => [s.clip.id, s]));
      const linkedIds = new Set(linked.map((c) => c.id));
      const trackIds = linked.map((c) => c.trackId);
      const removedByTrack = new Map<string, Array<{ dur: number; start: number }>>();
      for (const clip of linked) {
        const seg = segsById.get(clip.id);
        if (!seg) continue;
        const arr = removedByTrack.get(clip.trackId) ?? [];
        arr.push({ dur: seg.durationFrames, start: seg.startFrame });
        removedByTrack.set(clip.trackId, arr);
      }
      const next = resolveTracks(
        {
          ...state.project,
          sequence: {
            ...state.project.sequence,
            clips: state.project.sequence.clips
              .filter((c) => !linkedIds.has(c.id))
              .map((c) => {
                const removed = removedByTrack.get(c.trackId);
                if (!removed?.length) return c;
                const ripple = removed.reduce((t, r) => r.start < c.startFrame ? t + r.dur : t, 0);
                return ripple > 0 ? { ...c, startFrame: Math.max(0, c.startFrame - ripple) } : c;
              })
          }
        },
        trackIds
      );
      const nextSegs = buildTimelineSegments(next.sequence, next.assets);
      const fallback = findPlayableSegmentAtFrame(nextSegs, state.playback.playheadFrame, "video") ?? nextSegs[0] ?? null;
      return {
        project: next,
        selectedClipId: fallback?.clip.id ?? null,
        selectedAssetId: fallback?.asset.id ?? state.selectedAssetId,
        playback: {
          isPlaying: nextSegs.length ? state.playback.isPlaying : false,
          playheadFrame: clampPlayhead(next, state.playback.playheadFrame)
        }
      };
    }));
  },

  // ── Precision Trim operations ─────────────────────────────────────────────

  rippleTrim: (clipId, side, deltaFrames) => {
    // side 'start': +delta trims the head (clip gets shorter); the clip keeps
    // its start, everything after it on the track moves left.
    // side 'end':   +delta extends the tail (clip gets longer); everything after
    // it moves right. Linked clips (e.g. the audio of a video) move together.
    set(withUndo("Ripple Trim", (state) => {
      const clip = state.project.sequence.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const fps = state.project.sequence.settings.fps;
      const assetsById = new Map(state.project.assets.map((a) => [a.id, a]));
      const group = getLinkedClips(state.project, clipId);
      const primaryAsset = assetsById.get(clip.assetId);
      if (!primaryAsset) return state;

      const trimmed = (c: TimelineClip, d: number): TimelineClip => {
        const a = assetsById.get(c.assetId)!;
        const total = getAssetDurationFrames(a, fps);
        const sp = Math.max(0.25, Math.min(4, c.speed ?? 1));
        if (side === "start") {
          const t = Math.max(0, Math.min(c.trimStartFrames + d * sp, total - c.trimEndFrames - 1));
          return { ...c, trimStartFrames: t };
        }
        const t = Math.max(0, Math.min(c.trimEndFrames - d * sp, total - c.trimStartFrames - 1));
        return { ...c, trimEndFrames: t };
      };
      // Timeline change is driven by the primary clip; linked clips follow it.
      const oldDur = getClipDurationFrames(clip, primaryAsset, fps);
      const newDur = getClipDurationFrames(trimmed(clip, deltaFrames), primaryAsset, fps);
      const change = newDur - oldDur; // + longer, − shorter
      if (change === 0) return state;
      const effDelta = side === "start" ? -change : change;

      const changed = new Map<string, TimelineClip>();
      const shiftFrom = new Map<string, number>(); // trackId → frames at/after which clips shift
      for (const c of group) {
        const a = assetsById.get(c.assetId);
        if (!a) continue;
        const end = c.startFrame + getClipDurationFrames(c, a, fps);
        changed.set(c.id, trimmed(c, effDelta));
        shiftFrom.set(c.trackId, end);
      }
      const clips = state.project.sequence.clips.map((c) => {
        const t = changed.get(c.id);
        if (t) return t;
        const from = shiftFrom.get(c.trackId);
        if (from !== undefined && c.startFrame >= from) return { ...c, startFrame: Math.max(0, c.startFrame + change) };
        return c;
      });
      const project = { ...state.project, sequence: { ...state.project.sequence, clips } };
      return { project, playback: { ...state.playback, playheadFrame: clampPlayhead(project, state.playback.playheadFrame) } };
    }));
  },

  rollTrim: (clipId, deltaFrames) => {
    // Move the edit point between this clip and the next adjacent clip on its
    // track by deltaFrames: this clip gets longer/shorter at its tail, the next
    // one shorter/longer at its head and moves with the edit point. Linked
    // partners roll the same edit on their tracks. Nothing else moves.
    set(withUndo("Roll Trim", (state) => {
      const clip = state.project.sequence.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const fps = state.project.sequence.settings.fps;
      const assetsById = new Map(state.project.assets.map((a) => [a.id, a]));
      const endOf = (c: TimelineClip) => c.startFrame + getClipDurationFrames(c, assetsById.get(c.assetId)!, fps);
      const pairs: Array<[TimelineClip, TimelineClip]> = [];
      for (const c of getLinkedClips(state.project, clipId)) {
        if (!assetsById.get(c.assetId)) continue;
        const e = endOf(c);
        const next = state.project.sequence.clips.find((n) => n.trackId === c.trackId && n.id !== c.id && n.startFrame === e && assetsById.get(n.assetId));
        if (next) pairs.push([c, next]);
      }
      if (!pairs.length) return state;
      // Clamp so both sides keep ≥1 frame and stay within their media.
      let d = deltaFrames;
      for (const [a, b] of pairs) {
        const aa = assetsById.get(a.assetId)!, ba = assetsById.get(b.assetId)!;
        const sa = Math.max(0.25, Math.min(4, a.speed ?? 1)), sb = Math.max(0.25, Math.min(4, b.speed ?? 1));
        const aDur = getClipDurationFrames(a, aa, fps), bDur = getClipDurationFrames(b, ba, fps);
        const maxRight = Math.min(a.trimEndFrames / sa, bDur - 1);
        const maxLeft = Math.min(aDur - 1, b.trimStartFrames / sb);
        d = Math.max(-Math.floor(maxLeft), Math.min(Math.floor(maxRight), d));
      }
      if (d === 0) return state;
      const updated = new Map<string, TimelineClip>();
      for (const [a, b] of pairs) {
        const sa = Math.max(0.25, Math.min(4, a.speed ?? 1)), sb = Math.max(0.25, Math.min(4, b.speed ?? 1));
        updated.set(a.id, { ...a, trimEndFrames: Math.max(0, a.trimEndFrames - d * sa) });
        updated.set(b.id, { ...b, trimStartFrames: Math.max(0, b.trimStartFrames + d * sb), startFrame: b.startFrame + d });
      }
      const clips = state.project.sequence.clips.map((c) => updated.get(c.id) ?? c);
      const project = { ...state.project, sequence: { ...state.project.sequence, clips } };
      return { project, playback: { ...state.playback, playheadFrame: clampPlayhead(project, state.playback.playheadFrame) } };
    }));
  },


  slip: (clipId, deltaFrames) => {
    // Change which part of the source plays; the clip (and its linked
    // partners) keep their position and duration.
    set(withUndo("Slip", (state) => {
      const group = getLinkedClips(state.project, clipId);
      if (!group.length) return state;
      const sp = (c: TimelineClip) => Math.max(0.25, Math.min(4, c.speed ?? 1));
      let d = deltaFrames;
      for (const c of group) d = Math.max(-Math.floor(c.trimStartFrames / sp(c)), Math.min(Math.floor(c.trimEndFrames / sp(c)), d));
      if (d === 0) return state;
      const ids = new Set(group.map((c) => c.id));
      const clips = state.project.sequence.clips.map((c) => ids.has(c.id)
        ? { ...c, trimStartFrames: c.trimStartFrames + Math.round(d * sp(c)), trimEndFrames: Math.max(0, c.trimEndFrames - Math.round(d * sp(c))) }
        : c);
      return { project: { ...state.project, sequence: { ...state.project.sequence, clips } } };
    }));
  },

  slide: (clipId, deltaFrames) => {
    // Move the clip (and linked partners) along its track keeping its source
    // range: the adjacent clip before it extends/shortens its tail, the one
    // after it shortens/extends its head. Nothing else moves.
    set(withUndo("Slide", (state) => {
      const fps = state.project.sequence.settings.fps;
      const assetsById = new Map(state.project.assets.map((a) => [a.id, a]));
      const sp = (c: TimelineClip) => Math.max(0.25, Math.min(4, c.speed ?? 1));
      const dur = (c: TimelineClip) => getClipDurationFrames(c, assetsById.get(c.assetId)!, fps);
      const group = getLinkedClips(state.project, clipId).filter((c) => assetsById.has(c.assetId));
      if (!group.length) return state;
      const ids = new Set(group.map((c) => c.id));
      const plans = group.map((c) => {
        const others = state.project.sequence.clips.filter((o) => o.trackId === c.trackId && !ids.has(o.id) && assetsById.has(o.assetId));
        const end = c.startFrame + dur(c);
        const prev = others.find((o) => o.startFrame + dur(o) === c.startFrame) ?? null;
        const next = others.find((o) => o.startFrame === end) ?? null;
        const prevEnd = Math.max(0, ...others.filter((o) => o.startFrame < c.startFrame).map((o) => Math.min(c.startFrame, o.startFrame + dur(o))));
        const nextStart = Math.min(Infinity, ...others.filter((o) => o.startFrame >= end).map((o) => o.startFrame));
        return { c, prev, next, prevEnd, nextStart, end };
      });
      let d = deltaFrames;
      for (const { c, prev, next, prevEnd, nextStart, end } of plans) {
        const maxRight = Math.min(prev ? prev.trimEndFrames / sp(prev) : Infinity, next ? dur(next) - 1 : nextStart - end);
        const maxLeft = Math.min(prev ? dur(prev) - 1 : c.startFrame - prevEnd, next ? next.trimStartFrames / sp(next) : Infinity);
        d = Math.max(-Math.floor(maxLeft), Math.min(Math.floor(maxRight), d));
      }
      if (d === 0) return state;
      const updated = new Map<string, TimelineClip>();
      for (const { c, prev, next } of plans) {
        updated.set(c.id, { ...c, startFrame: c.startFrame + d });
        if (prev) updated.set(prev.id, { ...prev, trimEndFrames: Math.max(0, prev.trimEndFrames - Math.round(d * sp(prev))) });
        if (next) updated.set(next.id, { ...next, startFrame: next.startFrame + d, trimStartFrames: Math.max(0, next.trimStartFrames + Math.round(d * sp(next))) });
      }
      const clips = state.project.sequence.clips.map((c) => updated.get(c.id) ?? c);
      const project = { ...state.project, sequence: { ...state.project.sequence, clips } };
      return { project, playback: { ...state.playback, playheadFrame: clampPlayhead(project, state.playback.playheadFrame) } };
    }));
  },

  // ── Fixed Playhead Mode ───────────────────────────────────────────────────
  fixedPlayheadMode: false,
  toggleFixedPlayheadMode: () => {
    set((state) => ({ fixedPlayheadMode: !state.fixedPlayheadMode }));
  },

  // ── Transcripts ───────────────────────────────────────────────────────────
  setTranscript: (assetId, transcript) => {
    set((state) => ({
      project: {
        ...state.project,
        transcripts: {
          ...(state.project.transcripts ?? {}),
          [assetId]: transcript
        }
      }
    }));
  },

  // ── Color Stills Gallery ──────────────────────────────────────────────────
  addColorStill: (still) => {
    set((state) => ({
      project: {
        ...state.project,
        colorStills: [...(state.project.colorStills ?? []), still]
      }
    }));
  },

  removeColorStill: (stillId) => {
    set((state) => ({
      project: {
        ...state.project,
        colorStills: (state.project.colorStills ?? []).filter((s) => s.id !== stillId)
      }
    }));
  },

  renameColorStill: (stillId, label) => {
    set((state) => ({
      project: {
        ...state.project,
        colorStills: (state.project.colorStills ?? []).map((s) =>
          s.id === stillId ? { ...s, label } : s
        )
      }
    }));
  },

  // ── Project Metadata (GAP B) ──────────────────────────────────────────────
  updateProjectMetadata: (updates) => {
    set((state) => ({
      project: {
        ...state.project,
        metadata: { ...(state.project.metadata ?? {}), ...updates }
      }
    }));
  },

  // ── Timeline Auto-Layout (UX 2) ──────────────────────────────────────────
  autoLayoutTimeline: () => {
    // Tidy without breaking the edit: close time that's empty on every track
    // (sync-safe) and drop extra tracks that hold no clips.
    get().closeAllGaps();
    set(withUndo("Close All Gaps", (state) => {
      const seq = state.project.sequence;
      const used = new Set(seq.clips.map((c) => c.trackId));
      const firstV = seq.tracks.find((t) => t.kind === "video")?.id;
      const firstA = seq.tracks.find((t) => t.kind === "audio")?.id;
      const tracks = seq.tracks.filter((t) => used.has(t.id) || t.id === firstV || t.id === firstA);
      if (tracks.length === seq.tracks.length) return state;
      return { project: { ...state.project, sequence: { ...seq, tracks } } };
    }));
  },

  // ── Nested Sequence state ─────────────────────────────────────────────────
  activeNestedSequenceId: null,

  openNestedSequence: (nestedSequenceId) => {
    set({ activeNestedSequenceId: nestedSequenceId });
  },

  exitNestedSequence: () => {
    set({ activeNestedSequenceId: null });
  },

  // ── Timeline Nesting (GAP E) ──────────────────────────────────────────────
  nestSelectedClips: (clipIds, label) => {
    set(withUndo("Nest Clips", (state) => {
      if (clipIds.length === 0) return state;
      const { sequence } = state.project;
      const clipsToNest = sequence.clips.filter(c => clipIds.includes(c.id));
      if (clipsToNest.length === 0) return state;

      const minStart = Math.min(...clipsToNest.map(c => c.startFrame));

      // Build sub-sequence
      const subSeqId = createId();
      // Mirror the original tracks the clips came from (video and audio), in order.
      const usedTrackIds = new Set(clipsToNest.map(c => c.trackId));
      const trackMap = new Map<string, string>();
      const subTracks = sequence.tracks
        .filter(t => usedTrackIds.has(t.id))
        .map(t => {
          const id = createId();
          trackMap.set(t.id, id);
          return { ...t, id, muted: false, solo: false, locked: false };
        });
      const subClips = clipsToNest.map(c => shiftClipKeyframes({ ...c, id: createId(), trackId: trackMap.get(c.trackId)!, startFrame: c.startFrame - minStart }, -minStart));
      const fps = sequence.settings.fps;
      const assetsById = new Map(state.project.assets.map(a => [a.id, a]));
      const nestedFrames = subClips.reduce((m, c) => {
        const a = assetsById.get(c.assetId);
        return a ? Math.max(m, c.startFrame + getClipDurationFrames(c, a, fps)) : m;
      }, 1);
      const subSeq: import("../../shared/models").EditorSequence = {
        id: subSeqId,
        name: label,
        tracks: subTracks,
        clips: subClips,
        settings: sequence.settings,
        beatSync: null,
        markers: [],
      };

      // Create a placeholder asset for the nested clip
      const placeholderAssetId = createId();
      const placeholderAsset: import("../../shared/models").MediaAsset = {
        id: placeholderAssetId,
        name: label,
        sourcePath: "",
        previewUrl: "",
        thumbnailUrl: null,
        durationSeconds: nestedFrames / fps,
        nativeFps: sequence.settings.fps,
        width: sequence.settings.width,
        height: sequence.settings.height,
        hasAudio: false,
      };

      // The nest lives on a video track: the topmost one it came from, else V1.
      const videoTrackIds = sequence.tracks.filter(t => t.kind === "video").map(t => t.id);
      const hostTrackId = videoTrackIds.find(id => usedTrackIds.has(id)) ?? videoTrackIds[0] ?? clipsToNest[0].trackId;
      const nestedClip: import("../../shared/models").TimelineClip = {
        id: createId(),
        assetId: placeholderAssetId,
        trackId: hostTrackId,
        startFrame: minStart,
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
        nestedSequenceId: subSeqId,
      };

      return {
        ...state,
        project: {
          ...state.project,
          assets: [...state.project.assets, placeholderAsset],
          nestedSequences: {
            ...(state.project.nestedSequences ?? {}),
            [subSeqId]: subSeq,
          },
          sequence: {
            ...sequence,
            clips: [
              ...sequence.clips.filter(c => !clipIds.includes(c.id)),
              nestedClip,
            ],
          }
        }
      };
    }));
  },

  // ── Clip History (UX 3) ──────────────────────────────────────────────────
  addCaptionsFromTranscript: (words, fps, clipStartFrame, style = 'bold') => {
    set(withUndo('Add Captions Track', (state) => {
      if (!words.length) return state;
      // Group into lines: max 6 words or 3.5s
      const lines: Array<{ text: string; startSec: number; endSec: number }> = [];
      let lineWords: string[] = [];
      let lineStart = words[0].start;
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        lineWords.push(w.word.trim());
        const lineDur = w.end - lineStart;
        const isLast = i === words.length - 1;
        if (lineWords.length >= 6 || lineDur >= 3.5 || isLast) {
          lines.push({ text: lineWords.join(' '), startSec: lineStart, endSec: w.end });
          lineWords = [];
          lineStart = words[i + 1]?.start ?? w.end;
        }
      }
      if (!lines.length) return state;

      const captionTrackName = 'Captions';
      let captionTrack = state.project.sequence.tracks.find(t => t.name === captionTrackName);
      const newTracks = [...state.project.sequence.tracks];
      if (!captionTrack) {
        captionTrack = {
          id: createId(), name: captionTrackName, kind: 'video' as const,
          muted: false, locked: false, solo: false, height: 40, color: '#a78bfa',
        };
        newTracks.push(captionTrack);
      }

      const captionAssetId = createId();
      const captionAsset: MediaAsset = {
        id: captionAssetId, name: 'Captions', sourcePath: '', previewUrl: '',
        thumbnailUrl: null, durationSeconds: 9999, nativeFps: fps,
        width: state.project.sequence.settings.width,
        height: state.project.sequence.settings.height, hasAudio: false,
      };

      const captionClips: TimelineClip[] = lines.map(line => ({
        id: createId(),
        assetId: captionAssetId,
        trackId: captionTrack!.id,
        clipType: 'caption' as const,
        startFrame: clipStartFrame + Math.round(line.startSec * fps),
        trimStartFrames: 0,
        // The shared caption asset is 9999 s long; trim each clip to its line.
        trimEndFrames: Math.max(
          0,
          Math.round(9999 * state.project.sequence.settings.fps) -
            Math.max(1, Math.round((line.endSec - line.startSec) * state.project.sequence.settings.fps))
        ),
        linkedGroupId: null,
        isEnabled: true,
        transitionIn: null, transitionOut: null,
        masks: [], effects: [],
        colorGrade: null, volume: 1, speed: 1,
        transform: null, compGraph: null,
        aiBackgroundRemoval: null, beatSync: null,
        captionText: line.text,
        captionStyle: style,
      }));

      const filteredClips = state.project.sequence.clips.filter(c => c.trackId !== captionTrack!.id);

      return {
        ...state,
        project: {
          ...state.project,
          assets: [...state.project.assets, captionAsset],
          sequence: {
            ...state.project.sequence,
            tracks: newTracks,
            clips: [...filteredClips, ...captionClips],
          },
        },
      };
    }));
  },

    saveClipHistorySnapshot: (clipId, label) => {
    set((state) => {
      const clip = state.project.sequence.clips.find(c => c.id === clipId);
      if (!clip) return state;
      const snapshot: import("../../shared/models").ClipHistorySnapshot = {
        id: createId(),
        label,
        capturedAt: Date.now(),
        trimStartFrames: clip.trimStartFrames,
        trimEndFrames: clip.trimEndFrames,
        colorGrade: clip.colorGrade ? { ...clip.colorGrade } : null,
        effects: clip.effects.map(e => ({ ...e })),
        volume: clip.volume,
        speed: clip.speed,
      };
      const existing = clip.clipHistory ?? [];
      const updated = [snapshot, ...existing].slice(0, 5);
      return {
        project: {
          ...state.project,
          sequence: {
            ...state.project.sequence,
            clips: state.project.sequence.clips.map(c =>
              c.id === clipId ? { ...c, clipHistory: updated } : c
            )
          }
        }
      };
    });
  },

  restoreClipHistorySnapshot: (clipId, snapshotId) => {
    set(withUndo("Restore Clip History", (state) => {
      const clip = state.project.sequence.clips.find(c => c.id === clipId);
      if (!clip) return state;
      const snap = (clip.clipHistory ?? []).find(s => s.id === snapshotId);
      if (!snap) return state;
      return {
        ...state,
        project: {
          ...state.project,
          sequence: {
            ...state.project.sequence,
            clips: state.project.sequence.clips.map(c =>
              c.id === clipId ? {
                ...c,
                trimStartFrames: snap.trimStartFrames,
                trimEndFrames: snap.trimEndFrames,
                colorGrade: snap.colorGrade,
                effects: snap.effects,
                volume: snap.volume,
                speed: snap.speed,
              } : c
            )
          }
        }
      };
    }));
  },

  // ── Compound Nodes (GAP A) ────────────────────────────────────────────────
  groupNodes: (nodeIds, label) => {
    set((state) => ({
      project: {
        ...state.project,
        compoundNodes: [
          ...(state.project.compoundNodes ?? []),
          { id: createId(), label, nodeIds }
        ]
      }
    }));
  },

  ungroupNodes: (compoundId) => {
    set((state) => ({
      project: {
        ...state.project,
        compoundNodes: (state.project.compoundNodes ?? []).filter(n => n.id !== compoundId)
      }
    }));
  },

  // ── Add asset to pool only (no timeline) ─────────────────────────────────
  addAssetToPool: (asset) => {
    set((state) => ({
      project: {
        ...state.project,
        assets: [...state.project.assets, asset]
      }
    }));
  },

  // ── ClawFlow AI ───────────────────────────────────────────────────────────

  autoColorMatch: () => {
    set(withUndo("Auto Color Match", (state) => {
      const segs = buildTimelineSegments(state.project.sequence, state.project.assets)
        .filter(s => s.track.kind === "video");
      if (segs.length < 1) return state;

      // Compute the average exposure, temperature, contrast, saturation across all clips
      // that HAVE a color grade. Use those averages as the target for ungraded clips.
      const gradedSegs = segs.filter(s => s.clip.colorGrade != null);

      // If no clip has been manually graded yet, apply a sensible cinematic base grade
      // so the user sees an immediate result (avoids "does nothing" for fresh timelines).
      const baseGrade: Partial<ColorGrade> = gradedSegs.length === 0
        ? { exposure: 0, contrast: 0.08, saturation: 0.95, temperature: 3 }
        : {
            exposure:    gradedSegs.reduce((s, g) => s + (g.clip.colorGrade!.exposure    ?? 0),   0) / gradedSegs.length,
            temperature: gradedSegs.reduce((s, g) => s + (g.clip.colorGrade!.temperature ?? 0),   0) / gradedSegs.length,
            contrast:    gradedSegs.reduce((s, g) => s + (g.clip.colorGrade!.contrast    ?? 0),   0) / gradedSegs.length,
            saturation:  gradedSegs.reduce((s, g) => s + (g.clip.colorGrade!.saturation  ?? 1),   0) / gradedSegs.length,
          };

      const newClips = state.project.sequence.clips.map(clip => {
        const seg = segs.find(s => s.clip.id === clip.id);
        if (!seg) return clip;
        const existing = clip.colorGrade ?? createDefaultColorGrade();
        return {
          ...clip,
          colorGradeEnabled: true,
          colorGrade: {
            ...existing,
            // Blend 50% toward the target — clips with existing grades move toward average,
            // clips without grades adopt the base grade directly.
            exposure:    clip.colorGrade
              ? (existing.exposure    * 0.5 + (baseGrade.exposure    ?? 0) * 0.5)
              : (baseGrade.exposure   ?? 0),
            temperature: clip.colorGrade
              ? ((existing.temperature ?? 0) * 0.5 + (baseGrade.temperature ?? 0) * 0.5)
              : (baseGrade.temperature ?? 0),
            contrast:    clip.colorGrade
              ? ((existing.contrast    ?? 0) * 0.5 + (baseGrade.contrast    ?? 0) * 0.5)
              : (baseGrade.contrast    ?? 0),
            saturation:  clip.colorGrade
              ? ((existing.saturation  ?? 1) * 0.5 + (baseGrade.saturation  ?? 1) * 0.5)
              : (baseGrade.saturation  ?? 1),
          },
        };
      });

      return {
        ...state,
        project: {
          ...state.project,
          sequence: { ...state.project.sequence, clips: newClips },
        },
      };
    }));
  },

  normalizeAudioLevels: async (targetDb) => {
    // Measure each audio clip's integrated loudness (EBU R128) over the range
    // it actually uses, then set its gain so it lands on the target.
    const measure = typeof window !== "undefined" ? window.editorApi?.measureLoudness : undefined;
    const { project } = get();
    const segs = buildTimelineSegments(project.sequence, project.assets).filter(
      (s) => s.track.kind === "audio" && s.asset.hasAudio && !!s.asset.sourcePath
    );
    if (!measure || segs.length === 0) return;
    const gains = new Map<string, number>();
    const queue = [...segs];
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const r = await measure({
          filePath: s.asset.sourcePath,
          startSeconds: s.sourceInSeconds,
          durationSeconds: Math.max(0.1, s.sourceOutSeconds - s.sourceInSeconds),
        }).catch(() => null);
        const lufs = r?.integratedLufs;
        if (typeof lufs === "number" && lufs > -70) {
          gains.set(s.clip.id, Math.max(0, Math.min(4, Math.pow(10, (targetDb - lufs) / 20))));
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (gains.size === 0) return;
    set(withUndo(`Normalize Audio to ${targetDb} LUFS`, (state) => ({
      ...state,
      project: {
        ...state.project,
        sequence: {
          ...state.project.sequence,
          clips: state.project.sequence.clips.map((c) =>
            gains.has(c.id) ? { ...c, volume: Number(gains.get(c.id)!.toFixed(3)) } : c
          ),
        },
      },
    })));
  },

  // ── Media Bins ───────────────────────────────────────────────────────────────
  createBin: (name, parentId, smart) => {
    const id = `bin_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    set((state) => ({
      project: {
        ...state.project,
        bins: [...(state.project.bins ?? []), { id, name, parentId, ...(smart ? { smart } : {}) }],
      },
    }));
    return id;
  },

  renameBin: (binId, name) => {
    set((state) => ({
      project: {
        ...state.project,
        bins: (state.project.bins ?? []).map((b) => b.id === binId ? { ...b, name } : b),
      },
    }));
  },

  deleteBin: (binId) => {
    set((state) => {
      // Remove bin and un-assign any assets in it
      const assetBins = { ...(state.project.assetBins ?? {}) };
      Object.keys(assetBins).forEach((aid) => { if (assetBins[aid] === binId) delete assetBins[aid]; });
      return {
        project: {
          ...state.project,
          bins: (state.project.bins ?? []).filter((b) => b.id !== binId && b.parentId !== binId),
          assetBins,
        },
      };
    });
  },

  moveAssetToBin: (assetId, binId) => {
    set((state) => {
      const assetBins = { ...(state.project.assetBins ?? {}) };
      if (binId === null) { delete assetBins[assetId]; } else { assetBins[assetId] = binId; }
      return { project: { ...state.project, assetBins } };
    });
  },

  closeAllGaps: () => {
    set(withUndo("Close All Gaps", (state) => {
      // Remove only time that's empty on every track, and ripple all unlocked
      // tracks together so linked audio and layered clips keep their sync.
      const seq = state.project.sequence;
      const spans = buildTimelineSegments(seq, state.project.assets)
        .map((g) => [g.startFrame, g.endFrame] as const)
        .sort((a, b) => a[0] - b[0]);
      if (spans.length === 0) return state;
      const gaps: Array<[number, number]> = [];
      let covered = 0;
      for (const [start, end] of spans) {
        if (start > covered) gaps.push([covered, start]);
        covered = Math.max(covered, end);
      }
      if (gaps.length === 0) return state;
      const locked = new Set(seq.tracks.filter((t) => t.locked).map((t) => t.id));
      const removedBefore = (frame: number) =>
        gaps.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, frame) - a), 0);
      return {
        ...state,
        project: {
          ...state.project,
          sequence: {
            ...seq,
            clips: seq.clips.map((c) => locked.has(c.trackId) ? c : { ...c, startFrame: c.startFrame - removedBefore(c.startFrame) }),
          },
        },
      };
    }));
  },

  syncMulticamClips: (clipIds, offsetsSeconds) => {
    set(withUndo("Sync Multicam by Audio", (state) => {
      // No-op if empty arrays to avoid Math.min(...[]) = Infinity
      if (!clipIds || clipIds.length === 0 || !offsetsSeconds || offsetsSeconds.length === 0) return state;

      const fps = state.project.sequence.settings.fps;
      // Normalize so the earliest clip doesn't go negative
      const minOffset = offsetsSeconds.length > 0 ? Math.min(...offsetsSeconds) : 0;
      const normalizedOffsets = offsetsSeconds.map(o => o - minOffset);
      // Each angle's linked partners (its audio) move with it.
      const deltaById = new Map<string, number>();
      clipIds.forEach((id, idx) => {
        const d = Math.round((normalizedOffsets[idx] ?? 0) * fps);
        for (const c of getLinkedClips(state.project, id)) if (!deltaById.has(c.id) || c.id === id) deltaById.set(c.id, d);
      });
      const newClips = state.project.sequence.clips.map(c => {
        const deltaFrames = deltaById.get(c.id);
        if (deltaFrames === undefined) return c;
        return { ...c, startFrame: Math.max(0, c.startFrame + deltaFrames) };
      });
      return {
        ...state,
        project: {
          ...state.project,
          sequence: { ...state.project.sequence, clips: newClips },
        },
      };
    }));
  },

  patchAsset: (assetId, updates) => {
    set((state) => ({
      project: {
        ...state.project,
        assets: state.project.assets.map((a) =>
          a.id === assetId ? { ...a, ...updates } : a
        ),
      },
    }));
  },
}));
