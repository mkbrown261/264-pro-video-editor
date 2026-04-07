/**
 * AudioScheduler
 * ─────────────────────────────────────────────────────────────────────────────
 * Pre-loads audio assets and schedules playback using the Web Audio API.
 * Applies 3 ms fade-in/out to every buffer start/end to eliminate clicks and
 * pops that occur when cutting raw PCM at a non-zero amplitude.
 *
 * Usage
 * ─────
 *   const scheduler = new AudioScheduler();
 *   await scheduler.preload([asset1, asset2]);
 *   scheduler.play(asset, startOffsetSec, playbackRate);
 *   scheduler.pause();
 *   scheduler.stop();
 *   scheduler.dispose();
 */

import type { MediaAsset } from "../../shared/models";

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

  // ── Stop all active sources with 3 ms fade-out ──────────────────────────────
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
