/**
 * GPU (viewer-engine) export — renderer side.
 *
 * Renders every frame with the same ViewerCompositor as the program monitor,
 * so everything the viewer shows exports exactly: NodeFX graphs, speed ramps,
 * animated/tracked/bezier masks, windowed effects, animated effect params.
 * Source frames come from sequential FFmpeg decoders in the main process;
 * finished frames stream back to an FFmpeg encoder (electron/gpuExport.ts).
 */

import type { ExportRequest, ExportResponse, MediaAsset } from "../../shared/models";
import { buildTimelineSegments, type TimelineSegment } from "../../shared/timeline";
import { buildExportGraph } from "../../shared/exportGraph";
import { computePreviewUnits, type PreviewLayer, type PreviewUnit } from "../../shared/previewLayers";
import { ViewerCompositor } from "./viewerCompositor";
import { effectsAtFrame } from "./effectsAtFrame";
import { loadSegmenter } from "./backgroundRemoval";

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif|avif)$/i;

/** Would the FFmpeg-graph export miss anything the GPU render gets right? */
export function exportNeedsGpu(request: Omit<ExportRequest, "outputPath">): { needsGpu: boolean; warnings: string[] } {
  try {
    const g = buildExportGraph(request, {
      fontsDir: null,
      writeTempFile: (name) => `/dev/null/${name}`,
      loadFileLut: () => null,
      lutSize: 2, // analysis only
    });
    return { needsGpu: g.needsGpu, warnings: g.warnings };
  } catch {
    return { needsGpu: false, warnings: [] };
  }
}

function flattenMedia(units: PreviewUnit[], out: PreviewLayer[] = []): PreviewLayer[] {
  for (const u of units) {
    if (u.kind !== "media" && u.kind !== "adjustment") continue;
    for (const l of [u.from, u.to]) {
      if (!l) continue;
      if (l.nested) flattenMedia(l.nested, out);
      else if (u.kind === "media") out.push(l);
    }
  }
  return out;
}

export interface GpuExportOptions {
  request: ExportRequest;
  onProgress?: (pct: number) => void;
  isCancelled?: () => boolean;
}

export async function runGpuExport({ request, onProgress, isCancelled }: GpuExportOptions): Promise<ExportResponse> {
  const api = window.editorApi;
  if (!api?.gpuExportStart || !api.gpuExportSourceFrame || !api.gpuExportWriteFrame || !api.gpuExportFinish) {
    throw new Error("GPU export is unavailable in this build.");
  }
  const { project } = request;
  const { jobId, width: W, height: H, fps, totalFrames } = await api.gpuExportStart(request);
  const segments = buildTimelineSegments(project.sequence, project.assets);
  const nestedCache = new Map<string, TimelineSegment[]>();
  const resolveNested = (clip: { nestedSequenceId?: string }) => {
    const seq = clip.nestedSequenceId ? project.nestedSequences?.[clip.nestedSequenceId] : undefined;
    if (!seq) return null;
    let s = nestedCache.get(seq.id);
    if (!s) { s = buildTimelineSegments(seq, project.assets); nestedCache.set(seq.id, s); }
    return s;
  };

  const allClips = [project.sequence.clips, ...Object.values(project.nestedSequences ?? {}).map((s) => s.clips)].flat();
  if (allClips.some((c) => c.aiBackgroundRemoval?.enabled) && !(await loadSegmenter())) {
    await api.gpuExportCancel?.(jobId);
    throw new Error("AI background removal model failed to load.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const compositor = new ViewerCompositor(canvas, () => {}, { readback: true });
  const sources = new Map<string, HTMLCanvasElement | HTMLImageElement>();
  const images = new Map<string, Promise<HTMLImageElement | null>>();

  const loadImage = (asset: MediaAsset) => {
    let p = images.get(asset.id);
    if (!p) {
      p = new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = `media://asset?path=${encodeURIComponent(asset.sourcePath)}`;
      });
      images.set(asset.id, p);
    }
    return p;
  };

  const fetchSource = async (layer: PreviewLayer) => {
    const asset = layer.segment.asset;
    if (!asset.sourcePath) return;
    if (IMAGE_EXT.test(asset.sourcePath)) {
      const img = await loadImage(asset);
      if (img) sources.set(layer.key, img);
      return;
    }
    const sw = asset.width || W, sh = asset.height || H;
    const fit = Math.min(W / sw, H / sh, 1);
    const w = Math.max(2, Math.round((sw * fit) / 2) * 2), h = Math.max(2, Math.round((sh * fit) / 2) * 2);
    const data = await api.gpuExportSourceFrame!(jobId, {
      key: layer.key, path: asset.sourcePath, time: layer.sourceTime, width: w, height: h,
      fps: asset.nativeFps || fps,
    });
    if (!data || data.byteLength !== w * h * 4) return;
    let c = sources.get(layer.key);
    if (!(c instanceof HTMLCanvasElement)) { c = document.createElement("canvas"); sources.set(layer.key, c); }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength), w, h), 0, 0);
  };

  try {
    for (let f = 0; f < totalFrames; f++) {
      if (isCancelled?.()) throw new Error("Export cancelled.");
      const units = computePreviewUnits(segments, f, fps, resolveNested);
      const layers = flattenMedia(units);
      sources.clear();
      await Promise.all(layers.map(fetchSource));
      compositor.render(units, (layer) => sources.get(layer.key) ?? null, {
        width: W, height: H, frame: f,
        effectsFor: (clip, frame) => effectsAtFrame(clip.effects, frame),
      });
      const px = compositor.readPixels();
      await api.gpuExportWriteFrame!(jobId, new Uint8Array(px.data.buffer));
      if (f % 5 === 0) onProgress?.(Math.min(99, Math.round((f / totalFrames) * 100)));
    }
    const res = await api.gpuExportFinish!(jobId);
    onProgress?.(100);
    return res;
  } catch (e) {
    await api.gpuExportCancel?.(jobId);
    throw e;
  } finally {
    compositor.dispose();
  }
}
