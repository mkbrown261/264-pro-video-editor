/**
 * EDL & FCP XML Export
 * ─────────────────────────────────────────────────────────────────────────────
 * generateEDL    → CMX 3600 EDL: the top video track + two audio channels,
 *                  cuts, dissolves and M2 speed changes.
 * generateFCPXML → FCPXML 1.10: every track, as connected clips on lanes
 *                  over a full-length gap (video lanes 1…, audio −1…).
 * Both read the shared timeline segments, so speed and trims match the edit.
 */

import { pathToFileURL } from 'url';
import type { EditorProject } from '../src/shared/models.js';
import { buildTimelineSegments, type TimelineSegment } from '../src/shared/timeline.js';

const isNtsc = (fps: number) => Math.abs(fps - Math.round(fps)) > 0.001;

function framesToTC(frames: number, fps: number): string {
  const f = Math.max(0, Math.round(frames));
  const fpsR = Math.max(1, Math.round(fps));
  const ff = f % fpsR;
  const totalSec = Math.floor(f / fpsR);
  return `${pad(Math.floor(totalSec / 3600))}:${pad(Math.floor(totalSec / 60) % 60)}:${pad(totalSec % 60)}:${pad(ff)}`;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

function reelName(name: string | undefined): string {
  return ((name ?? 'AX').replace(/[^\x00-\x7F]/g, '_').replace(/[^A-Z0-9_]/gi, '').substring(0, 8).toUpperCase() || 'AX').padEnd(8);
}

function playableSegments(project: EditorProject): TimelineSegment[] {
  return buildTimelineSegments(project.sequence, project.assets).filter((s) => s.clip.isEnabled !== false);
}

// ── CMX 3600 EDL ──────────────────────────────────────────────────────────────

export function generateEDL(project: EditorProject): string {
  const fps = Math.max(1, project.sequence.settings.fps);
  const lines: string[] = [`TITLE: ${project.name ?? 'Untitled'}`, 'FCM: NON-DROP FRAME', ''];
  if (!project.assets || !project.sequence?.clips?.length) return lines.join('\n');

  const segs = playableSegments(project);
  const tracks = project.sequence.tracks;
  const topVideo = tracks.find((t) => t.kind === 'video');
  const audio = tracks.filter((t) => t.kind === 'audio').slice(0, 2);
  const channels: Array<{ trackId: string; code: string }> = [
    ...(topVideo ? [{ trackId: topVideo.id, code: 'V' }] : []),
    ...audio.map((t, i) => ({ trackId: t.id, code: i === 0 ? 'A' : 'A2' })),
  ];

  let edit = 1;
  const tc = (f: number) => framesToTC(f, fps);
  for (const { trackId, code } of channels) {
    const row = segs.filter((s) => s.clip.trackId === trackId).sort((a, b) => a.startFrame - b.startFrame);
    row.forEach((seg, i) => {
      const reel = reelName(seg.asset.name);
      const srcIn = Math.round(seg.sourceInSeconds * fps);
      const srcOut = Math.round(seg.sourceOutSeconds * fps);
      const num = String(edit++).padStart(3, '0');
      const prev = row[i - 1];
      const t = seg.clip.transitionIn;
      const dissolve = code === 'V' && prev && prev.endFrame === seg.startFrame && t && t.type !== 'cut' && t.durationFrames > 0;
      if (dissolve) {
        // Outgoing clip held at its out point, then the dissolve into this one.
        const prevOut = Math.round(prev.sourceOutSeconds * fps);
        lines.push(`${num}  ${reelName(prev.asset.name)} ${code.padEnd(5)} C        ${tc(prevOut)} ${tc(prevOut)} ${tc(seg.startFrame)} ${tc(seg.startFrame)}`);
        lines.push(`${num}  ${reel} ${code.padEnd(5)} D    ${String(Math.min(999, t.durationFrames)).padStart(3, '0')} ${tc(srcIn)} ${tc(srcOut)} ${tc(seg.startFrame)} ${tc(seg.endFrame)}`);
      } else {
        lines.push(`${num}  ${reel} ${code.padEnd(5)} C        ${tc(srcIn)} ${tc(srcOut)} ${tc(seg.startFrame)} ${tc(seg.endFrame)}`);
      }
      const speed = seg.clip.speed ?? 1;
      if (Math.abs(speed - 1) > 1e-3) {
        lines.push(`M2   ${reel}       ${(speed * fps).toFixed(1).padStart(5, '0')}                ${tc(srcIn)}`);
      }
      lines.push(`* FROM CLIP NAME: ${seg.asset.name ?? 'Untitled'}`, '');
    });
  }
  return lines.join('\n');
}

// ── FCPXML 1.10 ───────────────────────────────────────────────────────────────

/** Escape a string for use in XML attribute values and text content. */
function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function generateFCPXML(project: EditorProject): string {
  const fps = Math.max(1, project.sequence.settings.fps);
  const { width: w, height: h } = project.sequence.settings;
  const title = xmlEscape(project.name ?? 'Untitled');
  // Rational times: 29.97 etc. are 1001/30000 s per frame.
  const base = Math.round(fps);
  const ntsc = isNtsc(fps);
  const rt = (frames: number) => {
    const f = Math.max(0, Math.round(frames));
    return ntsc ? `${f * 1001}/${base * 1000}s` : `${f}/${base}s`;
  };
  const secs = (seconds: number) => rt(seconds * fps);

  const segs = project.assets && project.sequence?.clips ? playableSegments(project) : [];
  const total = segs.reduce((m, s) => Math.max(m, s.endFrame), 0);

  const used = new Map(segs.map((s) => [s.asset.id, s.asset]));
  const resources = [...used.values()].map((a) => {
    const src = a.sourcePath ? xmlEscape(pathToFileURL(a.sourcePath).href) : '';
    return [
      `    <asset id="r_${xmlEscape(a.id)}" name="${xmlEscape(a.name ?? 'clip')}" start="0s" duration="${secs(a.durationSeconds ?? 0)}" hasVideo="${a.width > 0 ? 1 : 0}" hasAudio="${a.hasAudio ? 1 : 0}" format="r_format">`,
      `      <media-rep kind="original-media" src="${src}"/>`,
      `    </asset>`,
    ].join('\n');
  });

  // Lanes: video tracks bottom→top = 1, 2, …; audio tracks = −1, −2, …
  const tracks = project.sequence.tracks;
  const videoTracks = tracks.filter((t) => t.kind === 'video');
  const audioTracks = tracks.filter((t) => t.kind === 'audio');
  const laneOf = (trackId: string) => {
    const vi = videoTracks.findIndex((t) => t.id === trackId);
    if (vi >= 0) return videoTracks.length - vi;
    return -(audioTracks.findIndex((t) => t.id === trackId) + 1);
  };

  const clips = segs
    .filter((s) => s.asset.sourcePath)
    .sort((a, b) => a.startFrame - b.startFrame)
    .map((s) => {
      const speed = s.clip.speed ?? 1;
      const isAudio = s.track.kind === 'audio';
      const attrs = `name="${xmlEscape(s.asset.name ?? 'clip')}" ref="r_${xmlEscape(s.asset.id)}" lane="${laneOf(s.clip.trackId)}" offset="${rt(s.startFrame)}" duration="${rt(s.durationFrames)}" start="${secs(s.sourceInSeconds)}"${isAudio ? ' srcEnable="audio"' : s.asset.hasAudio ? ' srcEnable="video"' : ''}`;
      if (Math.abs(speed - 1) < 1e-3) return `            <asset-clip ${attrs}/>`;
      return [
        `            <asset-clip ${attrs}>`,
        `              <timeMap>`,
        `                <timept time="0s" value="0s" interp="linear"/>`,
        `                <timept time="${rt(s.durationFrames)}" value="${rt(s.durationFrames * speed)}" interp="linear"/>`,
        `              </timeMap>`,
        `            </asset-clip>`,
      ].join('\n');
    });

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r_format" name="FFVideoFormat${h}p${ntsc ? (fps).toFixed(2).replace('.', '') : base}" frameDuration="${rt(1)}" width="${w}" height="${h}"/>
${resources.join('\n')}
  </resources>
  <library>
    <event name="${title}">
      <project name="${title}">
        <sequence format="r_format" duration="${rt(total)}" tcStart="0s" tcFormat="NDF">
          <spine>
            <gap name="Gap" offset="0s" duration="${rt(total)}" start="0s">
${clips.join('\n')}
            </gap>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;
}
