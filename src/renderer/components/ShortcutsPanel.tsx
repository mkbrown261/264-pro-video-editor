import React, { useState, useEffect, useCallback } from "react";

export interface ShortcutDefinition {
  id: string;
  label: string;
  category: string;
  defaultKey: string;
  currentKey: string;
  description: string;
}

const STORAGE_KEY = "264pro_shortcuts";

const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  // Edit
  { id: "play_pause",       label: "Play / Pause",          category: "Playback",  defaultKey: "Space",         currentKey: "Space",         description: "Toggle playback" },
  { id: "stop",             label: "Stop",                  category: "Playback",  defaultKey: "K",             currentKey: "K",             description: "Stop playback" },
  { id: "rewind",           label: "Rewind (Slow)",         category: "Playback",  defaultKey: "J",             currentKey: "J",             description: "Play backwards" },
  { id: "fast_forward",     label: "Fast Forward",          category: "Playback",  defaultKey: "L",             currentKey: "L",             description: "Play forwards fast" },
  { id: "prev_frame",       label: "Previous Frame",        category: "Playback",  defaultKey: "ArrowLeft",     currentKey: "ArrowLeft",     description: "Step one frame back" },
  { id: "next_frame",       label: "Next Frame",            category: "Playback",  defaultKey: "ArrowRight",    currentKey: "ArrowRight",    description: "Step one frame forward" },
  { id: "go_start",         label: "Go to Start",           category: "Playback",  defaultKey: "Home",          currentKey: "Home",          description: "Jump to start of timeline" },
  { id: "go_end",           label: "Go to End",             category: "Playback",  defaultKey: "End",           currentKey: "End",           description: "Jump to end of timeline" },
  // Edit
  { id: "split",            label: "Split at Playhead",     category: "Edit",      defaultKey: "S",             currentKey: "S",             description: "Cut clip at playhead position" },
  { id: "delete_clip",      label: "Delete Clip",           category: "Edit",      defaultKey: "Backspace",     currentKey: "Backspace",     description: "Delete selected clip (leaves gap)" },
  { id: "ripple_delete",    label: "Ripple Delete",         category: "Edit",      defaultKey: "Shift+Backspace", currentKey: "Shift+Backspace", description: "Delete clip and close gap" },
  { id: "set_in",           label: "Set In Point",          category: "Edit",      defaultKey: "I",             currentKey: "I",             description: "Mark in point for selection" },
  { id: "set_out",          label: "Set Out Point",         category: "Edit",      defaultKey: "O",             currentKey: "O",             description: "Mark out point for selection" },
  { id: "add_marker",       label: "Add Marker",            category: "Edit",      defaultKey: "M",             currentKey: "M",             description: "Add a marker at playhead" },
  { id: "undo",             label: "Undo",                  category: "Edit",      defaultKey: "Ctrl+Z",        currentKey: "Ctrl+Z",        description: "Undo last action" },
  { id: "redo",             label: "Redo",                  category: "Edit",      defaultKey: "Ctrl+Shift+Z",  currentKey: "Ctrl+Shift+Z",  description: "Redo last undone action" },
  { id: "select_all",       label: "Select All",            category: "Edit",      defaultKey: "Ctrl+A",        currentKey: "Ctrl+A",        description: "Select all clips" },
  // Tools
  { id: "select_tool",      label: "Select Tool",           category: "Tools",     defaultKey: "A",             currentKey: "A",             description: "Switch to selection tool" },
  { id: "blade_tool",       label: "Blade Tool",            category: "Tools",     defaultKey: "B",             currentKey: "B",             description: "Switch to blade/cut tool" },
  // Color
  { id: "toggle_grade",     label: "Toggle Color Grade",    category: "Color",     defaultKey: "D",             currentKey: "D",             description: "Enable/disable color grade on clip" },
  // UI
  { id: "command_palette",  label: "Command Palette",       category: "UI",        defaultKey: "Ctrl+K",        currentKey: "Ctrl+K",        description: "Open command palette" },
  { id: "clawbot",          label: "Clawbot AI",            category: "UI",        defaultKey: "Ctrl+Shift+A",  currentKey: "Ctrl+Shift+A",  description: "Open Clawbot AI assistant" },
  { id: "fullscreen",       label: "Fullscreen Viewer",     category: "UI",        defaultKey: "F",             currentKey: "F",             description: "Toggle fullscreen preview" },
];

function loadCustomShortcuts(): Record<string, string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveCustomShortcuts(overrides: Record<string, string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch { /* noop */ }
}

function applyStoredShortcuts(defs: ShortcutDefinition[]): ShortcutDefinition[] {
  const overrides = loadCustomShortcuts();
  return defs.map(d => ({ ...d, currentKey: overrides[d.id] ?? d.defaultKey }));
}

interface ShortcutsPanelProps {
  onClose: () => void;
}

const CATEGORIES = ['Playback', 'Edit', 'Tools', 'Color', 'UI'];

export function ShortcutsPanel({ onClose }: ShortcutsPanelProps) {
  const [shortcuts, setShortcuts] = useState<ShortcutDefinition[]>(() => applyStoredShortcuts(DEFAULT_SHORTCUTS));
  const [search, setSearch] = useState('');
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [captureValue, setCaptureValue] = useState('');

  // Listen for key when capturing
  useEffect(() => {
    if (!capturingId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturingId(null);
        setCaptureValue('');
        return;
      }
      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
      if (e.shiftKey) parts.push('Shift');
      if (e.altKey) parts.push('Alt');
      const key = e.key;
      if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
        parts.push(key === ' ' ? 'Space' : key);
        const combo = parts.join('+');
        setCaptureValue(combo);
        applyShortcut(capturingId, combo);
        setCapturingId(null);
        setCaptureValue('');
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturingId]);

  const applyShortcut = useCallback((id: string, key: string) => {
    setShortcuts(prev => {
      const next = prev.map(s => s.id === id ? { ...s, currentKey: key } : s);
      // Persist overrides
      const overrides: Record<string, string> = {};
      next.forEach(s => { if (s.currentKey !== s.defaultKey) overrides[s.id] = s.currentKey; });
      saveCustomShortcuts(overrides);
      return next;
    });
  }, []);

  const resetShortcut = useCallback((id: string) => {
    setShortcuts(prev => {
      const def = DEFAULT_SHORTCUTS.find(d => d.id === id);
      if (!def) return prev;
      const next = prev.map(s => s.id === id ? { ...s, currentKey: s.defaultKey } : s);
      const overrides: Record<string, string> = {};
      next.forEach(s => { if (s.currentKey !== s.defaultKey) overrides[s.id] = s.currentKey; });
      saveCustomShortcuts(overrides);
      return next;
    });
  }, []);

  const resetAll = () => {
    setShortcuts(DEFAULT_SHORTCUTS.map(d => ({ ...d })));
    saveCustomShortcuts({});
  };

  const filtered = shortcuts.filter(s =>
    !search || s.label.toLowerCase().includes(search.toLowerCase()) ||
    s.category.toLowerCase().includes(search.toLowerCase()) ||
    s.currentKey.toLowerCase().includes(search.toLowerCase())
  );

  const renderKbdTag = (key: string) => {
    const parts = key.split('+');
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        {parts.map((p, i) => (
          <span key={i}>
            <kbd style={{
              padding: '1px 5px', borderRadius: 4,
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              fontFamily: 'monospace', fontSize: 11, color: '#e2e8f0',
            }}>{p}</kbd>
            {i < parts.length - 1 && <span style={{ color: '#475569', fontSize: 9, margin: '0 1px' }}>+</span>}
          </span>
        ))}
      </span>
    );
  };

  return (
    <div style={{
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      width: '600px', maxWidth: '92vw',
      background: '#0d1117', border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 12, boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
      zIndex: 1100, display: 'flex', flexDirection: 'column',
      maxHeight: '80vh', overflow: 'hidden', color: '#e2e8f0', fontSize: 13,
    }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 800 }}>⌨️ Keyboard Shortcuts</span>
        <button
          onClick={resetAll}
          style={{ marginLeft: 'auto', padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}
        >Reset All</button>
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16, padding: '2px 6px', borderRadius: 4 }}
          title="Close"
        >✕</button>
      </div>

      {/* Search */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        <input
          type="text"
          placeholder="Filter shortcuts…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', padding: '6px 10px', background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
            color: '#e2e8f0', fontSize: 12, outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Shortcut list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {capturingId && (
          <div style={{
            margin: '8px 16px', padding: '10px 14px', background: 'rgba(124,58,237,0.15)',
            border: '1px solid rgba(124,58,237,0.4)', borderRadius: 8, fontSize: 12, color: '#c4b5fd',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>⌨️</span>
            <span style={{ flex: 1 }}>Press new key combination… <span style={{ color: '#7c3aed' }}>(Esc to cancel)</span></span>
            {captureValue && <span style={{ fontWeight: 700 }}>{captureValue}</span>}
          </div>
        )}

        {CATEGORIES.filter(cat => filtered.some(s => s.category === cat)).map(cat => (
          <div key={cat}>
            <div style={{
              padding: '6px 16px 3px', fontSize: 10, fontWeight: 700,
              color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>{cat}</div>
            {filtered.filter(s => s.category === cat).map(shortcut => {
              const isModified = shortcut.currentKey !== shortcut.defaultKey;
              const isCapturing = capturingId === shortcut.id;
              return (
                <div
                  key={shortcut.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '7px 16px',
                    background: isCapturing ? 'rgba(124,58,237,0.1)' : 'transparent',
                    borderLeft: isCapturing ? '2px solid #7c3aed' : '2px solid transparent',
                  }}
                >
                  {/* Label + description */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>
                      {shortcut.label}
                      {isModified && (
                        <span style={{ marginLeft: 6, fontSize: 9, color: '#7c3aed', fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: 'rgba(124,58,237,0.15)' }}>
                          CUSTOM
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>{shortcut.description}</div>
                  </div>

                  {/* Key display */}
                  <div style={{ minWidth: 90, textAlign: 'right' }}>
                    {isCapturing ? (
                      <span style={{ fontSize: 11, color: '#7c3aed', fontStyle: 'italic' }}>recording…</span>
                    ) : (
                      renderKbdTag(shortcut.currentKey)
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={() => {
                        if (isCapturing) {
                          setCapturingId(null);
                        } else {
                          setCapturingId(shortcut.id);
                        }
                      }}
                      style={{
                        padding: '3px 8px', borderRadius: 4, border: 'none',
                        background: isCapturing ? '#7c3aed' : 'rgba(255,255,255,0.07)',
                        color: isCapturing ? '#fff' : '#94a3b8',
                        fontSize: 10, cursor: 'pointer', fontWeight: 600,
                      }}
                    >{isCapturing ? 'Cancel' : 'Change'}</button>
                    {isModified && (
                      <button
                        onClick={() => resetShortcut(shortcut.id)}
                        style={{
                          padding: '3px 6px', borderRadius: 4, border: 'none',
                          background: 'rgba(239,68,68,0.12)', color: '#fca5a5',
                          fontSize: 10, cursor: 'pointer', fontWeight: 600,
                        }}
                        title={`Reset to ${shortcut.defaultKey}`}
                      >✕</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: '#374151', padding: '32px 16px', fontSize: 12 }}>
            No shortcuts match "{search}"
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.07)', fontSize: 10, color: '#374151', flexShrink: 0 }}>
        Custom shortcuts are saved in browser storage and applied on next session.
      </div>
    </div>
  );
}
