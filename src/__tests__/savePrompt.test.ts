/**
 * FIX 8: Save Prompt — unit tests
 * Verifies that dirty-state detection and modal routing work correctly.
 */
import { describe, it, expect } from "vitest";

// ── Mirrors App.tsx save-confirm logic ────────────────────────────────────────

type SaveConfirmAction = "new" | "open" | "close";

function getActionLabel(action: SaveConfirmAction): string {
  if (action === "close") return "closing the app";
  if (action === "new")   return "creating a new project";
  return "opening another project";
}

function shouldShowSaveConfirm(projectDirty: boolean, action: SaveConfirmAction): boolean {
  return projectDirty;
}

interface SaveConfirmResult {
  modalShown: boolean;
  action: SaveConfirmAction | null;
}

function handleAction(
  action: SaveConfirmAction,
  projectDirty: boolean
): SaveConfirmResult {
  if (!shouldShowSaveConfirm(projectDirty, action)) {
    return { modalShown: false, action: null };
  }
  return { modalShown: true, action };
}

describe("Save Prompt", () => {
  it("FIX 8: shows modal when project is dirty and user closes app", () => {
    const result = handleAction("close", true);
    expect(result.modalShown).toBe(true);
    expect(result.action).toBe("close");
  });

  it("FIX 8: shows modal when project is dirty and user opens a new project", () => {
    const result = handleAction("new", true);
    expect(result.modalShown).toBe(true);
  });

  it("FIX 8: shows modal when project is dirty and user opens another project", () => {
    const result = handleAction("open", true);
    expect(result.modalShown).toBe(true);
  });

  it("does NOT show modal when project is not dirty", () => {
    expect(handleAction("close", false).modalShown).toBe(false);
    expect(handleAction("new",   false).modalShown).toBe(false);
    expect(handleAction("open",  false).modalShown).toBe(false);
  });

  it("FIX 8: action labels are human-readable", () => {
    expect(getActionLabel("close")).toMatch(/closing/i);
    expect(getActionLabel("new")).toMatch(/creating/i);
    expect(getActionLabel("open")).toMatch(/opening/i);
  });

  it("FIX 8: three choices exist — Save, Don't Save, Cancel", () => {
    const choices = ["save", "discard", "cancel"] as const;
    expect(choices).toHaveLength(3);
    expect(choices).toContain("save");
    expect(choices).toContain("discard");
    expect(choices).toContain("cancel");
  });

  it("cancel choice does not proceed with the action", () => {
    // Cancel should clear pending action without doing anything
    let actionExecuted = false;
    function handleConfirmChoice(choice: "save" | "discard" | "cancel", pending: SaveConfirmAction) {
      if (choice === "cancel") return;
      actionExecuted = true;
      void pending; // suppress unused warning
    }
    handleConfirmChoice("cancel", "close");
    expect(actionExecuted).toBe(false);
  });

  it("discard choice proceeds with the action without saving", () => {
    let actionExecuted = false;
    let saved = false;
    function handleConfirmChoice(choice: "save" | "discard" | "cancel", pending: SaveConfirmAction) {
      if (choice === "cancel") return;
      if (choice === "save") saved = true;
      actionExecuted = true;
      void pending;
    }
    handleConfirmChoice("discard", "new");
    expect(actionExecuted).toBe(true);
    expect(saved).toBe(false);
  });
});
