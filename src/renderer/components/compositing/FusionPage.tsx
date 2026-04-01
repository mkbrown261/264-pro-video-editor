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
  videoRef: React.RefObject<HTMLVideoElement | null>;
  frame: number;
}> = ({ graph, videoRef, frame }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CompRenderer | null>(null);

  // Initialize / re-initialize renderer
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      rendererRef.current?.dispose();
      rendererRef.current = new CompRenderer(canvas);
    } catch {
      // WebGL not available in this context; graceful fallback
      rendererRef.current = null;
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

    // Register video for MediaIn nodes
    const video = videoRef.current;
    if (video) {
      const mediaIn = graph.nodes.find(n => n.type === "MediaIn");
      if (mediaIn) renderer.registerVideo(mediaIn.id, video);
    }

    try {
      renderer.render(graph);
    } catch (err) {
      // Silently skip render errors during composition
    }
  }, [graph, frame, videoRef]);

  return (
    <div className="fusion-viewer">
      {graph ? (
        <canvas
          ref={canvasRef}
          className="fusion-viewer-canvas"
          width={1920}
          height={1080}
        />
      ) : (
        <div className="fusion-viewer-empty">
          <span>No comp graph — select a clip and open Fusion</span>
        </div>
      )}
      <div className="fusion-viewer-info">
        {graph && <span>Frame {frame}</span>}
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
  videoRef,
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
  const [splitH, setSplitH] = useState(45); // % top panels (viewer+inspector)
  const [inspW, setInspW] = useState(38);   // % of right column (inspector)

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
        </div>
      </div>

      {/* Template picker dropdown */}
      {showTemplates && (
        <TemplatePicker onSelect={handleTemplate} onClose={() => setShowTemplates(false)} />
      )}

      {/* Main area */}
      <div className="fusion-main" style={{ "--split-h": `${splitH}%`, "--insp-w": `${inspW}%` } as React.CSSProperties}>
        {/* Top row: Viewer + Inspector */}
        <div className="fusion-top-row">
          {/* Viewer */}
          <div className="fusion-viewer-pane">
            <FusionViewer
              graph={graph}
              videoRef={videoRef}
              frame={playheadFrame}
            />
          </div>

          {/* Inspector */}
          <div className="fusion-inspector-pane">
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
          </div>
        </div>

        {/* Bottom: Node Canvas */}
        <div className="fusion-canvas-pane">
          <div className="fusion-canvas-header">
            <span>Node Graph</span>
            {graph && <span className="fusion-graph-stats">{graph.nodes.length} nodes · {graph.wires.length} wires</span>}
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
