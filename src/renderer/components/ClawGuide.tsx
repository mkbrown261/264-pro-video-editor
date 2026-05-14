/**
 * ClawGuide — non-overbearing AI assistance system
 * Watches for friction signals and surfaces one-sentence help at the right moment.
 * Opt-in only. Shows as a subtle pulsing indicator; one click to act, one click to dismiss.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';

export interface ClawTip {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  severity?: 'info' | 'suggestion' | 'warning';
}

interface ClawGuideProps {
  enabled: boolean;
  tips: ClawTip[];
  onDismiss: (id: string) => void;
}

export function ClawGuide({ enabled, tips, onDismiss }: ClawGuideProps) {
  const [open, setOpen] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);

  useEffect(() => {
    if (tips.length > 0) setCurrentIdx(0);
  }, [tips.length]);

  if (!enabled || tips.length === 0) return null;

  const tip = tips[currentIdx] ?? tips[0];
  const color = tip.severity === 'warning' ? '#f97316' : tip.severity === 'suggestion' ? '#3b8af7' : '#a855f7';

  return (
    <div style={{ position: 'fixed', bottom: 80, right: 20, zIndex: 9999, userSelect: 'none' }}>
      {open ? (
        <div style={{
          background: '#1a1d26', border: `1px solid ${color}40`, borderRadius: 10,
          padding: '10px 14px', maxWidth: 280, boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>🦡</span>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: '#e0e0e0' }}>{tip.message}</p>
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            {tips.length > 1 && (
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', alignSelf: 'center', marginRight: 'auto' }}>
                {currentIdx + 1}/{tips.length}
              </span>
            )}
            {tips.length > 1 && (
              <button type="button" onClick={() => setCurrentIdx(i => (i + 1) % tips.length)}
                style={{ fontSize: 10, padding: '2px 8px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}>
                Next →
              </button>
            )}
            {tip.onAction && (
              <button type="button" onClick={() => { tip.onAction?.(); setOpen(false); onDismiss(tip.id); }}
                style={{ fontSize: 11, padding: '3px 10px', background: color, border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                {tip.actionLabel ?? 'Fix it'}
              </button>
            )}
            <button type="button" onClick={() => { setOpen(false); onDismiss(tip.id); }}
              style={{ fontSize: 10, padding: '2px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}>
              Dismiss
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Claw has a suggestion"
          style={{
            width: 38, height: 38, borderRadius: '50%',
            background: `${color}22`, border: `2px solid ${color}`,
            cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'clawPulse 2s ease-in-out infinite',
            boxShadow: `0 0 12px ${color}44`,
          }}
        >
          🦡
          {tips.length > 1 && (
            <span style={{ position: 'absolute', top: -4, right: -4, background: color, color: '#fff', borderRadius: '50%', width: 16, height: 16, fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
              {tips.length}
            </span>
          )}
        </button>
      )}
    </div>
  );
}

/** Hook that watches editor state and generates contextual tips */
export function useClawGuide(opts: {
  enabled: boolean;
  clips: Array<{ id: string; speed?: number; volume?: number; colorGrade?: unknown }>;
  mediaPoolAssets: Array<{ id: string }>;
  timelineClipIds: Set<string>;
  playheadStallMs: number; // how long playhead has been stationary
  onInterpolateClip?: (clipId: string) => void;
  onOpenColorGrading?: () => void;
  onOpenCaptions?: () => void;
  onOpenMixer?: () => void;
}) {
  const [tips, setTips] = useState<ClawTip[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const dismiss = useCallback((id: string) => {
    setDismissed(prev => new Set([...prev, id]));
    setTips(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    if (!opts.enabled) return;
    const newTips: ClawTip[] = [];

    // Slow clip → suggest frame interpolation
    const slowClips = opts.clips.filter(c => (c.speed ?? 1) < 0.5 && (c.speed ?? 1) > 0);
    if (slowClips.length > 0 && !dismissed.has('slow-mo')) {
      newTips.push({
        id: 'slow-mo',
        severity: 'suggestion',
        message: `This clip is slowed to ${Math.round((slowClips[0].speed ?? 1) * 100)}% — it may look choppy. Want me to generate smooth in-between frames?`,
        actionLabel: 'Smooth it',
        onAction: () => opts.onInterpolateClip?.(slowClips[0].id),
      });
    }

    // No color grade on any clip → suggest opening color panel
    const ungradedVideo = opts.clips.filter(c => !c.colorGrade);
    if (ungradedVideo.length === opts.clips.length && opts.clips.length >= 3 && !dismissed.has('no-grade')) {
      newTips.push({
        id: 'no-grade',
        severity: 'info',
        message: `None of your clips have a color grade. Even a quick exposure + contrast pass makes a huge difference.`,
        actionLabel: 'Open Color',
        onAction: opts.onOpenColorGrading,
      });
    }

    // Assets in pool but nothing on timeline → blank timeline panic
    const unusedCount = opts.mediaPoolAssets.filter(a => !opts.timelineClipIds.has(a.id)).length;
    if (unusedCount > 5 && opts.timelineClipIds.size === 0 && !dismissed.has('blank-timeline')) {
      newTips.push({
        id: 'blank-timeline',
        severity: 'suggestion',
        message: `You have ${unusedCount} clips in your media pool but nothing on the timeline yet. Drag clips down to start your edit.`,
      });
    }

    // Clipping audio
    const clippingClips = opts.clips.filter(c => (c.volume ?? 1) > 1.8);
    if (clippingClips.length > 0 && !dismissed.has('clipping')) {
      newTips.push({
        id: 'clipping',
        severity: 'warning',
        message: `${clippingClips.length} clip(s) have volume above 180% — audio may distort on export.`,
        actionLabel: 'Open Mixer',
        onAction: opts.onOpenMixer,
      });
    }

    setTips(prev => {
      // Only add truly new tips (don't re-add dismissed ones)
      const newIds = new Set(newTips.map(t => t.id));
      const kept = prev.filter(t => newIds.has(t.id));
      const added = newTips.filter(t => !prev.find(p => p.id === t.id));
      return [...kept, ...added];
    });
  }, [opts.enabled, opts.clips, opts.mediaPoolAssets, opts.timelineClipIds.size, dismissed]);

  return { tips, dismiss };
}
