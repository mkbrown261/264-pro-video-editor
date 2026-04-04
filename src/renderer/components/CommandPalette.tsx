/**
 * Command Palette — Ctrl+P / Cmd+P
 * Fuzzy-matches all registered commands and shows recent commands.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

export interface Command {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  category?: string;
  icon?: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: Command[];
}

const RECENT_KEY = "264pro_recent_commands";
const MAX_RECENT = 10;

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)));
  } catch {}
}

/** Simple fuzzy match: every char in query must appear in order in text */
function fuzzyMatch(text: string, query: string): { score: number; indices: number[] } {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return { score: 1, indices: [] };
  const indices: number[] = [];
  let ti = 0;
  let score = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return { score: -1, indices: [] };
    // Bonus for consecutive and start matches
    if (indices.length > 0 && found === indices[indices.length - 1] + 1) score += 2;
    if (found === 0 || t[found - 1] === " ") score += 3;
    score += 1;
    indices.push(found);
    ti = found + 1;
  }
  return { score, indices };
}

/** Highlight matched chars in label */
function HighlightedLabel({ text, indices }: { text: string; indices: number[] }) {
  const idxSet = new Set(indices);
  return (
    <span>
      {text.split("").map((ch, i) =>
        idxSet.has(i)
          ? <mark key={i} className="cp-highlight">{ch}</mark>
          : <span key={i}>{ch}</span>
      )}
    </span>
  );
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, commands }) => {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Reset on open/close
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setActiveIdx(0);
      setRecent(loadRecent());
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [isOpen]);

  // Filtered + sorted results
  const results = React.useMemo(() => {
    if (!query.trim()) {
      // Show recent commands first, then all by category
      const recentCmds = recent
        .map(id => commands.find(c => c.id === id))
        .filter(Boolean) as Command[];
      const recentIds = new Set(recent);
      const rest = commands.filter(c => !recentIds.has(c.id));
      return [
        ...recentCmds.map(c => ({ cmd: c, score: 1000, indices: [] as number[], isRecent: true })),
        ...rest.map(c => ({ cmd: c, score: 0, indices: [] as number[], isRecent: false })),
      ];
    }
    return commands
      .map(cmd => {
        const labelMatch = fuzzyMatch(cmd.label, query);
        const descMatch = cmd.description ? fuzzyMatch(cmd.description, query) : { score: -1, indices: [] };
        const catMatch = cmd.category ? fuzzyMatch(cmd.category, query) : { score: -1, indices: [] };
        const score = Math.max(labelMatch.score, descMatch.score * 0.5, catMatch.score * 0.3);
        return { cmd, score, indices: labelMatch.indices, isRecent: false };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  }, [query, commands, recent]);

  const execute = useCallback((cmd: Command) => {
    // Track in recent
    const next = [cmd.id, ...recent.filter(id => id !== cmd.id)];
    setRecent(next);
    saveRecent(next);
    cmd.action();
    onClose();
  }, [recent, onClose]);

  // Keyboard navigation
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[activeIdx];
      if (r) execute(r.cmd);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }, [results, activeIdx, execute, onClose]);

  // Auto-scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (!isOpen) return null;

  // Group results by category when no query
  const showCategories = !query.trim();
  let lastCategory: string | undefined = undefined;

  return (
    <div className="cp-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cp-container" role="dialog" aria-modal aria-label="Command Palette">
        <div className="cp-header">
          <span className="cp-search-icon">⌕</span>
          <input
            ref={inputRef}
            className="cp-input"
            type="text"
            placeholder="Search commands…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={onKeyDown}
            aria-label="Search commands"
            autoComplete="off"
          />
          {query && (
            <button className="cp-clear" onClick={() => setQuery("")} type="button" aria-label="Clear">✕</button>
          )}
        </div>

        <div className="cp-list" ref={listRef} role="listbox">
          {results.length === 0 && (
            <div className="cp-empty">No commands found for "{query}"</div>
          )}
          {results.map((r, i) => {
            const showCat = showCategories && r.cmd.category !== lastCategory;
            if (showCategories) lastCategory = r.cmd.category;
            return (
              <React.Fragment key={r.cmd.id}>
                {showCat && r.cmd.category && (
                  <div className="cp-category-header">
                    {r.isRecent ? "⏱ Recent" : r.cmd.category}
                  </div>
                )}
                {r.isRecent && i === 0 && !r.cmd.category && (
                  <div className="cp-category-header">⏱ Recent</div>
                )}
                <div
                  className={`cp-item${i === activeIdx ? " cp-active" : ""}`}
                  data-idx={i}
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => { e.preventDefault(); execute(r.cmd); }}
                >
                  <span className="cp-item-icon">{r.cmd.icon ?? "▸"}</span>
                  <div className="cp-item-text">
                    <span className="cp-item-label">
                      {query ? <HighlightedLabel text={r.cmd.label} indices={r.indices} /> : r.cmd.label}
                    </span>
                    {r.cmd.description && (
                      <span className="cp-item-desc">{r.cmd.description}</span>
                    )}
                  </div>
                  {r.cmd.shortcut && (
                    <kbd className="cp-shortcut">{r.cmd.shortcut}</kbd>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        <div className="cp-footer">
          <span><kbd>↑↓</kbd> Navigate</span>
          <span><kbd>Enter</kbd> Execute</span>
          <span><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
};

/** Build the full command list from app callbacks */
export function buildCommandList(actions: {
  onTogglePlayback: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOpen: () => void;
  onNewProject: () => void;
  onExport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSplitClip: () => void;
  onDuplicateClip: () => void;
  onRemoveClip: () => void;
  onFitTimeline: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onAddMarker: () => void;
  onToggleMediaPool: () => void;
  onToggleInspector: () => void;
  onToggleFullscreen: () => void;
  onSeekToStart: () => void;
  onSeekToEnd: () => void;
  onSelectTool: () => void;
  onBladeTool: () => void;
  onColorPage: () => void;
  onEditPage: () => void;
  onFusionPage: () => void;
  onToggleStoryboard: () => void;
  onDetachAudio: () => void;
  onToggleClipEnabled: () => void;
}): Command[] {
  return [
    // Playback
    { id: "toggle-playback", label: "Toggle Playback", icon: "▶", shortcut: "Space", category: "Playback", action: actions.onTogglePlayback },
    { id: "seek-start", label: "Go to Start", icon: "⏮", shortcut: "Home", category: "Playback", action: actions.onSeekToStart },
    { id: "seek-end", label: "Go to End", icon: "⏭", shortcut: "End", category: "Playback", action: actions.onSeekToEnd },
    // File
    { id: "new-project", label: "New Project", icon: "📄", shortcut: "Ctrl+N", category: "File", action: actions.onNewProject },
    { id: "open-project", label: "Open Project…", icon: "📂", shortcut: "Ctrl+O", category: "File", action: actions.onOpen },
    { id: "save-project", label: "Save Project", icon: "💾", shortcut: "Ctrl+S", category: "File", action: actions.onSave },
    { id: "save-as", label: "Save Project As…", icon: "💾", shortcut: "Ctrl+Shift+S", category: "File", action: actions.onSaveAs },
    { id: "export", label: "Export…", icon: "📤", shortcut: "Ctrl+E", category: "File", action: actions.onExport },
    // Edit
    { id: "undo", label: "Undo", icon: "↩", shortcut: "Ctrl+Z", category: "Edit", action: actions.onUndo },
    { id: "redo", label: "Redo", icon: "↪", shortcut: "Ctrl+Shift+Z", category: "Edit", action: actions.onRedo },
    { id: "split-clip", label: "Split Clip at Playhead", icon: "✂", shortcut: "Ctrl+B", category: "Edit", action: actions.onSplitClip },
    { id: "duplicate-clip", label: "Duplicate Clip", icon: "⧉", shortcut: "Ctrl+D", category: "Edit", action: actions.onDuplicateClip },
    { id: "remove-clip", label: "Delete Clip", icon: "🗑", shortcut: "Del", category: "Edit", action: actions.onRemoveClip },
    { id: "detach-audio", label: "Detach Audio", icon: "🎵", shortcut: "Ctrl+Shift+D", category: "Edit", action: actions.onDetachAudio },
    { id: "toggle-clip-enabled", label: "Enable/Disable Clip", icon: "⊘", shortcut: "E", category: "Edit", action: actions.onToggleClipEnabled },
    // Tools
    { id: "select-tool", label: "Selection Tool", icon: "↖", shortcut: "V", category: "Tools", action: actions.onSelectTool },
    { id: "blade-tool", label: "Blade/Cut Tool", icon: "✂", shortcut: "B", category: "Tools", action: actions.onBladeTool },
    // Timeline
    { id: "fit-timeline", label: "Fit Timeline to Window", icon: "⊡", shortcut: "Shift+Z", category: "Timeline", action: actions.onFitTimeline },
    { id: "zoom-in", label: "Zoom In Timeline", icon: "+", shortcut: "]", category: "Timeline", action: actions.onZoomIn },
    { id: "zoom-out", label: "Zoom Out Timeline", icon: "−", shortcut: "[", category: "Timeline", action: actions.onZoomOut },
    { id: "add-marker", label: "Add Marker at Playhead", icon: "⚑", shortcut: "M", category: "Timeline", action: actions.onAddMarker },
    { id: "storyboard", label: "Toggle Storyboard View", icon: "▦", shortcut: "G", category: "Timeline", action: actions.onToggleStoryboard },
    // View
    { id: "toggle-media-pool", label: "Toggle Media Pool", icon: "⊞", shortcut: "F1", category: "View", action: actions.onToggleMediaPool },
    { id: "toggle-inspector", label: "Toggle Inspector", icon: "⊟", shortcut: "F2", category: "View", action: actions.onToggleInspector },
    { id: "toggle-fullscreen", label: "Toggle Fullscreen Viewer", icon: "⛶", shortcut: "F", category: "View", action: actions.onToggleFullscreen },
    // Pages
    { id: "page-edit", label: "Go to Edit Page", icon: "✂", category: "Pages", action: actions.onEditPage },
    { id: "page-color", label: "Go to Color Page", icon: "🎨", category: "Pages", action: actions.onColorPage },
    { id: "page-fusion", label: "Go to Fusion Page", icon: "⬡", category: "Pages", action: actions.onFusionPage },
  ];
}
