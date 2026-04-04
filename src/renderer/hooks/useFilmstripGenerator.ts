/**
 * useFilmstripGenerator
 * ─────────────────────────────────────────────────────────────────────────────
 * Fix 6: Generates filmstrip thumbnails every 2 s of source video on import.
 * Stores results in asset.filmstripThumbs (array of data: URLs) via
 * editorStore.setAssetFilmstrip().
 *
 * Uses an offscreen <video> + <canvas> to extract frames without blocking the
 * main thread (frames are captured one by one with a seeked event).
 */

import { useEffect } from "react";
import type { MediaAsset } from "../../shared/models";

const THUMB_W = 80;    // pixels — wide enough to look good in the timeline lane
const THUMB_H = 45;    // 16:9 aspect
const INTERVAL_S = 2;  // capture one frame every 2 s of source

/**
 * Capture a single frame from a video at `seekTimeSec` and return a data: URL.
 * The video element must already have its `src` set and preloaded.
 */
async function captureFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  seekTimeSec: number
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const timeout = window.setTimeout(() => resolve(null), 3000);
    const onSeeked = () => {
      window.clearTimeout(timeout);
      try {
        ctx.drawImage(video, 0, 0, THUMB_W, THUMB_H);
        resolve(canvas.toDataURL("image/jpeg", 0.65));
      } catch {
        resolve(null);
      }
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.currentTime = seekTimeSec;
  });
}

/**
 * Generate filmstrip thumbnails for a video asset.
 * Returns an array of data: URLs (empty array on failure).
 */
async function generateFilmstrip(asset: MediaAsset): Promise<string[]> {
  if (!asset.previewUrl || asset.durationSeconds <= 0) return [];

  const video = document.createElement("video");
  video.src = asset.previewUrl;
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "metadata";

  // Wait for metadata
  await new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("metadata timeout")), 8000);
    const ok = () => { window.clearTimeout(t); resolve(); };
    const err = () => { window.clearTimeout(t); reject(new Error("load error")); };
    video.addEventListener("loadedmetadata", ok, { once: true });
    video.addEventListener("error", err, { once: true });
    video.load();
  }).catch(() => null);

  if (!video.videoWidth || !video.videoHeight) return [];

  const canvas = document.createElement("canvas");
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const thumbs: string[] = [];
  const duration = Math.min(video.duration || asset.durationSeconds, asset.durationSeconds);
  const count = Math.max(1, Math.ceil(duration / INTERVAL_S));

  for (let i = 0; i < count; i++) {
    const t = Math.min(i * INTERVAL_S, duration - 0.05);
    const dataUrl = await captureFrame(video, canvas, ctx, t);
    if (dataUrl) thumbs.push(dataUrl);
  }

  // Clean up
  video.src = "";
  video.load();

  return thumbs;
}

interface UseFilmstripGeneratorOptions {
  assets: MediaAsset[];
  setAssetFilmstrip: (assetId: string, thumbs: string[]) => void;
}

/**
 * Hook: watches the assets list.  When a new video asset appears without
 * filmstripThumbs, it lazily generates and stores the filmstrip.
 */
export function useFilmstripGenerator({
  assets,
  setAssetFilmstrip,
}: UseFilmstripGeneratorOptions): void {
  useEffect(() => {
    const pending = assets.filter(
      (a) =>
        a.previewUrl &&
        a.durationSeconds > 0 &&
        !a.filmstripThumbs
    );

    if (pending.length === 0) return;

    let cancelled = false;

    (async () => {
      for (const asset of pending) {
        if (cancelled) break;
        try {
          const thumbs = await generateFilmstrip(asset);
          if (!cancelled && thumbs.length > 0) {
            setAssetFilmstrip(asset.id, thumbs);
          }
        } catch {
          // Silently skip assets that fail (video-only without decodable frames, etc.)
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets.map((a) => a.id).join(",")]);
}
