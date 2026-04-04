import { useEffect, useRef } from "react";

export interface EditorShortcutOptions {
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
  /** Shift+J/L = slow shuttle (0.5× speed) */
  onSlowShuttle?: (direction: -1 | 1) => void;
  // Panel toggles
  onToggleMediaPool?: () => void;
  onToggleInspector?: () => void;
  onToggleDualViewer?: () => void;
  // Layout presets
  onLayoutPreset?: (preset: "edit" | "color" | "audio") => void;
  // Mark in/out
  onMarkIn?: () => void;
  onMarkOut?: () => void;
  // Navigation
  onJumpToClipBoundary?: (direction: -1 | 1) => void;
  onJumpToNextMarker?: (direction: -1 | 1) => void;
  // Editing
  onRippleDelete?: () => void;
  onDetachAudio?: () => void;
  onToggleClipEnabled?: () => void;
  // Clip operations
  onSetClipSpeed?: (factor: number) => void;
  // Command palette
  onOpenCommandPalette?: () => void;
  // Storyboard
  onToggleStoryboard?: () => void;
  // Viewer maximize
  onToggleViewerMaximize?: () => void;
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
        onSlowShuttle,
        onToggleMediaPool,
        onToggleInspector,
        onToggleDualViewer,
        onLayoutPreset,
        onMarkIn,
        onMarkOut,
        onJumpToClipBoundary,
        onJumpToNextMarker,
        onRippleDelete,
        onDetachAudio,
        onToggleClipEnabled,
        onOpenCommandPalette,
        onToggleStoryboard,
        onToggleViewerMaximize,
      } = optionsRef.current;

      const key = event.key.toLowerCase();
      const isModifier = event.metaKey || event.ctrlKey;

      if (isModifier) {
        // ── Command Palette ──────────────────────────────────────────────────
        if (key === "p" && !event.shiftKey) {
          event.preventDefault();
          onOpenCommandPalette?.();
          return;
        }

        // ── File Operations ──────────────────────────────────────────────────
        if (key === "z" && !event.shiftKey) {
          event.preventDefault();
          onUndo();
          return;
        }
        if (key === "z" && event.shiftKey) {
          event.preventDefault();
          onRedo();
          return;
        }
        if (key === "y") {
          event.preventDefault();
          onRedo();
          return;
        }
        if (key === "s" && !event.shiftKey) {
          event.preventDefault();
          onSave();
          return;
        }
        if (key === "s" && event.shiftKey) {
          event.preventDefault();
          onSaveAs?.();
          return;
        }
        if (key === "o") {
          event.preventDefault();
          onOpen();
          return;
        }
        if (key === "n") {
          event.preventDefault();
          onNewProject?.();
          return;
        }
        // Cmd/Ctrl+B → split at playhead
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

        // ── Navigation ───────────────────────────────────────────────────────
        // Ctrl+← / Ctrl+→ → jump to clip boundary
        if (key === "arrowleft" && !event.shiftKey) {
          event.preventDefault();
          onJumpToClipBoundary?.(-1);
          return;
        }
        if (key === "arrowright" && !event.shiftKey) {
          event.preventDefault();
          onJumpToClipBoundary?.(1);
          return;
        }
        // Ctrl+Shift+← / → → jump to next/prev marker
        if (key === "arrowleft" && event.shiftKey) {
          event.preventDefault();
          onJumpToNextMarker?.(-1);
          return;
        }
        if (key === "arrowright" && event.shiftKey) {
          event.preventDefault();
          onJumpToNextMarker?.(1);
          return;
        }

        // ── Editing ──────────────────────────────────────────────────────────
        // Ctrl+Shift+D → detach audio
        if (key === "d" && event.shiftKey) {
          event.preventDefault();
          onDetachAudio?.();
          return;
        }
        // Ctrl+, → project settings
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
        return;
      }

      // Block playback + navigation keys when any modal is open
      if (isModalOpen && (key === " " || key === "arrowleft" || key === "arrowright" || key === "home" || key === "end")) {
        return;
      }

      switch (key) {
        // ── Playback ─────────────────────────────────────────────────────────
        case " ":
          event.preventDefault();
          onTogglePlayback();
          break;

        case "k":
          event.preventDefault();
          if (onJKLShuttle) {
            onJKLShuttle(0); // K = pause
          } else {
            onTogglePlayback();
          }
          break;

        // JKL shuttle
        case "j":
          event.preventDefault();
          if (event.shiftKey && onSlowShuttle) {
            onSlowShuttle(-1); // Shift+J = slow rewind
          } else {
            onJKLShuttle ? onJKLShuttle(-1) : onTogglePlayback();
          }
          break;
        case "l":
          event.preventDefault();
          if (event.shiftKey && onSlowShuttle) {
            onSlowShuttle(1); // Shift+L = slow forward
          } else {
            onJKLShuttle ? onJKLShuttle(1) : onTogglePlayback();
          }
          break;

        // ── Tools ────────────────────────────────────────────────────────────
        case "a":
          event.preventDefault();
          onSelectTool();
          break;
        case "s":
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

        // ── View ─────────────────────────────────────────────────────────────
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

        // Mark in/out
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

        // M → add marker at playhead / Shift+M → jump to next marker
        case "m":
          event.preventDefault();
          if (event.shiftKey) {
            onJumpToNextMarker?.(1);
          } else {
            onAddMarker?.();
          }
          break;

        // ── Navigation ────────────────────────────────────────────────────────
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

        // ── Editing ──────────────────────────────────────────────────────────
        case "backspace":
        case "delete":
          event.preventDefault();
          if (event.shiftKey) {
            onRippleDelete?.();
          } else {
            onRemoveSelectedClip();
          }
          break;

        // E → enable/disable clip
        case "e":
          event.preventDefault();
          onToggleClipEnabled?.();
          break;

        // G → toggle storyboard
        case "g":
          event.preventDefault();
          onToggleStoryboard?.();
          break;

        // \ (backslash) → maximize/restore viewer (hide panels, shrink timeline)
        case "\\":
          event.preventDefault();
          onToggleViewerMaximize?.();
          break;

        // Escape → exit fullscreen or switch to select tool
        case "escape":
          event.preventDefault();
          if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => {});
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
