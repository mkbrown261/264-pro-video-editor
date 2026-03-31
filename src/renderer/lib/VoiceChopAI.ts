import {
  secondsToFrames,
  type TimelineSegment
} from "../../shared/timeline";

// ─── Speech Recognition types ─────────────────────────────────────────────────

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: ((event: Event) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onstart: ((event: Event) => void) | null;
  start: () => void;
  stop: () => void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

// ─── Handler interface ────────────────────────────────────────────────────────

export interface BpmDetectionResult {
  bpm: number;
  confidence: number;
  beatFrames: number[];
}

interface VoiceChopAIHandlers {
  acceptSuggestedCuts: () => void;
  beep: () => void;
  getActiveVideoClip: () => TimelineSegment | null;
  getBpm: () => number;
  getGridFrames: () => number;
  getMarks: () => { markInFrame: number | null; markOutFrame: number | null };
  getPlayheadFrame: () => number;
  getSelectedVideoClip: () => TimelineSegment | null;
  getSequenceFps: () => number;
  getSuggestedCuts: () => number[];
  setLastCommand: (command: string | null) => void;
  setListening: (isListening: boolean) => void;
  setMarks: (markInFrame: number | null, markOutFrame: number | null) => void;
  setStatus: (status: string) => void;
  setSuggestedCuts: (frames: number[]) => void;
  setTranscript: (transcript: string) => void;
  setDetectedBpm: (bpm: number) => void;
  setDetectedBeatFrames: (frames: number[]) => void;
  splitAtCurrentPlayhead: () => boolean;
}

interface PeakCandidate {
  energy: number;
  frame: number;
}

// ─── BPM Detection ────────────────────────────────────────────────────────────

/**
 * Detect BPM from audio data using autocorrelation + tempo induction.
 * Returns estimated BPM and beat grid frames.
 */
export async function detectBpm(
  audioData: Float32Array,
  sampleRate: number,
  clipStartFrame: number,
  sequenceFps: number
): Promise<BpmDetectionResult> {
  // Downsample to ~22kHz equivalent for speed
  const downsample = 2;
  const data = downsample > 1
    ? new Float32Array(Math.floor(audioData.length / downsample)).map(
        (_, i) => audioData[i * downsample]
      )
    : audioData;
  const sr = sampleRate / downsample;

  // 1. Compute onset strength envelope using spectral flux
  const frameSize = 512;
  const hopSize = 256;
  const numFrames = Math.floor((data.length - frameSize) / hopSize);
  const odf = new Float32Array(numFrames);

  let prevMag = new Float32Array(frameSize / 2);

  for (let f = 0; f < numFrames; f++) {
    const frame = data.slice(f * hopSize, f * hopSize + frameSize);
    // Simple RMS energy difference as onset function
    const rms = Math.sqrt(frame.reduce((s, v) => s + v * v, 0) / frameSize);
    const diff = Math.max(0, rms - (prevMag[0] ?? 0));
    odf[f] = diff;
    prevMag = new Float32Array([rms]);
  }

  // 2. Autocorrelation of ODF to find periodicity
  const minBpm = 60;
  const maxBpm = 200;
  const hopTime = hopSize / sr;
  const minLag = Math.round(60 / maxBpm / hopTime);
  const maxLag = Math.round(60 / minBpm / hopTime);

  let bestLag = minLag;
  let bestCorr = -Infinity;
  const corr = new Float32Array(maxLag - minLag + 1);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    for (let i = 0; i < odf.length - lag; i++) {
      c += (odf[i] ?? 0) * (odf[i + lag] ?? 0);
    }
    corr[lag - minLag] = c;
    if (c > bestCorr) { bestCorr = c; bestLag = lag; }
  }

  // Refine with half-tempo check
  const beatPeriodFrames = bestLag;
  const beatPeriodSeconds = beatPeriodFrames * hopTime;
  const bpm = Math.round(60 / beatPeriodSeconds);

  // 3. Generate beat grid frames
  const beatPeriodSamples = beatPeriodFrames * hopSize;
  const beatFrames: number[] = [];

  // Find first onset
  let firstOnset = 0;
  let maxOdf = 0;
  for (let i = 0; i < Math.min(odf.length, bestLag * 2); i++) {
    if ((odf[i] ?? 0) > maxOdf) { maxOdf = odf[i]; firstOnset = i; }
  }

  const firstBeatTime = firstOnset * hopTime;
  const clipDurationSeconds = data.length / sr;

  for (let beat = 0; firstBeatTime + beat * beatPeriodSeconds <= clipDurationSeconds; beat++) {
    const beatTime = firstBeatTime + beat * beatPeriodSeconds;
    const timelineFrame = clipStartFrame + secondsToFrames(beatTime, sequenceFps);
    beatFrames.push(timelineFrame);
  }

  const confidence = Math.min(1, bestCorr / (odf.reduce((s, v) => s + v, 0) * 0.1 + 1));

  return { bpm: Math.max(40, Math.min(240, bpm)), confidence, beatFrames };
}

// ─── VoiceChopAI class ────────────────────────────────────────────────────────

export class VoiceChopAI {
  private readonly handlers: VoiceChopAIHandlers;
  private recognition: SpeechRecognitionLike | null = null;
  private _bpm = 120;
  private _gridFrames = 12;

  constructor(handlers: VoiceChopAIHandlers) {
    this.handlers = handlers;
  }

  dispose(): void {
    this.recognition?.stop();
    this.recognition = null;
    this.handlers.setListening(false);
  }

  listenForCommands(): void {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;

    if (!Recognition) {
      this.handlers.setStatus("Voice commands unavailable. Use a Chromium-based runtime.");
      return;
    }

    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
      this.handlers.setListening(false);
      this.handlers.setStatus("Voice command listening stopped.");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onstart = () => {
      this.handlers.setListening(true);
      this.handlers.setStatus("Listening for edit commands…");
    };
    recognition.onend = () => {
      this.handlers.setListening(false);
      this.recognition = null;
      this.handlers.setStatus("Voice listening stopped.");
    };
    recognition.onerror = (e) => {
      this.handlers.setListening(false);
      this.handlers.setStatus(`Voice error${e.error ? `: ${e.error}` : "."}`);
    };
    recognition.onresult = (e) => {
      const transcripts = Array.from(e.results)
        .slice(e.resultIndex)
        .map((r) => r[0]?.transcript?.trim() ?? "")
        .filter(Boolean);
      if (transcripts.length) this.handlers.setTranscript(transcripts.join(" "));

      Array.from(e.results)
        .slice(e.resultIndex)
        .forEach((r) => {
          if (r.isFinal && r[0]?.transcript?.trim()) {
            this.processVoiceCommand(r[0].transcript.trim());
          }
        });
    };

    this.recognition = recognition;
    recognition.start();
  }

  processVoiceCommand(command: string): void {
    const cmd = command.trim().toLowerCase();
    if (!cmd) return;

    this.handlers.setLastCommand(command);
    this.handlers.setTranscript(command);

    if (cmd.includes("cut here") || cmd.includes("split clip")) {
      const ok = this.handlers.splitAtCurrentPlayhead();
      this.handlers.setStatus(ok ? "Cut applied at playhead." : "No video clip under playhead.");
      if (ok) this.handlers.beep();
      return;
    }

    if (cmd.includes("mark start") || cmd.includes("mark in")) {
      const f = this.handlers.getPlayheadFrame();
      this.handlers.setMarks(f, this.handlers.getMarks().markOutFrame);
      this.handlers.setStatus("Mark In set.");
      return;
    }

    if (cmd.includes("mark end") || cmd.includes("mark out")) {
      const f = this.handlers.getPlayheadFrame();
      this.handlers.setMarks(this.handlers.getMarks().markInFrame, f);
      this.handlers.setStatus("Mark Out set.");
      return;
    }

    if (cmd.includes("quantize to beat")) {
      const bpm = this.handlers.getBpm();
      const fps = this.handlers.getSequenceFps();
      const grid = Math.max(1, Math.round((60 / Math.max(1, bpm)) * fps));
      this.quantizeCuts(grid);
      return;
    }

    if (cmd.includes("quantize to grid")) {
      this.quantizeCuts(this.handlers.getGridFrames());
      return;
    }

    if (cmd.includes("accept cuts") || cmd.includes("apply cuts")) {
      this.handlers.acceptSuggestedCuts();
      this.handlers.setStatus("Applied AI cut suggestions.");
      this.handlers.beep();
      return;
    }

    if (cmd.includes("clear cuts") || cmd.includes("clear suggestions")) {
      this.handlers.setSuggestedCuts([]);
      this.handlers.setStatus("Cleared AI cut suggestions.");
      return;
    }

    if (cmd.includes("chop for me") || cmd.includes("chop this") || cmd.includes("analyze clip")) {
      const target = this.handlers.getSelectedVideoClip() ?? this.handlers.getActiveVideoClip();
      if (!target) {
        this.handlers.setStatus("Select a video clip first.");
        return;
      }
      this.applyAICuts(target);
      return;
    }

    if (cmd.includes("detect bpm") || cmd.includes("find bpm") || cmd.includes("analyze beat")) {
      const target = this.handlers.getSelectedVideoClip() ?? this.handlers.getActiveVideoClip();
      if (!target) {
        this.handlers.setStatus("Select a video clip for BPM detection.");
        return;
      }
      void this.detectAndApplyBpm(target);
      return;
    }

    if (cmd.includes("sync to beat") || cmd.includes("beat sync")) {
      const target = this.handlers.getSelectedVideoClip() ?? this.handlers.getActiveVideoClip();
      if (!target) {
        this.handlers.setStatus("Select a video clip first.");
        return;
      }
      void this.beatSyncEdit(target, "everyBeat");
      return;
    }

    this.handlers.setStatus(`Command not recognized: "${command}"`);
  }

  applyAICuts(videoClip: TimelineSegment): void {
    void this.analyzeAudioPeaks(videoClip);
  }

  quantizeCuts(grid: number): void {
    const suggestions = this.handlers.getSuggestedCuts();
    if (!suggestions.length) {
      this.handlers.setStatus("No suggested cuts to quantize yet.");
      return;
    }
    const g = Math.max(1, Math.round(grid));
    const { markInFrame, markOutFrame } = this.handlers.getMarks();
    const quantized = Array.from(new Set(
      suggestions.map((f) => {
        let qf = Math.round(f / g) * g;
        if (markInFrame !== null && qf < markInFrame) qf = markInFrame;
        if (markOutFrame !== null && qf > markOutFrame) qf = markOutFrame;
        return qf;
      })
    )).sort((a, b) => a - b);

    this.handlers.setSuggestedCuts(quantized);
    this.handlers.setStatus(`Quantized ${quantized.length} cuts to ${g}-frame grid.`);
  }

  setBpm(bpm: number): void {
    this._bpm = Math.max(40, Math.min(240, bpm));
    this.handlers.setStatus(`BPM updated to ${this._bpm}.`);
  }

  setGridFrames(frames: number): void {
    this._gridFrames = Math.max(1, Math.round(frames));
    this.handlers.setStatus(`Grid updated to ${this._gridFrames} frames.`);
  }

  // ── BPM detection ────────────────────────────────────────────────────────

  async detectAndApplyBpm(videoClip: TimelineSegment): Promise<void> {
    if (!videoClip.asset.hasAudio) {
      this.handlers.setStatus("BPM detection requires embedded audio.");
      return;
    }

    this.handlers.setStatus(`Detecting BPM in ${videoClip.asset.name}…`);
    let audioContext: AudioContext | null = null;

    try {
      const response = await fetch(videoClip.asset.previewUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const channelData = audioBuffer.getChannelData(0);

      const result = await detectBpm(
        channelData,
        audioBuffer.sampleRate,
        videoClip.startFrame,
        this.handlers.getSequenceFps()
      );

      this.handlers.setDetectedBpm(result.bpm);
      this.handlers.setDetectedBeatFrames(result.beatFrames);
      this._bpm = result.bpm;

      const confidence = Math.round(result.confidence * 100);
      this.handlers.setStatus(
        `Detected ${result.bpm} BPM (${confidence}% confidence). ${result.beatFrames.length} beats found.`
      );
    } catch (err) {
      this.handlers.setStatus(
        err instanceof Error ? `BPM detection failed: ${err.message}` : "BPM detection failed."
      );
    } finally {
      await audioContext?.close();
    }
  }

  // ── Beat-sync editing ─────────────────────────────────────────────────────

  async beatSyncEdit(
    videoClip: TimelineSegment,
    mode: "everyBeat" | "every2" | "every4"
  ): Promise<void> {
    if (!videoClip.asset.hasAudio) {
      this.handlers.setStatus("Beat sync requires audio in the clip.");
      return;
    }

    this.handlers.setStatus("Analyzing beat structure for sync…");
    let audioContext: AudioContext | null = null;

    try {
      const response = await fetch(videoClip.asset.previewUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const channelData = audioBuffer.getChannelData(0);

      const result = await detectBpm(
        channelData,
        audioBuffer.sampleRate,
        videoClip.startFrame,
        this.handlers.getSequenceFps()
      );

      this._bpm = result.bpm;
      this.handlers.setDetectedBpm(result.bpm);

      // Filter beats by mode
      const beatFrames = result.beatFrames.filter((_, idx) => {
        if (mode === "every2") return idx % 2 === 0;
        if (mode === "every4") return idx % 4 === 0;
        return true;
      });

      // Apply marks if set
      const { markInFrame, markOutFrame } = this.handlers.getMarks();
      const filtered = beatFrames.filter((f) => {
        if (markInFrame !== null && f < markInFrame) return false;
        if (markOutFrame !== null && f > markOutFrame) return false;
        if (f <= videoClip.startFrame + 1 || f >= videoClip.endFrame - 1) return false;
        return true;
      });

      this.handlers.setSuggestedCuts(filtered);
      this.handlers.setStatus(
        `Beat sync: ${result.bpm} BPM, ${filtered.length} cut points. Say "apply cuts" to commit.`
      );
    } catch (err) {
      this.handlers.setStatus(
        err instanceof Error ? `Beat sync failed: ${err.message}` : "Beat sync failed."
      );
    } finally {
      await audioContext?.close();
    }
  }

  // ── Audio peak analysis ───────────────────────────────────────────────────

  private async analyzeAudioPeaks(videoClip: TimelineSegment): Promise<void> {
    this.handlers.setStatus(`Analyzing ${videoClip.asset.name} for transients…`);

    if (!videoClip.asset.hasAudio) {
      this.handlers.setSuggestedCuts([]);
      this.handlers.setStatus("AI chop needs embedded audio. This clip has none.");
      return;
    }

    let audioContext: AudioContext | null = null;

    try {
      const response = await fetch(videoClip.asset.previewUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const channelData = audioBuffer.getChannelData(0);
      const windowSize = 2048;
      const hopSize = 1024;
      const { markInFrame, markOutFrame } = this.handlers.getMarks();
      const sourceStart = videoClip.sourceInSeconds;
      const sourceEnd = videoClip.sourceOutSeconds;
      const peaks: PeakCandidate[] = [];
      const energies: number[] = [];

      for (let idx = 0; idx + windowSize < channelData.length; idx += hopSize) {
        const t = idx / audioBuffer.sampleRate;
        if (t < sourceStart || t > sourceEnd) continue;
        let ss = 0;
        for (let o = 0; o < windowSize; o++) ss += (channelData[idx + o] ?? 0) ** 2;
        energies.push(Math.sqrt(ss / windowSize));
      }

      if (!energies.length) {
        this.handlers.setSuggestedCuts([]);
        this.handlers.setStatus("No waveform data found for analysis.");
        return;
      }

      const mean = energies.reduce((s, e) => s + e, 0) / energies.length;
      const variance = energies.reduce((s, e) => s + (e - mean) ** 2, 0) / energies.length;
      const threshold = mean + Math.sqrt(variance) * 1.2;
      const minSpacing = Math.max(6, Math.round(this.handlers.getSequenceFps() * 0.2));

      let energyIdx = 0;
      for (let idx = 0; idx + windowSize < channelData.length; idx += hopSize) {
        const t = idx / audioBuffer.sampleRate;
        if (t < sourceStart || t > sourceEnd) continue;
        const e = energies[energyIdx] ?? 0;
        const ep = energies[energyIdx - 1] ?? 0;
        const en = energies[energyIdx + 1] ?? 0;
        energyIdx++;

        if (e < threshold || e < ep || e < en) continue;

        const relSec = t - sourceStart;
        const cutFrame = videoClip.startFrame + secondsToFrames(relSec, this.handlers.getSequenceFps());
        if (cutFrame <= videoClip.startFrame + 1 || cutFrame >= videoClip.endFrame - 1) continue;
        if (markInFrame !== null && cutFrame < markInFrame) continue;
        if (markOutFrame !== null && cutFrame > markOutFrame) continue;

        const prev = peaks[peaks.length - 1];
        if (prev && cutFrame - prev.frame < minSpacing) {
          if (e > prev.energy) { prev.energy = e; prev.frame = cutFrame; }
          continue;
        }

        peaks.push({ energy: e, frame: cutFrame });
      }

      const cuts = peaks
        .sort((a, b) => b.energy - a.energy)
        .slice(0, 24)
        .map((p) => p.frame)
        .sort((a, b) => a - b);

      this.handlers.setSuggestedCuts(cuts);
      this.handlers.setStatus(
        cuts.length
          ? `Found ${cuts.length} transient cut point${cuts.length === 1 ? "" : "s"}. Review or say "apply cuts".`
          : "No strong transients found in this range."
      );
    } catch (err) {
      this.handlers.setSuggestedCuts([]);
      this.handlers.setStatus(
        err instanceof Error ? `Analysis failed: ${err.message}` : "Analysis failed."
      );
    } finally {
      await audioContext?.close();
    }
  }
}
