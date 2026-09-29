import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEditorShortcuts, type EditorShortcutOptions } from "../renderer/hooks/useEditorShortcuts";

function setup(extra: Partial<EditorShortcutOptions> = {}) {
  const o = {
    sequenceFps: 30,
    onTogglePlayback: vi.fn(), onToggleFullscreen: vi.fn(), onSelectTool: vi.fn(), onToggleBladeTool: vi.fn(),
    onSplitSelectedClip: vi.fn(), onNudgePlayhead: vi.fn(), onSeekToStart: vi.fn(), onSeekToEnd: vi.fn(),
    onRemoveSelectedClip: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onSave: vi.fn(), onOpen: vi.fn(),
    onNewProject: vi.fn(), onDuplicateSelectedClip: vi.fn(), onDetachAudio: vi.fn(), onToggleProjectNotes: vi.fn(),
    onToggleTrimPanel: vi.fn(), onToggleSettings: vi.fn(),
    ...extra,
  };
  renderHook(() => useEditorShortcuts(o));
  return o;
}
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));

describe("editor shortcuts", () => {
  it("Cmd+Shift+N opens notes, not a new project", () => {
    const o = setup();
    press("N", { metaKey: true, shiftKey: true });
    expect(o.onToggleProjectNotes).toHaveBeenCalledOnce();
    expect(o.onNewProject).not.toHaveBeenCalled();
    press("n", { metaKey: true });
    expect(o.onNewProject).toHaveBeenCalledOnce();
  });

  it("Cmd+Shift+D detaches audio instead of duplicating", () => {
    const o = setup();
    press("D", { ctrlKey: true, shiftKey: true });
    expect(o.onDetachAudio).toHaveBeenCalledOnce();
    expect(o.onDuplicateSelectedClip).not.toHaveBeenCalled();
  });

  it("a focused slider doesn't swallow Space, a text field does", () => {
    const o = setup();
    const range = document.createElement("input"); range.type = "range"; document.body.appendChild(range);
    const text = document.createElement("input"); document.body.appendChild(text);
    press(" ", {}, range);
    press(" ", {}, text);
    expect(o.onTogglePlayback).toHaveBeenCalledOnce();
  });

  it("an open modal blocks unmodified shortcuts but not Cmd+S", () => {
    const o = setup({ isModalOpen: true });
    press("Delete"); press("t");
    press("s", { metaKey: true });
    expect(o.onRemoveSelectedClip).not.toHaveBeenCalled();
    expect(o.onToggleTrimPanel).not.toHaveBeenCalled();
    expect(o.onSave).toHaveBeenCalledOnce();
  });

  it("T and Cmd+, route to their panels", () => {
    const o = setup();
    press("t"); press(",", { metaKey: true });
    expect(o.onToggleTrimPanel).toHaveBeenCalledOnce();
    expect(o.onToggleSettings).toHaveBeenCalledOnce();
  });
});
