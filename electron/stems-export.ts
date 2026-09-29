/**
 * Audio stems export. Each stem is the timeline's real audio mix (same graph
 * as the video export) with every audio track outside the stem muted, so a
 * stem sounds exactly like its part of the final mix.
 *
 * Stems are chosen by track name:
 *   "Dialogue", "VO", "Voice", "Narration" → dialogue
 *   "Music", "Score", "BG", "Ambient"      → music
 *   "SFX", "FX", "Foley", "Sound", "Effect" → sfx
 *   every audio track                      → mix
 */
import type { EditorProject, TimelineTrack } from '../src/shared/models.js';
import { join } from 'path';
import { renderAudioMix } from './ffmpeg.js';

type StemName = 'dialogue' | 'music' | 'sfx' | 'mix';

export interface StemExportRequest {
  project: EditorProject;
  outputDir: string;
  format: 'wav' | 'aiff' | 'mp3' | 'aac';
  sampleRate: number; // 48000 default
  stems: StemName[];
}

export interface StemExportResult {
  success: boolean;
  files: Array<{ stem: string; path: string }>;
  /** Requested stems that weren't rendered, and why. */
  skipped?: Array<{ stem: string; reason: string }>;
  error?: string;
}

const STEM_PATTERNS: Record<Exclude<StemName, 'mix'>, RegExp> = {
  dialogue: /dial|voice|\bvo\b|narr|spoken|speech/,
  music: /music|score|\bbg\b|ambient/,
  sfx: /sfx|\bfx\b|sound|effect|foley/,
};

/** The project with every audio track except `keep` muted (and nothing soloed or on video tracks). */
function isolateTracks(project: EditorProject, keep: Set<string>): EditorProject {
  return {
    ...project,
    sequence: {
      ...project.sequence,
      tracks: project.sequence.tracks.map((t: TimelineTrack) => ({ ...t, solo: false, muted: t.muted || !keep.has(t.id) })),
    },
  };
}

export async function exportStems(
  request: StemExportRequest,
  onProgress?: (pct: number, stem: string) => void
): Promise<StemExportResult> {
  const { project, outputDir, format, sampleRate, stems } = request;
  if (!stems || stems.length === 0) return { success: false, files: [], error: 'No stems selected' };

  const projectName = (project.name ?? 'Untitled').replace(/[^a-zA-Z0-9_-]/g, '_');
  const ext = format === 'aac' ? 'm4a' : format;
  const audioTracks = project.sequence.tracks.filter((t: TimelineTrack) => t.kind === 'audio');
  const files: StemExportResult['files'] = [];
  const skipped: NonNullable<StemExportResult['skipped']> = [];

  for (let i = 0; i < stems.length; i++) {
    const stem = stems[i];
    onProgress?.(Math.round((i / stems.length) * 100), stem);
    let source = project;
    if (stem !== 'mix') {
      const ids = audioTracks.filter((t) => STEM_PATTERNS[stem].test((t.name ?? '').toLowerCase())).map((t) => t.id);
      if (!ids.length) {
        skipped.push({ stem, reason: `No audio track is named for ${stem} (e.g. "${stem === 'dialogue' ? 'Dialogue' : stem === 'music' ? 'Music' : 'SFX'}")` });
        continue;
      }
      source = isolateTracks(project, new Set(ids));
    }
    const outFile = join(outputDir, `${projectName}_${stem}.${ext}`);
    try {
      await renderAudioMix(source, outFile, format, sampleRate);
      files.push({ stem, path: outFile });
    } catch (e) {
      skipped.push({ stem, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  onProgress?.(100, '');

  return {
    success: files.length > 0,
    files,
    skipped: skipped.length ? skipped : undefined,
    error: files.length === 0 ? (skipped[0]?.reason ?? 'Nothing to export') : undefined,
  };
}
