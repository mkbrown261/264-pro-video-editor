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
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    duration?: string;
  }>;
  format?: {
    duration?: string;
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
    hasAudio: Boolean(audioStream)
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

export async function exportSequence(
  request: ExportRequest
): Promise<ExportResponse> {
  const environment = getEnvironmentStatus();

  if (!environment.ffmpegAvailable) {
    throw new Error(environment.warnings[0] || "FFmpeg is unavailable.");
  }

  const { project, outputPath } = request;
  const segments = buildTimelineSegments(project.sequence, project.assets)
    .filter(
      (segment) => segment.track.kind === "video" && segment.clip.isEnabled
    )
    .sort((left, right) => {
      if (left.startFrame !== right.startFrame) {
        return left.startFrame - right.startFrame;
      }

      return left.trackIndex - right.trackIndex;
    });

  if (!segments.length) {
    throw new Error("Nothing is on the timeline. Add clips before exporting.");
  }

  const uniqueAssets = Array.from(
    new Map(segments.map((segment) => [segment.asset.id, segment.asset])).values()
  );
  const assetInputIndexes = new Map(
    uniqueAssets.map((asset, index) => [asset.id, index])
  );
  const filterParts: string[] = [];
  let concatInputs = "";

  for (const [index, segment] of segments.entries()) {
    const inputIndex = assetInputIndexes.get(segment.asset.id);

    if (inputIndex === undefined) {
      throw new Error(`Missing asset input for clip ${segment.clip.id}`);
    }

    const inputLabel = String(inputIndex);
    const start = segment.sourceInSeconds.toFixed(3);
    const end = segment.sourceOutSeconds.toFixed(3);
    const duration = segment.durationSeconds.toFixed(3);
    const clipIndex = String(index);
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
    const videoFilters = [
      `trim=start=${start}:end=${end}`,
      "setpts=PTS-STARTPTS",
      `scale=${project.sequence.settings.width}:${project.sequence.settings.height}:force_original_aspect_ratio=decrease`,
      `pad=${project.sequence.settings.width}:${project.sequence.settings.height}:(ow-iw)/2:(oh-ih)/2`,
      `fps=${project.sequence.settings.fps}`,
      "format=yuv420p"
    ];
    const audioFilters = [
      `atrim=start=${start}:end=${end}`,
      "asetpts=PTS-STARTPTS",
      `aresample=${project.sequence.settings.audioSampleRate}`,
      "aformat=channel_layouts=stereo"
    ];

    if (Number(transitionInSeconds) > 0) {
      videoFilters.push(`fade=t=in:st=0:d=${transitionInSeconds}`);
      audioFilters.push(`afade=t=in:st=0:d=${transitionInSeconds}`);
    }

    if (Number(transitionOutSeconds) > 0) {
      const fadeOutStart = Math.max(
        0,
        segment.durationSeconds - Number(transitionOutSeconds)
      ).toFixed(3);

      videoFilters.push(`fade=t=out:st=${fadeOutStart}:d=${transitionOutSeconds}`);
      audioFilters.push(`afade=t=out:st=${fadeOutStart}:d=${transitionOutSeconds}`);
    }

    filterParts.push(
      `[${inputLabel}:v]${videoFilters.join(",")}[v${clipIndex}]`
    );

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
    `${concatInputs}concat=n=${segments.length}:v=1:a=1[vout][aout]`
  );

  const args = [
    ...uniqueAssets.flatMap((asset) => ["-i", asset.sourcePath]),
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-y",
    outputPath
  ];

  await runProcess(environment.ffmpegPath, args);

  return {
    outputPath,
    commandPreview: `${environment.ffmpegPath} ${args.join(" ")}`
  };
}
