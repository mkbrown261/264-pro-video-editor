/**
 * AI background removal — on-device person segmentation (MediaPipe selfie
 * segmenter, bundled model + WASM, no network).
 *
 * The compositor calls `cutout()` per layer; the same code runs for the
 * viewer and the GPU export, so they match.
 */

import { ImageSegmenter, type ImageSegmenterResult } from "@mediapipe/tasks-vision";
import type { BackgroundRemovalConfig } from "../../shared/models";
import { appAssetUrl } from "./appAssets";

let segmenter: ImageSegmenter | null = null;
let loading: Promise<ImageSegmenter | null> | null = null;
let failed = false;
let clock = 0;
const listeners = new Set<() => void>();

/** Load the segmenter once (resolves null if unavailable). */
export function loadSegmenter(): Promise<ImageSegmenter | null> {
  if (segmenter) return Promise.resolve(segmenter);
  if (failed) return Promise.resolve(null);
  if (!loading) {
    loading = (async () => {
      try {
        const model = new Uint8Array(await (await fetch(appAssetUrl("models/selfie_segmenter.tflite"))).arrayBuffer());
        const fileset = {
          wasmLoaderPath: appAssetUrl("mediapipe/vision_wasm_internal.js"),
          wasmBinaryPath: appAssetUrl("mediapipe/vision_wasm_internal.wasm"),
        };
        segmenter = await ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetBuffer: model },
          runningMode: "VIDEO",
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
        return segmenter;
      } catch (e) {
        console.warn("[backgroundRemoval] segmenter unavailable:", e);
        failed = true;
        return null;
      } finally {
        for (const l of listeners) l();
      }
    })();
  }
  return loading;
}

/** Called when the model finishes loading (the viewer re-renders). */
export function onSegmenterReady(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function segmenterStatus(): "ready" | "loading" | "failed" | "idle" {
  return segmenter ? "ready" : failed ? "failed" : loading ? "loading" : "idle";
}

const maskCanvas = document.createElement("canvas");
const outCanvas = document.createElement("canvas");

/**
 * Person cut out of `src` (w×h), composited over the configured background.
 * Returns null when the segmenter isn't ready (caller shows the original).
 */
export function cutout(src: CanvasImageSource, w: number, h: number, cfg: BackgroundRemovalConfig): HTMLCanvasElement | null {
  if (!segmenter) { void loadSegmenter(); return null; }
  let result: ImageSegmenterResult;
  try {
    // VIDEO mode needs strictly increasing timestamps.
    clock = Math.max(clock + 1, Math.floor(performance.now()));
    result = segmenter.segmentForVideo(src as HTMLCanvasElement, clock);
  } catch {
    return null;
  }
  const conf = result.confidenceMasks?.[0];
  if (!conf) { result.close?.(); return null; }
  const mw = conf.width, mh = conf.height;
  const data = conf.getAsFloat32Array();

  // Confidence → alpha with a soft edge around the threshold.
  if (maskCanvas.width !== mw || maskCanvas.height !== mh) { maskCanvas.width = mw; maskCanvas.height = mh; }
  const mctx = maskCanvas.getContext("2d")!;
  const img = mctx.createImageData(mw, mh);
  const thr = Math.min(0.95, Math.max(0.05, cfg.threshold ?? 0.5));
  const soft = 0.02 + Math.min(1, Math.max(0, cfg.edgeRefinement ?? 0.5)) * 0.25;
  for (let i = 0; i < data.length; i++) {
    const a = Math.min(1, Math.max(0, (data[i] - (thr - soft)) / (2 * soft)));
    img.data[i * 4 + 3] = Math.round(a * 255);
  }
  mctx.putImageData(img, 0, 0);
  result.close?.();

  if (outCanvas.width !== w || outCanvas.height !== h) { outCanvas.width = w; outCanvas.height = h; }
  const o = outCanvas.getContext("2d")!;
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = "source-over";
  o.filter = "none";
  o.clearRect(0, 0, w, h);
  o.drawImage(src, 0, 0, w, h);
  o.globalCompositeOperation = "destination-in";
  o.filter = cfg.edgeRefinement > 0 ? `blur(${(cfg.edgeRefinement * Math.max(w, h)) / 400}px)` : "none";
  o.drawImage(maskCanvas, 0, 0, w, h);
  o.filter = "none";
  // Background behind the person.
  o.globalCompositeOperation = "destination-over";
  if (cfg.backgroundType === "solidColor") {
    o.fillStyle = cfg.backgroundColor || "#00ff00";
    o.fillRect(0, 0, w, h);
  } else if (cfg.backgroundType === "blur") {
    o.filter = `blur(${Math.max(w, h) / 60}px)`;
    o.drawImage(src, 0, 0, w, h);
    o.filter = "none";
  }
  o.globalCompositeOperation = "source-over";
  return outCanvas;
}
