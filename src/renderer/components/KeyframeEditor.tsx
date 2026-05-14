/**
 * KeyframeEditor — per-clip keyframe animation for opacity, volume, posX/posY,
 * scaleX/scaleY, rotation, and speed ramp.
 *
 * Renders as a collapsible panel in InspectorPanel when a clip is selected.
 * Each property shows a mini timeline with draggable keyframe diamonds.
 */
import React, { useCallback, useRef, useState } from 'react';
import type { TimelineClip, Keyframe, KeyframeTrack, EasingType } from '../../shared/models';

type KFProp = keyof NonNullable<TimelineClip['keyframes']>;
const KF_PROPS: Array<{ id: KFProp; label: string; min: number; max: number; step: number; unit: string }> = [
  { id: 'opacity',   label: 'Opacity',   min: 0,    max: 1,    step: 0.01, unit: '' },
  { id: 'volume',    label: 'Volume',    min: 0,    max: 2,    step: 0.01, unit: '' },
  { id: 'posX',      label: 'Pos X',     min: -1,   max: 1,    step: 0.01, unit: '' },
  { id: 'posY',      label: 'Pos Y',     min: -1,   max: 1,    step: 0.01, unit: '' },
  { id: 'scaleX',    label: 'Scale X',   min: 0.01, max: 4,    step: 0.01, unit: 'x' },
  { id: 'scaleY',    label: 'Scale Y',   min: 0.01, max: 4,    step: 0.01, unit: 'x' },
  { id: 'rotation',  label: 'Rotation',  min: -180, max: 180,  step: 1,    unit: '°' },
];
const EASINGS: EasingType[] = ['linear', 'easeIn', 'easeOut', 'easeInOut'];

interface Props {
  clip: TimelineClip;
  totalFrames: number;
  /** The clip's in-point on the timeline (startFrame) */
  clipStartFrame: number;
  /** Clip duration in frames */
  clipDurationFrames: number;
  playheadFrame: number;
  fps: number;
  onUpdateKeyframes: (kf: TimelineClip['keyframes']) => void;
  onUpdateSpeedRamp: (ramp: Array<{ frame: number; speed: number }>) => void;
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function evalKFTrack(track: KeyframeTrack<number> | undefined, frame: number, defaultVal: number): number {
  if (!track || track.keyframes.length === 0) return defaultVal;
  const kfs = [...track.keyframes].sort((a, b) => a.frame - b.frame);
  if (frame <= kfs[0].frame) return kfs[0].value;
  if (frame >= kfs[kfs.length - 1].frame) return kfs[kfs.length - 1].value;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i], b = kfs[i + 1];
    if (frame >= a.frame && frame <= b.frame) {
      const t = (frame - a.frame) / (b.frame - a.frame);
      // Easing
      const ease = a.easing ?? 'linear';
      const te = ease === 'easeIn' ? t * t
        : ease === 'easeOut' ? 1 - (1 - t) * (1 - t)
        : ease === 'easeInOut' ? t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
        : t;
      return lerp(a.value, b.value, te);
    }
  }
  return defaultVal;
}

interface KFTrackRowProps {
  propId: KFProp;
  label: string;
  min: number; max: number; step: number; unit: string;
  track: KeyframeTrack<number> | undefined;
  clipDurationFrames: number;
  playheadLocalFrame: number; // playhead relative to clip start
  defaultVal: number;
  onSet: (frame: number, value: number, easing: EasingType) => void;
  onDelete: (frame: number) => void;
}

function KFTrackRow({ propId, label, min, max, step, unit, track, clipDurationFrames, playheadLocalFrame, defaultVal, onSet, onDelete }: KFTrackRowProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);

  const kfs = track?.keyframes ?? [];
  const currentVal = evalKFTrack(track, playheadLocalFrame, defaultVal);

  const frameToX = (f: number) => (f / Math.max(1, clipDurationFrames)) * 100;

  const handleTrackClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const frame = Math.round(x * clipDurationFrames);
    const value = evalKFTrack(track, frame, defaultVal);
    onSet(frame, value, 'easeInOut');
    setSelectedFrame(frame);
  }, [clipDurationFrames, track, defaultVal, onSet]);

  const selectedKF = selectedFrame != null ? kfs.find(k => k.frame === selectedFrame) : null;

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', width: 56, flexShrink: 0 }}>{label}</span>
        <span style={{ fontSize: 10, color: '#a78bfa', fontFamily: 'monospace', width: 36 }}>
          {unit ? `${currentVal.toFixed(2)}${unit}` : currentVal.toFixed(2)}
        </span>
        <button type="button" onClick={() => onSet(playheadLocalFrame, currentVal, 'easeInOut')}
          title="Add keyframe at playhead"
          style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.35)', color: '#a78bfa', cursor: 'pointer' }}>
          ◆
        </button>
        {kfs.length > 0 && (
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>{kfs.length} kf</span>
        )}
      </div>

      {/* Mini keyframe lane */}
      <div ref={canvasRef} onClick={handleTrackClick}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          setHovered(Math.round(x * clipDurationFrames));
        }}
        onMouseLeave={() => setHovered(null)}
        style={{ position: 'relative', height: 20, background: 'rgba(0,0,0,0.25)', borderRadius: 3, cursor: 'crosshair', border: '1px solid rgba(255,255,255,0.06)', overflow: 'visible' }}>
        {/* Curve line */}
        {kfs.length >= 2 && (
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
            <polyline
              points={[...kfs].sort((a, b) => a.frame - b.frame).map(k =>
                `${frameToX(k.frame)}%,${(1 - (k.value - min) / (max - min)) * 100}%`
              ).join(' ')}
              fill="none" stroke="rgba(167,139,250,0.5)" strokeWidth="1.5"
            />
          </svg>
        )}
        {/* Playhead indicator */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${frameToX(playheadLocalFrame)}%`, width: 1, background: 'rgba(255,220,0,0.6)', pointerEvents: 'none' }} />
        {/* Keyframe diamonds */}
        {kfs.map(k => (
          <div key={k.frame}
            onMouseDown={e => { e.stopPropagation(); setSelectedFrame(k.frame); }}
            onDoubleClick={e => { e.stopPropagation(); onDelete(k.frame); setSelectedFrame(null); }}
            title={`Frame ${k.frame}: ${k.value.toFixed(3)} — double-click to delete`}
            style={{
              position: 'absolute',
              left: `${frameToX(k.frame)}%`,
              top: '50%',
              transform: 'translate(-50%, -50%) rotate(45deg)',
              width: 8, height: 8,
              background: selectedFrame === k.frame ? '#f59e0b' : '#a78bfa',
              border: '1px solid rgba(0,0,0,0.5)',
              cursor: 'pointer',
              zIndex: 2,
            }}
          />
        ))}
        {/* Hover ghost */}
        {hovered != null && !kfs.find(k => Math.abs(k.frame - hovered) < 2) && (
          <div style={{ position: 'absolute', left: `${frameToX(hovered)}%`, top: '50%', transform: 'translate(-50%, -50%) rotate(45deg)', width: 6, height: 6, background: 'rgba(167,139,250,0.3)', border: '1px solid rgba(167,139,250,0.4)', pointerEvents: 'none' }} />
        )}
      </div>

      {/* Selected keyframe editor */}
      {selectedKF && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, padding: '4px 6px', background: 'rgba(167,139,250,0.08)', borderRadius: 4 }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>f{selectedKF.frame}</span>
          <input type="number" min={min} max={max} step={step} value={selectedKF.value}
            onChange={e => onSet(selectedKF.frame, Number(e.target.value), selectedKF.easing ?? 'easeInOut')}
            style={{ width: 55, fontSize: 10, padding: '2px 4px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3, color: '#e0e0e0' }} />
          <select value={selectedKF.easing ?? 'easeInOut'} onChange={e => onSet(selectedKF.frame, selectedKF.value, e.target.value as EasingType)}
            style={{ flex: 1, fontSize: 9, padding: '2px 3px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3, color: '#e0e0e0' }}>
            {EASINGS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <button type="button" onClick={() => { onDelete(selectedKF.frame); setSelectedFrame(null); }}
            style={{ fontSize: 9, padding: '2px 5px', borderRadius: 3, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', cursor: 'pointer' }}>✕</button>
        </div>
      )}
    </div>
  );
}

export function KeyframeEditor({ clip, totalFrames, clipStartFrame, clipDurationFrames, playheadFrame, fps, onUpdateKeyframes, onUpdateSpeedRamp }: Props) {
  const [open, setOpen] = useState(false);
  const [speedRampOpen, setSpeedRampOpen] = useState(false);

  const playheadLocal = Math.max(0, Math.min(clipDurationFrames, playheadFrame - clipStartFrame));
  const kf = clip.keyframes ?? {};

  const setKFValue = useCallback((prop: KFProp, frame: number, value: number, easing: EasingType) => {
    const existing: KeyframeTrack<number> = kf[prop] ?? { property: prop, keyframes: [] };
    const others = existing.keyframes.filter(k => k.frame !== frame);
    const newKF: Keyframe<number> = { frame, value, easing };
    onUpdateKeyframes({ ...kf, [prop]: { property: prop, keyframes: [...others, newKF].sort((a, b) => a.frame - b.frame) } });
  }, [kf, onUpdateKeyframes]);

  const deleteKF = useCallback((prop: KFProp, frame: number) => {
    if (!kf[prop]) return;
    onUpdateKeyframes({ ...kf, [prop]: { property: prop, keyframes: kf[prop]!.keyframes.filter(k => k.frame !== frame) } });
  }, [kf, onUpdateKeyframes]);

  const clearAll = useCallback(() => {
    onUpdateKeyframes({});
  }, [onUpdateKeyframes]);

  const totalKFCount = Object.values(kf).reduce((s, t) => s + (t?.keyframes.length ?? 0), 0);

  // Speed ramp
  const speedRamp = clip.speedRampKeyframes ?? [];
  const setSpeedKF = useCallback((frame: number, speed: number) => {
    const others = speedRamp.filter(k => k.frame !== frame);
    onUpdateSpeedRamp([...others, { frame, speed }].sort((a, b) => a.frame - b.frame));
  }, [speedRamp, onUpdateSpeedRamp]);
  const deleteSpeedKF = useCallback((frame: number) => {
    onUpdateSpeedRamp(speedRamp.filter(k => k.frame !== frame));
  }, [speedRamp, onUpdateSpeedRamp]);

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: 8 }}>
      {/* Header */}
      <button type="button" onClick={() => setOpen(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: 'transparent', border: 'none', cursor: 'pointer', color: totalKFCount > 0 ? '#a78bfa' : 'rgba(255,255,255,0.5)' }}>
        <span style={{ fontSize: 11, fontWeight: 700 }}>◆ Keyframes</span>
        {totalKFCount > 0 && (
          <span style={{ fontSize: 9, background: 'rgba(167,139,250,0.2)', border: '1px solid rgba(167,139,250,0.35)', borderRadius: 10, padding: '0 5px', color: '#a78bfa' }}>{totalKFCount}</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.5 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '4px 12px 10px' }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>
            Click a lane to add a keyframe at that position. Double-click a diamond to delete.
          </div>

          {KF_PROPS.map(p => {
            const defaults: Record<KFProp, number> = { opacity: 1, volume: 1, posX: 0, posY: 0, scaleX: 1, scaleY: 1, rotation: 0 };
            return (
              <KFTrackRow
                key={p.id}
                propId={p.id}
                label={p.label}
                min={p.min} max={p.max} step={p.step} unit={p.unit}
                track={kf[p.id]}
                clipDurationFrames={clipDurationFrames}
                playheadLocalFrame={playheadLocal}
                defaultVal={defaults[p.id]}
                onSet={(f, v, e) => setKFValue(p.id, f, v, e)}
                onDelete={(f) => deleteKF(p.id, f)}
              />
            );
          })}

          {totalKFCount > 0 && (
            <button type="button" onClick={clearAll}
              style={{ marginTop: 4, fontSize: 10, padding: '4px 10px', borderRadius: 5, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', cursor: 'pointer' }}>
              Clear All Keyframes
            </button>
          )}

          {/* Speed Ramp section */}
          <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }}>
            <button type="button" onClick={() => setSpeedRampOpen(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', cursor: 'pointer', color: speedRamp.length > 0 ? '#34d399' : 'rgba(255,255,255,0.4)', padding: 0, fontSize: 10, fontWeight: 700 }}>
              ⚡ Speed Ramp (FlowWarp)
              {speedRamp.length > 0 && (
                <span style={{ fontSize: 9, background: 'rgba(52,211,153,0.2)', border: '1px solid rgba(52,211,153,0.35)', borderRadius: 10, padding: '0 5px', color: '#34d399' }}>{speedRamp.length}</span>
              )}
              <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.5 }}>{speedRampOpen ? '▲' : '▼'}</span>
            </button>

            {speedRampOpen && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6 }}>
                  Each keyframe sets a new playback speed at that frame. 1.0 = normal, 0.25 = slow-mo, 2.0 = fast.
                </div>
                {/* Speed ramp lane */}
                <div style={{ position: 'relative', height: 24, background: 'rgba(0,0,0,0.25)', borderRadius: 3, cursor: 'crosshair', border: '1px solid rgba(255,255,255,0.06)', marginBottom: 4 }}
                  onClick={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = (e.clientX - rect.left) / rect.width;
                    const frame = Math.round(x * clipDurationFrames);
                    const curSpeed = speedRamp.length > 0
                      ? [...speedRamp].sort((a,b) => a.frame-b.frame).reduce((s,k) => k.frame <= frame ? k.speed : s, 1)
                      : 1;
                    setSpeedKF(frame, curSpeed);
                  }}>
                  {speedRamp.length >= 2 && (
                    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                      <polyline
                        points={[...speedRamp].sort((a,b) => a.frame-b.frame).map(k =>
                          `${(k.frame / Math.max(1, clipDurationFrames)) * 100}%,${(1 - (k.speed - 0.1) / 3.9) * 100}%`
                        ).join(' ')}
                        fill="none" stroke="rgba(52,211,153,0.5)" strokeWidth="1.5"
                      />
                    </svg>
                  )}
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(playheadLocal / Math.max(1, clipDurationFrames)) * 100}%`, width: 1, background: 'rgba(255,220,0,0.6)', pointerEvents: 'none' }} />
                  {speedRamp.map(k => (
                    <div key={k.frame}
                      onDoubleClick={e => { e.stopPropagation(); deleteSpeedKF(k.frame); }}
                      title={`f${k.frame}: ${k.speed}x — dbl-click to delete`}
                      style={{ position: 'absolute', left: `${(k.frame / Math.max(1, clipDurationFrames)) * 100}%`, top: '50%', transform: 'translate(-50%, -50%) rotate(45deg)', width: 8, height: 8, background: '#34d399', border: '1px solid rgba(0,0,0,0.5)', cursor: 'pointer', zIndex: 2 }}
                    />
                  ))}
                </div>
                {speedRamp.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {[...speedRamp].sort((a,b) => a.frame-b.frame).map(k => (
                      <div key={k.frame} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', width: 40 }}>f{k.frame}</span>
                        <input type="range" min={0.1} max={4} step={0.05} value={k.speed}
                          onChange={e => setSpeedKF(k.frame, Number(e.target.value))}
                          style={{ flex: 1 }} />
                        <span style={{ fontSize: 9, color: '#34d399', width: 28, textAlign: 'right' }}>{k.speed.toFixed(2)}x</span>
                        <button type="button" onClick={() => deleteSpeedKF(k.frame)}
                          style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', cursor: 'pointer' }}>✕</button>
                      </div>
                    ))}
                    <button type="button" onClick={() => onUpdateSpeedRamp([])}
                      style={{ marginTop: 2, fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', cursor: 'pointer', alignSelf: 'flex-start' }}>
                      Clear Speed Ramp
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
