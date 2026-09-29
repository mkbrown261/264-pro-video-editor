/**
 * Project file lifecycle (extracted from App.tsx): new / open / open recent /
 * save / save as, the recent-projects list, dirty tracking and the
 * "unsaved changes" prompt.
 *
 * Dirty = the store's project is not the one last saved or loaded. Comparing
 * references (instead of flagging on every change) means a freshly opened
 * project is clean, and edits made while a save is in flight stay dirty.
 */
import { useRef, useState } from "react";
import { createEmptyProject, type EditorProject } from "../../shared/models";
import { deserializeProject, serializeProject } from "../../shared/projectSerializer";
import { useEditorStore } from "../store/editorStore";

export type SaveConfirmAction = "new" | "open" | "close";
export interface RecentProject { name: string; path: string; date: string }

const LOCAL_KEY = "264pro_project_v2";
const RECENT_KEY = "264pro_recent_projects";
const LOCAL_PATH = "[localStorage]";

export interface ProjectFileOptions {
  project: EditorProject;
  fsLinked: boolean;
  setExportMessage: (msg: string | null) => void;
  /** Called after a project is created or opened (close panels etc.). */
  onProjectReplaced?: () => void;
}

/** IPC handlers return an `{ error }` object on failure instead of throwing. */
function savedPathOrThrow(result: unknown): string | null {
  if (typeof result === "string" && result) return result;
  if (result && typeof result === "object" && "error" in result) throw new Error(String((result as { error: unknown }).error));
  return null;
}

export function useProjectFile({ project, fsLinked, setExportMessage, onProjectReplaced }: ProjectFileOptions) {
  const loadProjectFromData = useEditorStore((s) => s.loadProjectFromData);
  const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
  const [cleanProject, setCleanProject] = useState<EditorProject>(project);
  const createdAtRef = useRef<string>(new Date().toISOString());
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); }
    catch { return []; }
  });
  const [saveConfirm, setSaveConfirm] = useState<{ action: SaveConfirmAction } | null>(null);
  const pendingActionRef = useRef<SaveConfirmAction | null>(null);

  const projectDirty = project !== cleanProject;
  const markClean = (p: EditorProject = useEditorStore.getState().project) => setCleanProject(p);

  function addToRecentProjects(name: string, path: string) {
    const entry = { name, path, date: new Date().toLocaleDateString() };
    setRecentProjects((prev) => {
      const next = [entry, ...prev.filter((r) => r.path !== path).slice(0, 9)];
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      if (window.flowstateAPI && fsLinked) {
        void window.flowstateAPI.apiCall("/api/264pro/sync-projects", "POST", {
          projects: next.map((r, i) => ({ id: `local_${i}`, name: r.name, lastModified: new Date().toISOString() })),
        });
      }
      return next;
    });
  }

  function forgetRecent(path: string) {
    setRecentProjects((prev) => {
      const next = prev.filter((r) => r.path !== path);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function loadJson(json: string, filePath: string | null) {
    const { project: loaded, warnings, createdAt } = deserializeProject(json);
    loadProjectFromData(loaded);
    markClean();
    setCurrentProjectPath(filePath === LOCAL_PATH ? null : filePath);
    createdAtRef.current = createdAt;
    if (filePath) addToRecentProjects(loaded.name, filePath);
    setExportMessage(warnings.length ? `⚠ Loaded (${warnings.join(", ")})` : "✓ Project loaded.");
    onProjectReplaced?.();
  }

  /** Save to the current file (or ask where). Resolves false if cancelled or failed. */
  async function save(): Promise<boolean> {
    const snapshot = project;
    const json = serializeProject(snapshot, createdAtRef.current);
    if (!window.editorApi) {
      try {
        localStorage.setItem(LOCAL_KEY, json);
        markClean(snapshot);
        setExportMessage("✓ Project saved to local storage.");
        return true;
      } catch {
        setExportMessage("Failed to save project.");
        return false;
      }
    }
    try {
      const saved = savedPathOrThrow(currentProjectPath
        ? await window.editorApi.saveProjectAs(json, currentProjectPath)
        : await window.editorApi.saveProject(json, snapshot.name));
      if (!saved) return false;
      setCurrentProjectPath(saved);
      markClean(snapshot);
      addToRecentProjects(snapshot.name, saved);
      setExportMessage(`✓ Saved to ${saved}`);
      if (window.flowstateAPI && fsLinked) {
        void window.flowstateAPI.apiCall("/api/264pro/context-sync", "POST", {
          projectName: snapshot.name ?? "Untitled",
          trackCount: snapshot.sequence?.tracks?.length ?? 0,
          clipCount: snapshot.sequence.clips.length,
          fps: snapshot.sequence.settings.fps,
          resolution: `${snapshot.sequence.settings.width}×${snapshot.sequence.settings.height}`,
          lastModified: new Date().toISOString(),
        });
      }
      return true;
    } catch (err) {
      setExportMessage(err instanceof Error ? `Save failed: ${err.message}` : "Save failed.");
      return false;
    }
  }

  async function saveAs(): Promise<boolean> {
    if (!window.editorApi) { setExportMessage("Save requires Electron."); return false; }
    const snapshot = project;
    try {
      const saved = savedPathOrThrow(await window.editorApi.saveProject(serializeProject(snapshot, createdAtRef.current), snapshot.name));
      if (!saved) return false;
      setCurrentProjectPath(saved);
      markClean(snapshot);
      addToRecentProjects(snapshot.name, saved);
      setExportMessage(`✓ Saved as ${saved}`);
      return true;
    } catch (err) {
      setExportMessage(err instanceof Error ? `Save failed: ${err.message}` : "Save failed.");
      return false;
    }
  }

  /** Ask before discarding unsaved work; runs `action` now if clean. */
  function guard(action: SaveConfirmAction, run: () => void): void {
    if (projectDirty) {
      pendingActionRef.current = action;
      setSaveConfirm({ action });
      return;
    }
    run();
  }

  function doNewProject() {
    loadProjectFromData(createEmptyProject());
    markClean();
    setCurrentProjectPath(null);
    createdAtRef.current = new Date().toISOString();
    setExportMessage("✓ New project created.");
    onProjectReplaced?.();
  }

  async function doOpen(path?: string) {
    try {
      if (!window.editorApi) {
        const raw = localStorage.getItem(LOCAL_KEY);
        if (raw) loadJson(raw, LOCAL_PATH);
        else setExportMessage("No saved project found.");
        return;
      }
      if (path && path !== LOCAL_PATH && window.editorApi.openProjectPath) {
        const result = await window.editorApi.openProjectPath(path);
        if (result && "json" in result) { loadJson(result.json, result.filePath); return; }
        forgetRecent(path);
        setExportMessage(`Couldn't open ${path}${result && "error" in result ? `: ${result.error}` : ""}`);
        return;
      }
      const result = await window.editorApi.openProject();
      if (!result) return;
      if ("error" in result) throw new Error(String((result as { error: unknown }).error));
      loadJson(result.json, result.filePath);
    } catch (err) {
      setExportMessage(err instanceof Error ? `Load failed: ${err.message}` : "Load failed.");
    }
  }

  const pendingPathRef = useRef<string | undefined>(undefined);
  const newProject = () => guard("new", doNewProject);
  const open = () => { pendingPathRef.current = undefined; guard("open", () => void doOpen()); };
  const openRecent = (path: string) => { pendingPathRef.current = path; guard("open", () => void doOpen(path)); };

  /** Resolve the unsaved-changes prompt. A cancelled or failed save aborts the action. */
  async function resolveSaveConfirm(choice: "save" | "discard" | "cancel") {
    const action = pendingActionRef.current;
    const path = pendingPathRef.current;
    setSaveConfirm(null);
    pendingActionRef.current = null;
    pendingPathRef.current = undefined;
    if (choice === "cancel" || !action) return;
    if (choice === "save" && !(await save())) return;
    if (action === "new") doNewProject();
    else if (action === "open") await doOpen(path);
    else if (action === "close") {
      // Clean first so the beforeunload guard doesn't block the close.
      markClean();
      setTimeout(() => { void window.editorApi?.confirmClose(); }, 50);
    }
  }

  const requestClose = () => { pendingActionRef.current = "close"; setSaveConfirm({ action: "close" }); };

  return {
    currentProjectPath, projectDirty, createdAtRef, markClean,
    recentProjects, saveConfirm,
    save, saveAs, newProject, open, openRecent, requestClose, resolveSaveConfirm,
  };
}
