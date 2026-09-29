/**
 * Timeline health check (Clawbot "Analyze") and the one-click delivery presets.
 */
import type { EditorProject, ExportCodec } from "./models.js";
import { buildTimelineSegments } from "./timeline.js";

const tc = (frame: number, fps: number) => {
  const s = Math.floor(frame / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Gaps in the picture: ranges where no enabled video clip on any track covers the frame. */
export function pictureGaps(project: EditorProject, minFrames = 3): Array<{ start: number; end: number }> {
  const spans = buildTimelineSegments(project.sequence, project.assets)
    .filter((s) => s.track.kind === "video" && s.clip.isEnabled && !s.track.muted)
    .map((s) => [s.startFrame, s.endFrame] as const)
    .sort((a, b) => a[0] - b[0]);
  const gaps: Array<{ start: number; end: number }> = [];
  let covered = spans.length ? spans[0][1] : 0;
  for (const [start, end] of spans.slice(1)) {
    if (start - covered >= minFrames) gaps.push({ start: covered, end: start });
    covered = Math.max(covered, end);
  }
  return gaps;
}

export function analyzeTimelineHealth(project: EditorProject): string[] {
  const fps = project.sequence.settings.fps || 30;
  const segs = buildTimelineSegments(project.sequence, project.assets);
  const issues: string[] = [];

  for (const s of segs) {
    if (s.track.kind === "audio" && (s.clip.volume ?? 1) > 1.5) {
      issues.push(`⚠️ "${s.asset.name}" audio may clip (volume ${Math.round((s.clip.volume ?? 1) * 100)}%)`);
    }
  }

  const gaps = pictureGaps(project);
  if (gaps.length) {
    const where = gaps.slice(0, 3).map((g) => tc(g.start, fps)).join(", ");
    issues.push(`🕳 ${gaps.length} black gap${gaps.length > 1 ? "s" : ""} in the picture (at ${where}${gaps.length > 3 ? ", …" : ""}) — Close All Gaps removes the ones with nothing under them`);
  }

  // Footage only: titles, generated and nested clips aren't graded or flash-cut candidates.
  const footage = segs.filter((s) => s.track.kind === "video" && s.clip.isEnabled && s.asset.sourcePath && !s.clip.titleConfig && !s.clip.nestedSequenceId);
  const graded = (c: (typeof footage)[number]["clip"]) => (c.colorGrade && !c.colorGrade.bypass) || (c.gradeNodes?.length ?? 0) > 0;
  const ungraded = footage.filter((s) => !graded(s.clip)).length;
  if (ungraded > 0 && footage.length > 2) issues.push(`🎨 ${ungraded} clip${ungraded > 1 ? "s have" : " has"} no color grade applied`);

  const short = footage.filter((s) => s.durationFrames < Math.round(fps / 2)).length;
  if (short > 0) issues.push(`⚡ ${short} very short clip${short > 1 ? "s" : ""} (under 0.5s) — may cause flash cuts`);

  return issues.length ? issues : ["✅ Timeline looks healthy! No obvious issues found."];
}

export interface HealthIssue { severity: "error" | "warning" | "info"; message: string; clipId?: string }

/** Structured health report (Project Health panel). */
export function projectHealthIssues(project: EditorProject): { issues: HealthIssue[]; score: number; summary: string } {
  const { tracks, settings } = project.sequence;
  const fps = settings.fps || 30;
  const segs = buildTimelineSegments(project.sequence, project.assets).filter((s) => s.clip.isEnabled);
  const issues: HealthIssue[] = [];
  for (const s of segs) {
    if ((s.clip.volume ?? 1) > 1.8) issues.push({ severity: "warning", message: `"${s.asset.name}" volume at ${Math.round((s.clip.volume ?? 1) * 100)}% — may peak/distort`, clipId: s.clip.id });
  }
  for (const t of tracks) {
    if ((t.volume ?? 1) > 1.9) issues.push({ severity: "warning", message: `Track "${t.name}" volume very high — risk of clipping` });
  }
  const footage = segs.filter((s) => s.track.kind === "video" && s.asset.sourcePath && !s.clip.titleConfig && !s.clip.nestedSequenceId);
  const ungraded = footage.filter((s) => !((s.clip.colorGrade && !s.clip.colorGrade.bypass) || (s.clip.gradeNodes?.length ?? 0) > 0)).length;
  if (ungraded > 0 && footage.length > 2) issues.push({ severity: "info", message: `${ungraded} of ${footage.length} video clips have no color grade applied` });
  for (const g of pictureGaps(project, Math.round(fps))) {
    issues.push({ severity: "warning", message: `${((g.end - g.start) / fps).toFixed(1)}s of black at ${tc(g.start, fps)}` });
  }
  if (!tracks.some((t) => t.kind === "audio") && footage.length > 0) issues.push({ severity: "warning", message: "No audio tracks — did you forget background music or voiceover?" });
  if (![23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60].some((f) => Math.abs(f - settings.fps) < 0.01)) issues.push({ severity: "error", message: `Unusual frame rate: ${settings.fps}fps — most platforms expect 24/30/60fps` });
  if (settings.width % 2 !== 0 || settings.height % 2 !== 0) issues.push({ severity: "error", message: `Resolution ${settings.width}×${settings.height} has odd dimensions — H.264 requires even numbers` });
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  return { issues, score: Math.max(0, 100 - errors * 20 - warnings * 5), summary: `${errors} errors, ${warnings} warnings` };
}

export interface DeliveryFormat {
  label: string;
  codec: ExportCodec;
  outputWidth: number;
  outputHeight: number;
  suffix: string;
  audioOnly?: boolean;
}

export const DELIVERY_FORMATS: DeliveryFormat[] = [
  { label: "YouTube 1080p", codec: "libx264", outputWidth: 1920, outputHeight: 1080, suffix: "_youtube" },
  { label: "Instagram Reel (9:16)", codec: "libx264", outputWidth: 1080, outputHeight: 1920, suffix: "_instagram_reel" },
  { label: "TikTok (9:16)", codec: "libx264", outputWidth: 1080, outputHeight: 1920, suffix: "_tiktok" },
  { label: "Twitter/X (720p)", codec: "libx264", outputWidth: 1280, outputHeight: 720, suffix: "_twitter" },
  { label: "ProRes Master", codec: "prores_ks", outputWidth: 0, outputHeight: 0, suffix: "_master" },
  { label: "Audio Only (AAC)", codec: "libx264", outputWidth: 0, outputHeight: 0, suffix: "_audio", audioOnly: true },
];
