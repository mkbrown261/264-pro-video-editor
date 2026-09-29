import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import type {
  EnvironmentStatus,
  ExportCodec,
  ExportRequest,
  ExportResponse,
  MediaAsset
} from "../src/shared/models.js";
import { normalizeTimelineFps } from "../src/shared/timeline.js";
import { buildExportGraph } from "../src/shared/exportGraph.js";
import { parseCubeLut, type Lut3D } from "../src/shared/colorMath.js";

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
export const _activeChildren = new Set<import("node:child_process").ChildProcess>();

/** Kill all active FFmpeg child processes — called on app will-quit. */
export function killAllActiveProcesses(): void {
  for (const child of _activeChildren) {
    try { child.kill("SIGKILL"); } catch { /* already dead */ }
  }
  _activeChildren.clear();
}

// ── Timeline export ───────────────────────────────────────────────────────────
// The filter graph is built by src/shared/exportGraph.ts (a layered compositor
// that mirrors the viewer). This function only resolves resources, writes the
// graph to a script file (long graphs overflow the Windows command line) and
// runs FFmpeg with progress reporting.

export function systemFontsDir(): string | null {
  const candidates =
    process.platform === "darwin" ? ["/System/Library/Fonts", "/Library/Fonts"] :
    process.platform === "win32" ? [join(process.env.WINDIR ?? "C:\\Windows", "Fonts")] :
    ["/usr/share/fonts"];
  return candidates.find((d) => existsSync(d)) ?? null;
}

/** Resolve a grade LUT path: absolute files, or bundled presets like "luts/x.cube". */
export function loadGradeLut(lutPath: string): Lut3D | null {
  const candidates = isAbsolute(lutPath)
    ? [lutPath]
    : [
        join(dirname(fileURLToPath(import.meta.url)), "../../dist", lutPath),
        join(app.getAppPath(), "dist", lutPath),
        join(app.getAppPath(), "public", lutPath),
      ];
  for (const file of candidates) {
    try {
      if (existsSync(file)) return parseCubeLut(readFileSync(file, "utf8"));
    } catch { /* try next */ }
  }
  return null;
}

// ── Encoder / container arguments (shared by the FFmpeg-graph and GPU exports) ─

export function getVideoCodecArgs(c: ExportCodec, hwEncoder?: string | null): string[] {
  if (c === "libx264" && hwEncoder) {
    switch (hwEncoder) {
      case "h264_videotoolbox":
        return ["-c:v", "h264_videotoolbox", "-b:v", "12M", "-allow_sw", "1"];
      case "h264_nvenc":
        return ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "18", "-b:v", "0"];
      case "h264_amf":
        return ["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp", "-qp_i", "18", "-qp_p", "20"];
      case "h264_qsv":
        return ["-c:v", "h264_qsv", "-global_quality", "20", "-look_ahead", "1"];
      case "h264_vaapi":
        return ["-c:v", "h264_vaapi", "-qp", "20"];
    }
  }
  switch (c) {
    case "libx265":
      return ["-c:v", "libx265", "-preset", "medium", "-crf", "20", "-tag:v", "hvc1", "-pix_fmt", "yuv420p"];
    case "prores_ks":
      return ["-c:v", "prores_ks", "-profile:v", "3", "-vendor", "apl0", "-bits_per_mb", "8000", "-pix_fmt", "yuv422p10le"];
    case "libvpx-vp9":
      return ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-deadline", "good", "-cpu-used", "2", "-pix_fmt", "yuv420p"];
    case "libx264":
    default:
      return ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p"];
  }
}
export function getAudioCodecArgs(c: ExportCodec): string[] {
  switch (c) {
    case "prores_ks": return ["-c:a", "pcm_s24le"];
    case "libvpx-vp9": return ["-c:a", "libopus", "-b:a", "192k"];
    default: return ["-c:a", "aac", "-b:a", "256k"];
  }
}
export function getContainerArgs(c: ExportCodec): string[] {
  switch (c) {
    case "prores_ks": return ["-write_tmcd", "0"];
    case "libvpx-vp9": return [];
    default: return ["-movflags", "+faststart"];
  }
}


export async function exportSequence(
  request: ExportRequest,
  onProgress?: (pct: number) => void
): Promise<ExportResponse> {
  const environment = getEnvironmentStatus();
  if (!environment.ffmpegAvailable) {
    throw new Error(environment.warnings[0] || "FFmpeg is unavailable.");
  }

  const { outputPath } = request;
  const codec = request.codec ?? "libx264";
  await mkdir(dirname(outputPath), { recursive: true }).catch(() => {});

  const workDir = await mkdtemp(join(tmpdir(), "264pro-export-"));
  let fileCount = 0;
  const graph = buildExportGraph(request, {
    fontsDir: systemFontsDir(),
    loadFileLut: loadGradeLut,
    lutSize: 65,
    writeTempFile: (name, contents) => {
      const file = join(workDir, `${fileCount++}_${name.replace(/[^\w.-]/g, "_")}`);
      writeFileSync(file, contents, "utf8");
      return file;
    },
  });
  const scriptPath = join(workDir, "graph.txt");
  writeFileSync(scriptPath, graph.filterComplex, "utf8");

  const hwEncoder = await detectBestHWEncoder();
  const args = [
    ...graph.inputs.flatMap((input) => [...input.options, "-i", input.path]),
    "-filter_complex_script", scriptPath,
    "-map", graph.videoLabel,
    "-map", graph.audioLabel,
    ...getVideoCodecArgs(codec, hwEncoder),
    ...getAudioCodecArgs(codec),
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-r", String(request.project.sequence.settings.fps || 30),
    ...getContainerArgs(codec),
    "-y",
    outputPath
  ];

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(environment.ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
      _activeChildren.add(child);
      let stderrTail = "";
      let currentPct = 0;
      child.stdout.on("data", () => { /* no-op */ });
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrTail = (stderrTail + text).slice(-20000);
        if (!onProgress || graph.durationSeconds <= 0) return;
        const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
        if (m) {
          const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
          const pct = Math.min(99, Math.round((secs / graph.durationSeconds) * 100));
          if (pct > currentPct) { currentPct = pct; onProgress(pct); }
        }
      });
      child.on("error", reject);
      child.on("close", (code) => {
        _activeChildren.delete(child);
        if (code === 0) {
          onProgress?.(100);
          resolve();
        } else {
          reject(new Error(stderrTail.trim().split("\n").slice(-15).join("\n") || `ffmpeg exited with code ${String(code)}`));
        }
      });
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  return {
    outputPath,
    commandPreview: `${environment.ffmpegPath} ${args.join(" ")}`,
    warnings: graph.warnings,
  };
}
