/**
 * TranscriptEditor — Descript-style text-based editing.
 * 
 * Transcribes the selected clip via Groq Whisper, displays editable word-level
 * transcript. Deleting words marks them for removal; "Apply Edits" computes
 * the corresponding frame ranges and calls onDeleteRanges to split+remove clips.
 * 
 * Also provides Scene Detection: auto-splits selected clip at scene cuts.
 */
import React, { useState, useCallback, useMemo } from 'react';

const API = (window as any).electronAPI;

interface Word {
  word: string;
  start: number; // seconds
  end: number;
  deleted?: boolean;
}

interface Props {
  clipId: string | null;
  clipPath: string | null;
  clipName: string;
  clipStartFrame: number;
  fps: number;
  /** Delete frame ranges from timeline (split + ripple remove) */
  onDeleteFrameRanges: (ranges: Array<{ startFrame: number; endFrame: number }>) => void;
  /** Split clip at these absolute timeline frames */
  onSplitAtFrames: (frames: number[]) => void;
  /** Add word-level caption clips to timeline as a Captions track */
  onAddCaptionTrack?: (words: Array<{ word: string; start: number; end: number }>, style: 'minimal' | 'bold' | 'outline') => void;
  onSeek: (frame: number) => void;
}

export function TranscriptEditor({ clipId, clipPath, clipName, clipStartFrame, fps, onDeleteFrameRanges, onSplitAtFrames, onAddCaptionTrack, onSeek }: Props) {
  const [mode, setMode] = useState<'transcript' | 'scenes'>('transcript');

  // ── Transcript state ───────────────────────────────────────────────────────
  const [words, setWords] = useState<Word[]>([]);
  const [transcriptBusy, setTranscriptBusy] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [transcriptDone, setTranscriptDone] = useState(false);
  const [language, setLanguage] = useState('en');
  const [captionStyle, setCaptionStyle] = useState<'minimal' | 'bold' | 'outline'>('bold');

  // ── Scene detection state ─────────────────────────────────────────────────
  const [scenes, setScenes] = useState<Array<{ timeSeconds: number; frame: number; score: number }>>([]);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [sceneThreshold, setSceneThreshold] = useState(0.3);

  const handleTranscribe = useCallback(async () => {
    if (!clipPath) { setTranscriptError('Select a clip first'); return; }
    setTranscriptBusy(true); setTranscriptError(null); setTranscriptDone(false);
    const res = await API?.transcribeClip?.({ filePath: clipPath, language });
    setTranscriptBusy(false);
    if (res?.success) {
      setWords((res.words ?? []).map((w: { word: string; start: number; end: number }) => ({ ...w, deleted: false })));
      setTranscriptDone(true);
    } else {
      setTranscriptError(res?.error ?? 'Transcription failed');
    }
  }, [clipPath, language]);

  const toggleWord = useCallback((idx: number) => {
    setWords(ws => ws.map((w, i) => i === idx ? { ...w, deleted: !w.deleted } : w));
  }, []);

  const deletedCount = useMemo(() => words.filter(w => w.deleted).length, [words]);

  const handleApplyEdits = useCallback(() => {
    if (!words.length) return;
    // Build contiguous deleted ranges (merge adjacent deleted words)
    const ranges: Array<{ startFrame: number; endFrame: number }> = [];
    let rangeStart: number | null = null;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w.deleted) {
        if (rangeStart === null) rangeStart = w.start;
      } else {
        if (rangeStart !== null) {
          const prevW = words[i - 1];
          ranges.push({
            startFrame: clipStartFrame + Math.round(rangeStart * fps),
            endFrame: clipStartFrame + Math.round(prevW.end * fps),
          });
          rangeStart = null;
        }
      }
    }
    // Handle trailing deleted range
    if (rangeStart !== null) {
      const lastW = words[words.length - 1];
      ranges.push({
        startFrame: clipStartFrame + Math.round(rangeStart * fps),
        endFrame: clipStartFrame + Math.round(lastW.end * fps),
      });
    }
    if (ranges.length > 0) onDeleteFrameRanges(ranges);
  }, [words, clipStartFrame, fps, onDeleteFrameRanges]);

  const handleDetectScenes = useCallback(async () => {
    if (!clipPath) { setSceneError('Select a clip first'); return; }
    setSceneBusy(true); setSceneError(null); setScenes([]);
    const res = await API?.detectScenes?.({ inputPath: clipPath, threshold: sceneThreshold, fps });
    setSceneBusy(false);
    if (res?.success) setScenes(res.scenes ?? []);
    else setSceneError(res?.error ?? 'Scene detection failed');
  }, [clipPath, sceneThreshold, fps]);

  const handleSplitAtScenes = useCallback(() => {
    if (!scenes.length) return;
    // Convert scene local frames to absolute timeline frames
    const absoluteFrames = scenes.map(s => clipStartFrame + s.frame);
    onSplitAtFrames(absoluteFrames);
  }, [scenes, clipStartFrame, onSplitAtFrames]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0d1117' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        {(['transcript', 'scenes'] as const).map(m => (
          <button key={m} type="button" onClick={() => setMode(m)}
            style={{ padding: '5px 14px', fontSize: 11, fontWeight: 700, background: mode === m ? 'rgba(167,139,250,0.15)' : 'transparent', border: '1px solid', borderColor: mode === m ? 'rgba(167,139,250,0.4)' : 'rgba(255,255,255,0.08)', borderRadius: m === 'transcript' ? '6px 0 0 6px' : '0 6px 6px 0', color: mode === m ? '#a78bfa' : 'rgba(255,255,255,0.4)', cursor: 'pointer', textTransform: 'capitalize' }}>
            {m === 'transcript' ? '📝 Transcript' : '🎬 Scenes'}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
          {clipName || 'No clip selected'}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>

        {/* ── TRANSCRIPT MODE ─────────────────────────────────────────────── */}
        {mode === 'transcript' && (
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 10, lineHeight: 1.5 }}>
              Transcribe your clip, then <strong style={{ color: '#a78bfa' }}>click words to mark for deletion</strong>. Hit Apply to cut those frames from the timeline.
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center' }}>
              <select value={language} onChange={e => setLanguage(e.target.value)}
                style={{ fontSize: 11, padding: '4px 6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: '#e0e0e0' }}>
                {[['en','English'],['es','Spanish'],['fr','French'],['de','German'],['ja','Japanese'],['pt','Portuguese'],['zh','Chinese'],['auto','Auto-detect']].map(([v,l]) =>
                  <option key={v} value={v}>{l}</option>
                )}
              </select>
              <button type="button" onClick={handleTranscribe} disabled={!clipPath || transcriptBusy}
                style={{ flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 700, borderRadius: 6, background: transcriptBusy ? 'rgba(167,139,250,0.08)' : 'rgba(167,139,250,0.2)', border: '1px solid rgba(167,139,250,0.4)', color: '#a78bfa', cursor: transcriptBusy ? 'wait' : 'pointer' }}>
                {transcriptBusy ? '⏳ Transcribing...' : transcriptDone ? '🔄 Re-transcribe' : '📝 Transcribe Clip'}
              </button>
            </div>

            {transcriptError && (
              <div style={{ padding: '6px 10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 5, fontSize: 11, color: '#ef4444', marginBottom: 8, overflowWrap: 'break-word', wordBreak: 'break-word' }}>
                ⚠ {transcriptError}
              </div>
            )}

            {words.length > 0 && (
              <>
                <div style={{ lineHeight: 1.8, fontSize: 13, marginBottom: 12, userSelect: 'none' }}>
                  {words.map((w, i) => (
                    <span key={i}
                      onClick={() => toggleWord(i)}
                      onMouseEnter={e => { (e.target as HTMLElement).style.outline = '1px solid rgba(167,139,250,0.5)'; }}
                      onMouseLeave={e => { (e.target as HTMLElement).style.outline = 'none'; }}
                      title={`${w.start.toFixed(2)}s → ${w.end.toFixed(2)}s — click to mark/unmark`}
                      style={{
                        display: 'inline-block',
                        padding: '1px 3px',
                        marginRight: 3,
                        borderRadius: 3,
                        cursor: 'pointer',
                        background: w.deleted ? 'rgba(239,68,68,0.25)' : 'transparent',
                        color: w.deleted ? '#ef4444' : 'rgba(255,255,255,0.85)',
                        textDecoration: w.deleted ? 'line-through' : 'none',
                        transition: 'background 0.1s',
                      }}
                    >
                      {w.word}
                    </span>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {deletedCount > 0 ? (
                    <button type="button" onClick={handleApplyEdits}
                      style={{ flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 700, borderRadius: 6, background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', cursor: 'pointer' }}>
                      ✂ Apply — Delete {deletedCount} word{deletedCount !== 1 ? 's' : ''} from timeline
                    </button>
                  ) : (
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', flex: 1, textAlign: 'center' }}>Click words to mark them for deletion</div>
                  )}
                  <button type="button" onClick={() => setWords(ws => ws.map(w => ({ ...w, deleted: false })))}
                    title="Clear all selections"
                    style={{ padding: '6px 10px', fontSize: 11, borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}>
                    Reset
                  </button>
                </div>

                {/* Add to timeline as captions track */}
                {onAddCaptionTrack && (
                  <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }}>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6 }}>ADD TO TIMELINE AS CAPTIONS TRACK</div>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                      {(['minimal', 'bold', 'outline'] as const).map(s => (
                        <button key={s} type="button" onClick={() => setCaptionStyle(s)}
                          style={{ flex: 1, padding: '4px 0', fontSize: 10, borderRadius: 4, background: captionStyle === s ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${captionStyle === s ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.1)'}`, color: captionStyle === s ? '#a78bfa' : 'rgba(255,255,255,0.4)', cursor: 'pointer', textTransform: 'capitalize' }}>
                          {s}
                        </button>
                      ))}
                    </div>
                    <button type="button" onClick={() => onAddCaptionTrack(words.filter(w => !w.deleted), captionStyle)}
                      style={{ width: '100%', padding: '6px 0', fontSize: 11, fontWeight: 700, borderRadius: 6, background: 'rgba(167,139,250,0.2)', border: '1px solid rgba(167,139,250,0.4)', color: '#a78bfa', cursor: 'pointer' }}>
                      ＋ Add Captions Track to Timeline
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                </div>
              </>
            )}

            {!transcriptDone && !transcriptBusy && !transcriptError && (
              <div style={{ textAlign: 'center', padding: '30px 0', color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>
                Select a clip and hit Transcribe to begin
              </div>
            )}
          </div>
        )}

        {/* ── SCENE DETECTION MODE ────────────────────────────────────────── */}
        {mode === 'scenes' && (
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 10, lineHeight: 1.5 }}>
              Detects scene cuts in your clip using frame difference analysis. Lower threshold = more cuts detected.
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>SENSITIVITY</span>
                <span style={{ fontSize: 10, color: '#34d399' }}>{sceneThreshold.toFixed(2)} {sceneThreshold < 0.2 ? '(very sensitive)' : sceneThreshold > 0.5 ? '(conservative)' : '(balanced)'}</span>
              </div>
              <input type="range" min={0.05} max={0.8} step={0.05} value={sceneThreshold} onChange={e => setSceneThreshold(Number(e.target.value))} style={{ width: '100%' }} />
            </div>

            <button type="button" onClick={handleDetectScenes} disabled={!clipPath || sceneBusy}
              style={{ width: '100%', padding: '7px 0', fontSize: 12, fontWeight: 700, borderRadius: 6, background: sceneBusy ? 'rgba(52,211,153,0.08)' : 'rgba(52,211,153,0.2)', border: '1px solid rgba(52,211,153,0.4)', color: '#34d399', cursor: sceneBusy ? 'wait' : 'pointer', marginBottom: 10 }}>
              {sceneBusy ? '⏳ Analyzing...' : '🎬 Detect Scene Changes'}
            </button>

            {sceneError && (
              <div style={{ padding: '6px 10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 5, fontSize: 11, color: '#ef4444', marginBottom: 8, overflowWrap: 'break-word', wordBreak: 'break-word' }}>
                ⚠ {sceneError}
              </div>
            )}

            {scenes.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: '#34d399', marginBottom: 8, fontWeight: 700 }}>
                  {scenes.length} scene cut{scenes.length !== 1 ? 's' : ''} detected
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12, maxHeight: 200, overflowY: 'auto' }}>
                  {scenes.map((s, i) => {
                    const mins = Math.floor(s.timeSeconds / 60);
                    const secs = (s.timeSeconds % 60).toFixed(2);
                    const absFrame = clipStartFrame + s.frame;
                    return (
                      <div key={i} onClick={() => onSeek(absFrame)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: 'rgba(52,211,153,0.06)', borderRadius: 5, cursor: 'pointer', border: '1px solid rgba(52,211,153,0.12)' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#34d399', width: 20, flexShrink: 0 }}>#{i + 1}</span>
                        <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.7)', flex: 1 }}>
                          {mins}:{String(secs).padStart(5, '0')}
                        </span>
                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
                          score {s.score.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <button type="button" onClick={handleSplitAtScenes}
                  style={{ width: '100%', padding: '7px 0', fontSize: 12, fontWeight: 700, borderRadius: 6, background: 'rgba(52,211,153,0.2)', border: '1px solid rgba(52,211,153,0.4)', color: '#34d399', cursor: 'pointer' }}>
                  ✂ Split Clip into {scenes.length + 1} Shots
                </button>
              </>
            )}

            {!sceneBusy && scenes.length === 0 && !sceneError && (
              <div style={{ textAlign: 'center', padding: '30px 0', color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>
                Select a clip and run detection
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
