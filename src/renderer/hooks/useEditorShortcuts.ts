import { useEffect, useRef } from "react";

interface EditorShortcutOptions {
  sequenceFps: number;
  onTogglePlayback: () => void;
  onToggleFullscreen: () => void;
  onSelectTool: () => void;
  onToggleBladeTool: () => void;
  onSplitSelectedClip: () => void;
  onNudgePlayhead: (deltaFrames: number) => void;
  onSeekToStart: () => void;
  onSeekToEnd: () => void;
  onRemoveSelectedClip: () => void;
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
        onTogglePlayback,
        onToggleFullscreen,
        onSelectTool,
        onToggleBladeTool,
        onSplitSelectedClip,
        onNudgePlayhead,
        onSeekToStart,
        onSeekToEnd,
        onRemoveSelectedClip
      } = optionsRef.current;

      const key = event.key.toLowerCase();
      const isModifier = event.metaKey || event.ctrlKey;

      // Cmd/Ctrl+B → split
      if (isModifier && key === "b") {
        event.preventDefault();
        onSplitSelectedClip();
        return;
      }

      // Ignore other modifier combos
      if (isModifier) return;

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
