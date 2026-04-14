// ─────────────────────────────────────────────────────────────────────────────
// 264 Pro – Transitions Panel
// Category tabs · animated CSS thumbnails · drag-and-drop onto timeline edges
// Recently-used tracking · duration/easing pop-over per card
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipTransitionType, TransitionCategory } from "../../shared/models";
import {
  ALL_TRANSITION_TYPES,
  TRANSITION_CATEGORIES,
} from "../../shared/models";

// ── Constants ─────────────────────────────────────────────────────────────────

const RECENT_KEY = "264pro_recent_transitions";
const MAX_RECENT  = 8;
const DEFAULT_DURATION_FRAMES = 15;  // 0.5 s @ 30 fps

// ── Drag data type ────────────────────────────────────────────────────────────

export const TRANSITION_DRAG_TYPE = "application/x-transition-type";

// ── Popover state ─────────────────────────────────────────────────────────────

interface PopoverState {
  transitionValue: ClipTransitionType;
  x: number;
  y: number;
}

// ── Recent tracking ───────────────────────────────────────────────────────────

function loadRecent(): ClipTransitionType[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as ClipTransitionType[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: ClipTransitionType[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

function pushRecent(type: ClipTransitionType, prev: ClipTransitionType[]): ClipTransitionType[] {
  const filtered = prev.filter((t) => t !== type);
  const next = [type, ...filtered].slice(0, MAX_RECENT);
  saveRecent(next);
  return next;
}

// ── Thumbnail animation CSS ───────────────────────────────────────────────────
// Each card animates with a CSS keyframe representative of the transition family.

function getThumbClass(value: ClipTransitionType): string {
  // Map to one of our CSS animation buckets
  if (value === "cut") return "thumb-cut";
  if (value === "fade" || value === "dipBlack" || value === "dipWhite" || value === "dipColor" || value === "additiveDissolve") return "thumb-fade";
  if (value === "crossDissolve" || value === "luminanceDissolve" || value === "filmDissolve" || value === "blurDissolve") return "thumb-dissolve";
  if (value.startsWith("wipe")) return "thumb-wipe";
  if (value === "cover" || value === "uncover" || value.startsWith("push") || value.startsWith("slide")) return "thumb-push";
  if (value === "whipPan" || value === "spinCW" || value === "spinCCW" || value.startsWith("zoom") || value === "zoomCross") return "thumb-zoom";
  if (value === "glitch" || value === "glitchRgb") return "thumb-glitch";
  if (value === "filmBurn" || value === "lightLeak" || value === "lensFlare" || value === "prism") return "thumb-burn";
  if (value === "shake" || value === "rumble") return "thumb-shake";
  if (value === "staticNoise" || value === "oldFilm" || value === "vhsRewind" || value === "vhsStatic") return "thumb-noise";
  if (value === "pixelate") return "thumb-noise";
  if (value === "ripple") return "thumb-dissolve";
  if (value === "chromaShift") return "thumb-glitch";
  if (value.startsWith("iris") || value === "diamond" || value.startsWith("reveal")) return "thumb-iris";
  if (value === "whiteFlash" || value === "filmFlash" || value === "exposure") return "thumb-white-flash";
  if (value === "blackFlash") return "thumb-black-flash";
  // Phase 6: Signature transitions
  if (value === "whip_smear") return "thumb-zoom";
  if (value === "light_leak_dissolve") return "thumb-burn";
  if (value === "digital_shatter") return "thumb-glitch";
  return "thumb-fade";
}

function getThumbColors(value: ClipTransitionType): { a: string; b: string } {
  const hue = [...value].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const hue2 = (hue + 150) % 360;
  return {
    a: `hsl(${hue},60%,38%)`,
    b: `hsl(${hue2},55%,32%)`,
  };
}

// ── Transition thumbnail ──────────────────────────────────────────────────────

interface ThumbProps {
  value: ClipTransitionType;
  isHovered: boolean;
}

function TransitionThumb({ value, isHovered }: ThumbProps) {
  const { a, b } = getThumbColors(value);
  const cls = getThumbClass(value);
  return (
    <div className={`transition-thumb ${cls}${isHovered ? " playing" : ""}`}>
      <div className="thumb-a" style={{ background: a }} />
      <div className="thumb-b" style={{ background: b }} />
      <div className="thumb-overlay" />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface TransitionsPanelProps {
  selectedClipId: string | null;
  onApplyTransition: (type: ClipTransitionType, edge: "in" | "out", durationFrames: number) => void;
}

export function TransitionsPanel({ selectedClipId, onApplyTransition }: TransitionsPanelProps) {
  const [activeCategory, setActiveCategory] = useState<TransitionCategory | "All" | "Recent">("All");
  const [recent, setRecent] = useState<ClipTransitionType[]>(() => loadRecent());
  const [hoveredValue, setHoveredValue] = useState<ClipTransitionType | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [popoverDuration, setPopoverDuration] = useState(DEFAULT_DURATION_FRAMES);
  const [popoverEdge, setPopoverEdge] = useState<"in" | "out">("in");
  const [search, setSearch] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!popover) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popover]);

  const applyFromPopover = useCallback(() => {
    if (!popover) return;
    const dur = Math.max(1, popoverDuration);
    onApplyTransition(popover.transitionValue, popoverEdge, dur);
    setRecent((prev) => pushRecent(popover.transitionValue, prev));
    setPopover(null);
  }, [popover, popoverDuration, popoverEdge, onApplyTransition]);

  // Filtered list
  const filteredTransitions = ALL_TRANSITION_TYPES.filter((t) => {
    if (search.trim()) {
      return t.label.toLowerCase().includes(search.toLowerCase());
    }
    if (activeCategory === "Recent") {
      return recent.includes(t.value);
    }
    if (activeCategory === "All") return true;
    return t.category === activeCategory;
  });

  // Sort Recent list to match recent order
  const displayList = activeCategory === "Recent"
    ? [...filteredTransitions].sort((a, b) => recent.indexOf(a.value) - recent.indexOf(b.value))
    : filteredTransitions;

  const handleDragStart = useCallback((e: React.DragEvent, value: ClipTransitionType) => {
    e.dataTransfer.setData(TRANSITION_DRAG_TYPE, value);
    e.dataTransfer.setData("text/plain", value);
    e.dataTransfer.effectAllowed = "copy";
  }, []);

  const handleCardClick = useCallback((e: React.MouseEvent, value: ClipTransitionType) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopoverDuration(DEFAULT_DURATION_FRAMES);
    setPopoverEdge("in");
    setPopover({ transitionValue: value, x: rect.left, y: rect.bottom + 4 });
  }, []);

  const handleQuickApply = useCallback((value: ClipTransitionType, edge: "in" | "out") => {
    onApplyTransition(value, edge, DEFAULT_DURATION_FRAMES);
    setRecent((prev) => pushRecent(value, prev));
  }, [onApplyTransition]);

  const categories: Array<"All" | "Recent" | TransitionCategory> = ["All", "Recent", ...TRANSITION_CATEGORIES];

  return (
    <div className="transitions-panel">
      {/* Search */}
      <div className="transitions-search">
        <input
          type="text"
          placeholder="Search transitions…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setActiveCategory("All"); }}
          className="transitions-search-input"
        />
        {search && (
          <button className="transitions-search-clear" onClick={() => setSearch("")} type="button">✕</button>
        )}
      </div>

      {/* Category tabs */}
      {!search && (
        <div className="transitions-tabs">
          {categories.map((cat) => (
            <button
              key={cat}
              className={`transitions-tab${activeCategory === cat ? " active" : ""}`}
              onClick={() => setActiveCategory(cat)}
              type="button"
            >
              {cat === "Recent" ? (recent.length > 0 ? "Recent" : null) : cat}
            </button>
          )).filter(Boolean)}
        </div>
      )}

      {/* No clip selected hint */}
      {!selectedClipId && (
        <div className="transitions-hint">
          <span className="transitions-hint-icon">⟵</span>
          <p>Select a clip on the timeline, then click or drag a transition onto it.</p>
        </div>
      )}

      {/* Grid */}
      <div className="transitions-grid">
        {displayList.length === 0 ? (
          <div className="transitions-empty">
            {activeCategory === "Recent" ? "No recently used transitions." : "No transitions found."}
          </div>
        ) : displayList.map((t) => (
          <div
            key={t.value}
            className={`transition-card${hoveredValue === t.value ? " hovered" : ""}${!selectedClipId ? " dimmed" : ""}`}
            draggable
            onDragStart={(e) => handleDragStart(e, t.value)}
            onMouseEnter={() => setHoveredValue(t.value)}
            onMouseLeave={() => setHoveredValue(null)}
            onClick={(e) => handleCardClick(e, t.value)}
            title={`${t.label} — click to apply options, drag to timeline clip edge`}
          >
            <TransitionThumb value={t.value} isHovered={hoveredValue === t.value} />
            <div className="transition-card-label">{t.label}</div>
            {t.webgl && <div className="transition-card-badge" title="GPU-accelerated WebGL transition">GL</div>}

            {/* Quick-apply In / Out buttons on hover */}
            <div className="transition-card-quick">
              <button
                className="tcard-quick-btn"
                onClick={(e) => { e.stopPropagation(); handleQuickApply(t.value, "in"); }}
                title="Apply to clip IN"
                type="button"
              >In</button>
              <button
                className="tcard-quick-btn"
                onClick={(e) => { e.stopPropagation(); handleQuickApply(t.value, "out"); }}
                title="Apply to clip OUT"
                type="button"
              >Out</button>
            </div>
          </div>
        ))}
      </div>

      {/* Duration/Easing Popover */}
      {popover && (
        <div
          ref={popoverRef}
          className="transition-popover"
          style={{ position: "fixed", left: Math.min(popover.x, window.innerWidth - 220), top: popover.y, zIndex: 9999 }}
        >
          <div className="transition-popover-title">
            {ALL_TRANSITION_TYPES.find((t) => t.value === popover.transitionValue)?.label ?? popover.transitionValue}
          </div>

          <label className="transition-popover-label">Apply to</label>
          <div className="transition-popover-edge-row">
            <button
              className={`transition-popover-edge-btn${popoverEdge === "in" ? " active" : ""}`}
              onClick={() => setPopoverEdge("in")}
              type="button"
            >Clip In</button>
            <button
              className={`transition-popover-edge-btn${popoverEdge === "out" ? " active" : ""}`}
              onClick={() => setPopoverEdge("out")}
              type="button"
            >Clip Out</button>
          </div>

          <label className="transition-popover-label">Duration (frames)</label>
          <div className="transition-popover-duration-row">
            <input
              type="range"
              min={1}
              max={90}
              step={1}
              value={popoverDuration}
              onChange={(e) => setPopoverDuration(Number(e.target.value))}
              className="transition-popover-slider"
            />
            <input
              type="number"
              min={1}
              max={90}
              value={popoverDuration}
              onChange={(e) => setPopoverDuration(Math.max(1, Number(e.target.value)))}
              className="transition-popover-number"
            />
          </div>
          <div className="transition-popover-duration-hint">
            {(popoverDuration / 30).toFixed(2)} s @ 30 fps
          </div>

          <div className="transition-popover-actions">
            <button className="transition-popover-cancel" onClick={() => setPopover(null)} type="button">Cancel</button>
            <button className="transition-popover-apply" onClick={applyFromPopover} type="button">Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
