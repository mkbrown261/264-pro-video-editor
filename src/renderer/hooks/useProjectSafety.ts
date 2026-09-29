/**
 * Unsaved-work protection (extracted from App.tsx):
 *  - Electron close button → save prompt when dirty
 *  - browser beforeunload safety net
 *  - autosave every 3 minutes once the project has a file on disk
 *  - crash-recovery snapshot every 60 s to userData/autosave
 */
import { useEffect, useRef } from "react";
import type { EditorProject } from "../../shared/models";
import { serializeProject } from "../../shared/projectSerializer";

export interface ProjectSafetyOptions {
  project: EditorProject;
  projectDirty: boolean;
  currentProjectPath: string | null;
  createdAt: string;
  /** Close requested while dirty: show the save prompt. */
  onCloseWhileDirty: () => void;
  save: () => Promise<void>;
  onAutosaved: () => void;
}

export function useProjectSafety(opts: ProjectSafetyOptions) {
  const latest = useRef(opts);
  latest.current = opts;
  const { projectDirty, currentProjectPath } = opts;

  useEffect(() => {
    if (!window.editorApi?.onBeforeClose) return;
    return window.editorApi.onBeforeClose(() => {
      if (!latest.current.projectDirty) {
        void window.editorApi?.confirmClose();
        return;
      }
      latest.current.onCloseWhileDirty();
    });
  }, []);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!projectDirty) return;
      e.preventDefault();
      e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [projectDirty]);

  // Autosave only once a real file exists (no misleading "saved" before that).
  useEffect(() => {
    if (!currentProjectPath) return;
    const id = setInterval(async () => {
      const o = latest.current;
      if (!o.currentProjectPath || !o.projectDirty) return;
      try { await o.save(); o.onAutosaved(); } catch { /* silent */ }
    }, 3 * 60 * 1000);
    return () => clearInterval(id);
  }, [currentProjectPath]);

  // Crash recovery. The timer must not depend on `project`: it changes on
  // every edit, which kept resetting a project-keyed interval so the snapshot
  // never ran while you were actively editing.
  useEffect(() => {
    const id = setInterval(() => {
      const { project, createdAt } = latest.current;
      try {
        if (project.id && project.sequence.clips.length > 0) {
          window.editorApi?.autosaveProject?.(serializeProject(project, createdAt), project.id).catch(() => {});
        }
      } catch { /* silent */ }
    }, 60_000);
    return () => clearInterval(id);
  }, []);
}
