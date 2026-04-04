/**
 * ColorHistogram — Canvas2D RGB histogram overlay for the Color page.
 * Samples pixels from a <video> or <canvas> element and draws
 * overlapping R/G/B luminance histograms.
 */
import React, { useCallback, useEffect, useRef } from "react";

interface ColorHistogramProps {
  /** The video element to sample for histogram data */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Width of the histogram canvas in px */
  width?: number;
  /** Height of the histogram canvas in px */
  height?: number;
  /** Refresh rate in ms (default 200ms) */
  refreshMs?: number;
}

const BUCKET_COUNT = 256;

function drawHistogram(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  w: number,
  h: number
) {
  // Sample from video into offscreen canvas
  const offscreen = document.createElement("canvas");
  const sampleW = Math.min(video.videoWidth || 320, 320);
  const sampleH = Math.min(video.videoHeight || 180, 180);
  offscreen.width  = sampleW;
  offscreen.height = sampleH;
  const octx = offscreen.getContext("2d");
  if (!octx) return;
  try {
    octx.drawImage(video, 0, 0, sampleW, sampleH);
  } catch {
    return; // CORS or no frame
  }
  const imageData = octx.getImageData(0, 0, sampleW, sampleH);
  const data = imageData.data;

  const r = new Float32Array(BUCKET_COUNT);
  const g = new Float32Array(BUCKET_COUNT);
  const b = new Float32Array(BUCKET_COUNT);
  const lum = new Float32Array(BUCKET_COUNT);

  for (let i = 0; i < data.length; i += 4) {
    r[data[i]]++;
    g[data[i + 1]]++;
    b[data[i + 2]]++;
    const l = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    lum[l]++;
  }

  const maxVal = Math.max(
    ...Array.from(r), ...Array.from(g), ...Array.from(b), 1
  );

  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = "rgba(14,14,18,0.95)";
  ctx.fillRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const x = (w / 4) * i;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let i = 1; i < 3; i++) {
    const y = (h / 3) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  const drawChannel = (
    buckets: Float32Array,
    color: string,
    fillColor: string
  ) => {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < BUCKET_COUNT; i++) {
      const x = (i / (BUCKET_COUNT - 1)) * w;
      const y = h - (buckets[i] / maxVal) * h * 0.95;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();

    ctx.globalAlpha = 0.45;
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  // Draw luminance first (behind)
  drawChannel(lum, "rgba(255,255,255,0.5)", "rgba(255,255,255,0.15)");
  // RGB channels
  drawChannel(b, "#4d9fff", "rgba(77,159,255,0.3)");
  drawChannel(g, "#4dff8a", "rgba(77,255,138,0.3)");
  drawChannel(r, "#ff4d4d", "rgba(255,77,77,0.3)");

  // Axis labels
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.font = "9px monospace";
  ctx.fillText("0", 2, h - 2);
  ctx.fillText("128", w / 2 - 10, h - 2);
  ctx.fillText("255", w - 20, h - 2);
}

export const ColorHistogram: React.FC<ColorHistogramProps> = ({
  videoRef,
  width = 280,
  height = 120,
  refreshMs = 200,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const update = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (video.readyState < 2) return;
    drawHistogram(ctx, video, width, height);
  }, [videoRef, width, height]);

  useEffect(() => {
    const id = setInterval(update, refreshMs);
    return () => clearInterval(id);
  }, [update, refreshMs]);

  return (
    <div className="color-histogram-wrap" title="RGB Histogram">
      <div className="color-histogram-header">
        <span className="ch-label">Histogram</span>
        <div className="ch-legend">
          <span style={{ color: "#ff4d4d" }}>R</span>
          <span style={{ color: "#4dff8a" }}>G</span>
          <span style={{ color: "#4d9fff" }}>B</span>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>L</span>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="color-histogram-canvas"
      />
    </div>
  );
};
