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

  private getCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

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
            // Silently skip assets that can't be decoded
          }
        })
    );
  }

  play(asset: MediaAsset, sourceOffsetSec: number, playbackRate = 1, volume = 1): void {
    const ctx = this.getCtx();
    if (ctx.state === "suspended") void ctx.resume();
    const buffer = this.bufferCache.get(asset.id);
    if (!buffer) return;
    const clampedOffset = Math.max(0, Math.min(sourceOffsetSec, buffer.duration - FADE_DURATION_S));
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(Math.max(0, Math.min(2, volume)), ctx.currentTime + FADE_DURATION_S);
    gainNode.connect(this.masterGain ?? ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.25, Math.min(4, playbackRate));
    source.connect(gainNode);
    source.start(ctx.currentTime, clampedOffset);
    const scheduled: ScheduledSource = { source, gainNode, assetId: asset.id };
    this.activeSources.push(scheduled);
    source.onended = () => { this.activeSources = this.activeSources.filter((s) => s !== scheduled); };
  }

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
      } catch { /* already stopped */ }
    }
    this.activeSources = [];
  }

  async pause(): Promise<void> {
    this.stop();
    if (this.ctx && this.ctx.state === "running") await this.ctx.suspend();
  }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume();
  }

  setMasterVolume(volume: number): void {
    if (this.masterGain) this.masterGain.gain.value = Math.max(0, Math.min(2, volume));
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.masterGain = null;
    this.bufferCache.clear();
    this.activeSources = [];
  }

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
 * STOP SAFETY:
 *   activeSources is keyed by a monotonic nodeId (not clipId). This ensures
 *   that when a clip is replaced at a seam, the OLD node's onended callback
 *   cannot accidentally delete the NEW node from the map. _stopAll() snapshots
 *   the map and clears it before iterating, so stop() always captures every
 *   node that was active at the moment stop was called.
 *
 * SEAM CROSSFADE (no gap, no stutter):
 *   At a seam, old nodes fade out over XFADE_S while new nodes fade IN over
 *   the same window. Both happen simultaneously starting at ctx.currentTime.
 *   There is no silent gap between them.
 *
 * STOP = IMMEDIATE:
 *   stop()/pause() set gain to 0 and call source.stop() with no future offset.
 *   source.stop(when) uses max(when, scheduledStartTime) so even nodes that
 *   haven't started yet are correctly terminated.
 */

/** Budget (s) given to Web Audio scheduler at play-start. 15ms ensures all
 *  source.start() calls are committed before the first sample plays. */
const START_LATENCY = 0.015;

/** Crossfade duration at seams (s). Long enough to be click-free, short
 *  enough to be inaudible as a transition. 8ms is the sweet spot. */
const XFADE_S = 0.008;

/** Stop fade on explicit stop/pause (s). Must be > 0 to avoid DC-offset click,
 *  but as short as possible so audio feels instant. */
const STOP_FADE_S = 0.004;

// Monotonically increasing ID for each scheduled node — never reuse clipId.
let _nodeIdCounter = 0;

interface ActiveSource {
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  /** AudioContext time when source.start() was scheduled */
  scheduledAt: number;
}

export interface PlayParams {
  segments: TimelineSegment[];
  playheadFrame: number;
  fps: number;
  /** true = seam crossfade (simultaneous fade-out/fade-in, no gap) */
  seamResume?: boolean;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  /** URL → decoded AudioBuffer. Persistent across play/pause/seek cycles. */
  private bufferCache = new Map<string, AudioBuffer>();

  /** URLs currently being fetched — prevents duplicate in-flight downloads. */
  private pendingFetches = new Set<string>();

  /** nodeId → active source. Monotonic IDs prevent onended cross-deletion. */
  private activeSources = new Map<number, ActiveSource>();

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
  async preload(segments: TimelineSegment[]): Promise<void> {
    const ctx = this.getCtx();
    await Promise.all(
      segments
        .filter((seg) => {
          const url = seg.asset?.previewUrl;
          if (!url) return false;
          if (this.bufferCache.has(url)) return false;
          if (this.pendingFetches.has(url)) return false;
          return true;
        })
        .map(async (seg) => {
          const url = seg.asset?.previewUrl;
          if (!url) return;
          this.pendingFetches.add(url);
          try {
            const response = await fetch(url);
            if (!response.ok) return;
            const ab = await response.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(ab);
            this.bufferCache.set(url, audioBuffer);
          } catch {
            // No audio track or decode error — skip silently
          } finally {
            this.pendingFetches.delete(url);
          }
        })
    );
  }

  // ── Play ───────────────────────────────────────────────────────────────────
  play(params: PlayParams): void {
    const { segments, playheadFrame, fps, seamResume = false } = params;
    const ctx = this.getCtx();
    if (ctx.state === "suspended") void ctx.resume();

    const now = ctx.currentTime;

    if (seamResume) {
      // CROSSFADE: fade out existing nodes over XFADE_S while new nodes
      // fade in over the same window. No gap, no silence, no stutter.
      this._fadeOutAll(ctx, now, XFADE_S);
      // New nodes start immediately (at now) and fade in over XFADE_S.
      this._scheduleNodes(ctx, segments, playheadFrame, fps, now, XFADE_S);
    } else {
      // HARD START: stop existing nodes immediately, start new ones after
      // a small latency budget to ensure all start() calls are committed.
      this._stopAll(ctx, now, STOP_FADE_S);
      this._scheduleNodes(ctx, segments, playheadFrame, fps, now + START_LATENCY, STOP_FADE_S);
    }
  }

  // ── Stop ───────────────────────────────────────────────────────────────────
  stop(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    // Snapshot first, clear immediately — so nothing can add to activeSources
    // between the snapshot and the stop calls.
    const snapshot = new Map(this.activeSources);
    this.activeSources.clear();
    for (const [, { source, gainNode, scheduledAt }] of snapshot) {
      try {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0, now + STOP_FADE_S);
        // Stop after the fade, but never before the node has started.
        // If scheduledAt is in the future, stop shortly after it would start.
        const stopAt = Math.max(scheduledAt, now) + STOP_FADE_S + 0.001;
        source.stop(stopAt);
      } catch { /* already stopped */ }
    }
  }

  // ── Pause (same as stop for AudioBufferSourceNode) ────────────────────────
  pause(): void {
    this.stop();
  }

  // ── Volume ────────────────────────────────────────────────────────────────
  setTrackVolume(trackId: string, vol: number): void {
    const tg = this.trackGains.get(trackId);
    if (tg) tg.gain.value = Math.max(0, Math.min(2, vol));
  }

  setMasterVolume(vol: number): void {
    if (this.masterGain) this.masterGain.gain.value = Math.max(0, Math.min(2, vol));
  }

  isBufferCached(url: string): boolean {
    return this.bufferCache.has(url);
  }

  // ── Dispose ───────────────────────────────────────────────────────────────
  dispose(): void {
    this.stop();
    const ctx = this.ctx;
    if (ctx) {
      window.setTimeout(() => void ctx.close(), Math.ceil((STOP_FADE_S + 0.01) * 1000));
    }
    this.ctx = null;
    this.masterGain = null;
    this.trackGains.clear();
    this.bufferCache.clear();
    this.activeSources.clear();
    this.pendingFetches.clear();
  }

  // ── Internal: schedule new nodes ─────────────────────────────────────────
  private _scheduleNodes(
    ctx: AudioContext,
    segments: TimelineSegment[],
    playheadFrame: number,
    fps: number,
    startAt: number,
    fadeInSecs: number
  ): void {
    for (const seg of segments) {
      const url = seg.asset?.previewUrl;
      if (!url) continue;
      const buffer = this.bufferCache.get(url);
      if (!buffer) continue;

      const clipSpeed = Math.max(0.25, Math.min(4, seg.clip.speed ?? 1));
      const clipVol = Math.max(0, seg.clip.volume ?? 1);
      const effectiveGain = Math.min(2, (seg.track.muted ?? false) ? 0 : clipVol);

      const playheadOffset = Math.max(0, playheadFrame - seg.startFrame);
      const sourceOffset = seg.sourceInSeconds + (playheadOffset / fps) * clipSpeed;
      const remainingFrames = seg.endFrame - Math.max(seg.startFrame, playheadFrame);
      const duration = (remainingFrames / fps) / clipSpeed;
      if (duration <= 0) continue;

      const safeSourceOffset = Math.max(0, Math.min(sourceOffset, buffer.duration - 0.001));
      const safeDuration = Math.max(0, Math.min(duration, buffer.duration - safeSourceOffset));
      if (safeDuration <= 0) continue;

      // --- Fade-in duration ---
      // Use the larger of: the engine's structural fade-in (click prevention)
      // and the user-set transitionIn duration (converted from frames to seconds).
      const userFadeInFrames = seg.clip.transitionIn?.durationFrames ?? 0;
      // Only apply user fade-in if playhead is at the clip start (not mid-clip resume)
      const atClipStart = playheadFrame <= seg.startFrame;
      const userFadeInSecs = atClipStart ? (userFadeInFrames / fps) / clipSpeed : 0;
      const actualFadeIn = Math.max(fadeInSecs, userFadeInSecs);

      // --- Fade-out duration ---
      const userFadeOutFrames = seg.clip.transitionOut?.durationFrames ?? 0;
      const userFadeOutSecs = (userFadeOutFrames / fps) / clipSpeed;
      // Schedule fade-out: ramp gain to 0 starting at (endAt - fadeOutSecs)
      const endAt = startAt + safeDuration;
      const fadeOutStart = userFadeOutSecs > 0
        ? Math.max(startAt + actualFadeIn + 0.001, endAt - userFadeOutSecs)
        : null;

      // Per-clip gain node
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, startAt);
      gainNode.gain.linearRampToValueAtTime(effectiveGain, startAt + actualFadeIn);
      // Schedule fade-out ramp if user set one
      if (fadeOutStart !== null && userFadeOutSecs > 0) {
        gainNode.gain.setValueAtTime(effectiveGain, fadeOutStart);
        gainNode.gain.linearRampToValueAtTime(0, endAt);
      }
      gainNode.connect(this.getTrackGain(ctx, seg.track.id));

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = clipSpeed;
      source.connect(gainNode);
      source.start(startAt, safeSourceOffset, safeDuration);

      const nodeId = ++_nodeIdCounter;
      const entry: ActiveSource = { source, gainNode, scheduledAt: startAt };
      this.activeSources.set(nodeId, entry);

      // onended uses the monotonic nodeId — never affects a different node
      source.onended = () => { this.activeSources.delete(nodeId); };
    }
  }

  // ── Internal: fade out all active nodes (crossfade path) ─────────────────
  // Does NOT clear activeSources — stop() will handle that.
  // New nodes are added by _scheduleNodes concurrently.
  private _fadeOutAll(ctx: AudioContext, now: number, fadeSecs: number): void {
    const snapshot = new Map(this.activeSources);
    this.activeSources.clear();
    for (const [, { source, gainNode, scheduledAt }] of snapshot) {
      try {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0, now + fadeSecs);
        const stopAt = Math.max(scheduledAt, now) + fadeSecs + 0.001;
        source.stop(stopAt);
      } catch { /* already stopped */ }
    }
  }

  // ── Internal: stop all nodes immediately (hard stop path) ────────────────
  private _stopAll(ctx: AudioContext, now: number, fadeSecs: number): void {
    const snapshot = new Map(this.activeSources);
    this.activeSources.clear();
    for (const [, { source, gainNode, scheduledAt }] of snapshot) {
      try {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0, now + fadeSecs);
        const stopAt = Math.max(scheduledAt, now) + fadeSecs + 0.001;
        source.stop(stopAt);
      } catch { /* already stopped */ }
    }
  }
}
