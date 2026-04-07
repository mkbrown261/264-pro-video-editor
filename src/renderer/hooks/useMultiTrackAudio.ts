/**
 * useMultiTrackAudio
 * ─────────────────────────────────────────────────────────────────────────────
 * Sample-accurate multi-track audio engine using AudioBufferSourceNode.
 *
 * Architecture
 * ────────────
 *   Each source file (identified by its previewUrl) is decoded ONCE into an
 *   AudioBuffer and cached permanently in the AudioEngine.  Playback is
 *   scheduled via:
 *
 *     source.start(audioCtx.currentTime + latency, sourceOffset, duration)
 *
 *   This is the same mechanism used by DAWs and professional audio software.
 *   It is SAMPLE-ACCURATE — the latency is deterministic (15 ms for fresh
 *   play; 0 ms at seams) and there is no HTMLMediaElement seek pipeline.
 *
 * Seam design
 * ───────────
 *   When the playhead crosses a clip seam, `audioSegKey` changes and the
 *   seam effect fires:
 *     1. engine.stop()  — micro-fade (5 ms) the outgoing nodes
 *     2. engine.play()  — instantly schedule new nodes (seamResume=true,
 *        so latency=0; buffers are already decoded)
 *
 *   The result: ≤5 ms quiet gap at the seam, vs 30–150 ms with HTMLMediaElement.
 *
 * Lookahead
 * ─────────
 *   While playing, any segment within 5 seconds of the playhead is preloaded
 *   (decoded into the cache) so the buffer is always hot at the seam.
 */

import { useEffect, useRef } from "react";
import type { TimelineSegment } from "../../shared/timeline";
import { AudioEngine } from "../lib/AudioScheduler";

// ── constants ─────────────────────────────────────────────────────────────────
/** Lookahead window: segments starting within this many frames get preloaded. */
const LOOKAHEAD_FRAMES = 150; // ~5 s at 30 fps

// ── hook interface ─────────────────────────────────────────────────────────────
export interface MultiTrackAudioOptions {
  /** All enabled audio segments that currently overlap the playhead. */
  activeAudioSegments: TimelineSegment[];
  /** All segments in the sequence (for lookahead preload). */
  allSegments?: TimelineSegment[];
  isPlaying: boolean;
  playheadFrame: number;
  sequenceFps: number;
}

export function useMultiTrackAudio({
  activeAudioSegments,
  allSegments,
  isPlaying,
  playheadFrame,
  sequenceFps,
}: MultiTrackAudioOptions): {
  startAudio: (frame: number) => Promise<void>;
  stopAudio: () => void;
  pauseAudio: () => void;
} {
  // One AudioEngine instance, never recreated.
  const engineRef = useRef<AudioEngine | null>(null);

  function getEngine(): AudioEngine {
    if (!engineRef.current) {
      engineRef.current = new AudioEngine();
    }
    return engineRef.current;
  }

  // Keep a ref of latest props so effects / callbacks always see current values
  // without creating stale-closure bugs.
  const stateRef = useRef({ activeAudioSegments, allSegments, isPlaying, playheadFrame, sequenceFps });
  useEffect(() => {
    stateRef.current = { activeAudioSegments, allSegments, isPlaying, playheadFrame, sequenceFps };
  });

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Called by usePlaybackController when the user hits play. */
  async function startAudio(frame: number): Promise<void> {
    const { activeAudioSegments: segs, sequenceFps: fps } = stateRef.current;
    const engine = getEngine();

    // Preload any segments not yet decoded (fast-path: already in cache = no-op)
    await engine.preload(segs);

    engine.play({ segments: segs, playheadFrame: frame, fps, seamResume: false });
  }

  /** Called on pause — stops all nodes with micro-fade. */
  function pauseAudio(): void {
    getEngine().pause();
  }

  /** Called on stop (alias for pause in this engine). */
  function stopAudio(): void {
    getEngine().stop();
  }

  // ── Lookahead preload effect ────────────────────────────────────────────────
  // Fires every frame while playing. Decodes upcoming segments in the
  // background so buffers are hot before the seam arrives.
  useEffect(() => {
    if (!isPlaying) return;

    const segs = allSegments ?? stateRef.current.allSegments ?? [];
    const engine = getEngine();

    const upcoming = segs.filter((seg) => {
      if (seg.track.kind !== "audio") return false;
      if (!seg.clip.isEnabled || seg.track.muted) return false;
      // Already past or active — skip
      if (playheadFrame >= seg.endFrame) return false;
      // Already active — no need to "lookahead" preload (play() handles it)
      if (playheadFrame >= seg.startFrame) return false;

      const framesUntilStart = seg.startFrame - playheadFrame;
      return framesUntilStart > 0 && framesUntilStart <= LOOKAHEAD_FRAMES;
    });

    if (upcoming.length > 0) {
      void engine.preload(upcoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, playheadFrame, sequenceFps]);

  // ── Seam / segment-change effect ────────────────────────────────────────────
  // `audioSegKey` encodes the identity + parameters of every active audio
  // segment.  When it changes while playing (clip seam crossed, or a clip
  // parameter changed), we stop the old nodes and immediately re-schedule
  // new ones — no seek latency because buffers are already in cache.
  const audioSegKey = activeAudioSegments
    .map(
      (s) =>
        `${s.clip.id}:${s.startFrame}:${(s.clip.volume ?? 1).toFixed(3)}:${(s.clip.speed ?? 1).toFixed(3)}:${s.track.muted ? 1 : 0}`
    )
    .join(",");

  useEffect(() => {
    const {
      activeAudioSegments: segs,
      playheadFrame: frame,
      sequenceFps: fps,
      isPlaying: playing,
    } = stateRef.current;

    if (!playing) return;

    const engine = getEngine();

    // Preload synchronously (returns immediately if already cached) then play.
    // We do NOT await here — if a buffer somehow isn't cached yet, play() will
    // silently skip that segment and the lookahead will catch up.
    void engine.preload(segs).then(() => {
      if (!stateRef.current.isPlaying) return; // stopped while preloading
      engine.play({
        segments: segs,
        playheadFrame: frame,
        fps,
        seamResume: true, // 0 ms latency — buffers are hot
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, audioSegKey]);

  // ── Scrub sync (when NOT playing) ──────────────────────────────────────────
  // When the user scrubs while paused, stop any residual nodes.
  useEffect(() => {
    if (isPlaying) return;
    getEngine().stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, playheadFrame]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  return { startAudio, stopAudio, pauseAudio };
}

/**
 * findAllActiveAudioSegments
 * Returns ALL enabled, non-muted audio segments that overlap the playhead.
 * Solo semantics: if ANY track has solo=true, only return segments from solo tracks.
 */
export function findAllActiveAudioSegments(
  segments: TimelineSegment[],
  playheadFrame: number
): TimelineSegment[] {
  const audioSegs = segments.filter(
    (s) =>
      s.track.kind === "audio" &&
      s.clip.isEnabled &&
      !s.track.muted &&
      playheadFrame >= s.startFrame &&
      playheadFrame < s.endFrame
  );

  const hasSolo = segments.some((s) => s.track.kind === "audio" && s.track.solo);
  if (hasSolo) return audioSegs.filter((s) => s.track.solo);
  return audioSegs;
}
