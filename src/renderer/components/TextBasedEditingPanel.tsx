import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Transcript, TranscriptWord, MediaAsset } from "../../shared/models";

interface TextBasedEditingPanelProps {
  assets: MediaAsset[];
  transcripts: Record<string, Transcript>;
  playheadFrame: number;
  sequenceFps: number;
  isPlaying: boolean;
  onSetTranscript: (assetId: string, transcript: Transcript) => void;
  onSetPlayheadFrame: (frame: number) => void;
  onAddClipToTimeline: (assetId: string, startMs: number, endMs: number) => void;
  onClose: () => void;
}

function parseSRT(srt: string, assetId: string): Transcript {
  const words: TranscriptWord[] = [];
  const blocks = srt.trim().split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    const timeLine = lines[1];
    const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!timeMatch) continue;
    const startMs = (parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3])) * 1000 + parseInt(timeMatch[4]);
    const endMs = (parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7])) * 1000 + parseInt(timeMatch[8]);
    const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, '').trim();
    const wordList = text.split(/\s+/);
    const dur = (endMs - startMs) / wordList.length;
    wordList.forEach((word, i) => {
      if (word) {
        words.push({ word, startMs: startMs + i * dur, endMs: startMs + (i + 1) * dur, confidence: 1, selected: false });
      }
    });
  }
  return { assetId, words, language: 'en', generatedAt: Date.now() };
}

function generateMockTranscript(assetId: string, assetName: string): Transcript {
  const demoText = `Welcome to 264 Pro. This is the most powerful video editor you have ever seen. Let us get started by importing your footage today. The text based editing panel allows you to edit your video by selecting words. Simply click and drag to select a range of words then use the controls below to add to timeline or delete that range. This makes editing dialogue sequences incredibly fast and precise.`;
  const words = demoText.split(/\s+/);
  const wordDuration = 600; // ms per word avg
  return {
    assetId,
    words: words.map((word, i) => ({
      word,
      startMs: i * wordDuration,
      endMs: (i + 1) * wordDuration,
      confidence: Math.random() * 0.3 + 0.7,
      selected: false,
    })),
    language: 'en',
    generatedAt: Date.now(),
  };
}

export function TextBasedEditingPanel({
  assets,
  transcripts,
  playheadFrame,
  sequenceFps,
  isPlaying,
  onSetTranscript,
  onSetPlayheadFrame,
  onAddClipToTimeline,
  onClose,
}: TextBasedEditingPanelProps) {
  const [selectedAssetId, setSelectedAssetId] = useState<string>(assets[0]?.id ?? '');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeWordRef = useRef<HTMLSpanElement>(null);

  const transcript = selectedAssetId ? transcripts[selectedAssetId] ?? null : null;
  const words = transcript?.words ?? [];

  // Current playhead time in ms
  const playheadMs = (playheadFrame / sequenceFps) * 1000;

  // Find word at playhead
  const activeWordIndex = useMemo(() => {
    if (!words.length) return -1;
    return words.findIndex(w => playheadMs >= w.startMs && playheadMs < w.endMs);
  }, [words, playheadMs]);

  // Auto-scroll active word into view during playback
  useEffect(() => {
    if (!isPlaying || activeWordIndex < 0) return;
    activeWordRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeWordIndex, isPlaying]);

  const handleTranscribe = async () => {
    if (!selectedAssetId) return;
    setIsTranscribing(true);
    try {
      const asset = assets.find(a => a.id === selectedAssetId);
      const api = (window as unknown as {
        electronAPI?: {
          transcribeAudio?: (args: { filePath: string; language?: string }) => Promise<{
            success: boolean;
            error?: string;
            transcript?: string;
            words?: Array<{ word: string; start: number; end: number }>;
            segments?: Array<{ startMs: number; endMs: number; text: string }>;
          }>;
        };
      }).electronAPI;

      if (api?.transcribeAudio && asset?.sourcePath) {
        const result = await api.transcribeAudio({ filePath: asset.sourcePath });
        if (result?.success && result.words && result.words.length > 0) {
          // Convert Groq word-level output (seconds) → TranscriptWord[] (ms)
          const words: TranscriptWord[] = result.words.map((w) => ({
            word: w.word.trim(),
            startMs: Math.round(w.start * 1000),
            endMs: Math.round(w.end * 1000),
            confidence: 1,
            selected: false,
          }));
          onSetTranscript(selectedAssetId, {
            assetId: selectedAssetId,
            words,
            language: 'en',
            generatedAt: Date.now(),
          });
        } else if (result?.success && result.transcript) {
          // Fallback: no per-word timestamps — treat whole text as one word entry
          onSetTranscript(selectedAssetId, {
            assetId: selectedAssetId,
            words: [{
              word: result.transcript,
              startMs: 0,
              endMs: Math.round((asset.durationSeconds ?? 5) * 1000),
              confidence: 1,
              selected: false,
            }],
            language: 'en',
            generatedAt: Date.now(),
          });
        } else if (result?.error) {
          console.error('Transcription error:', result.error);
          // Surface the error to the user via a toast-like alert
          alert(`Transcription failed: ${result.error}`);
        }
      } else {
        // No API available — fall back to mock transcript for development/demo
        const mock = generateMockTranscript(selectedAssetId, asset?.name ?? 'Asset');
        onSetTranscript(selectedAssetId, mock);
      }
    } catch (err) {
      console.error('Transcription exception:', err);
      alert(`Transcription error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleImportSRT = () => {
    const input = document.createElement('input');
    input.type = 'file';
    // Only accept .srt — VTT has a different format and parseSRT only handles SRT
    input.accept = '.srt';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file || !selectedAssetId) return;
      // BUG fix: guard against silently overwriting an existing AI transcript
      const existing = transcripts[selectedAssetId];
      if (existing && existing.words.length > 0) {
        if (!window.confirm('This will replace the existing transcript. Continue?')) return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const t = parseSRT(text, selectedAssetId);
        onSetTranscript(selectedAssetId, t);
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleWordMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    if (e.shiftKey) {
      // Shift-click: extend selection from existing anchor
      setSelectionEnd(index);
    } else {
      setSelectionStart(index);
      setSelectionEnd(index);
      setIsDragging(true);
    }
  }, []);

  const handleWordMouseEnter = useCallback((index: number) => {
    if (!isDragging) return;
    setSelectionEnd(index);
  }, [isDragging]);

  const handleWordClick = useCallback((word: TranscriptWord, e: React.MouseEvent) => {
    if (e.shiftKey) return; // Shift-click is handled by mouseDown — skip playhead jump
    // Jump playhead to word start on plain click
    const frame = Math.round((word.startMs / 1000) * sequenceFps);
    onSetPlayheadFrame(frame);
  }, [sequenceFps, onSetPlayheadFrame]);

  useEffect(() => {
    const onUp = () => setIsDragging(false);
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  const selectedRange = useMemo(() => {
    if (selectionStart === null || selectionEnd === null) return null;
    const start = Math.min(selectionStart, selectionEnd);
    const end = Math.max(selectionStart, selectionEnd);
    if (start === end && !isDragging) return null;
    const startMs = words[start]?.startMs ?? 0;
    const endMs = words[end]?.endMs ?? 0;
    return { start, end, startMs, endMs };
  }, [selectionStart, selectionEnd, words, isDragging]);

  function formatMs(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const ss = s % 60;
    const mss = Math.floor((ms % 1000) / 10);
    return `${m}:${ss.toString().padStart(2, '0')}.${mss.toString().padStart(2, '0')}`;
  }

  const handleAddToTimeline = () => {
    if (!selectedRange || !selectedAssetId) return;
    onAddClipToTimeline(selectedAssetId, selectedRange.startMs, selectedRange.endMs);
    setSelectionStart(null);
    setSelectionEnd(null);
  };

  const handleDeleteRange = () => {
    if (!selectedRange || !transcript) return;
    const newWords = words.filter((_, i) => i < selectedRange.start || i > selectedRange.end);
    onSetTranscript(selectedAssetId, { ...transcript, words: newWords });
    setSelectionStart(null);
    setSelectionEnd(null);
  };

  const videoAssets = assets.filter(a => a.durationSeconds > 0);

  return (
    <div style={{
      position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)',
      width: '700px', maxWidth: '90vw', background: '#0d1117',
      border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
      boxShadow: '0 24px 80px rgba(0,0,0,0.8)', zIndex: 1000,
      display: 'flex', flexDirection: 'column', maxHeight: '75vh', overflow: 'hidden',
      color: '#e2e8f0', fontSize: 13,
    }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 800 }}>📝 Text-Based Editing</span>
        <button
          onClick={onClose}
          style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16, padding: '2px 6px', borderRadius: 4 }}
          title="Close"
        >✕</button>
      </div>

      {/* Toolbar */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Asset:</span>
        <select
          value={selectedAssetId}
          onChange={e => { setSelectedAssetId(e.target.value); setSelectionStart(null); setSelectionEnd(null); }}
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#e2e8f0', fontSize: 12, padding: '4px 8px', cursor: 'pointer', flex: 1, maxWidth: 240 }}
        >
          <option value="">— select asset —</option>
          {videoAssets.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <button
          onClick={handleTranscribe}
          disabled={!selectedAssetId || isTranscribing}
          style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: isTranscribing ? '#374151' : '#7c3aed', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: !selectedAssetId ? 0.5 : 1 }}
        >
          {isTranscribing ? '⏳ Transcribing…' : '🤖 Transcribe'}
        </button>
        <button
          onClick={handleImportSRT}
          disabled={!selectedAssetId}
          style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#94a3b8', fontSize: 11, cursor: 'pointer', opacity: !selectedAssetId ? 0.5 : 1 }}
        >
          Import SRT
        </button>
      </div>

      {/* Transcript area */}
      <div
        ref={scrollContainerRef}
        style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', lineHeight: 2.0, userSelect: 'none' }}
      >
        {!selectedAssetId && (
          <div style={{ textAlign: 'center', color: '#374151', paddingTop: 40 }}>Select an asset to view transcript</div>
        )}
        {selectedAssetId && !transcript && (
          <div style={{ textAlign: 'center', color: '#374151', paddingTop: 40 }}>
            <div style={{ marginBottom: 8 }}>No transcript yet.</div>
            <div style={{ fontSize: 11 }}>Click "🤖 Transcribe" to generate or "Import SRT" to load a subtitle file.</div>
          </div>
        )}
        {words.length > 0 && (
          <p style={{ margin: 0, lineHeight: 2.2 }}>
            {words.map((word, i) => {
              const isActive = i === activeWordIndex;
              const isSelected = selectedRange && i >= selectedRange.start && i <= selectedRange.end;
              const isLowConf = word.confidence < 0.6;
              return (
                <span key={i}>
                  <span
                    ref={isActive ? activeWordRef : undefined}
                    onMouseDown={(e) => handleWordMouseDown(i, e)}
                    onMouseEnter={() => handleWordMouseEnter(i)}
                    onClick={(e) => handleWordClick(word, e)}
                    title={`${formatMs(word.startMs)} → ${formatMs(word.endMs)}${isLowConf ? ' (low confidence)' : ''}`}
                    style={{
                      padding: '1px 3px',
                      borderRadius: 3,
                      cursor: 'pointer',
                      background: isSelected
                        ? 'rgba(124,58,237,0.5)'
                        : isActive
                          ? 'rgba(250,204,21,0.25)'
                          : 'transparent',
                      color: isActive
                        ? '#fde68a'
                        : isLowConf
                          ? '#64748b'
                          : '#e2e8f0',
                      outline: isActive ? '1px solid rgba(250,204,21,0.4)' : 'none',
                      fontWeight: isActive ? 700 : 400,
                      transition: 'background 0.1s',
                    }}
                  >
                    {word.word}
                  </span>
                  {' '}
                </span>
              );
            })}
          </p>
        )}
      </div>

      {/* Selection controls */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: 'rgba(0,0,0,0.3)' }}>
        {selectedRange ? (
          <>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              Selected: <span style={{ color: '#c4b5fd', fontWeight: 600 }}>{formatMs(selectedRange.startMs)}</span>
              {' → '}
              <span style={{ color: '#c4b5fd', fontWeight: 600 }}>{formatMs(selectedRange.endMs)}</span>
              {' '}
              <span style={{ color: '#475569' }}>({selectedRange.end - selectedRange.start + 1} words)</span>
            </span>
            <span style={{ flex: 1 }} />
            <button
              onClick={handleAddToTimeline}
              style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
            >
              Add to Timeline
            </button>
            <button
              onClick={handleDeleteRange}
              style={{ padding: '5px 14px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.15)', color: '#fca5a5', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
            >
              Delete Range
            </button>
            <button
              onClick={() => { setSelectionStart(null); setSelectionEnd(null); }}
              style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: 'rgba(255,255,255,0.06)', color: '#64748b', fontSize: 11, cursor: 'pointer' }}
            >✕</button>
          </>
        ) : (
          <span style={{ fontSize: 11, color: '#475569' }}>
            {words.length > 0
              ? 'Click a word to jump playhead · Click and drag to select a range'
              : 'Transcript will appear here'}
          </span>
        )}
      </div>
    </div>
  );
}
