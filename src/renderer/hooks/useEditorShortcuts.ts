import { useEffect, useRef } from "react";

interface EditorShortcutOptions {
  sequenceFps: number;
  /** When true (any modal open) spacebar + arrow keys are suppressed */
  isModalOpen?: boolean;
  onTogglePlayback: () => void;
  onToggleFullscreen: () => void;
  onSelectTool: () => void;
  onToggleBladeTool: () => void;
  onSplitSelectedClip: () => void;
  onNudgePlayhead: (deltaFrames: number) => void;
  onSeekToStart: () => void;
  onSeekToEnd: () => void;
  onRemoveSelectedClip: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onSaveAs?: () => void;
  onOpen: () => void;
  onNewProject?: () => void;
  // Extended shortcuts
  onDuplicateSelectedClip?: () => void;
  onFitTimeline?: () => void;
  onExport?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onAddMarker?: () => void;
  /** J = rewind (shuttle -1 speed), L = forward (shuttle +1 speed), K = pause */
  onJKLShuttle?: (direction: -1 | 0 | 1) => void;
  // Panel toggles
  onToggleMediaPool?: () => void;
  onToggleInspector?: () => void;
  onToggleDualViewer?: () => void;
  // Layout presets
  onLayoutPreset?: (preset: "edit" | "color" | "audio") => void;
  // Mark in/out
  onMarkIn?: () => void;
  onMarkOut?: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tag === "input" ||
    tag === "textarea" ||
    tag === "select"
  );
}

export function useEditorShortcuts(options: EditorShortcutOptions) {
  // Store latest options in a ref so the stable event listener always calls the current callbacks
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;

      const {
        sequenceFps,
        isModalOpen,
        onTogglePlayback,
        onToggleFullscreen,
        onSelectTool,
        onToggleBladeTool,
        onSplitSelectedClip,
        onNudgePlayhead,
        onSeekToStart,
        onSeekToEnd,
        onRemoveSelectedClip,
        onUndo,
        onRedo,
        onSave,
        onSaveAs,
        onOpen,
        onNewProject,
        onDuplicateSelectedClip,
        onFitTimeline,
        onExport,
        onZoomIn,
        onZoomOut,
        onAddMarker,
        onJKLShuttle,
        onToggleMediaPool,
        onToggleInspector,
        onToggleDualViewer,
        onLayoutPreset,
        onMarkIn,
        onMarkOut,
      } = optionsRef.current;

      const key = event.key.toLowerCase();
      const isModifier = event.metaKey || event.ctrlKey;

      if (isModifier) {
        // Cmd/Ctrl+Z → undo
        if (key === "z" && !event.shiftKey) {
          event.preventDefault();
          onUndo();
          return;
        }
        // Cmd/Ctrl+Shift+Z → redo
        if (key === "z" && event.shiftKey) {
          event.preventDefault();
          onRedo();
          return;
        }
        // Cmd/Ctrl+Y → redo (Windows convention)
        if (key === "y") {
          event.preventDefault();
          onRedo();
          return;
        }
        // Cmd/Ctrl+S → save
        if (key === "s" && !event.shiftKey) {
          event.preventDefault();
          onSave();
          return;
        }
        // Cmd/Ctrl+Shift+S → save as
        if (key === "s" && event.shiftKey) {
          event.preventDefault();
          onSaveAs?.();
          return;
        }
        // Cmd/Ctrl+O → open
        if (key === "o") {
          event.preventDefault();
          onOpen();
          return;
        }
        // Cmd/Ctrl+N → new project
        if (key === "n") {
          event.preventDefault();
          onNewProject?.();
          return;
        }
        // Cmd/Ctrl+B → split
        if (key === "b") {
          event.preventDefault();
          onSplitSelectedClip();
          return;
        }
        // Cmd/Ctrl+D → duplicate selected clip
        if (key === "d") {
          event.preventDefault();
          onDuplicateSelectedClip?.();
          return;
        }
        // Cmd/Ctrl+E → export
        if (key === "e") {
          event.preventDefault();
          onExport?.();
          return;
        }
        // Cmd/Ctrl+, → project settings (handled via File menu in App)
        if (key === ",") {
          event.preventDefault();
          return;
        }
        // Ctrl+Shift+1/2/3 → layout presets
        if (event.shiftKey) {
          if (key === "1") { event.preventDefault(); onLayoutPreset?.("edit"); return; }
          if (key === "2") { event.preventDefault(); onLayoutPreset?.("color"); return; }
          if (key === "3") { event.preventDefault(); onLayoutPreset?.("audio"); return; }
        }
        // Cmd/Ctrl+Shift+Z handled above; Shift+Z (no modifier) → fit timeline
        return;
      }

      // Block playback + navigation keys when any modal is open
      if (isModalOpen && (key === " " || key === "arrowleft" || key === "arrowright" || key === "home" || key === "end")) {
        return;
      }

      switch (key) {
        case " ":
        case "k":
          event.preventDefault();
          if (key === "k" && onJKLShuttle) {
            onJKLShuttle(0); // K = pause
          } else {
            onTogglePlayback();
          }
          break;

        // JKL shuttle
        case "j":
          event.preventDefault();
          onJKLShuttle ? onJKLShuttle(-1) : onTogglePlayback();
          break;
        case "l":
          event.preventDefault();
          onJKLShuttle ? onJKLShuttle(1) : onTogglePlayback();
          break;

        case "a":
          event.preventDefault();
          onSelectTool();
          break;
        case "s":
          // S = split at playhead (CapCut parity — the single most-used NLE shortcut)
          event.preventDefault();
          onSplitSelectedClip();
          break;
        case "v":
          event.preventDefault();
          onSelectTool();
          break;
        case "b":
          event.preventDefault();
          onToggleBladeTool();
          break;
        case "f":
          event.preventDefault();
          onToggleFullscreen();
          break;
        case "f1":
          event.preventDefault();
          onToggleMediaPool?.();
          break;
        case "f2":
          event.preventDefault();
          onToggleInspector?.();
          break;
        case "`":
          event.preventDefault();
          onToggleDualViewer?.();
          break;
        case "i":
          event.preventDefault();
          onMarkIn?.();
          break;
        case "o":
          event.preventDefault();
          onMarkOut?.();
          break;

        // ] / [ zoom in / out
        case "]":
          event.preventDefault();
          onZoomIn?.();
          break;
        case "[":
          event.preventDefault();
          onZoomOut?.();
          break;

        // Shift+Z → fit timeline to window
        case "z":
          if (event.shiftKey) {
            event.preventDefault();
            onFitTimeline?.();
          }
          break;

        // M → add marker at playhead
        case "m":
          event.preventDefault();
          onAddMarker?.();
          break;

        case "arrowleft":
          event.preventDefault();
          onNudgePlayhead(event.shiftKey ? -sequenceFps : -1);
          break;
        case "arrowright":
          event.preventDefault();
          onNudgePlayhead(event.shiftKey ? sequenceFps : 1);
          break;
        case "home":
          event.preventDefault();
          onSeekToStart();
          break;
        case "end":
          event.preventDefault();
          onSeekToEnd();
          break;
        case "backspace":
        case "delete":
          event.preventDefault();
          onRemoveSelectedClip();
          break;
        case "escape":
          event.preventDefault();
          // FIX 6: ESC exits fullscreen if active — NEVER shows blank blue screen
          if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => {
              // exitFullscreen can throw if no fullscreen active — safe to ignore
            });
          } else {
            onSelectTool();
          }
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []); // stable — options accessed via ref
}
