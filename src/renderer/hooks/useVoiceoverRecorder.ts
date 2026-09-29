/**
 * Voiceover recording: captures the microphone with MediaRecorder while the
 * timeline plays, then saves it (as WAV, via the main process) and places it
 * on a free audio track at the frame where recording started.
 */
import { useCallback, useRef, useState } from "react";
import type { MediaAsset } from "../../shared/models";

export interface VoiceoverRecorder {
  recording: boolean;
  level: number;          // 0–1 input meter
  start: (startFrame: number) => Promise<void>;
  stop: () => Promise<{ asset: MediaAsset; startFrame: number } | null>;
}

export function useVoiceoverRecorder(): VoiceoverRecorder {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const state = useRef<{
    recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startFrame: number;
    ctx: AudioContext; raf: number;
  } | null>(null);

  const start = useCallback(async (startFrame: number) => {
    if (state.current) return;
    await window.editorApi?.requestMicAccess?.();
    const stream = await navigator.mediaDevices.getUserMedia({
      // Raw voice: no browser processing (it pumps and gates dialogue).
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 256000 } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    // Input meter
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      setLevel(peak);
      if (state.current) state.current.raf = requestAnimationFrame(tick);
    };
    recorder.start(250);
    state.current = { recorder, stream, chunks, startFrame, ctx, raf: requestAnimationFrame(tick) };
    setRecording(true);
  }, []);

  const stop = useCallback(async () => {
    const s = state.current;
    if (!s) return null;
    state.current = null;
    cancelAnimationFrame(s.raf);
    await new Promise<void>((resolve) => { s.recorder.onstop = () => resolve(); s.recorder.stop(); });
    s.stream.getTracks().forEach((t) => t.stop());
    void s.ctx.close();
    setRecording(false);
    setLevel(0);
    const blob = new Blob(s.chunks, { type: s.recorder.mimeType || "audio/webm" });
    if (!blob.size || !window.editorApi?.saveRecording) return null;
    const asset = await window.editorApi.saveRecording(new Uint8Array(await blob.arrayBuffer()), "Voiceover");
    return { asset, startFrame: s.startFrame };
  }, []);

  return { recording, level, start, stop };
}
