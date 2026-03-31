import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { InspectorPanel } from "./components/InspectorPanel";
import { MediaPool } from "./components/MediaPool";
import { TimelinePanel } from "./components/TimelinePanel";
import {
  ViewerPanel,
  type ViewerPanelHandle
} from "./components/ViewerPanel";
import { ColorGradingPanel } from "./components/ColorGradingPanel";
import { useEditorShortcuts } from "./hooks/useEditorShortcuts";
import { VoiceChopAI } from "./lib/VoiceChopAI";
import { useEditorStore } from "./store/editorStore";
import {
  buildTimelineSegments,
  buildTrackLayouts,
  findPlayableSegmentAtFrame,
  type TimelineSegment,
  getTotalDurationFrames
} from "../shared/timeline";
import type { UpdaterStatus } from "./vite-env";
import type { ClipMask } from "../shared/models";
import type { MaskTool } from "./components/MaskingCanvas";

type AppPage = "edit" | "color" | "effects";

export default function App() {
  const viewerPanelRef = useRef<ViewerPanelHandle | null>(null);

  // ── Store ──────────────────────────────────────────────────────────────────
  const project = useEditorStore((s) => s.project);
  const selectedAssetId = useEditorStore((s) => s.selectedAssetId);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const toolMode = useEditorStore((s) => s.toolMode);
  const environment = useEditorStore((s) => s.environment);
  const playback = useEditorStore((s) => s.playback);

  const importAssets = useEditorStore((s) => s.importAssets);
  const appendAssetToTimeline = useEditorStore((s) => s.appendAssetToTimeline);
  const dropAssetAtFrame = useEditorStore((s) => s.dropAssetAtFrame);
  const selectAsset = useEditorStore((s) => s.selectAsset);
  const selectClip = useEditorStore((s) => s.selectClip);
  const moveClipTo = useEditorStore((s) => s.moveClipTo);
  const trimClipStart = useEditorStore((s) => s.trimClipStart);
  const trimClipEnd = useEditorStore((s) => s.trimClipEnd);
  const splitSelectedClipAtPlayhead = useEditorStore((s) => s.splitSelectedClipAtPlayhead);
  const splitClipAtFrame = useEditorStore((s) => s.splitClipAtFrame);
  const removeSelectedClip = useEditorStore((s) => s.removeSelectedClip);
  const toggleClipEnabled = useEditorStore((s) => s.toggleClipEnabled);
  const detachLinkedClips = useEditorStore((s) => s.detachLinkedClips);
  const applyTransitionToSelectedClip = useEditorStore((s) => s.applyTransitionToSelectedClip);
  const setSelectedClipTransitionDuration = useEditorStore((s) => s.setSelectedClipTransitionDuration);
  const setSelectedClipTransitionType = useEditorStore((s) => s.setSelectedClipTransitionType);
  const extractAudioFromSelectedClip = useEditorStore((s) => s.extractAudioFromSelectedClip);
  const setPlayheadFrame = useEditorStore((s) => s.setPlayheadFrame);
  const nudgePlayhead = useEditorStore((s) => s.nudgePlayhead);
  const setPlaybackPlaying = useEditorStore((s) => s.setPlaybackPlaying);
  const stopPlayback = useEditorStore((s) => s.stopPlayback);
  const setToolMode = useEditorStore((s) => s.setToolMode);
  const toggleBladeTool = useEditorStore((s) => s.toggleBladeTool);
  const setEnvironment = useEditorStore((s) => s.setEnvironment);
  const setClipVolume = useEditorStore((s) => s.setClipVolume);
  const setClipSpeed = useEditorStore((s) => s.setClipSpeed);

  // Masks
  const addMaskToClip = useEditorStore((s) => s.addMaskToClip);
  const updateMask = useEditorStore((s) => s.updateMask);
  const removeMask = useEditorStore((s) => s.removeMask);
  const reorderMasks = useEditorStore((s) => s.reorderMasks);

  // Effects
  const addEffectToClip = useEditorStore((s) => s.addEffectToClip);
  const updateEffect = useEditorStore((s) => s.updateEffect);
  const removeEffect = useEditorStore((s) => s.removeEffect);
  const toggleEffect = useEditorStore((s) => s.toggleEffect);
  const reorderEffects = useEditorStore((s) => s.reorderEffects);
  const toggleBackgroundRemoval = useEditorStore((s) => s.toggleBackgroundRemoval);
  const setBackgroundRemoval = useEditorStore((s) => s.setBackgroundRemoval);

  // Color
  const enableColorGrade = useEditorStore((s) => s.enableColorGrade);
  const setColorGrade = useEditorStore((s) => s.setColorGrade);
  const resetColorGrade = useEditorStore((s) => s.resetColorGrade);

  // ── Local UI state ─────────────────────────────────────────────────────────
  const [activePage, setActivePage] = useState<AppPage>("edit");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [transitionMessage, setTransitionMessage] = useState<string | null>(null);
  const [bridgeReady, setBridgeReady] = useState(
    typeof window !== "undefined" && Boolean(window.editorApi)
  );
  const appShellRef = useRef<HTMLElement | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(280);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [resizeSide, setResizeSide] = useState<"left" | "right" | null>(null);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus | null>(null);
  const [updaterDismissed, setUpdaterDismissed] = useState(false);

  // Masking state
  const [activeMaskTool, setActiveMaskTool] = useState<MaskTool>("none");
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);

  // Voice Chop AI
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Voice Chop AI ready.");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceLastCommand, setVoiceLastCommand] = useState<string | null>(null);
  const [voiceSuggestedCutFrames, setVoiceSuggestedCutFrames] = useState<number[]>([]);
  const [voiceMarkInFrame, setVoiceMarkInFrame] = useState<number | null>(null);
  const [voiceMarkOutFrame, setVoiceMarkOutFrame] = useState<number | null>(null);
  const [voiceBpm, setVoiceBpm] = useState(120);
  const [voiceGridFrames, setVoiceGridFrames] = useState(12);
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null);
  const [detectedBeatFrames, setDetectedBeatFrames] = useState<number[]>([]);

  const voiceStateRef = useRef({
    bpm: 120, gridFrames: 12,
    markInFrame: null as number | null,
    markOutFrame: null as number | null,
    suggestedCutFrames: [] as number[]
  });
  const timelineStateRef = useRef<{
    activeSegment: TimelineSegment | null;
    inspectorSegment: TimelineSegment | null;
    playheadFrame: number;
    segments: TimelineSegment[];
    sequenceFps: number;
  }>({ activeSegment: null, inspectorSegment: null, playheadFrame: 0, segments: [], sequenceFps: 30 });
  const voiceChopRef = useRef<VoiceChopAI | null>(null);

  // ── Derived state ──────────────────────────────────────────────────────────
  const segments = buildTimelineSegments(project.sequence, project.assets);
  const trackLayouts = buildTrackLayouts(project.sequence, project.assets);
  const totalFrames = getTotalDurationFrames(segments);
  const activeSegment = findPlayableSegmentAtFrame(segments, playback.playheadFrame, "video");
  const activeAudioSegment = findPlayableSegmentAtFrame(segments, playback.playheadFrame, "audio");
  const selectedSegment = segments.find((s) => s.clip.id === selectedClipId) ?? null;
  const inspectorSegment =
    selectedSegment?.track.kind === "audio" && selectedSegment.clip.linkedGroupId
      ? segments.find(
          (s) => s.clip.linkedGroupId === selectedSegment.clip.linkedGroupId && s.track.kind === "video"
        ) ?? selectedSegment
      : selectedSegment;
  const selectedAsset =
    project.assets.find((a) => a.id === selectedAssetId) ?? inspectorSegment?.asset ?? null;

  // ── Keep refs in sync ──────────────────────────────────────────────────────
  useEffect(() => {
    timelineStateRef.current = {
      activeSegment,
      inspectorSegment,
      playheadFrame: playback.playheadFrame,
      segments,
      sequenceFps: project.sequence.settings.fps
    };
  });

  useEffect(() => {
    voiceStateRef.current = {
      bpm: voiceBpm,
      gridFrames: voiceGridFrames,
      markInFrame: voiceMarkInFrame,
      markOutFrame: voiceMarkOutFrame,
      suggestedCutFrames: voiceSuggestedCutFrames
    };
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function pauseViewerPlayback() {
    viewerPanelRef.current?.pausePlayback();
    stopPlayback();
  }

  function getCurrentVideoSegmentAtFrame(frame: number): TimelineSegment | null {
    const s = useEditorStore.getState();
    const segs = buildTimelineSegments(s.project.sequence, s.project.assets);
    return (
      findPlayableSegmentAtFrame(segs, frame, "video") ??
      segs.find((seg) => seg.track.kind === "video" && frame >= seg.startFrame && frame < seg.endFrame) ??
      null
    );
  }

  function splitVideoAtFrame(frame: number): boolean {
    const target = getCurrentVideoSegmentAtFrame(frame);
    if (!target) return false;
    pauseViewerPlayback();
    splitClipAtFrame(target.clip.id, frame);
    return true;
  }

  function playFeedbackBeep() {
    const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 880;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => void ctx.close();
  }

  function handleTogglePlayback() {
    if (!viewerPanelRef.current || !totalFrames) return;
    void viewerPanelRef.current.togglePlayback();
  }

  function handleSeek(frame: number) {
    pauseViewerPlayback();
    setPlayheadFrame(frame);
  }

  function handleStepFrames(delta: number) {
    pauseViewerPlayback();
    nudgePlayhead(delta);
  }

  // Mask callbacks
  const handleAddMask = useCallback((mask: ClipMask) => {
    if (!selectedClipId) return;
    addMaskToClip(selectedClipId, mask);
  }, [selectedClipId, addMaskToClip]);

  const handleUpdateMask = useCallback((maskId: string, updates: Partial<ClipMask>) => {
    if (!selectedClipId) return;
    updateMask(selectedClipId, maskId, updates);
  }, [selectedClipId, updateMask]);

  // ── Shortcuts ──────────────────────────────────────────────────────────────
  useEditorShortcuts({
    sequenceFps: project.sequence.settings.fps,
    onTogglePlayback: handleTogglePlayback,
    onToggleFullscreen: () => void viewerPanelRef.current?.toggleFullscreen(),
    onSelectTool: () => setToolMode("select"),
    onToggleBladeTool: toggleBladeTool,
    onSplitSelectedClip: splitSelectedClipAtPlayhead,
    onNudgePlayhead: handleStepFrames,
    onSeekToStart: () => handleSeek(0),
    onSeekToEnd: () => handleSeek(Math.max(totalFrames - 1, 0)),
    onRemoveSelectedClip: () => { pauseViewerPlayback(); removeSelectedClip(); }
  });

  // ── VoiceChopAI init ───────────────────────────────────────────────────────
  useEffect(() => {
    const voiceChop = new VoiceChopAI({
      acceptSuggestedCuts: () => {
        const frames = [...voiceStateRef.current.suggestedCutFrames].sort((a, b) => b - a);
        pauseViewerPlayback();
        frames.forEach((f) => splitVideoAtFrame(f));
        setVoiceSuggestedCutFrames([]);
      },
      beep: playFeedbackBeep,
      getActiveVideoClip: () => timelineStateRef.current.activeSegment,
      getBpm: () => voiceStateRef.current.bpm,
      getGridFrames: () => voiceStateRef.current.gridFrames,
      getMarks: () => ({ markInFrame: voiceStateRef.current.markInFrame, markOutFrame: voiceStateRef.current.markOutFrame }),
      getPlayheadFrame: () => timelineStateRef.current.playheadFrame,
      getSelectedVideoClip: () => {
        const seg = timelineStateRef.current.inspectorSegment;
        return seg?.track.kind === "video" ? seg : null;
      },
      getSequenceFps: () => timelineStateRef.current.sequenceFps,
      getSuggestedCuts: () => voiceStateRef.current.suggestedCutFrames,
      setLastCommand: setVoiceLastCommand,
      setListening: setVoiceListening,
      setMarks: (mi, mo) => { setVoiceMarkInFrame(mi); setVoiceMarkOutFrame(mo); },
      setStatus: setVoiceStatus,
      setSuggestedCuts: setVoiceSuggestedCutFrames,
      setTranscript: setVoiceTranscript,
      setDetectedBpm: (bpm) => { setDetectedBpm(bpm); setVoiceBpm(bpm); },
      setDetectedBeatFrames: setDetectedBeatFrames,
      splitAtCurrentPlayhead: () => splitVideoAtFrame(timelineStateRef.current.playheadFrame)
    });

    voiceChopRef.current = voiceChop;
    return () => { voiceChop.dispose(); voiceChopRef.current = null; };
  }, []);

  // ── Updater + bridge ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!window.editorApi) { setBridgeReady(false); return; }
    setBridgeReady(true);
    let cancelled = false;

    void window.editorApi.getEnvironmentStatus()
      .then((status) => { if (!cancelled) setEnvironment(status); })
      .catch((err) => { if (!cancelled) setExportMessage(err instanceof Error ? err.message : "Environment error."); });

    const unsub = window.editorApi.onUpdaterStatus((status) => {
      setUpdaterStatus(status);
      if (status.state === "available" || status.state === "ready") setUpdaterDismissed(false);
    });

    return () => { cancelled = true; unsub(); };
  }, [setEnvironment]);

  // ── Panel resize ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!resizeSide) return;
    const onMove = (e: MouseEvent) => {
      const bounds = appShellRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const min = 220, max = 520, minCenter = 480;
      if (resizeSide === "left") {
        const proposed = e.clientX - bounds.left;
        setLeftPanelWidth(Math.min(max, Math.max(min, Math.min(proposed, bounds.width - rightPanelWidth - minCenter))));
      } else {
        const proposed = bounds.right - e.clientX;
        setRightPanelWidth(Math.min(max, Math.max(min, Math.min(proposed, bounds.width - leftPanelWidth - minCenter))));
      }
    };
    const onUp = () => setResizeSide(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [resizeSide, leftPanelWidth, rightPanelWidth]);

  // ── Derived grid frames from fps ───────────────────────────────────────────
  useEffect(() => {
    setVoiceGridFrames((g) => g > 0 ? g : Math.max(1, Math.round(project.sequence.settings.fps / 2)));
  }, [project.sequence.settings.fps]);

  useEffect(() => { setTransitionMessage(null); }, [selectedClipId]);

  // ── Import/Export ──────────────────────────────────────────────────────────
  async function handleImport() {
    if (!window.editorApi) { setBridgeReady(false); setExportMessage("Import unavailable — restart Electron."); return; }
    setExportMessage(null);
    try {
      const assets = await window.editorApi.openMediaFiles();
      if (assets.length) importAssets(assets);
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Import failed.");
    }
  }

  async function handleExport() {
    if (!window.editorApi) { setBridgeReady(false); setExportMessage("Export unavailable."); return; }
    setExportMessage(null);
    if (!segments.length) { setExportMessage("Add clips before exporting."); return; }
    try {
      const outputPath = await window.editorApi.chooseExportFile(`${project.sequence.name}.mp4`);
      if (!outputPath) return;
      setExportBusy(true);
      const result = await window.editorApi.exportSequence({ outputPath, project });
      setExportMessage(`✓ Rendered to ${result.outputPath}`);
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Render failed.");
    } finally {
      setExportBusy(false);
    }
  }

  // ── Updater banner ─────────────────────────────────────────────────────────
  const showUpdaterBanner = !updaterDismissed && updaterStatus !== null &&
    updaterStatus.state !== "checking" && updaterStatus.state !== "up-to-date";

  function renderUpdaterBanner() {
    if (!showUpdaterBanner || !updaterStatus) return null;
    const { state, version, percent, message } = updaterStatus;
    let text = "";
    let cls = "updater-banner";
    let canDismiss = false;

    if (state === "available") { text = `Update v${version ?? ""} ready to download.`; cls += " info"; canDismiss = true; }
    else if (state === "downloading") { text = `Downloading… ${percent ?? 0}%`; cls += " info"; }
    else if (state === "ready") { text = `v${version ?? ""} downloaded — installs on quit.`; cls += " success"; canDismiss = true; }
    else if (state === "error") { text = `Update error: ${message ?? "unknown"}`; cls += " error"; canDismiss = true; }

    return (
      <div className={cls}>
        <span>{text}</span>
        {canDismiss && (
          <button className="updater-banner__dismiss" onClick={() => setUpdaterDismissed(true)} type="button">✕</button>
        )}
      </div>
    );
  }

  const shellStyle = {
    "--left-panel-width": `${leftPanelWidth}px`,
    "--right-panel-width": `${rightPanelWidth}px`
  } as CSSProperties;

  // ── Page content ───────────────────────────────────────────────────────────
  return (
    <div className="app-root">
      {renderUpdaterBanner()}

      {/* ── TOP MENU BAR ── */}
      <header className="app-menubar">
        <div className="menubar-brand">
          <span className="brand-logo">264</span>
          <span className="brand-name">Pro</span>
        </div>

        {/* Page tabs */}
        <nav className="page-tabs">
          {(["edit", "color", "effects"] as const).map((page) => (
            <button
              key={page}
              className={`page-tab${activePage === page ? " active" : ""}`}
              onClick={() => setActivePage(page)}
              type="button"
            >
              {page.charAt(0).toUpperCase() + page.slice(1)}
            </button>
          ))}
        </nav>

        <div className="menubar-status">
          <span className={`bridge-dot${bridgeReady ? " ready" : ""}`} title={bridgeReady ? "Electron bridge ready" : "No bridge"} />
          <span className="status-item">{project.assets.length} assets</span>
          <span className="status-sep">·</span>
          <span className="status-item">{project.sequence.clips.length} clips</span>
          <span className="status-sep">·</span>
          <span className="status-item">{project.sequence.settings.width}×{project.sequence.settings.height} / {project.sequence.settings.fps}fps</span>
        </div>
      </header>

      {/* ── MAIN WORKSPACE ── */}
      <main ref={appShellRef} className={`app-shell page-${activePage}`} style={shellStyle}>

        {/* ── EDIT PAGE ── */}
        {activePage === "edit" && (
          <>
            <MediaPool
              assets={project.assets}
              selectedAssetId={selectedAssetId}
              selectedSegment={inspectorSegment}
              transitionMessage={transitionMessage}
              onImport={handleImport}
              onSelectAsset={selectAsset}
              onAppendAsset={appendAssetToTimeline}
              onApplyTransition={(edge) => {
                pauseViewerPlayback();
                setTransitionMessage(applyTransitionToSelectedClip(edge));
              }}
            />

            <div
              className="panel-resizer left-resizer"
              onMouseDown={(e) => { e.preventDefault(); setResizeSide("left"); }}
              role="separator"
            />

            <ViewerPanel
              ref={viewerPanelRef}
              activeSegment={activeSegment}
              activeAudioSegment={activeAudioSegment}
              segments={segments}
              selectedAsset={selectedAsset}
              playheadFrame={playback.playheadFrame}
              totalFrames={totalFrames}
              sequenceFps={project.sequence.settings.fps}
              isPlaying={playback.isPlaying}
              toolMode={toolMode}
              activeMaskTool={activeMaskTool}
              selectedMaskId={selectedMaskId}
              onAddMask={handleAddMask}
              onUpdateMask={handleUpdateMask}
              onSelectMask={setSelectedMaskId}
              onSetPlaybackPlaying={setPlaybackPlaying}
              onSetToolMode={setToolMode}
              onToggleBladeTool={toggleBladeTool}
              onSplitAtPlayhead={splitSelectedClipAtPlayhead}
              onSetPlayheadFrame={setPlayheadFrame}
              onStepFrames={handleStepFrames}
            />

            <div
              className="panel-resizer right-resizer"
              onMouseDown={(e) => { e.preventDefault(); setResizeSide("right"); }}
              role="separator"
            />

            <InspectorPanel
              selectedAsset={selectedAsset}
              selectedSegment={inspectorSegment}
              environment={environment}
              exportBusy={exportBusy}
              exportMessage={exportMessage}
              clipMessage={transitionMessage}
              sequenceSettings={project.sequence.settings}
              voiceListening={voiceListening}
              voiceStatus={voiceStatus}
              voiceTranscript={voiceTranscript}
              voiceLastCommand={voiceLastCommand}
              voiceSuggestedCutFrames={voiceSuggestedCutFrames}
              voiceMarkInFrame={voiceMarkInFrame}
              voiceMarkOutFrame={voiceMarkOutFrame}
              voiceBpm={voiceBpm}
              voiceGridFrames={voiceGridFrames}
              detectedBpm={detectedBpm}
              detectedBeatFrames={detectedBeatFrames}
              activeMaskTool={activeMaskTool}
              selectedMaskId={selectedMaskId}
              onSetActiveMaskTool={setActiveMaskTool}
              onSelectMask={setSelectedMaskId}
              onAddMask={handleAddMask}
              onUpdateMask={handleUpdateMask}
              onRemoveMask={(maskId) => { if (selectedClipId) removeMask(selectedClipId, maskId); }}
              onAddEffect={(effect) => { if (selectedClipId) addEffectToClip(selectedClipId, effect); }}
              onUpdateEffect={(effectId, updates) => { if (selectedClipId) updateEffect(selectedClipId, effectId, updates); }}
              onRemoveEffect={(effectId) => { if (selectedClipId) removeEffect(selectedClipId, effectId); }}
              onToggleEffect={(effectId) => { if (selectedClipId) toggleEffect(selectedClipId, effectId); }}
              onReorderEffects={(from, to) => { if (selectedClipId) reorderEffects(selectedClipId, from, to); }}
              onToggleBackgroundRemoval={() => { if (selectedClipId) toggleBackgroundRemoval(selectedClipId); }}
              onSetBackgroundRemoval={(config) => { if (selectedClipId) setBackgroundRemoval(selectedClipId, config); }}
              onToggleClipEnabled={(clipId) => { pauseViewerPlayback(); toggleClipEnabled(clipId); }}
              onDetachLinkedClips={(clipId) => { pauseViewerPlayback(); detachLinkedClips(clipId); }}
              onSetTransitionType={(edge, type) => {
                pauseViewerPlayback();
                setTransitionMessage(setSelectedClipTransitionType(edge, type));
              }}
              onSetTransitionDuration={(edge, dur) => {
                pauseViewerPlayback();
                setTransitionMessage(setSelectedClipTransitionDuration(edge, dur));
              }}
              onExtractAudio={() => { pauseViewerPlayback(); setTransitionMessage(extractAudioFromSelectedClip()); }}
              onRippleDelete={() => { pauseViewerPlayback(); removeSelectedClip(); }}
              onSetClipVolume={(vol) => { if (selectedClipId) setClipVolume(selectedClipId, vol); }}
              onSetClipSpeed={(spd) => { if (selectedClipId) setClipSpeed(selectedClipId, spd); }}
              onToggleVoiceListening={() => voiceChopRef.current?.listenForCommands()}
              onAnalyzeVoiceChops={() => {
                const target = (inspectorSegment?.track.kind === "video" ? inspectorSegment : null) ?? activeSegment;
                if (!target) { setVoiceStatus("Select or park playhead on a video clip."); return; }
                voiceChopRef.current?.applyAICuts(target);
              }}
              onDetectBpm={() => {
                const target = (inspectorSegment?.track.kind === "video" ? inspectorSegment : null) ?? activeSegment;
                if (!target) { setVoiceStatus("Select a video clip for BPM detection."); return; }
                void voiceChopRef.current?.detectAndApplyBpm(target);
              }}
              onBeatSync={(mode) => {
                const target = (inspectorSegment?.track.kind === "video" ? inspectorSegment : null) ?? activeSegment;
                if (!target) { setVoiceStatus("Select a video clip for beat sync."); return; }
                void voiceChopRef.current?.beatSyncEdit(target, mode);
              }}
              onAcceptVoiceCuts={() => voiceChopRef.current?.processVoiceCommand("accept cuts")}
              onClearVoiceCuts={() => { setVoiceSuggestedCutFrames([]); setVoiceStatus("Cleared AI cuts."); }}
              onQuantizeVoiceCutsToBeat={() => voiceChopRef.current?.processVoiceCommand("quantize to beat")}
              onQuantizeVoiceCutsToGrid={() => voiceChopRef.current?.processVoiceCommand("quantize to grid")}
              onSetVoiceBpm={(bpm) => { const v = Math.max(40, Math.min(240, Math.round(bpm))); setVoiceBpm(v); voiceChopRef.current?.setBpm(v); }}
              onSetVoiceGridFrames={(g) => { const v = Math.max(1, Math.round(g)); setVoiceGridFrames(v); voiceChopRef.current?.setGridFrames(v); }}
              onExport={handleExport}
            />

            {/* Timeline */}
            <TimelinePanel
              trackLayouts={trackLayouts}
              selectedClipId={selectedClipId}
              toolMode={toolMode}
              playheadFrame={playback.playheadFrame}
              suggestedCutFrames={voiceSuggestedCutFrames}
              markInFrame={voiceMarkInFrame}
              markOutFrame={voiceMarkOutFrame}
              totalFrames={totalFrames}
              sequenceFps={project.sequence.settings.fps}
              onSetPlayheadFrame={handleSeek}
              onSelectClip={selectClip}
              onMoveClipTo={(clipId, trackId, frame) => { pauseViewerPlayback(); moveClipTo(clipId, trackId, frame); }}
              onTrimClipStart={(clipId, trim) => { pauseViewerPlayback(); trimClipStart(clipId, trim); }}
              onTrimClipEnd={(clipId, trim) => { pauseViewerPlayback(); trimClipEnd(clipId, trim); }}
              onBladeCut={(clipId, frame) => { pauseViewerPlayback(); splitClipAtFrame(clipId, frame); }}
              onDropAsset={(assetId, trackId, frame) => { pauseViewerPlayback(); dropAssetAtFrame(assetId, trackId, frame); }}
            />
          </>
        )}

        {/* ── COLOR PAGE ── */}
        {activePage === "color" && (
          <div className="color-page">
            {/* Left: Mini viewer */}
            <div className="color-page-viewer">
              <ViewerPanel
                ref={viewerPanelRef}
                activeSegment={activeSegment}
                activeAudioSegment={activeAudioSegment}
                segments={segments}
                selectedAsset={selectedAsset}
                playheadFrame={playback.playheadFrame}
                totalFrames={totalFrames}
                sequenceFps={project.sequence.settings.fps}
                isPlaying={playback.isPlaying}
                toolMode={toolMode}
                activeMaskTool="none"
                selectedMaskId={null}
                onAddMask={() => {}}
                onUpdateMask={() => {}}
                onSelectMask={() => {}}
                onSetPlaybackPlaying={setPlaybackPlaying}
                onSetToolMode={setToolMode}
                onToggleBladeTool={toggleBladeTool}
                onSplitAtPlayhead={splitSelectedClipAtPlayhead}
                onSetPlayheadFrame={setPlayheadFrame}
                onStepFrames={handleStepFrames}
              />
            </div>

            {/* Center: Color grading panel */}
            <div className="color-page-grading">
              <ColorGradingPanel
                selectedSegment={inspectorSegment}
                colorGrade={inspectorSegment?.clip.colorGrade ?? null}
                videoRef={{ current: viewerPanelRef.current?.getVideoRef() ?? null }}
                onEnableGrade={() => { if (selectedClipId) enableColorGrade(selectedClipId); }}
                onUpdateGrade={(grade) => { if (selectedClipId) setColorGrade(selectedClipId, grade); }}
                onResetGrade={() => { if (selectedClipId) resetColorGrade(selectedClipId); }}
              />
            </div>

            {/* Bottom: Timeline */}
            <div className="color-page-timeline">
              <TimelinePanel
                trackLayouts={trackLayouts}
                selectedClipId={selectedClipId}
                toolMode={toolMode}
                playheadFrame={playback.playheadFrame}
                suggestedCutFrames={[]}
                markInFrame={null}
                markOutFrame={null}
                totalFrames={totalFrames}
                sequenceFps={project.sequence.settings.fps}
                onSetPlayheadFrame={handleSeek}
                onSelectClip={selectClip}
                onMoveClipTo={(clipId, trackId, frame) => moveClipTo(clipId, trackId, frame)}
                onTrimClipStart={trimClipStart}
                onTrimClipEnd={trimClipEnd}
                onBladeCut={splitClipAtFrame}
                onDropAsset={dropAssetAtFrame}
              />
            </div>
          </div>
        )}

        {/* ── EFFECTS PAGE ── */}
        {activePage === "effects" && (
          <div className="effects-page">
            <div className="effects-page-viewer">
              <ViewerPanel
                ref={viewerPanelRef}
                activeSegment={activeSegment}
                activeAudioSegment={activeAudioSegment}
                segments={segments}
                selectedAsset={selectedAsset}
                playheadFrame={playback.playheadFrame}
                totalFrames={totalFrames}
                sequenceFps={project.sequence.settings.fps}
                isPlaying={playback.isPlaying}
                toolMode={toolMode}
                activeMaskTool={activeMaskTool}
                selectedMaskId={selectedMaskId}
                onAddMask={handleAddMask}
                onUpdateMask={handleUpdateMask}
                onSelectMask={setSelectedMaskId}
                onSetPlaybackPlaying={setPlaybackPlaying}
                onSetToolMode={setToolMode}
                onToggleBladeTool={toggleBladeTool}
                onSplitAtPlayhead={splitSelectedClipAtPlayhead}
                onSetPlayheadFrame={setPlayheadFrame}
                onStepFrames={handleStepFrames}
              />
            </div>
            <div className="effects-page-panel">
              <InspectorPanel
                selectedAsset={selectedAsset}
                selectedSegment={inspectorSegment}
                environment={environment}
                exportBusy={exportBusy}
                exportMessage={exportMessage}
                clipMessage={transitionMessage}
                sequenceSettings={project.sequence.settings}
                voiceListening={voiceListening}
                voiceStatus={voiceStatus}
                voiceTranscript={voiceTranscript}
                voiceLastCommand={voiceLastCommand}
                voiceSuggestedCutFrames={voiceSuggestedCutFrames}
                voiceMarkInFrame={voiceMarkInFrame}
                voiceMarkOutFrame={voiceMarkOutFrame}
                voiceBpm={voiceBpm}
                voiceGridFrames={voiceGridFrames}
                detectedBpm={detectedBpm}
                detectedBeatFrames={detectedBeatFrames}
                activeMaskTool={activeMaskTool}
                selectedMaskId={selectedMaskId}
                onSetActiveMaskTool={setActiveMaskTool}
                onSelectMask={setSelectedMaskId}
                onAddMask={handleAddMask}
                onUpdateMask={handleUpdateMask}
                onRemoveMask={(maskId) => { if (selectedClipId) removeMask(selectedClipId, maskId); }}
                onAddEffect={(effect) => { if (selectedClipId) addEffectToClip(selectedClipId, effect); }}
                onUpdateEffect={(effectId, updates) => { if (selectedClipId) updateEffect(selectedClipId, effectId, updates); }}
                onRemoveEffect={(effectId) => { if (selectedClipId) removeEffect(selectedClipId, effectId); }}
                onToggleEffect={(effectId) => { if (selectedClipId) toggleEffect(selectedClipId, effectId); }}
                onReorderEffects={(from, to) => { if (selectedClipId) reorderEffects(selectedClipId, from, to); }}
                onToggleBackgroundRemoval={() => { if (selectedClipId) toggleBackgroundRemoval(selectedClipId); }}
                onSetBackgroundRemoval={(config) => { if (selectedClipId) setBackgroundRemoval(selectedClipId, config); }}
                onToggleClipEnabled={(clipId) => { pauseViewerPlayback(); toggleClipEnabled(clipId); }}
                onDetachLinkedClips={(clipId) => { pauseViewerPlayback(); detachLinkedClips(clipId); }}
                onSetTransitionType={(edge, type) => {
                  pauseViewerPlayback();
                  setTransitionMessage(setSelectedClipTransitionType(edge, type));
                }}
                onSetTransitionDuration={(edge, dur) => {
                  pauseViewerPlayback();
                  setTransitionMessage(setSelectedClipTransitionDuration(edge, dur));
                }}
                onExtractAudio={() => { pauseViewerPlayback(); setTransitionMessage(extractAudioFromSelectedClip()); }}
                onRippleDelete={() => { pauseViewerPlayback(); removeSelectedClip(); }}
                onSetClipVolume={(vol) => { if (selectedClipId) setClipVolume(selectedClipId, vol); }}
                onSetClipSpeed={(spd) => { if (selectedClipId) setClipSpeed(selectedClipId, spd); }}
                onToggleVoiceListening={() => voiceChopRef.current?.listenForCommands()}
                onAnalyzeVoiceChops={() => {
                  const target = (inspectorSegment?.track.kind === "video" ? inspectorSegment : null) ?? activeSegment;
                  if (target) voiceChopRef.current?.applyAICuts(target);
                }}
                onDetectBpm={() => {
                  const target = (inspectorSegment?.track.kind === "video" ? inspectorSegment : null) ?? activeSegment;
                  if (target) void voiceChopRef.current?.detectAndApplyBpm(target);
                }}
                onBeatSync={(mode) => {
                  const target = (inspectorSegment?.track.kind === "video" ? inspectorSegment : null) ?? activeSegment;
                  if (target) void voiceChopRef.current?.beatSyncEdit(target, mode);
                }}
                onAcceptVoiceCuts={() => voiceChopRef.current?.processVoiceCommand("accept cuts")}
                onClearVoiceCuts={() => { setVoiceSuggestedCutFrames([]); }}
                onQuantizeVoiceCutsToBeat={() => voiceChopRef.current?.processVoiceCommand("quantize to beat")}
                onQuantizeVoiceCutsToGrid={() => voiceChopRef.current?.processVoiceCommand("quantize to grid")}
                onSetVoiceBpm={(bpm) => { const v = Math.max(40, Math.min(240, Math.round(bpm))); setVoiceBpm(v); voiceChopRef.current?.setBpm(v); }}
                onSetVoiceGridFrames={(g) => { const v = Math.max(1, Math.round(g)); setVoiceGridFrames(v); voiceChopRef.current?.setGridFrames(v); }}
                onExport={handleExport}
              />
            </div>
            <div className="effects-page-timeline">
              <TimelinePanel
                trackLayouts={trackLayouts}
                selectedClipId={selectedClipId}
                toolMode={toolMode}
                playheadFrame={playback.playheadFrame}
                suggestedCutFrames={[]}
                markInFrame={null}
                markOutFrame={null}
                totalFrames={totalFrames}
                sequenceFps={project.sequence.settings.fps}
                onSetPlayheadFrame={handleSeek}
                onSelectClip={selectClip}
                onMoveClipTo={(clipId, trackId, frame) => moveClipTo(clipId, trackId, frame)}
                onTrimClipStart={trimClipStart}
                onTrimClipEnd={trimClipEnd}
                onBladeCut={splitClipAtFrame}
                onDropAsset={dropAssetAtFrame}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
