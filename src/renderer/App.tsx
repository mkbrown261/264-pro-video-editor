import React, { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { FlowStatePanel } from "./components/FlowStatePanel";
import { InspectorPanel } from "./components/InspectorPanel";
import { MediaPool } from "./components/MediaPool";
import { TimelinePanel } from "./components/TimelinePanel";
import {
  ViewerPanel,
  type ViewerPanelHandle
} from "./components/ViewerPanel";
import { ColorGradingPanel } from "./components/ColorGradingPanel";
import FusionPage from "./components/compositing/FusionPage";
import { ToastContainer } from "./components/ToastContainer";
import { useEditorShortcuts } from "./hooks/useEditorShortcuts";
import { useWaveformExtractor } from "./hooks/useWaveformExtractor";
import { useAsyncImport } from "./hooks/useAsyncImport";
import { useFilmstripGenerator } from "./hooks/useFilmstripGenerator";
import { VoiceChopAI } from "./lib/VoiceChopAI";
import { toast } from "./lib/toast";
import { useEditorStore } from "./store/editorStore";
import {
  buildTimelineSegments,
  buildTrackLayouts,
  findPlayableSegmentAtFrame,
  findAllActiveVideoSegments,
  type TimelineSegment,
  getTotalDurationFrames
} from "../shared/timeline";
import { serializeProject, deserializeProject } from "../shared/projectSerializer";
import type { UpdaterStatus } from "./vite-env";
import type { ClipMask } from "../shared/models";
import { createEmptyProject } from "../shared/models";
import type { MaskTool } from "./components/MaskingCanvas";

// Pages: edit | color | fusion
type AppPage = "edit" | "color" | "fusion";
type LayoutPreset = "edit" | "color" | "audio";

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
  // Ref that always points to the current viewer's video element (for motion tracking)
  const viewerVideoRef = useRef<HTMLVideoElement | null>(null);

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
  const setAssetThumbnail = useEditorStore((s) => s.setAssetThumbnail);
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
  const setClipTransform = useEditorStore((s) => s.setClipTransform);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const loadProjectFromData = useEditorStore((s) => s.loadProjectFromData);
  const updateTrack = useEditorStore((s) => s.updateTrack);
  const addTrack = useEditorStore((s) => s.addTrack);
  const removeTrack = useEditorStore((s) => s.removeTrack);
  const duplicateTrack = useEditorStore((s) => s.duplicateTrack);
  const addTracksAndMoveClip = useEditorStore((s) => s.addTracksAndMoveClip);
  const addTracksAndDropAsset = useEditorStore((s) => s.addTracksAndDropAsset);
  const reorderTrack = useEditorStore((s) => s.reorderTrack);
  const addMarker = useEditorStore((s) => s.addMarker);
  const setAssetWaveform = useEditorStore((s) => s.setAssetWaveform);
  const setAssetFilmstrip = useEditorStore((s) => s.setAssetFilmstrip);

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
  const updateSequenceSettings = useEditorStore((s) => s.updateSequenceSettings);

  // ── Fusion store actions ────────────────────────────────────────────────────
  const fusionClipId = useEditorStore((s) => s.fusionClipId);
  const openFusion   = useEditorStore((s) => s.openFusion);
  const closeFusion  = useEditorStore((s) => s.closeFusion);
  const setCompGraph = useEditorStore((s) => s.setCompGraph);

  // ── Active page – driven by store so openFusion() triggers re-render ────────
  const activePage    = useEditorStore((s) => s.activePage) as AppPage;
  const setActivePage = useEditorStore((s) => s.setActivePage) as (page: AppPage) => void;

  // ── Local UI state ─────────────────────────────────────────────────────────
  const [exportBusy,  setExportBusy]  = useState(false);
  const [importBusy,  setImportBusy]  = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [transitionMessage, setTransitionMessage] = useState<string | null>(null);
  const [bridgeReady, setBridgeReady] = useState(
    typeof window !== "undefined" && Boolean(window.editorApi)
  );
  const appShellRef = useRef<HTMLElement | null>(null);
  // Timeline zoom controls — populated by TimelinePanel via onRegisterZoomControls
  const timelineZoomRef = useRef<{ zoomIn: () => void; zoomOut: () => void; fitToWindow: () => void } | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(220);
  const [rightPanelWidth, setRightPanelWidth] = useState(300);
  const [resizeSide, setResizeSide] = useState<"left" | "right" | null>(null);
  const [timelineHeight, setTimelineHeight] = useState(() => {
    try { return Number(localStorage.getItem("264pro_timeline_height") ?? "220") || 220; } catch { return 220; }
  });
  const [isResizingTimeline, setIsResizingTimeline] = useState(false);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus | null>(null);
  const [updaterDismissed, setUpdaterDismissed] = useState(false);

  // Imp 1: Collapsible panels (persist to localStorage)
  const [mediaPoolOpen, setMediaPoolOpen] = useState(() => {
    try { return localStorage.getItem("264pro_media_pool_open") !== "false"; } catch { return true; }
  });
  const [inspectorOpen, setInspectorOpen] = useState(() => {
    try { return localStorage.getItem("264pro_inspector_open") !== "false"; } catch { return true; }
  });

  // Imp 9: Layout preset
  const [, setLayoutPreset] = useState<LayoutPreset>("edit");

  // Imp 6: Dual viewer
  const [dualViewer, setDualViewer] = useState(false);
  const [sourceFrame, setSourceFrame] = useState(0);
  const [sourcePlaying, setSourcePlaying] = useState(false);
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);

  // File dropdown (Imp 10)
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);

  // Timecode editing (Imp 4)
  const [timecodeEditing, setTimecodeEditing] = useState(false);
  const [timecodeInput, setTimecodeInput] = useState("");

  // ── FlowState Panel ────────────────────────────────────────────────────────
  const [flowstatePanelOpen, setFlowstatePanelOpen] = useState(false);

  // ── FlowState Tier ────────────────────────────────────────────────────────
  // Loaded once on mount; governs AI panel access and feature visibility
  const [fsTier, setFsTier] = useState<string>('free');
  const [fsLinked, setFsLinked] = useState(false);

  // ── Toast notifications ────────────────────────────────────────────────────
  // Legacy inline toast kept for backward compatibility; new code uses the
  // singleton toast.* API which ToastContainer renders.
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(msg: string) {
    // Forward to the new toast system as well as the legacy inline display
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 3500);
    toast.info(msg, 3500);
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

  // Re-sync the draft every time the settings modal opens so it always shows live values
  // ── FlowState tier load + activity ping on mount ──────────────────────────
  useEffect(() => {
    if (!window.flowstateAPI) return;
    window.flowstateAPI.getUser().then((user) => {
      if (!user) return;
      setFsTier(user.tier);
      setFsLinked(true);
      // Ping activity: project_opened
      void window.flowstateAPI!.apiCall('/api/264pro/activity', 'POST', {
        event: 'project_opened',
        projectName: project.name ?? 'Untitled',
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (showSettings) {
      setSettingsDraft({
        width: project.sequence.settings.width,
        height: project.sequence.settings.height,
        fps: project.sequence.settings.fps,
        aspectRatio: "16:9",
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings]);

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

  // ── Hierarchical rendering: topmost visible video clip only ───────────────
  // findAllActiveVideoSegments returns ALL overlapping video clips sorted
  // by trackIndex desc.  The first element is the clip we show in the viewer.
  // Lower clips are hidden unless transparency/mask allows see-through.
  const activeVideoSegments = findAllActiveVideoSegments(segments, playback.playheadFrame);
  // Primary active video segment — shown in the viewer
  const activeSegment = activeVideoSegments[0] ?? null;

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
    const vid = viewerPanelRef.current?.getVideoRef() ?? null;
    colorPageVideoRef.current = vid;
    viewerVideoRef.current = vid;
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
      // Context sync to FlowState on save
      if (window.flowstateAPI && fsLinked) {
        void window.flowstateAPI.apiCall('/api/264pro/context-sync', 'POST', {
          projectName: project.name ?? 'Untitled',
          trackCount: project.tracks?.length ?? project.sequence?.tracks?.length ?? 0,
          clipCount: project.sequence.clips.length,
          fps: project.sequence.settings.fps,
          resolution: `${project.sequence.settings.width}×${project.sequence.settings.height}`,
          lastModified: new Date().toISOString(),
        });
      }
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
      // Sync to FlowState
      if (window.flowstateAPI && fsLinked) {
        void window.flowstateAPI.apiCall('/api/264pro/sync-projects', 'POST', {
          projects: next.map((r, i) => ({
            id: `local_${i}`,
            name: r.name,
            lastModified: new Date().toISOString(),
          })),
        });
      }
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
    onSaveAs: () => void handleSaveProjectAs(),
    onOpen: () => void handleOpenProject(),
    onNewProject: handleNewProject,
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
    onToggleMediaPool: () => {
      setMediaPoolOpen((v) => {
        const next = !v;
        try { localStorage.setItem("264pro_media_pool_open", String(next)); } catch {}
        return next;
      });
    },
    onToggleInspector: () => {
      setInspectorOpen((v) => {
        const next = !v;
        try { localStorage.setItem("264pro_inspector_open", String(next)); } catch {}
        return next;
      });
    },
    onToggleDualViewer: () => setDualViewer((v) => !v),
    onLayoutPreset: (preset) => {
      setLayoutPreset(preset);
      if (preset === "color") {
        setActivePage("color");
        setMediaPoolOpen(false);
        setInspectorOpen(false);
      } else if (preset === "audio") {
        setActivePage("edit");
        setMediaPoolOpen(true);
        setInspectorOpen(false);
      } else {
        setActivePage("edit");
        setMediaPoolOpen(true);
        setInspectorOpen(true);
      }
    },
    onMarkIn: () => setVoiceMarkInFrame(playback.playheadFrame),
    onMarkOut: () => setVoiceMarkOutFrame(playback.playheadFrame),
  });

  // ── Waveform peak extraction (background, per-asset) ─────────────────────
  useWaveformExtractor({ assets: project.assets, setAssetWaveform });

  // ── Fix 6: Filmstrip thumbnail generation (background, per-asset) ──────────
  useFilmstripGenerator({ assets: project.assets, setAssetFilmstrip });

  // ── File menu click-outside close ─────────────────────────────────────────
  useEffect(() => {
    if (!fileMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setFileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [fileMenuOpen]);

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

  // FIX 8: Browser-level beforeunload safety net — always warns on unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!projectDirty) return;
      e.preventDefault();
      // Modern browsers show their own dialog; returning a string triggers legacy behavior
      e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [projectDirty]);

  // ── Auto-save every 60 seconds when project is dirty ─────────────────────
  const AUTO_SAVE_MS = 60 * 1000; // 60 seconds (CapCut parity)
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

    // Tell the main process the renderer is ready so the splash screen dismisses
    try { window.editorApi.notifyAppReady?.(); } catch { /* non-fatal */ }

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

  // ── Bridge exportMessage/transitionMessage → toast notifications ────────────
  useEffect(() => {
    if (!exportMessage) return;
    const isError = exportMessage.startsWith("✗") || exportMessage.toLowerCase().includes("fail") || exportMessage.toLowerCase().includes("error");
    const isWarning = exportMessage.startsWith("⚠");
    if (isError)        toast.error(exportMessage, 5000);
    else if (isWarning) toast.warning(exportMessage, 4000);
    else                toast.success(exportMessage, 3000);
  }, [exportMessage]);

  useEffect(() => {
    if (!transitionMessage) return;
    toast.info(transitionMessage, 2500);
  }, [transitionMessage]);

  // ── Import/Export ──────────────────────────────────────────────────────────
  // Non-blocking async import pipeline:
  //   1. Immediately adds assets with placeholder thumbnails so the media
  //      pool is populated and the timeline is usable right away.
  //   2. Generates thumbnails in background, patches them into the store.
  const { triggerImport } = useAsyncImport({
    onAssetsReady: (assets) => {
      if (assets.length) importAssets(assets);
      setExportMessage(null);
    },
    onThumbnailReady: (assetId, thumbnailUrl) => {
      setAssetThumbnail(assetId, thumbnailUrl);
    },
    onImportingChange: (busy) => {
      setImportBusy(busy);
    }
  });

  async function handleImport() {
    setExportMessage(null);
    await triggerImport();
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
      // Notify FlowState of export activity
      if (window.flowstateAPI && fsLinked) {
        void window.flowstateAPI.apiCall('/api/264pro/activity', 'POST', {
          event: 'export_completed',
          projectName: project.name ?? 'Untitled',
          format: 'mp4',
          outputPath: result.outputPath,
        });
      }
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
    // Apply the drafted settings to the live project
    updateSequenceSettings({
      width:  Math.max(1, Math.round(settingsDraft.width)),
      height: Math.max(1, Math.round(settingsDraft.height)),
      fps:    settingsDraft.fps,
    });
    setShowSettings(false);
    showToast(`✓ Settings updated: ${settingsDraft.width}×${settingsDraft.height} / ${settingsDraft.fps}fps`);
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
    "--left-panel-width": mediaPoolOpen ? `${leftPanelWidth}px` : "0px",
    "--right-panel-width": inspectorOpen ? `${rightPanelWidth}px` : "0px",
    "--timeline-height": `${timelineHeight}px`
  } as CSSProperties;

  // Helper: format frames as HH:MM:SS:FF timecode
  function framesToTimecode(frame: number, fps: number): string {
    const f = Math.max(0, Math.round(frame));
    const totalSec = Math.floor(f / fps);
    const ff = f % fps;
    const ss = totalSec % 60;
    const mm = Math.floor(totalSec / 60) % 60;
    const hh = Math.floor(totalSec / 3600);
    return [
      String(hh).padStart(2, "0"),
      String(mm).padStart(2, "0"),
      String(ss).padStart(2, "0"),
      String(ff).padStart(2, "0")
    ].join(":");
  }

  function handleTimecodeSubmit(raw: string) {
    // Parse HH:MM:SS:FF or SS:FF or integer frames
    const parts = raw.trim().split(":").map(Number);
    let frame = 0;
    const fps = project.sequence.settings.fps;
    if (parts.length === 4) {
      frame = ((parts[0] * 3600 + parts[1] * 60 + parts[2]) * fps) + parts[3];
    } else if (parts.length === 3) {
      frame = ((parts[0] * 60 + parts[1]) * fps) + parts[2];
    } else if (parts.length === 2) {
      frame = parts[0] * fps + parts[1];
    } else if (parts.length === 1 && !isNaN(parts[0])) {
      frame = parts[0];
    }
    if (!isNaN(frame)) handleSeek(Math.max(0, Math.min(totalFrames - 1, Math.round(frame))));
    setTimecodeEditing(false);
  }

  // ── Page content —————————————————————————————————————————————————————──────
  return (
    <div className="app-root">
      {renderUpdaterBanner()}
      {renderSaveConfirmModal()}
      {renderSettingsModal()}
      {renderRecentPanel()}

      {/* ── Toast notification system ── */}
      <ToastContainer />

      {/* ── TOP MENU BAR ── */}
      <header className="app-menubar">
        <div className="menubar-brand">
          <span className="brand-logo">264</span>
          <span className="brand-name">Pro</span>
        </div>

        {/* Imp 10: File dropdown */}
        <div className="file-menu-wrapper" ref={fileMenuRef}>
          <button
            className={`menubar-action-btn file-menu-btn${fileMenuOpen ? " active" : ""}`}
            onClick={() => setFileMenuOpen((v) => !v)}
            title="File"
            type="button"
          >
            File ▾
          </button>
          {fileMenuOpen && (
            <div className="file-menu-dropdown">
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); handleNewProject(); }} type="button">
                <span className="fmi-icon">➕</span> New Project <span className="fmi-kbd">⌘N</span>
              </button>
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); void handleOpenProject(); }} type="button">
                <span className="fmi-icon">📂</span> Open… <span className="fmi-kbd">⌘O</span>
              </button>
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); setShowRecentPanel(true); }} type="button">
                <span className="fmi-icon">🕒</span> Open Recent…
              </button>
              <div className="file-menu-sep" />
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); void handleSaveProject(); }} type="button">
                <span className="fmi-icon">💾</span> Save{projectDirty ? " •" : ""} <span className="fmi-kbd">⌘S</span>
              </button>
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); void handleSaveProjectAs(); }} type="button">
                <span className="fmi-icon">📎</span> Save As… <span className="fmi-kbd">⌘⇧S</span>
              </button>
              <div className="file-menu-sep" />
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); void handleExport(); }} type="button">
                <span className="fmi-icon">🎥</span> Export… <span className="fmi-kbd">⌘E</span>
              </button>
              <div className="file-menu-sep" />
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); setShowSettings(true); }} type="button">
                <span className="fmi-icon">⚙️</span> Settings…
              </button>
            </div>
          )}
        </div>

        {/* Undo/Redo */}
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
        </div>

        {/* Page tabs */}
        <nav className="page-tabs">
          {(["edit", "color", "fusion"] as const).map((page) => (
            <button
              key={page}
              className={`page-tab${activePage === page ? " active" : ""}${page === "fusion" ? " fusion-tab" : ""}`}
              onClick={() => {
                if (page === "fusion") {
                  const clipId = selectedClipId ?? project.sequence.clips.find(c => {
                    const asset = project.assets.find(a => a.id === c.assetId);
                    return asset?.kind === "video";
                  })?.id ?? "";
                  openFusion(clipId);
                } else {
                  setActivePage(page);
                }
              }}
              type="button"
              title={page === "fusion" ? "Open Fusion node compositor" : undefined}
            >
              {page === "fusion" ? "⬡ Fusion" : page.charAt(0).toUpperCase() + page.slice(1)}
            </button>
          ))}
        </nav>

        {/* Imp 4: Large centered timecode */}
        <div className="menubar-timecode-wrap">
          {timecodeEditing ? (
            <input
              className="timecode-input"
              autoFocus
              defaultValue={framesToTimecode(playback.playheadFrame, project.sequence.settings.fps)}
              onBlur={(e) => handleTimecodeSubmit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleTimecodeSubmit((e.target as HTMLInputElement).value);
                if (e.key === "Escape") setTimecodeEditing(false);
              }}
            />
          ) : (
            <button
              className="timecode-display"
              onClick={() => { setTimecodeEditing(true); setTimecodeInput(framesToTimecode(playback.playheadFrame, project.sequence.settings.fps)); }}
              title="Click to jump to timecode"
              type="button"
            >
              {framesToTimecode(playback.playheadFrame, project.sequence.settings.fps)}
            </button>
          )}
          <span className="timecode-total">/ {framesToTimecode(totalFrames, project.sequence.settings.fps)}</span>
        </div>

        {/* Panel toggle buttons (Imp 1) */}
        <div className="menubar-panel-toggles">
          <button
            className={`panel-toggle-btn${mediaPoolOpen ? " on" : ""}`}
            onClick={() => {
              setMediaPoolOpen((v) => {
                const next = !v;
                try { localStorage.setItem("264pro_media_pool_open", String(next)); } catch {}
                return next;
              });
            }}
            title="Toggle Media Pool (F1)"
            type="button"
          >
            ▧ Media
          </button>
          <button
            className={`panel-toggle-btn${inspectorOpen ? " on" : ""}`}
            onClick={() => {
              setInspectorOpen((v) => {
                const next = !v;
                try { localStorage.setItem("264pro_inspector_open", String(next)); } catch {}
                return next;
              });
            }}
            title="Toggle Inspector (F2)"
            type="button"
          >
            Inspector ▦
          </button>

          {/* FlowState Panel toggle */}
          <button
            className={`panel-toggle-btn${flowstatePanelOpen ? " on" : ""}`}
            onClick={() => setFlowstatePanelOpen((v) => !v)}
            title={fsLinked ? `FlowState AI Panel (${fsTier})` : "FlowState AI Panel — not linked"}
            type="button"
            style={{
              background: flowstatePanelOpen
                ? "linear-gradient(135deg,rgba(224,120,32,0.25),rgba(168,85,247,0.25))"
                : undefined,
              borderColor: flowstatePanelOpen ? "rgba(168,85,247,0.4)" : undefined,
              color: flowstatePanelOpen ? "#d0a0ff" : undefined,
            }}
          >
            {fsLinked ? "🌊" : "🔗"} FlowState
            {fsLinked && (
              <span style={{
                marginLeft: 4,
                width: 6, height: 6,
                borderRadius: "50%",
                background: "#10b981",
                display: "inline-block",
                verticalAlign: "middle",
                flexShrink: 0,
              }} />
            )}
          </button>
        </div>

        <div className="menubar-status">
          <span className={`bridge-dot${bridgeReady ? " ready" : ""}`} title={bridgeReady ? "Electron bridge ready" : "No bridge"} />
          <span className="status-item">{project.assets.length} assets</span>
          <span className="status-sep">·</span>
          <span className="status-item">{project.sequence.clips.length} clips</span>
          <span className="status-sep">·</span>
          <span className="status-item">{project.sequence.settings.width}×{project.sequence.settings.height}/{project.sequence.settings.fps}fps</span>
        </div>
      </header>

      {/* ── MAIN WORKSPACE ── */}
      <main ref={appShellRef} className={`app-shell page-${activePage}`} style={shellStyle}>

        {/* ── EDIT PAGE ── */}
        {activePage === "edit" && (
          <>
            {/* Imp 1: Collapsible Media Pool wrapper */}
            <div className={`panel-collapse-wrap media-collapse${mediaPoolOpen ? " open" : " closed"}`}>
              <MediaPool
                assets={project.assets}
                selectedAssetId={selectedAssetId}
                selectedSegment={inspectorSegment}
                transitionMessage={transitionMessage}
                importing={importBusy}
                onImport={handleImport}
                onSelectAsset={selectAsset}
                onAppendAsset={appendAssetToTimeline}
                onApplyTransition={(edge) => {
                  pauseViewerPlayback();
                  setTransitionMessage(applyTransitionToSelectedClip(edge));
                }}
                onApplyTransitionType={(type, edge, durationFrames) => {
                  pauseViewerPlayback();
                  const msg1 = setSelectedClipTransitionType(edge, type);
                  const msg2 = setSelectedClipTransitionDuration(edge, durationFrames);
                  setTransitionMessage(msg1 ?? msg2);
                }}
              />
            </div>

            <div
              className={`panel-resizer left-resizer${mediaPoolOpen ? "" : " panel-resizer-hidden"}`}
              onMouseDown={(e) => { e.preventDefault(); setResizeSide("left"); }}
              role="separator"
            />

            {/* Imp 7: Vertical Tool Toolbar — inside viewer cell so it doesn't block grid interactions */}
            <div className="viewer-with-toolbar">
              <div className="tool-toolbar">
                <button
                  className={`tool-btn${toolMode === "select" ? " active" : ""}`}
                  onClick={() => setToolMode("select")}
                  title="Select (A / V)"
                  type="button"
                >
                  ⤴️
                  <span className="tool-btn-label">Select</span>
                </button>
                <button
                  className={`tool-btn${toolMode === "blade" ? " active" : ""}`}
                  onClick={toggleBladeTool}
                  title="Blade (B)"
                  type="button"
                >
                  ✂️
                  <span className="tool-btn-label">Blade</span>
                </button>
                <div className="tool-toolbar-sep" />
                <button
                  className="tool-btn"
                  onClick={() => timelineZoomRef.current?.zoomIn()}
                  title="Zoom In (])"
                  type="button"
                >
                  🔍+
                  <span className="tool-btn-label">Zoom+</span>
                </button>
                <button
                  className="tool-btn"
                  onClick={() => timelineZoomRef.current?.zoomOut()}
                  title="Zoom Out ([)"
                  type="button"
                >
                  🔍−
                  <span className="tool-btn-label">Zoom−</span>
                </button>
                <button
                  className="tool-btn"
                  onClick={() => timelineZoomRef.current?.fitToWindow()}
                  title="Fit Timeline (Shift+Z)"
                  type="button"
                >
                  □
                  <span className="tool-btn-label">Fit</span>
                </button>
              </div>
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
                clipEffects={activeSegment?.clip.effects ?? null}
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

            <div
              className={`panel-resizer right-resizer${inspectorOpen ? "" : " panel-resizer-hidden"}`}
              onMouseDown={(e) => { e.preventDefault(); setResizeSide("right"); }}
              role="separator"
            />

            {/* Imp 1: Collapsible Inspector wrapper */}
            <div className={`panel-collapse-wrap inspector-collapse${inspectorOpen ? " open" : " closed"}`}>
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
              clipTransform={inspectorSegment?.clip.transform ?? null}
              onSetClipTransform={(updates) => { if (selectedClipId) setClipTransform(selectedClipId, updates); }}
              videoRef={viewerVideoRef}
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
            </div>{/* /inspector-collapse */}

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
              onOpenInFusion={(clipId) => {
                selectClip(clipId);
                openFusion(clipId);
                setActivePage("fusion");
              }}
              onAddTrack={(kind) => addTrack(kind)}
              onRemoveTrack={(trackId) => removeTrack(trackId)}
              onRenameTrack={(trackId, name) => updateTrack(trackId, { name })}
              onDuplicateTrack={(trackId) => duplicateTrack(trackId)}
              onAddTracksAndMoveClip={(clipId, frame, idx) => { pauseViewerPlayback(); addTracksAndMoveClip(clipId, frame, idx); }}
              onAddTracksAndDropAsset={(assetId, frame, idx) => { pauseViewerPlayback(); addTracksAndDropAsset(assetId, frame, idx); }}
              onReorderTrack={(trackId, toIndex) => reorderTrack(trackId, toIndex)}
              onRegisterZoomControls={(ctrls) => { timelineZoomRef.current = ctrls; }}
              onDropTransition={(clipId, transType, edge) => {
                selectClip(clipId);
                const msg1 = setSelectedClipTransitionType(edge, transType as import("../../shared/models").ClipTransitionType);
                setTransitionMessage(msg1);
              }}
              assets={project.assets}
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
              {/* Open in Fusion button */}
              {selectedClipId && (
                <div style={{ padding: "8px 10px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <button
                    style={{ width: "100%", padding: "6px", background: "rgba(245,197,66,0.1)", border: "1px solid rgba(245,197,66,0.3)", color: "#f5c542", borderRadius: "4px", cursor: "pointer", fontSize: "0.73rem", fontWeight: 700 }}
                    onClick={() => { openFusion(selectedClipId); setActivePage("fusion"); }}
                  >
                    ⬡ Open in Fusion
                  </button>
                </div>
              )}
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
                clipEffects={inspectorSegment?.clip.effects ?? activeSegment?.clip.effects ?? null}
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
              {/* Imp 5 / Imp 12: Persistent Scopes Strip */}
              <div className="color-scopes-strip">
                <div className="scope-block">Waveform</div>
                <div className="scope-block">Parade</div>
                <div className="scope-block">Vectorscope</div>
                <div className="scope-block">Histogram</div>
              </div>
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
                onOpenInFusion={(clipId) => {
                  selectClip(clipId);
                  openFusion(clipId);
                  setActivePage("fusion");
                }}
                onAddTrack={(kind) => addTrack(kind)}
              onRemoveTrack={(trackId) => removeTrack(trackId)}
              onRenameTrack={(trackId, name) => updateTrack(trackId, { name })}
              onDuplicateTrack={(trackId) => duplicateTrack(trackId)}
              onAddTracksAndMoveClip={(clipId, frame, idx) => { pauseViewerPlayback(); addTracksAndMoveClip(clipId, frame, idx); }}
              onAddTracksAndDropAsset={(assetId, frame, idx) => { pauseViewerPlayback(); addTracksAndDropAsset(assetId, frame, idx); }}
              onReorderTrack={(trackId, toIndex) => reorderTrack(trackId, toIndex)}
              onRegisterZoomControls={(ctrls) => { timelineZoomRef.current = ctrls; }}
              onDropTransition={(clipId, transType, edge) => {
                selectClip(clipId);
                const msg1 = setSelectedClipTransitionType(edge, transType as import("../../shared/models").ClipTransitionType);
                setTransitionMessage(msg1);
              }}
              assets={project.assets}
              />
            </div>
          </>
        )}

        {/* ── FUSION PAGE ── */}
        {activePage === "fusion" && (() => {
          const fusClip = fusionClipId
            ? project.sequence.clips.find(c => c.id === fusionClipId) ?? null
            : (selectedClipId ? project.sequence.clips.find(c => c.id === selectedClipId) ?? null : null);
          const fusAsset = fusClip ? project.assets.find(a => a.id === fusClip.assetId) ?? null : null;
          return (
            <FusionPage
              clip={fusClip}
              asset={fusAsset}
              allClips={project.sequence.clips}
              sequenceSettings={project.sequence.settings}
              playheadFrame={playback.playheadFrame}
              videoRef={viewerPanelRef as unknown as React.RefObject<HTMLVideoElement | null>}
              onUpdateGraph={(clipId, graph) => setCompGraph(clipId, graph)}
              onBack={() => setActivePage("edit")}
            />
          );
        })()}

      </main>

      {/* ── FLOWSTATE PANEL (slide-in overlay) ── */}
      <FlowStatePanel
        isOpen={flowstatePanelOpen}
        onClose={() => setFlowstatePanelOpen(false)}
      />
    </div>
  );
}
