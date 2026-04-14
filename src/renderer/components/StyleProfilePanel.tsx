import React from 'react';
import { loadProfile, getSuggestedGrade, getTopTransitions } from '../lib/ClawFlowStyleProfile';

interface StyleProfilePanelProps {
  onClose: () => void;
  onApplyStyle: (grade: { exposure: number; contrast: number; saturation: number; temperature: number }) => void;
}

export function StyleProfilePanel({ onClose, onApplyStyle }: StyleProfilePanelProps) {
  const profile = loadProfile();
  const topTransitions = getTopTransitions(3);
  const suggested = getSuggestedGrade();

  const pacingLabel = (avg: number) => {
    if (avg < 2) return 'Fast — great for social';
    if (avg < 4) return 'Medium — well balanced';
    return 'Slow — cinematic';
  };

  return (
    <div style={{
      position: 'fixed', right: 16, top: 60, width: 360, zIndex: 200,
      background: '#1a1a2e', border: '1px solid #4c1d95',
      borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      fontFamily: 'inherit', color: '#e2e8f0',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#c4b5fd' }}>⚡ ClawFlow Style Profile</span>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
            Based on {profile.projectCount} projects · {profile.cutDurationSamples.length + profile.colorSamples.length} edits recorded
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16,
        }}>✕</button>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Pacing */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
            ✂️ Pacing
          </div>
          {profile.cutDurationSamples.length > 0 ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: '#e2e8f0' }}>Avg cut: {profile.avgCutDurationSeconds.toFixed(1)}s</span>
                <span style={{ fontSize: 11, color: '#a78bfa' }}>{pacingLabel(profile.avgCutDurationSeconds)}</span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  width: `${Math.min(100, (profile.avgCutDurationSeconds / 8) * 100)}%`,
                  background: 'linear-gradient(90deg, #7c3aed, #a855f7)',
                }} />
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11, color: '#475569' }}>No cuts recorded yet</div>
          )}
        </div>

        {/* Color Signature */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
            🎨 Color Signature — {profile.dominantLook}
          </div>
          {profile.colorSamples.length > 0 ? (
            <>
              <div style={{ fontSize: 12, color: '#e2e8f0', marginBottom: 6 }}>
                Exp: {profile.avgExposure > 0 ? '+' : ''}{profile.avgExposure.toFixed(2)} · Contrast: {profile.avgContrast > 0 ? '+' : ''}{(profile.avgContrast * 100).toFixed(0)}% · Temp: {profile.avgTemperature > 0 ? '+' : ''}{profile.avgTemperature.toFixed(0)}K
              </div>
              <div style={{ fontSize: 10, color: '#475569' }}>
                Based on {profile.colorSamples.length} grades
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11, color: '#475569' }}>No grades recorded yet</div>
          )}
        </div>

        {/* Transitions */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
            🎭 Transitions
          </div>
          {topTransitions.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {topTransitions.map(({ type, pct }) => (
                <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#e2e8f0', minWidth: 90 }}>{type}</span>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)' }}>
                    <div style={{ height: '100%', borderRadius: 2, width: `${pct}%`, background: '#7c3aed' }} />
                  </div>
                  <span style={{ fontSize: 10, color: '#64748b' }}>{pct}%</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#475569' }}>No transitions recorded yet</div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <button
          onClick={() => {
            if (suggested) {
              onApplyStyle({
                exposure: suggested.exposure ?? 0,
                contrast: suggested.contrast ?? 0,
                saturation: suggested.saturation ?? 1,
                temperature: suggested.temperature ?? 0,
              });
            }
          }}
          disabled={!suggested}
          style={{
            width: '100%', padding: '9px 0', borderRadius: 8, border: 'none', cursor: suggested ? 'pointer' : 'not-allowed',
            background: suggested ? 'linear-gradient(135deg, #7c3aed, #a855f7)' : 'rgba(255,255,255,0.06)',
            color: suggested ? 'white' : '#475569', fontSize: 12, fontWeight: 700,
          }}
        >
          {suggested ? '✨ Apply My Style to Ungraded Clips' : 'Record 5+ grades to enable'}
        </button>
      </div>
    </div>
  );
}
