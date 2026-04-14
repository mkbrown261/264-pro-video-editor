import { useState, useRef, useCallback, useEffect } from 'react';

export function useVoiceCommands(handlers: {
  splitAtPlayhead: () => void;
  undo: () => void;
  redo: () => void;
  normalizeAudio: () => void;
  autoColorMatch: () => void;
  closeGaps: () => void;
  applyWarm: () => void;
  applyCool: () => void;
  addMarker: () => void;
  setActivePage: (page: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [lastCommand, setLastCommand] = useState('');
  const recognitionRef = useRef<any>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processCommand = useCallback((text: string) => {
    const t = text.toLowerCase().trim();
    let matched = false;

    if (/split|cut here|cut this/.test(t)) { handlers.splitAtPlayhead(); matched = true; }
    else if (/undo|go back/.test(t)) { handlers.undo(); matched = true; }
    else if (/redo/.test(t)) { handlers.redo(); matched = true; }
    else if (/normalize|fix (the )?audio|level/.test(t)) { handlers.normalizeAudio(); matched = true; }
    else if (/color match|match (the )?color/.test(t)) { handlers.autoColorMatch(); matched = true; }
    else if (/close (the )?gap|remove (the )?gap/.test(t)) { handlers.closeGaps(); matched = true; }
    else if (/warm(er)?/.test(t)) { handlers.applyWarm(); matched = true; }
    else if (/cool(er)?/.test(t)) { handlers.applyCool(); matched = true; }
    else if (/marker|mark (this|here)/.test(t)) { handlers.addMarker(); matched = true; }
    else if (/export|publish/.test(t)) { handlers.setActivePage('publish'); matched = true; }
    else if (/color|grade/.test(t)) { handlers.setActivePage('color'); matched = true; }
    else if (/audio|sound|mix/.test(t)) { handlers.setActivePage('audio'); matched = true; }

    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setLastCommand(matched ? `✓ ${t}` : `❓ "${t}" — not recognized`);
    feedbackTimerRef.current = setTimeout(() => setLastCommand(''), 3000);
  }, [handlers]);

  const start = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setLastCommand('❌ Voice not supported in this browser'); return; }
    const r = new SR();
    r.continuous = false;
    r.interimResults = false;
    r.lang = 'en-US';
    r.onresult = (e: any) => processCommand(e.results[0][0].transcript);
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognitionRef.current = r;
    r.start();
    setListening(true);
  }, [processCommand]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  return { listening, lastCommand, start, stop };
}
