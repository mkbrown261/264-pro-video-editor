import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import type {
  EnvironmentStatus,
  ExportRequest,
  ExportResponse,
  MediaAsset
} from "../src/shared/models.js";
import {
  buildTimelineSegments,
  getClipTransitionDurationFrames,
  normalizeTimelineFps
} from "../src/shared/timeline.js";

interface FfprobeResponse {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    duration?: string;
    channels?: number;
    color_space?: string;
    color_primaries?: string;
    color_transfer?: string;
    sample_aspect_ratio?: string;
    tags?: { rotate?: string; [key: string]: string | undefined };
  }>;
  format?: {
    duration?: string;
    size?: string;
    bit_rate?: string;
  };
}

function createMediaUrl(sourcePath: string): string {
  return `media://asset?path=${encodeURIComponent(sourcePath)}`;
}

function getFfmpegPath(): string {
  return (
    process.env.FFMPEG_PATH ||
    (typeof ffmpegStatic === "string" ? ffmpegStatic : null) ||
    "ffmpeg"
  );
}

function getFfprobePath(): string {
  return process.env.FFPROBE_PATH || ffprobeStatic.path || "ffprobe";
}

function canExecute(binaryPath: string): boolean {
  const result = spawnSync(binaryPath, ["-version"], {
    stdio: "ignore"
  });

  return !result.error && result.status === 0;
}

function parseRate(rate?: string): number {
  if (!rate || rate === "0/0") {
    return 0;
  }

  const [numerator, denominator] = rate.split("/").map(Number);

  if (!numerator || !denominator) {
    return 0;
  }

  return numerator / denominator;
}

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(
        new Error(
          stderr.trim() || `${command} exited with code ${String(code)}`
        )
      );
    });
  });
}

async function generateThumbnail(
  sourcePath: string,
  assetId: string,
  ffmpegPath: string
): Promise<string | null> {
  const thumbnailDirectory = join(tmpdir(), "264-pro-video-editor", "thumbnails");
  const thumbnailPath = join(thumbnailDirectory, `${assetId}.jpg`);

  try {
    await mkdir(thumbnailDirectory, { recursive: true });
    // ⚠️  Put -ss BEFORE -i (input seeking) so FFmpeg jumps to the keyframe
    //    nearest 0.5 s without decoding every preceding frame.  This is the
    //    difference between ~20 ms and ~2 s on a large H.264 file.
    await runProcess(ffmpegPath, [
      "-ss",    "0.5",   // input seek  ← BEFORE -i
      "-i",     sourcePath,
      "-frames:v", "1",
      "-vf",    "scale=640:-1",
      "-q:v",   "2",
      "-y",
      thumbnailPath
    ]);
    return thumbnailPath;
  } catch {
    return null;
  }
}

async function generatePreviewProxy(
  sourcePath: string,
  assetId: string,
  ffmpegPath: string,
  hasAudio: boolean,
  previewFps: number
): Promise<string | null> {
  const previewDirectory = join(tmpdir(), "264-pro-video-editor", "previews");
  const previewPath = join(previewDirectory, `${assetId}.mp4`);

  try {
    await mkdir(previewDirectory, { recursive: true });
    const args = [
      "-i",
      sourcePath,
      "-map",
      "0:v:0",
      "-map_metadata",
      "-1",
      "-map_chapters",
      "-1",
      "-sn",
      "-dn",
      "-vf",
      `scale=1280:-2:force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=${previewFps}`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
    ];

    if (hasAudio) {
      args.push(
        "-map",
        "0:a:0",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-ac",
        "2"
      );
    } else {
      args.push("-an");
    }

    args.push("-y", previewPath);

    await runProcess(ffmpegPath, args);
    return previewPath;
  } catch {
    return null;
  }
}

export function getEnvironmentStatus(): EnvironmentStatus {
  const ffmpegPath = getFfmpegPath();
  const ffprobePath = getFfprobePath();
  const ffmpegAvailable = canExecute(ffmpegPath);
  const ffprobeAvailable = canExecute(ffprobePath);
  const warnings: string[] = [];

  if (!ffmpegAvailable) {
    warnings.push(
      "FFmpeg is unavailable. Install dependencies or set FFMPEG_PATH before exporting."
    );
  }

  if (!ffprobeAvailable) {
    warnings.push(
      "FFprobe is unavailable. Media import will fail until FFprobe is configured."
    );
  }

  return {
    ffmpegAvailable,
    ffprobeAvailable,
    ffmpegPath,
    ffprobePath,
    warnings
  };
}

export async function probeMediaFile(sourcePath: string): Promise<MediaAsset> {
  const environment = getEnvironmentStatus();

  if (!environment.ffprobeAvailable) {
    throw new Error(environment.warnings[0] || "FFprobe is unavailable.");
  }

  const output = await runProcess(environment.ffprobePath, [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    sourcePath
  ]);

  const parsed = JSON.parse(output) as FfprobeResponse;
  const videoStream = parsed.streams?.find(
    (stream) => stream.codec_type === "video"
  );
  const audioStream = parsed.streams?.find(
    (stream) => stream.codec_type === "audio"
  );

  if (!videoStream) {
    throw new Error(`"${basename(sourcePath)}" is not a supported video file.`);
  }

  const durationSeconds = Number(
    parsed.format?.duration || videoStream.duration || 0
  );
  const assetId = randomUUID();
  const nativeFps = parseRate(videoStream.avg_frame_rate || videoStream.r_frame_rate);

  // ── FAST PATH: thumbnail only, no proxy encode ────────────────────────────
  // generatePreviewProxy is very slow (re-encodes the full video).
  // We now return immediately using the source file as previewUrl, then
  // generate the proxy in the background via generateProxiesInBackground().
  const thumbnailPath = environment.ffmpegAvailable
    ? await generateThumbnail(sourcePath, assetId, environment.ffmpegPath)
    : null;

  // ── Extended metadata ─────────────────────────────────────────────────────
  const fileSize = Number(parsed.format?.size || 0) || undefined;
  const bitrate = parsed.format?.bit_rate ? Math.round(Number(parsed.format.bit_rate) / 1000) : undefined;
  const videoCodec = videoStream.codec_name || undefined;
  const audioCodec = audioStream?.codec_name || undefined;
  const audioChannels = audioStream?.channels ? Number(audioStream.channels) : undefined;
  const colorSpace = videoStream.color_space || videoStream.color_primaries || undefined;
  // HDR: bt2020 primaries with PQ/HLG transfer characteristics
  const transfer = videoStream.color_transfer || "";
  const isHDR = Boolean(
    (videoStream.color_primaries === "bt2020" || videoStream.color_space === "bt2020nc") &&
    (transfer === "smpte2084" || transfer === "arib-std-b67" || transfer === "bt2020-10")
  ) || undefined;
  // Rotation from side_data_list or display matrix
  const rotation = videoStream.tags?.rotate ? Number(videoStream.tags.rotate) : undefined;
  const pixelAspect = videoStream.sample_aspect_ratio !== "0:1" ? videoStream.sample_aspect_ratio : undefined;

  return {
    id: assetId,
    name: basename(sourcePath),
    sourcePath,
    // Use source file directly — browser can play most H.264/HEVC/VP9 files
    // natively.  Proxy will replace this once generated in the background.
    previewUrl: createMediaUrl(sourcePath),
    thumbnailUrl: thumbnailPath ? createMediaUrl(thumbnailPath) : null,
    durationSeconds,
    nativeFps,
    width: Number(videoStream.width || 0),
    height: Number(videoStream.height || 0),
    hasAudio: Boolean(audioStream),
    // Extended metadata
    fileSize,
    bitrate,
    videoCodec,
    audioCodec,
    audioChannels,
    colorSpace,
    isHDR,
    rotation,
    pixelAspect,
  };
}

export async function probeMediaFiles(
  sourcePaths: string[]
): Promise<MediaAsset[]> {
  return Promise.all(sourcePaths.map((sourcePath) => probeMediaFile(sourcePath)));
}

/**
 * generateProxiesInBackground
 * ─────────────────────────────────────────────────────────────────────────────
 * Called after probeMediaFiles returns so the renderer is already unblocked.
 * For each asset, generates a 1280px H.264 proxy and calls onProxyReady with
 * the assetId + new previewUrl so the renderer can swap the source URL.
 *
 * Proxies are generated one at a time to avoid saturating the CPU.
 */
export async function generateProxiesInBackground(
  assets: MediaAsset[],
  onProxyReady: (assetId: string, previewUrl: string) => void
): Promise<void> {
  const environment = getEnvironmentStatus();
  if (!environment.ffmpegAvailable) return;

  for (const asset of assets) {
    try {
      const nativeFps = asset.nativeFps || 30;
      const previewFps = normalizeTimelineFps(nativeFps);
      const proxyPath = await generatePreviewProxy(
        asset.sourcePath,
        asset.id,
        environment.ffmpegPath,
        asset.hasAudio,
        previewFps
      );
      if (proxyPath) {
        onProxyReady(asset.id, createMediaUrl(proxyPath));
      }
    } catch {
      // proxy failure is non-fatal — source file is already playing
    }
  }
}

// ── atempo chain helper ───────────────────────────────────────────────────────
// atempo filter only accepts 0.5–2.0. For values outside that range we chain
// multiple atempo filters. E.g. 4x speed = atempo=2.0,atempo=2.0
function buildAtempoChain(speed: number): string {
  const clamped = Math.max(0.1, Math.min(4, speed));
  if (clamped >= 0.5 && clamped <= 2.0) {
    return `atempo=${clamped.toFixed(4)}`;
  }
  const filters: string[] = [];
  let remaining = clamped;
  // Build chain: each stage handles at most 2x (speed > 1) or 0.5x (speed < 1)
  const limit = clamped > 1 ? 2.0 : 0.5;
  while (remaining > 2.0 + 1e-6 || remaining < 0.5 - 1e-6) {
    filters.push(`atempo=${limit}`);
    remaining = clamped > 1 ? remaining / limit : remaining / limit;
  }
  filters.push(`atempo=${remaining.toFixed(4)}`);
  return filters.join(",");
}

export async function exportSequence(
  request: ExportRequest,
  onProgress?: (pct: number) => void
): Promise<ExportResponse> {
  const environment = getEnvironmentStatus();

  if (!environment.ffmpegAvailable) {
    throw new Error(environment.warnings[0] || "FFmpeg is unavailable.");
  }

  const { project, outputPath } = request;
  const codec = request.codec ?? "libx264";

  // Determine output resolution
  const seqW = project.sequence.settings.width;
  const seqH = project.sequence.settings.height;
  const outW = (request.outputWidth && request.outputWidth > 0) ? request.outputWidth : seqW;
  const outH = (request.outputHeight && request.outputHeight > 0) ? request.outputHeight : seqH;

  // Build segments from ALL tracks (video + audio)
  const allSegments = buildTimelineSegments(project.sequence, project.assets)
    .filter((segment) => segment.clip.isEnabled)
    .sort((left, right) => {
      if (left.startFrame !== right.startFrame) {
        return left.startFrame - right.startFrame;
      }
      return left.trackIndex - right.trackIndex;
    });

  // Primary video segments (top video track per timeline frame)
  // For export we take the topmost video clip at each position.
  // We flatten: sort all video segments by startFrame then trackIndex,
  // and include them all (FFmpeg concat handles it sequentially).
  const videoSegments = allSegments.filter((s) => s.track.kind === "video");

  if (!videoSegments.length) {
    throw new Error("Nothing is on the timeline. Add clips before exporting.");
  }

  // Deduplicate assets used across video segments (audio-only clips may reuse same asset)
  const uniqueAssets = Array.from(
    new Map(allSegments.map((segment) => [segment.asset.id, segment.asset])).values()
  );
  const assetInputIndexes = new Map(
    uniqueAssets.map((asset, index) => [asset.id, index])
  );
  const filterParts: string[] = [];
  let concatInputs = "";

  for (const [index, segment] of videoSegments.entries()) {
    const inputIndex = assetInputIndexes.get(segment.asset.id);

    if (inputIndex === undefined) {
      throw new Error(`Missing asset input for clip ${segment.clip.id}`);
    }

    const inputLabel = String(inputIndex);
    const start = segment.sourceInSeconds.toFixed(3);
    const end = segment.sourceOutSeconds.toFixed(3);
    const duration = segment.durationSeconds.toFixed(3);
    const clipIndex = String(index);
    const speed = Math.max(0.1, Math.min(4, segment.clip.speed ?? 1));

    const transitionInSeconds = (
      getClipTransitionDurationFrames(
        segment.clip.transitionIn,
        segment.durationFrames
      ) / project.sequence.settings.fps
    ).toFixed(3);
    const transitionOutSeconds = (
      getClipTransitionDurationFrames(
        segment.clip.transitionOut,
        segment.durationFrames
      ) / project.sequence.settings.fps
    ).toFixed(3);

    // ── Video filter chain ─────────────────────────────────────────────────
    const videoFilters = [
      `trim=start=${start}:end=${end}`,
      // Speed: setpts changes presentation timestamps
      speed !== 1 ? `setpts=PTS/${speed.toFixed(4)}` : "setpts=PTS-STARTPTS",
    ];
    // If we used speed-adjusted setpts, we still need to reset to 0
    if (speed !== 1) {
      videoFilters.push("setpts=PTS-STARTPTS");
    }
    videoFilters.push(
      `scale=${outW}:${outH}:force_original_aspect_ratio=decrease`,
      `pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2`,
      `fps=${project.sequence.settings.fps}`,
      "format=yuv420p"
    );

    // ── Transform ─────────────────────────────────────────────────────────
    const t = segment.clip.transform;
    if (t) {
      const sx = t.scaleX ?? 1;
      const sy = t.scaleY ?? 1;
      const rot = t.rotation ?? 0;
      const opacity = t.opacity ?? 1;
      const posX = t.posX ?? 0;
      const posY = t.posY ?? 0;

      if (sx !== 1 || sy !== 1) {
        videoFilters.push(`scale=iw*${sx.toFixed(4)}:ih*${sy.toFixed(4)}`);
      }
      if (rot !== 0) {
        videoFilters.push(`rotate=${rot}*(PI/180):fillcolor=black@0`);
      }
      if (posX !== 0 || posY !== 0) {
        // Pan: use pad+overlay
        const xPx = Math.round(posX * outW * 0.5);
        const yPx = Math.round(posY * outH * 0.5);
        videoFilters.push(`pad=${outW}:${outH}:${outW / 2 - outW / 2 + xPx}:${outH / 2 - outH / 2 + yPx}`);
      }
      if (opacity < 1) {
        videoFilters.push(`colorchannelmixer=aa=${opacity.toFixed(4)}`);
      }
    }

    // ── Color Grade ───────────────────────────────────────────────────────
    const cg = segment.clip.colorGrade;
    if (cg && !cg.bypass) {
      // exposure → eq brightness
      if (cg.exposure !== 0) {
        const ev = Math.pow(2, cg.exposure);
        videoFilters.push(`exposure=exposure=${cg.exposure.toFixed(3)}`);
        void ev; // acknowledged
      }
      // contrast via eq
      if (cg.contrast !== 0) {
        const ffContrast = 1 + cg.contrast;
        videoFilters.push(`eq=contrast=${ffContrast.toFixed(3)}`);
      }
      // saturation via hue filter or eq
      if (cg.saturation !== 1) {
        videoFilters.push(`hue=s=${cg.saturation.toFixed(3)}`);
      }
      // temperature: warm (positive) → boost red/reduce blue
      if (cg.temperature !== 0) {
        const rBoost = (cg.temperature / 100) * 0.1;
        const bBoost = -(cg.temperature / 100) * 0.1;
        videoFilters.push(
          `colorbalance=rs=${rBoost.toFixed(3)}:gs=0:bs=${bBoost.toFixed(3)}:rm=${rBoost.toFixed(3)}:gm=0:bm=${bBoost.toFixed(3)}:rh=${rBoost.toFixed(3)}:gh=0:bh=${bBoost.toFixed(3)}`
        );
      }
      // lift/gamma/gain color wheels via colorlevels
      const { lift, gamma: gm, gain } = cg;
      const hasWheels =
        lift.r !== 0 || lift.g !== 0 || lift.b !== 0 ||
        gm.r !== 0 || gm.g !== 0 || gm.b !== 0 ||
        gain.r !== 0 || gain.g !== 0 || gain.b !== 0;
      if (hasWheels) {
        // colorlevels: rimin/rimax/romin/romax for input/output range per channel
        // Simplified: use lift→input min raise, gain→output max scale
        const riminR = Math.max(0, lift.r * 0.25).toFixed(3);
        const riminG = Math.max(0, lift.g * 0.25).toFixed(3);
        const riminB = Math.max(0, lift.b * 0.25).toFixed(3);
        const romaxR = Math.min(1, 1 + gain.r * 0.25).toFixed(3);
        const romaxG = Math.min(1, 1 + gain.g * 0.25).toFixed(3);
        const romaxB = Math.min(1, 1 + gain.b * 0.25).toFixed(3);
        videoFilters.push(
          `colorlevels=rimin=${riminR}:gimin=${riminG}:bimin=${riminB}:romax=${romaxR}:gomax=${romaxG}:bomax=${romaxB}`
        );
      }
    }

    if (Number(transitionInSeconds) > 0) {
      videoFilters.push(`fade=t=in:st=0:d=${transitionInSeconds}`);
    }
    if (Number(transitionOutSeconds) > 0) {
      const fadeOutStart = Math.max(
        0,
        segment.durationSeconds - Number(transitionOutSeconds)
      ).toFixed(3);
      videoFilters.push(`fade=t=out:st=${fadeOutStart}:d=${transitionOutSeconds}`);
    }

    filterParts.push(
      `[${inputLabel}:v]${videoFilters.join(",")}[v${clipIndex}]`
    );

    // ── Audio filter chain ─────────────────────────────────────────────────
    const volume = Math.max(0, Math.min(2, segment.clip.volume ?? 1));
    const audioFilters = [
      `atrim=start=${start}:end=${end}`,
      "asetpts=PTS-STARTPTS",
    ];
    if (speed !== 1) {
      audioFilters.push(buildAtempoChain(speed));
    }
    if (volume !== 1) {
      audioFilters.push(`volume=${volume.toFixed(4)}`);
    }
    audioFilters.push(
      `aresample=${project.sequence.settings.audioSampleRate}`,
      "aformat=channel_layouts=stereo"
    );

    if (Number(transitionInSeconds) > 0) {
      audioFilters.push(`afade=t=in:st=0:d=${transitionInSeconds}`);
    }
    if (Number(transitionOutSeconds) > 0) {
      const fadeOutStart = Math.max(
        0,
        segment.durationSeconds - Number(transitionOutSeconds)
      ).toFixed(3);
      audioFilters.push(`afade=t=out:st=${fadeOutStart}:d=${transitionOutSeconds}`);
    }

    if (segment.asset.hasAudio) {
      filterParts.push(
        `[${inputLabel}:a]${audioFilters.join(",")}[a${clipIndex}]`
      );
    } else {
      filterParts.push(
        `anullsrc=r=${project.sequence.settings.audioSampleRate}:cl=stereo,atrim=end=${duration}[a${clipIndex}]`
      );
    }

    concatInputs += `[v${clipIndex}][a${clipIndex}]`;
  }

  filterParts.push(
    `${concatInputs}concat=n=${videoSegments.length}:v=1:a=1[vout][aout]`
  );

  // ── Codec-specific output args ─────────────────────────────────────────────
  function getVideoCodecArgs(c: typeof codec): string[] {
    switch (c) {
      case "libx265":
        return ["-c:v", "libx265", "-preset", "medium", "-crf", "22", "-tag:v", "hvc1"];
      case "prores_ks":
        return ["-c:v", "prores_ks", "-profile:v", "3", "-vendor", "apl0", "-bits_per_mb", "8000", "-pix_fmt", "yuv422p10le"];
      case "libvpx-vp9":
        return ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-deadline", "good", "-cpu-used", "2"];
      case "libx264":
      default:
        return ["-c:v", "libx264", "-preset", "medium", "-crf", "18"];
    }
  }
  function getAudioCodecArgs(c: typeof codec): string[] {
    switch (c) {
      case "prores_ks":
        return ["-c:a", "pcm_s16le"];
      case "libvpx-vp9":
        return ["-c:a", "libopus", "-b:a", "192k"];
      default:
        return ["-c:a", "aac", "-b:a", "192k"];
    }
  }
  function getContainerArgs(c: typeof codec): string[] {
    switch (c) {
      case "prores_ks":
        return ["-movflags", "+faststart"];
      case "libvpx-vp9":
        return [];
      default:
        return ["-movflags", "+faststart"];
    }
  }

  const args = [
    ...uniqueAssets.flatMap((asset) => ["-i", asset.sourcePath]),
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    ...getVideoCodecArgs(codec),
    ...getAudioCodecArgs(codec),
    ...getContainerArgs(codec),
    "-y",
    outputPath
  ];

  // ── Spawn FFmpeg with progress parsing ─────────────────────────────────────
  // Calculate total frames for progress reporting
  const totalFrames = videoSegments.reduce((sum, s) => sum + s.durationFrames, 0);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(environment.ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stdout.on("data", () => { /* no-op */ });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      // Parse frame=N from FFmpeg progress output
      if (onProgress && totalFrames > 0) {
        const match = /frame=\s*(\d+)/.exec(text);
        if (match) {
          const frame = Number(match[1]);
          const pct = Math.min(99, Math.round((frame / totalFrames) * 100));
          onProgress(pct);
        }
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        if (onProgress) onProgress(100);
        resolve();
      } else {
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${String(code)}`));
      }
    });
  });

  return {
    outputPath,
    commandPreview: `${environment.ffmpegPath} ${args.join(" ")}`
  };
}
