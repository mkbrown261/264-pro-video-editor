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
  onOpen: () => void;
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
        onOpen
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
        // Cmd/Ctrl+O → open
        if (key === "o") {
          event.preventDefault();
          onOpen();
          return;
        }
        // Cmd/Ctrl+B → split
        if (key === "b") {
          event.preventDefault();
          onSplitSelectedClip();
          return;
        }
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
          onTogglePlayback();
          break;
        case "a":
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
          onSelectTool();
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []); // stable — options accessed via ref
}
