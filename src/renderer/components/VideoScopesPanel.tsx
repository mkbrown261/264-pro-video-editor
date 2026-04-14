/**
 * VideoScopesPanel — Professional video scopes for 264 Pro.
 * Three real scopes, all reading live pixel data from a <video> element
 * via Canvas2D — same pattern as ColorHistogram.
 *
 * Scopes:
 *   • Waveform Monitor  — luma density plot, X=frame column, Y=IRE
 *   • Vectorscope       — YCbCr chroma plot with colour targets
 *   • RGB Parade        — R / G / B waveforms side-by-side
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

export interface VideoScopesPanelProps {
  /** The live video element to sample */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Canvas width in px */
  width?: number;
  /** Canvas height in px */
  height?: number;
  /** Refresh interval in ms */
  refreshMs?: number;
}

// ─── Waveform ────────────────────────────────────────────────────────────────

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  w: number,
  h: number
) {
  const sW = Math.min(video.videoWidth || 320, 320);
  const sH = Math.min(video.videoHeight || 180, 180);
  const off = document.createElement("canvas");
  off.width = sW;
  off.height = sH;
  const octx = off.getContext("2d");
  if (!octx) return;
  try {
    octx.drawImage(video, 0, 0, sW, sH);
  } catch {
    return;
  }
  const pixels = octx.getImageData(0, 0, sW, sH).data;

  ctx.fillStyle = "#0a0a0f";
  ctx.fillRect(0, 0, w, h);

  // Subtle grid
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  [0, 25, 50, 75, 100].forEach((ire) => {
    const y = Math.round(h - (ire / 100) * h) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  });

  // Legal-range limit lines (red at 0 and 100 IRE)
  ctx.strokeStyle = "rgba(255,70,70,0.55)";
  [0, 100].forEach((ire) => {
    const y = Math.round(h - (ire / 100) * h) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  });

  // Plot waveform dots
  for (let px = 0; px < sW; px++) {
    const xDraw = Math.floor((px / sW) * w);
    for (let py = 0; py < sH; py++) {
      const idx = (py * sW + px) * 4;
      const luma =
        (0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2]) /
        255;
      const yDraw = Math.floor((1 - luma) * (h - 1));
      ctx.fillStyle = "rgba(200,200,200,0.12)";
      ctx.fillRect(xDraw, yDraw, 1, 1);
    }
  }

  // IRE labels
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = "9px monospace";
  ctx.fillText("100", 3, 10);
  ctx.fillText("75", 3, Math.round(h * 0.25) - 1);
  ctx.fillText("50", 3, Math.round(h * 0.5) + 4);
  ctx.fillText("25", 3, Math.round(h * 0.75) + 4);
  ctx.fillText("0", 3, h - 3);
}

// ─── Vectorscope ─────────────────────────────────────────────────────────────

function drawVectorscope(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  w: number,
  h: number
) {
  const sW = Math.min(video.videoWidth || 320, 160);
  const sH = Math.min(video.videoHeight || 180, 90);
  const off = document.createElement("canvas");
  off.width = sW;
  off.height = sH;
  const octx = off.getContext("2d");
  if (!octx) return;
  try {
    octx.drawImage(video, 0, 0, sW, sH);
  } catch {
    return;
  }
  const pixels = octx.getImageData(0, 0, sW, sH).data;

  ctx.fillStyle = "#0a0a0f";
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - 12;

  // Outer circle
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // 75% safe-zone circle
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.75, 0, Math.PI * 2);
  ctx.stroke();

  // 50% inner circle
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
  ctx.stroke();

  // Crosshairs
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();

  // Diagonal guides
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  [45, 135].forEach((deg) => {
    const rad = (deg * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(rad) * r, cy - Math.sin(rad) * r);
    ctx.lineTo(cx + Math.cos(rad) * r, cy + Math.sin(rad) * r);
    ctx.stroke();
  });

  // Colour targets at 75% saturation (standard YUV angles)
  const targets = [
    { label: "R",  angle: -0.33, color: "#ff5555" },
    { label: "Mg", angle: -1.05, color: "#ff55ff" },
    { label: "B",  angle: -1.78, color: "#5588ff" },
    { label: "Cy", angle:  2.14, color: "#55ffff" },
    { label: "G",  angle:  1.41, color: "#55ff55" },
    { label: "Yl", angle:  0.67, color: "#ffff55" },
  ];

  targets.forEach((t) => {
    const tx = cx + Math.cos(t.angle) * r * 0.75;
    const ty = cy + Math.sin(t.angle) * r * 0.75;
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(tx - 4, ty - 4, 8, 8);
    ctx.fillStyle = t.color;
    ctx.font = "8px monospace";
    ctx.fillText(t.label, tx + 6, ty + 3);
  });

  // Skin-tone line (~10:30 position, ~128° from positive-U axis)
  ctx.strokeStyle = "rgba(255,200,120,0.35)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  const skinAngle = (128 * Math.PI) / 180;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(skinAngle) * r, cy + Math.sin(skinAngle) * r);
  ctx.stroke();
  ctx.setLineDash([]);

  // Plot every pixel as a Cb/Cr dot
  for (let i = 0; i < pixels.length; i += 4) {
    const R = pixels[i] / 255;
    const G = pixels[i + 1] / 255;
    const B = pixels[i + 2] / 255;
    // RGB → YCbCr (BT.601)
    const Cb = -0.169 * R - 0.331 * G + 0.500 * B;
    const Cr =  0.500 * R - 0.419 * G - 0.081 * B;
    const px2 = cx + Cb * r * 2;
    const py2 = cy - Cr * r * 2;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(px2, py2, 1, 1);
  }

  // Centre dot
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillRect(cx - 1, cy - 1, 2, 2);
}

// ─── RGB Parade ───────────────────────────────────────────────────────────────

function drawParade(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  w: number,
  h: number
) {
  const sW = Math.min(video.videoWidth || 320, 320);
  const sH = Math.min(video.videoHeight || 180, 180);
  const off = document.createElement("canvas");
  off.width = sW;
  off.height = sH;
  const octx = off.getContext("2d");
  if (!octx) return;
  try {
    octx.drawImage(video, 0, 0, sW, sH);
  } catch {
    return;
  }
  const pixels = octx.getImageData(0, 0, sW, sH).data;

  ctx.fillStyle = "#0a0a0f";
  ctx.fillRect(0, 0, w, h);

  // Each channel gets a third of the canvas width with a 1-px gap
  const GAP = 2;
  const colW = Math.floor((w - GAP * 2) / 3);

  const channels = [
    { chIdx: 0, label: "R", dotColor: "rgba(255,80,80,0.16)",  xOffset: 0 },
    { chIdx: 1, label: "G", dotColor: "rgba(80,220,80,0.14)",  xOffset: colW + GAP },
    { chIdx: 2, label: "B", dotColor: "rgba(80,140,255,0.16)", xOffset: colW * 2 + GAP * 2 },
  ];

  channels.forEach(({ chIdx, label, dotColor, xOffset }) => {
    // Subtle grid inside each column
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    [0, 25, 50, 75, 100].forEach((ire) => {
      const y = Math.round(h - (ire / 100) * h) + 0.5;
      ctx.beginPath();
      ctx.moveTo(xOffset, y);
      ctx.lineTo(xOffset + colW, y);
      ctx.stroke();
    });

    // 0 / 100 limit lines
    ctx.strokeStyle = "rgba(255,70,70,0.4)";
    [0, 100].forEach((ire) => {
      const y = Math.round(h - (ire / 100) * h) + 0.5;
      ctx.beginPath();
      ctx.moveTo(xOffset, y);
      ctx.lineTo(xOffset + colW, y);
      ctx.stroke();
    });

    // Plot channel waveform dots
    ctx.fillStyle = dotColor;
    for (let px = 0; px < sW; px++) {
      const xDraw = xOffset + Math.floor((px / sW) * colW);
      for (let py = 0; py < sH; py++) {
        const idx = (py * sW + px) * 4;
        const val = pixels[idx + chIdx] / 255;
        const yDraw = Math.floor((1 - val) * (h - 1));
        ctx.fillRect(xDraw, yDraw, 1, 1);
      }
    }

    // Channel label
    ctx.fillStyle =
      chIdx === 0
        ? "rgba(255,100,100,0.75)"
        : chIdx === 1
        ? "rgba(100,220,100,0.75)"
        : "rgba(100,160,255,0.75)";
    ctx.font = "bold 9px monospace";
    ctx.fillText(label, xOffset + 3, 11);

    // 100 / 0 IRE labels
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "8px monospace";
    ctx.fillText("100", xOffset + 3, 20);
    ctx.fillText("0", xOffset + 3, h - 3);
  });

  // Vertical dividers between channels
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  [colW + GAP / 2, colW * 2 + GAP + GAP / 2].forEach((x) => {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

type ScopeType = "waveform" | "vectorscope" | "parade";

export const VideoScopesPanel: React.FC<VideoScopesPanelProps> = ({
  videoRef,
  width = 320,
  height = 160,
  refreshMs = 150,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeScope, setActiveScope] = useState<ScopeType>("waveform");

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || video.readyState < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (activeScope === "waveform") {
      drawWaveform(ctx, video, width, height);
    } else if (activeScope === "vectorscope") {
      drawVectorscope(ctx, video, width, height);
    } else {
      drawParade(ctx, video, width, height);
    }
  }, [activeScope, videoRef, width, height]);

  useEffect(() => {
    const id = setInterval(draw, refreshMs);
    return () => clearInterval(id);
  }, [draw, refreshMs]);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "3px 10px",
    fontSize: 10,
    fontWeight: 700,
    cursor: "pointer",
    background: active ? "#1e3a5f" : "transparent",
    color: active ? "#60a5fa" : "#475569",
    border: "none",
    borderRadius: 4,
    letterSpacing: "0.04em",
    transition: "background 0.15s, color 0.15s",
  });

  return (
    <div
      style={{
        background: "#0a0a0f",
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid #1e293b",
        userSelect: "none",
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "4px 6px",
          borderBottom: "1px solid #1e293b",
          background: "#0d1117",
        }}
      >
        <span
          style={{
            fontSize: 9,
            color: "#334155",
            fontWeight: 800,
            letterSpacing: "0.1em",
            marginRight: 6,
          }}
        >
          SCOPES
        </span>
        {(["waveform", "vectorscope", "parade"] as const).map((s) => (
          <button
            key={s}
            style={tabStyle(activeScope === s)}
            onClick={() => setActiveScope(s)}
            type="button"
          >
            {s === "waveform"
              ? "Waveform"
              : s === "vectorscope"
              ? "Vector"
              : "Parade"}
          </button>
        ))}
      </div>

      {/* Scope canvas */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ display: "block" }}
      />
    </div>
  );
};
