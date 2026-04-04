// src/renderer/components/compositing/FusionPage.tsx
// Fusion/compositing page layout for 264 Pro Video Editor
// Layout: [Viewer 55%] | [Inspector 45%] top, NodeCanvas bottom
// Plus: top menu bar with templates, tools, and clip navigation

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useLayoutEffect,
} from "react";
import type { CompGraph, CompTemplate } from "../../../shared/compositing";
import {
  createDefaultGraph,
  BUILT_IN_TEMPLATES,
  createNode,
} from "../../../shared/compositing";
import type { MediaAsset, TimelineClip, SequenceSettings } from "../../../shared/models";
import NodeCanvas from "./NodeCanvas";
import NodeInspector from "./NodeInspector";
import { CompRenderer } from "../../lib/CompRenderer";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface FusionPageProps {
  clip: TimelineClip | null;
  asset: MediaAsset | null;
  allClips: TimelineClip[];
  sequenceSettings: SequenceSettings;
  playheadFrame: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onUpdateGraph: (clipId: string, graph: CompGraph) => void;
  onBack: () => void;
}

// ── Viewer panel ──────────────────────────────────────────────────────────────
const FusionViewer: React.FC<{
  graph: CompGraph | null;
  asset: MediaAsset | null;
  clip: TimelineClip | null;
  frame: number;
  sequenceFps: number;
}> = ({ graph, asset, clip, frame, sequenceFps }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rendererRef = useRef<CompRenderer | null>(null);
  const [hasWebGL, setHasWebGL] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  // Load the clip's video into our local video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!asset) {
      video.src = "";
      setVideoReady(false);
      return;
    }
    // Use the same field the main ViewerPanel uses — previewUrl is the Electron-accessible path
    const src = asset.previewUrl || (asset as any).sourcePath || (asset as any).src || "";
    if (!src) return;
    // Only reload when src actually changes
    if (video.getAttribute("data-loaded-src") !== src) {
      video.setAttribute("data-loaded-src", src);
      setVideoReady(false);
      video.src = src;
      video.load();
    }
  }, [asset?.id, asset?.previewUrl]);

  // Seek to the correct frame when frame or clip changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip || sequenceFps <= 0) return;
    // Calculate the time within the clip source (accounting for trim)
    const trimStart = clip.trimStartFrames ?? 0;
    const sourceFrame = frame - clip.startFrame + trimStart;
    const targetTime = sourceFrame / sequenceFps;
    if (Math.abs(video.currentTime - targetTime) > 0.1) {
      video.currentTime = Math.max(0, targetTime);
    }
  }, [frame, clip?.startFrame, clip?.trimStartFrames, sequenceFps]);

  // Initialize / re-initialize renderer
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      rendererRef.current?.dispose();
      rendererRef.current = new CompRenderer(canvas);
      setHasWebGL(true);
    } catch {
      // WebGL not available in this context; graceful fallback
      rendererRef.current = null;
      setHasWebGL(false);
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Render on frame change or graph change
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !graph) return;
    renderer.setFrameTime(frame);
    const video = videoRef.current;
    if (video && videoReady) {
      const mediaIn = graph.nodes.find(n => n.type === "MediaIn");
      if (mediaIn) renderer.registerVideo(mediaIn.id, video);
    }
    try {
      renderer.render(graph);
    } catch {
      // Silently skip render errors during composition
    }
  }, [graph, frame, videoReady]);

  return (
    <div className="fusion-viewer">
      {/* Actual video element — always loaded with the clip's source */}
      <video
        ref={videoRef}
        muted
        playsInline
        preload="auto"
        onLoadedData={() => setVideoReady(true)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          background: "#000",
          // Show video when no WebGL comp, or when comp is not covering
          opacity: hasWebGL && graph ? 0 : 1,
          pointerEvents: "none",
          transition: "opacity 0.2s",
        }}
      />
      {/* WebGL comp output overlaid on top */}
      <canvas
        ref={canvasRef}
        className="fusion-viewer-canvas"
        width={1920}
        height={1080}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          opacity: hasWebGL && graph ? 1 : 0,
          pointerEvents: "none",
          transition: "opacity 0.2s",
        }}
      />
      {!graph && !asset && (
        <div className="fusion-viewer-empty">
          <span>No clip selected — open a clip in Fusion</span>
        </div>
      )}
      {graph && !videoReady && asset && (
        <div className="fusion-viewer-empty" style={{ color: "#666", fontSize: "0.7rem" }}>
          Loading video…
        </div>
      )}
      <div className="fusion-viewer-info">
        <span>Frame {frame}</span>
        {graph && <span style={{ marginLeft: 8, opacity: 0.5 }}>{graph.nodes.length} nodes · {graph.wires.length} wires</span>}
        {asset && <span style={{ marginLeft: 8, opacity: 0.4 }}>{asset.name}</span>}
      </div>
    </div>
  );
};

// ── Template picker ───────────────────────────────────────────────────────────
const TemplatePicker: React.FC<{
  onSelect: (template: CompTemplate) => void;
  onClose: () => void;
}> = ({ onSelect, onClose }) => (
  <div className="fusion-template-picker">
    <div className="ftp-header">
      <span>Templates</span>
      <button onClick={onClose}>✕</button>
    </div>
    <div className="ftp-list">
      {BUILT_IN_TEMPLATES.map(t => (
        <button key={t.id} className="ftp-item" onClick={() => onSelect(t)}>
          <div className="ftp-item-name">{t.name}</div>
          <div className="ftp-item-desc">{t.description}</div>
        </button>
      ))}
    </div>
  </div>
);

// ── Main FusionPage ───────────────────────────────────────────────────────────
const FusionPage: React.FC<FusionPageProps> = ({
  clip,
  asset,
  allClips,
  sequenceSettings,
  playheadFrame,
  videoRef: _videoRef, // kept for API compat but FusionViewer now uses its own video
  onUpdateGraph,
  onBack,
}) => {
  const [graph, setGraph] = useState<CompGraph | null>(clip?.compGraph ?? null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [applyToAll, setApplyToAll] = useState(false);

  // Sync graph when clip changes
  useEffect(() => {
    if (clip) {
      setGraph(clip.compGraph ?? createDefaultGraph(
        clip.id,
        sequenceSettings.width,
        sequenceSettings.height,
        sequenceSettings.fps,
      ));
    } else {
      setGraph(null);
    }
  }, [clip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpdateGraph = useCallback((g: CompGraph) => {
    setGraph(g);
    if (clip) {
      onUpdateGraph(clip.id, g);
      if (applyToAll && asset) {
        // Apply to all clips sharing the same assetId
        allClips
          .filter(c => c.assetId === asset.id && c.id !== clip.id)
          .forEach(c => onUpdateGraph(c.id, { ...g, clipId: c.id }));
      }
    }
  }, [clip, asset, allClips, applyToAll, onUpdateGraph]);

  const handleTemplate = useCallback((template: CompTemplate) => {
    if (!clip) return;
    const g = template.create(clip.id, sequenceSettings.width, sequenceSettings.height, sequenceSettings.fps);
    handleUpdateGraph(g);
    setShowTemplates(false);
  }, [clip, sequenceSettings, handleUpdateGraph]);

  const handleReset = useCallback(() => {
    if (!clip) return;
    const g = createDefaultGraph(clip.id, sequenceSettings.width, sequenceSettings.height, sequenceSettings.fps);
    handleUpdateGraph(g);
  }, [clip, sequenceSettings, handleUpdateGraph]);

  const handleNodeDoubleClick = useCallback((nodeId: string) => {
    // Jump to that node in inspector (already selected via onSelectNodes)
    setSelectedNodeIds([nodeId]);
  }, []);

  // Add a specific node type via toolbar shortcut
  const addNodeQuick = useCallback((type: import("../../../shared/compositing").CompNodeType) => {
    if (!graph) return;
    const n = createNode(type, 200 + Math.random() * 100, 200 + Math.random() * 60);
    handleUpdateGraph({ ...graph, nodes: [...graph.nodes, n] });
    setSelectedNodeIds([n.id]);
  }, [graph, handleUpdateGraph]);

  // ── Panel split state ─────────────────────────────────────────────────────
  // topRowH: percentage of main area used by the viewer+inspector row
  const [topRowH, setTopRowH] = useState(50); // % of main area for top row
  const [inspW, setInspW] = useState(38);     // % of top row for inspector

  // Drag to resize top/bottom split
  const splitterRef = useRef<HTMLDivElement>(null);
  const draggingSplit = useRef(false);
  const mainRef = useRef<HTMLDivElement>(null);

  const onSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingSplit.current = true;
    const startY = e.clientY;
    const startH = topRowH;
    const main = mainRef.current;
    if (!main) return;
    const totalH = main.getBoundingClientRect().height;

    const onMouseMove = (ev: MouseEvent) => {
      if (!draggingSplit.current) return;
      const dy = ev.clientY - startY;
      const newH = Math.min(80, Math.max(20, startH + (dy / totalH) * 100));
      setTopRowH(newH);
    };
    const onMouseUp = () => {
      draggingSplit.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [topRowH]);

  return (
    <div className="fusion-page">
      {/* Top menu bar */}
      <div className="fusion-topbar">
        <button className="fusion-back-btn" onClick={onBack} title="Back to Edit page">
          ◀ Edit
        </button>
        <div className="fusion-topbar-title">
          Fusion
          {clip && <span className="fusion-clip-name">{asset?.name ?? clip.id}</span>}
        </div>
        <div className="fusion-topbar-tools">
          <button className="fusion-tb-btn" title="Reset graph to MediaIn → MediaOut" onClick={handleReset}>
            ↺ Reset
          </button>
          <button className="fusion-tb-btn" onClick={() => setShowTemplates(s => !s)}>
            ⊞ Templates
          </button>
          <label className="fusion-tb-label" title="Apply changes to all clips with the same source asset">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={e => setApplyToAll(e.target.checked)}
            />
            Apply to All
          </label>
          <div className="fusion-tb-sep" />
          <button className="fusion-tb-btn fusion-tb-node" onClick={() => addNodeQuick("ColorCorrector")} title="Add ColorCorrector">CC</button>
          <button className="fusion-tb-btn fusion-tb-node" onClick={() => addNodeQuick("Merge")} title="Add Merge">Merge</button>
          <button className="fusion-tb-btn fusion-tb-node" onClick={() => addNodeQuick("Transform")} title="Add Transform">XF</button>
          <button className="fusion-tb-btn fusion-tb-node" onClick={() => addNodeQuick("Blur")} title="Add Blur">Blur</button>
          <button className="fusion-tb-btn fusion-tb-node" onClick={() => addNodeQuick("ChromaKeyer")} title="Add ChromaKeyer">Key</button>
          <button className="fusion-tb-btn fusion-tb-node" onClick={() => addNodeQuick("Text+")} title="Add Text+">Text+</button>
          <button className="fusion-tb-btn fusion-tb-node" onClick={() => addNodeQuick("Background")} title="Add Background">BG</button>
          <div className="fusion-tb-sep" />
          {/* Inspector width control */}
          <span className="fusion-tb-hint">Insp: </span>
          <button className="fusion-tb-btn" onClick={() => setInspW(w => Math.max(20, w - 5))} title="Narrow inspector">◂</button>
          <button className="fusion-tb-btn" onClick={() => setInspW(w => Math.min(60, w + 5))} title="Widen inspector">▸</button>
        </div>
      </div>

      {/* Template picker dropdown */}
      {showTemplates && (
        <TemplatePicker onSelect={handleTemplate} onClose={() => setShowTemplates(false)} />
      )}

      {/* Main area */}
      <div
        className="fusion-main"
        ref={mainRef}
        style={{ "--split-h": `${topRowH}%`, "--insp-w": `${inspW}%` } as React.CSSProperties}
      >
        {/* Top row: Viewer + Inspector */}
        <div className="fusion-top-row" style={{ flex: `0 0 ${topRowH}%` }}>
          {/* Viewer */}
          <div className="fusion-viewer-pane">
            <FusionViewer
              graph={graph}
              asset={asset}
              clip={clip}
              frame={playheadFrame}
              sequenceFps={sequenceSettings.fps}
            />
          </div>

          {/* Inspector */}
          <div className="fusion-inspector-pane" style={{ flex: `0 0 ${inspW}%` }}>
            <div className="fusion-inspector-header">
              <span>Inspector</span>
              <span className="fusion-insp-hint">{selectedNodeIds.length > 0 ? `${selectedNodeIds.length} node${selectedNodeIds.length > 1 ? "s" : ""} selected` : "No selection"}</span>
            </div>
            {graph && (
              <NodeInspector
                graph={graph}
                selectedNodeIds={selectedNodeIds}
                onUpdateGraph={handleUpdateGraph}
              />
            )}
            {!graph && (
              <div className="fusion-no-clip" style={{ fontSize: "0.72rem", color: "#555", padding: "20px" }}>
                Select a node to inspect its properties.
              </div>
            )}
          </div>
        </div>

        {/* Resizer between top and bottom */}
        <div
          ref={splitterRef}
          className="fusion-row-resizer"
          onMouseDown={onSplitterMouseDown}
          title="Drag to resize viewer / node graph"
        />

        {/* Bottom: Node Canvas */}
        <div className="fusion-canvas-pane">
          <div className="fusion-canvas-header">
            <span>Node Graph</span>
            {graph && <span className="fusion-graph-stats">{graph.nodes.length} nodes · {graph.wires.length} wires</span>}
            <span className="fusion-graph-hint">
              Scroll: pan · Shift+Scroll: horizontal · Ctrl+Scroll / Pinch: zoom · Middle-click or Alt+drag: pan · Right-click: menu
            </span>
          </div>
          {clip && graph ? (
            <NodeCanvas
              graph={graph}
              selectedNodeIds={selectedNodeIds}
              onSelectNodes={setSelectedNodeIds}
              onUpdateGraph={handleUpdateGraph}
              onNodeDoubleClick={handleNodeDoubleClick}
            />
          ) : (
            <div className="fusion-no-clip">
              <p>No clip selected. Double-click a video clip on the timeline to open it in Fusion.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FusionPage;
