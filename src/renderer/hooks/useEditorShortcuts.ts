import { useEffect, useEffectEvent } from "react";

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
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}

export function useEditorShortcuts({
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
}: EditorShortcutOptions) {
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) {
      return;
    }

    const key = event.key.toLowerCase();
    const isModifierPressed = event.metaKey || event.ctrlKey;

    if (isModifierPressed && key === "b") {
      event.preventDefault();
      onSplitSelectedClip();
      return;
    }

    switch (key) {
      case " ":
      case "k":
        event.preventDefault();
        onTogglePlayback();
        return;
      case "a":
        event.preventDefault();
        onSelectTool();
        return;
      case "b":
        event.preventDefault();
        onToggleBladeTool();
        return;
      case "f":
        event.preventDefault();
        onToggleFullscreen();
        return;
      case "arrowleft":
        event.preventDefault();
        onNudgePlayhead(event.shiftKey ? -sequenceFps : -1);
        return;
      case "arrowright":
        event.preventDefault();
        onNudgePlayhead(event.shiftKey ? sequenceFps : 1);
        return;
      case "home":
        event.preventDefault();
        onSeekToStart();
        return;
      case "end":
        event.preventDefault();
        onSeekToEnd();
        return;
      case "backspace":
      case "delete":
        event.preventDefault();
        onRemoveSelectedClip();
        return;
      case "escape":
        event.preventDefault();
        onSelectTool();
        return;
      default:
        return;
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);
}
