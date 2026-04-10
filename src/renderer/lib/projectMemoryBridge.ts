/**
 * projectMemoryBridge.ts
 *
 * Shared singleton that lets AIToolsPanel (and any other panel) record
 * tool usage into the same ProjectMemoryEngine that FlowStatePanel reads
 * when it builds its Clawbot context payload.
 *
 * Import pattern:
 *   import { projectMemory, notifyToolUsed } from "../lib/projectMemoryBridge";
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type DiagnosticIssueSeverity = "high" | "medium" | "low";
export type DiagnosticIssueType =
  | "clipping"
  | "loudness"
  | "frequency"
  | "masking"
  | "gap"
  | "orphan";

export interface DiagnosticIssue {
  type: DiagnosticIssueType;
  message: string;
  track?: string;
  severity: DiagnosticIssueSeverity;
}

export interface SessionMemoryState {
  editsMade: number;
  toolsUsed: string[];
  clipCount: number;
  diagnostics: DiagnosticIssue[];
  lastDiagRun: number;
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class ProjectMemoryEngine {
  state: SessionMemoryState = {
    editsMade: 0,
    toolsUsed: [],
    clipCount: 0,
    diagnostics: [],
    lastDiagRun: 0,
  };

  recordEdit(): void {
    this.state.editsMade++;
  }

  recordTool(toolName: string): void {
    if (!this.state.toolsUsed.includes(toolName)) {
      this.state.toolsUsed = [...this.state.toolsUsed, toolName];
    }
  }

  updateClipCount(count: number): void {
    this.state.clipCount = count;
  }

  setDiagnostics(issues: DiagnosticIssue[]): void {
    this.state.diagnostics = issues;
    this.state.lastDiagRun = Date.now();
  }

  /** Lightweight local diagnostics — zero AI cost. */
  runLocalDiagnostics(
    tracks: any[],
    clips: any[],
    audioMetrics?: {
      peakDb?: number;
      lufs?: number;
      frequencyProfile?: { low: number; mid: number; high: number };
    }
  ): DiagnosticIssue[] {
    const issues: DiagnosticIssue[] = [];

    // Timeline gap detection
    if (clips.length > 1) {
      const sorted = [...clips].sort(
        (a, b) => (a.startFrame ?? 0) - (b.startFrame ?? 0)
      );
      for (let i = 0; i < sorted.length - 1; i++) {
        const endFrame =
          (sorted[i].startFrame ?? 0) + (sorted[i].durationFrames ?? 0);
        const nextStart = sorted[i + 1].startFrame ?? 0;
        if (nextStart - endFrame > 5) {
          issues.push({
            type: "gap",
            message: `Timeline gap detected around clip "${sorted[i].name ?? "Unknown"}"`,
            severity: "low",
          });
          break;
        }
      }
    }

    // Large track count warning
    if (tracks.length > 20) {
      issues.push({
        type: "masking",
        message: `${tracks.length} tracks — complex project. Consider grouping/nesting tracks for clarity`,
        severity: "low",
      });
    }

    // Audio metrics
    if (audioMetrics) {
      const { peakDb, lufs, frequencyProfile } = audioMetrics;
      if (peakDb != null && peakDb > -1) {
        issues.push({
          type: "clipping",
          message: `Master peak ${peakDb.toFixed(1)} dBFS — reduce gain by ${Math.abs(peakDb + 3).toFixed(1)} dB`,
          severity: "high",
        });
      }
      if (lufs != null && lufs > -8) {
        issues.push({
          type: "loudness",
          message: `LUFS ${lufs.toFixed(1)} — too loud for streaming (target -14 LUFS)`,
          severity: "medium",
        });
      }
      if (frequencyProfile) {
        const total =
          frequencyProfile.low + frequencyProfile.mid + frequencyProfile.high;
        if (total > 0 && frequencyProfile.low / total > 0.55) {
          issues.push({
            type: "frequency",
            message: "Low-heavy mix — highpass at 80Hz, cut 200-400Hz by 2dB",
            severity: "medium",
          });
        }
      }
    }

    this.setDiagnostics(issues);
    return issues;
  }

  getSummary(): SessionMemoryState {
    return { ...this.state };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

/** Single shared instance — imported by FlowStatePanel AND AIToolsPanel. */
export const projectMemory = new ProjectMemoryEngine();

/**
 * Call this from any panel when an AI tool or video-gen job starts.
 * Records the tool name so Clawbot knows what the user runs most.
 *
 * @param toolName  Human-readable tool ID, e.g. "upscale", "seedance_t2v"
 */
export function notifyToolUsed(toolName: string): void {
  projectMemory.recordTool(toolName);
}
