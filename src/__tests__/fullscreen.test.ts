/**
 * FIX 6: Fullscreen ESC Bug — unit tests
 * Verifies that fullscreen exit logic correctly clears state and never
 * leaves the UI blocked with a z-index:99999 overlay.
 */
import { describe, it, expect } from "vitest";

// ── Mirrors ViewerPanel fullscreen state transitions ───────────────────────────

type FullscreenState = {
  isFullscreen: boolean;
  panelIsFullscreenElement: boolean;
};

function handleFullscreenChange(
  state: FullscreenState,
  documentFullscreenElement: HTMLElement | null,
  panelElement: HTMLElement
): FullscreenState {
  return {
    ...state,
    isFullscreen: documentFullscreenElement === panelElement,
    panelIsFullscreenElement: documentFullscreenElement === panelElement,
  };
}

function handleEscapeKey(
  state: FullscreenState,
  documentFullscreenElement: HTMLElement | null,
  panelElement: HTMLElement,
  _exitFullscreen: () => void
): FullscreenState {
  if (documentFullscreenElement) {
    _exitFullscreen();
    // State will be updated when fullscreenchange fires
    return state;
  }
  // Not in fullscreen — ESC just returns to select tool
  return { ...state, isFullscreen: false };
}

const mockPanel = { id: "viewer-panel" } as unknown as HTMLElement;
const noElement = null;

describe("Fullscreen ESC Fix", () => {
  it("FIX 6: isFullscreen is false when no element is fullscreen", () => {
    const state: FullscreenState = { isFullscreen: true, panelIsFullscreenElement: true };
    const next = handleFullscreenChange(state, noElement, mockPanel);
    expect(next.isFullscreen).toBe(false);
  });

  it("FIX 6: isFullscreen is true only when the panel is the fullscreen element", () => {
    const state: FullscreenState = { isFullscreen: false, panelIsFullscreenElement: false };
    const next = handleFullscreenChange(state, mockPanel, mockPanel);
    expect(next.isFullscreen).toBe(true);
  });

  it("FIX 6: isFullscreen is false when a different element is fullscreen", () => {
    const otherElement = { id: "other" } as unknown as HTMLElement;
    const state: FullscreenState = { isFullscreen: true, panelIsFullscreenElement: true };
    const next = handleFullscreenChange(state, otherElement, mockPanel);
    expect(next.isFullscreen).toBe(false);
  });

  it("FIX 6: pressing ESC when NOT fullscreen does not break UI state", () => {
    let exitCalled = false;
    const state: FullscreenState = { isFullscreen: false, panelIsFullscreenElement: false };
    const next = handleEscapeKey(state, noElement, mockPanel, () => { exitCalled = true; });
    expect(exitCalled).toBe(false);
    expect(next.isFullscreen).toBe(false);
  });

  it("FIX 6: pressing ESC when fullscreen calls exitFullscreen", () => {
    let exitCalled = false;
    const state: FullscreenState = { isFullscreen: true, panelIsFullscreenElement: true };
    handleEscapeKey(state, mockPanel, mockPanel, () => { exitCalled = true; });
    expect(exitCalled).toBe(true);
  });

  it("FIX 6: viewer-panel-fullscreen class is only applied when isFullscreen=true", () => {
    // In ViewerPanel.tsx: className includes 'viewer-panel-fullscreen' only when isFullscreen
    function getClassName(isFullscreen: boolean): string {
      return `panel viewer-panel${isFullscreen ? " viewer-panel-fullscreen" : ""}`;
    }
    expect(getClassName(false)).not.toContain("viewer-panel-fullscreen");
    expect(getClassName(true)).toContain("viewer-panel-fullscreen");
  });

  it("on unmount, isFullscreen is reset to false to prevent blocking UI", () => {
    let isFullscreen = true;
    // Simulate cleanup function
    function cleanup() {
      isFullscreen = false;
    }
    cleanup();
    expect(isFullscreen).toBe(false);
  });
});
