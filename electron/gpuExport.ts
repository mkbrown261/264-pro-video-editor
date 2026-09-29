/**
 * GPU (viewer-engine) export — main-process side.
 *
 * The renderer composites every frame with the same ViewerCompositor that
 * drives the program monitor (NodeFX, speed ramps, animated masks, …) and
 * streams RGBA frames here; FFmpeg encodes them and adds burn-ins + the audio
 * mix from the regular export graph.
 *
 * Source media is decoded here with FFmpeg, sequentially per layer (a seek per
 * frame through <video> costs ~0.5 s with long-GOP footage). This also covers
 * formats Chromium can't decode (ProRes, DNxHR, …).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExportRequest, ExportResponse } from "../src/shared/models.js";
import { buildExportGraph } from "../src/shared/exportGraph.js";
import {
  _activeChildren,
  detectBestHWEncoder,
  getAudioCodecArgs,
  getContainerArgs,
  getEnvironmentStatus,
  getVideoCodecArgs,
  loadGradeLut,
  systemFontsDir,
} from "./ffmpeg.js";

// ─── Sequential source decoder ────────────────────────────────────────────────

class FrameReader {
  private child: ChildProcess | null = null;
  private chunks: Buffer[] = [];
  private buffered = 0;
  private index = -1;          // index of `current`
  private current: Buffer | null = null;
  private ended = false;
  private waiters: Array<() => void> = [];
  private start = 0;
  readonly frameBytes: number;

  constructor(
    private ffmpegPath: string,
    private path: string,
    private width: number,
    private height: number,
    private fps: number,
  ) {
    this.frameBytes = width * height * 4;
  }

  private open(start: number) {
    this.close();
    this.start = Math.max(0, start);
    this.index = -1;
    this.current = null;
    this.chunks = [];
    this.buffered = 0;
    this.ended = false;
    const child = spawn(this.ffmpegPath, [
      "-v", "error", "-nostdin",
      "-ss", this.start.toFixed(4), "-i", this.path, "-an", "-sn",
      "-vf", `fps=${this.fps},scale=${this.width}:${this.height}:flags=bicubic:in_color_matrix=auto,format=rgba`,
      "-f", "rawvideo", "pipe:1",
    ], { stdio: ["ignore", "pipe", "ignore"] });
    _activeChildren.add(child);
    child.stdout!.on("data", (d: Buffer) => {
      this.chunks.push(d);
      this.buffered += d.length;
      // Backpressure: keep at most ~6 frames decoded ahead.
      if (this.buffered > this.frameBytes * 6) child.stdout!.pause();
      this.wake();
    });
    child.on("close", () => { this.ended = true; _activeChildren.delete(child); this.wake(); });
    child.on("error", () => { this.ended = true; this.wake(); });
    this.child = child;
  }

  private wake() {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  private takeFrame(): Buffer | null {
    if (this.buffered < this.frameBytes) return null;
    const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks);
    const frame = all.subarray(0, this.frameBytes);
    const rest = all.subarray(this.frameBytes);
    this.chunks = rest.length ? [rest] : [];
    this.buffered = rest.length;
    if (this.child?.stdout?.isPaused() && this.buffered < this.frameBytes * 3) this.child.stdout.resume();
    return Buffer.from(frame); // detach from the shared chunk
  }

  private async nextFrame(): Promise<Buffer | null> {
    for (;;) {
      const f = this.takeFrame();
      if (f) return f;
      if (this.ended) return null;
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }

  /** The decoded frame showing at source time `t` (seconds). */
  async frameAt(t: number): Promise<Buffer | null> {
    const k = Math.floor((t - this.start) * this.fps + 1e-6);
    // Restart when going backwards or jumping far ahead (faster than decoding through).
    if (!this.child || k < this.index || k - this.index > this.fps * 3) {
      this.open(t);
      return this.frameAt(t);
    }
    while (this.index < k) {
      const f = await this.nextFrame();
      if (!f) break; // end of media: hold the last frame
      this.current = f;
      this.index++;
    }
    return this.current;
  }

  close() {
    if (this.child) {
      try { this.child.kill("SIGKILL"); } catch { /* gone */ }
      _activeChildren.delete(this.child);
    }
    this.child = null;
  }
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

interface Job {
  child: ChildProcess;
  readers: Map<string, FrameReader>;
  readerUsed: Map<string, number>;
  workDir: string;
  outputPath: string;
  args: string[];
  warnings: string[];
  stderrTail: string;
  done: Promise<number | null>;
  ffmpegPath: string;
  frameBytes: number;
}

const jobs = new Map<string, Job>();

export interface GpuExportStart {
  jobId: string;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
}

export async function startGpuExport(request: ExportRequest): Promise<GpuExportStart> {
  const env = getEnvironmentStatus();
  if (!env.ffmpegAvailable) throw new Error(env.warnings[0] || "FFmpeg is unavailable.");
  await mkdir(dirname(request.outputPath), { recursive: true }).catch(() => {});
  const workDir = await mkdtemp(join(tmpdir(), "264pro-gpu-export-"));
  let n = 0;
  const graph = buildExportGraph({ ...request, pipedVideo: true }, {
    fontsDir: systemFontsDir(),
    loadFileLut: loadGradeLut,
    writeTempFile: (name, contents) => {
      const file = join(workDir, `${n++}_${name.replace(/[^\w.-]/g, "_")}`);
      writeFileSync(file, contents, "utf8");
      return file;
    },
  });
  const script = join(workDir, "graph.txt");
  writeFileSync(script, graph.filterComplex, "utf8");

  const settings = request.project.sequence.settings;
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const width = even(request.outputWidth && request.outputWidth > 0 ? request.outputWidth : settings.width);
  const height = even(request.outputHeight && request.outputHeight > 0 ? request.outputHeight : settings.height);
  const fps = settings.fps || 30;
  const codec = request.codec ?? "libx264";
  const hw = await detectBestHWEncoder();
  const args = [
    ...graph.inputs.flatMap((i) => [...i.options, "-i", i.path]),
    "-filter_complex_script", script,
    "-map", graph.videoLabel, "-map", graph.audioLabel,
    ...getVideoCodecArgs(codec, hw),
    ...getAudioCodecArgs(codec),
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-r", String(fps),
    ...getContainerArgs(codec),
    "-y", request.outputPath,
  ];
  const child = spawn(env.ffmpegPath, args, { stdio: ["pipe", "ignore", "pipe"] });
  _activeChildren.add(child);
  const jobId = randomUUID();
  const job: Job = {
    child, readers: new Map(), readerUsed: new Map(), workDir, outputPath: request.outputPath, args,
    // Informational warnings only (the GPU render fixes the rest).
    warnings: graph.warnings.filter((w) => !/GPU render/.test(w)),
    stderrTail: "", ffmpegPath: env.ffmpegPath, frameBytes: width * height * 4,
    done: new Promise((resolve) => {
      child.on("close", (code) => { _activeChildren.delete(child); resolve(code); });
      child.on("error", () => resolve(-1));
    }),
  };
  child.stderr!.on("data", (d: Buffer) => { job.stderrTail = (job.stderrTail + d.toString()).slice(-8000); });
  child.stdin!.on("error", () => { /* surfaced via exit code */ });
  jobs.set(jobId, job);
  return { jobId, width, height, fps, totalFrames: graph.totalFrames };
}

export async function readGpuSourceFrame(
  jobId: string,
  args: { key: string; path: string; time: number; width: number; height: number; fps: number },
): Promise<Uint8Array | null> {
  const job = jobs.get(jobId);
  if (!job) throw new Error("Unknown export job");
  const w = Math.max(2, Math.round(args.width / 2) * 2);
  const h = Math.max(2, Math.round(args.height / 2) * 2);
  const id = `${args.key}|${args.path}|${w}x${h}`;
  let reader = job.readers.get(id);
  if (!reader) {
    reader = new FrameReader(job.ffmpegPath, args.path, w, h, Math.max(1, args.fps || 30));
    job.readers.set(id, reader);
  }
  // Close decoders for clips that have left the timeline window (long edits
  // would otherwise keep hundreds of paused FFmpeg processes alive).
  const now = Date.now();
  job.readerUsed.set(id, now);
  for (const [rid, used] of job.readerUsed) {
    if (now - used > 4000) {
      job.readers.get(rid)?.close();
      job.readers.delete(rid);
      job.readerUsed.delete(rid);
    }
  }
  const frame = await reader.frameAt(Math.max(0, args.time));
  return frame ? new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength) : null;
}

export async function writeGpuFrame(jobId: string, data: Uint8Array): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) throw new Error("Unknown export job");
  if (data.byteLength !== job.frameBytes) throw new Error(`Frame size ${data.byteLength} ≠ ${job.frameBytes}`);
  const stdin = job.child.stdin!;
  if (!stdin.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength))) {
    await new Promise<void>((resolve) => {
      const done = () => { stdin.off("drain", done); job.child.off("close", done); resolve(); };
      stdin.on("drain", done);
      job.child.on("close", done);
    });
  }
  if (job.child.exitCode !== null) throw new Error(job.stderrTail.trim().split("\n").slice(-10).join("\n") || "Encoder exited");
}

async function cleanup(jobId: string, job: Job) {
  for (const r of job.readers.values()) r.close();
  jobs.delete(jobId);
  await rm(job.workDir, { recursive: true, force: true }).catch(() => {});
}

export async function finishGpuExport(jobId: string): Promise<ExportResponse> {
  const job = jobs.get(jobId);
  if (!job) throw new Error("Unknown export job");
  for (const r of job.readers.values()) r.close();
  job.child.stdin!.end();
  const code = await job.done;
  await cleanup(jobId, job);
  if (code !== 0) throw new Error(job.stderrTail.trim().split("\n").slice(-15).join("\n") || `ffmpeg exited with code ${String(code)}`);
  return { outputPath: job.outputPath, commandPreview: `${job.ffmpegPath} ${job.args.join(" ")}`, warnings: job.warnings };
}

export async function cancelGpuExport(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;
  try { job.child.kill("SIGKILL"); } catch { /* gone */ }
  await cleanup(jobId, job);
}
