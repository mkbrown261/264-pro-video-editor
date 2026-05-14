/**
 * AIToolsWave2Panel — Wave 2 + 3 AI features
 * Subtitle Burn-In, Revision Mode, Noise Reduction, Color Match,
 * Per-Clip Normalize, Stabilization, Proxy Media, Deinterlace,
 * Multicam Sync, Waveform Extraction
 */
import React, { useState, useCallback } from 'react';
import { useEditorStore } from '../store/editorStore';

const API = (window as any).electronAPI;

function Card({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ background: `${color}09`, border: `1px solid ${color}30`, borderRadius: 8, overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', color }}>
        <span style={{ fontWeight: 700, fontSize: 12 }}>{title}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '0 12px 12px' }}>{children}</div>}
    </div>
  );
}

function StatusLine({ busy, result, error, busyLabel = 'Processing...' }: { busy: boolean; result?: string | null; error?: string | null; busyLabel?: string }) {
  if (busy) return <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>⏳ {busyLabel}</div>;
  if (result) return <div style={{ marginTop: 6, fontSize: 11, color: '#22c55e' }}>✓ {result}</div>;
  if (error) return <div style={{ marginTop: 6, fontSize: 11, color: '#ef4444' }}>⚠ {error}</div>;
  return null;
}

function ActionBtn({ label, color, onClick, disabled }: { label: string; color: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      style={{ width: '100%', padding: '7px 0', fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: disabled ? 'wait' : 'pointer', background: disabled ? `${color}12` : `${color}20`, border: `1px solid ${color}55`, color }}>
      {label}
    </button>
  );
}

export function AIToolsWave2Panel() {
  const project = useEditorStore(s => s.project);
  const selectedClipId = useEditorStore(s => s.selectedClipId);
  const setColorGrade = useEditorStore(s => s.setColorGrade);

  const selectedClip = project.sequence.clips.find(c => c.id === selectedClipId);
  const selectedAsset = selectedClip ? project.assets.find(a => a.id === selectedClip.assetId) : null;
  const clipPath = selectedAsset?.sourcePath ?? '';

  // ── Subtitle Burn-In ──────────────────────────────────────────────────────
  const [srtContent, setSrtContent] = useState('');
  const [subStyle, setSubStyle] = useState<'minimal' | 'bold' | 'outline'>('bold');
  const [subBusy, setSubBusy] = useState(false);
  const [subResult, setSubResult] = useState<string | null>(null);
  const [subError, setSubError] = useState<string | null>(null);

  // ── Revision Mode ─────────────────────────────────────────────────────────
  const [revisionText, setRevisionText] = useState('');
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [revisionOps, setRevisionOps] = useState<Array<{ op: string; clipId?: string; note?: string; value?: number }> | null>(null);
  const [revisionError, setRevisionError] = useState<string | null>(null);

  // ── Noise Reduction ───────────────────────────────────────────────────────
  const [nrStrength, setNrStrength] = useState(5);
  const [nrBusy, setNrBusy] = useState(false);
  const [nrResult, setNrResult] = useState<string | null>(null);
  const [nrError, setNrError] = useState<string | null>(null);

  // ── Color Match ───────────────────────────────────────────────────────────
  const [cmRefPath, setCmRefPath] = useState('');
  const [cmBusy, setCmBusy] = useState(false);
  const [cmResult, setCmResult] = useState<string | null>(null);
  const [cmError, setCmError] = useState<string | null>(null);

  // ── Normalize Clip ────────────────────────────────────────────────────────
  const [normLufs, setNormLufs] = useState(-16);
  const [normBusy, setNormBusy] = useState(false);
  const [normResult, setNormResult] = useState<string | null>(null);
  const [normError, setNormError] = useState<string | null>(null);

  // ── Stabilize ────────────────────────────────────────────────────────────
  const [stabStr, setStabStr] = useState(5);
  const [stabBusy, setStabBusy] = useState(false);
  const [stabResult, setStabResult] = useState<string | null>(null);
  const [stabError, setStabError] = useState<string | null>(null);

  // ── Proxy Media ───────────────────────────────────────────────────────────
  const [proxyRes, setProxyRes] = useState<'540p' | '720p' | '1080p'>('540p');
  const [proxyBusy, setProxyBusy] = useState(false);
  const [proxyResult, setProxyResult] = useState<string | null>(null);
  const [proxyError, setProxyError] = useState<string | null>(null);
  const [proxyProgress, setProxyProgress] = useState(0);

  // ── Deinterlace ───────────────────────────────────────────────────────────
  const [deintBusy, setDeintBusy] = useState(false);
  const [deintResult, setDeintResult] = useState<string | null>(null);
  const [deintError, setDeintError] = useState<string | null>(null);

  // ── Multicam Sync ─────────────────────────────────────────────────────────
  const [mcBusy, setMcBusy] = useState(false);
  const [mcResult, setMcResult] = useState<Array<{ id: string; offsetSeconds: number }> | null>(null);
  const [mcError, setMcError] = useState<string | null>(null);

  const handleBurnSubs = useCallback(async () => {
    if (!clipPath) { setSubError('Select a clip first'); return; }
    if (!srtContent.trim()) { setSubError('Paste SRT content above'); return; }
    setSubBusy(true); setSubError(null); setSubResult(null);
    const res = await API?.burnSubtitles?.({ inputPath: clipPath, srtContent, style: subStyle });
    setSubBusy(false);
    if (res?.success) setSubResult(`Saved: ${res.outputPath}`);
    else setSubError(res?.error ?? 'Failed');
  }, [clipPath, srtContent, subStyle]);

  const handleRevision = useCallback(async () => {
    if (!revisionText.trim()) { setRevisionError('Enter revision instructions'); return; }
    setRevisionBusy(true); setRevisionError(null); setRevisionOps(null);
    const projectJson = JSON.stringify({
      fps: project.sequence.settings.fps,
      clips: project.sequence.clips.map(c => {
        const asset = project.assets.find(a => a.id === c.assetId);
        return { id: c.id, name: asset?.name, startFrame: c.startFrame, endFrame: c.endFrame, trackId: c.trackId };
      }),
    });
    const res = await API?.parseRevision?.({ instructions: revisionText, projectJson });
    setRevisionBusy(false);
    if (res?.success) setRevisionOps(res.ops as any);
    else setRevisionError(res?.error ?? 'Failed');
  }, [revisionText, project]);

  const handleNoiseReduce = useCallback(async () => {
    if (!clipPath) { setNrError('Select a clip first'); return; }
    setNrBusy(true); setNrError(null); setNrResult(null);
    const res = await API?.noiseReduce?.({ inputPath: clipPath, strength: nrStrength });
    setNrBusy(false);
    if (res?.success) setNrResult(`Saved: ${res.outputPath}`);
    else setNrError(res?.error ?? 'Failed');
  }, [clipPath, nrStrength]);

  const handleColorMatch = useCallback(async () => {
    if (!clipPath) { setCmError('Select a target clip first'); return; }
    if (!cmRefPath.trim()) { setCmError('Enter reference clip path'); return; }
    setCmBusy(true); setCmError(null); setCmResult(null);
    const res = await API?.colorMatch?.({ referenceClipPath: cmRefPath, targetClipPath: clipPath });
    setCmBusy(false);
    if (res?.success && res.suggestedGrade && selectedClipId) {
      setColorGrade(selectedClipId, res.suggestedGrade as any);
      setCmResult('Color grade applied to selected clip');
    } else setCmError(res?.error ?? 'Failed');
  }, [clipPath, cmRefPath, selectedClipId, setClipColorGrade]);

  const handleNormalize = useCallback(async () => {
    if (!clipPath) { setNormError('Select a clip first'); return; }
    setNormBusy(true); setNormError(null); setNormResult(null);
    const res = await API?.normalizeClip?.({ inputPath: clipPath, targetLufs: normLufs });
    setNormBusy(false);
    if (res?.success) setNormResult(`Saved: ${res.outputPath}`);
    else setNormError(res?.error ?? 'Failed');
  }, [clipPath, normLufs]);

  const handleStabilize = useCallback(async () => {
    if (!clipPath) { setStabError('Select a clip first'); return; }
    setStabBusy(true); setStabError(null); setStabResult(null);
    const res = await API?.stabilize?.({ inputPath: clipPath, strength: stabStr });
    setStabBusy(false);
    if (res?.success) setStabResult(`Saved: ${res.outputPath} (${res.method})`);
    else setStabError(res?.error ?? 'Failed');
  }, [clipPath, stabStr]);

  const handleProxy = useCallback(async () => {
    if (!clipPath) { setProxyError('Select a clip first'); return; }
    setProxyBusy(true); setProxyError(null); setProxyResult(null); setProxyProgress(0);
    const timer = setInterval(() => setProxyProgress(p => Math.min(p + 5, 90)), 500);
    const res = await API?.generateProxyMedia?.({ inputPath: clipPath, resolution: proxyRes });
    clearInterval(timer); setProxyProgress(100);
    setProxyBusy(false);
    if (res?.success) setProxyResult(`${proxyRes} proxy saved: ${res.outputPath}`);
    else setProxyError(res?.error ?? 'Failed');
  }, [clipPath, proxyRes]);

  const handleDeinterlace = useCallback(async () => {
    if (!clipPath) { setDeintError('Select a clip first'); return; }
    setDeintBusy(true); setDeintError(null); setDeintResult(null);
    const res = await API?.deinterlace?.({ inputPath: clipPath });
    setDeintBusy(false);
    if (res?.success) setDeintResult(`Saved: ${res.outputPath}`);
    else setDeintError(res?.error ?? 'Failed');
  }, [clipPath]);

  const handleMulticamSync = useCallback(async () => {
    const videoClips = project.sequence.clips.filter(c => {
      const track = project.sequence.tracks.find(t => t.id === c.trackId);
      return track?.kind === 'video';
    });
    const clipsWithPaths = videoClips.map(c => {
      const asset = project.assets.find(a => a.id === c.assetId);
      return { id: c.id, filePath: asset?.sourcePath ?? '' };
    }).filter(c => c.filePath);
    if (clipsWithPaths.length < 2) { setMcError('Need at least 2 video clips on timeline'); return; }
    setMcBusy(true); setMcError(null); setMcResult(null);
    const res = await API?.multicamSync?.({ clips: clipsWithPaths });
    setMcBusy(false);
    if (res?.success) setMcResult(res.offsets);
    else setMcError(res?.error ?? 'Failed');
  }, [project]);

  const selectedName = selectedAsset?.name ?? 'No clip selected';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
      {/* Selected clip context */}
      <div style={{ padding: '4px 12px 0', fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
        Active clip: <span style={{ color: 'rgba(255,255,255,0.6)' }}>{selectedName}</span>
      </div>

      {/* ── Subtitle Burn-In ─────────────────────────────────────────────────── */}
      <Card title="📝 Subtitle Burn-In" color="#22d3ee">
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
          Paste SRT content and bake captions permanently into the video file.
        </div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 3 }}>SRT CONTENT</div>
          <textarea value={srtContent} onChange={e => setSrtContent(e.target.value)} rows={4} placeholder={'1\n00:00:01,000 --> 00:00:04,000\nHello world'}
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 10, padding: '6px 8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: '#e0e0e0', resize: 'vertical', fontFamily: 'monospace' }} />
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {(['minimal', 'bold', 'outline'] as const).map(s => (
            <button key={s} type="button" onClick={() => setSubStyle(s)}
              style={{ flex: 1, padding: '4px 0', fontSize: 10, borderRadius: 4, background: subStyle === s ? 'rgba(34,211,238,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${subStyle === s ? 'rgba(34,211,238,0.5)' : 'rgba(255,255,255,0.1)'}`, color: subStyle === s ? '#22d3ee' : 'rgba(255,255,255,0.5)', cursor: 'pointer', textTransform: 'capitalize' }}>
              {s}
            </button>
          ))}
        </div>
        <ActionBtn label={subBusy ? '⏳ Burning...' : '📝 Burn Subtitles'} color="#22d3ee" onClick={handleBurnSubs} disabled={subBusy} />
        <StatusLine busy={subBusy} result={subResult} error={subError} busyLabel="Burning subtitles..." />
      </Card>

      {/* ── Revision Mode ────────────────────────────────────────────────────── */}
      <Card title="✏️ AI Revision Mode" color="#a855f7">
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
          Describe changes in plain English. The AI reads your timeline and returns a structured edit plan you can review before applying.
        </div>
        <textarea value={revisionText} onChange={e => setRevisionText(e.target.value)} rows={3}
          placeholder={'e.g. "Remove the clip at 1:23, tighten the middle section, lower the music volume"'}
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 11, padding: '6px 8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: '#e0e0e0', resize: 'vertical', marginBottom: 8 }} />
        <ActionBtn label={revisionBusy ? '⏳ Parsing instructions...' : '✏️ Parse Revisions'} color="#a855f7" onClick={handleRevision} disabled={revisionBusy} />
        {revisionOps && revisionOps.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{revisionOps.length} operations detected:</div>
            {revisionOps.map((op, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'rgba(168,85,247,0.08)', borderRadius: 5, fontSize: 11 }}>
                <span style={{ fontWeight: 700, color: '#c084fc', textTransform: 'capitalize', minWidth: 100 }}>{op.op?.replace(/_/g, ' ')}</span>
                <span style={{ color: 'rgba(255,255,255,0.5)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {op.clipId ? `clip: ${op.clipId.slice(0, 8)}` : ''}{op.note ? ` — ${op.note}` : ''}{op.value != null ? ` (${op.value})` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
        {revisionOps?.length === 0 && <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>No actionable operations found — try being more specific.</div>}
        {revisionError && <div style={{ marginTop: 6, fontSize: 11, color: '#ef4444' }}>⚠ {revisionError}</div>}
      </Card>

      {/* ── Noise Reduction ──────────────────────────────────────────────────── */}
      <Card title="🔇 Noise Reduction" color="#f97316">
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
          Removes background hiss, hum, and room noise from audio. Uses FFmpeg's non-local means denoiser.
        </div>
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>STRENGTH</span>
            <span style={{ fontSize: 10, color: '#fb923c' }}>{nrStrength}/10</span>
          </div>
          <input type="range" min={1} max={10} value={nrStrength} onChange={e => setNrStrength(Number(e.target.value))}
            style={{ width: '100%', marginBottom: 8 }} />
        </div>
        <ActionBtn label={nrBusy ? '⏳ Reducing noise...' : '🔇 Remove Background Noise'} color="#f97316" onClick={handleNoiseReduce} disabled={nrBusy} />
        <StatusLine busy={nrBusy} result={nrResult} error={nrError} busyLabel="Removing noise..." />
      </Card>

      {/* ── Color Match ───────────────────────────────────────────────────────── */}
      <Card title="🎨 Color Match" color="#3b8af7">
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
          Analyzes a reference clip's color profile and applies a matching grade to your selected clip. Great for multi-camera consistency.
        </div>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 3 }}>REFERENCE CLIP PATH</div>
          <input type="text" value={cmRefPath} onChange={e => setCmRefPath(e.target.value)} placeholder="/path/to/reference-clip.mp4"
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 11, padding: '5px 8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: '#e0e0e0' }} />
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>
          Target: <span style={{ color: 'rgba(255,255,255,0.6)' }}>{selectedName}</span>
        </div>
        <ActionBtn label={cmBusy ? '⏳ Matching colors...' : '🎨 Apply Color Match'} color="#3b8af7" onClick={handleColorMatch} disabled={cmBusy} />
        <StatusLine busy={cmBusy} result={cmResult} error={cmError} busyLabel="Analyzing color profiles..." />
      </Card>

      {/* ── Loudness Normalize ───────────────────────────────────────────────── */}
      <Card title="🔊 Loudness Normalize" color="#22c55e">
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
          Normalizes a clip's integrated loudness to a target LUFS. -16 LUFS for social, -23 LUFS for broadcast.
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {([-16, -19, -23] as const).map(l => (
            <button key={l} type="button" onClick={() => setNormLufs(l)}
              style={{ flex: 1, padding: '5px 0', fontSize: 11, borderRadius: 5, background: normLufs === l ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${normLufs === l ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.1)'}`, color: normLufs === l ? '#22c55e' : 'rgba(255,255,255,0.5)', cursor: 'pointer' }}>
              {l} LUFS
            </button>
          ))}
        </div>
        <ActionBtn label={normBusy ? '⏳ Normalizing...' : `🔊 Normalize to ${normLufs} LUFS`} color="#22c55e" onClick={handleNormalize} disabled={normBusy} />
        <StatusLine busy={normBusy} result={normResult} error={normError} busyLabel="Normalizing loudness..." />
      </Card>

      {/* ── Video Stabilization ──────────────────────────────────────────────── */}
      <Card title="📷 Video Stabilization" color="#f7c948">
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
          Smooths out shaky handheld footage. Uses vidstab (2-pass) when available, falls back to FFmpeg deshake.
        </div>
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>STRENGTH</span>
            <span style={{ fontSize: 10, color: '#f7c948' }}>{stabStr}/10</span>
          </div>
          <input type="range" min={1} max={10} value={stabStr} onChange={e => setStabStr(Number(e.target.value))} style={{ width: '100%', marginBottom: 8 }} />
        </div>
        <ActionBtn label={stabBusy ? '⏳ Stabilizing (2-pass)...' : '📷 Stabilize Footage'} color="#f7c948" onClick={handleStabilize} disabled={stabBusy} />
        <StatusLine busy={stabBusy} result={stabResult} error={stabError} busyLabel="Analyzing motion (this takes a while)..." />
      </Card>

      {/* ── Proxy Media ──────────────────────────────────────────────────────── */}
      <Card title="⚡ Generate Proxy" color="#ec4899">
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
          Creates a low-res proxy for smooth playback of 4K/6K/8K footage. Saves to a .264proxies folder next to the original.
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {(['540p', '720p', '1080p'] as const).map(r => (
            <button key={r} type="button" onClick={() => setProxyRes(r)}
              style={{ flex: 1, padding: '5px 0', fontSize: 11, borderRadius: 5, background: proxyRes === r ? 'rgba(236,72,153,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${proxyRes === r ? 'rgba(236,72,153,0.5)' : 'rgba(255,255,255,0.1)'}`, color: proxyRes === r ? '#ec4899' : 'rgba(255,255,255,0.5)', cursor: 'pointer' }}>
              {r}
            </button>
          ))}
        </div>
        {proxyBusy && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${proxyProgress}%`, background: '#ec4899', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}
        <ActionBtn label={proxyBusy ? `⏳ Generating ${proxyRes} proxy...` : `⚡ Generate ${proxyRes} Proxy`} color="#ec4899" onClick={handleProxy} disabled={proxyBusy} />
        <StatusLine busy={false} result={proxyResult} error={proxyError} />
      </Card>

      {/* ── Deinterlace ──────────────────────────────────────────────────────── */}
      <Card title="📺 Deinterlace" color="#94a3b8">
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
          Fixes interlaced footage (broadcast TV, old camcorders) using FFmpeg yadif. Eliminates comb artifacts.
        </div>
        <ActionBtn label={deintBusy ? '⏳ Deinterlacing...' : '📺 Deinterlace Clip'} color="#94a3b8" onClick={handleDeinterlace} disabled={deintBusy} />
        <StatusLine busy={deintBusy} result={deintResult} error={deintError} busyLabel="Deinterlacing..." />
      </Card>

      {/* ── Multicam Sync ────────────────────────────────────────────────────── */}
      <Card title="🎬 Multicam Auto-Sync" color="#06b6d4">
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
          Syncs all video clips on the timeline by audio onset. Works like a DaVinci sync bin — detects the first loud transient in each clip and aligns them.
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
          {project.sequence.clips.filter(c => {
            const t = project.sequence.tracks.find(t2 => t2.id === c.trackId);
            return t?.kind === 'video';
          }).length} video clips detected on timeline
        </div>
        <ActionBtn label={mcBusy ? '⏳ Analyzing audio...' : '🎬 Sync All Cameras'} color="#06b6d4" onClick={handleMulticamSync} disabled={mcBusy} />
        {mcResult && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, color: '#06b6d4', marginBottom: 4, fontWeight: 700 }}>Sync offsets (apply manually):</div>
            {mcResult.map(r => (
              <div key={r.id} style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', padding: '2px 0' }}>
                Clip {r.id.slice(0, 8)}: shift {r.offsetSeconds > 0 ? '+' : ''}{r.offsetSeconds.toFixed(3)}s
              </div>
            ))}
          </div>
        )}
        {mcError && <div style={{ marginTop: 6, fontSize: 11, color: '#ef4444' }}>⚠ {mcError}</div>}
      </Card>
    </div>
  );
}
