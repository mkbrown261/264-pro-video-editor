/**
 * EDL & FCP XML Export
 * ─────────────────────────────────────────────────────────────────────────────
 * generateEDL   → CMX 3600 EDL  (DaVinci Resolve, Premiere Pro, Avid)
 * generateFCPXML → FCPXML 1.10  (Final Cut Pro X)
 */

import type { EditorProject } from '../src/shared/models.js';

// ── CMX 3600 EDL ──────────────────────────────────────────────────────────────

export function generateEDL(project: EditorProject): string {
  const fps = project.sequence.settings.fps;
  const title = project.name ?? 'Untitled';

  const lines: string[] = [
    `TITLE: ${title}`,
    `FCM: NON-DROP FRAME`,
    '',
  ];

  // Get all video clips sorted by start frame
  const videoTrack = project.sequence.tracks.find(t => t.kind === 'video');
  if (!videoTrack) return lines.join('\n');

  const clips = project.sequence.clips
    .filter(c => c.trackId === videoTrack.id && c.isEnabled !== false)
    .sort((a, b) => a.startFrame - b.startFrame);

  let editNumber = 1;

  for (const clip of clips) {
    const asset = project.assets.find(a => a.id === clip.assetId);
    if (!asset) continue;

    const trimStart = clip.trimStartFrames ?? 0;
    const trimEnd = clip.trimEndFrames ?? 0;
    const assetTotalFrames = Math.round((asset.durationSeconds ?? 0) * fps);
    const clipDurationFrames = assetTotalFrames - trimStart - trimEnd;

    if (clipDurationFrames <= 0) continue;

    // Source in/out (within the source file)
    const srcIn  = trimStart;
    const srcOut = trimStart + clipDurationFrames;

    // Record in/out (position on timeline)
    const recIn  = clip.startFrame;
    const recOut = clip.startFrame + clipDurationFrames;

    const srcInTC  = framesToTC(srcIn,  fps);
    const srcOutTC = framesToTC(srcOut, fps);
    const recInTC  = framesToTC(recIn,  fps);
    const recOutTC = framesToTC(recOut, fps);

    const editNum  = String(editNumber).padStart(3, '0');
    const reelName = (asset.name ?? 'AX')
      .replace(/[^A-Z0-9]/gi, '')
      .substring(0, 8)
      .toUpperCase() || 'AX';

    // Standard CMX 3600 edit line
    lines.push(`${editNum}  ${reelName.padEnd(8)} V     C        ${srcInTC} ${srcOutTC} ${recInTC} ${recOutTC}`);

    // Clip name comment
    lines.push(`* FROM CLIP NAME: ${asset.name ?? 'Untitled'}`);

    // Speed if not 1.0
    if (clip.speed && clip.speed !== 1) {
      lines.push(`* SPEED: ${clip.speed.toFixed(2)}`);
    }

    lines.push('');
    editNumber++;
  }

  return lines.join('\n');
}

function framesToTC(frames: number, fps: number): string {
  const f     = Math.max(0, Math.round(frames));
  const fpsR  = Math.round(fps);
  const ff    = f % fpsR;
  const totalSec = Math.floor(f / fpsR);
  const ss    = totalSec % 60;
  const mm    = Math.floor(totalSec / 60) % 60;
  const hh    = Math.floor(totalSec / 3600);
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

// ── FCPXML 1.10 ───────────────────────────────────────────────────────────────

export function generateFCPXML(project: EditorProject): string {
  const fps      = project.sequence.settings.fps;
  const w        = project.sequence.settings.width;
  const h        = project.sequence.settings.height;
  const title    = (project.name ?? 'Untitled').replace(/[<>&"']/g, '_');
  const timebase = Math.round(fps);
  const frameDur = `1/${timebase}s`;

  // Total timeline duration in frames
  const totalFrames = project.sequence.clips.reduce((max, c) => {
    const asset = project.assets.find(a => a.id === c.assetId);
    const dur = Math.round((asset?.durationSeconds ?? 0) * fps)
      - (c.trimStartFrames ?? 0)
      - (c.trimEndFrames ?? 0);
    return Math.max(max, c.startFrame + Math.max(0, dur));
  }, 0);

  // Asset resources
  const resources: string[] = [];
  const assetsSeen = new Set<string>();

  for (const asset of project.assets) {
    if (assetsSeen.has(asset.id)) continue;
    assetsSeen.add(asset.id);

    const assetDurFrames = Math.round((asset.durationSeconds ?? 0) * fps);
    const safeName = (asset.name ?? 'clip').replace(/[<>&"']/g, '_');
    const safePath = (asset.sourcePath ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    resources.push(
      `    <asset id="r_${asset.id}" name="${safeName}" start="0s" duration="${assetDurFrames}/${timebase}s" hasVideo="1" hasAudio="${asset.hasAudio ? '1' : '0'}">`,
      `      <media-rep kind="original-media" src="file://${safePath}"/>`,
      `    </asset>`,
    );
  }

  // Build timeline clips — video tracks only
  const videoClips = project.sequence.clips
    .filter(c => {
      const track = project.sequence.tracks.find(t => t.id === c.trackId);
      return track?.kind === 'video' && c.isEnabled !== false;
    })
    .sort((a, b) => a.startFrame - b.startFrame);

  const clipElements: string[] = [];

  for (const clip of videoClips) {
    const asset = project.assets.find(a => a.id === clip.assetId);
    if (!asset) continue;

    const trimStart = clip.trimStartFrames ?? 0;
    const trimEnd   = clip.trimEndFrames ?? 0;
    const assetTotalFrames = Math.round((asset.durationSeconds ?? 0) * fps);
    const clipDur   = assetTotalFrames - trimStart - trimEnd;

    if (clipDur <= 0) continue;

    const safeName = (asset.name ?? 'clip').replace(/[<>&"']/g, '_');

    clipElements.push(
      `        <clip name="${safeName}" ref="r_${asset.id}" offset="${clip.startFrame}/${timebase}s" duration="${clipDur}/${timebase}s" start="${trimStart}/${timebase}s">`,
    );

    // Color correction block if grade has non-default values
    const grade = clip.colorGrade;
    if (grade && !grade.bypass && (grade.exposure !== 0 || grade.saturation !== 1 || grade.contrast !== 0)) {
      clipElements.push(
        `          <filter-video ref="r_colorCorrection">`,
        `            <param name="Exposure" value="${(grade.exposure ?? 0).toFixed(3)}"/>`,
        `            <param name="Saturation" value="${(grade.saturation ?? 1).toFixed(3)}"/>`,
        `            <param name="Contrast" value="${(grade.contrast ?? 0).toFixed(3)}"/>`,
        `          </filter-video>`,
      );
    }

    // Speed (clip retiming)
    if (clip.speed && clip.speed !== 1) {
      clipElements.push(
        `          <timeMap>`,
        `            <timept time="0s" value="0s" interp="smooth2"/>`,
        `            <timept time="${clipDur}/${timebase}s" value="${Math.round(clipDur * clip.speed)}/${timebase}s" interp="smooth2"/>`,
        `          </timeMap>`,
      );
    }

    clipElements.push(`        </clip>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
${resources.join('\n')}
    <format id="r_format" name="FFVideoFormat${h}p${timebase}" frameDuration="${frameDur}" width="${w}" height="${h}"/>
  </resources>
  <library>
    <event name="${title}">
      <project name="${title}">
        <sequence format="r_format" duration="${totalFrames}/${timebase}s" tcStart="0s" tcFormat="NDF">
          <spine>
${clipElements.join('\n')}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;
}
