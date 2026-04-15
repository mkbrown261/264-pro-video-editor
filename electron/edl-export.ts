/**
 * EDL & FCP XML Export
 * ─────────────────────────────────────────────────────────────────────────────
 * generateEDL   → CMX 3600 EDL  (NLE compatible)
 * generateFCPXML → FCPXML 1.10  (Apple XML)
 */

import type { EditorProject } from '../src/shared/models.js';

// ── CMX 3600 EDL ──────────────────────────────────────────────────────────────

export function generateEDL(project: EditorProject): string {
  const fps = Math.max(1, project.sequence.settings.fps);
  const title = project.name ?? 'Untitled';

  const lines: string[] = [
    `TITLE: ${title}`,
    `FCM: NON-DROP FRAME`,
    '',
  ];

  // Handle empty assets or missing video track gracefully
  if (!project.assets || !project.sequence?.clips || project.sequence.clips.length === 0) {
    return lines.join('\n');
  }

  // Get all video clips sorted by start frame
  const videoTrack = project.sequence.tracks.find(t => t.kind === 'video');
  if (!videoTrack) return lines.join('\n');

  const clips = project.sequence.clips
    .filter(c => c.trackId === videoTrack.id && c.isEnabled !== false)
    .sort((a, b) => a.startFrame - b.startFrame);

  // Handle empty clips array
  if (clips.length === 0) return lines.join('\n');

  // editNumber is local — reset per call, not module-level
  let editNumber = 1;

  for (const clip of clips) {
    const asset = project.assets.find(a => a.id === clip.assetId);
    if (!asset) continue;

    const trimStart = clip.trimStartFrames ?? 0;
    const trimEnd = clip.trimEndFrames ?? 0;
    const assetTotalFrames = Math.round((asset.durationSeconds ?? 0) * fps);
    const clipDurationFrames = Math.max(0, assetTotalFrames - trimStart - trimEnd);

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
    // Sanitize reel name: strip non-ASCII (Unicode/emoji) first, then non-alphanumeric
    const reelName = (asset.name ?? 'AX')
      .replace(/[^\x00-\x7F]/g, '_')  // replace non-ASCII with underscore
      .replace(/[^A-Z0-9_]/gi, '')    // strip remaining non-alphanumeric
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
  const fpsR  = Math.max(1, Math.round(fps));  // guard fps === 0
  const ff    = f % fpsR;
  const totalSec = Math.floor(f / fpsR);
  const ss    = totalSec % 60;
  const mm    = Math.floor(totalSec / 60) % 60;
  const hh    = Math.floor(totalSec / 3600);
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

// ── FCPXML 1.10 ───────────────────────────────────────────────────────────────

/** Escape a string for use in XML attribute values and text content. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function generateFCPXML(project: EditorProject): string {
  const fps      = Math.max(1, project.sequence.settings.fps);
  const w        = project.sequence.settings.width;
  const h        = project.sequence.settings.height;
  const title    = xmlEscape(project.name ?? 'Untitled');
  const timebase = Math.round(fps);
  const frameDur = `1/${timebase}s`;

  // Handle empty project gracefully
  if (!project.assets || !project.sequence?.clips) {
    return buildFCPXMLSkeleton(title, timebase, frameDur, w, h, 0, [], []);
  }

  // Total timeline duration in frames — guard against empty clips array
  const totalFrames = project.sequence.clips.length === 0 ? 0 :
    project.sequence.clips.reduce((max, c) => {
      const asset = project.assets.find(a => a.id === c.assetId);
      const dur = Math.max(0, Math.round((asset?.durationSeconds ?? 0) * fps)
        - (c.trimStartFrames ?? 0)
        - (c.trimEndFrames ?? 0));
      return Math.max(max, c.startFrame + dur);
    }, 0);

  // Asset resources
  const resources: string[] = [];
  const assetsSeen = new Set<string>();

  for (const asset of project.assets) {
    if (assetsSeen.has(asset.id)) continue;
    assetsSeen.add(asset.id);

    const assetDurFrames = Math.round((asset.durationSeconds ?? 0) * fps);
    const safeName = xmlEscape(asset.name ?? 'clip');
    const safePath = xmlEscape(asset.sourcePath ?? '');

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

  // Check if any clip has a color correction so we can declare the resource
  const hasColorCorrection = videoClips.some(c => {
    const grade = c.colorGrade;
    return grade && !grade.bypass && (grade.exposure !== 0 || grade.saturation !== 1 || grade.contrast !== 0);
  });

  for (const clip of videoClips) {
    const asset = project.assets.find(a => a.id === clip.assetId);
    if (!asset) continue;

    const trimStart = clip.trimStartFrames ?? 0;
    const trimEnd   = clip.trimEndFrames ?? 0;
    const assetTotalFrames = Math.round((asset.durationSeconds ?? 0) * fps);
    const clipDur   = Math.max(0, assetTotalFrames - trimStart - trimEnd);

    if (clipDur <= 0) continue;

    const safeName = xmlEscape(asset.name ?? 'clip');

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

  return buildFCPXMLSkeleton(title, timebase, frameDur, w, h, totalFrames, resources, clipElements, hasColorCorrection);
}

function buildFCPXMLSkeleton(
  title: string,
  timebase: number,
  frameDur: string,
  w: number,
  h: number,
  totalFrames: number,
  resources: string[],
  clipElements: string[],
  hasColorCorrection = false
): string {
  // Add the r_colorCorrection effect resource if any clip references it
  const colorCorrectionResource = hasColorCorrection
    ? `\n    <effect id="r_colorCorrection" name="Color Correction" uid=".../ColorCorrection.localized"/>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
${resources.join('\n')}
    <format id="r_format" name="FFVideoFormat${h}p${timebase}" frameDuration="${frameDur}" width="${w}" height="${h}"/>${colorCorrectionResource}
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
