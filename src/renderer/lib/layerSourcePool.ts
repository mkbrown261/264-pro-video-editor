/**
 * LayerSourcePool — hidden decoders for every layer the viewer composites.
 *
 * The playback controller drives the primary <video> (the top clip). Every
 * other visible layer — lower tracks, and the outgoing clip's tail during a
 * transition — gets a pooled, muted media element kept in sync with the
 * playhead here.
 */

import type { MediaAsset } from "../../shared/models";
import type { PreviewLayer, PreviewUnit } from "../../shared/previewLayers";

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif|avif)$/i;

interface Entry {
  el: HTMLVideoElement | HTMLImageElement;
  url: string;
  lastUsed: number;
}

export function mediaUrlFor(asset: MediaAsset, useProxy: boolean): string {
  if (useProxy && asset.previewUrl) return asset.previewUrl;
  return asset.sourcePath ? `media://asset?path=${encodeURIComponent(asset.sourcePath)}` : asset.previewUrl;
}

export class LayerSourcePool {
  private entries = new Map<string, Entry>();
  private primary: { el: HTMLVideoElement; clipId: string } | null = null;

  constructor(private onFrameReady: () => void, private useProxy = true) {}

  setProxy(useProxy: boolean) {
    this.useProxy = useProxy;
  }

  setPrimary(el: HTMLVideoElement | null, clipId: string | null) {
    this.primary = el && clipId ? { el, clipId } : null;
  }

  private create(url: string, image: boolean): Entry {
    let el: HTMLVideoElement | HTMLImageElement;
    if (image) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => this.onFrameReady();
      img.src = url;
      el = img;
    } else {
      const v = document.createElement("video");
      v.crossOrigin = "anonymous";
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.addEventListener("seeked", this.onFrameReady);
      v.addEventListener("loadeddata", this.onFrameReady);
      v.src = url;
      el = v;
    }
    return { el, url, lastUsed: performance.now() };
  }

  /** Keep every non-primary layer's element positioned at its source time. */
  sync(units: PreviewUnit[], isPlaying: boolean, fps: number) {
    const now = performance.now();
    const seen = new Set<string>();
    for (const u of units) {
      if (u.kind !== "media") continue;
      for (const layer of [u.from, u.to]) {
        if (!layer || this.isPrimary(layer)) continue;
        const asset = layer.segment.asset;
        const url = mediaUrlFor(asset, this.useProxy);
        if (!url) continue;
        seen.add(layer.key);
        let e = this.entries.get(layer.key);
        if (e && e.url !== url) { this.release(layer.key); e = undefined; }
        if (!e) {
          e = this.create(url, IMAGE_EXT.test(asset.sourcePath || url));
          this.entries.set(layer.key, e);
        }
        e.lastUsed = now;
        const v = e.el;
        if (!(v instanceof HTMLVideoElement) || v.readyState < 1) continue;
        const target = Math.max(0, Math.min(layer.sourceTime, (v.duration || Infinity) - 0.001));
        if (isPlaying) {
          const rate = Math.min(16, Math.max(0.0625, layer.rate));
          if (Math.abs(v.playbackRate - rate) > 1e-3) v.playbackRate = rate;
          if (v.paused) {
            v.currentTime = target;
            void v.play().catch(() => {});
          } else if (Math.abs(v.currentTime - target) > 0.25) {
            v.currentTime = target;
          }
        } else {
          if (!v.paused) v.pause();
          if (!v.seeking && Math.abs(v.currentTime - target) > 0.5 / fps) v.currentTime = target;
        }
      }
    }
    // Pause layers that left the screen; free them after a while.
    for (const [key, e] of this.entries) {
      if (seen.has(key)) continue;
      if (e.el instanceof HTMLVideoElement && !e.el.paused) e.el.pause();
      if (now - e.lastUsed > 5000) this.release(key);
    }
  }

  private isPrimary(layer: PreviewLayer): boolean {
    const p = this.primary;
    return !!p && layer.key === p.clipId && p.el.readyState >= 2;
  }

  sourceFor = (layer: PreviewLayer): HTMLVideoElement | HTMLImageElement | null => {
    if (this.isPrimary(layer)) return this.primary!.el;
    const e = this.entries.get(layer.key);
    if (!e) return null;
    if (e.el instanceof HTMLVideoElement) return e.el.readyState >= 2 ? e.el : null;
    return e.el.complete && e.el.naturalWidth > 0 ? e.el : null;
  };

  private release(key: string) {
    const e = this.entries.get(key);
    if (!e) return;
    if (e.el instanceof HTMLVideoElement) {
      e.el.removeEventListener("seeked", this.onFrameReady);
      e.el.removeEventListener("loadeddata", this.onFrameReady);
      e.el.pause();
      e.el.removeAttribute("src");
      e.el.load();
    }
    this.entries.delete(key);
  }

  dispose() {
    for (const key of [...this.entries.keys()]) this.release(key);
    this.primary = null;
  }
}
