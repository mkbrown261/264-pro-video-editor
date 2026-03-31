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
import { useWaveformExtractor } from "./hooks/useWaveformExtractor";
import { VoiceChopAI } from "./lib/VoiceChopAI";
import { useEditorStore } from "./store/editorStore";
import {
  buildTimelineSegments,
  buildTrackLayouts,
  findPlayableSegmentAtFrame,
  type TimelineSegment,
  getTotalDurationFrames
} from "../shared/timeline";
import { serializeProject, deserializeProject } from "../shared/projectSerializer";
import type { UpdaterStatus } from "./vite-env";
import type { ClipMask } from "../shared/models";
import { createEmptyProject } from "../shared/models";
import type { MaskTool } from "./components/MaskingCanvas";

type AppPage = "edit" | "color" | "effects";

interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
}

export default function App() {
  const viewerPanelRef = useRef<ViewerPanelHandle | null>(null);
  // Stable video ref passed to ColorGradingPanel — must never be re-created
  const colorPageVideoRef = useRef<HTMLVideoElement | null>(null);

  // ── Store ──────────────────────────────────────────────────────────────────
  const project = useEditorStore((s) => s.project);
  const selectedAssetId = useEditorStore((s) => s.selectedAssetId);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const toolMode = useEditorStore((s) => s.toolMode);
  const environment = useEditorStore((s) => s.environment);
  const playback = useEditorStore((s) => s.playback);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);

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
  const removeClipById = useEditorStore((s) => s.removeClipById);
  const duplicateClip = useEditorStore((s) => s.duplicateClip);
  const toggleClipEnabled = useEditorStore((s) => s.toggleClipEnabled);
  const detachLinkedClips = useEditorStore((s) => s.detachLinkedClips);
  const relinkClips = useEditorStore((s) => s.relinkClips);
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
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const loadProjectFromData = useEditorStore((s) => s.loadProjectFromData);
  const updateTrack = useEditorStore((s) => s.updateTrack);
  const addTrack = useEditorStore((s) => s.addTrack);
  const removeTrack = useEditorStore((s) => s.removeTrack);
  const duplicateTrack = useEditorStore((s) => s.duplicateTrack);
  const addTracksAndMoveClip = useEditorStore((s) => s.addTracksAndMoveClip);
  const addMarker = useEditorStore((s) => s.addMarker);
  const setAssetWaveform = useEditorStore((s) => s.setAssetWaveform);

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
  // Timeline zoom controls — populated by TimelinePanel via onRegisterZoomControls
  const timelineZoomRef = useRef<{ zoomIn: () => void; zoomOut: () => void; fitToWindow: () => void } | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(280);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [resizeSide, setResizeSide] = useState<"left" | "right" | null>(null);
  const [timelineHeight, setTimelineHeight] = useState(220);
  const [isResizingTimeline, setIsResizingTimeline] = useState(false);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus | null>(null);
  const [updaterDismissed, setUpdaterDismissed] = useState(false);
  // ── Toast notifications ────────────────────────────────────────────────────
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(msg: string) {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 3500);
  }

  // ── Save Confirmation Modal ────────────────────────────────────────────────
  type SaveConfirmAction = "new" | "open" | "close";
  const [saveConfirm, setSaveConfirm] = useState<{ action: SaveConfirmAction } | null>(null);
  const pendingActionRef = useRef<SaveConfirmAction | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<ProjectSettings>({
    width: project.sequence.settings.width,
    height: project.sequence.settings.height,
    fps: project.sequence.settings.fps,
    aspectRatio: "16:9"
  });

  // Project file path (for Save vs Save As)
  const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
  const [projectDirty, setProjectDirty] = useState(false);
  const createdAtRef = useRef<string>(new Date().toISOString());

  // Open Recent
  const [recentProjects, setRecentProjects] = useState<Array<{ name: string; path: string; date: string }>>(() => {
    try { return JSON.parse(localStorage.getItem("264pro_recent_projects") ?? "[]"); }
    catch { return []; }
  });
  const [showRecentPanel, setShowRecentPanel] = useState(false);

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
  // Build segments once and reuse — avoids double-build (buildTrackLayouts would rebuild internally)
  const segments = buildTimelineSegments(project.sequence, project.assets);
  const trackLayouts = buildTrackLayouts(project.sequence, project.assets, segments);
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

  // Mark project as dirty on any change (but not on first mount)
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) { isFirstMount.current = false; return; }
    setProjectDirty(true);
  }, [project]);

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

  // Sync colorPageVideoRef with the ViewerPanel's video element on every render
  useEffect(() => {
    colorPageVideoRef.current = viewerPanelRef.current?.getVideoRef() ?? null;
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

  // ── Project Save / Load ────────────────────────────────────────────────────

  async function handleSaveProject() {
    if (!window.editorApi) {
      // Fallback: save to localStorage
      try {
        const json = serializeProject(project, createdAtRef.current);
        localStorage.setItem("264pro_project_v2", json);
        setExportMessage("✓ Project saved to local storage.");
        setProjectDirty(false);
      } catch {
        setExportMessage("Failed to save project.");
      }
      return;
    }

    try {
      if (currentProjectPath) {
        await window.editorApi.saveProjectAs(
          serializeProject(project, createdAtRef.current),
          currentProjectPath
        );
        setExportMessage(`✓ Saved to ${currentProjectPath}`);
        addToRecentProjects(project.name, currentProjectPath);
      } else {
        const json = serializeProject(project, createdAtRef.current);
        const saved = await window.editorApi.saveProject(json, project.name);
        if (saved) {
          setCurrentProjectPath(saved);
          setExportMessage(`✓ Saved to ${saved}`);
          addToRecentProjects(project.name, saved);
        }
      }
      setProjectDirty(false);
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Save failed.");
    }
  }

  async function handleSaveProjectAs() {
    if (!window.editorApi) { setExportMessage("Save requires Electron."); return; }
    try {
      const json = serializeProject(project, createdAtRef.current);
      const saved = await window.editorApi.saveProject(json, project.name);
      if (saved) {
        setCurrentProjectPath(saved);
        setProjectDirty(false);
        addToRecentProjects(project.name, saved);
        setExportMessage(`✓ Saved as ${saved}`);
      }
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Save failed.");
    }
  }

  function addToRecentProjects(name: string, path: string) {
    const entry = { name, path, date: new Date().toLocaleDateString() };
    setRecentProjects((prev) => {
      const filtered = prev.filter((r) => r.path !== path).slice(0, 9);
      const next = [entry, ...filtered];
      try { localStorage.setItem("264pro_recent_projects", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function handleNewProject() {
    if (projectDirty) {
      pendingActionRef.current = "new";
      setSaveConfirm({ action: "new" });
      return;
    }
    _doNewProject();
  }

  function _doNewProject() {
    loadProjectFromData(createEmptyProject() as ReturnType<typeof createEmptyProject>);
    setCurrentProjectPath(null);
    setProjectDirty(false);
    createdAtRef.current = new Date().toISOString();
    setExportMessage("✓ New project created.");
    setShowRecentPanel(false);
  }

  async function handleOpenProject(skipDirtyCheck?: boolean) {
    if (!skipDirtyCheck && projectDirty) {
      pendingActionRef.current = "open";
      setSaveConfirm({ action: "open" });
      return;
    }
    if (!window.editorApi) {
      // Fallback: load from localStorage
      try {
        const raw = localStorage.getItem("264pro_project_v2");
        if (raw) {
          const { project: loaded, warnings } = deserializeProject(raw);
          loadProjectFromData(loaded);
          createdAtRef.current = new Date().toISOString();
          setProjectDirty(false);
          addToRecentProjects(loaded.name, "[localStorage]");
          setExportMessage(warnings.length ? `⚠ Loaded (${warnings[0]})` : "✓ Project loaded.");
        } else {
          // Try legacy format
          const legacyRaw = localStorage.getItem("264pro_project");
          if (legacyRaw) {
            const saved = JSON.parse(legacyRaw) as typeof project;
            importAssets(saved.assets);
            setExportMessage("✓ Legacy project loaded.");
          } else {
            setExportMessage("No saved project found.");
          }
        }
      } catch {
        setExportMessage("Failed to load project.");
      }
      return;
    }

    try {
      const result = await window.editorApi.openProject();
      if (!result) return;
      const { project: loaded, warnings } = deserializeProject(result.json);
      loadProjectFromData(loaded);
      setCurrentProjectPath(result.filePath);
      createdAtRef.current = new Date().toISOString();
      setProjectDirty(false);
      addToRecentProjects(loaded.name, result.filePath);
      setExportMessage(warnings.length ? `⚠ Loaded (${warnings.join(", ")})` : "✓ Project loaded.");
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Load failed.");
    }
  }

  async function handleOpenRecentProject(path: string, _name: string) {
    // Always go through handleOpenProject so dirty-check is respected
    if (path === "[localStorage]") {
      setShowRecentPanel(false);
      await handleOpenProject();
      return;
    }
    setShowRecentPanel(false);
    // For real file paths, just trigger the open dialog through normal flow
    await handleOpenProject();
  }

  // ── Shortcuts ──────────────────────────────────────────────────────────────
  useEditorShortcuts({
    sequenceFps: project.sequence.settings.fps,
    isModalOpen: showSettings || showRecentPanel || Boolean(saveConfirm),
    onTogglePlayback: handleTogglePlayback,
    onToggleFullscreen: () => void viewerPanelRef.current?.toggleFullscreen(),
    onSelectTool: () => setToolMode("select"),
    onToggleBladeTool: toggleBladeTool,
    onSplitSelectedClip: splitSelectedClipAtPlayhead,
    onNudgePlayhead: handleStepFrames,
    onSeekToStart: () => handleSeek(0),
    onSeekToEnd: () => handleSeek(Math.max(totalFrames - 1, 0)),
    onRemoveSelectedClip: () => { pauseViewerPlayback(); removeSelectedClip(); },
    onUndo: undo,
    onRedo: redo,
    onSave: () => void handleSaveProject(),
    onOpen: () => void handleOpenProject(),
    onDuplicateSelectedClip: () => { if (selectedClipId) { pauseViewerPlayback(); duplicateClip(selectedClipId); } },
    onFitTimeline: () => timelineZoomRef.current?.fitToWindow(),
    onExport: () => void handleExport(),
    onZoomIn: () => timelineZoomRef.current?.zoomIn(),
    onZoomOut: () => timelineZoomRef.current?.zoomOut(),
    onAddMarker: () => addMarker({ frame: playback.playheadFrame, label: "", color: "#f7c948" }),
    onJKLShuttle: (direction) => {
      if (direction === 0) {
        pauseViewerPlayback();
      } else {
        handleTogglePlayback();
      }
    },
  });

  // ── Waveform peak extraction (background, per-asset) ─────────────────────
  useWaveformExtractor({ assets: project.assets, setAssetWaveform });

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

  // ── Before-close handler (Electron close button) ──────────────────────────
  useEffect(() => {
    if (!window.editorApi?.onBeforeClose) return;
    const unsub = window.editorApi.onBeforeClose(() => {
      if (!projectDirty) {
        void window.editorApi!.confirmClose();
        return;
      }
      pendingActionRef.current = "close";
      setSaveConfirm({ action: "close" });
    });
    return unsub;
  }, [projectDirty]);

  // ── Auto-save every 5 minutes when project is dirty ───────────────────────
  const AUTO_SAVE_MS = 5 * 60 * 1000; // 5 minutes
  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (autoSaveRef.current) clearInterval(autoSaveRef.current);
    autoSaveRef.current = setInterval(async () => {
      if (!projectDirty) return;
      try {
        await handleSaveProject();
        showToast("✓ Auto-saved");
      } catch {
        // silent — don't interrupt the user
      }
    }, AUTO_SAVE_MS);
    return () => { if (autoSaveRef.current) clearInterval(autoSaveRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectDirty, currentProjectPath]);

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

  // ── Timeline vertical resize ───────────────────────────────────────────────
  useEffect(() => {
    if (!isResizingTimeline) return;
    const onMove = (e: MouseEvent) => {
      const shell = appShellRef.current;
      if (!shell) return;
      const bounds = shell.getBoundingClientRect();
      const newH = Math.max(140, Math.min(560, bounds.bottom - e.clientY));
      setTimelineHeight(newH);
    };
    const onUp = () => setIsResizingTimeline(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isResizingTimeline]);

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

  // ── Save Confirmation Modal handler ───────────────────────────────────────
  async function handleSaveConfirmChoice(choice: "save" | "discard" | "cancel") {
    const action = pendingActionRef.current;
    setSaveConfirm(null);
    if (choice === "cancel") { pendingActionRef.current = null; return; }
    if (choice === "save") {
      await handleSaveProject();
    }
    // After save (or discard), proceed with pending action
    pendingActionRef.current = null;
    if (action === "new") _doNewProject();
    else if (action === "open") await handleOpenProject(true);
    else if (action === "close") { void window.editorApi?.confirmClose(); }
  }

  function renderSaveConfirmModal() {
    if (!saveConfirm) return null;
    const actionLabel = saveConfirm.action === "close" ? "closing the app"
      : saveConfirm.action === "new" ? "creating a new project"
      : "opening another project";
    return (
      <div className="save-confirm-overlay">
        <div className="save-confirm-modal">
          <div className="save-confirm-icon">💾</div>
          <h2 className="save-confirm-title">Unsaved Changes</h2>
          <p className="save-confirm-body">Do you want to save your changes before {actionLabel}?</p>
          <div className="save-confirm-actions">
            <button className="panel-action primary" onClick={() => void handleSaveConfirmChoice("save")} type="button">
              💾 Save
            </button>
            <button className="panel-action danger" onClick={() => void handleSaveConfirmChoice("discard")} type="button">
              🗑 Don't Save
            </button>
            <button className="panel-action muted" onClick={() => void handleSaveConfirmChoice("cancel")} type="button">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
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
    let canInstall = false;

    if (state === "available") { text = `Update v${version ?? ""} available — downloading…`; cls += " info"; canDismiss = true; }
    else if (state === "downloading") {
      text = `Downloading update… ${percent ?? 0}%`;
      cls += " info";
    }
    else if (state === "ready") {
      text = `v${version ?? ""} ready to install.`;
      cls += " success";
      canDismiss = true;
      canInstall = true;
    }
    else if (state === "error") { text = `Update error: ${message ?? "unknown"}`; cls += " error"; canDismiss = true; }

    return (
      <div className={cls}>
        <span>{text}</span>
        {state === "downloading" && percent !== undefined && (
          <div className="updater-progress-bar">
            <div className="updater-progress-fill" style={{ width: `${percent}%` }} />
          </div>
        )}
        {canInstall && (
          <button
            className="updater-banner__install"
            onClick={() => void window.editorApi?.installUpdate()}
            type="button"
          >Restart &amp; Install</button>
        )}
        {canDismiss && (
          <button className="updater-banner__dismiss" onClick={() => setUpdaterDismissed(true)} type="button">✕</button>
        )}
      </div>
    );
  }

  // ── Recent Projects Panel ─────────────────────────────────────────────────
  function renderRecentPanel() {
    if (!showRecentPanel) return null;
    return (
      <div className="recent-panel-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowRecentPanel(false); }}>
        <div className="recent-panel">
          <div className="recent-panel-header">
            <h3>Open Recent</h3>
            <button className="recent-panel-close" onClick={() => setShowRecentPanel(false)} type="button">✕</button>
          </div>
          <div className="recent-panel-actions">
            <button className="panel-action primary" onClick={handleNewProject} type="button">＋ New Project</button>
            <button className="panel-action" onClick={() => { setShowRecentPanel(false); void handleOpenProject(); }} type="button">📂 Open File…</button>
          </div>
          {recentProjects.length === 0 ? (
            <p className="recent-empty">No recent projects yet.</p>
          ) : (
            <div className="recent-list">
              {recentProjects.map((r) => (
                <button
                  key={r.path}
                  className="recent-item"
                  onClick={() => void handleOpenRecentProject(r.path, r.name)}
                  type="button"
                >
                  <span className="recent-item-icon">🎬</span>
                  <span className="recent-item-info">
                    <span className="recent-item-name">{r.name}</span>
                    <span className="recent-item-path">{r.path}</span>
                    <span className="recent-item-date">{r.date}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Settings helpers ──────────────────────────────────────────────────────
  function applyPreset(preset: string) {
    const presets: Record<string, ProjectSettings> = {
      "YouTube":    { width: 1920, height: 1080, fps: 30,  aspectRatio: "16:9" },
      "YouTube 4K": { width: 3840, height: 2160, fps: 30,  aspectRatio: "16:9" },
      "TikTok":     { width: 1080, height: 1920, fps: 30,  aspectRatio: "9:16" },
      "Instagram":  { width: 1080, height: 1080, fps: 30,  aspectRatio: "1:1"  },
      "Cinema 4K":  { width: 4096, height: 2160, fps: 24,  aspectRatio: "16:9" },
      "Twitter":    { width: 1280, height: 720,  fps: 30,  aspectRatio: "16:9" },
    };
    if (presets[preset]) setSettingsDraft(presets[preset]);
  }

  function handleSaveSettings() {
    setShowSettings(false);
  }

  // ── Settings modal ─────────────────────────────────────────────────────────
  function renderSettingsModal() {
    if (!showSettings) return null;
    const PRESETS = ["YouTube", "YouTube 4K", "TikTok", "Instagram", "Cinema 4K", "Twitter"];
    const FPS_OPTIONS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
    const ASPECT_OPTIONS = ["16:9", "9:16", "1:1", "4:3", "21:9", "Custom"];
    return (
      <div className="settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}>
        <div className="settings-modal">
          <div className="settings-modal-header">
            <h2>Project Settings</h2>
            <button className="settings-modal-close" onClick={() => setShowSettings(false)} type="button">✕</button>
          </div>
          <div className="settings-modal-body">
            <div className="settings-section">
              <div className="settings-section-title">Presets</div>
              <div className="settings-preset-grid">
                {PRESETS.map((p) => (
                  <button key={p} className="settings-preset-btn" onClick={() => applyPreset(p)} type="button">{p}</button>
                ))}
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-section-title">Resolution &amp; Frame Rate</div>
              <div className="settings-row">
                <label>Width (px)</label>
                <input className="settings-input" type="number" value={settingsDraft.width}
                  onChange={(e) => setSettingsDraft(d => ({...d, width: Number(e.target.value)}))} />
              </div>
              <div className="settings-row">
                <label>Height (px)</label>
                <input className="settings-input" type="number" value={settingsDraft.height}
                  onChange={(e) => setSettingsDraft(d => ({...d, height: Number(e.target.value)}))} />
              </div>
              <div className="settings-row">
                <label>Frame Rate</label>
                <select className="settings-select" value={settingsDraft.fps}
                  onChange={(e) => setSettingsDraft(d => ({...d, fps: Number(e.target.value)}))}>
                  {FPS_OPTIONS.map((f) => <option key={f} value={f}>{f} fps</option>)}
                </select>
              </div>
              <div className="settings-row">
                <label>Aspect Ratio</label>
                <select className="settings-select" value={settingsDraft.aspectRatio}
                  onChange={(e) => setSettingsDraft(d => ({...d, aspectRatio: e.target.value}))}>
                  {ASPECT_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-section-title">Project File</div>
              <div className="inline-actions">
                <button className="panel-action primary" onClick={() => void handleSaveProject()} type="button">
                  💾 {currentProjectPath ? "Save" : "Save As…"}
                </button>
                <button className="panel-action" onClick={() => void handleSaveProjectAs()} type="button">
                  📋 Save As…
                </button>
                <button className="panel-action" onClick={() => { setShowSettings(false); void handleOpenProject(); }} type="button">
                  📂 Open Project…
                </button>
              </div>
              {currentProjectPath && (
                <div className="settings-path-note">{currentProjectPath}{projectDirty ? " •" : ""}</div>
              )}
            </div>
          </div>
          <div className="settings-modal-footer">
            <button className="panel-action muted" onClick={() => setShowSettings(false)} type="button">Close</button>
            <button className="panel-action primary" onClick={handleSaveSettings} type="button">Done</button>
          </div>
        </div>
      </div>
    );
  }

  const shellStyle = {
    "--left-panel-width": `${leftPanelWidth}px`,
    "--right-panel-width": `${rightPanelWidth}px`,
    "--timeline-height": `${timelineHeight}px`
  } as CSSProperties;

  // ── Page content ───────────────────────────────────────────────────────────
  return (
    <div className="app-root">
      {renderUpdaterBanner()}
      {renderSaveConfirmModal()}
      {renderSettingsModal()}
      {renderRecentPanel()}

      {/* ── Toast notification ── */}
      {toastMessage && (
        <div className="app-toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      )}

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

        {/* Undo/Redo + File actions in the menu bar */}
        <div className="menubar-actions">
          <button
            className="menubar-action-btn"
            onClick={undo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            type="button"
          >
            ↩ Undo
          </button>
          <button
            className="menubar-action-btn"
            onClick={redo}
            disabled={!canRedo}
            title="Redo (⌘⇧Z)"
            type="button"
          >
            ↪ Redo
          </button>
          <span className="menubar-sep" />
          <button
            className="menubar-action-btn"
            onClick={handleNewProject}
            title="New Project"
            type="button"
          >
            ＋ New
          </button>
          <button
            className="menubar-action-btn"
            onClick={() => void handleSaveProject()}
            title="Save Project (⌘S)"
            type="button"
          >
            💾{projectDirty ? " •" : ""}
          </button>
          <button
            className="menubar-action-btn"
            onClick={() => setShowRecentPanel(true)}
            title="Open Project / Recent"
            type="button"
          >
            📂 Open
          </button>
        </div>

        <div className="menubar-status">
          <span className={`bridge-dot${bridgeReady ? " ready" : ""}`} title={bridgeReady ? "Electron bridge ready" : "No bridge"} />
          <span className="status-item">{project.assets.length} assets</span>
          <span className="status-sep">·</span>
          <span className="status-item">{project.sequence.clips.length} clips</span>
          <span className="status-sep">·</span>
          <span className="status-item">{project.sequence.settings.width}×{project.sequence.settings.height} / {project.sequence.settings.fps}fps</span>
          <button className="menubar-settings-btn" onClick={() => setShowSettings(true)} title="Settings" type="button">⚙️</button>
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
              colorGrade={activeSegment?.clip.colorGrade ?? null}
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
              onRelinkClips={(clipId) => { pauseViewerPlayback(); relinkClips(clipId); }}
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

            {/* Timeline resize handle */}
            <div
              className={`timeline-vertical-resizer${isResizingTimeline ? " dragging" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); setIsResizingTimeline(true); }}
              title="Drag to resize timeline"
              role="separator"
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
              onUpdateTrack={(trackId, updates) => updateTrack(trackId, updates)}
              onSetTransitionDuration={(clipId, edge, dur) => {
                pauseViewerPlayback();
                setTransitionMessage(setSelectedClipTransitionDuration(edge, dur));
              }}
              onDeleteClip={(clipId) => { pauseViewerPlayback(); removeClipById(clipId); }}
              onDuplicateClip={(clipId) => { pauseViewerPlayback(); duplicateClip(clipId); }}
              onSplitClip={(clipId, frame) => { pauseViewerPlayback(); splitClipAtFrame(clipId, frame); }}
              onToggleClipEnabled={(clipId) => { pauseViewerPlayback(); toggleClipEnabled(clipId); }}
              onDetachLinkedClips={(clipId) => { pauseViewerPlayback(); detachLinkedClips(clipId); }}
              onRelinkClips={(clipId) => { pauseViewerPlayback(); relinkClips(clipId); }}
              onSetClipSpeed={(clipId, spd) => setClipSpeed(clipId, spd)}
              onAddFade={(clipId, edge) => {
                pauseViewerPlayback();
                selectClip(clipId);
                setTransitionMessage(applyTransitionToSelectedClip(edge, "fade"));
              }}
              onAddTrack={(kind) => addTrack(kind)}
              onRemoveTrack={(trackId) => removeTrack(trackId)}
              onRenameTrack={(trackId, name) => updateTrack(trackId, { name })}
              onDuplicateTrack={(trackId) => duplicateTrack(trackId)}
              onAddTracksAndMoveClip={(clipId, frame) => { pauseViewerPlayback(); addTracksAndMoveClip(clipId, frame); }}
              onRegisterZoomControls={(ctrls) => { timelineZoomRef.current = ctrls; }}
            />
          </>
        )}

        {/* ── COLOR PAGE ── */}
        {activePage === "color" && (
          <>
            {/* Left: Color grading controls */}
            <div className="color-page-grading">
              <ColorGradingPanel
                selectedSegment={inspectorSegment}
                colorGrade={inspectorSegment?.clip.colorGrade ?? null}
                videoRef={colorPageVideoRef}
                onEnableGrade={() => {
                  if (selectedClipId) enableColorGrade(selectedClipId);
                }}
                onUpdateGrade={(grade) => {
                  if (selectedClipId) setColorGrade(selectedClipId, grade);
                }}
                onResetGrade={() => {
                  if (selectedClipId) resetColorGrade(selectedClipId);
                }}
              />
            </div>

            {/* Resizer between controls and viewer */}
            <div
              className="panel-resizer left-resizer"
              onMouseDown={(e) => { e.preventDefault(); setResizeSide("left"); }}
              role="separator"
            />

            {/* Right: Viewer — shows the INSPECTED/SELECTED clip with its live grade */}
            <div className="color-page-viewer">
              <ViewerPanel
                ref={viewerPanelRef}
                activeSegment={inspectorSegment ?? activeSegment}
                activeAudioSegment={activeAudioSegment}
                segments={segments}
                selectedAsset={selectedAsset}
                playheadFrame={playback.playheadFrame}
                totalFrames={totalFrames}
                sequenceFps={project.sequence.settings.fps}
                isPlaying={playback.isPlaying}
                toolMode={toolMode}
                colorGrade={inspectorSegment?.clip.colorGrade ?? activeSegment?.clip.colorGrade ?? null}
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
                onMoveClipTo={(clipId, trackId, frame) => { pauseViewerPlayback(); moveClipTo(clipId, trackId, frame); }}
                onTrimClipStart={(clipId, trim) => { pauseViewerPlayback(); trimClipStart(clipId, trim); }}
                onTrimClipEnd={(clipId, trim) => { pauseViewerPlayback(); trimClipEnd(clipId, trim); }}
                onBladeCut={(clipId, frame) => { pauseViewerPlayback(); splitClipAtFrame(clipId, frame); }}
                onDropAsset={(assetId, trackId, frame) => { pauseViewerPlayback(); dropAssetAtFrame(assetId, trackId, frame); }}
                onUpdateTrack={(trackId, updates) => updateTrack(trackId, updates)}
                onSetTransitionDuration={(clipId, edge, dur) => {
                  pauseViewerPlayback();
                  setTransitionMessage(setSelectedClipTransitionDuration(edge, dur));
                }}
                onDeleteClip={(clipId) => { pauseViewerPlayback(); removeClipById(clipId); }}
                onDuplicateClip={(clipId) => { pauseViewerPlayback(); duplicateClip(clipId); }}
                onSplitClip={(clipId, frame) => { pauseViewerPlayback(); splitClipAtFrame(clipId, frame); }}
                onToggleClipEnabled={(clipId) => { pauseViewerPlayback(); toggleClipEnabled(clipId); }}
                onDetachLinkedClips={(clipId) => { pauseViewerPlayback(); detachLinkedClips(clipId); }}
                onRelinkClips={(clipId) => { pauseViewerPlayback(); relinkClips(clipId); }}
                onSetClipSpeed={(clipId, spd) => setClipSpeed(clipId, spd)}
                onAddFade={(clipId, edge) => {
                  pauseViewerPlayback();
                  selectClip(clipId);
                  setTransitionMessage(applyTransitionToSelectedClip(edge, "fade"));
                }}
                onAddTrack={(kind) => addTrack(kind)}
              onRemoveTrack={(trackId) => removeTrack(trackId)}
              onRenameTrack={(trackId, name) => updateTrack(trackId, { name })}
              onDuplicateTrack={(trackId) => duplicateTrack(trackId)}
              onAddTracksAndMoveClip={(clipId, frame) => { pauseViewerPlayback(); addTracksAndMoveClip(clipId, frame); }}
              onRegisterZoomControls={(ctrls) => { timelineZoomRef.current = ctrls; }}
              />
            </div>
          </>
        )}

        {/* ── EFFECTS PAGE ── */}
        {activePage === "effects" && (
          <>
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
                onRelinkClips={(clipId) => { pauseViewerPlayback(); relinkClips(clipId); }}
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
            <div className="panel-resizer left-resizer" onMouseDown={(e) => { e.preventDefault(); setResizeSide("left"); }} role="separator" />
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
                colorGrade={activeSegment?.clip.colorGrade ?? null}
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
                onMoveClipTo={(clipId, trackId, frame) => { pauseViewerPlayback(); moveClipTo(clipId, trackId, frame); }}
                onTrimClipStart={(clipId, trim) => { pauseViewerPlayback(); trimClipStart(clipId, trim); }}
                onTrimClipEnd={(clipId, trim) => { pauseViewerPlayback(); trimClipEnd(clipId, trim); }}
                onBladeCut={(clipId, frame) => { pauseViewerPlayback(); splitClipAtFrame(clipId, frame); }}
                onDropAsset={(assetId, trackId, frame) => { pauseViewerPlayback(); dropAssetAtFrame(assetId, trackId, frame); }}
                onUpdateTrack={(trackId, updates) => updateTrack(trackId, updates)}
                onSetTransitionDuration={(clipId, edge, dur) => setTransitionMessage(setSelectedClipTransitionDuration(edge, dur))}
                onDeleteClip={(clipId) => { pauseViewerPlayback(); removeClipById(clipId); }}
                onDuplicateClip={(clipId) => { pauseViewerPlayback(); duplicateClip(clipId); }}
                onSplitClip={(clipId, frame) => { pauseViewerPlayback(); splitClipAtFrame(clipId, frame); }}
                onToggleClipEnabled={(clipId) => { pauseViewerPlayback(); toggleClipEnabled(clipId); }}
                onDetachLinkedClips={(clipId) => { pauseViewerPlayback(); detachLinkedClips(clipId); }}
                onRelinkClips={(clipId) => { pauseViewerPlayback(); relinkClips(clipId); }}
                onSetClipSpeed={(clipId, spd) => setClipSpeed(clipId, spd)}
                onAddFade={(clipId, edge) => {
                  pauseViewerPlayback();
                  selectClip(clipId);
                  setTransitionMessage(applyTransitionToSelectedClip(edge, "fade"));
                }}
                onAddTrack={(kind) => addTrack(kind)}
              onRemoveTrack={(trackId) => removeTrack(trackId)}
              onRenameTrack={(trackId, name) => updateTrack(trackId, { name })}
              onDuplicateTrack={(trackId) => duplicateTrack(trackId)}
              onAddTracksAndMoveClip={(clipId, frame) => { pauseViewerPlayback(); addTracksAndMoveClip(clipId, frame); }}
              onRegisterZoomControls={(ctrls) => { timelineZoomRef.current = ctrls; }}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
