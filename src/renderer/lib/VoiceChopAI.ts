import {
  secondsToFrames,
  type TimelineSegment
} from "../../shared/timeline";

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

interface VoiceChopAIHandlers {
  acceptSuggestedCuts: () => void;
  beep: () => void;
  getActiveVideoClip: () => TimelineSegment | null;
  getBpm: () => number;
  getGridFrames: () => number;
  getMarks: () => {
    markInFrame: number | null;
    markOutFrame: number | null;
  };
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
  splitAtCurrentPlayhead: () => boolean;
}

interface PeakCandidate {
  energy: number;
  frame: number;
}

export class VoiceChopAI {
  private readonly handlers: VoiceChopAIHandlers;

  private recognition: SpeechRecognitionLike | null = null;

  constructor(handlers: VoiceChopAIHandlers) {
    this.handlers = handlers;
  }

  dispose(): void {
    this.recognition?.stop();
    this.recognition = null;
    this.handlers.setListening(false);
  }

  listenForCommands(): void {
    const Recognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;

    if (!Recognition) {
      this.handlers.setStatus(
        "Voice commands are unavailable in this runtime. Use Chromium speech support in Electron."
      );
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
      this.handlers.setStatus("Listening for edit commands.");
    };
    recognition.onend = () => {
      this.handlers.setListening(false);
      this.recognition = null;
      this.handlers.setStatus("Voice command listening stopped.");
    };
    recognition.onerror = (event) => {
      this.handlers.setListening(false);
      this.handlers.setStatus(
        `Voice recognition error${event.error ? `: ${event.error}` : "."}`
      );
    };
    recognition.onresult = (event) => {
      const transcripts = Array.from(event.results)
        .slice(event.resultIndex)
        .map((result) => result[0]?.transcript?.trim() ?? "")
        .filter(Boolean);

      if (!transcripts.length) {
        return;
      }

      this.handlers.setTranscript(transcripts.join(" "));

      Array.from(event.results)
        .slice(event.resultIndex)
        .forEach((result) => {
          if (!result.isFinal) {
            return;
          }

          const command = result[0]?.transcript?.trim();

          if (command) {
            this.processVoiceCommand(command);
          }
        });
    };

    this.recognition = recognition;
    recognition.start();
  }

  processVoiceCommand(command: string): void {
    const normalizedCommand = command.trim().toLowerCase();

    if (!normalizedCommand) {
      return;
    }

    this.handlers.setLastCommand(command);
    this.handlers.setTranscript(command);

    if (
      normalizedCommand.includes("cut here") ||
      normalizedCommand.includes("split clip")
    ) {
      const splitApplied = this.handlers.splitAtCurrentPlayhead();

      this.handlers.setStatus(
        splitApplied ? "Cut applied at the playhead." : "No video clip is under the playhead."
      );
      if (splitApplied) {
        this.handlers.beep();
      }
      return;
    }

    if (
      normalizedCommand.includes("mark start") ||
      normalizedCommand.includes("mark in")
    ) {
      const playheadFrame = this.handlers.getPlayheadFrame();
      const { markOutFrame } = this.handlers.getMarks();

      this.handlers.setMarks(playheadFrame, markOutFrame);
      this.handlers.setStatus("Mark in set from the current playhead.");
      return;
    }

    if (
      normalizedCommand.includes("mark end") ||
      normalizedCommand.includes("mark out")
    ) {
      const playheadFrame = this.handlers.getPlayheadFrame();
      const { markInFrame } = this.handlers.getMarks();

      this.handlers.setMarks(markInFrame, playheadFrame);
      this.handlers.setStatus("Mark out set from the current playhead.");
      return;
    }

    if (normalizedCommand.includes("quantize to beat")) {
      const bpm = this.handlers.getBpm();
      const sequenceFps = this.handlers.getSequenceFps();
      const beatGridFrames = Math.max(
        1,
        Math.round((60 / Math.max(1, bpm)) * sequenceFps)
      );

      this.quantizeCuts(beatGridFrames);
      return;
    }

    if (normalizedCommand.includes("quantize to grid")) {
      this.quantizeCuts(this.handlers.getGridFrames());
      return;
    }

    if (
      normalizedCommand.includes("accept cuts") ||
      normalizedCommand.includes("apply cuts")
    ) {
      this.handlers.acceptSuggestedCuts();
      this.handlers.setStatus("Applied the current AI cut suggestions.");
      this.handlers.beep();
      return;
    }

    if (
      normalizedCommand.includes("clear cuts") ||
      normalizedCommand.includes("clear suggestions")
    ) {
      this.handlers.setSuggestedCuts([]);
      this.handlers.setStatus("Cleared AI cut suggestions.");
      return;
    }

    if (
      normalizedCommand.includes("chop for me") ||
      normalizedCommand.includes("chop this") ||
      normalizedCommand.includes("analyze clip")
    ) {
      const targetClip =
        this.handlers.getSelectedVideoClip() ?? this.handlers.getActiveVideoClip();

      if (!targetClip) {
        this.handlers.setStatus(
          "Select a video clip or park the playhead on one before requesting AI chops."
        );
        return;
      }

      this.applyAICuts(targetClip);
      return;
    }

    this.handlers.setStatus(`Voice command not recognized: "${command}".`);
  }

  applyAICuts(videoClip: TimelineSegment): void {
    void this.analyzeAudioPeaks(videoClip);
  }

  quantizeCuts(grid: number): void {
    const suggestions = this.handlers.getSuggestedCuts();

    if (!suggestions.length) {
      this.handlers.setStatus("There are no suggested cuts to quantize yet.");
      return;
    }

    const normalizedGrid = Math.max(1, Math.round(grid));
    const { markInFrame, markOutFrame } = this.handlers.getMarks();
    const quantizedFrames = Array.from(
      new Set(
        suggestions.map((frame) => {
          const quantizedFrame =
            Math.round(frame / normalizedGrid) * normalizedGrid;

          if (markInFrame !== null && quantizedFrame < markInFrame) {
            return markInFrame;
          }

          if (markOutFrame !== null && quantizedFrame > markOutFrame) {
            return markOutFrame;
          }

          return quantizedFrame;
        })
      )
    ).sort((left, right) => left - right);

    this.handlers.setSuggestedCuts(quantizedFrames);
    this.handlers.setStatus(
      `Quantized ${quantizedFrames.length} cut suggestion${quantizedFrames.length === 1 ? "" : "s"} to a ${normalizedGrid}-frame grid.`
    );
  }

  setBpm(bpm: number): void {
    this.handlers.setStatus(`Beat grid updated to ${Math.max(1, Math.round(bpm))} BPM.`);
  }

  setGridFrames(gridFrames: number): void {
    this.handlers.setStatus(
      `Timeline quantize grid updated to ${Math.max(1, Math.round(gridFrames))} frame${gridFrames === 1 ? "" : "s"}.`
    );
  }

  private async analyzeAudioPeaks(videoClip: TimelineSegment): Promise<void> {
    this.handlers.setStatus(`Analyzing ${videoClip.asset.name} for beat and transient cuts...`);

    if (!videoClip.asset.hasAudio) {
      this.handlers.setSuggestedCuts([]);
      this.handlers.setStatus(
        "AI chop analysis needs embedded audio. This clip does not contain an audio stream."
      );
      return;
    }

    let audioContext: AudioContext | null = null;

    try {
      const response = await fetch(videoClip.asset.previewUrl);

      if (!response.ok) {
        throw new Error(`Unable to read preview media (${response.status}).`);
      }

      const arrayBuffer = await response.arrayBuffer();
      audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const channelData = audioBuffer.getChannelData(0);
      const windowSize = 2048;
      const hopSize = 1024;
      const { markInFrame, markOutFrame } = this.handlers.getMarks();
      const sourceStartTime = videoClip.sourceInSeconds;
      const sourceEndTime = videoClip.sourceOutSeconds;
      const peaks: PeakCandidate[] = [];

      let energyTotal = 0;
      let energyCount = 0;
      const energies: number[] = [];

      for (let sampleIndex = 0; sampleIndex + windowSize < channelData.length; sampleIndex += hopSize) {
        const timeSeconds = sampleIndex / audioBuffer.sampleRate;

        if (timeSeconds < sourceStartTime || timeSeconds > sourceEndTime) {
          continue;
        }

        let sumSquares = 0;

        for (let offset = 0; offset < windowSize; offset += 1) {
          const sample = channelData[sampleIndex + offset] ?? 0;
          sumSquares += sample * sample;
        }

        const energy = Math.sqrt(sumSquares / windowSize);

        energies.push(energy);
        energyTotal += energy;
        energyCount += 1;
      }

      if (!energyCount) {
        this.handlers.setSuggestedCuts([]);
        this.handlers.setStatus("No waveform data was available for AI chop analysis.");
        return;
      }

      const meanEnergy = energyTotal / energyCount;
      const variance =
        energies.reduce((total, energy) => total + (energy - meanEnergy) ** 2, 0) /
        energyCount;
      const threshold = meanEnergy + Math.sqrt(variance) * 1.2;
      const minSpacingFrames = Math.max(
        6,
        Math.round(this.handlers.getSequenceFps() * 0.2)
      );

      for (let index = 1; index < energies.length - 1; index += 1) {
        const energy = energies[index];

        if (
          energy < threshold ||
          energy < energies[index - 1] ||
          energy < energies[index + 1]
        ) {
          continue;
        }

        const timeSeconds =
          sourceStartTime + (index * hopSize) / audioBuffer.sampleRate;
        const relativeFrames = secondsToFrames(
          timeSeconds - sourceStartTime,
          this.handlers.getSequenceFps()
        );
        const cutFrame = videoClip.startFrame + relativeFrames;

        if (
          cutFrame <= videoClip.startFrame + 1 ||
          cutFrame >= videoClip.endFrame - 1
        ) {
          continue;
        }

        if (
          markInFrame !== null && cutFrame < markInFrame ||
          markOutFrame !== null && cutFrame > markOutFrame
        ) {
          continue;
        }

        const previousPeak = peaks[peaks.length - 1];

        if (previousPeak && cutFrame - previousPeak.frame < minSpacingFrames) {
          if (energy > previousPeak.energy) {
            previousPeak.energy = energy;
            previousPeak.frame = cutFrame;
          }
          continue;
        }

        peaks.push({
          energy,
          frame: cutFrame
        });
      }

      const suggestedCuts = peaks
        .sort((left, right) => right.energy - left.energy)
        .slice(0, 24)
        .map((peak) => peak.frame)
        .sort((left, right) => left - right);

      this.handlers.setSuggestedCuts(suggestedCuts);
      this.handlers.setStatus(
        suggestedCuts.length
          ? `AI found ${suggestedCuts.length} suggested cut point${suggestedCuts.length === 1 ? "" : "s"}. Review them in the timeline or say "accept cuts".`
          : "AI did not find strong beat or transient cut points in this range."
      );
    } catch (error) {
      this.handlers.setSuggestedCuts([]);
      this.handlers.setStatus(
        error instanceof Error
          ? `AI chop analysis failed: ${error.message}`
          : "AI chop analysis failed."
      );
    } finally {
      await audioContext?.close();
    }
  }
}
