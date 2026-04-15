import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { app } from "electron";
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

// True packaged build = app.isPackaged AND no dev server running
const IS_PACKAGED = app.isPackaged && !process.env.VITE_DEV_SERVER_URL;

function getFfmpegPath(): string {
  // 1. Explicit override
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;

  // 2. True packaged build — binary is in extraResources
  if (IS_PACKAGED) {
    const suffix = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    return join(process.resourcesPath, "ffmpeg-static", suffix);
  }

  // 3. Dev — ffmpeg-static npm package resolves to node_modules
  if (typeof ffmpegStatic === "string" && ffmpegStatic) return ffmpegStatic;

  // 4. System fallback
  return "ffmpeg";
}

function getFfprobePath(): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;

  if (IS_PACKAGED) {
    const suffix = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
    const platform = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    return join(process.resourcesPath, "ffprobe-static", "bin", platform, arch, suffix);
  }

  return ffprobeStatic.path || "ffprobe";
}

// ── Hardware encoder detection ────────────────────────────────────────────────
// Cache result so we only probe once per session
let _hwEncoderCache: string | null | undefined = undefined;

export async function detectBestHWEncoder(): Promise<string | null> {
  if (_hwEncoderCache !== undefined) return _hwEncoderCache;

  const ffmpegBin = getFfmpegPath();

  // Encoder preference order: videotoolbox (Mac) > nvenc (NVIDIA) > amf (AMD) > qsv (Intel)
  const candidates =
    process.platform === "darwin"
      ? ["h264_videotoolbox"]
      : process.platform === "win32"
      ? ["h264_nvenc", "h264_amf", "h264_qsv"]
      : ["h264_nvenc", "h264_vaapi", "h264_qsv"];

  for (const enc of candidates) {
    const available = await new Promise<boolean>((resolve) => {
      // Test encoder with a 1-frame null source
      const proc = spawn(ffmpegBin, [
        "-f", "lavfi", "-i", "color=black:s=64x64:r=1",
        "-vframes", "1",
        "-c:v", enc,
        "-f", "null", "-",
      ]);
      let stderr = "";
      proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.on("close", (code: number | null) => {
        // nvenc/videotoolbox will succeed (code 0) if hardware is present
        resolve(
          code === 0 &&
          !stderr.includes("Unknown encoder") &&
          !stderr.includes("Encoder h264")
        );
      });
      proc.on("error", () => resolve(false));
      // Timeout after 3s
      setTimeout(() => { proc.kill(); resolve(false); }, 3000);
    });
    if (available) {
      _hwEncoderCache = enc;
      return enc;
    }
  }

  _hwEncoderCache = null;
  return null;
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
      `FFmpeg is unavailable at "${ffmpegPath}". ${app.isPackaged ? "This is a packaging issue — please reinstall 264 Pro." : "Run: npm install ffmpeg-static"}`
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

// ── Active child process registry (for kill-on-quit) ─────────────────────────
const _activeChildren = new Set<import("node:child_process").ChildProcess>();

/** Kill all active FFmpeg child processes — called on app will-quit. */
export function killAllActiveProcesses(): void {
  for (const child of _activeChildren) {
    try { child.kill("SIGKILL"); } catch { /* already dead */ }
  }
  _activeChildren.clear();
}

// ── Transition filter helper ──────────────────────────────────────────────────
// Returns the appropriate FFmpeg video filter string for a clip's transition-in.
// Note: xfade technically requires two input streams and is best applied between
// clips in a more complex filter graph. Here we apply it per-clip as a reasonable
// approximation; the offset=0 means the effect plays from the clip's own start.
// fade=t=out is kept as-is for transition-out since xfade needs a second stream.
function getXfadeFilter(transitionType: string | undefined, durationSec: number): string {
  if (!transitionType || durationSec <= 0) return `fade=t=in:st=0:d=${durationSec}`;
  switch (transitionType) {
    case "whip_smear":          return `xfade=transition=slideleft:duration=${durationSec}:offset=0`;
    case "light_leak_dissolve": return `xfade=transition=fadewhite:duration=${durationSec}:offset=0`;
    case "digital_shatter":     return `xfade=transition=horzopen:duration=${durationSec}:offset=0`;
    default:                    return `fade=t=in:st=0:d=${durationSec}`;
  }
}

// ── Speed ramp: compute weighted-average speed from keyframes ─────────────────
// FFmpeg doesn't natively support per-frame speed variation in a simple filter
// graph, so we compute the time-weighted average speed across all keyframe
// segments and use that as the effective speed for setpts / atempo.
function buildSpeedRampFilter(
  keyframes: Array<{ frame: number; speed: number }>,
  totalFrames: number,
  fps: number
): string {
  if (!keyframes || keyframes.length < 2) return '';
  const kfs = [...keyframes].sort((a, b) => a.frame - b.frame);
  const totalDuration = totalFrames / fps;
  let weightedSpeed = 0;
  for (let i = 0; i < kfs.length - 1; i++) {
    const segStart = kfs[i].frame / fps;
    const segEnd = kfs[i + 1].frame / fps;
    const segDuration = segEnd - segStart;
    const avgSegSpeed = (kfs[i].speed + kfs[i + 1].speed) / 2;
    weightedSpeed += avgSegSpeed * (segDuration / totalDuration);
  }
  const clamped = Math.max(0.1, Math.min(4, weightedSpeed));
  return clamped.toFixed(4);
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
  // BUG #17 fix: cap iterations to prevent infinite loop near boundary values
  const MAX_ATEMPO_STAGES = 10;
  let iterations = 0;
  while ((remaining > 2.0 + 1e-6 || remaining < 0.5 - 1e-6) && iterations++ < MAX_ATEMPO_STAGES) {
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

  // BUG #23 fix: ensure output directory exists before spawning FFmpeg
  try {
    await mkdir(dirname(outputPath), { recursive: true });
  } catch {
    // Directory already exists or creation failed — FFmpeg will report the real error
  }

  // Determine output resolution
  const seqW = project.sequence.settings.width;
  const seqH = project.sequence.settings.height;
  const outW = (request.outputWidth && request.outputWidth > 0) ? request.outputWidth : seqW;
  const outH = (request.outputHeight && request.outputHeight > 0) ? request.outputHeight : seqH;

  // BUG #3 fix: need sequenceFps for audio-only track adelay calculation
  const sequenceFps = project.sequence.settings.fps;

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
    // Use speed ramp keyframes (weighted-average) when present, otherwise flat speed
    const effectiveSpeed = (() => {
      const kfs = segment.clip.speedRampKeyframes;
      if (kfs && kfs.length >= 2) {
        const clipFrames = segment.durationFrames ??
          Math.round(segment.durationSeconds * sequenceFps);
        const rampSpeed = parseFloat(buildSpeedRampFilter(kfs, clipFrames, sequenceFps));
        return isFinite(rampSpeed) && rampSpeed > 0 ? rampSpeed : Math.max(0.1, Math.min(4, segment.clip.speed ?? 1));
      }
      return Math.max(0.1, Math.min(4, segment.clip.speed ?? 1));
    })();
    const speed = effectiveSpeed;

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
      // BUG #1 fix: single combined setpts — (PTS-STARTPTS)/speed resets origin
      // AND applies speed in one step. The previous two-step approach had the
      // second setpts=PTS-STARTPTS silently overwriting the first speed-adjusted one.
      `setpts=(PTS-STARTPTS)/${speed.toFixed(4)}`,
    ];
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
        // BUG #2 fix: colorchannelmixer=aa= requires alpha channel but the chain
        // already applied format=yuv420p (no alpha). Use eq=brightness instead
        // to approximate opacity on yuv420p — not pixel-perfect alpha but gives
        // correct visual opacity reduction.
        const br = (opacity - 1).toFixed(4); // 0 = no change, -1 = black
        videoFilters.push(`eq=brightness=${br}`);
      }
    }

    // ── Color Grade ───────────────────────────────────────────────────────
    const cg = segment.clip.colorGrade;
    if (cg && !cg.bypass) {
      // BUG #13 fix: exposure=exposure= filter only available in FFmpeg 5.1+.
      // Replace with eq=brightness= which is compatible with all FFmpeg versions.
      if (cg.exposure !== 0) {
        const brightnessAdj = (cg.exposure * 0.1).toFixed(3); // scale EV stops to brightness range
        videoFilters.push(`eq=brightness=${brightnessAdj}`);
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
        // BUG #4 fix: gamma wheel was extracted but never applied to the filter chain.
        // Apply gamma per-channel via eq=gamma_r/g/b.
        const gammaR = Math.max(0.1, 1 + gm.r * 0.5);
        const gammaG = Math.max(0.1, 1 + gm.g * 0.5);
        const gammaB = Math.max(0.1, 1 + gm.b * 0.5);
        if (Math.abs(gm.r) > 0.01 || Math.abs(gm.g) > 0.01 || Math.abs(gm.b) > 0.01) {
          videoFilters.push(`eq=gamma_r=${gammaR.toFixed(3)}:gamma_g=${gammaG.toFixed(3)}:gamma_b=${gammaB.toFixed(3)}`);
        }
      }
    }

    // ── Clip effects (professional effects) ─────────────────
    if (segment.clip.effects && segment.clip.effects.length > 0) {
      for (const effect of segment.clip.effects.filter(e => e.enabled)) {
        switch (effect.type) {
          case "noise_reduction": {
            const nr_r = Number(effect.params?.spatialRadius ?? 5);
            videoFilters.push(`hqdn3d=${nr_r}:${nr_r}:${(nr_r * 1.5).toFixed(1)}:${(nr_r * 1.5).toFixed(1)}`);
            break;
          }
          case "sharpening": {
            const sh_amt = Number(effect.params?.amount ?? 1);
            videoFilters.push(`unsharp=5:5:${sh_amt}:5:5:0`);
            break;
          }
          case "vignette": {
            const v_str = Number(effect.params?.strength ?? 0.5);
            videoFilters.push(`vignette=angle=${(Math.PI * v_str / 2).toFixed(4)}:mode=backward`);
            break;
          }
          case "film_grain": {
            const fg_amt = Number(effect.params?.amount ?? 0.3);
            videoFilters.push(`noise=c0s=${Math.round(fg_amt * 40)}:c0f=t+u`);
            break;
          }
          case "lens_distortion": {
            // barrel/pincushion via lenscorrection
            const dist = Number(effect.params?.distortion ?? 0);
            if (Math.abs(dist) > 0.01) {
              videoFilters.push(`lenscorrection=k1=${dist.toFixed(3)}:k2=0`);
            }
            break;
          }
          case "blur": {
            const blurAmt = Number(effect.params?.amount ?? 2);
            videoFilters.push(`boxblur=${Math.round(blurAmt)}`);
            break;
          }
          // Phase 6: Signature effects
          case "glitch_storm": {
            const rgbOffset = Math.round(Number(effect.params?.rgbSplit ?? 0.3) * 20);
            const noiseAmt = Math.round(Number(effect.params?.intensity ?? 0.5) * 40);
            if (rgbOffset > 0) {
              // RGB split approximation: shift red channel and add noise
              videoFilters.push(`rgbashift=rh=${rgbOffset}:bh=-${rgbOffset}`);
            }
            videoFilters.push(`noise=alls=${noiseAmt}:allf=t`);
            break;
          }
          case "analog_dream": {
            const grain = Math.round(Number(effect.params?.grainAmount ?? 0.5) * 30);
            const colorShift = String(effect.params?.colorShift ?? "warm");
            const warmth = colorShift === "warm" ? 0.15 : colorShift === "cool" ? -0.1 : 0.05;
            const sat = colorShift === "faded" ? 0.6 : 1.1;
            videoFilters.push(`noise=alls=${grain}:allf=t`);
            videoFilters.push(`hue=s=${sat}`);
            videoFilters.push(`eq=brightness=${warmth.toFixed(3)}:contrast=1.05:gamma_r=${(1 + warmth).toFixed(3)}:gamma_b=${(1 - warmth * 0.5).toFixed(3)}`);
            videoFilters.push(`vignette=PI/4`);
            break;
          }
          case "clawflow_style": {
            // Stub: ClawFlow AI style transfer requires Higgsfield/Replicate API
            // Apply a basic approximation based on style for offline preview
            const style = String(effect.params?.style ?? "anime");
            if (style === "cinematic_bw") {
              videoFilters.push(`hue=s=0`);
              videoFilters.push(`eq=contrast=1.3:brightness=-0.05`);
            } else if (style === "cyberpunk") {
              videoFilters.push(`hue=h=210:s=1.5`);
              videoFilters.push(`eq=contrast=1.2`);
            } else if (style === "neon_noir") {
              videoFilters.push(`hue=s=1.3`);
              videoFilters.push(`eq=brightness=-0.1:contrast=1.3`);
            } else {
              // General artistic approximation
              videoFilters.push(`edgedetect=mode=colormix:high=0.1`);
            }
            break;
          }
          case "film_look_creator": {
            // Organic film look: grain + slight curves + subtle vignette
            const intensity = Math.min(1, Math.max(0, Number(effect.params?.intensity ?? 50) / 100));
            const grainStr = (intensity * 20).toFixed(1);
            videoFilters.push(`noise=alls=${grainStr}:allf=t`);
            videoFilters.push(`vignette=angle=PI/4:x0=w/2:y0=h/2:mode=forward:eval=frame`);
            videoFilters.push(`curves=all='0/0 0.3/${(0.27 + intensity * 0.03).toFixed(2)} 0.7/${(0.68 + intensity * 0.02).toFixed(2)} 1/1'`);
            break;
          }
          case "face_refinement": {
            // Soft skin smoothing via bilateral-style blur + slight sharpen on edges
            videoFilters.push(`smartblur=lr=1.0:ls=-1.0:cr=0.9:cs=-0.3`);
            break;
          }
          case "defocus_background": {
            // Center-sharp, edges blurred — simulates shallow DoF
            const strength = Math.min(10, Math.max(1, Math.round(Number(effect.params?.intensity ?? 50) / 10)));
            videoFilters.push(`boxblur=${strength}:1`);
            videoFilters.push(`overlay=0:0`); // placeholder — full ML version requires segmentation
            break;
          }
          default:
            break;
        }
      }
    }

    // ── Optical Flow slow-mo ────────────────────────────────────────────────
    // Only apply when:
    // 1. opticalFlow is enabled
    // 2. Speed is less than 1 (slow motion) — optical flow synthesizes missing frames
    // 3. We need it AFTER setpts (speed) so minterpolate gets the already-slowed stream
    if (segment.clip.opticalFlow && (segment.clip.speed ?? 1) < 1) {
      const quality = segment.clip.opticalFlowQuality ?? 'good';
      // Guard: speed must be > 0 to avoid division by zero in interpolatedFps calculation
      const speed = Math.max(0.01, Math.min(0.999, segment.clip.speed ?? 0.5));

      // Target output FPS: synthesize enough frames to reach at least 60fps equivalent
      // E.g. 30fps source at 0.25x speed → need 4x frames → target 120fps, output at 30fps
      const sourceFps = Math.max(1, project.sequence.settings.fps);
      const interpolatedFps = Math.min(120, Math.round(sourceFps / speed));

      switch (quality) {
        case 'draft':
          // Fast: simple frame blending — good for preview, not for export
          videoFilters.push(
            `minterpolate='fps=${interpolatedFps}:mi_mode=blend'`
          );
          break;

        case 'good':
          // Balanced: Motion Compensated Interpolation with OBMC
          // This is the FlowWarp at good quality
          videoFilters.push(
            `minterpolate='fps=${interpolatedFps}:mi_mode=mci:mc_mode=aobmc:me_algo=epzs:search_param=64'`
          );
          break;

        case 'best':
          // Cinematic: full MCI with UMH search, larger block size, more iterations
          // Slowest but closest to optical-flow neural results
          videoFilters.push(
            `minterpolate='fps=${interpolatedFps}:mi_mode=mci:mc_mode=aobmc:me_algo=umh:search_param=128:vsbmc=1'`
          );
          break;
      }

      // After interpolation, set output to target sequence fps
      // This is critical: minterpolate outputs at interpolatedFps, we need to bring it to sequenceFps
      videoFilters.push(`fps=${sourceFps}`);
    }

    if (Number(transitionInSeconds) > 0) {
      videoFilters.push(getXfadeFilter(segment.clip.transitionIn?.type, Number(transitionInSeconds)));
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

  // BUG #3 fix: include audio-only track segments in the export.
  // Previously only videoSegments were iterated, so clips on pure audio tracks
  // were never added to the FFmpeg filter graph.
  const allAudioLabels: string[] = [];
  const audioOnlySegs = allSegments.filter((s) => s.track.kind === "audio");
  for (const [aIdx, seg] of audioOnlySegs.entries()) {
    const inputIndex = assetInputIndexes.get(seg.asset.id);
    if (inputIndex === undefined) continue;
    const label = `ao${aIdx}`;
    const start = seg.sourceInSeconds.toFixed(3);
    const end = seg.sourceOutSeconds.toFixed(3);
    const volume = Math.max(0, Math.min(2, seg.clip.volume ?? 1));
    const speed = Math.max(0.1, Math.min(4, seg.clip.speed ?? 1));
    const delayMs = Math.round((seg.startFrame / sequenceFps) * 1000);
    const audioFilters = [
      `atrim=start=${start}:end=${end}`,
      "asetpts=PTS-STARTPTS",
      // Pad with silence to put this audio at the correct timeline position
      `adelay=${delayMs}|${delayMs}`,
    ];
    if (speed !== 1) audioFilters.push(buildAtempoChain(speed));
    if (volume !== 1) audioFilters.push(`volume=${volume.toFixed(4)}`);
    audioFilters.push(
      `aresample=${project.sequence.settings.audioSampleRate}`,
      "aformat=channel_layouts=stereo"
    );
    filterParts.push(`[${inputIndex}:a]${audioFilters.join(",")}[${label}]`);
    allAudioLabels.push(`[${label}]`);
  }

  // Mix audio-only streams with the main concat audio output if any exist
  if (allAudioLabels.length > 0) {
    const mixInputs = ["[aout]", ...allAudioLabels].join("");
    filterParts.push(`${mixInputs}amix=inputs=${1 + allAudioLabels.length}:duration=longest:normalize=0[afinal]`);
  }

  // Use [afinal] if audio-only tracks were mixed in, otherwise use [aout]
  const finalAudioLabel = allAudioLabels.length > 0 ? "[afinal]" : "[aout]";

  // ── Codec-specific output args ─────────────────────────────────────────────
  function getVideoCodecArgs(c: typeof codec, hwEncoder?: string | null): string[] {
    // Use hardware encoder for h264 if available
    if (c === "libx264" && hwEncoder) {
      switch (hwEncoder) {
        case "h264_videotoolbox":
          return ["-c:v", "h264_videotoolbox", "-b:v", "8M", "-allow_sw", "1"];
        case "h264_nvenc":
          return ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "18", "-b:v", "0"];
        case "h264_amf":
          return ["-c:v", "h264_amf", "-quality", "balanced", "-rc", "cqp", "-qp_i", "18", "-qp_p", "20"];
        case "h264_qsv":
          return ["-c:v", "h264_qsv", "-global_quality", "23", "-look_ahead", "1"];
        case "h264_vaapi":
          return ["-c:v", "h264_vaapi", "-qp", "23"];
      }
    }
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
        // BUG #20 fix: +faststart is wasteful and unnecessary for ProRes (a production codec).
        // Strip timecode track instead which is the correct ProRes container practice.
        return ["-write_tmcd", "0"];
      case "libvpx-vp9":
        return [];
      default:
        return ["-movflags", "+faststart"];
    }
  }

  // Detect HW encoder at export time (cached after first call)
  const hwEncoder = await detectBestHWEncoder();

  const args = [
    ...uniqueAssets.flatMap((asset) => ["-i", asset.sourcePath]),
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[vout]",
    "-map",
    finalAudioLabel,  // BUG #3 fix: use [afinal] when audio-only tracks are mixed in
    ...getVideoCodecArgs(codec, hwEncoder),
    ...getAudioCodecArgs(codec),
    ...getContainerArgs(codec),
    "-y",
    outputPath
  ];

  // ── Spawn FFmpeg with progress parsing ─────────────────────────────────────
  // Calculate total frames for progress reporting
  const totalFrames = videoSegments.reduce((sum, s) => sum + s.durationFrames, 0);
  // BUG #16 fix: also track total duration in seconds for time-based progress
  const totalDurationSeconds = videoSegments.reduce((sum, s) => sum + s.durationSeconds, 0);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(environment.ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    _activeChildren.add(child);

    let stderr = "";
    // BUG #16 fix: track current progress to avoid going backwards
    let currentPct = 0;
    child.stdout.on("data", () => { /* no-op */ });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (onProgress) {
        // Primary: parse frame=N from FFmpeg progress output
        if (totalFrames > 0) {
          const match = /frame=\s*(\d+)/.exec(text);
          if (match) {
            const frame = Number(match[1]);
            const pct = Math.min(98, Math.round((frame / totalFrames) * 100));
            if (pct > currentPct) { currentPct = pct; onProgress(pct); }
          }
        }
        // BUG #16 fix: secondary signal — parse time=HH:MM:SS.ss from stats line
        // This fires during muxing when frame= stops updating, allowing progress
        // to advance past the frame-based 98% cap.
        if (totalDurationSeconds > 0) {
          const statsMatch = /time=(\d+:\d+:\d+\.\d+)/.exec(text);
          if (statsMatch) {
            const parts = statsMatch[1].split(":");
            const secs = Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
            const pct = Math.min(98, Math.round((secs / totalDurationSeconds) * 100));
            if (pct > currentPct) { currentPct = pct; onProgress(pct); }
          }
        }
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      _activeChildren.delete(child);
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
