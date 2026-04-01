/**
 * useAsyncImport
 * ─────────────────────────────────────────────────────────────────────────────
 * Non-blocking, progressive asset import pipeline.
 *
 * Strategy
 * ────────
 *   1. User clicks Import — file dialog opens (this is inherently blocking).
 *   2. Electron returns the full MediaAsset[] list.  These already contain
 *      all metadata (duration, fps, resolution, hasAudio) because FFprobe
 *      ran before the function returned.
 *   3. We immediately add every asset to the store with a synthetic
 *      `thumbnailUrl = null` so the media card appears in the pool
 *      INSTANTLY — the user can already drag clips to the timeline.
 *   4. In the background we generate thumbnails by:
 *        a. Creating a hidden <video> element per asset.
 *        b. Seeking to 10 % of the duration.
 *        c. Drawing a frame to an offscreen <canvas>.
 *        d. Calling canvas.toDataURL("image/jpeg", 0.7).
 *        e. Patching the asset's thumbnailUrl in the store via
 *           setAssetThumbnail (or we re-use setAssetWaveform-style patch).
 *      Each thumbnail is generated sequentially to avoid saturating the
 *      browser's media decoder.  The UI stays fully responsive because
 *      thumbnail generation runs in micro-tasks / rAF, never blocking the
 *      main thread for more than one frame at a time.
 *   5. Waveform extraction already runs in the background via
 *      useWaveformExtractor — no changes needed there.
 *
 * Thumbnail caching
 * ─────────────────
 *   Generated thumbnails are cached in sessionStorage (keyed by asset id).
 *   On next import of the same file the cached dataURL is used immediately.
 *
 * Browser environment (no Electron)
 * ──────────────────────────────────
 *   When editorApi is not available, import falls through to a
 *   <input type="file"> based path that reads the file via object URLs,
 *   extracts metadata from the HTMLVideoElement, and builds MediaAsset
 *   objects — then follows the same progressive thumbnail pipeline.
 */

import { useCallback, useRef } from "react";
import { createId } from "../../shared/models";
import type { MediaAsset } from "../../shared/models";

// ── thumbnail cache ───────────────────────────────────────────────────────────
const CACHE_PREFIX = "264pro_thumb_";

function getCachedThumb(assetId: string): string | null {
  try {
    return sessionStorage.getItem(CACHE_PREFIX + assetId);
  } catch {
    return null;
  }
}

function setCachedThumb(assetId: string, dataUrl: string): void {
  try {
    sessionStorage.setItem(CACHE_PREFIX + assetId, dataUrl);
  } catch {
    // sessionStorage full — ignore
  }
}

// ── thumbnail generator ───────────────────────────────────────────────────────

async function generateThumbnail(
  previewUrl: string,
  durationSeconds: number
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    video.crossOrigin = "anonymous";
    video.playsInline = true;
    video.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;top:-9999px;";
    document.body.appendChild(video);

    const cleanup = () => {
      try {
        video.pause();
        video.src = "";
        video.load();
        document.body.removeChild(video);
      } catch { /* ignore */ }
    };

    const timeout = window.setTimeout(() => { cleanup(); resolve(null); }, 3000);

    video.addEventListener("error", () => {
      window.clearTimeout(timeout);
      cleanup();
      resolve(null);
    }, { once: true });

    video.addEventListener("seeked", () => {
      window.clearTimeout(timeout);
      try {
        const canvas = document.createElement("canvas");
        canvas.width  = Math.min(video.videoWidth,  320);
        canvas.height = Math.min(video.videoHeight, 180);
        const ctx = canvas.getContext("2d");
        if (!ctx) { cleanup(); resolve(null); return; }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        cleanup();
        resolve(dataUrl);
      } catch {
        cleanup();
        resolve(null);
      }
    }, { once: true });

    video.src = previewUrl;
    video.load();

    video.addEventListener("loadedmetadata", () => {
      // Seek to 1 s (or 5% of duration) to get a quick representative frame.
      // Keep seek time short so browsers don't need to buffer much data.
      video.currentTime = Math.min(1, Math.max(0.1, durationSeconds * 0.05));
    }, { once: true });
  });
}

// ── metadata extractor (browser fallback) ────────────────────────────────────

async function extractMetadataFromObjectUrl(
  objectUrl: string,
  fileName: string
): Promise<MediaAsset | null> {
  return new Promise<MediaAsset | null>((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    video.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;top:-9999px;";
    document.body.appendChild(video);

    const cleanup = () => {
      try {
        video.src = "";
        video.load();
        document.body.removeChild(video);
      } catch { /* ignore */ }
    };

    const timeout = window.setTimeout(() => { cleanup(); resolve(null); }, 10000);

    video.addEventListener("error", () => {
      window.clearTimeout(timeout);
      cleanup();
      resolve(null);
    }, { once: true });

    video.addEventListener("loadedmetadata", () => {
      window.clearTimeout(timeout);
      const asset: MediaAsset = {
        id: createId(),
        name: fileName,
        sourcePath: objectUrl,
        previewUrl: objectUrl,
        thumbnailUrl: null,
        durationSeconds: video.duration ?? 0,
        nativeFps: 30,   // best-effort; exact fps not available without FFprobe
        width: video.videoWidth ?? 1920,
        height: video.videoHeight ?? 1080,
        hasAudio: true,  // assume audio present
      };
      cleanup();
      resolve(asset);
    }, { once: true });

    video.src = objectUrl;
    video.load();
  });
}

// ── hook interface ─────────────────────────────────────────────────────────────

export interface AsyncImportOptions {
  /** Called with each batch of assets as they become available */
  onAssetsReady: (assets: MediaAsset[]) => void;
  /** Called once thumbnail is generated for an asset */
  onThumbnailReady: (assetId: string, thumbnailUrl: string) => void;
  /** Called when the import begins and ends */
  onImportingChange: (busy: boolean) => void;
}

export interface AsyncImportActions {
  /** Trigger the Electron file dialog or browser file picker */
  triggerImport: () => Promise<void>;
}

/**
 * useAsyncImport
 *
 * Handles the full non-blocking import pipeline.  Mount this in App.tsx
 * and replace the existing handleImport function.
 */
export function useAsyncImport({
  onAssetsReady,
  onThumbnailReady,
  onImportingChange,
}: AsyncImportOptions): AsyncImportActions {
  const abortRef = useRef(false);

  const triggerImport = useCallback(async () => {
    abortRef.current = false;
    onImportingChange(true);

    let rawAssets: MediaAsset[] = [];

    try {
      if (window.editorApi) {
        // ── Electron path ──────────────────────────────────────────────────
        // openMediaFiles blocks until the dialog closes, then returns the
        // full MediaAsset[] with all metadata pre-populated by FFprobe.
        rawAssets = await window.editorApi.openMediaFiles();
      } else {
        // ── Browser fallback ───────────────────────────────────────────────
        // Show a <input type="file"> picker and extract metadata in the browser.
        rawAssets = await browserFilePicker();
      }
    } catch {
      onImportingChange(false);
      return;
    }

    if (!rawAssets.length) {
      onImportingChange(false);
      return;
    }

    // ── Step 1: Immediately add all assets with thumbnail=null ────────────
    // Restore any cached thumbnails synchronously
    const assetsWithCachedThumbs = rawAssets.map((asset) => {
      const cached = getCachedThumb(asset.id);
      return cached ? { ...asset, thumbnailUrl: cached } : asset;
    });

    onAssetsReady(assetsWithCachedThumbs);
    onImportingChange(false); // UI unblocks immediately

    // ── Step 2: Generate missing thumbnails in the background ─────────────
    for (const asset of assetsWithCachedThumbs) {
      if (abortRef.current) break;
      if (asset.thumbnailUrl) continue; // already cached

      // Yield to the event loop before each thumbnail to keep UI responsive
      await new Promise<void>((r) => requestAnimationFrame(() => r()));

      try {
        const thumb = await generateThumbnail(asset.previewUrl, asset.durationSeconds);
        if (thumb) {
          setCachedThumb(asset.id, thumb);
          onThumbnailReady(asset.id, thumb);
        }
      } catch {
        // thumbnail failure is non-fatal
      }
    }
  }, [onAssetsReady, onThumbnailReady, onImportingChange]);

  return { triggerImport };
}

// ── browser file picker ───────────────────────────────────────────────────────

async function browserFilePicker(): Promise<MediaAsset[]> {
  return new Promise<MediaAsset[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "video/*,audio/*";
    input.style.cssText = "position:absolute;width:0;height:0;opacity:0;";
    document.body.appendChild(input);

    input.addEventListener("change", async () => {
      document.body.removeChild(input);
      const files = Array.from(input.files ?? []);
      if (!files.length) { resolve([]); return; }

      const assets: MediaAsset[] = [];
      for (const file of files) {
        const objectUrl = URL.createObjectURL(file);
        const asset = await extractMetadataFromObjectUrl(objectUrl, file.name);
        if (asset) assets.push(asset);
      }
      resolve(assets);
    }, { once: true });

    input.addEventListener("cancel", () => {
      document.body.removeChild(input);
      resolve([]);
    }, { once: true });

    input.click();
  });
}
