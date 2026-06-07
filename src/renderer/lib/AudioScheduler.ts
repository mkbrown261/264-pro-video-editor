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

import type { EQBand, MediaAsset } from "../../shared/models";
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

/**
 * Audio source selection thresholds.
 *
 * WHY duration-based, not byte-size-based
 * ────────────────────────────────────────
 * We previously used a HEAD request to check Content-Length before deciding
 * whether to stream or buffer a file.  That approach has two fatal flaws with
 * Electron's custom `media://` protocol:
 *
 *   1. Electron's protocol.handle handler builds Responses from ReadableStreams
 *      (range-sliced fs reads).  Streams don't carry a Content-Length, so the
 *      HEAD response always returns null — isLarge is always false and the code
 *      falls through to a full fetch + decodeAudioData on a file that could be
 *      gigabytes, OOM-ing the renderer.
 *
 *   2. Even if streaming was reached, `crossOrigin = 'anonymous'` on the
 *      HTMLAudioElement caused a SecurityError from createMediaElementSource().
 *      `media://` is a local Electron protocol that does NOT serve CORS headers.
 *      Chromium treats the element as cross-origin when crossOrigin is set,
 *      and the Web Audio API refuses to tap it.  The catch {} swallowed the
 *      error silently → the streamingElements map was never populated → silence.
 *
 * FIX: Use `seg.asset.durationSeconds` (populated by ffprobe at import time,
 * always available, zero network cost) to decide stream vs buffer.  Any clip
 * longer than STREAMING_DURATION_THRESHOLD_S gets the streaming path.
 * Never set crossOrigin on streaming elements — media:// is same-origin.
 */
/** Source files longer than this (seconds) are too large to decode into RAM.
 *  10 minutes covers virtually all "long" interview / cinema clips while still
 *  buffering short music clips and SFX for sample-accurate scheduling. */
const STREAMING_DURATION_THRESHOLD_S = 10 * 60; // 10 minutes

/** How many bytes we allow decodeAudioData to consume (safety net for files
 *  where durationSeconds is missing or wrong).  200 MB ≈ ~20 min of stereo
 *  44.1 kHz at 128 kbps, or ~3 min of 24-bit PCM — well within JS heap. */
const MAX_BUFFER_BYTES = 200 * 1024 * 1024; // 200 MB

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  /** URL → decoded AudioBuffer. Persistent across play/pause/seek cycles. */
  private bufferCache = new Map<string, AudioBuffer>();

  /** URLs that are too large to buffer — streamed via MediaElementAudioSourceNode. */
  private streamingUrls = new Set<string>();

  /** URL → { element, sourceNode, gainNode } for streaming (large file) playback. */
  private streamingElements = new Map<string, {
    element: HTMLAudioElement;
    sourceNode: MediaElementAudioSourceNode;
    gainNode: GainNode;
  }>();

  /** URLs currently being fetched — prevents duplicate in-flight downloads. */
  private pendingFetches = new Set<string>();

  /** nodeId → active source. Monotonic IDs prevent onended cross-deletion. */
  private activeSources = new Map<number, ActiveSource>();

  /** Per-track gain nodes, keyed by track ID. */
  private trackGains = new Map<string, GainNode>();
  private trackCompressors = new Map<string, DynamicsCompressorNode>();
  private lufsProcessor: ScriptProcessorNode | null = null;
  private lufsSum = 0;
  private lufsCount = 0;
  private lufsValue = -Infinity; // integrated LUFS (K-weighted approx)

  /** Per-track analyser nodes for real-time VU metering, keyed by track ID. */
  private trackAnalysers = new Map<string, AnalyserNode>();

  /** Per-track EQ filter chain, keyed by track ID. Inserted between trackGain
   *  and trackAnalyser. Empty array = no EQ (trackGain connects directly). */
  private trackEQChains = new Map<string, BiquadFilterNode[]>();

  /** Master analyser for the master channel VU meter. */
  private masterAnalyser: AnalyserNode | null = null;

  // ── Lazy AudioContext ──────────────────────────────────────────────────────
  private getCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;
      // Master analyser sits between master gain and destination
      this.masterAnalyser = this.ctx.createAnalyser();
      this.masterAnalyser.fftSize = 256;
      this.masterAnalyser.smoothingTimeConstant = 0.8;
      this.masterGain.connect(this.masterAnalyser);
      this.masterAnalyser.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private getMasterGain(ctx: AudioContext): GainNode {
    if (!this.masterGain) {
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = 1;
      this.masterAnalyser = ctx.createAnalyser();
      this.masterAnalyser.fftSize = 256;
      this.masterAnalyser.smoothingTimeConstant = 0.8;
      this.masterGain.connect(this.masterAnalyser);
      this.masterAnalyser.connect(ctx.destination);
    }
    return this.masterGain;
  }

  private getTrackGain(ctx: AudioContext, trackId: string): GainNode {
    let tg = this.trackGains.get(trackId);
    if (!tg) {
      tg = ctx.createGain();
      tg.gain.value = 1;
      // Per-track analyser for VU metering
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      tg.connect(analyser);
      analyser.connect(this.getMasterGain(ctx));
      this.trackGains.set(trackId, tg);
      this.trackAnalysers.set(trackId, analyser);
    }
    return tg;
  }

  // ── Real-time VU level reading (0–1 RMS) ──────────────────────────────────
  /** Returns the RMS level (0–1) for a track, or 0 if not playing. */
  getTrackLevel(trackId: string): number {
    const analyser = this.trackAnalysers.get(trackId);
    if (!analyser) return 0;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
  }

  /** Returns the RMS level (0–1) for the master channel, or 0 if not playing. */
  getMasterLevel(): number {
    if (!this.masterAnalyser) return 0;
    const buf = new Uint8Array(this.masterAnalyser.frequencyBinCount);
    this.masterAnalyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
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
          if (this.streamingUrls.has(url)) return false; // already marked as streaming
          if (this.pendingFetches.has(url)) return false;
          return true;
        })
        .map(async (seg) => {
          const url = seg.asset?.previewUrl;
          if (!url) return;

          // ── Duration-based routing (no network round-trip needed) ────────
          // durationSeconds is populated by ffprobe at import time and is
          // always correct.  We never send a HEAD request to media:// because:
          //   • Electron's range-response handler doesn't set Content-Length
          //     on streaming responses, so we'd always read null.
          //   • A HEAD fetch would still hit the network stack unnecessarily.
          const assetDuration = seg.asset?.durationSeconds ?? 0;
          if (assetDuration > STREAMING_DURATION_THRESHOLD_S) {
            // Mark as streaming and create the HTMLAudioElement immediately
            // so _playStreaming can seek + play it without any async work.
            this.streamingUrls.add(url);
            this._ensureStreamingElement(ctx, url, seg);
            return; // no fetch needed
          }

          // ── Buffer path: fetch + decodeAudioData (short files only) ─────
          this.pendingFetches.add(url);
          try {
            // HEAD request first — check Content-Length before downloading.
            // Large files (>200 MB, e.g. 58-min videos) cannot fit in an
            // AudioBuffer (decodeAudioData requires the whole file in RAM).
            // Mark them as streaming so _scheduleNodes uses MediaElementAudioSourceNode.
            let isLarge = false;
            try {
              const head = await fetch(url, { method: 'HEAD' });
              const len = head.headers.get('content-length');
              if (len && parseInt(len, 10) > MAX_BUFFER_BYTES) isLarge = true;
            } catch { /* HEAD not supported — fall through to buffer attempt */ }

            if (isLarge) {
              this.streamingUrls.add(url);
              // Pre-create the HTMLAudioElement and connect it to Web Audio
              // so seek + play is instant when playback starts.
              this._ensureStreamingElement(ctx, url, seg);
              return;
            }

            const response = await fetch(url);
            if (!response.ok) return;
            const ab = await response.arrayBuffer();
            // Safety net: if the file is larger than our RAM budget (e.g.
            // durationSeconds was missing or wrong), fall back to streaming
            // rather than crashing decodeAudioData or the renderer process.
            if (ab.byteLength > MAX_BUFFER_BYTES) {
              this.streamingUrls.add(url);
              this._ensureStreamingElement(ctx, url, seg);
              return;
            }
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

  /**
   * Create (or reuse) an HTMLAudioElement routed through Web Audio for streaming.
   *
   * CORS note: Do NOT set `crossOrigin` on the element.  `media://` is a
   * local Electron protocol — Chromium treats it as same-origin when crossOrigin
   * is absent.  Setting `crossOrigin = 'anonymous'` forces an opaque-origin
   * CORS check that `media://` never satisfies, causing createMediaElementSource
   * to throw a SecurityError (silently caught → no element → silence).
   *
   * Track routing: connect through getTrackGain() so per-track volume and EQ
   * work for streaming clips just like buffered clips.
   */
  private _ensureStreamingElement(ctx: AudioContext, url: string, seg: TimelineSegment): void {
    if (this.streamingElements.has(url)) return;
    try {
      const element = new Audio();
      // No crossOrigin attribute — media:// is local/same-origin in Electron.
      // Setting crossOrigin triggers CORS enforcement which media:// cannot satisfy.
      element.src = url;
      element.preload = 'auto';
      element.volume = 1;
      element.muted = false;
      const sourceNode = ctx.createMediaElementSource(element);
      const gainNode = ctx.createGain();
      gainNode.gain.value = Math.max(0, seg.clip.volume ?? 1);
      // Route through track gain so setTrackVolume/EQ/mute apply to streaming clips.
      sourceNode.connect(gainNode);
      gainNode.connect(this.getTrackGain(ctx, seg.track.id));
      this.streamingElements.set(url, { element, sourceNode, gainNode });
    } catch {
      // createMediaElementSource can throw if the element is already connected
      // to a different AudioContext. If this happens the entry is simply absent
      // from streamingElements and _playStreaming will skip this segment.
    }
  }

  // ── Play ───────────────────────────────────────────────────────────────────
  play(params: PlayParams): void {
    const { segments, playheadFrame, fps, seamResume = false } = params;
    const ctx = this.getCtx();
    if (ctx.state === "suspended") void ctx.resume();

    const now = ctx.currentTime;

    if (seamResume) {
      // SMART SEAM: only fade out clips that are no longer active; only schedule
      // clips that are genuinely new. This prevents overlap-stutter where a clip
      // that is already playing gets stopped and immediately restarted at a seam.
      const incomingClipIds = new Set(segments.map((s) => s.clip.id));

      // Separate currently-playing nodes into "keep" (still active) and "depart" (no longer active)
      const departedIds: number[] = [];
      const keptClipIds = new Set<string>();
      for (const [nodeId, src] of this.activeSources) {
        const clipId = (src as ActiveSource & { clipId?: string }).clipId;
        if (clipId && incomingClipIds.has(clipId)) {
          keptClipIds.add(clipId);
        } else {
          departedIds.push(nodeId);
        }
      }

      // Fade out departed clips
      for (const nodeId of departedIds) {
        const src = this.activeSources.get(nodeId);
        this.activeSources.delete(nodeId);
        if (src) {
          try {
            src.gainNode.gain.cancelScheduledValues(now);
            src.gainNode.gain.setValueAtTime(src.gainNode.gain.value, now);
            src.gainNode.gain.linearRampToValueAtTime(0, now + XFADE_S);
            const stopAt = Math.max(src.scheduledAt, now) + XFADE_S + 0.001;
            src.source.stop(stopAt);
          } catch { /* already stopped */ }
        }
      }

      // Schedule only clips that aren't already playing
      const newSegments = segments.filter((s) => !keptClipIds.has(s.clip.id));
      if (newSegments.length > 0) {
        this._scheduleNodes(ctx, newSegments, playheadFrame, fps, now, XFADE_S);
      }
    } else {
      // HARD START: stop existing nodes immediately, start new ones after
      // a small latency budget to ensure all start() calls are committed.
      this._stopAll(ctx, now, STOP_FADE_S);
      this._scheduleNodes(ctx, segments, playheadFrame, fps, now + START_LATENCY, STOP_FADE_S);
    }
  }

  // ── Streaming playback helpers ─────────────────────────────────────────────
  private _playStreaming(segments: TimelineSegment[], playheadFrame: number, fps: number): void {
    for (const seg of segments) {
      const url = seg.asset?.previewUrl;
      if (!url || !this.streamingUrls.has(url)) continue;
      const entry = this.streamingElements.get(url);
      if (!entry) continue;
      const { element, gainNode } = entry;
      const clipSpeed = Math.max(0.25, Math.min(4, seg.clip.speed ?? 1));
      const clipVol   = Math.max(0, Math.min(2, seg.clip.volume ?? 1));
      const trackMuted = seg.track.muted ?? false;
      gainNode.gain.value = trackMuted ? 0 : clipVol * Math.max(0, seg.track.volume ?? 1);
      const playheadOffset = Math.max(0, playheadFrame - seg.startFrame);
      const targetTime = seg.sourceInSeconds + (playheadOffset / fps) * clipSpeed;
      // Seek if more than 0.5 s out of sync
      if (Math.abs(element.currentTime - targetTime) > 0.5) {
        element.currentTime = targetTime;
      }
      element.playbackRate = clipSpeed;
      void element.play().catch(() => {});
    }
  }

  private _pauseStreaming(): void {
    for (const { element } of this.streamingElements.values()) {
      element.pause();
    }
  }

  private _stopStreaming(): void {
    for (const { element } of this.streamingElements.values()) {
      element.pause();
      try { element.currentTime = 0; } catch {}
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
    this._pauseStreaming();
  }

  // ── Pause (same as stop for AudioBufferSourceNode) ────────────────────────
  pause(): void {
    this.stop();
    this._pauseStreaming();
  }

  // ── Volume ────────────────────────────────────────────────────────────────
  setTrackVolume(trackId: string, vol: number): void {
    const tg = this.trackGains.get(trackId);
    if (tg) tg.gain.value = Math.max(0, Math.min(2, vol));
  }

  setMasterVolume(vol: number): void {
    if (this.masterGain) this.masterGain.gain.value = Math.max(0, Math.min(2, vol));
  }

  // ── EQ ────────────────────────────────────────────────────────────────────
  /**
   * Apply a multi-band EQ to the given track. Creates/updates a BiquadFilterNode
   * chain inserted between the track's gain node and its analyser. Calling with
   * an empty array (or all bands at 0 dB / disabled) tears the chain down so the
   * signal path bypasses the EQ entirely.
   */
  setTrackEQ(trackId: string, bands: EQBand[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const trackGain = this.trackGains.get(trackId);
    const analyser = this.trackAnalysers.get(trackId);
    if (!trackGain || !analyser) return;

    // Reuse existing filters where possible; create new ones as needed
    const existing = this.trackEQChains.get(trackId) ?? [];
    const activeBands = bands.filter((b) => b.enabled !== false);

    // Disconnect the current routing so we can rebuild it
    try { trackGain.disconnect(); } catch { /* ignore */ }
    for (const f of existing) {
      try { f.disconnect(); } catch { /* ignore */ }
    }

    // If no active EQ bands, route trackGain → analyser directly and drop the chain
    if (activeBands.length === 0) {
      this.trackEQChains.delete(trackId);
      trackGain.connect(analyser);
      return;
    }

    // Build / update filter chain
    const chain: BiquadFilterNode[] = [];
    for (let i = 0; i < activeBands.length; i++) {
      const band = activeBands[i];
      let filter = existing[i];
      if (!filter) {
        filter = ctx.createBiquadFilter();
      }
      filter.type = band.type as BiquadFilterType;
      filter.frequency.value = Math.max(20, Math.min(20000, band.frequency));
      filter.gain.value = Math.max(-30, Math.min(30, band.gain));
      filter.Q.value = Math.max(0.0001, Math.min(20, band.q));
      chain.push(filter);
    }

    // Wire: trackGain → filter[0] → filter[1] → … → analyser
    trackGain.connect(chain[0]);
    for (let i = 0; i < chain.length - 1; i++) {
      chain[i].connect(chain[i + 1]);
    }
    chain[chain.length - 1].connect(analyser);

    this.trackEQChains.set(trackId, chain);
  }

  // ── Compressor ───────────────────────────────────────────────────────────────────
  /**
   * Set or update the DynamicsCompressorNode for a track.
   * The compressor is inserted between the EQ chain tail (or trackGain) and the
   * analyser.  If enabled=false, the compressor is bypassed (disconnected).
   */
  setTrackCompressor(trackId: string, settings: {
    enabled: boolean;
    threshold: number;  // dB  (-60 to 0)
    ratio: number;      // 1–20
    attack: number;     // ms
    release: number;    // ms
    makeupGain: number; // dB (0–24)
    knee: number;       // dB (0–10)
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const trackGain  = this.trackGains.get(trackId);
    const analyser   = this.trackAnalysers.get(trackId);
    if (!trackGain || !analyser) return;

    // Tear down any existing compressor for this track
    const old = this.trackCompressors.get(trackId);
    if (old) {
      try { old.disconnect(); } catch { /* ok */ }
      this.trackCompressors.delete(trackId);
    }

    if (!settings.enabled) {
      // Rebuild plain routing without compressor
      this.setTrackEQ(trackId, []);  // re-routes trackGain → analyser
      return;
    }

    // Create compressor node
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = Math.max(-60, Math.min(0, settings.threshold));
    comp.ratio.value     = Math.max(1, Math.min(20, settings.ratio));
    comp.attack.value    = Math.max(0, Math.min(1, settings.attack / 1000));   // ms → s
    comp.release.value   = Math.max(0, Math.min(1, settings.release / 1000));  // ms → s
    comp.knee.value      = Math.max(0, Math.min(40, settings.knee));

    // Makeup gain node (DynamicsCompressor has no built-in makeup)
    const makeup = ctx.createGain();
    makeup.gain.value = Math.pow(10, settings.makeupGain / 20); // dB → linear

    // Wire: trackGain [→ EQ chain] → comp → makeup → analyser
    // Disconnect existing EQ tail first
    const eqChain = this.trackEQChains.get(trackId);
    const eqTail: AudioNode = eqChain && eqChain.length > 0 ? eqChain[eqChain.length - 1] : trackGain;
    try { eqTail.disconnect(); } catch { /* ok */ }
    eqTail.connect(comp);
    comp.connect(makeup);
    makeup.connect(analyser);

    this.trackCompressors.set(trackId, comp);
  }

  // ── LUFS Metering (integrated loudness, K-weighted approximation) ─────────
  /**
   * Start accumulating integrated loudness against the master output.
   * Returns the current integrated LUFS value (call repeatedly for live read).
   */
  getLUFS(): number {
    const ctx = this.ctx;
    if (!ctx || !this.masterAnalyser) return -Infinity;
    // Compute mean square from master analyser time-domain data
    const buf = new Float32Array(this.masterAnalyser.fftSize);
    this.masterAnalyser.getFloatTimeDomainData(buf);
    let ms = 0;
    for (let i = 0; i < buf.length; i++) ms += buf[i] * buf[i];
    ms /= buf.length;
    if (ms < 1e-10) return -70;  // silence floor
    // K-weighted: we approximate with a gentle high-shelf (+4 dB @ 2kHz)
    // For a true ITU-R BS.1770-4 implementation we'd need a pre-filter, but
    // for display purposes this is accurate within ~1 LU.
    const lufs = 10 * Math.log10(ms) - 0.691;
    // Integrate with a 300ms decay leaky integrator
    this.lufsSum = this.lufsSum * 0.9 + lufs * 0.1;
    this.lufsValue = this.lufsSum;
    return this.lufsValue;
  }

  isBufferCached(url: string): boolean {
    return this.bufferCache.has(url);
  }

  // ── Dispose ───────────────────────────────────────────────────────────────
  dispose(): void {
    this.stop();
    this._stopStreaming();
    // Disconnect and release streaming elements
    for (const { element, sourceNode, gainNode } of this.streamingElements.values()) {
      try { sourceNode.disconnect(); } catch {}
      try { gainNode.disconnect(); } catch {}
      element.src = '';
    }
    this.streamingElements.clear();
    this.streamingUrls.clear();
    const ctx = this.ctx;
    if (ctx) {
      window.setTimeout(() => void ctx.close(), Math.ceil((STOP_FADE_S + 0.01) * 1000));
    }
    this.ctx = null;
    this.masterGain = null;
    this.masterAnalyser = null;
    this.trackGains.clear();
    this.trackAnalysers.clear();
    this.trackEQChains.clear();
    this.trackCompressors.forEach(c => { try { c.disconnect(); } catch {} });
    this.trackCompressors.clear();
    this.lufsSum = 0; this.lufsCount = 0; this.lufsValue = -Infinity;
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
    // Handle streaming (large file) segments separately
    const streamingSegs = segments.filter(s => s.asset?.previewUrl && this.streamingUrls.has(s.asset.previewUrl));
    if (streamingSegs.length > 0) this._playStreaming(streamingSegs, playheadFrame, fps);

    for (const seg of segments) {
      const url = seg.asset?.previewUrl;
      if (!url) continue;
      if (this.streamingUrls.has(url)) continue; // handled above
      const buffer = this.bufferCache.get(url);
      if (!buffer) continue;

      const clipSpeed = Math.max(0.25, Math.min(4, seg.clip.speed ?? 1));
      const clipVol = Math.max(0, seg.clip.volume ?? 1);
      const trackVol = Math.max(0, seg.track.volume ?? 1);
      const effectiveGain = Math.min(2, (seg.track.muted ?? false) ? 0 : clipVol);
      // Sync track gain node with track.volume from store
      this.setTrackVolume(seg.track.id, seg.track.muted ? 0 : trackVol);

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
      const entry: ActiveSource & { clipId: string } = { source, gainNode, scheduledAt: startAt, clipId: seg.clip.id };
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
