import React, { useState, useEffect, useCallback } from 'react';
import { EditorProject, TimelineClip, MediaAsset } from '../../shared/models';

interface PrecisionTrimPanelProps {
  project: EditorProject;
  fps: number;
  selectedClipId: string | null;
  onRippleTrim: (clipId: string, side: 'start' | 'end', deltaFrames: number) => void;
  onRollTrim: (clipId: string, deltaFrames: number) => void;
  onSlip: (clipId: string, deltaFrames: number) => void;
  onSlide: (clipId: string, deltaFrames: number) => void;
  onClose: () => void;
}

type TrimMode = 'ripple_start' | 'ripple_end' | 'roll' | 'slip' | 'slide';

function framesToTC(frames: number, fps: number): string {
  const f = Math.max(0, Math.round(frames));
  const ff = f % Math.round(fps);
  const totalSec = Math.floor(f / Math.round(fps));
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}:${String(ff).padStart(2,'0')}`;
}

function getClipDurationFrames(clip: TimelineClip, fps: number, assets: MediaAsset[]): number {
  const asset = assets.find((a: MediaAsset) => a.id === clip.assetId);
  if (!asset) return 0;
  return Math.round(asset.durationSeconds * fps) - (clip.trimStartFrames ?? 0) - (clip.trimEndFrames ?? 0);
}

export const PrecisionTrimPanel: React.FC<PrecisionTrimPanelProps> = ({
  project, fps, selectedClipId,
  onRippleTrim, onRollTrim, onSlip, onSlide, onClose
}) => {
  const [mode, setMode] = useState<TrimMode>('ripple_end');

  const applyDelta = useCallback((delta: number) => {
    if (!selectedClipId) return;
    switch (mode) {
      case 'ripple_start': onRippleTrim(selectedClipId, 'start', delta); break;
      case 'ripple_end':   onRippleTrim(selectedClipId, 'end', delta); break;
      case 'roll':         onRollTrim(selectedClipId, delta); break;
      case 'slip':         onSlip(selectedClipId, delta); break;
      case 'slide':        onSlide(selectedClipId, delta); break;
    }
  }, [selectedClipId, mode, onRippleTrim, onRollTrim, onSlip, onSlide]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); setMode('ripple_end'); }
      if (e.key === 'w' || e.key === 'W') { e.preventDefault(); setMode('roll'); }
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); setMode('slip'); }
      if (e.key === 'd' || e.key === 'D') { e.preventDefault(); setMode('slide'); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); applyDelta(e.shiftKey ? -10 : -1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); applyDelta(e.shiftKey ? 10 : 1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [applyDelta]);

  const clip = project.sequence.clips.find((c: TimelineClip) => c.id === selectedClipId);
  const asset = clip ? project.assets.find((a: MediaAsset) => a.id === clip.assetId) : null;
  const durFrames = clip ? getClipDurationFrames(clip, fps, project.assets) : 0;
  const outTC = clip ? framesToTC(clip.startFrame, fps) : '--:--:--:--';
  const inTC  = clip ? framesToTC(clip.startFrame + durFrames, fps) : '--:--:--:--';
  const clipName = asset?.name ?? 'No clip selected';

  const MODES: { key: TrimMode; label: string; shortcut: string }[] = [
    { key: 'ripple_start', label: 'Ripple In',  shortcut: '' },
    { key: 'ripple_end',   label: 'Ripple Out', shortcut: 'R' },
    { key: 'roll',         label: 'Roll',       shortcut: 'W' },
    { key: 'slip',         label: 'Slip',       shortcut: 'S' },
    { key: 'slide',        label: 'Slide',      shortcut: 'D' },
  ];

  const btnBase: React.CSSProperties = {
    padding: '4px 10px', borderRadius: 5, border: '1px solid #334155',
    background: '#1e293b', color: '#94a3b8', cursor: 'pointer', fontSize: 11, fontWeight: 600,
  };
  const btnActive: React.CSSProperties = {
    ...btnBase, background: '#4c1d95', border: '1px solid #7c3aed', color: '#c4b5fd',
  };
  const frameBox: React.CSSProperties = {
    flex: 1, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    minHeight: 120, gap: 4,
  };

  return (
    <div style={{
      width: '100%', background: '#111827', borderTop: '2px solid #4c1d95',
      borderBottom: '1px solid #1e293b', padding: '10px 16px', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#c4b5fd' }}>✂ Precision Trim</span>
        <div style={{ display: 'flex', gap: 6, flex: 1 }}>
          {MODES.map(m => (
            <button key={m.key} style={mode === m.key ? btnActive : btnBase}
              onClick={() => setMode(m.key)} type="button">
              {m.label}{m.shortcut ? ` [${m.shortcut}]` : ''}
            </button>
          ))}
        </div>
        <button onClick={onClose} style={{ ...btnBase, padding: '4px 8px' }} type="button">✕</button>
      </div>
      {/* Body */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
        {/* Outgoing frame */}
        <div style={frameBox}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>OUTGOING</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{outTC}</div>
          <div style={{ fontSize: 10, color: '#475569' }}>{clipName}</div>
        </div>
        {/* Edit point indicator */}
        <div style={{
          width: 3, background: '#7c3aed', borderRadius: 2, alignSelf: 'stretch', flexShrink: 0,
        }} />
        {/* Incoming frame */}
        <div style={frameBox}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>INCOMING</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{inTC}</div>
          <div style={{ fontSize: 10, color: '#475569' }}>{clipName}</div>
        </div>
        {/* Controls */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center',
          padding: '0 16px', borderLeft: '1px solid #1e293b', minWidth: 160,
        }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textAlign: 'center' }}>
            {MODES.find(m => m.key === mode)?.label.toUpperCase()} MODE
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
            {([-10, -1, 1, 10] as const).map(d => (
              <button key={d} onClick={() => applyDelta(d)} type="button" style={{
                ...btnBase, padding: '6px 10px', fontSize: 12,
                color: d < 0 ? '#f87171' : '#4ade80',
                borderColor: d < 0 ? '#7f1d1d' : '#14532d',
              }}>
                {d > 0 ? `+${d}` : d}f
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: '#475569', textAlign: 'center' }}>
            ←/→ arrow keys · Shift ±10f
          </div>
        </div>
      </div>
    </div>
  );
};
