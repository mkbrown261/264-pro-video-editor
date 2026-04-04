import React, { useEffect, useRef, useState } from "react";
import type { EditorTool, TimelineTrack, TimelineTrackKind } from "../../shared/models";
import {
  getClipTransitionDurationFrames,
  type TimelineTrackLayout,
  type TimelineSegment
} from "../../shared/timeline";
import { formatDuration, formatTimecode } from "../lib/format";
import { TRANSITION_DRAG_TYPE } from "./TransitionsPanel";

type TrimEdge = "start" | "end";

// ── Snap quantization options (in frames multiplier of fps) ──────────────────
export const SNAP_DIVISIONS = [
  { label: "1/1",  factor: 1     },
  { label: "1/2",  factor: 0.5   },
  { label: "1/4",  factor: 0.25  },
  { label: "1/8",  factor: 0.125 },
  { label: "1/16", factor: 0.0625 }
];

// ── Context menu state ────────────────────────────────────────────────────────
interface ContextMenu {
  x: number;
  y: number;
  clipId: string;
  clipKind: TimelineTrackKind;
  isLinked: boolean;
  isEnabled: boolean;
  speed: number;
}

// ── Track context menu state ──────────────────────────────────────────────────
interface TrackContextMenu {
  x: number;
  y: number;
  trackId: string;
  trackKind: TimelineTrackKind;
  isMuted: boolean;
  isLocked: boolean;
  isSolo: boolean;
}

interface DragState {
  clipId: string;
  trackKind: TimelineTrackKind;
  offsetX: number;
  originalStartFrame: number;
  originalTrackId: string;
  durationFrames: number;  // cached for ghost preview
}

interface TrimState {
  clipId: string;
  edge: TrimEdge;
  anchorX: number;
  trimStartFrames: number;
  trimEndFrames: number;
}

interface FadeHandleState {
  clipId: string;
  edge: "in" | "out";
  anchorX: number;
  originalDurationFrames: number;
  maxFrames: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAG-POSITION INTENT
//   DRAG_ON_TRACK       → drop onto existing track (trackId set)
//   INSERT_ABOVE_TRACK  → create new track immediately above insertBeforeTrackId
//   INSERT_ABOVE_TOP    → create new track at very top (index 0)
//   INSERT_BELOW_BOTTOM → append new track at very bottom
// ─────────────────────────────────────────────────────────────────────────────
type DragIntent =
  | "DRAG_ON_TRACK"
  | "INSERT_ABOVE_TRACK"   // insert before a specific existing track
  | "INSERT_ABOVE_TOP"
  | "INSERT_BELOW_BOTTOM";

interface GhostInfo {
  intent: DragIntent;
  frame: number;
  /** Existing track to drop onto (DRAG_ON_TRACK only) */
  trackId: string;
  /** Kind of the new track to create */
  newTrackKind: TimelineTrackKind;
  /**
   * For INSERT_ABOVE_TRACK: the trackId of the existing row the ghost sits
   * immediately above.  The new track will be spliced before this track.
   */
  insertBeforeTrackId: string;
  /**
   * Absolute insertion index in the sequence.tracks[] array.
   * 0 = very top; tracks.length = very bottom.
   */
  insertIndex: number;
}

interface TimelinePanelProps {
  trackLayouts: TimelineTrackLayout[];
  selectedClipId: string | null;
  toolMode: EditorTool;
  playheadFrame: number;
  suggestedCutFrames: number[];
  markInFrame: number | null;
  markOutFrame: number | null;
  totalFrames: number;
  sequenceFps: number;
  onSetPlayheadFrame: (frame: number) => void;
  onSelectClip: (clipId: string) => void;
  onMoveClipTo: (clipId: string, trackId: string, startFrame: number) => void;
  onTrimClipStart: (clipId: string, trimStartFrames: number) => void;
  onTrimClipEnd: (clipId: string, trimEndFrames: number) => void;
  onBladeCut: (clipId: string, frame: number) => void;
  onDropAsset: (assetId: string, trackId: string, startFrame: number) => void;
  onUpdateTrack: (trackId: string, updates: Partial<TimelineTrack>) => void;
  onSetTransitionDuration: (clipId: string, edge: "in" | "out", durationFrames: number) => void;
  onDropTransition?: (clipId: string, transitionType: string, edge: "in" | "out") => void;
  // Context menu actions
  onDeleteClip?: (clipId: string) => void;
  onDuplicateClip?: (clipId: string) => void;
  onSplitClip?: (clipId: string, frame: number) => void;
  onToggleClipEnabled?: (clipId: string) => void;
  onDetachLinkedClips?: (clipId: string) => void;
  onRelinkClips?: (clipId: string) => void;
  onSetClipSpeed?: (clipId: string, speed: number) => void;
  onAddFade?: (clipId: string, edge: "in" | "out") => void;
  onOpenInFusion?: (clipId: string) => void;
  onAddTrack?: (kind: TimelineTrackKind) => void;
  onRemoveTrack?: (trackId: string) => void;
  onRenameTrack?: (trackId: string, name: string) => void;
  onDuplicateTrack?: (trackId: string) => void;
  /**
   * Atomically create new tracks (at the given insertIndex) and move the
   * clip group into them.  insertIndex is the position in sequence.tracks[]
   * where the new video track will be spliced.
   */
  onAddTracksAndMoveClip?: (clipId: string, startFrame: number, insertIndex: number) => void;
  /** Reorder an existing track to a new index in sequence.tracks[] */
  onReorderTrack?: (trackId: string, toIndex: number) => void;
  /** Called once on mount with zoom control functions */
  onRegisterZoomControls?: (controls: { zoomIn: () => void; zoomOut: () => void; fitToWindow: () => void }) => void;
}

const MIN_PPF = 1.5;
const MAX_PPF = 60;
const LABEL_W = 100; // track-label width in px

function snapFrame(frame: number, snapEnabled: boolean, fps: number, snapDivFactor: number): number {
  if (!snapEnabled) return frame;
  const gridSize = Math.max(1, Math.round(fps * snapDivFactor));
  return Math.round(frame / gridSize) * gridSize;
}

export function TimelinePanel({
  trackLayouts,
  selectedClipId,
  toolMode,
  playheadFrame,
  suggestedCutFrames,
  markInFrame,
  markOutFrame,
  totalFrames,
  sequenceFps,
  onSetPlayheadFrame,
  onSelectClip,
  onMoveClipTo,
  onTrimClipStart,
  onTrimClipEnd,
  onBladeCut,
  onDropAsset,
  onUpdateTrack,
  onSetTransitionDuration,
  onDeleteClip,
  onDuplicateClip,
  onSplitClip,
  onToggleClipEnabled,
  onDetachLinkedClips,
  onRelinkClips,
  onSetClipSpeed,
  onAddFade,
  onOpenInFusion,
  onAddTrack,
  onRemoveTrack,
  onRenameTrack,
  onDuplicateTrack,
  onAddTracksAndMoveClip,
  onReorderTrack,
  onRegisterZoomControls,
  onDropTransition,
}: TimelinePanelProps) {
  const timelineEditorRef = useRef<HTMLDivElement | null>(null);
  const timelineRulerRef  = useRef<HTMLDivElement | null>(null);
  // Always-current playhead frame for use in closures (avoids stale capture)
  const playheadFrameRef  = useRef<number>(playheadFrame);
  useEffect(() => { playheadFrameRef.current = playheadFrame; }, [playheadFrame]);

  const propsRef = useRef({
    onSetPlayheadFrame, onSelectClip, onMoveClipTo,
    onTrimClipStart, onTrimClipEnd, onBladeCut, onDropAsset,
    onUpdateTrack, onSetTransitionDuration, onDropTransition,
    toolMode, sequenceFps,
    onAddTrack, onAddTracksAndMoveClip, onReorderTrack
  });
  useEffect(() => {
    propsRef.current = {
      onSetPlayheadFrame, onSelectClip, onMoveClipTo,
      onTrimClipStart, onTrimClipEnd, onBladeCut, onDropAsset,
      onUpdateTrack, onSetTransitionDuration, onDropTransition,
      toolMode, sequenceFps,
      onAddTrack, onAddTracksAndMoveClip, onReorderTrack
    };
  });

  const [pixelsPerFrame, setPpf] = useState(() => {
    try { return Number(localStorage.getItem("264pro_timeline_ppf") ?? "6") || 6; } catch { return 6; }
  });
  const ppfRef = useRef(pixelsPerFrame);
  useEffect(() => {
    ppfRef.current = pixelsPerFrame;
    try { localStorage.setItem("264pro_timeline_ppf", String(pixelsPerFrame)); } catch { /* noop */ }
  }, [pixelsPerFrame]);

  // ── Snap state ────────────────────────────────────────────────────────────
  const [snapEnabled, setSnapEnabled] = useState(() => {
    try { return localStorage.getItem("264pro_snap_enabled") !== "false"; } catch { return true; }
  });
  const [snapDivIdx, setSnapDivIdx] = useState(() => {
    try { return Number(localStorage.getItem("264pro_snap_div_idx") ?? "2"); } catch { return 2; }
  });
  const snapRef = useRef({ snapEnabled, snapDivIdx });
  useEffect(() => {
    snapRef.current = { snapEnabled, snapDivIdx };
    try {
      localStorage.setItem("264pro_snap_enabled", String(snapEnabled));
      localStorage.setItem("264pro_snap_div_idx", String(snapDivIdx));
    } catch { /* noop */ }
  }, [snapEnabled, snapDivIdx]);

  // ── Interaction state ─────────────────────────────────────────────────────
  const [trimState, setTrimState]                   = useState<TrimState | null>(null);
  const [fadeHandleState, setFadeHandleState]       = useState<FadeHandleState | null>(null);
  const [isScrubbingPlayhead, setIsScrubbingPlayhead] = useState(false);
  const [dragState, setDragState]                   = useState<DragState | null>(null);
  const [ghostInfo, setGhostInfo]                   = useState<GhostInfo | null>(null);
  // Ref in sync with ghostInfo so onUp reads the LATEST intent without re-resolving.
  // This fixes fast drag+release landing in wrong zone.
  const ghostInfoRef = useRef<GhostInfo | null>(null);
  const [dropTargetTrackId, setDropTargetTrackId]   = useState<string | null>(null);

  // Magnetic snap indicator: frame where snap line is shown (null = no snap active)
  const [snapIndicatorFrame, setSnapIndicatorFrame] = useState<number | null>(null);
  // Pixel threshold for magnetic snap-to-edge/playhead to engage
  const MAGNETIC_SNAP_PX = 10;

  // ── FIX 3: Lasso rubber-band multi-select ────────────────────────────────
  interface LassoBox { startX: number; startY: number; curX: number; curY: number; }
  const [lassoBox, setLassoBox] = useState<LassoBox | null>(null);
  const lassoBoxRef = useRef<LassoBox | null>(null);
  const [lassoSelectedIds, setLassoSelectedIds] = useState<Set<string>>(new Set());

  // ── Track reorder drag ────────────────────────────────────────────────────
  const [trackReorderDrag, setTrackReorderDrag] = useState<{
    trackId: string;
    anchorY: number;
    currentY: number;
  } | null>(null);

  // ── Track height resize ───────────────────────────────────────────────────
  const [trackHeightDrag, setTrackHeightDrag] = useState<{ trackId: string; anchorY: number; origHeight: number } | null>(null);

  // ── Context menu ──────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [speedInput, setSpeedInput] = useState<string>("1.0");
  const [trackContextMenu, setTrackContextMenu] = useState<TrackContextMenu | null>(null);
  const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".timeline-context-menu")) setContextMenu(null);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  // Close track context menu on outside click
  useEffect(() => {
    if (!trackContextMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".timeline-context-menu")) setTrackContextMenu(null);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [trackContextMenu]);

  const timelineFrames = Math.max(totalFrames + sequenceFps * 4, sequenceFps * 10);
  const canvasWidth    = Math.max(timelineFrames * pixelsPerFrame, 960);
  const zoomPercent    = Math.round((pixelsPerFrame / 6) * 100);
  const playheadLeft   = Math.round(playheadFrame * pixelsPerFrame);

  // Helper: get frame under cursor accounting for scroll + label offset
  function getFrameAt(clientX: number, containerRef: React.RefObject<HTMLDivElement | null>) {
    const el = containerRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const scrollLeft = timelineEditorRef.current?.scrollLeft ?? 0;
    const px = clientX - r.left - LABEL_W + scrollLeft;
    return Math.max(0, Math.round(px / ppfRef.current));
  }

  // ── Zoom ──────────────────────────────────────────────────────────────────
  function setZoom(nextPpf: number, clientX?: number) {
    const clamped = Math.max(MIN_PPF, Math.min(MAX_PPF, nextPpf));
    const editor = timelineEditorRef.current;
    if (!editor || clientX === undefined) { setPpf(clamped); return; }
    const bounds = editor.getBoundingClientRect();
    const cursorOffset = clientX - bounds.left - LABEL_W;
    const cursorFrame  = (editor.scrollLeft + cursorOffset) / ppfRef.current;
    const nextScroll   = Math.max(0, cursorFrame * clamped - cursorOffset);
    setPpf(clamped);
    requestAnimationFrame(() => { if (timelineEditorRef.current) timelineEditorRef.current.scrollLeft = nextScroll; });
  }

  // Register zoom controls with parent (for keyboard shortcuts)
  useEffect(() => {
    if (!onRegisterZoomControls) return;
    onRegisterZoomControls({
      zoomIn:  () => setZoom(ppfRef.current * 1.4),
      zoomOut: () => setZoom(ppfRef.current / 1.4),
      fitToWindow: () => {
        const editor = timelineEditorRef.current;
        if (!editor) return;
        const w = editor.clientWidth - LABEL_W;
        const frames = Math.max(timelineFrames, 1);
        setZoom(Math.max(MIN_PPF, Math.min(MAX_PPF, w / frames)));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRegisterZoomControls]);

  // ── Ctrl+= zoom in / Ctrl+- zoom out / Ctrl+0 fit ────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        setPpf((prev) => Math.min(MAX_PPF, parseFloat((prev * 1.25).toFixed(2))));
      } else if (e.key === "-") {
        e.preventDefault();
        setPpf((prev) => Math.max(MIN_PPF, parseFloat((prev * 0.8).toFixed(2))));
      } else if (e.key === "0") {
        e.preventDefault();
        const editor = timelineEditorRef.current;
        if (editor && timelineFrames > 0) {
          const visibleWidth = editor.clientWidth - LABEL_W;
          const fitPpf = Math.max(MIN_PPF, Math.min(MAX_PPF, visibleWidth / timelineFrames));
          setPpf(parseFloat(fitPpf.toFixed(2)));
          requestAnimationFrame(() => { if (timelineEditorRef.current) timelineEditorRef.current.scrollLeft = 0; });
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [timelineFrames]);

  // ── Playhead scrub ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isScrubbingPlayhead) return;
    const onMove = (e: MouseEvent) => {
      const ruler = timelineRulerRef.current;
      if (!ruler) return;
      const r = ruler.getBoundingClientRect();
      const scrollLeft = timelineEditorRef.current?.scrollLeft ?? 0;
      const px = e.clientX - r.left - LABEL_W + scrollLeft;
      const frame = Math.max(0, Math.min(Math.round(px / ppfRef.current), timelineFrames));
      propsRef.current.onSetPlayheadFrame(frame);
    };
    const onUp = () => setIsScrubbingPlayhead(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isScrubbingPlayhead, timelineFrames]);

  // ── Trim ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!trimState) return;
    const onMove = (e: MouseEvent) => {
      const rawDelta = Math.round((e.clientX - trimState.anchorX) / ppfRef.current);
      const { snapEnabled: se, snapDivIdx: sdi } = snapRef.current;
      // Apply snap to the absolute trim value, not to the delta
      if (trimState.edge === "start") {
        const rawTrim = trimState.trimStartFrames + rawDelta;
        const snappedTrim = snapFrame(rawTrim, se, propsRef.current.sequenceFps, SNAP_DIVISIONS[sdi].factor);
        propsRef.current.onTrimClipStart(trimState.clipId, snappedTrim);
      } else {
        const rawTrim = trimState.trimEndFrames - rawDelta;
        const snappedTrim = snapFrame(rawTrim, se, propsRef.current.sequenceFps, SNAP_DIVISIONS[sdi].factor);
        propsRef.current.onTrimClipEnd(trimState.clipId, snappedTrim);
      }
    };
    const onUp = () => setTrimState(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [trimState]);

  // ── Fade handle drag ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!fadeHandleState) return;
    const onMove = (e: MouseEvent) => {
      const fhs = fadeHandleState;
      const delta = Math.round((e.clientX - fhs.anchorX) / ppfRef.current);
      const rawDur = fhs.edge === "in"
        ? Math.max(0, Math.min(fhs.originalDurationFrames + delta, fhs.maxFrames))
        : Math.max(0, Math.min(fhs.originalDurationFrames - delta, fhs.maxFrames));
      const { snapEnabled: se, snapDivIdx: sdi } = snapRef.current;
      const dur = snapFrame(rawDur, se, propsRef.current.sequenceFps, SNAP_DIVISIONS[sdi].factor);
      propsRef.current.onSetTransitionDuration(fhs.clipId, fhs.edge, Math.max(0, dur));
    };
    const onUp = () => setFadeHandleState(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [fadeHandleState]);

  // ── Track height resize ───────────────────────────────────────────────────
  useEffect(() => {
    if (!trackHeightDrag) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientY - trackHeightDrag.anchorY;
      const newH = Math.max(36, Math.min(120, trackHeightDrag.origHeight + delta));
      propsRef.current.onUpdateTrack(trackHeightDrag.trackId, { height: newH });
    };
    const onUp = () => setTrackHeightDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [trackHeightDrag]);

  // ── Clip drag ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!dragState) return;
    // Capture as non-null const so TypeScript narrows it inside closures below
    const ds = dragState;

    /**
     * Core intent resolver.
     *
     * Priority order:
     *  1. Cursor ABOVE all rows                          → INSERT_ABOVE_TOP
     *  2. Cursor in TOP 40% of a same-kind lane         → INSERT_ABOVE_TRACK
     *  3. Cursor in BOTTOM 60% of a same-kind lane      → DRAG_ON_TRACK
     *  4. Cursor BELOW all rows                         → INSERT_BELOW_BOTTOM
     *  5. Cursor in gap (different-kind rows):
     *       nearest same-kind lane center → 40/60 split → INSERT_ABOVE/DRAG_ON
     *
     * onUp uses ghostInfoRef (last seen intent) so fast drag+release still
     * honours whatever was shown in the ghost preview.
     */
    function resolveGhostAt(clientX: number, clientY: number): GhostInfo | null {
      const allLanes = Array.from(document.querySelectorAll<HTMLElement>(".timeline-lane"))
        .map((el) => ({
          el,
          r: el.getBoundingClientRect(),
          kind: el.dataset.trackKind as TimelineTrackKind,
          trackId: el.dataset.trackId ?? "",
        }))
        .sort((a, b) => a.r.top - b.r.top);

      if (allLanes.length === 0) return null;

      const editor     = timelineEditorRef.current;
      const scrollLeft = editor?.scrollLeft ?? 0;
      const { snapEnabled: se, snapDivIdx: sdi } = snapRef.current;
      const fps = propsRef.current.sequenceFps;

      /**
       * clientX → snapped frame.
       * The lane's r.left is the left edge of the lane *in the viewport*.
       * Adding scrollLeft restores the portion that has scrolled out of view.
       * Subtracting offsetX accounts for where inside the clip the user clicked.
       */
      function laneFrame(r: DOMRect): number {
        const px = clientX - r.left + scrollLeft - ds.offsetX;
        return snapFrame(Math.max(0, Math.round(px / ppfRef.current)), se, fps, SNAP_DIVISIONS[sdi].factor);
      }

      /** Fallback: use the first lane as frame reference when cursor is outside all lanes. */
      function fallbackFrame(): number {
        return laneFrame(allLanes[0].r);
      }

      const kindLanes = allLanes.filter((l) => l.kind === ds.trackKind);
      const globalIndexOf = (trackId: string) => allLanes.findIndex((l) => l.trackId === trackId);

      const topOfAll    = allLanes[0].r.top;
      const bottomOfAll = allLanes[allLanes.length - 1].r.bottom;

      // ── Rule 1: Cursor ABOVE every row → INSERT_ABOVE_TOP ─────────────────
      if (clientY < topOfAll) {
        return {
          intent: "INSERT_ABOVE_TOP",
          frame: fallbackFrame(),
          trackId: "",
          newTrackKind: ds.trackKind,
          insertBeforeTrackId: kindLanes.length > 0 ? kindLanes[0].trackId : "",
          insertIndex: 0,
        };
      }

      // ── Rule 2-3: Cursor directly over a same-kind lane ──────────────────
      for (let i = 0; i < kindLanes.length; i++) {
        const { r, trackId } = kindLanes[i];
        if (clientY < r.top || clientY > r.bottom) continue;

        const relY = clientY - r.top;
        const h    = r.bottom - r.top;

        // TOP 40% → INSERT ABOVE this track
        if (relY < h * 0.40) {
          const gIdx = globalIndexOf(trackId);
          return {
            intent: "INSERT_ABOVE_TRACK",
            frame: laneFrame(r),
            trackId: "",
            newTrackKind: ds.trackKind,
            insertBeforeTrackId: trackId,
            insertIndex: Math.max(0, gIdx),
          };
        }

        // BOTTOM 60% → DRAG ON TRACK
        return {
          intent: "DRAG_ON_TRACK",
          frame: laneFrame(r),
          trackId,
          newTrackKind: ds.trackKind,
          insertBeforeTrackId: "",
          insertIndex: -1,
        };
      }

      // ── Rule 4: Below ALL rows → INSERT_BELOW_BOTTOM ─────────────────────
      if (clientY > bottomOfAll) {
        return {
          intent: "INSERT_BELOW_BOTTOM",
          frame: fallbackFrame(),
          trackId: "",
          newTrackKind: ds.trackKind,
          insertBeforeTrackId: "",
          insertIndex: allLanes.length,
        };
      }

      // ── Rule 5: Cursor in gap between different-kind rows ─────────────────
      if (kindLanes.length > 0) {
        let nearest = kindLanes[0];
        let nearestDist = Infinity;
        for (const kl of kindLanes) {
          const center = (kl.r.top + kl.r.bottom) / 2;
          const d = Math.abs(clientY - center);
          if (d < nearestDist) { nearestDist = d; nearest = kl; }
        }
        const center = (nearest.r.top + nearest.r.bottom) / 2;
        if (clientY < center) {
          const gIdx = globalIndexOf(nearest.trackId);
          return {
            intent: "INSERT_ABOVE_TRACK",
            frame: laneFrame(nearest.r),
            trackId: "",
            newTrackKind: ds.trackKind,
            insertBeforeTrackId: nearest.trackId,
            insertIndex: Math.max(0, gIdx),
          };
        } else {
          return {
            intent: "DRAG_ON_TRACK",
            frame: laneFrame(nearest.r),
            trackId: nearest.trackId,
            newTrackKind: ds.trackKind,
            insertBeforeTrackId: "",
            insertIndex: -1,
          };
        }
      }

      return null;
    }

    const onMove = (e: MouseEvent) => {
      const g = resolveGhostAt(e.clientX, e.clientY);

      // ── Magnetic snap-to-edges + snap-to-playhead ─────────────────────────
      // Applies to all drag intents when snap is enabled
      if (g && snapRef.current.snapEnabled) {
        const ppf = ppfRef.current;

        // FIX 9: Collect ONLY clip edges (not playhead) for the blue snap indicator.
        // Skip the clip being dragged to avoid snapping to itself.
        const clipEdges: number[] = [];
        const allCandidates: number[] = [];

        document.querySelectorAll<HTMLElement>(".timeline-clip").forEach((el) => {
          // Skip the clip being dragged
          if (el.dataset.clipId === ds.clipId) return;
          const left  = parseFloat(el.style.left  ?? "0");
          const width = parseFloat(el.style.width ?? "0");
          if (!isNaN(left)) {
            const f = Math.round(left / ppf);
            clipEdges.push(f);
            allCandidates.push(f);
          }
          if (!isNaN(left + width)) {
            const f = Math.round((left + width) / ppf);
            clipEdges.push(f);
            allCandidates.push(f);
          }
        });

        // Playhead snapping (no blue indicator for playhead snaps)
        allCandidates.push(playheadFrameRef.current);

        // Threshold in frames
        const threshFrames = MAGNETIC_SNAP_PX / ppf;

        // Find closest candidate within threshold
        let bestFrame: number | null = null;
        let bestDist = threshFrames;
        let bestIsClipEdge = false;
        for (const candidate of allCandidates) {
          const dist = Math.abs(g.frame - candidate);
          if (dist < bestDist) {
            bestDist = dist;
            bestFrame = candidate;
            bestIsClipEdge = clipEdges.includes(candidate);
          }
        }

        if (bestFrame !== null) {
          g.frame = bestFrame;
          // FIX 9: Blue snap line ONLY appears when snapping to another clip's edge
          setSnapIndicatorFrame(bestIsClipEdge ? bestFrame : null);
        } else {
          setSnapIndicatorFrame(null);
        }
      } else {
        setSnapIndicatorFrame(null);
      }

      // Keep ref in sync — onUp reads this instead of re-resolving at mouseup
      ghostInfoRef.current = g;
      setGhostInfo(g);
    };

    const onUp = (_e: MouseEvent) => {
      // Use the last-seen ghost intent (ref), not a fresh resolve at mouseup coords.
      const g = ghostInfoRef.current;
      if (g) {
        if (g.intent === "DRAG_ON_TRACK") {
          propsRef.current.onMoveClipTo(ds.clipId, g.trackId, g.frame);
        } else {
          propsRef.current.onAddTracksAndMoveClip?.(ds.clipId, g.frame, g.insertIndex);
        }
      }
      ghostInfoRef.current = null;
      setDragState(null);
      setGhostInfo(null);
      setSnapIndicatorFrame(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragState]);

  // ── FIX 3: Lasso rubber-band selection mouse tracking ─────────────────────
  useEffect(() => {
    if (!lassoBox) return;
    const onMove = (e: MouseEvent) => {
      // Use clientX/Y — consistent with getBoundingClientRect (viewport coords)
      const next = { ...lassoBoxRef.current!, curX: e.clientX, curY: e.clientY };
      lassoBoxRef.current = next;
      setLassoBox({ ...next });
    };
    const onUp = () => {
      const lb = lassoBoxRef.current;
      if (lb) {
        const x1 = Math.min(lb.startX, lb.curX);
        const y1 = Math.min(lb.startY, lb.curY);
        const x2 = Math.max(lb.startX, lb.curX);
        const y2 = Math.max(lb.startY, lb.curY);
        // Only register selection if lasso has meaningful size
        if (x2 - x1 > 6 || y2 - y1 > 6) {
          const selected = new Set<string>();
          document.querySelectorAll<HTMLElement>("[data-clip-id]").forEach((el) => {
            const r = el.getBoundingClientRect();
            // getBoundingClientRect uses viewport (client) coords — matches clientX/Y
            if (r.right > x1 && r.left < x2 && r.bottom > y1 && r.top < y2) {
              const cid = el.dataset.clipId;
              if (cid) selected.add(cid);
            }
          });
          setLassoSelectedIds(selected);
          if (selected.size === 1) {
            propsRef.current.onSelectClip?.([...selected][0]);
          }
        }
      }
      lassoBoxRef.current = null;
      setLassoBox(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [lassoBox]);

  // ── Track reorder drag ────────────────────────────────────────────────────
  useEffect(() => {
    if (!trackReorderDrag) return;

    const onMove = (e: MouseEvent) => {
      setTrackReorderDrag((prev) => prev ? { ...prev, currentY: e.clientY } : null);
    };

    const onUp = (e: MouseEvent) => {
      if (!trackReorderDrag) { setTrackReorderDrag(null); return; }

      // Find which track row the cursor is over
      const rows = Array.from(document.querySelectorAll<HTMLElement>(".timeline-row"))
        .map((el) => ({ el, r: el.getBoundingClientRect(), trackId: el.dataset.trackId ?? "" }))
        .sort((a, b) => a.r.top - b.r.top);

      let toIndex = rows.length; // default: move to bottom
      for (let i = 0; i < rows.length; i++) {
        const center = (rows[i].r.top + rows[i].r.bottom) / 2;
        if (e.clientY < center) { toIndex = i; break; }
      }

      propsRef.current.onReorderTrack?.(trackReorderDrag.trackId, toIndex);
      setTrackReorderDrag(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [trackReorderDrag]);

  // ── Track context menu renderer ───────────────────────────────────────────
  function renderTrackContextMenu() {
    if (!trackContextMenu) return null;
    const { x, y, trackId, trackKind, isMuted, isLocked, isSolo } = trackContextMenu;
    return (
      <div
        className="timeline-context-menu"
        style={{ position: "fixed", left: x, top: y, zIndex: 9999 }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="ctx-menu-header">{trackKind === "video" ? "🎬" : "🔊"} Track Actions</div>
        <div className="ctx-menu-sep" />
        <div className="ctx-menu-item" onClick={() => {
          setRenamingTrackId(trackId);
          setRenameValue("");
          setTrackContextMenu(null);
        }}>✏ Rename Track</div>
        <div className="ctx-menu-sep" />
        <div className="ctx-menu-item" onClick={() => {
          onUpdateTrack(trackId, { muted: !isMuted });
          setTrackContextMenu(null);
        }}>{isMuted ? "🔊 Unmute Track" : "🔇 Mute Track"}</div>
        <div className="ctx-menu-item" onClick={() => {
          onUpdateTrack(trackId, { solo: !isSolo });
          setTrackContextMenu(null);
        }}>{isSolo ? "⊗ Un-solo Track" : "◎ Solo Track"}</div>
        <div className="ctx-menu-item" onClick={() => {
          onUpdateTrack(trackId, { locked: !isLocked });
          setTrackContextMenu(null);
        }}>{isLocked ? "🔓 Unlock Track" : "🔒 Lock Track"}</div>
        <div className="ctx-menu-sep" />
        <div className="ctx-menu-item" onClick={() => {
          onAddTrack?.(trackKind);
          setTrackContextMenu(null);
        }}>+ Add {trackKind === "video" ? "Video" : "Audio"} Track</div>
        <div className="ctx-menu-item" onClick={() => {
          onDuplicateTrack?.(trackId);
          setTrackContextMenu(null);
        }}>⧉ Duplicate Track</div>
        <div className="ctx-menu-sep" />
        <div className="ctx-menu-sep" />
        <div className="ctx-menu-item" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          🎨 Set Color{" "}
          <input
            type="color"
            defaultValue="#ffffff"
            style={{ width: 22, height: 22, padding: 0, border: "none", cursor: "pointer", background: "none" }}
            onChange={(e) => {
              onUpdateTrack(trackId, { color: e.target.value });
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <div className="ctx-menu-sep" />
        <div className="ctx-menu-item ctx-menu-item-danger" onClick={() => {
          onRemoveTrack?.(trackId);
          setTrackContextMenu(null);
        }}>🗑 Delete Track</div>
      </div>
    );
  }

  // ── Context menu renderer ─────────────────────────────────────────────────
  function renderContextMenu() {
    if (!contextMenu) return null;
    const { x, y, clipId, isLinked, isEnabled, speed } = contextMenu;
    const frameAtPlayhead = playheadFrame;
    return (
      <div
        className="timeline-context-menu"
        style={{ position: "fixed", left: x, top: y, zIndex: 9999 }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="ctx-menu-item" onClick={() => { onSplitClip?.(clipId, frameAtPlayhead); setContextMenu(null); }}>
          ✂ Split at Playhead
        </div>
        <div className="ctx-menu-sep" />
        <div className="ctx-menu-item" onClick={() => { onDuplicateClip?.(clipId); setContextMenu(null); }}>
          ⧉ Duplicate
        </div>
        <div className="ctx-menu-item" onClick={() => { onDeleteClip?.(clipId); setContextMenu(null); }}>
          🗑 Delete
        </div>
        <div className="ctx-menu-sep" />
        <div className="ctx-menu-item ctx-menu-fusion" onClick={() => { onOpenInFusion?.(clipId); setContextMenu(null); }}>
          ⬡ Open in Fusion
        </div>
        <div className="ctx-menu-sep" />
        <div className="ctx-menu-item" onClick={() => { onToggleClipEnabled?.(clipId); setContextMenu(null); }}>
          {isEnabled ? "⊘ Disable Clip" : "✓ Enable Clip"}
        </div>
        <div className="ctx-menu-sep" />
        <div className="ctx-menu-item" onClick={() => { onAddFade?.(clipId, "in"); setContextMenu(null); }}>
          ◁ Add Fade In
        </div>
        <div className="ctx-menu-item" onClick={() => { onAddFade?.(clipId, "out"); setContextMenu(null); }}>
          ▷ Add Fade Out
        </div>
        <div className="ctx-menu-sep" />
        {isLinked ? (
          <div className="ctx-menu-item" onClick={() => { onDetachLinkedClips?.(clipId); setContextMenu(null); }}>
            🔗 Unlink Audio/Video
          </div>
        ) : (
          <div className="ctx-menu-item" onClick={() => { onRelinkClips?.(clipId); setContextMenu(null); }}>
            🔗 Relink Audio/Video
          </div>
        )}
        <div className="ctx-menu-sep" />
        <div className="ctx-menu-item ctx-menu-speed-row">
          <span>⚡ Speed:</span>
          <input
            className="ctx-speed-input"
            type="number"
            min={0.25} max={4} step={0.05}
            value={speedInput}
            onChange={(e) => setSpeedInput(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          <span>×</span>
          <button
            className="ctx-speed-apply"
            type="button"
            onClick={() => {
              const spd = Math.max(0.25, Math.min(4, parseFloat(speedInput) || speed));
              onSetClipSpeed?.(clipId, spd);
              setContextMenu(null);
            }}
          >Apply</button>
        </div>
      </div>
    );
  }

  // ── Ruler ticks ───────────────────────────────────────────────────────────
  function renderRulerTicks() {
    const ticks: React.ReactNode[] = [];
    const minTickPx = 50;
    const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    let interval = 30;
    for (const c of candidates) {
      if (c * pixelsPerFrame >= minTickPx) { interval = c; break; }
    }
    const count = Math.ceil(timelineFrames / interval) + 2;
    for (let i = 0; i < count; i++) {
      const frame = i * interval;
      if (frame > timelineFrames + interval) break;
      ticks.push(
        <div key={frame} className="ruler-tick" style={{ left: frame * pixelsPerFrame }}>
          <div className="ruler-tick-line" />
          <span className="ruler-tick-label">{formatTimecode(frame, sequenceFps)}</span>
        </div>
      );
    }
    return ticks;
  }

  return (
    <section className="panel timeline-panel">
      {renderContextMenu()}
      {renderTrackContextMenu()}

      {/* Inline track rename input (shown over the track label) */}
      {renamingTrackId && (() => {
        const layout = trackLayouts.find((l) => l.track.id === renamingTrackId);
        if (!layout) { setRenamingTrackId(null); return null; }
        return (
          <div
            className="track-rename-overlay"
            style={{ position: "fixed", zIndex: 10000, inset: 0, background: "transparent" }}
            onClick={() => setRenamingTrackId(null)}
          >
            <div
              className="track-rename-popup"
              style={{ position: "fixed", left: LABEL_W / 2, top: "50%", transform: "translateY(-50%)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <label style={{ display: "block", marginBottom: 6, fontSize: 12 }}>Rename track:</label>
              <input
                className="track-rename-input"
                autoFocus
                defaultValue={layout.track.name}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const name = renameValue.trim() || layout.track.name;
                    onRenameTrack ? onRenameTrack(renamingTrackId, name) : onUpdateTrack(renamingTrackId, { name });
                    setRenamingTrackId(null);
                  }
                  if (e.key === "Escape") setRenamingTrackId(null);
                }}
              />
              <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                <button className="ctx-speed-apply" type="button" onClick={() => {
                  const name = renameValue.trim() || layout.track.name;
                  onRenameTrack ? onRenameTrack(renamingTrackId, name) : onUpdateTrack(renamingTrackId, { name });
                  setRenamingTrackId(null);
                }}>Rename</button>
                <button className="ctx-speed-apply" type="button" onClick={() => setRenamingTrackId(null)}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── TOOLBAR ──────────────────────────────────────────────────────── */}
      <div className="panel-header timeline-header">
        <div className="tl-header-left">
          <span className="tl-section-label">TIMELINE</span>
          <span className="tl-info">{sequenceFps}fps</span>
          <span className="tl-info">{trackLayouts.length} tracks</span>
          <span className="tl-info tl-duration">
            {formatTimecode(Math.max(totalFrames - 1, 0), sequenceFps)}
          </span>
        </div>

        {/* Snap controls */}
        <div className="tl-snap-controls">
          <button
            className={`tl-snap-btn${snapEnabled ? " active" : ""}`}
            onClick={() => setSnapEnabled((v) => !v)}
            title={snapEnabled ? "Snap ON — click to disable" : "Snap OFF — click to enable"}
            type="button"
          >
            <span className="tl-snap-icon">⊞</span>
            {snapEnabled ? "Snap" : "Free"}
          </button>
          {snapEnabled && (
            <select
              className="tl-snap-select"
              value={snapDivIdx}
              onChange={(e) => setSnapDivIdx(Number(e.target.value))}
              title="Snap grid resolution"
            >
              {SNAP_DIVISIONS.map((d, i) => (
                <option key={d.label} value={i}>{d.label}</option>
              ))}
            </select>
          )}
        </div>

        <div className="tl-header-right">
          <span className="tl-info">{zoomPercent}%</span>
          <button
            className="tl-zoom-btn"
            disabled={pixelsPerFrame <= MIN_PPF}
            onClick={() => setZoom(pixelsPerFrame * 0.8)}
            type="button"
            title="Zoom out (Ctrl+scroll)"
          >−</button>
          <input
            type="range"
            className="tl-zoom-range"
            min={MIN_PPF} max={MAX_PPF} step={0.5}
            value={pixelsPerFrame}
            onChange={(e) => setZoom(Number(e.target.value))}
            title="Timeline zoom"
          />
          <button
            className="tl-zoom-btn"
            disabled={pixelsPerFrame >= MAX_PPF}
            onClick={() => setZoom(pixelsPerFrame * 1.25)}
            type="button"
            title="Zoom in (Ctrl+scroll)"
          >+</button>
          <span className="tl-header-sep" />
          <button
            className="tl-add-track-btn"
            onClick={() => onAddTrack?.("video")}
            title="Add video track"
            type="button"
          >+ V</button>
          <button
            className="tl-add-track-btn"
            onClick={() => onAddTrack?.("audio")}
            title="Add audio track"
            type="button"
          >+ A</button>
        </div>
      </div>

      {/* ── SCROLLABLE CANVAS ──────────────────────────────────────────────── */}
      <div
        ref={(el) => {
          // Attach a non-passive wheel listener so we can call preventDefault for zoom
          if (el && el !== timelineEditorRef.current) {
            const prev = timelineEditorRef.current;
            if (prev) prev.removeEventListener("wheel", (prev as HTMLDivElement & { _wheelHandler?: EventListener })._wheelHandler ?? (() => {}));
            const handler = (event: WheelEvent) => {
              if (event.ctrlKey || event.metaKey) {
                // Ctrl/Cmd + scroll → zoom timeline
                event.preventDefault();
                setZoom(ppfRef.current + (event.deltaY > 0 ? -0.8 : 0.8), event.clientX);
              } else if (event.shiftKey) {
                // Shift + scroll → horizontal scroll (scrub through timeline)
                event.preventDefault();
                el.scrollLeft += event.deltaY !== 0 ? event.deltaY : event.deltaX;
              } else {
                // Plain scroll → vertical scroll (tracks up/down) — let the browser handle it naturally
                // Only prevent default for deltaX (trackpad horizontal swipe) so it scrolls horizontally
                if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
                  event.preventDefault();
                  el.scrollLeft += event.deltaX;
                }
                // deltaY: let it fall through to native vertical scroll of the container
              }
            };
            (el as HTMLDivElement & { _wheelHandler?: EventListener })._wheelHandler = handler as EventListener;
            el.addEventListener("wheel", handler, { passive: false });
          }
          (timelineEditorRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }}
        className="timeline-editor"
      >
        {/* ── RULER ──────────────────────────────────────────────────────── */}
        <div
          ref={timelineRulerRef}
          className="timeline-ruler"
          style={{ minWidth: canvasWidth + LABEL_W }}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            const r = event.currentTarget.getBoundingClientRect();
            const scrollLeft = timelineEditorRef.current?.scrollLeft ?? 0;
            const px = event.clientX - r.left - LABEL_W + scrollLeft;
            const frame = Math.max(0, Math.min(Math.round(px / pixelsPerFrame), timelineFrames));
            onSetPlayheadFrame(frame);
            setIsScrubbingPlayhead(true);
          }}
        >
          <div className="ruler-label-spacer" style={{ width: LABEL_W }} />
          <div className="ruler-ticks-area" style={{ width: canvasWidth }}>
            {renderRulerTicks()}
            <div
              className="timeline-playhead-handle"
              style={{ left: playheadLeft }}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setIsScrubbingPlayhead(true); }}
            />
            {markInFrame !== null && (
              <div className="timeline-guide-marker mark-in" style={{ left: markInFrame * pixelsPerFrame }}>IN</div>
            )}
            {markOutFrame !== null && (
              <div className="timeline-guide-marker mark-out" style={{ left: markOutFrame * pixelsPerFrame }}>OUT</div>
            )}
            {suggestedCutFrames.map((f) => (
              <div key={`ai-${f}`} className="timeline-guide-marker ai-cut" style={{ left: f * pixelsPerFrame }}>✂</div>
            ))}
          </div>
        </div>

        {/* ── TRACK ROWS ─────────────────────────────────────────────────── */}
        {/* Global magnetic snap line — spans full height of the scroll canvas */}
        {snapIndicatorFrame !== null && (
          <div
            className="snap-indicator-global"
            style={{ left: LABEL_W + snapIndicatorFrame * pixelsPerFrame }}
            aria-hidden="true"
          />
        )}
        <div className="timeline-rows">

          {/*
           * Ghost-insert indicator helper — rendered BEFORE a specific track row.
           * Shows a pulsing new-track row with a clip preview at the correct X position.
           */}
          {(() => {
            const isInsert = ghostInfo && ghostInfo.intent !== "DRAG_ON_TRACK";
            if (!isInsert || !dragState) return null;

            const ghostRow = (
              <div className="timeline-new-track-ghost" key="ghost-insert">
                <div className="ghost-new-track-label">+ New {ghostInfo.newTrackKind} track</div>
                <div
                  className={`new-track-ghost-clip ${dragState.trackKind === "video" ? "video-clip" : "audio-clip"}`}
                  style={{
                    position: "absolute",
                    left: LABEL_W + ghostInfo.frame * pixelsPerFrame,
                    width: Math.max(dragState.durationFrames * pixelsPerFrame, 24),
                    top: 2,
                    bottom: 2,
                  }}
                />
              </div>
            );

            // INSERT_ABOVE_TOP → rendered before all rows (handled by returning ghostRow
            // from the enclosing fragment when trackIdx === 0 is not found yet)
            if (ghostInfo.intent === "INSERT_ABOVE_TOP") {
              return ghostRow;
            }

            // For INSERT_ABOVE_TRACK / INSERT_BELOW_BOTTOM we need to inject inline
            // with the map loop below — return null here so the map loop handles it
            return null;
          })()}

          {trackLayouts.map((layout) => {
            const isLocked = layout.track.locked;
            const isMuted  = layout.track.muted;
            const trackH   = layout.track.height ?? (layout.track.kind === "video" ? 56 : 44);
            const isReordering = trackReorderDrag?.trackId === layout.track.id;

            // Insert ghost ABOVE this track if insertBeforeTrackId matches
            const showGhostAbove = ghostInfo &&
              ghostInfo.intent === "INSERT_ABOVE_TRACK" &&
              dragState &&
              ghostInfo.insertBeforeTrackId === layout.track.id;

            return (
              <React.Fragment key={layout.track.id}>
                {/* Ghost row inserted immediately before this track row */}
                {showGhostAbove && dragState && (
                  <div className="timeline-new-track-ghost" key={`ghost-${layout.track.id}`}>
                    <div className="ghost-new-track-label">+ New {ghostInfo!.newTrackKind} track</div>
                    <div
                      className={`new-track-ghost-clip ${dragState.trackKind === "video" ? "video-clip" : "audio-clip"}`}
                      style={{
                        position: "absolute",
                        left: LABEL_W + ghostInfo!.frame * pixelsPerFrame,
                        width: Math.max(dragState.durationFrames * pixelsPerFrame, 24),
                        top: 2,
                        bottom: 2,
                      }}
                    />
                  </div>
                )}

              <div
                key={layout.track.id}
                data-track-id={layout.track.id}
                className={`timeline-row${isLocked ? " track-locked" : ""}${isMuted ? " track-muted" : ""}${isReordering ? " track-reordering" : ""}`}
                style={{ height: trackH }}
              >
                {/* ── Track label with controls ── */}
                <div
                  className={`timeline-track-label ${layout.track.kind}-track-label`}
                  style={{
                    width: LABEL_W,
                    borderLeft: `3px solid ${layout.track.color ?? (layout.track.kind === "video" ? "#4f8ef7" : "#2fc77a")}`
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu(null);
                    setTrackContextMenu({
                      x: e.clientX, y: e.clientY,
                      trackId: layout.track.id,
                      trackKind: layout.track.kind,
                      isMuted: layout.track.muted ?? false,
                      isLocked: layout.track.locked ?? false,
                      isSolo: layout.track.solo ?? false,
                    });
                  }}
                >
                  {/* Reorder drag handle */}
                  <div
                    className="track-reorder-handle"
                    title="Drag to reorder track"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setTrackReorderDrag({ trackId: layout.track.id, anchorY: e.clientY, currentY: e.clientY });
                    }}
                  >⠿</div>
                  <div className="track-label-top">
                    <span className="track-name" title={layout.track.name}>{layout.track.name}</span>
                  </div>
                  <div className="track-label-controls">
                    {/* Mute */}
                    <button
                      className={`track-ctrl-btn${isMuted ? " active-mute" : ""}`}
                      title={isMuted ? "Unmute track" : "Mute track"}
                      onClick={() => onUpdateTrack(layout.track.id, { muted: !isMuted })}
                      type="button"
                    >M</button>
                    {/* Lock */}
                    <button
                      className={`track-ctrl-btn${isLocked ? " active-lock" : ""}`}
                      title={isLocked ? "Unlock track" : "Lock track"}
                      onClick={() => onUpdateTrack(layout.track.id, { locked: !isLocked })}
                      type="button"
                    >{isLocked ? "🔒" : "🔓"}</button>
                    {/* Solo (video tracks: hide/show) */}
                    <button
                      className={`track-ctrl-btn${layout.track.solo ? " active-solo" : ""}`}
                      title={layout.track.solo ? "Un-solo" : (layout.track.kind === "audio" ? "Solo" : "Isolate")}
                      onClick={() => onUpdateTrack(layout.track.id, { solo: !layout.track.solo })}
                      type="button"
                    >S</button>
                  </div>
                  {/* Height resize handle */}
                  <div
                    className="track-height-handle"
                    title="Drag to resize track height"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setTrackHeightDrag({ trackId: layout.track.id, anchorY: e.clientY, origHeight: trackH });
                    }}
                  />
                </div>

                {/* ── Lane ── */}
                {/* drag-insert-above: bright top-border indicator when ghost will insert ABOVE this track */}
                {(() => {
                  const isInsertAboveThis = ghostInfo?.intent === "INSERT_ABOVE_TRACK" &&
                    ghostInfo.insertBeforeTrackId === layout.track.id;
                  const isDragTarget = ghostInfo?.intent === "DRAG_ON_TRACK" &&
                    ghostInfo.trackId === layout.track.id;
                  const laneClass = [
                    "timeline-lane",
                    `${layout.track.kind}-lane`,
                    toolMode === "blade" ? "blade-active" : "",
                    dropTargetTrackId === layout.track.id ? "drop-target" : "",
                    isLocked ? "lane-locked" : "",
                    isInsertAboveThis ? "drag-insert-above" : "",
                    isDragTarget ? "drag-on-track-target" : "",
                  ].filter(Boolean).join(" ");
                  return (
                <div
                  className={laneClass}
                  data-track-id={layout.track.id}
                  data-track-kind={layout.track.kind}
                  style={{ width: canvasWidth, opacity: isMuted ? 0.45 : 1 }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Only open track menu if click was NOT on a clip element
                    if ((e.target as HTMLElement).closest(".timeline-clip")) return;
                    setContextMenu(null);
                    setTrackContextMenu({
                      x: e.clientX, y: e.clientY,
                      trackId: layout.track.id,
                      trackKind: layout.track.kind,
                      isMuted: layout.track.muted ?? false,
                      isLocked: layout.track.locked ?? false,
                      isSolo: layout.track.solo ?? false,
                    });
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("application/x-asset-id") && !isLocked) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                      setDropTargetTrackId(layout.track.id);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTargetTrackId(null);
                  }}
                  onDrop={(e) => {
                    if (isLocked) return;
                    const assetId = e.dataTransfer.getData("application/x-asset-id");
                    if (!assetId) return;
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    const scrollLeft = timelineEditorRef.current?.scrollLeft ?? 0;
                    const px = e.clientX - r.left + scrollLeft;
                    const rawFrame = Math.max(0, Math.round(px / ppfRef.current));
                    const frame = snapFrame(rawFrame, snapEnabled, sequenceFps, SNAP_DIVISIONS[snapDivIdx].factor);
                    propsRef.current.onDropAsset(assetId, layout.track.id, frame);
                    setDropTargetTrackId(null);
                  }}
                  onClick={(e) => {
                    if (toolMode !== "select" || isLocked) return;
                    if ((e.target as HTMLElement).closest(".timeline-clip")) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    const scrollLeft = timelineEditorRef.current?.scrollLeft ?? 0;
                    const px = e.clientX - r.left + scrollLeft;
                    const frame = Math.max(0, Math.min(Math.round(px / pixelsPerFrame), timelineFrames));
                    onSetPlayheadFrame(frame);
                    // Clear lasso selection on empty click
                    setLassoSelectedIds(new Set());
                  }}
                  onMouseDown={(e) => {
                    // FIX 3: Start lasso when dragging on empty lane area (no clip under cursor)
                    if (e.button !== 0 || toolMode !== "select" || isLocked) return;
                    if ((e.target as HTMLElement).closest("[data-clip-id],.timeline-clip-handle,.fade-handle")) return;
                    // Use clientX/Y consistently with the move handler (viewport coords)
                    const lb = { startX: e.clientX, startY: e.clientY, curX: e.clientX, curY: e.clientY };
                    lassoBoxRef.current = lb;
                    setLassoBox(lb);
                    setLassoSelectedIds(new Set());
                  }}
                >
                  {/* Guide lines */}
                  {markInFrame !== null && <div className="timeline-guide-line mark-in" style={{ left: markInFrame * pixelsPerFrame }} />}
                  {markOutFrame !== null && <div className="timeline-guide-line mark-out" style={{ left: markOutFrame * pixelsPerFrame }} />}
                  {suggestedCutFrames.map((f) => (
                    <div key={`${layout.track.id}-ai-${f}`} className="timeline-guide-line ai-cut" style={{ left: f * pixelsPerFrame }} />
                  ))}

                  {/* Magnetic snap indicator — blue vertical line across all lanes */}
                  {snapIndicatorFrame !== null && (
                    <div
                      className="snap-indicator-line"
                      style={{ left: snapIndicatorFrame * pixelsPerFrame }}
                    />
                  )}

                  {/* Playhead */}
                  <div className="timeline-playhead" style={{ left: playheadLeft }} />

                  {/* Snap grid lines (subtle) */}
                  {snapEnabled && pixelsPerFrame >= 4 && (() => {
                    const gridFrames = Math.max(1, Math.round(sequenceFps * SNAP_DIVISIONS[snapDivIdx].factor));
                    const lines: React.ReactNode[] = [];
                    const count = Math.ceil(timelineFrames / gridFrames);
                    for (let i = 1; i < count; i++) {
                      lines.push(
                        <div key={i} className="snap-grid-line" style={{ left: i * gridFrames * pixelsPerFrame }} />
                      );
                    }
                    return lines;
                  })()}

                  {/* Empty state */}
                  {layout.segments.length === 0 && (
                    <div className="timeline-track-empty">
                      <span>{isLocked ? "🔒 Track locked" : "Drag a clip here"}</span>
                    </div>
                  )}

                  {/* Clips */}
                  {layout.segments.map((segment) => {
                    const clipLeft  = segment.startFrame * pixelsPerFrame;
                    const clipWidth = Math.max(segment.durationFrames * pixelsPerFrame, 24);
                    const isSelected = selectedClipId === segment.clip.id;
                    const isDragging = dragState?.clipId === segment.clip.id;

                    // Ghost position for this clip while dragging (live preview follows mouse)
                    // If dragging to a NEW track, show clip faded at original position (preview is in ghost row)
                    const isDraggingToNewTrack = isDragging && ghostInfo?.intent !== "DRAG_ON_TRACK";
                    const ghostTargetFrame = isDragging && ghostInfo?.intent === "DRAG_ON_TRACK" && ghostInfo.trackId === layout.track.id
                      ? ghostInfo.frame
                      : null;
                    // While dragging, show clip at ghost target position; otherwise at clip position
                    const displayLeft = ghostTargetFrame !== null ? ghostTargetFrame * pixelsPerFrame : clipLeft;

                    // Fade durations
                    const fadeInFrames  = segment.clip.transitionIn?.durationFrames  ?? 0;
                    const fadeOutFrames = segment.clip.transitionOut?.durationFrames ?? 0;
                    const fadeInPx      = fadeInFrames  * pixelsPerFrame;
                    const fadeOutPx     = fadeOutFrames * pixelsPerFrame;

                    // FIX 3: lasso highlight
                    const isLassoSelected = lassoSelectedIds.has(segment.clip.id);

                    const clipClass = [
                      "timeline-clip",
                      segment.track.kind === "video" ? "video-clip" : "audio-clip",
                      isSelected  ? "selected"  : "",
                      isLassoSelected ? "lasso-selected" : "",
                      !segment.clip.isEnabled ? "disabled" : "",
                      isDragging  ? "dragging"  : "",
                      isDraggingToNewTrack ? "dragging-to-new-track" : "",
                      isLocked    ? "clip-locked" : ""
                    ].filter(Boolean).join(" ");

                    return (
                      <div
                        key={segment.clip.id}
                        data-clip-id={segment.clip.id}
                        className={clipClass}
                        style={{
                          left: displayLeft,
                          width: clipWidth,
                          height: "calc(100% - 4px)",
                          // Fix 6: Prefer filmstrip repeating background; fall back to single thumbnail
                          ...(segment.track.kind === "video" && (segment.asset.filmstripThumbs?.length || segment.asset.thumbnailUrl)
                            ? (() => {
                                // Use first filmstrip thumb as repeating tile, or fallback to thumbnailUrl
                                const thumbSrc = segment.asset.filmstripThumbs?.[0] ?? segment.asset.thumbnailUrl;
                                const tileW = Math.max(48, pixelsPerFrame * 16);
                                return {
                                  backgroundImage: `url(${thumbSrc})`,
                                  backgroundRepeat: "repeat-x",
                                  backgroundSize: `${tileW}px 100%`,
                                  backgroundPosition: "left center"
                                };
                              })()
                            : {})
                        }}
                        onDragOver={(e) => {
                          if (e.dataTransfer.types.includes(TRANSITION_DRAG_TYPE)) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "copy";
                          }
                        }}
                        onDrop={(e) => {
                          const transitionType = e.dataTransfer.getData(TRANSITION_DRAG_TYPE);
                          if (!transitionType) return;
                          e.preventDefault();
                          e.stopPropagation();
                          // Determine if dropped on left half (in) or right half (out)
                          const rect = e.currentTarget.getBoundingClientRect();
                          const relX = e.clientX - rect.left;
                          const edge: "in" | "out" = relX < rect.width / 2 ? "in" : "out";
                          propsRef.current.onDropTransition?.(segment.clip.id, transitionType, edge);
                          propsRef.current.onSelectClip(segment.clip.id);
                        }}
                        onMouseDown={(event) => {
                          if (event.button !== 0 || isLocked) return;
                          const handleEl = (event.target as HTMLElement).closest(".timeline-clip-handle,.fade-handle");
                          if (handleEl) return;

                          event.stopPropagation();

                          if (propsRef.current.toolMode === "blade") {
                            const bounds = event.currentTarget.getBoundingClientRect();
                            const ratio = (event.clientX - bounds.left) / bounds.width;
                            const splitFrame = segment.startFrame + Math.floor(Math.max(0, Math.min(ratio, 0.9999)) * segment.durationFrames);
                            propsRef.current.onSetPlayheadFrame(splitFrame);
                            propsRef.current.onBladeCut(segment.clip.id, splitFrame);
                            return;
                          }

                          propsRef.current.onSelectClip(segment.clip.id);

                          const clipBounds = event.currentTarget.getBoundingClientRect();
                          const offsetFromClipLeft = event.clientX - clipBounds.left;
                          setDragState({
                            clipId: segment.clip.id,
                            trackKind: segment.track.kind,
                            offsetX: offsetFromClipLeft,
                            originalStartFrame: segment.startFrame,
                            originalTrackId: layout.track.id,
                            durationFrames: segment.durationFrames,
                          });
                          // Initialize ghost at current position (DRAG_ON_TRACK)
                          const initialGhost: GhostInfo = { intent: "DRAG_ON_TRACK", frame: segment.startFrame, trackId: layout.track.id, newTrackKind: layout.track.kind, insertBeforeTrackId: "", insertIndex: -1 };
                          ghostInfoRef.current = initialGhost;
                          setGhostInfo(initialGhost);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          propsRef.current.onSelectClip(segment.clip.id);
                          setSpeedInput(String((segment.clip.speed ?? 1).toFixed(2)));
                          setContextMenu({
                            x: event.clientX,
                            y: event.clientY,
                            clipId: segment.clip.id,
                            clipKind: segment.track.kind,
                            isLinked: Boolean(segment.clip.linkedGroupId),
                            isEnabled: segment.clip.isEnabled !== false,
                            speed: segment.clip.speed ?? 1,
                          });
                        }}
                      >
                        {/* Thumbnail tint overlay */}
                        {segment.track.kind === "video" && segment.asset.thumbnailUrl && (
                          <div className="clip-thumb-tint" />
                        )}

                        {/* ── Fade-in overlay + handle ── */}
                        {fadeInFrames > 0 && (
                          <div
                            className="clip-fade-overlay fade-in-overlay"
                            style={{ width: Math.min(fadeInPx, clipWidth * 0.5) }}
                          />
                        )}
                        <div
                          className={`fade-handle fade-handle-in${fadeInFrames > 0 ? " has-fade" : ""}`}
                          title={`Fade in: ${(fadeInFrames / sequenceFps).toFixed(2)}s — drag to adjust`}
                          style={{ left: fadeInPx }}
                          onMouseDown={(e) => {
                            if (isLocked) return;
                            e.stopPropagation(); e.preventDefault();
                            setFadeHandleState({
                              clipId: segment.clip.id,
                              edge: "in",
                              anchorX: e.clientX,
                              originalDurationFrames: fadeInFrames,
                              maxFrames: Math.floor(segment.durationFrames * 0.5)
                            });
                          }}
                        />

                        {/* Trim start handle */}
                        <span
                          className="timeline-clip-handle start"
                          onMouseDown={(e) => {
                            if (propsRef.current.toolMode !== "select" || isLocked) return;
                            e.preventDefault(); e.stopPropagation();
                            propsRef.current.onSelectClip(segment.clip.id);
                            setTrimState({
                              clipId: segment.clip.id, edge: "start", anchorX: e.clientX,
                              trimStartFrames: segment.clip.trimStartFrames,
                              trimEndFrames: segment.clip.trimEndFrames
                            });
                          }}
                        />

                        {/* ── Audio waveform (audio track clips only) ── */}
                        {segment.track.kind === "audio" && segment.asset.waveformPeaks?.length ? (() => {
                          const peaks = segment.asset.waveformPeaks!;
                          const h = Math.max(20, trackH - 8);
                          const w = clipWidth;
                          const half = h / 2;
                          const durationSrc = segment.durationSeconds * (segment.clip.speed ?? 1);
                          const totalSrc = segment.asset.durationSeconds || 1;
                          const startRatio = (segment.clip.trimStartFrames ?? 0) / ((totalSrc * sequenceFps) || 1) * (segment.clip.speed ?? 1);
                          const endRatio = Math.min(1, startRatio + (durationSrc / totalSrc));
                          const startIdx = Math.floor(startRatio * peaks.length);
                          const endIdx = Math.max(startIdx + 1, Math.ceil(endRatio * peaks.length));
                          const slice = peaks.slice(startIdx, endIdx);
                          if (!slice.length) return null;
                          const step = w / slice.length;
                          let d = `M0,${half.toFixed(1)}`;
                          for (let i = 0; i < slice.length; i++) {
                            const amp = Math.max(0.02, slice[i]) * half * 0.9;
                            d += ` L${(i * step).toFixed(1)},${(half - amp).toFixed(1)}`;
                          }
                          for (let i = slice.length - 1; i >= 0; i--) {
                            const amp = Math.max(0.02, slice[i]) * half * 0.9;
                            d += ` L${(i * step).toFixed(1)},${(half + amp).toFixed(1)}`;
                          }
                          d += " Z";
                          return (
                            <svg
                              className="clip-waveform"
                              width={w}
                              height={h}
                              style={{ position: "absolute", top: 2, left: 0, pointerEvents: "none" }}
                              aria-hidden="true"
                            >
                              <path d={d} fill="rgba(47,199,122,0.35)" />
                            </svg>
                          );
                        })() : null}

                        {/* Transition in pill */}
                        {segment.clip.transitionIn && (
                          <span className="timeline-transition-pill in" title={`In: ${segment.clip.transitionIn.type} (${getClipTransitionDurationFrames(segment.clip.transitionIn, segment.durationFrames)}f)`}>
                            ◁ {segment.clip.transitionIn.type.replace(/([A-Z])/g, ' $1').trim().slice(0,8)}
                          </span>
                        )}

                        {/* Clip content */}
                        <div className="timeline-clip-content">
                          <strong className="clip-name">{segment.asset.name}</strong>
                          {clipWidth > 60 && <span className="clip-dur">{formatDuration(segment.durationSeconds)}</span>}
                          {/* Status badges */}
                          {!segment.clip.isEnabled && (
                            <span className="clip-status-badge clip-badge-offline" title="Clip disabled">OFFLINE</span>
                          )}
                          {segment.clip.compGraph && (
                            <span className="clip-status-badge clip-badge-fusion" title="Has Fusion compositing graph">FUSION</span>
                          )}
                          {segment.asset.isHDR && (
                            <span className="clip-status-badge clip-badge-hdr" title="HDR content">HDR</span>
                          )}
                          {segment.clip.aiBackgroundRemoval?.enabled && (
                            <span className="clip-status-badge clip-badge-ai" title="AI background removal active">AI</span>
                          )}
                          {segment.clip.effects?.some((ef) => ef.enabled) && (
                            <span className="clip-fx-badge" title="Effects applied">✦</span>
                          )}
                          {(segment.clip.volume !== undefined && segment.clip.volume === 0) && (
                            <span className="clip-status-badge clip-badge-mute" title="Clip muted">MUTE</span>
                          )}
                          {(segment.clip.volume !== undefined && segment.clip.volume !== 1 && segment.clip.volume !== 0) && (
                            <span className="clip-vol-badge" title={`Volume: ${Math.round((segment.clip.volume ?? 1) * 100)}%`}>
                              🔊{Math.round((segment.clip.volume ?? 1) * 100)}%
                            </span>
                          )}
                          {(segment.clip.speed !== undefined && segment.clip.speed !== 1) && (
                            <span className="clip-speed-badge" title={`Speed: ${(segment.clip.speed ?? 1).toFixed(2)}×`}>
                              {(segment.clip.speed ?? 1).toFixed(1)}×
                            </span>
                          )}
                        </div>

                        {/* Transition out pill */}
                        {segment.clip.transitionOut && (
                          <span className="timeline-transition-pill out" title={`Out: ${segment.clip.transitionOut.type} (${getClipTransitionDurationFrames(segment.clip.transitionOut, segment.durationFrames)}f)`}>
                            {segment.clip.transitionOut.type.replace(/([A-Z])/g, ' $1').trim().slice(0,8)} ▷
                          </span>
                        )}

                        {/* Trim end handle */}
                        <span
                          className="timeline-clip-handle end"
                          onMouseDown={(e) => {
                            if (propsRef.current.toolMode !== "select" || isLocked) return;
                            e.preventDefault(); e.stopPropagation();
                            propsRef.current.onSelectClip(segment.clip.id);
                            setTrimState({
                              clipId: segment.clip.id, edge: "end", anchorX: e.clientX,
                              trimStartFrames: segment.clip.trimStartFrames,
                              trimEndFrames: segment.clip.trimEndFrames
                            });
                          }}
                        />

                        {/* ── Fade-out overlay + handle ── */}
                        {fadeOutFrames > 0 && (
                          <div
                            className="clip-fade-overlay fade-out-overlay"
                            style={{ width: Math.min(fadeOutPx, clipWidth * 0.5), right: 0, left: "auto" }}
                          />
                        )}
                        <div
                          className={`fade-handle fade-handle-out${fadeOutFrames > 0 ? " has-fade" : ""}`}
                          title={`Fade out: ${(fadeOutFrames / sequenceFps).toFixed(2)}s — drag to adjust`}
                          style={{ right: fadeOutPx, left: "auto" }}
                          onMouseDown={(e) => {
                            if (isLocked) return;
                            e.stopPropagation(); e.preventDefault();
                            setFadeHandleState({
                              clipId: segment.clip.id,
                              edge: "out",
                              anchorX: e.clientX,
                              originalDurationFrames: fadeOutFrames,
                              maxFrames: Math.floor(segment.durationFrames * 0.5)
                            });
                          }}
                        />
                      </div>
                    );
                  })}

                  {/* BUG 5: Ghost clip preview while dragging — shows origin as shadow at 0.4 opacity */}
                  {dragState && layout.segments.some((s) => s.clip.id === dragState.clipId) && (() => {
                    const seg = layout.segments.find((s) => s.clip.id === dragState.clipId);
                    if (!seg) return null;
                    const w = Math.max(seg.durationFrames * pixelsPerFrame, 24);
                    const isAudio = seg.track.kind === "audio";
                    // Show ghost at original position while clip moves
                    return (
                      <div
                        className={`timeline-clip-ghost${isAudio ? " audio-ghost" : ""}`}
                        style={{
                          left: seg.startFrame * pixelsPerFrame,
                          width: w,
                          top: 2,
                          height: "calc(100% - 4px)"
                        }}
                      />
                    );
                  })()}
                </div>
                  );
                })()}
              </div>
              </React.Fragment>
            );
          })}

          {/* Ghost new-track indicator at the bottom (INSERT_BELOW_BOTTOM) */}
          {ghostInfo?.intent === "INSERT_BELOW_BOTTOM" && dragState && (
            <div className="timeline-new-track-ghost">
              <div className="ghost-new-track-label">+ New {ghostInfo.newTrackKind} track</div>
              <div
                className={`new-track-ghost-clip ${dragState.trackKind === "video" ? "video-clip" : "audio-clip"}`}
                style={{
                  position: "absolute",
                  left: LABEL_W + ghostInfo.frame * pixelsPerFrame,
                  width: Math.max(dragState.durationFrames * pixelsPerFrame, 24),
                  top: 2,
                  bottom: 2,
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── FIX 3: Lasso rubber-band selection box (fixed viewport overlay) ── */}
      {lassoBox && (() => {
        const x1 = Math.min(lassoBox.startX, lassoBox.curX);
        const y1 = Math.min(lassoBox.startY, lassoBox.curY);
        const w  = Math.abs(lassoBox.curX - lassoBox.startX);
        const h  = Math.abs(lassoBox.curY - lassoBox.startY);
        return (
          <div
            className="lasso-selection-box"
            style={{ position: "fixed", left: x1, top: y1, width: w, height: h, zIndex: 9998, pointerEvents: "none" }}
          />
        );
      })()}

      {/* ── FIX 3: Lasso multi-select action bar ── */}
      {lassoSelectedIds.size > 1 && !lassoBox && (
        <div className="lasso-action-bar">
          <span className="lasso-count">{lassoSelectedIds.size} clips selected</span>
          <button
            className="panel-action danger"
            type="button"
            onClick={() => {
              lassoSelectedIds.forEach((id) => onDeleteClip?.(id));
              setLassoSelectedIds(new Set());
            }}
          >
            🗑 Delete All
          </button>
          <button
            className="panel-action muted"
            type="button"
            onClick={() => {
              lassoSelectedIds.forEach((id) => onDuplicateClip?.(id));
              setLassoSelectedIds(new Set());
            }}
          >
            ⧉ Duplicate All
          </button>
          <button
            className="panel-action muted"
            type="button"
            onClick={() => setLassoSelectedIds(new Set())}
          >
            ✕ Clear
          </button>
        </div>
      )}
    </section>
  );
}
