import type { EditorProject, TimelineTrack } from '../src/shared/models.js';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import { join } from 'path';

function getFfmpegPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffmpegStatic = require('ffmpeg-static');
    const p = (ffmpegStatic as { default?: string }).default ?? (ffmpegStatic as string);
    if (typeof p === 'string' && p) return p;
  } catch { /* fall through */ }
  return 'ffmpeg';
}

export interface StemExportRequest {
  project: EditorProject;
  outputDir: string;
  format: 'wav' | 'aiff' | 'mp3' | 'aac';
  sampleRate: number; // 48000 default
  stems: ('dialogue' | 'music' | 'sfx' | 'mix')[];
}

export interface StemExportResult {
  success: boolean;
  files: Array<{ stem: string; path: string }>;
  error?: string;
}

export async function exportStems(
  request: StemExportRequest,
  onProgress?: (pct: number, stem: string) => void
): Promise<StemExportResult> {
  const { project, outputDir, format, sampleRate, stems } = request;

  // Guard against empty stems array
  if (!stems || stems.length === 0) {
    return { success: false, files: [], error: 'No stems selected' };
  }

  const fps = project.sequence.settings.fps;
  const files: Array<{ stem: string; path: string }> = [];

  mkdirSync(outputDir, { recursive: true });

  const projectName = (project.name ?? 'Untitled').replace(/[^a-zA-Z0-9_-]/g, '_');
  const ffmpegBin = getFfmpegPath();

  // Categorize audio tracks by name
  // Convention: track named "Dialogue", "VO", "Voice" → dialogue stem
  //             track named "Music", "BG", "Ambient", "Score" → music stem
  //             track named "SFX", "FX", "Foley", "Sound", "Effect" → sfx stem
  //             all audio → mix stem
  const audioTracks = project.sequence.tracks.filter((t: TimelineTrack) => t.kind === 'audio');

  function matchStem(track: (typeof audioTracks)[0], stemName: 'dialogue' | 'music' | 'sfx'): boolean {
    const name = (track.name ?? '').toLowerCase();
    switch (stemName) {
      case 'dialogue': return /dial|voice|vo\b|narr|spoken|speech/.test(name);
      case 'music':    return /music|score|bg\b|ambient|track/.test(name);
      case 'sfx':      return /sfx|fx\b|sound|effect|foley/.test(name);
    }
  }

  function getClipsForTracks(trackIds: string[]) {
    return project.sequence.clips.filter(
      (c: EditorProject['sequence']['clips'][0]) => trackIds.includes(c.trackId) && c.isEnabled !== false
    );
  }

  function buildStemFilter(trackIds: string[]): {
    inputs: string[];
    filterArgs: string[];
  } | null {
    const clips = getClipsForTracks(trackIds);
    if (clips.length === 0) return null;

    const clipPaths: string[] = [];
    const inputLabels: string[] = [];
    const filterArgs: string[] = [];

    for (const clip of clips) {
      const asset = project.assets.find((a: EditorProject['assets'][0]) => a.id === clip.assetId);
      if (!asset?.sourcePath) continue;

      const trimStart = (clip.trimStartFrames ?? 0) / fps;
      const assetDur = (asset.durationSeconds ?? 0) - trimStart - ((clip.trimEndFrames ?? 0) / fps);
      const startSec = clip.startFrame / fps;
      const vol = clip.volume ?? 1;

      const inputIdx = clipPaths.length;
      clipPaths.push(asset.sourcePath);

      const label = `[a${inputIdx}]`;
      filterArgs.push(
        `[${inputIdx}:a]` +
        `atrim=start=${trimStart.toFixed(3)}:duration=${Math.max(0.01, assetDur).toFixed(3)},` +
        `adelay=${Math.round(startSec * 1000)}:all=1,` +
        `volume=${vol.toFixed(3)}` +
        `${label}`
      );
      inputLabels.push(label);
    }

    if (inputLabels.length === 0) return null;

    if (inputLabels.length === 1) {
      filterArgs.push(`${inputLabels[0]}anull[aout]`);
    } else {
      filterArgs.push(
        `${inputLabels.join('')}amix=inputs=${inputLabels.length}:duration=longest:normalize=0[aout]`
      );
    }

    return { inputs: clipPaths, filterArgs };
  }

  function stemExt(): string {
    return format === 'wav' ? 'wav' : format === 'aiff' ? 'aiff' : format === 'mp3' ? 'mp3' : 'm4a';
  }

  function codecArgs(): string[] {
    switch (format) {
      case 'wav':  return ['-c:a', 'pcm_s24le'];
      case 'aiff': return ['-c:a', 'pcm_s24be'];
      case 'mp3':  return ['-c:a', 'libmp3lame', '-b:a', '320k'];
      case 'aac':  return ['-c:a', 'aac', '-b:a', '256k'];
    }
  }

  async function exportOneStem(stemLabel: string, trackIds: string[]): Promise<string | null> {
    const stemData = buildStemFilter(trackIds);
    if (!stemData) return null;

    const outFile = join(outputDir, `${projectName}_${stemLabel}.${stemExt()}`);

    // Ensure output directory exists per-stem (defensive, recursive)
    mkdirSync(outputDir, { recursive: true });

    const inputArgs = stemData.inputs.flatMap(p => ['-i', p]);
    const args = [
      ...inputArgs,
      '-filter_complex', stemData.filterArgs.join(';'),
      '-map', '[aout]',
      '-ar', String(sampleRate),
      ...codecArgs(),
      '-y', outFile,
    ];

    const ok = await new Promise<boolean>((resolve) => {
      let resolved = false;
      const done = (val: boolean) => { if (!resolved) { resolved = true; resolve(val); } };
      const proc = spawn(ffmpegBin, args);
      const timer = setTimeout(() => { proc.kill(); done(false); }, 120_000);
      proc.on('close', (code: number | null) => { clearTimeout(timer); done(code === 0); });
      proc.on('error', () => { clearTimeout(timer); done(false); });
    });

    return ok ? outFile : null;
  }

  let done = 0;
  const total = stems.length;

  for (const stem of stems) {
    onProgress?.(Math.round((done / total) * 100), stem);

    let trackIds: string[];
    let stemLabel: string;

    if (stem === 'mix') {
      trackIds = audioTracks.map((t: TimelineTrack) => t.id);
      stemLabel = 'mix';
    } else {
      trackIds = audioTracks.filter((t: TimelineTrack) => matchStem(t, stem)).map((t: TimelineTrack) => t.id);
      // Skip stems with no matching tracks
      if (trackIds.length === 0) {
        done++;
        onProgress?.(Math.round((done / total) * 100), stem);
        continue;
      }
      stemLabel = stem;
    }

    const outPath = await exportOneStem(stemLabel, trackIds);
    if (outPath) {
      files.push({ stem: stemLabel, path: outPath });
    }

    done++;
    onProgress?.(Math.round((done / total) * 100), stem);
  }

  return {
    success: files.length > 0,
    files,
    error: files.length === 0 ? 'No audio clips found for the selected stems' : undefined,
  };
}
