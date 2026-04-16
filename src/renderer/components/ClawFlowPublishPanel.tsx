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
  markers?: Array<{ id: string; frame: number; label: string; color: string }>;
  sequenceFps?: number;
}

// ── Shared style tokens ───────────────────────────────────────────────────────
const SECTION_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#475569',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 10,
};

const META_INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  padding: '10px 14px',
  color: '#e2e8f0',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
};

export function ClawFlowPublishPanel({
  projectName,
  totalDurationSeconds,
  lastExportedPath,
  markers,
  sequenceFps,
}: ClawFlowPublishPanelProps) {
  // Platforms
  const [platforms, setPlatforms] = useState({ youtube: false, tiktok: false, instagram: false, twitter: false });

  // Title / Description
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [generatingMeta, setGeneratingMeta] = useState(false);

  // Thumbnail
  const [selectedThumb, setSelectedThumb] = useState(0);
  const thumbColors = ['#1e293b', '#0f172a', '#1a1a2e'];
  const safeDuration = totalDurationSeconds > 0 ? totalDurationSeconds : 60;
  const thumbTimes = [
    Math.round(safeDuration * 0.1),
    Math.round(safeDuration * 0.5),
    Math.round(safeDuration * 0.85),
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
      toast.error('Select at least one platform to publish to');
      return;
    }

    if (!lastExportedPath) {
      toast.error('Export your video first (Edit → Export), then publish here.');
      return;
    }

    // Verify at least one selected platform has a connection
    const needsYT = selectedPlatforms.includes('youtube') && !ytConnected;
    const needsTT = selectedPlatforms.includes('tiktok') && !ttConnected;
    const onlySocial = selectedPlatforms.every(p => p === 'youtube' || p === 'tiktok');
    if (onlySocial && needsYT && needsTT) {
      toast.error('Connect at least one social account before publishing.');
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

  function handleExportChapters() {
    if (!markers || markers.length === 0) return;
    const fps = sequenceFps ?? 30;
    const sorted = [...markers].sort((a, b) => a.frame - b.frame);
    // YouTube chapters: first chapter must be at 0:00
    const lines = sorted.map((m, i) => {
      const totalSec = Math.round(m.frame / fps);
      const mm = Math.floor(totalSec / 60);
      const ss = totalSec % 60;
      const ts = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
      return `${ts} ${m.label || `Chapter ${i + 1}`}`;
    });
    // Prepend 0:00 if first marker isn't at frame 0
    if (sorted[0].frame > 0) lines.unshift('0:00 Intro');
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => toast.success('📋 YouTube chapters copied to clipboard!'));
  }

  const activePlatformCount = Object.values(platforms).filter(Boolean).length;

  // ── Platform card renderer ────────────────────────────────────────────────
  function PlatformCard({
    id,
    label,
    icon,
    isConnected,
    isDemo,
    onConnect,
    onDisconnectPlatform,
  }: {
    id: keyof typeof platforms;
    label: string;
    icon: string;
    isConnected?: boolean;
    isDemo?: boolean;
    onConnect?: () => void;
    onDisconnectPlatform?: () => void;
  }) {
    const selected = platforms[id];
    return (
      <div
        style={{
          padding: '12px 16px',
          borderRadius: 10,
          marginBottom: 10,
          border: `1px solid ${selected ? '#7c3aed' : 'rgba(255,255,255,0.08)'}`,
          background: selected ? 'rgba(124,58,237,0.1)' : 'rgba(255,255,255,0.03)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Left: checkbox + icon + name + badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => setPlatforms(prev => ({ ...prev, [id]: !prev[id] }))}
            style={{ accentColor: '#7c3aed', width: 14, height: 14, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 16 }}>{icon}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: selected ? '#c4b5fd' : '#94a3b8' }}>{label}</span>
          {isConnected && (
            <span style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 4,
              background: isDemo ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
              color: isDemo ? '#f59e0b' : '#22c55e',
              fontWeight: 600,
            }}>
              {isDemo ? '⚡ demo' : '● live'}
            </span>
          )}
        </div>
        {/* Right: connect / disconnect button */}
        {onConnect && (
          isConnected ? (
            <button
              onClick={onDisconnectPlatform}
              style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 6,
                border: '1px solid #334155', background: 'transparent',
                color: '#64748b', cursor: 'pointer',
              }}
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={onConnect}
              style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 6,
                border: '1px solid #334155', background: '#1e293b',
                color: '#94a3b8', cursor: 'pointer',
              }}
            >
              Connect
            </button>
          )
        )}
        {!onConnect && (
          <span style={{ fontSize: 10, color: '#334155', fontStyle: 'italic' }}>soon</span>
        )}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#0a0a14',
      color: '#e2e8f0',
      fontFamily: 'inherit',
    }}>
      {/* ── HEADER BAR ──────────────────────────────────────────────────────── */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid #1e293b',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0, lineHeight: 1.2 }}>
            🚀 ClawFlow Publish
          </h1>
          <p style={{ fontSize: 12, color: '#64748b', margin: '3px 0 0' }}>
            {projectName}
          </p>
        </div>
        {/* File status badge */}
        <div style={{
          padding: '6px 12px',
          borderRadius: 8,
          background: lastExportedPath ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
          border: `1px solid ${lastExportedPath ? 'rgba(34,197,94,0.25)' : 'rgba(245,158,11,0.25)'}`,
          fontSize: 11,
          color: lastExportedPath ? '#86efac' : '#fcd34d',
          maxWidth: 280,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {lastExportedPath
            ? `📁 ${lastExportedPath.split('/').pop() ?? lastExportedPath}`
            : '⚠️ No export yet'}
        </div>
      </div>

      {/* ── 2-COLUMN CONTENT AREA ───────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 0,
        flex: 1,
        overflow: 'hidden',
      }}>

        {/* ════════════════ LEFT COLUMN ════════════════ */}
        <div style={{
          padding: 24,
          overflowY: 'auto',
          borderRight: '1px solid #1e293b',
          display: 'flex',
          flexDirection: 'column',
        }}>

          {/* ── Platforms ─────────────────────────────── */}
          <section style={{ marginBottom: 24 }}>
            <div style={SECTION_LABEL}>Platforms</div>
            <PlatformCard
              id="youtube"
              label="YouTube"
              icon="▶"
              isConnected={ytConnected}
              isDemo={ytDemo}
              onConnect={handleConnectYouTube}
              onDisconnectPlatform={() => handleDisconnect('youtube')}
            />
            <PlatformCard
              id="tiktok"
              label="TikTok"
              icon="♪"
              isConnected={ttConnected}
              isDemo={ttDemo}
              onConnect={handleConnectTikTok}
              onDisconnectPlatform={() => handleDisconnect('tiktok')}
            />
            <PlatformCard id="instagram" label="Instagram" icon="◎" />
            <PlatformCard id="twitter" label="Twitter / X" icon="✦" />
          </section>

          {/* ── Schedule ──────────────────────────────── */}
          <section style={{ marginBottom: 24 }}>
            <div style={SECTION_LABEL}>Schedule</div>
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
                Schedule
              </label>
            </div>
            {scheduleMode === 'later' && (
              <input
                type="datetime-local"
                value={scheduleTime}
                onChange={e => setScheduleTime(e.target.value)}
                style={{
                  ...META_INPUT,
                  marginTop: 10,
                  width: 'auto',
                  fontSize: 12,
                }}
              />
            )}
          </section>

          {/* spacer pushes publish button to bottom */}
          <div style={{ flex: 1 }} />

          {/* ── Publish result ────────────────────────── */}
          {publishResult && (
            <div style={{
              marginBottom: 12, padding: '10px 14px', borderRadius: 8,
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

          {/* ── Publish button (sticky bottom) ────────── */}
          <div style={{ position: 'sticky', bottom: 0, padding: '16px 0 0' }}>
            <button
              onClick={handlePublish}
              disabled={publishing || activePlatformCount === 0}
              style={{
                width: '100%', padding: '14px 0', borderRadius: 10, border: 'none',
                background: activePlatformCount > 0
                  ? 'linear-gradient(135deg, #7c3aed, #2563eb)'
                  : 'rgba(255,255,255,0.06)',
                color: activePlatformCount > 0 ? 'white' : '#475569',
                fontSize: 15, fontWeight: 800,
                cursor: activePlatformCount > 0 ? 'pointer' : 'not-allowed',
                opacity: publishing ? 0.7 : 1,
                letterSpacing: '0.02em',
              }}
            >
              {publishing
                ? '⏳ Publishing…'
                : `🚀 Publish to ${activePlatformCount} Platform${activePlatformCount !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>

        {/* ════════════════ RIGHT COLUMN ════════════════ */}
        <div style={{ padding: 24, overflowY: 'auto' }}>

          {/* ── Metadata ──────────────────────────────── */}
          <section style={{ marginBottom: 24 }}>
            <div style={SECTION_LABEL}>Metadata</div>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Video title…"
              style={{ ...META_INPUT, marginBottom: 8 }}
            />
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Description…"
              rows={4}
              style={{ ...META_INPUT, resize: 'vertical' as const }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                onClick={handleGenerateMeta}
                disabled={generatingMeta}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                  color: 'white', fontSize: 12, fontWeight: 700,
                  opacity: generatingMeta ? 0.7 : 1,
                }}
              >
                {generatingMeta ? '⏳ Generating…' : '⚡ Generate AI Meta'}
              </button>
            </div>

            {/* Tags */}
            <div style={{ ...SECTION_LABEL, marginTop: 16 }}>Tags & Hashtags</div>
            <input
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="travel, vlog, NYC, adventure…"
              style={META_INPUT}
            />
            <button
              onClick={handleSuggestTags}
              style={{
                marginTop: 8, padding: '7px 14px', borderRadius: 7,
                border: '1px solid rgba(124,58,237,0.4)',
                background: 'rgba(124,58,237,0.1)', color: '#a78bfa', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              ⚡ Suggest Tags
            </button>
          </section>

          {/* ── Thumbnail picker ──────────────────────── */}
          <section style={{ marginBottom: 24 }}>
            <div style={SECTION_LABEL}>Thumbnail</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {thumbColors.map((color, i) => (
                <div
                  key={i}
                  onClick={() => setSelectedThumb(i)}
                  style={{
                    flex: 1, height: 72, borderRadius: 8, cursor: 'pointer',
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
                    <span style={{ fontSize: 9, color: '#c4b5fd', fontWeight: 700 }}>✓</span>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ── Chapters ──────────────────────────────── */}
          {markers && markers.length > 0 && (
            <section style={{ marginTop: 24 }}>
              <div style={SECTION_LABEL}>📍 YouTube Chapters ({markers.length})</div>
              <div style={{
                background: 'rgba(255,255,255,0.03)', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.08)', padding: '8px 0',
                marginBottom: 10, maxHeight: 160, overflowY: 'auto',
              }}>
                {markers
                  .slice()
                  .sort((a, b) => a.frame - b.frame)
                  .map((m, i) => {
                    const totalSec = Math.round(m.frame / (sequenceFps ?? 30));
                    const mm = Math.floor(totalSec / 60);
                    const ss = totalSec % 60;
                    const ts = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
                    return (
                      <div key={m.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '5px 12px', fontSize: 12, color: '#94a3b8',
                      }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                        <span style={{ color: '#64748b', fontVariantNumeric: 'tabular-nums', minWidth: 36 }}>{ts}</span>
                        <span style={{ color: '#e2e8f0' }}>{m.label || `Chapter ${i + 1}`}</span>
                      </div>
                    );
                  })}
              </div>
              <button
                onClick={handleExportChapters}
                style={{
                  width: '100%', padding: '8px 0', borderRadius: 7,
                  border: '1px solid #334155', background: '#1e293b',
                  color: '#94a3b8', fontSize: 12, cursor: 'pointer', fontWeight: 600,
                }}
              >
                📋 Copy YouTube Chapters
              </button>
            </section>
          )}

        </div>
      </div>
    </div>
  );
}
