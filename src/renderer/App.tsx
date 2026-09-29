import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FlowStatePanel } from "./components/FlowStatePanel";
import { AIToolsPanel } from "./components/AIToolsPanel";
import { InspectorPanel } from "./components/InspectorPanel";
import { AudioMixerPanel } from "./components/AudioMixerPanel";
import { RenderQueuePanel, type RenderJob } from "./components/RenderQueuePanel";
import { MediaPool } from "./components/MediaPool";
import { TimelinePanel } from "./components/TimelinePanel";
import {
  ViewerPanel,
  type ViewerPanelHandle
} from "./components/ViewerPanel";
import { ColorGradingPanel } from "./components/ColorGradingPanel";
import FusionPage from "./components/compositing/FusionPage";
import { ToastContainer } from "./components/ToastContainer";
import { CommandPalette, buildCommandList } from "./components/CommandPalette";
import { StoryboardView } from "./components/StoryboardView";
import { ColorHistogram } from "./components/ColorHistogram";
import { VideoScopesPanel } from "./components/VideoScopesPanel";
import { PrecisionTrimPanel } from "./components/PrecisionTrimPanel";
import { useEditorShortcuts } from "./hooks/useEditorShortcuts";
import { useWaveformExtractor } from "./hooks/useWaveformExtractor";
import { useAsyncImport } from "./hooks/useAsyncImport";
import { useFilmstripGenerator } from "./hooks/useFilmstripGenerator";
import { VoiceChopAI } from "./lib/VoiceChopAI";
import { toast } from "./lib/toast";
import { useExportController } from "./hooks/useExportController";
import { useProjectSafety } from "./hooks/useProjectSafety";
import { useProjectFile } from "./hooks/useProjectFile";
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
import { createEmptyProject, createId, createEmptyClip } from "../shared/models";
import type { SubtitleCue, TitleClipConfig, MediaAsset } from "../shared/models";
import type { MaskTool } from "./components/MaskingCanvas";
import { FollowForFreebie } from "./components/FollowForFreebie";
import { SubtitlesPanel } from "./components/SubtitlesPanel";
import { TitleGeneratorPanel } from "./components/TitleGeneratorPanel";
import { ClawSoundPanel } from "./components/ClawSoundPanel";
import { TextBasedEditingPanel } from "./components/TextBasedEditingPanel";
import { ShortcutsPanel } from "./components/ShortcutsPanel";
// Phase 4 new imports
import { ProjectTemplateModal, instantiateTemplate, type ProjectTemplate } from "./components/ProjectTemplateModal";
import { ProjectNotesPanel } from "./components/ProjectNotesPanel";
import { MulticamPanel } from "./components/MulticamPanel";
import { AutoResizePanel } from "./components/AutoResizePanel";
import { AIStoryboardPanel } from "./components/AIStoryboardPanel";
import { ShotListPanel } from "./components/ShotListPanel";
import { SmartSuggestionsBar } from "./components/SmartSuggestionsBar";
import { type BatchPreset } from "./components/RenderQueuePanel";
// Phase 5 new imports
import { BeatSyncPanel } from "./components/BeatSyncPanel";
import { AutoReframePanel } from "./components/AutoReframePanel";
// Phase 6 new imports
import OnboardingModal from "./components/OnboardingModal";
import { SettingsPanel } from "./components/SettingsPanel";
// Render cache
import { useRenderCache } from "./hooks/useRenderCache";
// Proxy workflow
import { useProxyManager } from "./hooks/useProxyManager";
// Phase 9 ClawFlow Intelligence
import { useClawFlowAmbient } from "./hooks/useClawFlowAmbient";
import { useVoiceCommands } from "./hooks/useVoiceCommands";
import { updateFromCut, updateFromGrade, updateFromTransition } from "./lib/ClawFlowStyleProfile";
import { StyleProfilePanel } from "./components/StyleProfilePanel";
import { ClawFlowPublishPanel } from "./components/ClawFlowPublishPanel";
import { ProjectIntelligencePanel } from "./components/ProjectIntelligencePanel";
import { TimelineIndexPanel } from "./components/TimelineIndexPanel";
import { ClawGuide, useClawGuide } from "./components/ClawGuide";
import { TranscriptEditor } from "./components/TranscriptEditor";
import { ImageToVideoModal } from "./components/ImageToVideoModal";
import { ImageGenModal } from "./components/ImageGenModal";
import { ProjectSettingsModal, type ProjectSettings } from "./components/ProjectSettingsModal";

// Pages: edit | color | fusion | audio | publish
type AppPage = "edit" | "color" | "fusion" | "audio" | "publish";
type LayoutPreset = "edit" | "color" | "audio";



const NO_CUES: SubtitleCue[] = [];

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
  const splitClipsAtBeats = useEditorStore((s) => s.splitClipsAtBeats);
  const removeSelectedClip = useEditorStore((s) => s.removeSelectedClip);
  const removeClipById = useEditorStore((s) => s.removeClipById);
  const duplicateClip = useEditorStore((s) => s.duplicateClip);
  const reorderClips = useEditorStore((s) => s.reorderClips);
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
  const patchClip = useEditorStore((s) => s.patchClip);
  const addRecordedAudio = useEditorStore((s) => s.addRecordedAudio);
  const setAutomationKeyframe = useEditorStore((s) => s.setAutomationKeyframe);
  const copyGrade = useEditorStore((s) => s.copyGrade);
  const pasteGrade = useEditorStore((s) => s.pasteGrade);
  const gradeClipboard = useEditorStore((s) => s.gradeClipboard);
  const removeAutomationKeyframe = useEditorStore((s) => s.removeAutomationKeyframe);
  const setMagneticTimeline = useEditorStore((s) => s.setMagneticTimeline);
  const addCaptionsFromTranscript = useEditorStore((s) => s.addCaptionsFromTranscript);
  const magneticTimeline = useEditorStore((s) => s.project.sequence.settings.magneticTimeline !== false);
  const addAssetToPool = useEditorStore((s) => s.addAsset);
  const insertClip = useEditorStore((s) => s.insertClip);
  const addTrack = useEditorStore((s) => s.addTrack);
  const removeTrack = useEditorStore((s) => s.removeTrack);
  const duplicateTrack = useEditorStore((s) => s.duplicateTrack);
  const addTracksAndMoveClip = useEditorStore((s) => s.addTracksAndMoveClip);
  const addTracksAndDropAsset = useEditorStore((s) => s.addTracksAndDropAsset);
  const reorderTrack = useEditorStore((s) => s.reorderTrack);
  const addMarker = useEditorStore((s) => s.addMarker);
  const removeMarker = useEditorStore((s) => s.removeMarker);
  const updateMarker = useEditorStore((s) => s.updateMarker);
  const addKeyframe = useEditorStore((s) => s.addKeyframe);
  const setAssetWaveform = useEditorStore((s) => s.setAssetWaveform);
  const setAssetFilmstrip = useEditorStore((s) => s.setAssetFilmstrip);
  const patchAsset = useEditorStore((s) => s.patchAsset);

  // Proxy workflow
  const proxyManager = useProxyManager(project.assets, patchAsset);

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
  const addEffectKeyframe = useEditorStore((s) => s.addEffectKeyframe);
  const updateEffectKeyframes = useEditorStore((s) => s.updateEffectKeyframes);
  const toggleBackgroundRemoval = useEditorStore((s) => s.toggleBackgroundRemoval);
  const setBackgroundRemoval = useEditorStore((s) => s.setBackgroundRemoval);

  // Color
  const enableColorGrade = useEditorStore((s) => s.enableColorGrade);
  const setColorGrade = useEditorStore((s) => s.setColorGrade);
  const resetColorGrade = useEditorStore((s) => s.resetColorGrade);
  const updateSequenceSettings = useEditorStore((s) => s.updateSequenceSettings);

  // Stable callbacks for ColorGradingPanel — prevents infinite render loop.
  // Inline arrow functions passed as props get a new reference every render,
  // causing the grade-accumulation useEffect in ColorGradingPanel to fire
  // on every render cycle (its deps include onUpdateGrade / onEnableGrade).
  // useCallback with stable deps breaks that cycle.
  const stableEnableColorGrade = useCallback(() => {
    const id = useEditorStore.getState().selectedClipId;
    if (id) enableColorGrade(id);
  }, [enableColorGrade]);
  const stableUpdateGrade = useCallback((grade: Parameters<typeof setColorGrade>[1]) => {
    const id = useEditorStore.getState().selectedClipId;
    if (id) {
      setColorGrade(id, grade);
      updateFromGrade(grade);
    }
  }, [setColorGrade]);
  const stableResetGrade = useCallback(() => {
    const id = useEditorStore.getState().selectedClipId;
    if (id) resetColorGrade(id);
  }, [resetColorGrade]);

  // Phase 3 additions
  const rippleDelete = useEditorStore((s) => s.rippleDelete);
  const fixedPlayheadMode = useEditorStore((s) => s.fixedPlayheadMode);

  // Precision Trim
  const rippleTrim      = useEditorStore((s) => s.rippleTrim);
  const rollTrim        = useEditorStore((s) => s.rollTrim);
  const createBin       = useEditorStore((s) => s.createBin);
  const switchGradeSlot = useEditorStore((s) => s.switchGradeSlot);
  const copyGradeToSlot = useEditorStore((s) => s.copyGradeToSlot);
  const renameBin     = useEditorStore((s) => s.renameBin);
  const deleteBin     = useEditorStore((s) => s.deleteBin);
  const moveAssetToBin = useEditorStore((s) => s.moveAssetToBin);
  const slip       = useEditorStore((s) => s.slip);
  const slide      = useEditorStore((s) => s.slide);
  const toggleFixedPlayheadMode = useEditorStore((s) => s.toggleFixedPlayheadMode);
  const setTranscript = useEditorStore((s) => s.setTranscript);
  const addColorStill = useEditorStore((s) => s.addColorStill);
  const removeColorStill = useEditorStore((s) => s.removeColorStill);
  const renameColorStill = useEditorStore((s) => s.renameColorStill);

  // ── Phase 4 new store actions ───────────────────────────────────────────────
  const updateProjectMetadata = useEditorStore((s) => s.updateProjectMetadata);
  const autoLayoutTimeline    = useEditorStore((s) => s.autoLayoutTimeline);
  const nestSelectedClips     = useEditorStore((s) => s.nestSelectedClips);
  const saveClipSnapshot      = useEditorStore((s) => s.saveClipHistorySnapshot);
  const restoreClipSnapshot   = useEditorStore((s) => s.restoreClipHistorySnapshot);
  const groupNodes            = useEditorStore((s) => s.groupNodes);
  const addAssetToPoolStore   = useEditorStore((s) => s.addAssetToPool);
  // ClawFlow AI
  const autoColorMatch        = useEditorStore((s) => s.autoColorMatch);
  const normalizeAudioLevels  = useEditorStore((s) => s.normalizeAudioLevels);
  const closeAllGaps          = useEditorStore((s) => s.closeAllGaps);
  const syncMulticamClips     = useEditorStore((s) => s.syncMulticamClips);

  // Phase 8: professional parity
  const addAdjustmentLayer    = useEditorStore((s) => s.addAdjustmentLayer);
  const setDuckingSettings    = useEditorStore((s) => s.setDuckingSettings);

  // ── Fusion store actions ────────────────────────────────────────────────────
  const fusionClipId = useEditorStore((s) => s.fusionClipId);
  const openFusion   = useEditorStore((s) => s.openFusion);
  const closeFusion  = useEditorStore((s) => s.closeFusion);
  const setCompGraph = useEditorStore((s) => s.setCompGraph);

  // ── Active page – driven by store so openFusion() triggers re-render ────────
  const activePage    = useEditorStore((s) => s.activePage) as AppPage;
  const setActivePage = useEditorStore((s) => s.setActivePage) as (page: AppPage) => void;

  // ── Render cache ──────────────────────────────────────────────────────────
  const renderCache = useRenderCache(project);

  // ── Local UI state ─────────────────────────────────────────────────────────
  const [importBusy,  setImportBusy]  = useState(false);
  // Export + render queue (src/renderer/hooks/useExportController.ts). The getter
  // is read at event time, so it may reference values declared further down.
  const {
    exportBusy, exportProgress, setExportProgress, lastExportedPath, setLastExportedPath,
    renderJobs, setRenderJobs, renderQueueOpen, setRenderQueueOpen,
    handleExport, handleAddToQueue,
  } = useExportController(() => ({ project, segments, fsLinked, setExportMessage, setBridgeReady }));
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
  const [mixerOpen, setMixerOpen] = useState(() => {
    try { return localStorage.getItem("264pro_mixer_open") === "true"; } catch { return false; }
  });
  const [timelineIndexOpen, setTimelineIndexOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [shuttleSpeed, setShuttleSpeed] = useState(1); // J/K/L shuttle speed multiplier
  useEffect(() => { if (!playback.isPlaying) setShuttleSpeed(1); }, [playback.isPlaying]);
  const [clawGuideEnabled, setClawGuideEnabled] = useState(() => {
    try { return localStorage.getItem("264pro_claw_guide") !== "false"; } catch { return true; }
  });

  // Audio engine ref (populated by ViewerPanel's onAudioEngineRef callback)
  const audioEngineRef = useRef<import("./lib/AudioScheduler").AudioEngine | null>(null);

  // Render queue

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

  // ── Command Palette ────────────────────────────────────────────────────────
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // ── Storyboard ────────────────────────────────────────────────────────────
  const [storyboardOpen, setStoryboardOpen] = useState(false);
  const [editScopesOpen, setEditScopesOpen] = useState(false);
  const [colorScopesOpen, setColorScopesOpen] = useState(true);

  // ── Viewer maximize ────────────────────────────────────────────────────────
  // When true: both side panels collapse and timeline shrinks to minimum
  const [viewerMaximized, setViewerMaximized] = useState(false);
  const preMaximizeState = useRef<{ left: boolean; right: boolean; tlH: number } | null>(null);

  const toggleViewerMaximize = useCallback(() => {
    setViewerMaximized(v => {
      if (!v) {
        // Save current state before maximizing
        preMaximizeState.current = {
          left: mediaPoolOpen,
          right: inspectorOpen,
          tlH: timelineHeight,
        };
        setMediaPoolOpen(false);
        setInspectorOpen(false);
        setTimelineHeight(140);
        try { localStorage.setItem("264pro_inspector_open", "false"); } catch {}
        try { localStorage.setItem("264pro_media_pool_open", "false"); } catch {}
        try { localStorage.setItem("264pro_timeline_height", "140"); } catch {}
      } else {
        // Restore saved state
        const prev = preMaximizeState.current;
        if (prev) {
          setMediaPoolOpen(prev.left);
          setInspectorOpen(prev.right);
          setTimelineHeight(prev.tlH);
          try { localStorage.setItem("264pro_inspector_open", String(prev.right)); } catch {}
          try { localStorage.setItem("264pro_media_pool_open", String(prev.left)); } catch {}
          try { localStorage.setItem("264pro_timeline_height", String(prev.tlH)); } catch {}
        }
      }
      return !v;
    });
  }, [mediaPoolOpen, inspectorOpen, timelineHeight]);

  // ── New Feature State ──────────────────────────────────────────────────────
  const [showFollowFreebie, setShowFollowFreebie] = useState(false);
  const [aiCredits, setAiCredits] = useState<number>(() => {
    try { return Number(localStorage.getItem("264pro_ai_credits") ?? "0") || 0; } catch { return 0; }
  });
  const addAICredits = useCallback((amount: number) => {
    setAiCredits(prev => {
      const next = prev + amount;
      try { localStorage.setItem("264pro_ai_credits", String(next)); } catch {}
      return next;
    });
  }, []);

  // Auto-show Follow Freebie on first launch
  useEffect(() => {
    try {
      const seen = localStorage.getItem("264pro_follow_modal_shown");
      if (!seen) {
        const t = setTimeout(() => {
          setShowFollowFreebie(true);
          localStorage.setItem("264pro_follow_modal_shown", "1");
        }, 3500);
        return () => clearTimeout(t);
      }
    } catch { /* ignore */ }
  }, []);

  // ── One-Click Delivery Package ─────────────────────────────────────────────
  const handleDeliveryPackage = useCallback(() => {
    const baseName = project.name || "output";
    type DeliveryFormat = { label: string; codec: import("../shared/models").ExportCodec; outputWidth: number; outputHeight: number; suffix: string; audioOnly?: boolean };
    const deliveryFormats: DeliveryFormat[] = [
      { label: "YouTube 1080p", codec: "libx264", outputWidth: 1920, outputHeight: 1080, suffix: "_youtube" },
      { label: "Instagram Reel (9:16)", codec: "libx264", outputWidth: 1080, outputHeight: 1920, suffix: "_instagram_reel" },
      { label: "TikTok (9:16)", codec: "libx264", outputWidth: 1080, outputHeight: 1920, suffix: "_tiktok" },
      { label: "Twitter/X (720p)", codec: "libx264", outputWidth: 1280, outputHeight: 720, suffix: "_twitter" },
      { label: "ProRes Master", codec: "prores_ks", outputWidth: 1920, outputHeight: 1080, suffix: "_master" },
      { label: "Audio Only (AAC)", codec: "libx264", outputWidth: 0, outputHeight: 0, suffix: "_audio", audioOnly: true },
    ];
    const newJobs: RenderJob[] = deliveryFormats.map(fmt => ({
      id: createId(),
      label: `${baseName}${fmt.suffix} · ${fmt.label}`,
      codec: fmt.codec,
      outputWidth: fmt.outputWidth,
      outputHeight: fmt.outputHeight,
      audioOnly: fmt.audioOnly,
      status: "queued" as const,
      progress: 0,
      createdAt: Date.now(),
    }));
    setRenderJobs(prev => [...prev, ...newJobs]);
    setRenderQueueOpen(true);
    toast.success("🚀 6 delivery jobs queued! Switch to Render Queue to start.");
  }, [project.name]);

  // Subtitle cues state
  // Subtitle cues are part of the project (saved with it and used by export).
  const subtitleCues = useEditorStore((s) => s.project.subtitleCues) ?? NO_CUES;
  const handleAddSubtitleCue = useEditorStore((s) => s.addSubtitleCue);
  const handleUpdateSubtitleCue = useEditorStore((s) => s.updateSubtitleCue);
  const handleRemoveSubtitleCue = useEditorStore((s) => s.removeSubtitleCue);

  // Clawbot state
  const [clawbotOpen, setClawbotOpen] = useState(false);
  const [clawbotSuggestions, setClawbotSuggestions] = useState<string[]>([]);

  const analyzeTimeline = useCallback(() => {
    const fps = project.sequence.settings.fps;
    const segs = buildTimelineSegments(project.sequence, project.assets);
    const issues: string[] = [];
    // Check for audio clipping
    segs.filter(s => s.track.kind === "audio").forEach(s => {
      if ((s.clip.volume ?? 1) > 1.5) issues.push(`⚠️ "${s.asset.name}" audio may clip (volume ${Math.round((s.clip.volume ?? 1) * 100)}%)`);
    });
    // Check for gaps
    const videoSegs = segs.filter(s => s.track.kind === "video").sort((a, b) => a.startFrame - b.startFrame);
    for (let i = 1; i < videoSegs.length; i++) {
      if (videoSegs[i].startFrame > videoSegs[i - 1].endFrame + 2) {
        const tc = (() => {
          const f = videoSegs[i - 1].endFrame;
          const s2 = Math.floor(f / fps) % 60;
          const m2 = Math.floor(f / fps / 60);
          return `${m2}:${String(s2).padStart(2, "0")}`;
        })();
        issues.push(`📍 Gap at ${tc} between clips`);
      }
    }
    // Check for ungraded clips
    const vSegs = segs.filter(s => s.track.kind === "video");
    const ungraded = vSegs.filter(s => !s.clip.colorGrade || s.clip.colorGrade.bypass).length;
    if (ungraded > 0 && vSegs.length > 2) issues.push(`🎨 ${ungraded} clips have no color grade applied`);
    // Check for very short clips
    const shortClips = vSegs.filter(s => s.durationFrames < 15);
    if (shortClips.length > 0) issues.push(`⚡ ${shortClips.length} very short clips (under 0.5s) — may cause flash cuts`);
    // Gap detection with close-all-gaps suggestion
    const gapCount = videoSegs.filter((seg, i) => i > 0 && videoSegs[i].startFrame > videoSegs[i - 1].endFrame + 2).length;
    if (gapCount > 0) issues.push(`🕳 ${gapCount} gap${gapCount > 1 ? "s" : ""} detected — use Close All Gaps in toolbar to fix`);
    setClawbotSuggestions(issues.length > 0 ? issues : ["✅ Timeline looks healthy! No obvious issues found."]);
  }, [project]);

  // Subtitles / Title panels
  const [subtitlesPanelOpen, setSubtitlesPanelOpen] = useState(false);
  const [titleGenPanelOpen, setTitleGenPanelOpen] = useState(false);
  // Text-Based Editing panel
  const [textEditPanelOpen, setTextEditPanelOpen] = useState(false);
  // Keyboard Shortcuts panel
  const [shortcutsPanelOpen, setShortcutsPanelOpen] = useState(false);
  // Beat Sync panel
  const [beatSyncOpen, setBeatSyncOpen] = useState(false);
  // Auto-Reframe panel
  const [autoReframeOpen, setAutoReframeOpen] = useState(false);
  // Lasso multi-select — clips selected via rubber-band in TimelinePanel
  const [lassoSelectedIds, setLassoSelectedIds] = useState<string[]>([]);
  // Settings panel (Phase 6)
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  // Phase 9 ClawFlow Intelligence state
  const [styleProfileOpen, setStyleProfileOpen] = useState(false);
  const [intelligenceOpen, setIntelligenceOpen] = useState(false);

  // Speed ramp handlers
  const handleSetSpeedRampKeyframes = useCallback((kf: Array<{ frame: number; speed: number }>) => {
    if (!selectedClipId) return;
    patchClip(selectedClipId, { speedRampKeyframes: kf });
  }, [selectedClipId, patchClip]);
  const handleSetClipKeyframes = useCallback((kf: import('../shared/models').TimelineClip['keyframes']) => {
    if (!selectedClipId) return;
    patchClip(selectedClipId, { keyframes: kf });
  }, [selectedClipId, patchClip]);
  const handleSetOpticalFlow = useCallback((enabled: boolean) => {
    if (!selectedClipId) return;
    patchClip(selectedClipId, { opticalFlow: enabled });
  }, [selectedClipId, patchClip]);

  // Title clip handler
  const handleAddTitleToTimeline = useCallback((config: TitleClipConfig) => {
    const firstVideoTrack = project.sequence.tracks.find(t => t.kind === "video");
    if (!firstVideoTrack) { toast.warning("Add a video track first"); return; }
    // Create virtual asset
    const virtualAssetId = createId();
    const titleAsset: MediaAsset = {
      id: virtualAssetId,
      name: `Title: ${config.mainText}`,
      sourcePath: "",
      previewUrl: "",
      thumbnailUrl: null,
      durationSeconds: config.durationFrames / project.sequence.settings.fps,
      nativeFps: project.sequence.settings.fps,
      width: project.sequence.settings.width,
      height: project.sequence.settings.height,
      hasAudio: false,
    };
    addAssetToPool(titleAsset);
    const titleClip = createEmptyClip(virtualAssetId, firstVideoTrack.id, playback.playheadFrame);
    titleClip.titleConfig = config;
    insertClip(titleClip);
    toast.success(`Title "${config.mainText}" added to timeline`);
    setTitleGenPanelOpen(false);
  }, [project, playback.playheadFrame, addAssetToPool, insertClip]);

  // ── FlowState Panel ────────────────────────────────────────────────────────
  const [flowstatePanelOpen, setFlowstatePanelOpen] = useState(false);

  // Text-Based Editing: add clip from transcript selection
  const handleAddClipFromTranscript = useCallback((assetId: string, startMs: number, endMs: number) => {
    const asset = project.assets.find(a => a.id === assetId);
    const firstVideoTrack = project.sequence.tracks.find(t => t.kind === "video");
    if (!asset || !firstVideoTrack) { toast.warning("No video track found"); return; }
    // Trims are in timeline frames (see buildTimelineSegments), not source frames.
    const fps = project.sequence.settings.fps;
    const trimStart = Math.round((startMs / 1000) * fps);
    const totalFrames = Math.round(asset.durationSeconds * fps);
    const trimEnd = Math.max(0, totalFrames - Math.round((endMs / 1000) * fps));
    const clip = createEmptyClip(assetId, firstVideoTrack.id, playback.playheadFrame);
    clip.trimStartFrames = trimStart;
    clip.trimEndFrames = trimEnd;
    insertClip(clip);
    toast.success(`Added ${asset.name} clip from transcript (${((endMs - startMs) / 1000).toFixed(2)}s)`);
  }, [project, playback.playheadFrame, insertClip]);

  // ── AI Tools Panel ─────────────────────────────────────────────────────────
  const [aiToolsPanelOpen, setAiToolsPanelOpen] = useState(false);
  const [trimPanelOpen, setTrimPanelOpen] = useState(false);

  // ── Phase 4: New Panel State ────────────────────────────────────────────────
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [projectNotesPanelOpen, setProjectNotesPanelOpen] = useState(false);
  const [multicamOpen, setMulticamOpen] = useState(false);
  const [autoResizeOpen, setAutoResizeOpen] = useState(false);
  const [aiStoryboardOpen, setAiStoryboardOpen] = useState(false);
  const [shotListOpen, setShotListOpen] = useState(false);

  // ── Image to Video ─────────────────────────────────────────────────────────
  const [imageToVideoAsset, setImageToVideoAsset] = useState<import("../shared/models").MediaAsset | null>(null);

  // ── Image Gen Modal ────────────────────────────────────────────────────────
  const [imgGenOpen, setImgGenOpen] = useState(false);

  // ── CLAW Video first-launch promo ─────────────────────────────────────────
  // Shows once per install. Stored in localStorage so it never shows again.
  const [showClawPromo, setShowClawPromo] = useState(false);
  useEffect(() => {
    try {
      const seen = localStorage.getItem('264pro_claw_video_seen');
      if (!seen) {
        // Small delay so the app fully loads before the promo appears
        const t = setTimeout(() => setShowClawPromo(true), 2200);
        return () => clearTimeout(t);
      }
    } catch { /* localStorage unavailable */ }
  }, []);
  const dismissClawPromo = (openWizard = false) => {
    try { localStorage.setItem('264pro_claw_video_seen', '1'); } catch { /* ignore */ }
    setShowClawPromo(false);
    if (openWizard) {
      // Open the FlowState hub CLAW wizard in a new window
      window.open('https://flowst8.cc/#claw-video', '_blank');
    }
  };

  // ── AI Quick Bar dropdown ──────────────────────────────────────────────────
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [aiMenuPos, setAiMenuPos] = useState({ bottom: 0, right: 0 });
  const aiMenuRef = useRef<HTMLDivElement | null>(null);
  const aiBtnRef = useRef<HTMLButtonElement | null>(null);

  // Close AI menu on outside click
  useEffect(() => {
    if (!aiMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (aiMenuRef.current && !aiMenuRef.current.contains(e.target as Node)) {
        setAiMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [aiMenuOpen]);

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
  const [showSettings, setShowSettings] = useState(false);

  // Re-sync the draft every time the settings modal opens so it always shows live values
  // ── FlowState tier load + activity ping on mount ──────────────────────────
  useEffect(() => {
    if (!window.flowstateAPI) return;
    window.flowstateAPI.getUser().then((user) => {
      if (!user) return;
      setFsTier(user.tier);
      setFsLinked(true);
      // Ping activity: project_opened
      void window.flowstateAPI?.apiCall('/api/264pro/activity', 'POST', {
        event: 'project_opened',
        projectName: project.name ?? 'Untitled',
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Project file: new/open/save, dirty tracking, recent list, unsaved-changes prompt
  const [showRecentPanel, setShowRecentPanel] = useState(false);
  const projectFile = useProjectFile({
    project, fsLinked, setExportMessage,
    onProjectReplaced: () => setShowRecentPanel(false),
  });
  const {
    currentProjectPath, projectDirty, createdAtRef, markClean, recentProjects, saveConfirm,
    save: handleSaveProject, saveAs: handleSaveProjectAs, newProject: handleNewProject,
    open: handleOpenProject, openRecent: handleOpenRecentProject, requestClose, resolveSaveConfirm: handleSaveConfirmChoice,
  } = projectFile;

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

  // ── Claw Guide ──────────────────────────────────────────────────────────
  const timelineClipAssetIds = useMemo(
    () => new Set(project.sequence.clips.map(c => c.assetId)),
    [project.sequence.clips]
  );
  const { tips: clawTips, dismiss: dismissClawTip } = useClawGuide({
    enabled: clawGuideEnabled,
    clips: project.sequence.clips.map(c => ({ id: c.id, speed: c.speed, volume: c.volume, colorGrade: c.colorGrade })),
    mediaPoolAssets: project.assets,
    timelineClipIds: timelineClipAssetIds,
    playheadStallMs: 0,
    onInterpolateClip: () => setAiToolsPanelOpen(true),
    onOpenColorGrading: () => setActivePage('color'),
    onOpenMixer: () => setMixerOpen(true),
  });


  // ── Hierarchical rendering: topmost visible video clip only ───────────────
  // findAllActiveVideoSegments returns ALL overlapping video clips sorted
  // by trackIndex desc.  The first element is the clip we show in the viewer.
  // Lower clips are hidden unless transparency/mask allows see-through.
  const resolveAsset = useMemo(() => {
    const byId = new Map(project.assets.map((a) => [a.id, a]));
    return (id: string) => byId.get(id);
  }, [project.assets]);
  const usedAssetIds = useMemo(() => new Set(project.sequence.clips.map((c) => c.assetId)), [project.sequence.clips]);
  // Inner segments for nested-sequence clips (the viewer compositor renders them).
  const resolveNestedSegments = useMemo(() => {
    const cache = new Map<string, TimelineSegment[]>();
    return (clip: import("../shared/models").TimelineClip) => {
      const seq = clip.nestedSequenceId ? project.nestedSequences?.[clip.nestedSequenceId] : undefined;
      if (!seq) return null;
      let segs = cache.get(seq.id);
      if (!segs) { segs = buildTimelineSegments(seq, project.assets); cache.set(seq.id, segs); }
      return segs;
    };
  }, [project.nestedSequences, project.assets]);
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

  // Sync colorPageVideoRef with the ViewerPanel's video element.
  // Uses a callback ref pattern via useEffect with no deps — refs are stable
  // objects so this runs once on mount, which is sufficient. The ViewerPanel
  // exposes getVideoRef() imperatively so we don't need reactive tracking.
  // NOTE: no dep array intentional — runs after every commit so that if the
  // ViewerPanel remounts (page switch) the ref stays current. Writing only to
  // .current (never to state) means this cannot cause an infinite render loop.
  useEffect(() => {
    const vid = viewerPanelRef.current?.getVideoRef() ?? null;
    colorPageVideoRef.current = vid;
    viewerVideoRef.current = vid;
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    voiceStateRef.current = {
      bpm: voiceBpm,
      gridFrames: voiceGridFrames,
      markInFrame: voiceMarkInFrame,
      markOutFrame: voiceMarkOutFrame,
      suggestedCutFrames: voiceSuggestedCutFrames
    };
  });

  // ── Image gen helper ───────────────────────────────────────────────────────
  function openImageGenerator() {
    if (!fsLinked || fsTier === "free") {
      showToast("Connect FlowState Pro to generate images");
      return;
    }
    setImgGenOpen(true);
  }

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
    // Phase 9: record cut duration for style learning
    const durationSec = target.durationFrames / project.sequence.settings.fps;
    updateFromCut(durationSec);
    return true;
  }

  // ── ViewerPanel: Insert at playhead ────────────────────────────────────────
  const handleInsertAtPlayhead = useCallback((assetId: string, inFrame: number, outFrame: number) => {
    const firstVideoTrack = project.sequence.tracks.find(t => t.kind === "video");
    if (!firstVideoTrack) { toast.warning("Add a video track first"); return; }
    const insertFrame = playback.playheadFrame;
    const durationFrames = outFrame - inFrame;
    if (durationFrames <= 0) { toast.warning("Set In/Out points first"); return; }
    // Ripple: move all clips at or after playhead forward by durationFrames
    const newClip = createEmptyClip(assetId, firstVideoTrack.id, insertFrame);
    newClip.trimStartFrames = inFrame;
    newClip.trimEndFrames = Math.max(0,
      Math.round((project.assets.find(a => a.id === assetId)?.durationSeconds ?? 0) * project.sequence.settings.fps) - outFrame
    );
    insertClip(newClip);
    toast.success("✅ Clip inserted at playhead");
  }, [project, playback.playheadFrame, insertClip]);

  // ── ViewerPanel: Overwrite at playhead ─────────────────────────────────────
  const handleOverwriteAtPlayhead = useCallback((assetId: string, inFrame: number, outFrame: number) => {
    const firstVideoTrack = project.sequence.tracks.find(t => t.kind === "video");
    if (!firstVideoTrack) { toast.warning("Add a video track first"); return; }
    const insertFrame = playback.playheadFrame;
    const durationFrames = outFrame - inFrame;
    if (durationFrames <= 0) { toast.warning("Set In/Out points first"); return; }
    // Overwrite: place clip at playhead, then delete any clip segments it overlaps
    const newClip = createEmptyClip(assetId, firstVideoTrack.id, insertFrame);
    newClip.trimStartFrames = inFrame;
    newClip.trimEndFrames = Math.max(0,
      Math.round((project.assets.find(a => a.id === assetId)?.durationSeconds ?? 0) * project.sequence.settings.fps) - outFrame
    );
    insertClip(newClip);
    toast.success("✅ Clip overwritten at playhead");
  }, [project, playback.playheadFrame, insertClip]);

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
    isModalOpen: showSettings || showRecentPanel || Boolean(saveConfirm),
    onTogglePlayback: handleTogglePlayback,
    onToggleFullscreen: () => void viewerPanelRef.current?.toggleFullscreen(),
    onSelectTool: () => setToolMode("select"),
    onToggleBladeTool: toggleBladeTool,
    onSplitSelectedClip: splitSelectedClipAtPlayhead,
    onNudgePlayhead: handleStepFrames,
    onSeekToStart: () => handleSeek(0),
    onSeekToEnd: () => handleSeek(Math.max(totalFrames - 1, 0)),
    onRemoveSelectedClip: () => {
      pauseViewerPlayback();
      if (lassoSelectedIds.length > 1) {
        // Delete all lasso-selected clips
        lassoSelectedIds.forEach(id => removeClipById(id));
        setLassoSelectedIds([]);
      } else {
        removeSelectedClip();
      }
    },
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
        // K — stop and reset shuttle speed
        pauseViewerPlayback();
        setShuttleSpeed(1);
      } else if (direction === 1) {
        // L — play forward, each press doubles the shuttle rate (1× → 2× → 4× → 8×).
        // (This used to set the selected clip's speed — a destructive edit.)
        if (playback.isPlaying && shuttleSpeed > 0) {
          const next = Math.min(8, shuttleSpeed * 2);
          setShuttleSpeed(next);
          toast.info(`▶▶ ${next}×`, 800);
        } else {
          setShuttleSpeed(1);
          handleTogglePlayback();
        }
      } else {
        // J — play reverse (shuttle speed, but we simulate by seeking backward rapidly)
        if (playback.isPlaying) {
          pauseViewerPlayback();
          setShuttleSpeed(1);
        } else {
          // Jump backward 30 frames (reverse preview)
          handleSeek(Math.max(0, playback.playheadFrame - 30));
        }
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
    onSlowShuttle: (direction) => {
      if (direction === 1) {
        // Shift+L — forward at half speed
        setShuttleSpeed(0.5);
        if (!playback.isPlaying) handleTogglePlayback();
        toast.info("▶ 0.5×", 800);
      } else {
        // Shift+J — step back one frame (reverse playback isn't supported)
        pauseViewerPlayback();
        setShuttleSpeed(1);
        handleStepFrames(-1);
      }
    },
    onJumpToClipBoundary: (direction) => {
      // Jump to nearest clip start/end in the timeline
      const fps = project.sequence.settings.fps;
      const cur = playback.playheadFrame;
      const boundaries: number[] = [];
      for (const seg of segments) {
        boundaries.push(seg.startFrame, seg.startFrame + seg.durationFrames);
      }
      const sorted = [...new Set(boundaries)].sort((a, b) => a - b);
      if (direction === 1) {
        const next = sorted.find(f => f > cur);
        if (next !== undefined) handleSeek(next);
      } else {
        const prev = [...sorted].reverse().find(f => f < cur);
        if (prev !== undefined) handleSeek(prev);
      }
    },
    onJumpToNextMarker: (direction) => {
      const cur = playback.playheadFrame;
      const markerFrames = [...project.sequence.markers].map(m => m.frame).sort((a, b) => a - b);
      if (direction === 1) {
        const next = markerFrames.find(f => f > cur);
        if (next !== undefined) handleSeek(next);
      } else {
        const prev = [...markerFrames].reverse().find(f => f < cur);
        if (prev !== undefined) handleSeek(prev);
      }
    },
    onRippleDelete: () => {
      if (selectedClipId) { pauseViewerPlayback(); rippleDelete(selectedClipId); }
    },
    onDetachAudio: () => {
      if (selectedClipId) { pauseViewerPlayback(); detachLinkedClips(selectedClipId); }
    },
    onToggleClipEnabled: () => {
      if (selectedClipId) { pauseViewerPlayback(); toggleClipEnabled(selectedClipId); }
    },
    onOpenCommandPalette: () => setCommandPaletteOpen(v => !v),
    onToggleStoryboard: () => setStoryboardOpen(v => !v),
    onToggleViewerMaximize: toggleViewerMaximize,
    onToggleTrimPanel: () => setTrimPanelOpen(v => !v),
    onToggleClawbot: () => setClawbotOpen(v => !v),
    onToggleProjectNotes: () => setProjectNotesPanelOpen(v => !v),
    onToggleIntelligence: () => setIntelligenceOpen(v => !v),
    onToggleSettings: () => setSettingsPanelOpen(v => !v),
  });

  // ── Phase 9: ClawFlow Ambient Hook ────────────────────────────────────────
  // onOpenBeatSync MUST be stable (useCallback) — it's a dep inside useClawFlowAmbient's
  // analyze callback. An inline arrow here would be a new reference on every render,
  // which propagates to a new `analyze` function, which re-fires the debounce useEffect,
  // which calls setSuggestions, which re-renders App → infinite loop.
  const onOpenBeatSyncStable = useCallback(() => setBeatSyncOpen(true), []);
  const { suggestions: ambientSuggestions, dismissSuggestion: dismissAmbient, actOnSuggestion: actAmbient } = useClawFlowAmbient({
    project,
    fps: project.sequence.settings.fps,
    onAutoColorMatch: autoColorMatch,
    onNormalizeAudio: normalizeAudioLevels,
    onCloseAllGaps: closeAllGaps,
    onOpenBeatSync: onOpenBeatSyncStable,
  });

  // ── Phase 9: Voice Commands Hook ──────────────────────────────────────────
  const voice = useVoiceCommands({
    splitAtPlayhead: () => { if (selectedClipId) splitClipAtFrame(selectedClipId, playback.playheadFrame); },
    undo,
    redo,
    normalizeAudio: () => normalizeAudioLevels(-14),
    autoColorMatch,
    closeGaps: closeAllGaps,
    applyWarm: () => {
      if (!selectedClipId) return;
      const warmGrade = { temperature: 25, tint: 5, saturation: 1.1 };
      enableColorGrade(selectedClipId);
      setColorGrade(selectedClipId, warmGrade);
      updateFromGrade(warmGrade);
    },
    applyCool: () => {
      if (!selectedClipId) return;
      const coolGrade = { temperature: -20, tint: -5, saturation: 0.95 };
      enableColorGrade(selectedClipId);
      setColorGrade(selectedClipId, coolGrade);
      updateFromGrade(coolGrade);
    },
    addMarker: () => addMarker({ frame: playback.playheadFrame, label: 'Marker', color: '#f59e0b' }),
    setActivePage: (page: string) => setActivePage(page as AppPage),
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

  // ── Unsaved-work protection: close prompt, autosave, crash recovery ──────
  useProjectSafety({
    project,
    projectDirty,
    currentProjectPath,
    createdAt: createdAtRef.current,
    onCloseWhileDirty: requestClose,
    save: handleSaveProject,
    onAutosaved: () => showToast("✓ Auto-saved"),
  });

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
      try { localStorage.setItem("264pro_timeline_height", String(newH)); } catch {}
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
      if (assets.length) {
        importAssets(assets);
        // Kick off proxy generation for any qualifying assets (> 1920px or > 100MB)
        if (proxyManager.proxyEnabled) {
          assets.forEach((asset) => { void proxyManager.generateProxy(asset); });
        }
      }
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
            <button className="panel-action" onClick={() => { setShowRecentPanel(false); handleOpenProject(); }} type="button">📂 Open File…</button>
          </div>
          {recentProjects.length === 0 ? (
            <p className="recent-empty">No recent projects yet.</p>
          ) : (
            <div className="recent-list">
              {recentProjects.map((r) => (
                <button
                  key={r.path}
                  className="recent-item"
                  onClick={() => handleOpenRecentProject(r.path)}
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

  // ── ImageToVideoModal ─────────────────────────────────────────────────────
  function renderImageToVideoModal() {
    if (!imageToVideoAsset) return null;
    const asset = imageToVideoAsset;
    return (
      <ImageToVideoModal
        asset={asset}
        fsTier={fsTier}
        fsLinked={fsLinked}
        onClose={() => setImageToVideoAsset(null)}
        onAddToMediaPool={(videoUrl, name) => {
          // Import the generated video URL as an asset
          const newAsset: import("../shared/models").MediaAsset = {
            id: `ai_vid_${Date.now()}`,
            name,
            sourcePath: videoUrl,
            previewUrl: videoUrl,
            thumbnailUrl: null,
            durationSeconds: 5,
            width: asset.width || 1920,
            height: asset.height || 1080,
            nativeFps: 24,
            hasAudio: false,
            isHDR: false,
            videoCodec: "h264",
          };
          importAssets([newAsset]);
          showToast("Video generated — added to Media Pool");
          setImageToVideoAsset(null);
        }}
      />
    );
  }

  // ── ImageGenModal ──────────────────────────────────────────────────────────
  function renderImageGenModal() {
    if (!imgGenOpen) return null;
    return (
      <ImageGenModal
        assets={project.assets}
        fsTier={fsTier}
        fsLinked={fsLinked}
        onClose={() => setImgGenOpen(false)}
        onAddToMediaPool={(imageUrl, name) => {
          const newAsset: import("../shared/models").MediaAsset = {
            id: `ai_img_${Date.now()}`,
            name,
            sourcePath: imageUrl,
            previewUrl: imageUrl,
            thumbnailUrl: imageUrl,
            durationSeconds: 0,
            width: 1024,
            height: 1024,
            nativeFps: 0,
            hasAudio: false,
          };
          importAssets([newAsset]);
          showToast("Image added to Media Pool");
        }}
      />
    );
  }

  const shellStyle = {
    "--left-panel-width": mediaPoolOpen ? `${leftPanelWidth}px` : "0px",
    "--left-resizer-width": mediaPoolOpen ? "3px" : "0px",
    "--right-panel-width": inspectorOpen ? `${rightPanelWidth}px` : "0px",
    "--right-resizer-width": inspectorOpen ? "3px" : "0px",
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
      <ProjectSettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        project={project}
        currentProjectPath={currentProjectPath}
        projectDirty={projectDirty}
        onSaveProject={handleSaveProject}
        onSaveProjectAs={handleSaveProjectAs}
        onOpenProject={handleOpenProject}
        onNewProject={handleNewProject}
        updateSequenceSettings={updateSequenceSettings}
        showToast={showToast}
      />
      {renderRecentPanel()}

      {/* ── Toast notification system ── */}
      <ToastContainer />

      {/* ── Claw Guide (contextual AI assistance) ── */}
      <ClawGuide enabled={clawGuideEnabled} tips={clawTips} onDismiss={dismissClawTip} />

      {/* ── Render Queue Panel (floating) ── */}
      {renderQueueOpen && (
        <div style={{ position: "fixed", bottom: 60, right: 16, zIndex: 5000, width: 360 }}>
          <RenderQueuePanel
            jobs={renderJobs}
            onRemoveJob={(id) => setRenderJobs((prev) => prev.filter((j) => j.id !== id))}
            onRetryJob={(id) => setRenderJobs((prev) => prev.map((j) => j.id === id ? { ...j, status: "queued" as const, progress: 0, errorMessage: undefined } : j))}
            onRevealOutput={(outputPath) => { void window.editorApi?.showInFolder?.(outputPath); }}
            onClose={() => setRenderQueueOpen(false)}
            projectName={project.name}
            project={project}
            hasOpticalFlowClips={project.sequence.clips.some(c => c.opticalFlow && (c.speed ?? 1) < 1)}
            onDeliveryPackage={handleDeliveryPackage}
            onAddBatchJobs={(presets: BatchPreset[]) => {
              const newJobs = presets.map(p => ({
                id: createId(),
                label: `${project.name}${p.suffix} · ${p.label}`,
                codec: p.codec,
                outputWidth: p.width,
                outputHeight: p.height,
                status: "queued" as const,
                progress: 0,
                createdAt: Date.now(),
              }));
              setRenderJobs(prev => [...prev, ...newJobs]);
              toast.success(`Added ${newJobs.length} batch jobs to queue`);
            }}
          />
        </div>
      )}

      {/* ── Command Palette ── */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        commands={buildCommandList({
          onTogglePlayback: handleTogglePlayback,
          onSave: () => void handleSaveProject(),
          onSaveAs: () => void handleSaveProjectAs(),
          onOpen: () => void handleOpenProject(),
          onNewProject: handleNewProject,
          onExport: () => void handleExport(),
          onUndo: undo,
          onRedo: redo,
          onSplitClip: splitSelectedClipAtPlayhead,
          onDuplicateClip: () => { if (selectedClipId) duplicateClip(selectedClipId); },
          onRemoveClip: () => { pauseViewerPlayback(); removeSelectedClip(); },
          onFitTimeline: () => timelineZoomRef.current?.fitToWindow(),
          onZoomIn: () => timelineZoomRef.current?.zoomIn(),
          onZoomOut: () => timelineZoomRef.current?.zoomOut(),
          onAddMarker: () => addMarker({ frame: playback.playheadFrame, label: "", color: "#f7c948" }),
          onToggleMediaPool: () => setMediaPoolOpen(v => !v),
          onToggleInspector: () => setInspectorOpen(v => !v),
          onToggleFullscreen: () => void viewerPanelRef.current?.toggleFullscreen(),
          onSeekToStart: () => handleSeek(0),
          onSeekToEnd: () => handleSeek(Math.max(totalFrames - 1, 0)),
          onSelectTool: () => setToolMode("select"),
          onBladeTool: toggleBladeTool,
          onColorPage: () => setActivePage("color"),
          onEditPage: () => setActivePage("edit"),
          onFusionPage: () => { if (selectedClipId) { openFusion(selectedClipId); setActivePage("fusion"); } },
          onToggleStoryboard: () => setStoryboardOpen(v => !v),
          onDetachAudio: () => { if (selectedClipId) { pauseViewerPlayback(); detachLinkedClips(selectedClipId); } },
          onToggleClipEnabled: () => { if (selectedClipId) { pauseViewerPlayback(); toggleClipEnabled(selectedClipId); } },
        })}
      />

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
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); setTemplateModalOpen(true); }} type="button">
                <span className="fmi-icon">📋</span> New from Template…
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
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); setAutoResizeOpen(true); }} type="button">
                <span className="fmi-icon">📱</span> Social Auto-Resize…
              </button>
              <div className="file-menu-sep" />
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); setProjectNotesPanelOpen(true); }} type="button">
                <span className="fmi-icon">📋</span> Project Notes… <span className="fmi-kbd">⌘⇧N</span>
              </button>
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); setShowSettings(true); }} type="button">
                <span className="fmi-icon">⚙️</span> Settings…
              </button>
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); setShortcutsPanelOpen(true); }} type="button">
                <span className="fmi-icon">⌨️</span> Keyboard Shortcuts…
              </button>
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); setSettingsPanelOpen(true); }} type="button">
                <span className="fmi-icon">🤖</span> AI & API Keys… (⌘,)
              </button>
              <button className="file-menu-item" onClick={() => { setFileMenuOpen(false); window.dispatchEvent(new CustomEvent("264pro:show-onboarding")); }} type="button">
                <span className="fmi-icon">❓</span> Feature Tour…
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
          {(["edit", "color", "audio", "fusion"] as const).map((page) => (
            <button
              key={page}
              className={`page-tab${activePage === page ? " active" : ""}${page === "fusion" ? " fusion-tab" : ""}`}
              onClick={() => {
                if (page === "fusion") {
                  const clipId = selectedClipId ?? project.sequence.clips.find(c => {
                    const asset = project.assets.find(a => a.id === c.assetId);
                    return asset && (asset.videoCodec != null || asset.width > 0);
                  })?.id ?? "";
                  openFusion(clipId);
                } else {
                  setActivePage(page);
                }
              }}
              type="button"
              title={page === "fusion" ? "Open Fusion node compositor" : page === "audio" ? "ClawSound Audio Engineering" : undefined}
            >
              {page === "fusion" ? "⬡ NodeFX" : page === "audio" ? "🎚 Audio" : page.charAt(0).toUpperCase() + page.slice(1)}
            </button>
          ))}
          <button
            className={`page-tab${activePage === "publish" ? " active" : ""}`}
            onClick={() => setActivePage("publish")}
            type="button"
            style={{ color: activePage === "publish" ? "#c4b5fd" : undefined }}
            title="ClawFlow Publish — publish to YouTube, TikTok, Instagram"
          >
            🚀 Publish
          </button>
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
            className={`panel-toggle-btn${viewerMaximized ? " on" : ""}`}
            onClick={toggleViewerMaximize}
            title="Maximize Viewer (\) — hides panels and shrinks timeline for a full view"
            type="button"
            style={viewerMaximized ? { color: "#f5c542", borderColor: "rgba(245,197,66,0.4)", background: "rgba(245,197,66,0.1)" } : {}}
          >
            {viewerMaximized ? "⊡ Restore" : "⊞ Maximize"}
          </button>
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
          <button
            className={`panel-toggle-btn${mixerOpen ? " on" : ""}`}
            onClick={() => {
              setMixerOpen((v) => {
                const next = !v;
                try { localStorage.setItem("264pro_mixer_open", String(next)); } catch {}
                return next;
              });
            }}
            title="Toggle Audio Mixer"
            type="button"
          >
            🎚 Mixer
          </button>
          <button
            className={`panel-toggle-btn${timelineIndexOpen ? " on" : ""}`}
            onClick={() => setTimelineIndexOpen(v => !v)}
            title="Timeline Index — search clips, markers and color labels"
            type="button"
          >
            🗂 Index
          </button>
          <button
            className={`panel-toggle-btn${transcriptOpen ? " on" : ""}`}
            onClick={() => setTranscriptOpen(v => !v)}
            title="Transcript Editor — Descript-style text-based editing + Scene Detection"
            type="button"
            style={{
              background: transcriptOpen ? 'rgba(167,139,250,0.15)' : undefined,
              borderColor: transcriptOpen ? 'rgba(167,139,250,0.4)' : undefined,
              color: transcriptOpen ? '#a78bfa' : undefined,
            }}
          >
            📝 Transcript
          </button>
          <button
            className="panel-toggle-btn"
            onClick={() => setMagneticTimeline(!magneticTimeline)}
            title={magneticTimeline ? 'Magnetic Timeline ON — gaps auto-close on delete (click to disable)' : 'Magnetic Timeline OFF — gaps stay open on delete (click to enable)'}
            type="button"
            style={{
              background: magneticTimeline ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.04)',
              borderColor: magneticTimeline ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.12)',
              color: magneticTimeline ? '#34d399' : 'rgba(255,255,255,0.3)',
            }}
          >
            🧲 {magneticTimeline ? 'Magnetic' : 'No Snap'}
          </button>
          <button
            className={`panel-toggle-btn${renderQueueOpen ? " on" : ""}`}
            onClick={() => setRenderQueueOpen((v) => !v)}
            title="Render Queue"
            type="button"
            style={{ position: "relative" }}
          >
            ⚙️ Queue
            {renderJobs.filter((j) => j.status === "queued" || j.status === "rendering").length > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -4,
                width: 14, height: 14, borderRadius: "50%",
                background: "#f7c948", color: "#000",
                fontSize: "0.55rem", fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {renderJobs.filter((j) => j.status === "queued" || j.status === "rendering").length}
              </span>
            )}
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
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#10b981",
                display: "inline-block",
                verticalAlign: "middle",
                flexShrink: 0,
              }} />
            )}
          </button>

          {/* AI Tools Panel toggle */}
          <button
            className={`panel-toggle-btn${aiToolsPanelOpen ? " on" : ""}`}
            onClick={() => setAiToolsPanelOpen((v) => !v)}
            title="AI Tools — Upscale, Denoise, Rotoscope, Slow-Mo, Face Enhance…"
            type="button"
            style={{
              background: aiToolsPanelOpen
                ? "linear-gradient(135deg,rgba(236,72,153,0.25),rgba(245,158,11,0.25))"
                : undefined,
              borderColor: aiToolsPanelOpen ? "rgba(236,72,153,0.4)" : undefined,
              color: aiToolsPanelOpen ? "#f9a8d4" : undefined,
            }}
          >
            ⚡ AI Tools
          </button>

          {/* 🎬 Render Cache button */}
          <button
            className="panel-toggle-btn"
            onClick={renderCache.progress > 0 ? renderCache.abort : () => void renderCache.renderAll()}
            title="Pre-render timeline segments to disk for smooth playback"
            type="button"
            style={{
              padding: '5px 12px', borderRadius: 6, border: '1px solid #334155',
              background: renderCache.progress > 0 ? '#1a2744' : '#0f172a',
              color: renderCache.progress > 0 ? '#60a5fa' : '#94a3b8',
              cursor: 'pointer', fontSize: 11, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {renderCache.progress > 0 ? (
              <>🎬 Rendering… {renderCache.progress}%</>
            ) : (
              <>🎬 Render Cache</>
            )}
          </button>

          {/* Free Credits button */}
          <button
            className="panel-toggle-btn"
            onClick={() => setShowFollowFreebie(true)}
            title="Get free AI credits by following on social media"
            type="button"
            style={{ background: "rgba(124,58,237,0.15)", borderColor: "rgba(124,58,237,0.4)", color: "#c4b5fd" }}
          >
            🎁 {aiCredits > 0 ? `${aiCredits} Credits` : "Free Credits"}
          </button>

          {/* Phase 9: Voice Command button */}
          <button
            className="panel-toggle-btn"
            onClick={voice.listening ? voice.stop : voice.start}
            title={voice.listening ? "Listening… (click to stop)" : "Voice command (click to speak)"}
            type="button"
            style={{
              background: voice.listening ? "rgba(220,38,38,0.25)" : undefined,
              borderColor: voice.listening ? "rgba(220,38,38,0.5)" : undefined,
              color: voice.listening ? "#fca5a5" : undefined,
            }}
          >
            🎤 {voice.listening ? "Listening…" : "Voice"}
          </button>
          {voice.lastCommand && (
            <span style={{ fontSize: 11, color: "#94a3b8", padding: "0 4px", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {voice.lastCommand}
            </span>
          )}

          {/* Phase 9: Style Profile button */}
          <button
            className={`panel-toggle-btn${styleProfileOpen ? " on" : ""}`}
            onClick={() => setStyleProfileOpen(v => !v)}
            title="ClawFlow Style Profile — learned edit style"
            type="button"
            style={{
              background: styleProfileOpen ? "rgba(124,58,237,0.25)" : undefined,
              borderColor: styleProfileOpen ? "rgba(124,58,237,0.4)" : undefined,
              color: styleProfileOpen ? "#c4b5fd" : undefined,
            }}
          >
            ⚡ Style
          </button>

          {/* Phase 9: Project Intelligence button */}
          <button
            className={`panel-toggle-btn${intelligenceOpen ? " on" : ""}`}
            onClick={() => setIntelligenceOpen(v => !v)}
            title="Project Intelligence Dashboard (⌘⇧I)"
            type="button"
            style={{
              background: intelligenceOpen ? "rgba(124,58,237,0.25)" : undefined,
              borderColor: intelligenceOpen ? "rgba(124,58,237,0.4)" : undefined,
              color: intelligenceOpen ? "#c4b5fd" : undefined,
            }}
          >
            📊 Intel
          </button>

          {/* Clawbot button */}
          <button
            className={`panel-toggle-btn${clawbotOpen ? " on" : ""}`}
            onClick={() => setClawbotOpen(v => !v)}
            title="Clawbot AI Assistant (Ctrl+Shift+A)"
            type="button"
            style={{
              background: clawbotOpen ? "rgba(124,58,237,0.25)" : undefined,
              borderColor: clawbotOpen ? "rgba(124,58,237,0.5)" : undefined,
              color: clawbotOpen ? "#c4b5fd" : undefined,
            }}
          >
            🤖 Clawbot
          </button>

          {/* Subtitles button */}
          <button
            className={`panel-toggle-btn${subtitlesPanelOpen ? " on" : ""}`}
            onClick={() => setSubtitlesPanelOpen(v => !v)}
            title="Subtitles / Captions"
            type="button"
          >
            📝 Subtitles
          </button>

          {/* Text-Based Editing button */}
          <button
            className={`panel-toggle-btn${textEditPanelOpen ? " on" : ""}`}
            onClick={() => setTextEditPanelOpen(v => !v)}
            title="Text-Based Editing — edit by transcript"
            type="button"
          >
            📝 Text Edit
          </button>

          {/* Title Generator button */}
          <button
            className={`panel-toggle-btn${titleGenPanelOpen ? " on" : ""}`}
            onClick={() => setTitleGenPanelOpen(v => !v)}
            title="Title Generator"
            type="button"
          >
            T Titles
          </button>

          {/* Phase 4: New panel buttons */}
          <button
            className={`panel-toggle-btn${multicamOpen ? " on" : ""}`}
            onClick={() => setMulticamOpen(v => !v)}
            title="Multicam Angle Viewer — cut between camera angles"
            type="button"
            style={{ borderColor: "rgba(79,142,247,0.3)", color: multicamOpen ? "#4f8ef7" : undefined }}
          >
            📹 Multicam
          </button>
          <button
            className="panel-toggle-btn"
            onClick={() => setAiStoryboardOpen(true)}
            title="AI Storyboard → Timeline — generate a rough cut from a description"
            type="button"
            style={{ borderColor: "rgba(168,85,247,0.3)", color: "#a855f7" }}
          >
            🤖 Storyboard
          </button>
          <button
            className="panel-toggle-btn"
            onClick={() => setShotListOpen(true)}
            title="Shot List & Script Integration — import fountain/plain text scripts"
            type="button"
            style={{ borderColor: "rgba(47,199,122,0.3)", color: "#2fc77a" }}
          >
            🎞 Shot List
          </button>
          {/* Phase 5: ClawFlow buttons */}
          <button
            className={`panel-toggle-btn${beatSyncOpen ? " on" : ""}`}
            onClick={() => setBeatSyncOpen(v => !v)}
            title="Beat Sync — detect beats and auto-cut video to music"
            type="button"
            style={{ borderColor: "rgba(168,85,247,0.3)", color: beatSyncOpen ? "#c4b5fd" : "#a855f7" }}
          >
            🥁 Beat Sync
          </button>
          <button
            className={`panel-toggle-btn${autoReframeOpen ? " on" : ""}`}
            onClick={() => setAutoReframeOpen(v => !v)}
            title="Auto-Reframe — AI crop to any aspect ratio (9:16, 1:1, 4:5, 16:9, 4:3)"
            type="button"
            style={{ borderColor: "rgba(59,130,246,0.3)", color: autoReframeOpen ? "#93c5fd" : "#3b82f6" }}
          >
            🎯 Reframe
          </button>
          <button
            className="panel-toggle-btn"
            onClick={() => { closeAllGaps(); toast.success("✅ All timeline gaps closed"); }}
            title="Close All Gaps — ripple all clips together"
            type="button"
            style={{ borderColor: "rgba(239,68,68,0.3)", color: "#f87171" }}
          >
            🕳 Close Gaps
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

        {/* ── Phase 9: ClawFlow Ambient Banner (shown on any non-fusion page) ── */}
        {activePage !== "fusion" && ambientSuggestions.length > 0 && (() => {
          const s = ambientSuggestions[0];
          return (
            <div style={{
              height: 36, background: "linear-gradient(90deg, #1e1b4b, #312e81)",
              borderBottom: "1px solid #4c1d95", display: "flex", alignItems: "center",
              padding: "0 16px", gap: 12, flexShrink: 0, zIndex: 50,
            }}>
              <span style={{ fontSize: 11, color: "#c4b5fd", fontWeight: 700 }}>⚡ ClawFlow</span>
              <span style={{ fontSize: 12, color: "#e2e8f0", flex: 1 }}>{s.message}</span>
              <button onClick={() => actAmbient(s.id)} style={{
                padding: "4px 12px", borderRadius: 6, border: "none",
                background: "#7c3aed", color: "white", fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}>{s.actionLabel}</button>
              <button onClick={() => dismissAmbient(s.id)} style={{
                background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14,
              }}>✕</button>
            </div>
          );
        })()}

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
                fsTier={fsTier}
                fsLinked={fsLinked}
                onImageToVideo={(asset) => setImageToVideoAsset(asset)}
                bins={project.bins}
                assetBins={project.assetBins}
                onCreateBin={createBin}
                usedAssetIds={usedAssetIds}
                onRenameBin={renameBin}
                onDeleteBin={deleteBin}
                onMoveAssetToBin={moveAssetToBin}
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
                <button
                  className={`tool-btn${trimPanelOpen ? " active" : ""}`}
                  onClick={() => setTrimPanelOpen(v => !v)}
                  title="Precision Trim (T)"
                  type="button"
                >
                  ✂
                  <span className="tool-btn-label">Trim</span>
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
                <div className="tool-toolbar-sep" />
                <button
                  className={`tool-btn${editScopesOpen ? " active" : ""}`}
                  onClick={() => setEditScopesOpen(v => !v)}
                  title="Toggle Video Scopes"
                  type="button"
                >
                  📊
                  <span className="tool-btn-label">Scopes</span>
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
                onAudioEngineRef={(engine) => { audioEngineRef.current = engine; }}
                subtitleCues={subtitleCues}
                onInsertAtPlayhead={handleInsertAtPlayhead}
                onOverwriteAtPlayhead={handleOverwriteAtPlayhead}
                getCachedVideoPath={renderCache.getCachedPath}
                sequenceSize={project.sequence.settings}
                resolveNestedSegments={resolveNestedSegments}
                resolveAsset={resolveAsset}
                shuttleRate={shuttleSpeed}
                onVoiceoverRecorded={(asset, frame) => { addRecordedAudio(asset, frame); toast.success(`🎙 Voiceover added: ${asset.name}`); }}
              />
              {/* Edit-page Video Scopes — toggleable via Scopes toolbar button */}
              {editScopesOpen && (
                <div style={{ padding: "6px 8px 0 8px" }}>
                  <VideoScopesPanel videoRef={viewerVideoRef} width={320} height={150} refreshMs={150} />
                </div>
              )}
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
              exportProgress={exportProgress}
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
              onAddEffectKeyframe={(effectId, paramKey, frame, value) => {
                if (selectedClipId) addEffectKeyframe(selectedClipId, effectId, paramKey, frame, value);
              }}
              onUpdateEffectKeyframes={(effectId, paramName, keyframes) => {
                if (selectedClipId) updateEffectKeyframes(selectedClipId, effectId, paramName, keyframes);
              }}
              currentPlayheadFrame={playback.playheadFrame}
              totalFrames={totalFrames}
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
              onRippleDelete={() => { if (selectedClipId) { pauseViewerPlayback(); rippleDelete(selectedClipId); } }}
              onSetClipVolume={(vol) => { if (selectedClipId) setClipVolume(selectedClipId, vol); }}
              onSetClipSpeed={(spd) => { if (selectedClipId) setClipSpeed(selectedClipId, spd); }}
              onSetSpeedRampKeyframes={handleSetSpeedRampKeyframes}
              onSetClipKeyframes={handleSetClipKeyframes}
              onSetOpticalFlow={handleSetOpticalFlow}
              onSetOpticalFlowQuality={(quality) => {
                if (!selectedClipId) return;
                patchClip(selectedClipId, { opticalFlowQuality: quality });
              }}
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
              onAddToQueue={handleAddToQueue}
              />
            </div>{/* /inspector-collapse */}

            {/* ── Timeline Index Panel (collapsible, overlays media area) ── */}
            {timelineIndexOpen && (
              <div style={{ position: 'absolute', top: 0, left: 0, width: 220, height: '100%', zIndex: 30, boxShadow: '4px 0 16px rgba(0,0,0,0.5)' }}>
                <TimelineIndexPanel
                  clips={project.sequence.clips}
                  tracks={project.sequence.tracks}
                  markers={project.sequence.markers ?? []}
                  assets={project.assets}
                  fps={project.sequence.settings.fps}
                  playheadFrame={playback.playheadFrame}
                  onSeek={(frame) => { setPlayheadFrame(frame); }}
                  onSelectClip={(clipId) => { selectClip(clipId); }}
                />
              </div>
            )}

            {/* ── Transcript Editor Panel ── */}
            {transcriptOpen && (() => {
              const inspClip = project.sequence.clips.find(c => c.id === selectedClipId);
              const inspAsset = inspClip ? project.assets.find(a => a.id === inspClip.assetId) : null;
              return (
                <div style={{ position: 'absolute', top: 0, right: 0, width: 340, height: '100%', zIndex: 30, boxShadow: '-4px 0 16px rgba(0,0,0,0.5)', background: '#0d1117', borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0, gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa' }}>📝 Transcript & Scenes</span>
                    <button type="button" onClick={() => setTranscriptOpen(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 16 }}>×</button>
                  </div>
                  <TranscriptEditor
                    clipId={selectedClipId}
                    clipPath={inspAsset?.sourcePath ?? null}
                    clipName={inspAsset?.name ?? 'No clip selected'}
                    clipStartFrame={inspClip?.startFrame ?? 0}
                    fps={project.sequence.settings.fps}
                    onDeleteFrameRanges={(ranges) => {
                      // Split at range boundaries, then ripple-delete the middle clips
                      ranges.forEach(r => {
                        splitClipAtFrame(selectedClipId!, r.startFrame);
                        splitClipAtFrame(selectedClipId!, r.endFrame);
                      });
                    }}
                    onSplitAtFrames={(frames) => {
                      frames.forEach(f => splitClipAtFrame(selectedClipId!, f));
                    }}
                    onAddCaptionTrack={(words, style) => {
                      const clip = project.sequence.clips.find(c => c.id === selectedClipId);
                      addCaptionsFromTranscript(words, project.sequence.settings.fps, clip?.startFrame ?? 0, style);
                    }}
                    onSeek={setPlayheadFrame}
                  />
                </div>
              );
            })()}

            {/* Timeline resize handle — stays in grid-area: tl-resize */}
            <div
              className={`timeline-vertical-resizer${isResizingTimeline ? " dragging" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); setIsResizingTimeline(true); }}
              onDoubleClick={() => {
                const defaultH = 220;
                setTimelineHeight(defaultH);
                try { localStorage.setItem("264pro_timeline_height", String(defaultH)); } catch {}
              }}
              title="Drag to resize timeline · Double-click to reset"
              role="separator"
            />

            {/* ── Timeline area wrapper — all timeline content in one grid cell ── */}
            <div className="timeline-area-wrapper">

            {/* AI Quick Action Bar — shown when a clip is selected */}
            {selectedClipId && (
              <div className="ai-quick-bar">
                <span className="ai-quick-label">CLIP</span>
                <button className="ai-quick-btn" type="button" title="Split at playhead (Ctrl+B)"
                  onClick={() => { pauseViewerPlayback(); splitSelectedClipAtPlayhead(); }}>
                  ✂ Split
                </button>
                <button className="ai-quick-btn" type="button" title="Duplicate clip (Ctrl+D)"
                  onClick={() => { pauseViewerPlayback(); if (selectedClipId) duplicateClip(selectedClipId); }}>
                  ⧉ Dup
                </button>
                <button className="ai-quick-btn" type="button" title="Delete clip (Del)"
                  onClick={() => { pauseViewerPlayback(); removeSelectedClip(); }}>
                  🗑 Del
                </button>
                <div className="ai-quick-sep" />
                <button className="ai-quick-btn" type="button" title="Open in Fusion"
                  onClick={() => { if (selectedClipId) { openFusion(selectedClipId); setActivePage("fusion"); } }}>
                  ⬡ Fusion
                </button>
                <button className="ai-quick-btn" type="button" title="Color grade this clip"
                  onClick={() => setActivePage("color")}>
                  🎨 Color
                </button>
                <div className="ai-quick-sep" />
                <div style={{ position: "relative" }} ref={aiMenuRef}>
                  <button
                    ref={aiBtnRef}
                    className={`ai-quick-btn ai${aiMenuOpen ? " active" : ""}`}
                    type="button"
                    title="AI operations"
                    onClick={() => {
                      if (aiBtnRef.current) {
                        const r = aiBtnRef.current.getBoundingClientRect();
                        setAiMenuPos({ bottom: window.innerHeight - r.top + 4, right: window.innerWidth - r.right });
                      }
                      setAiMenuOpen(o => !o);
                    }}
                  >
                    🤖 AI ▾
                  </button>
                  {aiMenuOpen && (
                    <div className="ai-quick-dropdown" style={{ bottom: aiMenuPos.bottom, right: aiMenuPos.right }}>
                      <div className="ai-qdrop-header">AI Tools</div>
                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) { pauseViewerPlayback(); toggleBackgroundRemoval(selectedClipId); showToast("Background removal toggled"); }
                      }}>
                        ✂ Remove Background
                      </button>
                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) {
                          pauseViewerPlayback();
                          addEffectToClip(selectedClipId, { id: `fx_${Date.now()}`, type: "ai_upscale", enabled: true, order: 0, maskIds: [], keyframes: {}, params: { scale: 2, model: "realesrgan" } });
                          showToast("AI Upscale 2x — applies on export");
                        }
                      }}>Upscale 2x (AI)</button>

                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) {
                          pauseViewerPlayback();
                          addEffectToClip(selectedClipId, { id: `fx_${Date.now()}`, type: "ai_denoise", enabled: true, order: 0, maskIds: [], keyframes: {}, params: { strength: 0.7, temporal: true } });
                          showToast("AI Denoise — reduces noise on export");
                        }
                      }}>Denoise (AI)</button>

                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) {
                          pauseViewerPlayback();
                          addEffectToClip(selectedClipId, { id: `fx_${Date.now()}`, type: "ai_stabilize", enabled: true, order: 0, maskIds: [], keyframes: {}, params: { strength: 0.8, cropRatio: 0.05 } });
                          showToast("AI Stabilize — smooths camera shake on export");
                        }
                      }}>Stabilize (AI)</button>

                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) {
                          pauseViewerPlayback();
                          addEffectToClip(selectedClipId, { id: `fx_${Date.now()}`, type: "ai_face_enhance", enabled: true, order: 0, maskIds: [], keyframes: {}, params: { strength: 0.85, model: "codeformer" } });
                          showToast("AI Face Enhance — restores facial detail on export");
                        }
                      }}>Face Enhance (AI)</button>

                      <div className="ai-qdrop-sep" />
                      <button className="ai-qdrop-item" onClick={() => { setAiMenuOpen(false); openImageGenerator(); }}>
                        🖼 Generate Image (AI)
                      </button>
                      <div className="ai-qdrop-sep" />
                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) {
                          pauseViewerPlayback();
                          addEffectToClip(selectedClipId, { id: `fx_${Date.now()}`, type: "filmnoise", enabled: true, order: 0, maskIds: [], keyframes: {}, params: { intensity: 0.4, grainSize: 1.2 } });
                          showToast("Film noise effect added");
                        }
                      }}>
                        🎞 Add Film Grain
                      </button>
                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) {
                          pauseViewerPlayback();
                          addEffectToClip(selectedClipId, { id: `fx_${Date.now()}`, type: "vignette", enabled: true, order: 0, maskIds: [], keyframes: {}, params: { intensity: 0.5, radius: 0.7, feather: 0.4 } });
                          showToast("Vignette added");
                        }
                      }}>
                        🔵 Add Vignette
                      </button>
                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) {
                          pauseViewerPlayback();
                          addEffectToClip(selectedClipId, { id: `fx_${Date.now()}`, type: "chromatic_aberration", enabled: true, order: 0, maskIds: [], keyframes: {}, params: { amount: 3 } });
                          showToast("Chromatic aberration added");
                        }
                      }}>
                        🌈 Chromatic Aberration
                      </button>
                      <div className="ai-qdrop-sep" />
                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        if (selectedClipId) { openFusion(selectedClipId); setActivePage("fusion"); }
                      }}>
                        ⬡ Open in Fusion
                      </button>
                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        setActivePage("color");
                      }}>
                        🎨 Open in Color
                      </button>
                      <div className="ai-qdrop-sep" />
                      <button className="ai-qdrop-item" onClick={() => {
                        setAiMenuOpen(false);
                        setFlowstatePanelOpen(true);
                      }}>
                        ✨ FlowState AI
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Storyboard view (toggle with G key) */}
            {storyboardOpen && (
              <div style={{ height: 160, borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
                <StoryboardView
                  trackLayouts={trackLayouts}
                  selectedClipId={selectedClipId}
                  playheadFrame={playback.playheadFrame}
                  sequenceFps={project.sequence.settings.fps}
                  onSelectClip={selectClip}
                  onSeekToFrame={handleSeek}
                  onDeleteClip={(clipId) => { pauseViewerPlayback(); removeClipById(clipId); }}
                  onDuplicateClip={(clipId) => { pauseViewerPlayback(); duplicateClip(clipId); }}
                  onSplitClip={(clipId, frame) => { pauseViewerPlayback(); splitClipAtFrame(clipId, frame); }}
                  onReorderClips={reorderClips}
                />
              </div>
            )}

            {/* Precision Trim Panel */}
            {trimPanelOpen && activePage === 'edit' && (
              <PrecisionTrimPanel
                project={project}
                fps={project.sequence.settings.fps}
                selectedClipId={selectedClipId}
                onRippleTrim={rippleTrim}
                onRollTrim={rollTrim}
                onSlip={slip}
                onSlide={slide}
                onClose={() => setTrimPanelOpen(false)}
              />
            )}

            {/* Timeline */}
            <TimelinePanel
              onSetAutomationKeyframe={setAutomationKeyframe}
              onRemoveAutomationKeyframe={removeAutomationKeyframe}
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
              onRippleTrim={rippleTrim}
              onRollTrim={rollTrim}
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
                const msg1 = setSelectedClipTransitionType(edge, transType as import("../shared/models").ClipTransitionType);
                setTransitionMessage(msg1);
                updateFromTransition(transType);
              }}
              assets={project.assets}
              markers={project.sequence.markers}
              onAddMarker={(frame) => addMarker({ frame, label: "", color: "#f7c948" })}
              onRemoveMarker={(id) => removeMarker(id)}
              onUpdateMarker={(id, updates) => updateMarker(id, updates)}
              onAddKeyframe={(clipId, property, frame, value) => addKeyframe(clipId, property, frame, value)}
              fixedPlayheadMode={fixedPlayheadMode}
              onToggleFixedPlayheadMode={toggleFixedPlayheadMode}
              onAutoLayout={autoLayoutTimeline}
              onNestClips={(clipIds, label) => nestSelectedClips(clipIds, label)}
              onSaveClipSnapshot={(clipId, label) => saveClipSnapshot(clipId, label)}
              onRestoreClipSnapshot={(clipId, snapshotId) => restoreClipSnapshot(clipId, snapshotId)}
              clipHistoryMap={Object.fromEntries(project.sequence.clips.filter(c => c.clipHistory && c.clipHistory.length > 0).map(c => [c.id, c.clipHistory!]))}
              onAddAdjustmentLayer={addAdjustmentLayer}
              onGenerateBRollForGap={(_start, _end) => { setAiToolsPanelOpen(true); }}
              onGenerateBRollForClip={(clipId) => {
                selectClip(clipId);
                setAiToolsPanelOpen(true);
              }}
              renderCacheEntries={renderCache.entries}
              renderingSegments={renderCache.renderingSegments}
              onLassoSelect={(ids) => { setLassoSelectedIds(ids); }}
            />

            {/* Audio Mixer Panel */}
            {mixerOpen && (
              <AudioMixerPanel
                tracks={project.sequence.tracks}
                masterVolume={project.sequence.settings.masterVolume ?? 1}
                audioEngineRef={audioEngineRef}
                onUpdateTrack={(trackId, updates) => updateTrack(trackId, updates)}
                onUpdateMasterVolume={(vol) => updateSequenceSettings({ masterVolume: vol })}
                onClose={() => {
                  setMixerOpen(false);
                  try { localStorage.setItem("264pro_mixer_open", "false"); } catch {}
                }}
              />
            )}
            </div>{/* /timeline-area-wrapper */}
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
                onEnableGrade={stableEnableColorGrade}
                onUpdateGrade={stableUpdateGrade}
                onResetGrade={stableResetGrade}
                onAutoColorMatch={() => {
                  autoColorMatch();
                  toast.success("🎨 Auto Color Match applied to all clips");
                }}
                colorStills={project.colorStills ?? []}
                selectedClipId={selectedClipId}
                onAddColorStill={addColorStill}
                onRemoveColorStill={removeColorStill}
                onRenameColorStill={renameColorStill}
                activeGradeSlot={inspectorSegment?.clip.activeGradeSlot ?? 'A'}
                gradeVersions={inspectorSegment?.clip.gradeVersions ?? {}}
                onSwitchGradeSlot={(slot) => { if (selectedClipId) switchGradeSlot(selectedClipId, slot); }}
                onCopyGradeToSlot={(from, to) => { if (selectedClipId) copyGradeToSlot(selectedClipId, from, to); }}
                gradeNodes={inspectorSegment?.clip.gradeNodes ?? []}
                onUpdateGradeNodes={(nodes) => { if (inspectorSegment) patchClip(inspectorSegment.clip.id, { gradeNodes: nodes }); }}
                onCopyGrade={() => { if (inspectorSegment) { copyGrade(inspectorSegment.clip.id); toast.success("Grade copied"); } }}
                onPasteGrade={() => { if (inspectorSegment) pasteGrade([inspectorSegment.clip.id]); }}
                canPasteGrade={!!gradeClipboard}
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
                sequenceSize={project.sequence.settings}
                resolveNestedSegments={resolveNestedSegments}
                resolveAsset={resolveAsset}
                shuttleRate={shuttleSpeed}
              />
              {/* Professional Video Scopes — collapsible strip */}
              <div className="color-scopes-strip" style={{ position: "relative" }}>
                <button
                  type="button"
                  title={colorScopesOpen ? "Hide Scopes" : "Show Scopes"}
                  onClick={() => setColorScopesOpen(v => !v)}
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    zIndex: 10,
                    background: "rgba(0,0,0,0.55)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 5,
                    color: "rgba(255,255,255,0.7)",
                    fontSize: 10,
                    padding: "2px 7px",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  {colorScopesOpen ? "▾ Scopes" : "▸ Scopes"}
                </button>
                {colorScopesOpen && (
                  <VideoScopesPanel videoRef={colorPageVideoRef} width={300} height={160} refreshMs={150} />
                )}
              </div>
            </div>

            {/* Bottom: Timeline */}
            <div className="color-page-timeline">
              {/* UX 4: Smart Suggestions Bar */}
              <SmartSuggestionsBar
                segments={segments}
                selectedClipId={selectedClipId}
                onNormalizeWhiteBalance={(clipId) => {
                  setColorGrade(clipId, { temperature: 0, tint: 0 });
                  toast.info("White balance normalized");
                }}
                onRecoverHighlights={(clipId) => {
                  setColorGrade(clipId, { exposure: -0.5, gain: { r: -0.02, g: -0.02, b: -0.02 } });
                  toast.info("Highlight recovery applied");
                }}
                onCompressAudio={() => {
                  project.sequence.clips.filter(c => {
                    const track = project.sequence.tracks.find(t => t.id === c.trackId);
                    return track?.kind === "audio" && c.volume > 1.3;
                  }).forEach(c => setClipVolume(c.id, 1.0));
                  toast.info("Audio peaks compressed to unity");
                }}
                onAutoColorGrade={(clipId) => {
                  enableColorGrade(clipId);
                  setColorGrade(clipId, { saturation: 1.1, contrast: 0.1, exposure: 0.05 });
                  toast.info("Auto color grade applied");
                }}
              />
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
                onRippleTrim={rippleTrim}
                onRollTrim={rollTrim}
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
                const msg1 = setSelectedClipTransitionType(edge, transType as import("../shared/models").ClipTransitionType);
                setTransitionMessage(msg1);
              }}
              assets={project.assets}
              markers={project.sequence.markers}
              onAddMarker={(frame) => addMarker({ frame, label: "", color: "#f7c948" })}
              onRemoveMarker={(id) => removeMarker(id)}
              onUpdateMarker={(id, updates) => updateMarker(id, updates)}
              onAddKeyframe={(clipId, property, frame, value) => addKeyframe(clipId, property, frame, value)}
              fixedPlayheadMode={fixedPlayheadMode}
              onToggleFixedPlayheadMode={toggleFixedPlayheadMode}
              onAutoLayout={autoLayoutTimeline}
              onNestClips={(clipIds, label) => nestSelectedClips(clipIds, label)}
              onSaveClipSnapshot={(clipId, label) => saveClipSnapshot(clipId, label)}
              onRestoreClipSnapshot={(clipId, snapshotId) => restoreClipSnapshot(clipId, snapshotId)}
              clipHistoryMap={Object.fromEntries(project.sequence.clips.filter(c => c.clipHistory && c.clipHistory.length > 0).map(c => [c.id, c.clipHistory!]))}
              onAddAdjustmentLayer={addAdjustmentLayer}
              renderCacheEntries={renderCache.entries}
              renderingSegments={renderCache.renderingSegments}
              onLassoSelect={(ids) => { setLassoSelectedIds(ids); }}
              />
            </div>
          </>
        )}

        {/* ── AUDIO PAGE (ClawSound) ── */}
        {activePage === "audio" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <ClawSoundPanel
              tracks={project.sequence.tracks}
              fps={project.sequence.settings.fps}
              onUpdateTrack={(trackId, updates) => updateTrack(trackId, updates)}
              masterVolume={project.sequence.settings.masterVolume ?? 1}
              onSetMasterVolume={(v) => updateSequenceSettings({ masterVolume: v })}
              selectedClipId={selectedClipId}
              onNormalizeAudio={(targetDb) => {
                normalizeAudioLevels(targetDb);
                toast.success(`🎚 Audio normalized to ${targetDb} LUFS`);
              }}
              duckingSettings={project.duckingSettings}
              onSetDuckingSettings={setDuckingSettings}
              project={project}
              onAddAudioTrack={() => addTrack("audio")}
            />
          </div>
        )}

        {/* ── PUBLISH PAGE ── */}
        {activePage === "publish" && (
          <ClawFlowPublishPanel
            projectName={project.name ?? "Untitled Project"}
            totalDurationSeconds={totalFrames / project.sequence.settings.fps}
            lastExportedPath={lastExportedPath}
            markers={project.sequence.markers}
            sequenceFps={project.sequence.settings.fps}
          />
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
              videoRef={viewerVideoRef}
              onUpdateGraph={(clipId, graph) => setCompGraph(clipId, graph)}
              onBack={() => setActivePage("edit")}
              onGroupNodes={(nodeIds, label) => groupNodes(nodeIds, label)}
              compoundNodes={project.compoundNodes ?? []}
            />
          );
        })()}

      </main>

      {/* ── FLOWSTATE PANEL (slide-in overlay) ── */}
      <FlowStatePanel
        isOpen={flowstatePanelOpen}
        onClose={() => setFlowstatePanelOpen(false)}
        onAutoColorMatch={() => { autoColorMatch(); toast.success("🎨 Auto Color Match applied"); }}
        onNormalizeAudio={(db) => { normalizeAudioLevels(db as -14 | -23); toast.success(`🎚 Audio normalized to ${db} LUFS`); }}
        onCloseGaps={() => { closeAllGaps(); toast.success("✅ All gaps closed"); }}
        onOpenBeatSync={() => { setBeatSyncOpen(true); setFlowstatePanelOpen(false); }}
        onOpenSubtitles={() => { setSubtitlesPanelOpen(true); setFlowstatePanelOpen(false); }}
        onAddImageToMediaPool={(imageUrl, name) => {
          const newAsset: import("../shared/models").MediaAsset = {
            id: `ai_img_${Date.now()}`,
            name,
            sourcePath: imageUrl,
            previewUrl: imageUrl,
            thumbnailUrl: imageUrl,
            durationSeconds: 0,
            width: 1024,
            height: 1024,
            nativeFps: 0,
            hasAudio: false,
          };
          importAssets([newAsset]);
          showToast("Image added to Media Pool");
        }}
      />

      {/* ── AI TOOLS PANEL (modal overlay) ── */}
      <AIToolsPanel
        isOpen={aiToolsPanelOpen}
        onClose={() => setAiToolsPanelOpen(false)}
        onAddGeneratedClip={(videoUrl, label) => {
          const newAsset: import("../shared/models").MediaAsset = {
            id: createId(),
            name: label,
            sourcePath: videoUrl,
            previewUrl: videoUrl,
            thumbnailUrl: videoUrl,
            durationSeconds: 5,
            width: 1920,
            height: 1080,
            nativeFps: 24,
            hasAudio: false,
          };
          importAssets([newAsset]);
          toast.success('✓ Added to Media Pool — drag to timeline');
        }}
      />

      {/* ── FOLLOW FOR FREEBIE MODAL ── */}
      {showFollowFreebie && (
        <FollowForFreebie
          onClose={() => setShowFollowFreebie(false)}
          aiCredits={aiCredits}
          onAddCredits={addAICredits}
        />
      )}

      {/* ── CLAWBOT DRAWER ── */}
      {clawbotOpen && (
        <div style={{
          position: "fixed", top: 60, right: 0, bottom: 0, width: 300,
          background: "#0d1117", borderLeft: "1px solid rgba(255,255,255,0.1)",
          display: "flex", flexDirection: "column", zIndex: 800,
          boxShadow: "-8px 0 24px rgba(0,0,0,0.4)",
        }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>🤖 Clawbot</span>
            <span style={{ fontSize: 11, color: "#64748b", flex: 1 }}>Your AI editing assistant</span>
            <button onClick={() => setClawbotOpen(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16 }}>✕</button>
          </div>
          <div style={{ padding: "10px 14px", flex: 1, overflowY: "auto" }}>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10, fontStyle: "italic" }}>"What should I work on?"</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {[
                { label: "Analyze my timeline", action: () => analyzeTimeline() },
                { label: "Suggest color grade", action: () => { setClawbotSuggestions(["🎨 Try a teal & orange grade for cinematic look", "💡 Boost contrast by 0.2 for punchy shadows", "🌡️ Warm up shadows slightly (+8 temp)"]); } },
                { label: "Fix audio levels", action: () => { setClawbotSuggestions(["🎚 Set all audio tracks to -6dB for headroom", "🔊 A1 track is peaking — reduce volume to 80%", "🎙️ Use compressor (4:1 ratio) on voice tracks"]); } },
                { label: "Generate B-roll ideas", action: () => { setClawbotSuggestions(["📸 Cut-away shots of hands typing", "🌆 Establishing cityscape b-roll at 1.5s each", "🔄 Insert reaction shots between interview cuts"]); } },
                { label: "Write captions from audio", action: () => { setSubtitlesPanelOpen(true); setClawbotOpen(false); } },
              ].map(item => (
                <button key={item.label} onClick={item.action} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#e2e8f0", fontSize: 12, cursor: "pointer", textAlign: "left" }}>
                  {item.label}
                </button>
              ))}
            </div>
            {clawbotSuggestions.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 13 }}>🤖</span>
                  <span style={{ fontSize: 10, fontWeight: 800, color: "#a855f7", letterSpacing: "0.07em", textTransform: "uppercase" as const }}>ClawBot Analysis</span>
                </div>
                {clawbotSuggestions.map((s, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#e2e8f0", padding: "9px 12px", marginBottom: 6, background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.25)", borderRadius: 8, lineHeight: 1.5 }}>
                    {s}
                  </div>
                ))}
              </div>
            )}

            {/* Revenue-aware suggestions (Phase 6) */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", letterSpacing: "0.08em", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                <span>⚡</span> CLAWFLOW POWER MOVES
              </div>
              {[
                { text: "Auto-match all clip exposures", action: () => { autoColorMatch(); toast.success("🎨 Auto Color Match applied"); } },
                { text: "Normalize audio to -14 LUFS (streaming)", action: () => { normalizeAudioLevels(-14); toast.success("🎚 Audio normalized to -14 LUFS"); } },
                { text: "Detect beats + auto-cut to music", action: () => { setBeatSyncOpen(true); setClawbotOpen(false); } },
                { text: "Auto-Reframe clip to 9:16 / TikTok", action: () => { setAutoReframeOpen(true); setClawbotOpen(false); } },
                { text: "Close all timeline gaps", action: () => { closeAllGaps(); toast.success("✅ All gaps closed"); } },
              ].map(item => (
                <button
                  key={item.text}
                  type="button"
                  onClick={item.action}
                  style={{ width: "100%", marginBottom: 4, padding: "7px 10px", borderRadius: 7, border: "1px solid rgba(124,58,237,0.3)", background: "rgba(124,58,237,0.08)", color: "#c4b5fd", fontSize: 11, cursor: "pointer", textAlign: "left" }}
                >
                  ⚡ {item.text}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#ec4899", letterSpacing: "0.08em", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                <span>🎬</span> ENHANCE WITH HIGGSFIELD AI
              </div>
              {[
                { text: "Generate a cinematic AI intro", prompt: "Cinematic film intro, dramatic lighting, slow motion reveal" },
                { text: "Generate B-roll for talking head", prompt: "Relevant b-roll footage to accompany interview, professional setting" },
                { text: "Generate abstract transition", prompt: "Abstract purple particles forming a logo, looping, dark background" },
              ].map(item => (
                <button
                  key={item.text}
                  type="button"
                  onClick={() => { setAiToolsPanelOpen(true); setClawbotOpen(false); }}
                  style={{ width: "100%", marginBottom: 4, padding: "7px 10px", borderRadius: 7, border: "1px solid rgba(236,72,153,0.3)", background: "rgba(236,72,153,0.08)", color: "#f9a8d4", fontSize: 11, cursor: "pointer", textAlign: "left" }}
                >
                  🎬 {item.text}
                </button>
              ))}
            </div>
          </div>
          <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 10, color: "#475569" }}>
            Ctrl+Shift+A to toggle · Cmd+, for Settings
          </div>
        </div>
      )}

      {/* ── SUBTITLES PANEL (slide-in from bottom-right) ── */}
      {subtitlesPanelOpen && (
        <div style={{
          position: "fixed", right: 0, bottom: 0, width: 420, height: 480,
          background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "12px 0 0 0", zIndex: 800,
          boxShadow: "-8px -8px 24px rgba(0,0,0,0.4)",
          display: "flex", flexDirection: "column",
        }}>
          <SubtitlesPanel
            cues={subtitleCues}
            playheadFrame={playback.playheadFrame}
            fps={project.sequence.settings.fps}
            onAddCue={handleAddSubtitleCue}
            onUpdateCue={handleUpdateSubtitleCue}
            onRemoveCue={handleRemoveSubtitleCue}
            onSeekToFrame={(frame) => setPlayheadFrame(frame)}
            project={project}
          />
          <button
            onClick={() => setSubtitlesPanelOpen(false)}
            style={{ position: "absolute", top: 10, right: 12, background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16 }}
          >✕</button>
        </div>
      )}

      {/* ── TITLE GENERATOR PANEL ── */}
      {titleGenPanelOpen && (
        <div style={{
          position: "fixed", right: 0, top: 60, width: 280, bottom: 0,
          background: "#0d1117", borderLeft: "1px solid rgba(255,255,255,0.1)",
          zIndex: 800, boxShadow: "-8px 0 24px rgba(0,0,0,0.4)",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ position: "absolute", top: 10, right: 12 }}>
            <button onClick={() => setTitleGenPanelOpen(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16 }}>✕</button>
          </div>
          <TitleGeneratorPanel
            fps={project.sequence.settings.fps}
            onAddTitleToTimeline={handleAddTitleToTimeline}
          />
        </div>
      )}

      {/* ── KEYBOARD SHORTCUTS PANEL ── */}
      {shortcutsPanelOpen && (
        <ShortcutsPanel onClose={() => setShortcutsPanelOpen(false)} />
      )}

      {/* ── PROJECT TEMPLATE MODAL (UX 5) ── */}
      {templateModalOpen && (
        <ProjectTemplateModal
          onClose={() => setTemplateModalOpen(false)}
          onSelect={(tmpl: ProjectTemplate) => {
            const { tracks, markers, settings } = instantiateTemplate(tmpl);
            const base = createEmptyProject();
            const newProject = {
              ...base,
              name: `${tmpl.label} Project`,
              sequence: {
                ...base.sequence,
                tracks,
                markers,
                settings: { ...base.sequence.settings, ...settings },
              }
            };
            loadProjectFromData(newProject);
            markClean();
            toast.success(`New ${tmpl.label} project created!`);
          }}
        />
      )}

      {/* ── PROJECT NOTES PANEL (GAP B) ── */}
      {projectNotesPanelOpen && (
        <ProjectNotesPanel
          metadata={project.metadata ?? {}}
          projectName={project.name}
          onUpdate={(updates) => updateProjectMetadata(updates)}
          onClose={() => setProjectNotesPanelOpen(false)}
        />
      )}

      {/* ── MULTICAM PANEL (GAP C) ── */}
      {multicamOpen && (
        <MulticamPanel
          segments={segments}
          playheadFrame={playback.playheadFrame}
          sequenceFps={project.sequence.settings.fps}
          onCutToAngle={(clipId, _trackId, frame) => {
            selectClip(clipId);
            setPlayheadFrame(frame);
            toast.info(`Cut to angle at frame ${frame}`);
          }}
          onSyncByAudio={(clipIds, offsets) => {
            syncMulticamClips(clipIds, offsets);
            toast.success(`🎵 Synced ${clipIds.length} angles by audio`);
          }}
          onClose={() => setMulticamOpen(false)}
        />
      )}

      {/* ── AUTO-RESIZE PANEL (EXCLUSIVE 2) ── */}
      {autoResizeOpen && (
        <AutoResizePanel
          projectName={project.name}
          onAddBatchJobs={(jobs) => {
            const newJobs = jobs.map(j => ({
              id: createId(),
              label: j.label,
              codec: j.codec,
              outputWidth: j.outputWidth,
              outputHeight: j.outputHeight,
              status: "queued" as const,
              progress: 0,
              createdAt: Date.now(),
            }));
            setRenderJobs(prev => [...prev, ...newJobs]);
            setRenderQueueOpen(true);
            toast.success(`Added ${newJobs.length} batch export jobs to Render Queue`);
          }}
          onClose={() => setAutoResizeOpen(false)}
        />
      )}

      {/* ── AI STORYBOARD PANEL (EXCLUSIVE 1) ── */}
      {aiStoryboardOpen && (
        <AIStoryboardPanel
          fps={project.sequence.settings.fps}
          onCreateTimeline={({ tracks, clips, markers, assets: newAssets }) => {
            newAssets.forEach(a => addAssetToPoolStore(a));
            const base = createEmptyProject();
            const newProject = {
              ...project,
              assets: [...project.assets, ...newAssets],
              sequence: {
                ...project.sequence,
                tracks: [...project.sequence.tracks, ...tracks],
                clips: [...project.sequence.clips, ...clips],
                markers: [...project.sequence.markers, ...markers],
              }
            };
            loadProjectFromData(newProject);
            toast.success("AI Storyboard applied to timeline!");
          }}
          onClose={() => setAiStoryboardOpen(false)}
        />
      )}

      {/* ── SHOT LIST PANEL (EXCLUSIVE 3) ── */}
      {shotListOpen && (
        <ShotListPanel
          fps={project.sequence.settings.fps}
          existingMarkers={project.sequence.markers}
          onAddMarkers={(markers) => {
            markers.forEach(m => addMarker(m));
            toast.success(`Added ${markers.length} scene markers from shot list`);
          }}
          onClose={() => setShotListOpen(false)}
        />
      )}

      {/* ── BEAT SYNC PANEL (Phase 5) ── */}
      {beatSyncOpen && (
        <div style={{ position: "fixed", bottom: 80, right: 16, zIndex: 5100 }}>
          <BeatSyncPanel
            audioTracks={project.sequence.tracks.filter(t => t.kind === "audio")}
            assets={project.assets}
            fps={project.sequence.settings.fps}
            onAddMarkers={(markers) => {
              markers.forEach(m => addMarker(m));
              toast.success(`🥁 Added ${markers.length} beat markers`);
            }}
            onSplitClipsAtBeats={(beatFrames) => {
              splitClipsAtBeats(beatFrames);
              toast.success(`✂️ Auto-cut ${beatFrames.length} beats`);
            }}
            onClose={() => setBeatSyncOpen(false)}
          />
        </div>
      )}

      {/* ── AUTO-REFRAME PANEL ── */}
      {autoReframeOpen && (
        <div style={{ position: "fixed", top: 80, right: 320, zIndex: 5100 }}>
          <AutoReframePanel
            assets={project.assets}
            onAddAsset={(asset) => importAssets([asset])}
            onClose={() => setAutoReframeOpen(false)}
          />
        </div>
      )}

      {/* ── TEXT-BASED EDITING PANEL ── */}
      {textEditPanelOpen && (
        <TextBasedEditingPanel
          assets={project.assets}
          transcripts={project.transcripts ?? {}}
          playheadFrame={playback.playheadFrame}
          sequenceFps={project.sequence.settings.fps}
          isPlaying={playback.isPlaying}
          onSetTranscript={setTranscript}
          onSetPlayheadFrame={setPlayheadFrame}
          onAddClipToTimeline={handleAddClipFromTranscript}
          onClose={() => setTextEditPanelOpen(false)}
        />
      )}

      {/* ── Image-to-Video Modal ── */}
      {renderImageToVideoModal()}

      {/* ── Image Gen Modal ── */}
      {renderImageGenModal()}

      {/* ── CLAW Video First-Launch Promo ── */}
      {showClawPromo && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.72)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'linear-gradient(160deg,#1a0a2e 0%,#0f1a2e 60%,#0a1a1f 100%)',
            border: '1px solid rgba(168,85,247,.4)',
            borderRadius: 20,
            padding: '32px 28px',
            maxWidth: 440,
            width: '90%',
            boxShadow: '0 24px 80px rgba(0,0,0,.6), 0 0 60px rgba(168,85,247,.12)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>🎬</div>
            <div style={{
              fontSize: 22, fontWeight: 800, marginBottom: 8,
              background: 'linear-gradient(135deg,#a855f7,#06b6d4)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              Create AI Videos with CLAW
            </div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)', marginBottom: 22, lineHeight: 1.6 }}>
              CLAW is your Production Director AI. It generates concepts, shot lists, and full music videos — then sends them straight into your 264 Pro timeline.
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              {[
                { icon: '✦', label: 'Concept generation' },
                { icon: '🎞', label: 'Shot list builder' },
                { icon: '🤖', label: 'AI video render' },
              ].map(f => (
                <div key={f.label} style={{
                  flex: 1, background: 'rgba(168,85,247,.08)',
                  border: '1px solid rgba(168,85,247,.2)',
                  borderRadius: 10, padding: '8px 6px',
                  fontSize: 11, color: 'rgba(255,255,255,0.7)',
                }}>
                  <div style={{ fontSize: 16, marginBottom: 4 }}>{f.icon}</div>
                  {f.label}
                </div>
              ))}
            </div>
            <button
              onClick={() => dismissClawPromo(true)}
              style={{
                width: '100%', padding: '13px 0', borderRadius: 12,
                border: 'none', marginBottom: 10,
                background: 'linear-gradient(135deg,#a855f7,#06b6d4)',
                color: '#fff', fontSize: 15, fontWeight: 800,
                cursor: 'pointer', letterSpacing: 0.3,
              }}
            >
              Create Video with CLAW →
            </button>
            <button
              onClick={() => dismissClawPromo(false)}
              style={{
                width: '100%', padding: '9px 0', borderRadius: 10,
                border: '1px solid rgba(255,255,255,.1)',
                background: 'transparent',
                color: 'rgba(255,255,255,0.45)', fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Skip for now
            </button>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 10 }}>
              This message won't appear again
            </div>
          </div>
        </div>
      )}

      {/* ── ONBOARDING MODAL (Phase 6) ── */}
      <OnboardingModal
        onFinish={() => {/* already handled internally */}}
        onOpenClawFlow={() => { setClawbotOpen(true); setActivePage("edit"); }}
        onOpenHiggsfield={() => setAiToolsPanelOpen(true)}
        onOpenColor={() => setActivePage("color")}
        onOpenAudio={() => setActivePage("audio")}
        onOpenExport={() => setRenderQueueOpen(true)}
      />

      {/* ── SETTINGS PANEL (Phase 6) ── */}
      {settingsPanelOpen && (
        <SettingsPanel
          onClose={() => setSettingsPanelOpen(false)}
          proxyEnabled={proxyManager.proxyEnabled}
          onToggleProxy={proxyManager.toggleProxyEnabled}
        />
      )}

      {/* ── Phase 9: Style Profile Panel ── */}
      {styleProfileOpen && (
        <StyleProfilePanel
          onClose={() => setStyleProfileOpen(false)}
          onApplyStyle={(grade) => {
            // Apply learned style to all ungraded clips
            project.sequence.clips.forEach((clip) => {
              const cg = clip.colorGrade;
              if (!cg || (cg.exposure === 0 && cg.contrast === 0)) {
                setColorGrade(clip.id, grade);
              }
            });
            toast.success("✨ Applied your style profile to ungraded clips");
            setStyleProfileOpen(false);
          }}
        />
      )}

      {/* ── Phase 9: Project Intelligence Panel ── */}
      {intelligenceOpen && (
        <ProjectIntelligencePanel
          project={project}
          fps={project.sequence.settings.fps}
          onClose={() => setIntelligenceOpen(false)}
          onAutoFixAll={() => {
            autoColorMatch();
            normalizeAudioLevels(-14);
            closeAllGaps();
            toast.success("🔧 Auto-fix applied: color match + normalize + close gaps");
          }}
          onGoToPublish={() => { setActivePage("publish"); setIntelligenceOpen(false); }}
          onAutoColorMatch={autoColorMatch}
          onNormalizeAudio={() => normalizeAudioLevels(-14)}
          onCloseGaps={closeAllGaps}
        />
      )}
    </div>
  );
}
