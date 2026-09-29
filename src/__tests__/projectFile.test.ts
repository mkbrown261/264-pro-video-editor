import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProjectFile } from "../renderer/hooks/useProjectFile";
import { useEditorStore } from "../renderer/store/editorStore";
import { createEmptyProject } from "../shared/models";
import { serializeProject } from "../shared/projectSerializer";

type Api = Record<string, ReturnType<typeof vi.fn>>;
function mount(api: Partial<Api> = {}) {
  (window as unknown as { editorApi: unknown }).editorApi = {
    saveProject: vi.fn(async () => "/p/new.264proj"),
    saveProjectAs: vi.fn(async (_j: string, p: string) => p),
    openProject: vi.fn(async () => null),
    confirmClose: vi.fn(),
    ...api,
  };
  const msg = vi.fn();
  const h = renderHook(() => useProjectFile({ project: useEditorStore((s) => s.project), fsLinked: false, setExportMessage: msg }));
  return { h, msg, api: (window as unknown as { editorApi: Api }).editorApi };
}
const edit = () => act(() => { useEditorStore.getState().loadProjectFromData({ ...useEditorStore.getState().project, name: "edited " + Math.random() }); });

describe("useProjectFile", () => {
  beforeEach(() => { useEditorStore.getState().loadProjectFromData(createEmptyProject()); });
  afterEach(() => { delete (window as unknown as { editorApi?: unknown }).editorApi; });

  it("is clean after open and dirty after an edit", async () => {
    const saved = { ...createEmptyProject(), name: "Film" };
    const { h } = mount({ openProjectPath: vi.fn(async (p: string) => ({ json: serializeProject(saved, "2020-01-01T00:00:00.000Z"), filePath: p })) });
    await act(async () => { h.result.current.openRecent("/p/film.264proj"); });
    expect(useEditorStore.getState().project.name).toBe("Film");
    expect(h.result.current.projectDirty).toBe(false);
    expect(h.result.current.currentProjectPath).toBe("/p/film.264proj");
    expect(h.result.current.createdAtRef.current).toBe("2020-01-01T00:00:00.000Z");
    edit();
    expect(h.result.current.projectDirty).toBe(true);
  });

  it("a cancelled save in the unsaved-changes prompt aborts the pending action", async () => {
    const { h, api } = mount({ saveProject: vi.fn(async () => null) });
    edit();
    act(() => { h.result.current.newProject(); });
    expect(h.result.current.saveConfirm?.action).toBe("new");
    const name = useEditorStore.getState().project.name;
    await act(async () => { await h.result.current.resolveSaveConfirm("save"); });
    expect(useEditorStore.getState().project.name).toBe(name); // nothing discarded
    expect(api.confirmClose).not.toHaveBeenCalled();
  });

  it("a failed save reports the error instead of silently succeeding", async () => {
    const { h, msg } = mount({ saveProject: vi.fn(async () => ({ success: false, error: "disk full" })) });
    edit();
    let ok = true;
    await act(async () => { ok = await h.result.current.save(); });
    expect(ok).toBe(false);
    expect(h.result.current.projectDirty).toBe(true);
    expect(msg).toHaveBeenLastCalledWith("Save failed: disk full");
  });

  it("save marks clean and re-saves silently to the same path", async () => {
    const { h, api } = mount();
    edit();
    await act(async () => { await h.result.current.save(); });
    expect(h.result.current.projectDirty).toBe(false);
    edit();
    await act(async () => { await h.result.current.save(); });
    expect(api.saveProjectAs).toHaveBeenCalledWith(expect.any(String), "/p/new.264proj");
  });
});
