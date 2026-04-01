// src/renderer/components/compositing/NodeInspector.tsx
// Parameter inspector for the selected Fusion node
// Supports: number, integer, boolean, color, point2d, enum, string, curve params
// Keyframe diamond buttons, collapsible groups, node label editing, bypass toggle

import React, { useState, useCallback } from "react";
import type { CompNode, CompParam, CompGraph } from "../../../shared/compositing";

// ── Props ─────────────────────────────────────────────────────────────────────
interface NodeInspectorProps {
  graph: CompGraph;
  selectedNodeIds: string[];
  onUpdateGraph: (g: CompGraph) => void;
}

// ── Param groups for display ──────────────────────────────────────────────────
const PARAM_GROUPS: Record<string, { label: string; keys: string[] }[]> = {
  ColorCorrector: [
    { label: "Basic", keys: ["brightness", "contrast", "saturation"] },
    { label: "Tone", keys: ["lift", "gain", "gamma"] },
  ],
  Transform: [
    { label: "Position", keys: ["centerX", "centerY"] },
    { label: "Scale", keys: ["sizeX", "sizeY"] },
    { label: "Rotation", keys: ["rotation"] },
    { label: "Flip", keys: ["flipH", "flipV"] },
  ],
  Merge: [
    { label: "Composite", keys: ["opacity", "blendMode"] },
  ],
  ChromaKeyer: [
    { label: "Key", keys: ["keyColor", "similarity", "smoothness"] },
    { label: "Matte", keys: ["despill", "spillSuppression"] },
  ],
  Blur: [{ label: "Blur", keys: ["radius"] }],
  Vignette: [{ label: "Vignette", keys: ["radius", "softness", "opacity"] }],
  Glow: [{ label: "Glow", keys: ["radius", "strength"] }],
  Background: [{ label: "Color", keys: ["color"] }],
  Text_: [
    { label: "Text", keys: ["text", "fontSize", "fontFamily"] },
    { label: "Position", keys: ["posX", "posY"] },
    { label: "Style", keys: ["color", "bold", "italic"] },
  ],
};

// ── Color swatch component ────────────────────────────────────────────────────
const ColorInput: React.FC<{
  value: number[];
  onChange: (v: number[]) => void;
}> = ({ value, onChange }) => {
  const [r, g, b, a] = value;
  const hex = `#${[r, g, b].map(x => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`;

  const handleHex = (h: string) => {
    const m = h.match(/^#?([0-9a-f]{6})$/i);
    if (!m) return;
    const n = parseInt(m[1], 16);
    onChange([((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255, a ?? 1]);
  };

  return (
    <div className="ni-color-row">
      <input
        type="color"
        value={hex}
        onChange={e => handleHex(e.target.value)}
        className="ni-color-swatch"
      />
      <input
        type="text"
        value={hex}
        onChange={e => handleHex(e.target.value)}
        className="ni-color-text"
        maxLength={7}
      />
      <input
        type="range"
        min={0} max={1} step={0.01}
        value={a ?? 1}
        onChange={e => onChange([r, g, b, parseFloat(e.target.value)])}
        className="ni-alpha-slider"
        title="Alpha"
      />
      <span className="ni-alpha-label">{Math.round((a ?? 1) * 100)}%</span>
    </div>
  );
};

// ── Keyframe diamond button ───────────────────────────────────────────────────
const KeyframeDiamond: React.FC<{
  paramKey: string;
  nodeId: string;
  hasKeyframes: boolean;
  onToggle: (nodeId: string, key: string) => void;
}> = ({ paramKey, nodeId, hasKeyframes, onToggle }) => (
  <button
    className={`ni-kf-diamond${hasKeyframes ? " active" : ""}`}
    title={hasKeyframes ? "Keyframed – click to remove all keyframes" : "Click to add keyframe"}
    onClick={() => onToggle(nodeId, paramKey)}
  >
    ◆
  </button>
);

// ── Enum selector ─────────────────────────────────────────────────────────────
const BLEND_MODES = [
  "Normal", "Add", "Multiply", "Screen", "Overlay",
  "Soft Light", "Hard Light", "Difference", "Exclusion",
  "Darken", "Lighten", "Color Dodge", "Color Burn",
  "Hue", "Saturation", "Color", "Luminosity",
];

const ENUM_OPTIONS: Record<string, string[]> = {
  blendMode: BLEND_MODES,
  fontFamily: ["Arial", "Helvetica", "Times New Roman", "Courier New", "Georgia", "Roboto", "Montserrat", "Impact"],
  edgesMode: ["Wrap", "Black", "Duplicate", "Mirror"],
};

// ── Single parameter editor ───────────────────────────────────────────────────
const ParamEditor: React.FC<{
  paramKey: string;
  param: CompParam;
  nodeId: string;
  onChange: (nodeId: string, key: string, value: CompParam["value"]) => void;
  onKeyframeToggle: (nodeId: string, key: string) => void;
}> = ({ paramKey, param, nodeId, onChange, onKeyframeToggle }) => {
  const hasKf = Array.isArray(param.keyframes) && param.keyframes.length > 0;
  const label = paramKey
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, s => s.toUpperCase())
    .trim();

  const renderControl = () => {
    switch (param.type) {
      case "number":
      case "integer": {
        const v = typeof param.value === "number" ? param.value : 0;
        const min = param.min ?? -Infinity;
        const max = param.max ?? Infinity;
        const step = param.type === "integer" ? 1 : (param.step ?? 0.01);
        return (
          <div className="ni-number-row">
            <input
              type="range"
              min={min === -Infinity ? -100 : min}
              max={max === Infinity ? 100 : max}
              step={step}
              value={v}
              onChange={e => onChange(nodeId, paramKey, parseFloat(e.target.value))}
              className="ni-range"
            />
            <input
              type="number"
              value={v}
              step={step}
              onChange={e => onChange(nodeId, paramKey, parseFloat(e.target.value))}
              className="ni-number-input"
            />
          </div>
        );
      }

      case "boolean":
        return (
          <label className="ni-checkbox-label">
            <input
              type="checkbox"
              checked={param.value as boolean}
              onChange={e => onChange(nodeId, paramKey, e.target.checked)}
            />
            <span className="ni-checkbox-track" />
          </label>
        );

      case "color": {
        const v = Array.isArray(param.value) ? param.value as number[] : [0,0,0,1];
        return (
          <ColorInput
            value={v}
            onChange={val => onChange(nodeId, paramKey, val)}
          />
        );
      }

      case "point2d": {
        const v = Array.isArray(param.value) ? param.value as number[] : [0.5, 0.5];
        return (
          <div className="ni-point2d-row">
            <label>X</label>
            <input
              type="number" step={0.01}
              value={v[0]}
              onChange={e => onChange(nodeId, paramKey, [parseFloat(e.target.value), v[1]])}
              className="ni-number-input"
            />
            <label>Y</label>
            <input
              type="number" step={0.01}
              value={v[1]}
              onChange={e => onChange(nodeId, paramKey, [v[0], parseFloat(e.target.value)])}
              className="ni-number-input"
            />
          </div>
        );
      }

      case "enum": {
        const v = typeof param.value === "string" ? param.value : "";
        const options = ENUM_OPTIONS[paramKey] ?? param.options ?? [];
        return (
          <select
            className="ni-select"
            value={v}
            onChange={e => onChange(nodeId, paramKey, e.target.value)}
          >
            {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        );
      }

      case "string": {
        const v = typeof param.value === "string" ? param.value : "";
        return (
          <input
            type="text"
            className="ni-text-input"
            value={v}
            onChange={e => onChange(nodeId, paramKey, e.target.value)}
          />
        );
      }

      default:
        return <span className="ni-unsupported">—</span>;
    }
  };

  return (
    <div className="ni-param-row">
      <div className="ni-param-label" title={paramKey}>{label}</div>
      <div className="ni-param-control">{renderControl()}</div>
      <KeyframeDiamond
        paramKey={paramKey}
        nodeId={nodeId}
        hasKeyframes={hasKf}
        onToggle={onKeyframeToggle}
      />
    </div>
  );
};

// ── Collapsible section ───────────────────────────────────────────────────────
const CollapsibleSection: React.FC<{
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`ni-section${open ? " open" : ""}`}>
      <button className="ni-section-header" onClick={() => setOpen(o => !o)}>
        <span className="ni-section-arrow">{open ? "▾" : "▸"}</span>
        {title}
      </button>
      {open && <div className="ni-section-body">{children}</div>}
    </div>
  );
};

// ── Main NodeInspector ────────────────────────────────────────────────────────
const NodeInspector: React.FC<NodeInspectorProps> = ({
  graph,
  selectedNodeIds,
  onUpdateGraph,
}) => {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");

  const selectedNode = selectedNodeIds.length === 1
    ? graph.nodes.find(n => n.id === selectedNodeIds[0]) ?? null
    : null;

  const updateParam = useCallback((nodeId: string, key: string, value: CompParam["value"]) => {
    onUpdateGraph({
      ...graph,
      nodes: graph.nodes.map(n =>
        n.id === nodeId
          ? { ...n, params: { ...n.params, [key]: { ...n.params[key], value } } }
          : n
      ),
    });
  }, [graph, onUpdateGraph]);

  const toggleKeyframe = useCallback((nodeId: string, key: string) => {
    onUpdateGraph({
      ...graph,
      nodes: graph.nodes.map(n => {
        if (n.id !== nodeId) return n;
        const param = n.params[key];
        if (!param) return n;
        const hasKf = Array.isArray(param.keyframes) && param.keyframes.length > 0;
        return {
          ...n,
          params: {
            ...n.params,
            [key]: { ...param, keyframes: hasKf ? [] : [{ frame: 0, value: param.value }] },
          },
        };
      }),
    });
  }, [graph, onUpdateGraph]);

  const toggleBypass = useCallback(() => {
    if (!selectedNode) return;
    onUpdateGraph({
      ...graph,
      nodes: graph.nodes.map(n =>
        n.id === selectedNode.id ? { ...n, bypassed: !n.bypassed } : n
      ),
    });
  }, [selectedNode, graph, onUpdateGraph]);

  const commitLabel = useCallback(() => {
    if (!selectedNode) return;
    onUpdateGraph({
      ...graph,
      nodes: graph.nodes.map(n =>
        n.id === selectedNode.id ? { ...n, label: labelDraft } : n
      ),
    });
    setEditingLabel(false);
  }, [selectedNode, labelDraft, graph, onUpdateGraph]);

  const startEditLabel = () => {
    if (!selectedNode) return;
    setLabelDraft(selectedNode.label);
    setEditingLabel(true);
  };

  if (!selectedNode) {
    return (
      <div className="node-inspector empty">
        <div className="ni-empty-msg">
          <span className="ni-empty-icon">⬡</span>
          <p>Select a node to inspect its parameters</p>
        </div>
      </div>
    );
  }

  // Build param display list
  const paramKeys = Object.keys(selectedNode.params);
  const groups = PARAM_GROUPS[selectedNode.type.replace(/\+/g, "_")] ?? null;

  const renderParams = (keys: string[]) =>
    keys
      .filter(k => paramKeys.includes(k))
      .map(k => (
        <ParamEditor
          key={k}
          paramKey={k}
          param={selectedNode.params[k]}
          nodeId={selectedNode.id}
          onChange={updateParam}
          onKeyframeToggle={toggleKeyframe}
        />
      ));

  const ungroupedKeys = groups
    ? paramKeys.filter(k => !groups.flatMap(g => g.keys).includes(k))
    : paramKeys;

  return (
    <div className="node-inspector">
      {/* Node header */}
      <div className="ni-header">
        <div
          className="ni-node-type-badge"
          style={{ backgroundColor: selectedNode.color ?? "#37474f" }}
        >
          {selectedNode.type}
        </div>
        <div className="ni-label-row">
          {editingLabel ? (
            <input
              autoFocus
              className="ni-label-input"
              value={labelDraft}
              onChange={e => setLabelDraft(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={e => { if (e.key === "Enter") commitLabel(); if (e.key === "Escape") setEditingLabel(false); }}
            />
          ) : (
            <span className="ni-node-label" onDoubleClick={startEditLabel} title="Double-click to rename">
              {selectedNode.label}
            </span>
          )}
          <button
            className={`ni-bypass-btn${selectedNode.bypassed ? " active" : ""}`}
            onClick={toggleBypass}
            title="Toggle bypass"
          >
            {selectedNode.bypassed ? "BYPASSED" : "Active"}
          </button>
        </div>
        <div className="ni-node-id">{selectedNode.id}</div>
      </div>

      {/* Params */}
      <div className="ni-params">
        {groups ? (
          <>
            {groups.map(group => (
              <CollapsibleSection key={group.label} title={group.label}>
                {renderParams(group.keys)}
              </CollapsibleSection>
            ))}
            {ungroupedKeys.length > 0 && (
              <CollapsibleSection title="Other" defaultOpen={false}>
                {renderParams(ungroupedKeys)}
              </CollapsibleSection>
            )}
          </>
        ) : (
          <CollapsibleSection title="Parameters">
            {renderParams(paramKeys)}
          </CollapsibleSection>
        )}
      </div>

      {/* Port info */}
      <CollapsibleSection title="Ports" defaultOpen={false}>
        <div className="ni-ports-list">
          {selectedNode.ports.map(p => (
            <div key={p.id} className="ni-port-item">
              <span
                className="ni-port-dot"
                style={{ backgroundColor: `hsl(${p.type === "image" ? 44 : p.type === "mask" ? 207 : 283}, 70%, 60%)` }}
              />
              <span className="ni-port-dir">{p.direction === "input" ? "▶" : "◀"}</span>
              <span className="ni-port-label">{p.name}</span>
              <span className="ni-port-type">{p.type}</span>
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default NodeInspector;
