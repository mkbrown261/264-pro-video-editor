/**
 * Subject tracking for auto-reframe: samples the clip, finds where the subject
 * is in each sample (the person for "face", the moving region for "motion"),
 * and smooths that into a camera path the export crop follows.
 */
import { loadSegmenter, personCentroid } from "./backgroundRemoval";

export interface CameraPoint { t: number; x: number; y: number }

type SampleFrames = (a: { filePath: string; fps: number; width: number; maxSeconds?: number }) =>
  Promise<{ width: number; height: number; fps: number; count: number; frames: Uint8Array }>;

export async function trackSubject(
  filePath: string, durationSeconds: number, mode: "face" | "motion",
  onProgress?: (fraction: number) => void,
): Promise<CameraPoint[]> {
  const sample = (window as unknown as { electronAPI?: { sampleFrames?: SampleFrames } }).electronAPI?.sampleFrames;
  if (!sample) throw new Error("Subject tracking needs the desktop app.");
  if (mode === "face" && !(await loadSegmenter())) throw new Error("Person detection model unavailable");
  const fps = durationSeconds > 120 ? 2 : 4;
  const { width: W, height: H, count, frames } = await sample({ filePath, fps, width: 256, maxSeconds: 600 });
  const size = W * H * 4;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const raw: Array<{ t: number; x: number; y: number; ok: boolean }> = [];
  for (let f = 0; f < count; f++) {
    const img = frames.subarray(f * size, (f + 1) * size);
    const t = f / fps;
    if (mode === "face") {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(img), W, H), 0, 0);
      const p = personCentroid(canvas);
      raw.push({ t, x: p?.x ?? 0.5, y: p?.y ?? 0.5, ok: !!p && p.mass > 0.01 });
      if (f % 8 === 0) await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
    } else {
      const prev = f > 0 ? frames.subarray((f - 1) * size, f * size) : null;
      let sum = 0, sx = 0, sy = 0;
      if (prev) {
        for (let i = 0, px = 0; i < size; i += 4, px++) {
          const d = Math.abs(img[i] - prev[i]) + Math.abs(img[i + 1] - prev[i + 1]) + Math.abs(img[i + 2] - prev[i + 2]);
          if (d < 45) continue;
          sum += d; sx += d * (px % W); sy += d * Math.floor(px / W);
        }
      }
      raw.push({ t, x: sum ? sx / sum / W : 0.5, y: sum ? sy / sum / H : 0.5, ok: sum > W * H * 2 });
    }
    onProgress?.((f + 1) / count);
  }
  return smoothPath(raw, 1 / fps);
}

/** Hold the last good position through misses, then smooth like a slow camera operator. */
export function smoothPath(raw: Array<{ t: number; x: number; y: number; ok: boolean }>, step: number): CameraPoint[] {
  if (!raw.length) return [];
  const firstOk = raw.find((r) => r.ok);
  let hx = firstOk?.x ?? 0.5, hy = firstOk?.y ?? 0.5;
  const held = raw.map((r) => { if (r.ok) { hx = r.x; hy = r.y; } return { t: r.t, x: hx, y: hy }; });
  const radius = Math.max(1, Math.round(0.75 / step)); // ±0.75 s moving average, applied twice
  const blur = (pts: CameraPoint[]) => pts.map((p, i) => {
    let sx = 0, sy = 0, n = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(pts.length - 1, i + radius); k++) { sx += pts[k].x; sy += pts[k].y; n++; }
    return { t: p.t, x: sx / n, y: sy / n };
  });
  return blur(blur(held));
}
