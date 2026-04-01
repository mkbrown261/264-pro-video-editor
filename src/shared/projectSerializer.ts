// ─────────────────────────────────────────────────────────────────────────────
// 264 Pro – .264proj Project Serializer
// JSON-based, human-readable, versioned, extensible project format.
// ─────────────────────────────────────────────────────────────────────────────

import type { EditorProject, TimelineClip } from "./models.js";

export const PROJ_FORMAT_VERSION = 2;

// ── Serialized envelope ───────────────────────────────────────────────────────

export interface ProjectFile {
  /** Format version – used for migration */
  version: number;
  /** Human-readable app identifier */
  app: "264pro";
  /** ISO-8601 creation timestamp */
  createdAt: string;
  /** ISO-8601 last-saved timestamp */
  savedAt: string;
  /** Full project data */
  project: EditorProject;
}

// ── Serialization ─────────────────────────────────────────────────────────────

/**
 * Serialize an EditorProject to a JSON string (.264proj file content).
 * All data is preserved; file paths remain absolute on disk.
 */
export function serializeProject(project: EditorProject, createdAt?: string): string {
  const now = new Date().toISOString();
  const envelope: ProjectFile = {
    version: PROJ_FORMAT_VERSION,
    app: "264pro",
    createdAt: createdAt ?? now,
    savedAt: now,
    project
  };
  return JSON.stringify(envelope, null, 2);
}

// ── Deserialization / Migration ───────────────────────────────────────────────

export interface DeserializeResult {
  project: EditorProject;
  createdAt: string;
  savedAt: string;
  version: number;
  warnings: string[];
}

/**
 * Parse a .264proj JSON string back into an EditorProject.
 * Applies forward-migrations so old files always load correctly.
 * Throws if the file is not valid JSON or missing required fields.
 */
export function deserializeProject(json: string): DeserializeResult {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const warnings: string[] = [];

  // Validate envelope
  if (raw["app"] !== "264pro") {
    warnings.push("File was not created by 264 Pro — attempting load anyway.");
  }

  const version = typeof raw["version"] === "number" ? raw["version"] : 1;
  let project = raw["project"] as EditorProject;

  if (!project || typeof project !== "object") {
    throw new Error("Invalid .264proj file: missing project data.");
  }

  // ── Migrations ──────────────────────────────────────────────────────────────

  if (version < 2) {
    // v1 → v2: ensure all clips have the fields added in v2
    project = migrateV1toV2(project, warnings);
  }

  // Always ensure structural integrity
  project = sanitizeProject(project, warnings);

  return {
    project,
    createdAt: (raw["createdAt"] as string) ?? new Date().toISOString(),
    savedAt: (raw["savedAt"] as string) ?? new Date().toISOString(),
    version,
    warnings
  };
}

// ── Migration helpers ─────────────────────────────────────────────────────────

function migrateV1toV2(project: EditorProject, warnings: string[]): EditorProject {
  warnings.push("Migrating project from format v1 to v2.");
  return {
    ...project,
    sequence: {
      ...project.sequence,
      clips: project.sequence.clips.map((clip: TimelineClip) => ({
        // Spread the original clip first, then fill any v1-missing fields with defaults
        ...clip,
        masks: clip.masks ?? [],
        effects: clip.effects ?? [],
        colorGrade: clip.colorGrade ?? null,
        volume: clip.volume ?? 1,
        speed: clip.speed ?? 1,
        aiBackgroundRemoval: clip.aiBackgroundRemoval ?? null,
        beatSync: clip.beatSync ?? null
      }))
    }
  };
}

/**
 * Ensure every required field exists so the app never crashes on a partial file.
 * Non-destructive: only fills in missing values.
 */
function sanitizeProject(project: EditorProject, _warnings: string[]): EditorProject {
  return {
    id: project.id ?? generateId(),
    name: project.name ?? "Untitled Project",
    assets: Array.isArray(project.assets) ? project.assets : [],
    sequence: {
      id: project.sequence?.id ?? generateId(),
      name: project.sequence?.name ?? "Main Timeline",
      tracks: Array.isArray(project.sequence?.tracks) ? project.sequence.tracks : [],
      clips: Array.isArray(project.sequence?.clips)
        ? project.sequence.clips.map((clip: TimelineClip) => ({
            id: clip.id ?? generateId(),
            assetId: clip.assetId ?? "",
            trackId: clip.trackId ?? "",
            startFrame: clip.startFrame ?? 0,
            trimStartFrames: clip.trimStartFrames ?? 0,
            trimEndFrames: clip.trimEndFrames ?? 0,
            linkedGroupId: clip.linkedGroupId ?? null,
            isEnabled: clip.isEnabled ?? true,
            transitionIn: clip.transitionIn ?? null,
            transitionOut: clip.transitionOut ?? null,
            masks: Array.isArray(clip.masks) ? clip.masks : [],
            effects: Array.isArray(clip.effects) ? clip.effects : [],
            colorGrade: clip.colorGrade ?? null,
            volume: typeof clip.volume === "number" ? clip.volume : 1,
            speed: typeof clip.speed === "number" ? clip.speed : 1,
            transform: clip.transform ?? null,
            compGraph: clip.compGraph ?? null,
            aiBackgroundRemoval: clip.aiBackgroundRemoval ?? null,
            beatSync: clip.beatSync ?? null
          }))
        : [],
      settings: {
        width: project.sequence?.settings?.width ?? 1920,
        height: project.sequence?.settings?.height ?? 1080,
        fps: project.sequence?.settings?.fps ?? 30,
        audioSampleRate: project.sequence?.settings?.audioSampleRate ?? 48000
      },
      beatSync: project.sequence?.beatSync ?? null,
      markers: Array.isArray(project.sequence?.markers) ? project.sequence.markers : []
    }
  };
}

function generateId(): string {
  if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
