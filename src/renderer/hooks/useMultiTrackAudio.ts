/**
 * useMultiTrackAudio
 * -----------------------------------------------------------------------------
 * Sample-accurate multi-track audio engine using AudioBufferSourceNode.
 *
 * Each source file is decoded ONCE into an AudioBuffer and cached.
 * Playback is scheduled via:
 *   source.start(audioCtx.currentTime + latency, sourceOffset, duration)
 *
 * This is sample-accurate with zero seek latency. Seams are handled by
 * stopping old nodes and immediately starting new ones from the cached buffer.
 *
 * CRITICAL DESIGN:
 *   startAudio()  -- called by usePlaybackController on play press.
 *                    Owns the initial scheduling. Sets lastPlayedKeyRef
 *                    so the seam effect does NOT double-fire on the same frame.
 *
 *   seam effect   -- fires ONLY on audioSegKey change (clip boundary crossed).
 *                    Skips if audioSegKey matches lastPlayedKeyRef (already
 *                    handled by startAudio on this render cycle).
 *                    Does NOT depend on isPlaying -- isPlaying is checked from
 *                    stateRef to avoid the effect re-firing on play/pause.
 */

import { useEffect, useRef } from "react";
import type { TimelineSegment } from "../../shared/timeline";
import { AudioEngine } from "../lib/AudioScheduler";

const LOOKAHEAD_FRAMES = 150; // ~5 s at 30 fps

export interface MultiTrackAudioOptions {
  activeAudioSegments: TimelineSegment[];
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
  const engineRef = useRef<AudioEngine | null>(null);

  // The audioSegKey that was most recently scheduled via startAudio or the seam
  // effect. Used to prevent double-play when both change on the same render.
  const lastPlayedKeyRef = useRef<string>("");

  function getEngine(): AudioEngine {
    if (!engineRef.current) engineRef.current = new AudioEngine();
    return engineRef.current;
  }

  // Always-current snapshot of props for use inside async callbacks.
  const stateRef = useRef({ activeAudioSegments, allSegments, isPlaying, playheadFrame, sequenceFps });
  useEffect(() => {
    stateRef.current = { activeAudioSegments, allSegments, isPlaying, playheadFrame, sequenceFps };
  });

  // --------------------------------------------------------------------------
  // Public API (called by usePlaybackController)
  // --------------------------------------------------------------------------

  async function startAudio(frame: number): Promise<void> {
    const { activeAudioSegments: segs, sequenceFps: fps } = stateRef.current;
    const engine = getEngine();

    // Mark this key BEFORE the async decode so the seam effect never
    // double-fires even if the decode takes a while.
    const key = segs
      .map((s) => `${s.clip.id}:${s.startFrame}:${(s.clip.volume ?? 1).toFixed(3)}:${(s.clip.speed ?? 1).toFixed(3)}:${s.track.muted ? 1 : 0}`)
      .join(",");
    lastPlayedKeyRef.current = key;

    // Decode any uncached buffers (fast-path if already cached by lookahead).
    await engine.preload(segs);

    // NOTE: do NOT check isPlaying here. usePlaybackController calls startAudio
    // and then sets isPlaying=true — so isPlaying is still false at this point
    // by design. Just check that the key hasn't been invalidated (e.g. user
    // paused AND scrubbed to a different position while we were decoding).
    if (key !== lastPlayedKeyRef.current) return;

    engine.play({ segments: segs, playheadFrame: frame, fps, seamResume: false });
  }

  function pauseAudio(): void {
    getEngine().pause();
  }

  function stopAudio(): void {
    getEngine().stop();
  }

  // --------------------------------------------------------------------------
  // Lookahead preload effect
  // Fires every frame while playing. Decodes upcoming segments so buffers
  // are hot before the seam arrives.
  // --------------------------------------------------------------------------
  useEffect(() => {
    // Preload while playing (lookahead) AND while paused/scrubbing
    // so that buffers are hot before the user hits play.
    const segs = allSegments ?? stateRef.current.allSegments ?? [];
    const engine = getEngine();

    const upcoming = segs.filter((seg) => {
      if (seg.track.kind !== "audio") return false;
      if (!seg.clip.isEnabled || seg.track.muted) return false;
      if (playheadFrame >= seg.endFrame) return false;
      // Include active segments too — keeps cache warm for startAudio
      if (playheadFrame >= seg.startFrame) return true;
      const framesUntil = seg.startFrame - playheadFrame;
      return framesUntil > 0 && framesUntil <= LOOKAHEAD_FRAMES;
    });

    if (upcoming.length > 0) void engine.preload(upcoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, playheadFrame, sequenceFps]);

  // --------------------------------------------------------------------------
  // Seam effect
  // Fires when the set of active audio segments changes (clip boundary crossed
  // or a parameter like volume/speed changed mid-play).
  //
  // Does NOT include isPlaying in deps -- we only want this to fire when the
  // SEGMENTS change, not when play/pause toggles (startAudio handles that).
  // --------------------------------------------------------------------------
  const audioSegKey = activeAudioSegments
    .map(
      (s) =>
        `${s.clip.id}:${s.startFrame}:${(s.clip.volume ?? 1).toFixed(3)}:${(s.clip.speed ?? 1).toFixed(3)}:${s.track.muted ? 1 : 0}`
    )
    .join(",");

  useEffect(() => {
    // Not playing -- nothing to do.
    if (!stateRef.current.isPlaying) return;

    // startAudio already handled this exact key on this render cycle -- skip.
    if (audioSegKey === lastPlayedKeyRef.current) return;
    lastPlayedKeyRef.current = audioSegKey;

    const {
      activeAudioSegments: segs,
      playheadFrame: frame,
      sequenceFps: fps,
    } = stateRef.current;

    const engine = getEngine();

    // Preload (instant if already cached) then reschedule.
    void engine.preload(segs).then(() => {
      if (!stateRef.current.isPlaying) return; // paused while preloading
      if (audioSegKey !== lastPlayedKeyRef.current) return; // key changed again
      engine.play({ segments: segs, playheadFrame: frame, fps, seamResume: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioSegKey]);

  // --------------------------------------------------------------------------
  // Scrub sync (NOT playing)
  // Stop residual nodes when the user scrubs while paused.
  // Only fires on playheadFrame changes, not on every isPlaying toggle,
  // so it does not kill audio that startAudio just scheduled.
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (isPlaying) return;
    getEngine().stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, playheadFrame]);

  // --------------------------------------------------------------------------
  // Cleanup on unmount
  // --------------------------------------------------------------------------
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
