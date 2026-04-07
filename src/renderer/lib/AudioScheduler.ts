/**
 * AudioScheduler
 * ─────────────────────────────────────────────────────────────────────────────
 * Pre-loads audio assets and schedules playback using the Web Audio API.
 * Applies 40 ms fade-in/out to every buffer start/end to eliminate clicks and
 * pops that occur when cutting raw PCM at a non-zero amplitude.
 *
 * Usage (one-shot, used by FlowState panel):
 *   const scheduler = new AudioScheduler();
 *   await scheduler.preload([asset1, asset2]);
 *   scheduler.play(asset, startOffsetSec, playbackRate);
 *   scheduler.pause();
 *   scheduler.stop();
 *   scheduler.dispose();
 */

import type { MediaAsset } from "../../shared/models";
import type { TimelineSegment } from "../../shared/timeline";

// ── AudioScheduler (one-shot, for FlowState panel) ───────────────────────────

// 40 ms crossfade applied to start and end of every scheduled buffer
// (was 3 ms — too short for seamless clip-to-clip crossfade; 40 ms is inaudible but pop-free)
const FADE_DURATION_S = 0.04;

interface ScheduledSource {
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  assetId: string;
}

export class AudioScheduler {
  private ctx: AudioContext | null = null;
  private bufferCache = new Map<string, AudioBuffer>();
  private activeSources: ScheduledSource[] = [];
  private masterGain: GainNode | null = null;

  // ── Lazy AudioContext initialisation ────────────────────────────────────────
  private getCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  // ── Preload a list of assets into AudioBuffers ───────────────────────────────
  async preload(assets: MediaAsset[]): Promise<void> {
    const ctx = this.getCtx();
    await Promise.all(
      assets
        .filter((a) => a.hasAudio && a.previewUrl && !this.bufferCache.has(a.id))
        .map(async (asset) => {
          try {
            const response = await fetch(asset.previewUrl);
            if (!response.ok) return;
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            this.bufferCache.set(asset.id, audioBuffer);
          } catch {
            // Silently skip assets that can't be decoded (video-only, etc.)
          }
        })
    );
  }

  // ── Play a single asset starting at sourceOffsetSec ─────────────────────────
  play(
    asset: MediaAsset,
    sourceOffsetSec: number,
    playbackRate = 1,
    volume = 1
  ): void {
    const ctx = this.getCtx();
    if (ctx.state === "suspended") void ctx.resume();

    const buffer = this.bufferCache.get(asset.id);
    if (!buffer) return;

    const clampedOffset = Math.max(
      0,
      Math.min(sourceOffsetSec, buffer.duration - FADE_DURATION_S)
    );

    // Per-source gain node (for fade-in/out)
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(
      Math.max(0, Math.min(2, volume)),
      ctx.currentTime + FADE_DURATION_S
    );
    gainNode.connect(this.masterGain ?? ctx.destination);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.25, Math.min(4, playbackRate));
    source.connect(gainNode);
    source.start(ctx.currentTime, clampedOffset);

    const scheduled: ScheduledSource = { source, gainNode, assetId: asset.id };
    this.activeSources.push(scheduled);

    // Clean up reference when source naturally ends
    source.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== scheduled);
    };
  }

  // ── Stop all active sources with 40 ms fade-out ──────────────────────────────
  stop(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const { source, gainNode } of this.activeSources) {
      try {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0, now + FADE_DURATION_S);
        source.stop(now + FADE_DURATION_S + 0.001);
      } catch {
        // Already stopped
      }
    }
    this.activeSources = [];
  }

  // ── Suspend (pause) the AudioContext ────────────────────────────────────────
  async pause(): Promise<void> {
    this.stop();
    if (this.ctx && this.ctx.state === "running") {
      await this.ctx.suspend();
    }
  }

  // ── Resume after pause ───────────────────────────────────────────────────────
  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  // ── Set master volume (0–2) ──────────────────────────────────────────────────
  setMasterVolume(volume: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(2, volume));
    }
  }

  // ── Fully release all resources ──────────────────────────────────────────────
  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.masterGain = null;
    this.bufferCache.clear();
    this.activeSources = [];
  }

  // ── Is a buffer cached for this asset? ──────────────────────────────────────
  isLoaded(assetId: string): boolean {
    return this.bufferCache.has(assetId);
  }
}

// ── AudioEngine (sample-accurate multi-track, for useMultiTrackAudio) ─────────

/**
 * AudioEngine
 * ─────────────────────────────────────────────────────────────────────────────
 * Sample-accurate multi-track audio playback using AudioBufferSourceNode.
 *
 * Key principle: decode each source file ONCE into an AudioBuffer, then
 * schedule playback with start(when, offset, duration) — no seek latency,
 * no HTMLMediaElement, no gaps at seams.
 *
 * Because AudioBufferSourceNode is fire-and-forget (single-use), "seeking"
 * means: stop all running nodes, create fresh nodes, call start() with the
 * new offset. Since buffers are already decoded this is instantaneous.
 */

/** Latency budget (seconds) given to the Web Audio scheduler before playback
 *  begins. 15 ms ensures all source.start() calls are committed before the
 *  first sample plays — gives sample-accurate simultaneous multi-track start. */
const START_LATENCY = 0.015;

/** Short fade applied at stop/seek to prevent DC-offset click (5 ms). */
const STOP_FADE_S = 0.005;

interface ActiveSource {
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  trackGainNode: GainNode;
}

export interface PlayParams {
  segments: TimelineSegment[];
  playheadFrame: number;
  fps: number;
  /** If true, skip the START_LATENCY offset (seam resume — buffers already hot). */
  seamResume?: boolean;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  /** URL → decoded AudioBuffer. Persistent across play/pause/seek cycles. */
  private bufferCache = new Map<string, AudioBuffer>();

  /** Currently scheduled AudioBufferSourceNodes, keyed by clip ID. */
  private activeSources = new Map<string, ActiveSource>();

  /** Per-track gain nodes, keyed by track ID. */
  private trackGains = new Map<string, GainNode>();

  // ── Lazy AudioContext ──────────────────────────────────────────────────────
  private getCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private getMasterGain(ctx: AudioContext): GainNode {
    if (!this.masterGain) {
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(ctx.destination);
    }
    return this.masterGain;
  }

  private getTrackGain(ctx: AudioContext, trackId: string): GainNode {
    let tg = this.trackGains.get(trackId);
    if (!tg) {
      tg = ctx.createGain();
      tg.gain.value = 1;
      tg.connect(this.getMasterGain(ctx));
      this.trackGains.set(trackId, tg);
    }
    return tg;
  }

  // ── Preload ────────────────────────────────────────────────────────────────
  /** Decode all segments not yet in the buffer cache, in parallel. */
  async preload(segments: TimelineSegment[]): Promise<void> {
    const ctx = this.getCtx();
    await Promise.all(
      segments
        .filter((seg) => {
          const url = seg.asset?.previewUrl;
          return url && !this.bufferCache.has(url);
        })
        .map(async (seg) => {
          const url = seg.asset?.previewUrl;
          if (!url) return;
          try {
            const response = await fetch(url);
            if (!response.ok) return;
            const ab = await response.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(ab);
            this.bufferCache.set(url, audioBuffer);
          } catch {
            // Silently skip — no audio track or decode error
          }
        })
    );
  }

  // ── Play ───────────────────────────────────────────────────────────────────
  /**
   * Stop any active nodes and immediately schedule all segments with
   * sample-accurate timing anchored to AudioContext.currentTime.
   */
  play(params: PlayParams): void {
    const { segments, playheadFrame, fps, seamResume = false } = params;
    const ctx = this.getCtx();
    if (ctx.state === "suspended") void ctx.resume();

    // Stop existing nodes with a micro-fade to prevent click.
    // New nodes must start AFTER the old ones have stopped to prevent
    // double-play. Use the stop-fade duration as the scheduling offset.
    const stopFade = this.activeSources.size > 0 ? STOP_FADE_S : 0;
    this._stopAll(ctx, stopFade);

    // Schedule new nodes to start after the outgoing fade completes.
    const latency = seamResume ? stopFade + 0.001 : START_LATENCY;
    const startAt = ctx.currentTime + latency;

    for (const seg of segments) {
      const url = seg.asset?.previewUrl;
      if (!url) continue;

      const buffer = this.bufferCache.get(url);
      if (!buffer) continue; // not yet decoded — preload() should have been called

      const clipSpeed = Math.max(0.25, Math.min(4, seg.clip.speed ?? 1));
      const trackMuted = seg.track.muted ?? false;
      const clipVol = Math.max(0, seg.clip.volume ?? 1);
      const effectiveGain = Math.min(2, trackMuted ? 0 : clipVol);

      // Where in the source file to begin reading
      const playheadOffset = Math.max(0, playheadFrame - seg.startFrame);
      const sourceOffset = seg.sourceInSeconds + (playheadOffset / fps) * clipSpeed;

      // How many seconds of source to play (clip end minus playhead position)
      const remainingFrames = seg.endFrame - Math.max(seg.startFrame, playheadFrame);
      const duration = (remainingFrames / fps) / clipSpeed;

      if (duration <= 0) continue;

      // Clamp sourceOffset and duration so they stay within the buffer
      const safeSourceOffset = Math.max(0, Math.min(sourceOffset, buffer.duration - 0.001));
      const maxDuration = buffer.duration - safeSourceOffset;
      const safeDuration = Math.max(0, Math.min(duration, maxDuration));

      if (safeDuration <= 0) continue;

      // Per-clip gain (for fade and volume)
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, startAt);
      gainNode.gain.linearRampToValueAtTime(effectiveGain, startAt + STOP_FADE_S);

      // Per-track gain node (for track-level volume control)
      const trackGainNode = this.getTrackGain(ctx, seg.track.id);

      gainNode.connect(trackGainNode);

      // AudioBufferSourceNode is single-use — always create a new one
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = clipSpeed;
      source.connect(gainNode);
      source.start(startAt, safeSourceOffset, safeDuration);

      const clipId = seg.clip.id;
      const entry: ActiveSource = { source, gainNode, trackGainNode };
      this.activeSources.set(clipId, entry);

      source.onended = () => {
        this.activeSources.delete(clipId);
      };
    }
  }

  // ── Stop ───────────────────────────────────────────────────────────────────
  stop(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this._stopAll(ctx, STOP_FADE_S);
  }

  // ── Pause (alias for stop — AudioBufferSourceNode has no pause) ─────────────
  pause(): void {
    this.stop();
  }

  // ── Volume control ────────────────────────────────────────────────────────
  setTrackVolume(trackId: string, vol: number): void {
    const tg = this.trackGains.get(trackId);
    if (tg) tg.gain.value = Math.max(0, Math.min(2, vol));
  }

  setMasterVolume(vol: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(2, vol));
    }
  }

  // ── Query ─────────────────────────────────────────────────────────────────
  isBufferCached(url: string): boolean {
    return this.bufferCache.has(url);
  }

  // ── Dispose ───────────────────────────────────────────────────────────────
  dispose(): void {
    this.stop();
    // Small delay to let the stop fade complete before closing context
    const ctx = this.ctx;
    if (ctx) {
      window.setTimeout(() => {
        void ctx.close();
      }, Math.ceil((STOP_FADE_S + 0.002) * 1000));
    }
    this.ctx = null;
    this.masterGain = null;
    this.trackGains.clear();
    this.bufferCache.clear();
    this.activeSources.clear();
  }

  // ── Internal helpers ───────────────────────────────────────────────────────
  private _stopAll(ctx: AudioContext, fadeSecs: number): void {
    const now = ctx.currentTime;
    for (const [, { source, gainNode }] of this.activeSources) {
      try {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0, now + fadeSecs);
        source.stop(now + fadeSecs + 0.001);
      } catch {
        // Already stopped — ignore
      }
    }
    this.activeSources.clear();
  }
}
