import { useEffect, useRef, useState, type CSSProperties } from "react";
import { InspectorPanel } from "./components/InspectorPanel";
import { MediaPool } from "./components/MediaPool";
import { TimelinePanel } from "./components/TimelinePanel";
import {
  ViewerPanel,
  type ViewerPanelHandle
} from "./components/ViewerPanel";
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

export default function App() {
  const viewerPanelRef = useRef<ViewerPanelHandle | null>(null);
  const project = useEditorStore((state) => state.project);
  const selectedAssetId = useEditorStore((state) => state.selectedAssetId);
  const selectedClipId = useEditorStore((state) => state.selectedClipId);
  const toolMode = useEditorStore((state) => state.toolMode);
  const environment = useEditorStore((state) => state.environment);
  const playback = useEditorStore((state) => state.playback);
  const importAssets = useEditorStore((state) => state.importAssets);
  const appendAssetToTimeline = useEditorStore((state) => state.appendAssetToTimeline);
  const selectAsset = useEditorStore((state) => state.selectAsset);
  const selectClip = useEditorStore((state) => state.selectClip);
  const moveClipTo = useEditorStore((state) => state.moveClipTo);
  const trimClipStart = useEditorStore((state) => state.trimClipStart);
  const trimClipEnd = useEditorStore((state) => state.trimClipEnd);
  const splitSelectedClipAtPlayhead = useEditorStore(
    (state) => state.splitSelectedClipAtPlayhead
  );
  const splitClipAtFrame = useEditorStore((state) => state.splitClipAtFrame);
  const removeSelectedClip = useEditorStore((state) => state.removeSelectedClip);
  const toggleClipEnabled = useEditorStore((state) => state.toggleClipEnabled);
  const detachLinkedClips = useEditorStore((state) => state.detachLinkedClips);
  const applyTransitionToSelectedClip = useEditorStore(
    (state) => state.applyTransitionToSelectedClip
  );
  const setSelectedClipTransitionDuration = useEditorStore(
    (state) => state.setSelectedClipTransitionDuration
  );
  const setSelectedClipTransitionType = useEditorStore(
    (state) => state.setSelectedClipTransitionType
  );
  const extractAudioFromSelectedClip = useEditorStore(
    (state) => state.extractAudioFromSelectedClip
  );
  const setPlayheadFrame = useEditorStore((state) => state.setPlayheadFrame);
  const nudgePlayhead = useEditorStore((state) => state.nudgePlayhead);
  const setPlaybackPlaying = useEditorStore((state) => state.setPlaybackPlaying);
  const stopPlayback = useEditorStore((state) => state.stopPlayback);
  const setToolMode = useEditorStore((state) => state.setToolMode);
  const toggleBladeTool = useEditorStore((state) => state.toggleBladeTool);
  const setEnvironment = useEditorStore((state) => state.setEnvironment);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [transitionMessage, setTransitionMessage] = useState<string | null>(null);
  const [bridgeReady, setBridgeReady] = useState(
    typeof window !== "undefined" && Boolean(window.editorApi)
  );
  const appShellRef = useRef<HTMLElement | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(320);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [resizeSide, setResizeSide] = useState<"left" | "right" | null>(null);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus | null>(null);
  const [updaterDismissed, setUpdaterDismissed] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Voice Chop AI ready.");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceLastCommand, setVoiceLastCommand] = useState<string | null>(null);
  const [voiceSuggestedCutFrames, setVoiceSuggestedCutFrames] = useState<number[]>([]);
  const [voiceMarkInFrame, setVoiceMarkInFrame] = useState<number | null>(null);
  const [voiceMarkOutFrame, setVoiceMarkOutFrame] = useState<number | null>(null);
  const [voiceBpm, setVoiceBpm] = useState(120);
  const [voiceGridFrames, setVoiceGridFrames] = useState(12);
  const voiceStateRef = useRef({
    bpm: 120,
    gridFrames: 12,
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
  }>({
    activeSegment: null,
    inspectorSegment: null,
    playheadFrame: 0,
    segments: [],
    sequenceFps: 24
  });
  const voiceChopRef = useRef<VoiceChopAI | null>(null);

  const segments = buildTimelineSegments(project.sequence, project.assets);
  const trackLayouts = buildTrackLayouts(project.sequence, project.assets);
  const totalFrames = getTotalDurationFrames(segments);
  const activeSegment = findPlayableSegmentAtFrame(
    segments,
    playback.playheadFrame,
    "video"
  );
  const activeAudioSegment = findPlayableSegmentAtFrame(
    segments,
    playback.playheadFrame,
    "audio"
  );
  const selectedSegment =
    segments.find((segment) => segment.clip.id === selectedClipId) ?? null;
  const inspectorSegment =
    selectedSegment?.track.kind === "audio" && selectedSegment.clip.linkedGroupId
      ? segments.find(
          (segment) =>
            segment.clip.linkedGroupId === selectedSegment.clip.linkedGroupId &&
            segment.track.kind === "video"
        ) ?? selectedSegment
      : selectedSegment;
  const selectedAsset =
    project.assets.find((asset) => asset.id === selectedAssetId) ??
    inspectorSegment?.asset ??
    null;

  useEffect(() => {
    timelineStateRef.current = {
      activeSegment,
      inspectorSegment,
      playheadFrame: playback.playheadFrame,
      segments,
      sequenceFps: project.sequence.settings.fps
    };
  }, [
    activeSegment,
    inspectorSegment,
    playback.playheadFrame,
    project.sequence.settings.fps,
    segments
  ]);

  function pauseViewerPlayback() {
    viewerPanelRef.current?.pausePlayback();
    stopPlayback();
  }

  function getCurrentVideoSegmentAtFrame(frame: number): TimelineSegment | null {
    const currentState = useEditorStore.getState();
    const currentSegments = buildTimelineSegments(
      currentState.project.sequence,
      currentState.project.assets
    );

    return (
      findPlayableSegmentAtFrame(currentSegments, frame, "video") ??
      currentSegments.find(
        (segment) =>
          segment.track.kind === "video" &&
          frame >= segment.startFrame &&
          frame < segment.endFrame
      ) ??
      null
    );
  }

  function splitVideoAtFrame(frame: number): boolean {
    const targetSegment = getCurrentVideoSegmentAtFrame(frame);

    if (!targetSegment) {
      return false;
    }

    pauseViewerPlayback();
    splitClipAtFrame(targetSegment.clip.id, frame);
    return true;
  }

  function playFeedbackBeep() {
    const AudioContextCtor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      return;
    }

    const audioContext = new AudioContextCtor();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.0001;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.06, audioContext.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.14);
    oscillator.stop(audioContext.currentTime + 0.15);
    oscillator.onended = () => {
      void audioContext.close();
    };
  }

  function handleTogglePlayback() {
    if (!viewerPanelRef.current || !totalFrames) {
      return;
    }

    void viewerPanelRef.current.togglePlayback();
  }

  function handleSeek(frame: number) {
    pauseViewerPlayback();
    setPlayheadFrame(frame);
  }

  function handleStepFrames(deltaFrames: number) {
    pauseViewerPlayback();
    nudgePlayhead(deltaFrames);
  }

  function handleToggleFullscreen() {
    void viewerPanelRef.current?.toggleFullscreen();
  }

  useEditorShortcuts({
    sequenceFps: project.sequence.settings.fps,
    onTogglePlayback: handleTogglePlayback,
    onToggleFullscreen: handleToggleFullscreen,
    onSelectTool: () => setToolMode("select"),
    onToggleBladeTool: toggleBladeTool,
    onSplitSelectedClip: splitSelectedClipAtPlayhead,
    onNudgePlayhead: handleStepFrames,
    onSeekToStart: () => handleSeek(0),
    onSeekToEnd: () => handleSeek(Math.max(totalFrames - 1, 0)),
    onRemoveSelectedClip: () => {
      pauseViewerPlayback();
      removeSelectedClip();
    }
  });

  useEffect(() => {
    setTransitionMessage(null);
  }, [selectedClipId]);

  useEffect(() => {
    setVoiceGridFrames((currentGridFrames) =>
      currentGridFrames > 0 ? currentGridFrames : Math.max(1, Math.round(project.sequence.settings.fps / 2))
    );
  }, [project.sequence.settings.fps]);

  useEffect(() => {
    voiceStateRef.current = {
      bpm: voiceBpm,
      gridFrames: voiceGridFrames,
      markInFrame: voiceMarkInFrame,
      markOutFrame: voiceMarkOutFrame,
      suggestedCutFrames: voiceSuggestedCutFrames
    };
  }, [
    voiceBpm,
    voiceGridFrames,
    voiceMarkInFrame,
    voiceMarkOutFrame,
    voiceSuggestedCutFrames
  ]);

  useEffect(() => {
    const voiceChop = new VoiceChopAI({
      acceptSuggestedCuts: () => {
        const frames = [...voiceStateRef.current.suggestedCutFrames].sort(
          (left, right) => right - left
        );

        pauseViewerPlayback();
        frames.forEach((frame) => {
          splitVideoAtFrame(frame);
        });
        setVoiceSuggestedCutFrames([]);
      },
      beep: playFeedbackBeep,
      getActiveVideoClip: () => timelineStateRef.current.activeSegment,
      getBpm: () => voiceStateRef.current.bpm,
      getGridFrames: () => voiceStateRef.current.gridFrames,
      getMarks: () => ({
        markInFrame: voiceStateRef.current.markInFrame,
        markOutFrame: voiceStateRef.current.markOutFrame
      }),
      getPlayheadFrame: () => timelineStateRef.current.playheadFrame,
      getSelectedVideoClip: () => {
        const selected = timelineStateRef.current.inspectorSegment;

        return selected?.track.kind === "video" ? selected : null;
      },
      getSequenceFps: () => timelineStateRef.current.sequenceFps,
      getSuggestedCuts: () => voiceStateRef.current.suggestedCutFrames,
      setLastCommand: setVoiceLastCommand,
      setListening: setVoiceListening,
      setMarks: (markInFrame, markOutFrame) => {
        setVoiceMarkInFrame(markInFrame);
        setVoiceMarkOutFrame(markOutFrame);
      },
      setStatus: setVoiceStatus,
      setSuggestedCuts: setVoiceSuggestedCutFrames,
      setTranscript: setVoiceTranscript,
      splitAtCurrentPlayhead: () => splitVideoAtFrame(timelineStateRef.current.playheadFrame)
    });

    voiceChopRef.current = voiceChop;

    return () => {
      voiceChop.dispose();
      voiceChopRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!resizeSide) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const bounds = appShellRef.current?.getBoundingClientRect();

      if (!bounds) {
        return;
      }

      const minPanelWidth = 240;
      const maxPanelWidth = 520;
      const minCenterWidth = 560;

      if (resizeSide === "left") {
        const proposedWidth = event.clientX - bounds.left;
        const maxWidth = Math.max(minPanelWidth, bounds.width - rightPanelWidth - minCenterWidth);

        setLeftPanelWidth(
          Math.min(maxPanelWidth, Math.max(minPanelWidth, Math.min(proposedWidth, maxWidth)))
        );
        return;
      }

      const proposedWidth = bounds.right - event.clientX;
      const maxWidth = Math.max(minPanelWidth, bounds.width - leftPanelWidth - minCenterWidth);

      setRightPanelWidth(
        Math.min(maxPanelWidth, Math.max(minPanelWidth, Math.min(proposedWidth, maxWidth)))
      );
    };

    const handleMouseUp = () => {
      setResizeSide(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [leftPanelWidth, resizeSide, rightPanelWidth]);

  useEffect(() => {
    if (!window.editorApi) {
      setBridgeReady(false);
      setExportMessage(
        "Electron preload bridge is unavailable. Restart the app after rebuilding."
      );
      return;
    }

    setBridgeReady(true);
    let cancelled = false;

    void window.editorApi
      .getEnvironmentStatus()
      .then((status) => {
        if (!cancelled) {
          setEnvironment(status);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setExportMessage(
            error instanceof Error ? error.message : "Failed to inspect environment."
          );
        }
      });

    // Subscribe to auto-updater events pushed from the main process
    const unsubUpdater = window.editorApi.onUpdaterStatus((status) => {
      setUpdaterStatus(status);
      // Reset dismissed state whenever a new, different state arrives
      if (status.state === "available" || status.state === "ready") {
        setUpdaterDismissed(false);
      }
    });

    return () => {
      cancelled = true;
      unsubUpdater();
    };
  }, [setEnvironment]);

  async function handleImport() {
    if (!window.editorApi) {
      setBridgeReady(false);
      setExportMessage("Import is unavailable because the Electron bridge did not load.");
      return;
    }

    setExportMessage(null);

    try {
      const assets = await window.editorApi.openMediaFiles();
      importAssets(assets);
    } catch (error) {
      setExportMessage(
        error instanceof Error ? error.message : "Media import failed."
      );
    }
  }

  async function handleExport() {
    if (!window.editorApi) {
      setBridgeReady(false);
      setExportMessage("Export is unavailable because the Electron bridge did not load.");
      return;
    }

    setExportMessage(null);

    try {
      const outputPath = await window.editorApi.chooseExportFile(
        `${project.sequence.name}.mp4`
      );

      if (!outputPath) {
        return;
      }

      setExportBusy(true);
      const result = await window.editorApi.exportSequence({
        outputPath,
        project
      });
      setExportMessage(`Rendered successfully to ${result.outputPath}`);
    } catch (error) {
      setExportMessage(
        error instanceof Error ? error.message : "Render failed."
      );
    } finally {
      setExportBusy(false);
    }
  }

  function handleApplyTransition(edge: "in" | "out") {
    pauseViewerPlayback();
    setTransitionMessage(applyTransitionToSelectedClip(edge));
  }

  const shellStyle = {
    "--left-panel-width": `${leftPanelWidth}px`,
    "--right-panel-width": `${rightPanelWidth}px`
  } as CSSProperties;

  // Compute the updater banner content
  const showUpdaterBanner =
    !updaterDismissed &&
    updaterStatus !== null &&
    updaterStatus.state !== "checking" &&
    updaterStatus.state !== "up-to-date";

  function renderUpdaterBanner() {
    if (!showUpdaterBanner || !updaterStatus) return null;
    const { state, version, percent, message } = updaterStatus;

    let text = "";
    let bannerClass = "updater-banner";
    let canDismiss = false;

    if (state === "available") {
      text = `Update available — v${version ?? ""} is ready to download.`;
      bannerClass += " updater-banner--info";
      canDismiss = true;
    } else if (state === "downloading") {
      text = `Downloading update… ${percent ?? 0}%`;
      bannerClass += " updater-banner--info";
    } else if (state === "ready") {
      text = `v${version ?? ""} downloaded — will install on next quit.`;
      bannerClass += " updater-banner--success";
      canDismiss = true;
    } else if (state === "error") {
      text = `Update error: ${message ?? "unknown error"}`;
      bannerClass += " updater-banner--error";
      canDismiss = true;
    }

    return (
      <div className={bannerClass}>
        <span>{text}</span>
        {canDismiss && (
          <button
            className="updater-banner__dismiss"
            onClick={() => setUpdaterDismissed(true)}
            aria-label="Dismiss update notification"
          >
            ✕
          </button>
        )}
      </div>
    );
  }

  return (
    <main ref={appShellRef} className="app-shell" style={shellStyle}>
      {renderUpdaterBanner()}
      <header className="workspace-header">
        <div>
          <p className="eyebrow">264 Pro Video Editor</p>
          <h1>Phase 1 Editorial MVP</h1>
        </div>
        <div className="header-status">
          <span>{bridgeReady ? "Bridge ready" : "Bridge unavailable"}</span>
          <span>{project.assets.length} assets</span>
          <strong>{project.sequence.clips.length} timeline clips</strong>
          <span>{project.sequence.tracks.length} tracks</span>
          <span>
            {project.sequence.settings.width}x{project.sequence.settings.height} / {project.sequence.settings.fps} fps
          </span>
        </div>
      </header>

      <MediaPool
        assets={project.assets}
        selectedAssetId={selectedAssetId}
        selectedSegment={inspectorSegment}
        transitionMessage={transitionMessage}
        onImport={handleImport}
        onSelectAsset={selectAsset}
        onAppendAsset={appendAssetToTimeline}
        onApplyTransition={handleApplyTransition}
      />

      <div
        className="panel-resizer left-resizer"
        onMouseDown={(event) => {
          event.preventDefault();
          setResizeSide("left");
        }}
        role="separator"
        aria-label="Resize media panel"
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
        onSetPlaybackPlaying={setPlaybackPlaying}
        onSetToolMode={setToolMode}
        onToggleBladeTool={toggleBladeTool}
        onSplitAtPlayhead={splitSelectedClipAtPlayhead}
        onSetPlayheadFrame={setPlayheadFrame}
        onStepFrames={handleStepFrames}
      />

      <div
        className="panel-resizer right-resizer"
        onMouseDown={(event) => {
          event.preventDefault();
          setResizeSide("right");
        }}
        role="separator"
        aria-label="Resize inspector panel"
      />

      <InspectorPanel
        selectedAsset={selectedAsset}
        selectedSegment={inspectorSegment}
        environment={environment}
        exportBusy={exportBusy}
        exportMessage={exportMessage}
        sequenceSettings={project.sequence.settings}
        clipMessage={transitionMessage}
        voiceListening={voiceListening}
        voiceStatus={voiceStatus}
        voiceTranscript={voiceTranscript}
        voiceLastCommand={voiceLastCommand}
        voiceSuggestedCutFrames={voiceSuggestedCutFrames}
        voiceMarkInFrame={voiceMarkInFrame}
        voiceMarkOutFrame={voiceMarkOutFrame}
        voiceBpm={voiceBpm}
        voiceGridFrames={voiceGridFrames}
        onToggleClipEnabled={(clipId) => {
          pauseViewerPlayback();
          toggleClipEnabled(clipId);
        }}
        onDetachLinkedClips={(clipId) => {
          pauseViewerPlayback();
          detachLinkedClips(clipId);
        }}
        onSetTransitionType={(edge, type) => {
          pauseViewerPlayback();
          setTransitionMessage(setSelectedClipTransitionType(edge, type));
        }}
        onSetTransitionDuration={(edge, durationFrames) => {
          pauseViewerPlayback();
          setTransitionMessage(
            setSelectedClipTransitionDuration(edge, durationFrames)
          );
        }}
        onExtractAudio={() => {
          pauseViewerPlayback();
          setTransitionMessage(extractAudioFromSelectedClip());
        }}
        onRippleDelete={() => {
          pauseViewerPlayback();
          removeSelectedClip();
        }}
        onToggleVoiceListening={() => {
          voiceChopRef.current?.listenForCommands();
        }}
        onAnalyzeVoiceChops={() => {
          const targetClip =
            (inspectorSegment?.track.kind === "video" ? inspectorSegment : null) ??
            activeSegment;

          if (!targetClip) {
            setVoiceStatus("Select a video clip or park the playhead on one before running AI chops.");
            return;
          }

          voiceChopRef.current?.applyAICuts(targetClip);
        }}
        onAcceptVoiceCuts={() => {
          voiceChopRef.current?.processVoiceCommand("accept cuts");
        }}
        onClearVoiceCuts={() => {
          setVoiceSuggestedCutFrames([]);
          setVoiceStatus("Cleared AI cut suggestions.");
        }}
        onQuantizeVoiceCutsToBeat={() => {
          voiceChopRef.current?.processVoiceCommand("quantize to beat");
        }}
        onQuantizeVoiceCutsToGrid={() => {
          voiceChopRef.current?.processVoiceCommand("quantize to grid");
        }}
        onSetVoiceBpm={(bpm) => {
          const nextBpm = Math.max(40, Math.min(240, Math.round(bpm)));

          setVoiceBpm(nextBpm);
          voiceChopRef.current?.setBpm(nextBpm);
        }}
        onSetVoiceGridFrames={(gridFrames) => {
          const nextGridFrames = Math.max(1, Math.round(gridFrames));

          setVoiceGridFrames(nextGridFrames);
          voiceChopRef.current?.setGridFrames(nextGridFrames);
        }}
        onExport={handleExport}
      />

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
        onMoveClipTo={(clipId, trackId, startFrame) => {
          pauseViewerPlayback();
          moveClipTo(clipId, trackId, startFrame);
        }}
        onTrimClipStart={(clipId, trimStartFrames) => {
          pauseViewerPlayback();
          trimClipStart(clipId, trimStartFrames);
        }}
        onTrimClipEnd={(clipId, trimEndFrames) => {
          pauseViewerPlayback();
          trimClipEnd(clipId, trimEndFrames);
        }}
        onBladeCut={(clipId, frame) => {
          pauseViewerPlayback();
          splitClipAtFrame(clipId, frame);
        }}
      />
    </main>
  );
}
