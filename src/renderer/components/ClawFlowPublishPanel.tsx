import React, { useState } from 'react';
import { toast } from '../lib/toast';

interface ClawFlowPublishPanelProps {
  projectName: string;
  totalDurationSeconds: number;
}

export function ClawFlowPublishPanel({ projectName, totalDurationSeconds }: ClawFlowPublishPanelProps) {
  // Platforms
  const [platforms, setPlatforms] = useState({ youtube: true, tiktok: false, instagram: false, twitter: false });

  // Title / Description
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [generatingMeta, setGeneratingMeta] = useState(false);

  // Thumbnail
  const [selectedThumb, setSelectedThumb] = useState(0);
  const thumbColors = ['#1e293b', '#0f172a', '#1a1a2e'];
  const thumbTimes = [
    Math.round(totalDurationSeconds * 0.1),
    Math.round(totalDurationSeconds * 0.5),
    Math.round(totalDurationSeconds * 0.85),
  ];

  // Tags
  const [tags, setTags] = useState('');

  // Schedule
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduleTime, setScheduleTime] = useState('');

  // Publishing
  const [publishing, setPublishing] = useState(false);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  async function handleGenerateMeta() {
    setGeneratingMeta(true);
    try {
      const result = await (window as any).electronAPI?.generatePublishMetadata?.({
        name: projectName,
        duration: totalDurationSeconds,
      });
      if (result?.success) {
        setTitle(result.title ?? '');
        setDescription(result.description ?? '');
        if (Array.isArray(result.tags)) setTags(result.tags.join(', '));
      } else {
        // Fallback mock
        setTitle(`${projectName} — You Won't Believe This 🎬`);
        setDescription(`An amazing video: ${projectName}. Watch till the end!`);
        setTags('vlog, video, content, creator');
      }
    } catch {
      setTitle(`${projectName} — You Won't Believe This 🎬`);
      setDescription(`An amazing video: ${projectName}. Watch till the end!`);
      setTags('vlog, video, content, creator');
    } finally {
      setGeneratingMeta(false);
    }
  }

  function handleSuggestTags() {
    const existing = tags ? tags + ', ' : '';
    setTags(existing + 'travel, vlog, video, adventure, creator, 2026');
  }

  async function handlePublish() {
    const selectedPlatforms = Object.entries(platforms).filter(([, v]) => v).map(([k]) => k);
    if (selectedPlatforms.length === 0) {
      toast.error('Select at least one platform');
      return;
    }
    setPublishing(true);
    try {
      for (const platform of selectedPlatforms) {
        if (platform === 'youtube') {
          await (window as any).electronAPI?.uploadYouTube?.();
        } else if (platform === 'tiktok') {
          await (window as any).electronAPI?.uploadTikTok?.();
        }
      }
      toast.info('Connect your account in Settings → Publishing to enable uploads');
    } catch {
      toast.error('Publishing failed — connect your accounts in Settings');
    } finally {
      setPublishing(false);
    }
  }

  const activePlatformCount = Object.values(platforms).filter(Boolean).length;

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: 24,
      background: '#0f0f1a', color: '#e2e8f0', fontFamily: 'inherit',
    }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>🚀 ClawFlow Publish</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '6px 0 0' }}>
            Publish "{projectName}" directly to your platforms
          </p>
        </div>

        {/* Section 1: Platforms */}
        <section style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            ① Choose Platforms
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {(['youtube', 'tiktok', 'instagram', 'twitter'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlatforms(prev => ({ ...prev, [p]: !prev[p] }))}
                style={{
                  padding: '8px 16px', borderRadius: 8, border: `1px solid ${platforms[p] ? '#7c3aed' : 'rgba(255,255,255,0.1)'}`,
                  background: platforms[p] ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.04)',
                  color: platforms[p] ? '#c4b5fd' : '#94a3b8',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {platforms[p] ? '✓ ' : ''}{p === 'youtube' ? 'YouTube' : p === 'tiktok' ? 'TikTok' : p === 'instagram' ? 'Instagram' : 'Twitter/X'}
              </button>
            ))}
          </div>
        </section>

        {/* Section 2: Title & Description */}
        <section style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            ② Title & Description
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button
              onClick={handleGenerateMeta}
              disabled={generatingMeta}
              style={{
                padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                color: 'white', fontSize: 12, fontWeight: 700,
                opacity: generatingMeta ? 0.7 : 1,
              }}
            >
              {generatingMeta ? '⏳ Generating…' : '⚡ Generate with AI'}
            </button>
          </div>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Video title…"
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.04)', color: '#e2e8f0', fontSize: 13, marginBottom: 8,
              boxSizing: 'border-box',
            }}
          />
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Description…"
            rows={4}
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.04)', color: '#e2e8f0', fontSize: 13, resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
        </section>

        {/* Section 3: Thumbnail */}
        <section style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            ③ Thumbnail
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {thumbColors.map((color, i) => (
              <div
                key={i}
                onClick={() => setSelectedThumb(i)}
                style={{
                  width: 140, height: 80, borderRadius: 8, cursor: 'pointer',
                  background: `linear-gradient(135deg, ${color}, ${color}88)`,
                  border: `2px solid ${selectedThumb === i ? '#7c3aed' : 'rgba(255,255,255,0.08)'}`,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end',
                  padding: '0 0 6px',
                }}
              >
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
                  {formatTime(thumbTimes[i])}
                </span>
                {selectedThumb === i && (
                  <span style={{ fontSize: 9, color: '#c4b5fd', fontWeight: 700 }}>✓ Selected</span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Section 4: Tags */}
        <section style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            ④ Tags & Hashtags
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button
              onClick={handleSuggestTags}
              style={{
                padding: '7px 14px', borderRadius: 7, border: '1px solid rgba(124,58,237,0.4)',
                background: 'rgba(124,58,237,0.1)', color: '#a78bfa', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              ⚡ Suggest Tags
            </button>
          </div>
          <input
            value={tags}
            onChange={e => setTags(e.target.value)}
            placeholder="travel, vlog, NYC, adventure…"
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.04)', color: '#e2e8f0', fontSize: 13,
              boxSizing: 'border-box',
            }}
          />
        </section>

        {/* Section 5: Schedule */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            ⑤ Schedule
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="radio" name="schedule" checked={scheduleMode === 'now'}
                onChange={() => setScheduleMode('now')}
                style={{ accentColor: '#7c3aed' }}
              />
              Publish Now
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="radio" name="schedule" checked={scheduleMode === 'later'}
                onChange={() => setScheduleMode('later')}
                style={{ accentColor: '#7c3aed' }}
              />
              Schedule:
            </label>
            {scheduleMode === 'later' && (
              <input
                type="datetime-local"
                value={scheduleTime}
                onChange={e => setScheduleTime(e.target.value)}
                style={{
                  padding: '6px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.04)', color: '#e2e8f0', fontSize: 12,
                }}
              />
            )}
          </div>
        </section>

        {/* Publish button */}
        <button
          onClick={handlePublish}
          disabled={publishing || activePlatformCount === 0}
          style={{
            width: '100%', padding: '13px 0', borderRadius: 10, border: 'none',
            background: activePlatformCount > 0 ? 'linear-gradient(135deg, #7c3aed, #2563eb)' : 'rgba(255,255,255,0.06)',
            color: activePlatformCount > 0 ? 'white' : '#475569',
            fontSize: 14, fontWeight: 800, cursor: activePlatformCount > 0 ? 'pointer' : 'not-allowed',
            opacity: publishing ? 0.7 : 1,
          }}
        >
          {publishing ? '⏳ Publishing…' : `🚀 Publish to ${activePlatformCount} Platform${activePlatformCount !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}
