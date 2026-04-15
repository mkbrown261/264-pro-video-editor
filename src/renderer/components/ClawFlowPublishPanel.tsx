import React, { useState, useEffect } from 'react';
import { toast } from '../lib/toast';

// Full API surface exposed via contextBridge
interface PublishElectronAPI {
  openExternal?: (url: string) => void;
  connectYouTube?: () => Promise<{ success: boolean; demo?: boolean; message?: string; error?: string }>;
  connectTikTok?: () => Promise<{ success: boolean; demo?: boolean; message?: string; error?: string }>;
  checkPublishConnection?: (platform: string) => Promise<{ connected: boolean; demo?: boolean }>;
  disconnectPublish?: (platform: string) => Promise<{ success: boolean }>;
  uploadYouTube?: (args: { videoPath: string; title: string; description: string; tags: string[]; privacyStatus?: string }) => Promise<{ success: boolean; videoId?: string; url?: string; error?: string }>;
  uploadTikTok?: (args: { videoPath: string; title: string; privacyLevel?: string }) => Promise<{ success: boolean; publishId?: string; error?: string }>;
  generatePublishMetadata?: (params: { name: string; duration: number }) => Promise<{ success: boolean; title?: string; description?: string; tags?: string[] }>;
}

// Helper so we get proper types without fighting merged interface narrowing
const api = (): PublishElectronAPI => (window as unknown as { electronAPI?: PublishElectronAPI }).electronAPI ?? {};

interface ClawFlowPublishPanelProps {
  projectName: string;
  totalDurationSeconds: number;
  lastExportedPath?: string | null;
}

export function ClawFlowPublishPanel({ projectName, totalDurationSeconds, lastExportedPath }: ClawFlowPublishPanelProps) {
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

  // Connection state
  const [ytConnected, setYtConnected] = useState(false);
  const [ttConnected, setTtConnected] = useState(false);
  const [ytDemo, setYtDemo] = useState(false);
  const [ttDemo, setTtDemo] = useState(false);

  // Publishing state
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ platform: string; url?: string } | null>(null);

  // On mount, check connection status for both platforms
  useEffect(() => {
    void api().checkPublishConnection?.('youtube')
      .then(r => { if (r) { setYtConnected(r.connected); setYtDemo(r.demo ?? false); } })
      .catch(() => { /* ignore — not connected */ });
    void api().checkPublishConnection?.('tiktok')
      .then(r => { if (r) { setTtConnected(r.connected); setTtDemo(r.demo ?? false); } })
      .catch(() => { /* ignore — not connected */ });
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  async function handleGenerateMeta() {
    setGeneratingMeta(true);
    try {
      const result = await api().generatePublishMetadata?.({
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

  const handleConnectYouTube = async () => {
    toast.info('Opening YouTube login…');
    const r = await api().connectYouTube?.();
    if (r?.success) {
      setYtConnected(true);
      setYtDemo(r.demo ?? false);
      toast.success(r.message ?? '✅ YouTube connected');
    } else {
      toast.error(r?.error ?? 'Connection failed');
    }
  };

  const handleConnectTikTok = async () => {
    toast.info('Opening TikTok login…');
    const r = await api().connectTikTok?.();
    if (r?.success) {
      setTtConnected(true);
      setTtDemo(r.demo ?? false);
      toast.success(r.message ?? '✅ TikTok connected');
    } else {
      toast.error(r?.error ?? 'Connection failed');
    }
  };

  const handleDisconnect = async (platform: 'youtube' | 'tiktok') => {
    await api().disconnectPublish?.(platform);
    if (platform === 'youtube') { setYtConnected(false); setYtDemo(false); }
    if (platform === 'tiktok') { setTtConnected(false); setTtDemo(false); }
    toast.info(`Disconnected from ${platform === 'youtube' ? 'YouTube' : 'TikTok'}`);
  };

  async function handlePublish() {
    const selectedPlatforms = Object.entries(platforms).filter(([, v]) => v).map(([k]) => k);
    if (selectedPlatforms.length === 0) {
      toast.error('Select at least one platform');
      return;
    }

    if (!lastExportedPath) {
      toast.error('Export your video first, then publish.');
      return;
    }

    setPublishing(true);
    setPublishResult(null);

    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    const videoTitle = title || `${projectName} — Untitled`;
    const videoDescription = description || '';

    try {
      for (const platform of selectedPlatforms) {
        if (platform === 'youtube') {
          if (!ytConnected) {
            toast.error('Connect your YouTube account first');
            continue;
          }
          toast.info('Uploading to YouTube…');
          const r = await api().uploadYouTube?.({
            videoPath: lastExportedPath,
            title: videoTitle,
            description: videoDescription,
            tags: tagList,
            privacyStatus: 'private',
          });
          if (r?.success) {
            setPublishResult({ platform: 'YouTube', url: r.url });
            toast.success(`✅ YouTube upload complete${r.url ? ` — ${r.url}` : ''}`);
          } else {
            toast.error(`YouTube: ${r?.error ?? 'Upload failed'}`);
          }
        } else if (platform === 'tiktok') {
          if (!ttConnected) {
            toast.error('Connect your TikTok account first');
            continue;
          }
          toast.info('Uploading to TikTok…');
          const r = await api().uploadTikTok?.({
            videoPath: lastExportedPath,
            title: videoTitle,
            privacyLevel: 'SELF_ONLY',
          });
          if (r?.success) {
            setPublishResult({ platform: 'TikTok' });
            toast.success('✅ TikTok upload complete');
          } else {
            toast.error(`TikTok: ${r?.error ?? 'Upload failed'}`);
          }
        } else {
          toast.info(`${platform} publishing coming soon`);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publishing failed');
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

        {/* Export file status banner */}
        <div style={{
          marginBottom: 20, padding: '10px 14px', borderRadius: 8,
          background: lastExportedPath ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
          border: `1px solid ${lastExportedPath ? 'rgba(34,197,94,0.25)' : 'rgba(245,158,11,0.25)'}`,
          fontSize: 12, color: lastExportedPath ? '#86efac' : '#fcd34d',
        }}>
          {lastExportedPath
            ? `📁 Ready to publish: ${lastExportedPath.split('/').pop() ?? lastExportedPath}`
            : '⚠️ No exported video yet — export your video first, then come back to publish.'}
        </div>

        {/* Section 1: Platforms */}
        <section style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            ① Choose Platforms
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {/* YouTube */}
            <div style={{
              padding: '8px 16px', borderRadius: 8,
              border: `1px solid ${platforms.youtube ? '#7c3aed' : 'rgba(255,255,255,0.1)'}`,
              background: platforms.youtube ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.04)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <button
                onClick={() => setPlatforms(prev => ({ ...prev, youtube: !prev.youtube }))}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  color: platforms.youtube ? '#c4b5fd' : '#94a3b8',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {platforms.youtube ? '✓ ' : ''}YouTube
              </button>
              {ytConnected ? (
                <>
                  <span style={{ fontSize: 10, color: ytDemo ? '#f59e0b' : '#22c55e' }}>
                    {ytDemo ? '⚡ demo' : '● connected'}
                  </span>
                  <button
                    onClick={() => handleDisconnect('youtube')}
                    style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, border: '1px solid #334155', background: 'transparent', color: '#64748b', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <button
                  onClick={handleConnectYouTube}
                  style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: '1px solid #334155', background: '#1e293b', color: '#94a3b8', cursor: 'pointer' }}
                >
                  Connect
                </button>
              )}
            </div>

            {/* TikTok */}
            <div style={{
              padding: '8px 16px', borderRadius: 8,
              border: `1px solid ${platforms.tiktok ? '#7c3aed' : 'rgba(255,255,255,0.1)'}`,
              background: platforms.tiktok ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.04)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <button
                onClick={() => setPlatforms(prev => ({ ...prev, tiktok: !prev.tiktok }))}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  color: platforms.tiktok ? '#c4b5fd' : '#94a3b8',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {platforms.tiktok ? '✓ ' : ''}TikTok
              </button>
              {ttConnected ? (
                <>
                  <span style={{ fontSize: 10, color: ttDemo ? '#f59e0b' : '#22c55e' }}>
                    {ttDemo ? '⚡ demo' : '● connected'}
                  </span>
                  <button
                    onClick={() => handleDisconnect('tiktok')}
                    style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, border: '1px solid #334155', background: 'transparent', color: '#64748b', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <button
                  onClick={handleConnectTikTok}
                  style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: '1px solid #334155', background: '#1e293b', color: '#94a3b8', cursor: 'pointer' }}
                >
                  Connect
                </button>
              )}
            </div>

            {/* Instagram & Twitter (coming soon) */}
            {(['instagram', 'twitter'] as const).map((p) => (
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
                {platforms[p] ? '✓ ' : ''}{p === 'instagram' ? 'Instagram' : 'Twitter/X'}
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

        {/* Publish result */}
        {publishResult && (
          <div style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 8,
            background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)',
            fontSize: 13, color: '#86efac',
          }}>
            ✅ Published to {publishResult.platform}
            {publishResult.url && (
              <a
                href={publishResult.url}
                style={{ color: '#60a5fa', marginLeft: 8, fontSize: 12 }}
                onClick={e => { e.preventDefault(); api().openExternal?.(publishResult.url!); }}
              >
                {publishResult.url}
              </a>
            )}
          </div>
        )}

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
