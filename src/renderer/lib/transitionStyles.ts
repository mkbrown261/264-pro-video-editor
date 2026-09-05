/**
 * transitionStyles
 * ─────────────────────────────────────────────────────────────────────────────
 * CSS styling for A/B video transitions in the viewer.
 *
 * The viewer renders TWO video layers during a transition:
 *   • the OUTGOING clip (A) — the clip that ends at the cut
 *   • the INCOMING clip (B) — the clip that starts at the cut
 *
 * `progress` runs 0 → 1 across the whole junction (0 = 100 % A, 1 = 100 % B).
 * Each transition type describes how the two layers look at a given progress
 * (opacity, clip-path, transform, filter) plus an optional full-stage overlay
 * (flashes, dips, light leaks…).  Layers are stacked with `zIndex`; by default
 * A sits on top of B and is removed (faded / clipped / pushed away) to reveal
 * B, but reveal-style wipes (iris, blinds, split…) put B on top and grow it.
 *
 * Edge fades (a clip with no neighbour) get the same styles; the missing side
 * is simply absent, so the visible layer fades / wipes to the black stage.
 *
 * Everything here is a pure function of (type, progress, role) so it is
 * trivially testable and independent of React.
 */

import type { CSSProperties } from "react";
import type { ClipTransitionType } from "../../shared/models";

export type LayerRole = "out" | "in";

export interface LayerStyle {
  /** Applied to the clipping wrapper <div> (transform, opacity, z-index, blend). */
  wrapper: CSSProperties;
  /** Applied to the <video> element (clip-path). */
  video: CSSProperties;
  /** Extra CSS filter appended to the video's filter list (blur, sepia…). */
  filter?: string;
}

export interface TransitionLayerStyles {
  out: LayerStyle;
  in: LayerStyle;
  /** Full-stage overlay above both layers (colour dips, flashes, textures). */
  overlay: CSSProperties;
}

const Z_UNDER = 1;
const Z_OVER = 2;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
/** Bell curve peaking (=1) at the cut, 0 at both ends. */
const bell = (p: number) => Math.sin(clamp01(p) * Math.PI);
/** Triangle peaking (=1) at the cut. */
const tri = (p: number) => 1 - Math.abs(2 * clamp01(p) - 1);

function layer(wrapper: CSSProperties, video: CSSProperties = {}, filter?: string): LayerStyle {
  return { wrapper, video, filter };
}
const HIDDEN: LayerStyle = layer({ opacity: 0, zIndex: Z_UNDER });
const FULL_UNDER: LayerStyle = layer({ zIndex: Z_UNDER });
const FULL_OVER: LayerStyle = layer({ zIndex: Z_OVER });
const NO_OVERLAY: CSSProperties = { opacity: 0 };

// ── Geometry helpers for clip-path polygons ──────────────────────────────────

/** Sector of a circle (clock hand sweep) covering `p` of a full turn, from 12 o'clock clockwise. */
export function clockSectorPolygon(p: number, steps = 36): string {
  const t = clamp01(p);
  if (t <= 0) return "polygon(50% 50%, 50% 50%, 50% 50%)";
  if (t >= 1) return "polygon(0 0, 100% 0, 100% 100%, 0 100%)";
  const pts: string[] = ["50% 50%", "50% -60%"];
  const n = Math.max(1, Math.ceil(steps * t));
  for (let i = 1; i <= n; i++) {
    const a = (Math.min(i / steps, t)) * Math.PI * 2 - Math.PI / 2;
    // radius 1.1 × half-diagonal so the sweep always reaches the corners
    const r = 1.1 * Math.SQRT2 * 50;
    pts.push(`${(50 + Math.cos(a) * r).toFixed(2)}% ${(50 + Math.sin(a) * r).toFixed(2)}%`);
  }
  return `polygon(${pts.join(", ")})`;
}

/** Five-point star centred on the stage, scaled so that at p=1 it covers the stage. */
export function starPolygon(p: number): string {
  const t = clamp01(p);
  const R = t * 110;          // outer radius in % of half-stage → 110% covers corners
  const r = R * 0.45;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rad = i % 2 === 0 ? R : r;
    pts.push(`${(50 + Math.cos(a) * rad).toFixed(2)}% ${(50 + Math.sin(a) * rad).toFixed(2)}%`);
  }
  return `polygon(${pts.join(", ")})`;
}

/** Heart shape centred on the stage; p=1 covers the stage. */
export function heartPolygon(p: number, steps = 40): string {
  const t = clamp01(p);
  const scale = t * 4.2; // parametric heart spans roughly ±16 × 26 units
  const pts: string[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(a), 3);
    const y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
    pts.push(`${(50 + x * scale).toFixed(2)}% ${(50 + y * scale).toFixed(2)}%`);
  }
  return `polygon(${pts.join(", ")})`;
}

/** Venetian blinds: N horizontal slats each open to fraction p. */
export function blindsPolygon(p: number, slats = 8): string {
  const t = clamp01(p);
  if (t >= 1) return "polygon(0 0, 100% 0, 100% 100%, 0 100%)";
  const h = 100 / slats;
  const pts: string[] = [];
  for (let i = 0; i < slats; i++) {
    const y0 = i * h;
    const y1 = y0 + h * t;
    pts.push(`0 ${y0.toFixed(3)}%`, `100% ${y0.toFixed(3)}%`, `100% ${y1.toFixed(3)}%`, `0 ${y1.toFixed(3)}%`);
  }
  return `polygon(${pts.join(", ")})`;
}

/**
 * Region of the OUTGOING clip that remains during a diagonal wipe.  The
 * dividing line moves from the `from` corner to the opposite corner as p→1.
 */
export function diagonalRemainingPolygon(p: number, from: "tl" | "tr"): string {
  const d = clamp01(p) * 2; // 0..2 — position of the diagonal along x+y (or (1-x)+y)
  // Work in "tl" space then mirror for "tr".
  let pts: Array<[number, number]>;
  if (d <= 1) {
    pts = [[d, 0], [1, 0], [1, 1], [0, 1], [0, d]];
  } else {
    pts = [[1, d - 1], [1, 1], [d - 1, 1]];
  }
  const mapped = pts.map(([x, y]) => (from === "tr" ? [1 - x, y] : [x, y]) as [number, number]);
  return `polygon(${mapped.map(([x, y]) => `${pct(x)} ${pct(y)}`).join(", ")})`;
}

// ── Main lookup ───────────────────────────────────────────────────────────────

/**
 * Styles for both layers + overlay for `type` at `progress`.
 * `frame` only feeds pseudo-random jitter for shake/glitch style effects.
 */
export function getTransitionLayerStyles(
  type: ClipTransitionType,
  progress: number,
  frame: number
): TransitionLayerStyles {
  const p = clamp01(progress);
  const q = 1 - p;
  const jitter = (seed: number, amp: number) => Math.sin(frame * seed) * amp;

  const dissolve = (): TransitionLayerStyles => ({
    out: layer({ opacity: q, zIndex: Z_OVER }),
    in: FULL_UNDER,
    overlay: NO_OVERLAY
  });
  /** A is fully replaced by B at the cut behind an opaque overlay. */
  const hardSwapBehind = (overlay: CSSProperties): TransitionLayerStyles => ({
    out: p < 0.5 ? FULL_OVER : HIDDEN,
    in: p >= 0.5 ? FULL_UNDER : HIDDEN,
    overlay
  });
  /** B on top, revealed through a growing clip-path. */
  const revealB = (clipPath: string): TransitionLayerStyles => ({
    out: FULL_UNDER,
    in: layer({ zIndex: Z_OVER }, { clipPath }),
    overlay: NO_OVERLAY
  });
  /** A on top, removed through a shrinking clip-path. */
  const removeA = (clipPath: string): TransitionLayerStyles => ({
    out: layer({ zIndex: Z_OVER }, { clipPath }),
    in: FULL_UNDER,
    overlay: NO_OVERLAY
  });
  const push = (axis: "X" | "Y", dir: 1 | -1): TransitionLayerStyles => ({
    out: layer({ transform: `translate${axis}(${pct(dir * p)})`, zIndex: Z_OVER }),
    in: layer({ transform: `translate${axis}(${pct(-dir * q)})`, zIndex: Z_UNDER }),
    overlay: NO_OVERLAY
  });

  switch (type) {
    // ── Dissolves ───────────────────────────────────────────────────────────
    case "fade":
    case "crossDissolve":
    case "pixelate":   // WebGL types fall back to a dissolve when GL is unavailable
    case "ripple":
      return dissolve();
    case "luminanceDissolve":
      return { ...dissolve(), overlay: { background: "#fff", opacity: bell(p) * 0.35, mixBlendMode: "soft-light" } };
    case "filmDissolve":
      return {
        ...dissolve(),
        overlay: {
          background: `linear-gradient(135deg, rgba(${Math.floor(200 + (frame % 55))},${Math.floor(100 + (frame % 80))},50,0.5), rgba(0,0,0,0.7))`,
          opacity: bell(p) * 0.55
        }
      };
    case "additiveDissolve":
      return {
        out: layer({ opacity: q, zIndex: Z_OVER, mixBlendMode: "screen" }),
        in: FULL_UNDER,
        overlay: { background: "#fff", opacity: bell(p) * 0.25 }
      };
    case "dipBlack":
      return hardSwapBehind({ background: "#000", opacity: Math.min(1, tri(p) * 1.15) });
    case "dipWhite":
      return hardSwapBehind({ background: "#fff", opacity: Math.min(1, tri(p) * 1.15) });
    case "dipColor":
      return hardSwapBehind({ background: "#800080", opacity: Math.min(1, tri(p) * 1.15) });

    // ── Wipes (A removed) ───────────────────────────────────────────────────
    case "wipe":
    case "wipeLeft":   return removeA(`inset(0 0 0 ${pct(p)})`);
    case "wipeRight":  return removeA(`inset(0 ${pct(p)} 0 0)`);
    case "wipeUp":     return removeA(`inset(0 0 ${pct(p)} 0)`);
    case "wipeDown":   return removeA(`inset(${pct(p)} 0 0 0)`);
    case "wipeDiagTL": return removeA(diagonalRemainingPolygon(p, "tl"));
    case "wipeDiagTR": return removeA(diagonalRemainingPolygon(p, "tr"));
    // ── Reveals (B grows on top) ────────────────────────────────────────────
    case "wipeRadial":
    case "irisCircle": return revealB(`circle(${pct(p * 0.75)} at 50% 50%)`);
    case "wipeClock":  return revealB(clockSectorPolygon(p));
    case "wipeStar":
    case "irisStar":   return revealB(starPolygon(p));
    case "irisHeart":  return revealB(heartPolygon(p));
    case "wipeBlinds": return revealB(blindsPolygon(p));
    case "wipeSplit":
    case "revealSplitV": return revealB(`inset(0 ${pct(q * 0.5)})`);
    case "revealSplitH": return revealB(`inset(${pct(q * 0.5)} 0)`);
    case "diamond":
      return revealB(`polygon(50% ${pct(0.5 - p)}, ${pct(0.5 + p)} 50%, 50% ${pct(0.5 + p)}, ${pct(0.5 - p)} 50%)`);

    // ── Push / slide / cover ────────────────────────────────────────────────
    case "push":
    case "pushLeft":   return push("X", -1);
    case "pushRight":  return push("X", 1);
    case "pushUp":     return push("Y", -1);
    case "pushDown":   return push("Y", 1);
    case "slideLeft":
      return { out: layer({ transform: `translateX(${pct(-p)})`, zIndex: Z_OVER }), in: layer({ opacity: Math.min(1, 0.4 + p), zIndex: Z_UNDER }), overlay: NO_OVERLAY };
    case "slideRight":
      return { out: layer({ transform: `translateX(${pct(p)})`, zIndex: Z_OVER }), in: layer({ opacity: Math.min(1, 0.4 + p), zIndex: Z_UNDER }), overlay: NO_OVERLAY };
    case "cover":
      return { out: FULL_UNDER, in: layer({ transform: `translateX(${pct(q)})`, zIndex: Z_OVER }), overlay: NO_OVERLAY };
    case "uncover":
      return { out: layer({ transform: `translateX(${pct(-p)})`, zIndex: Z_OVER }), in: FULL_UNDER, overlay: NO_OVERLAY };

    // ── Zoom / spin ─────────────────────────────────────────────────────────
    case "zoom":
    case "zoomIn":
      return { out: layer({ transform: `scale(${(1 + p * 0.6).toFixed(4)})`, opacity: q, zIndex: Z_OVER }), in: FULL_UNDER, overlay: NO_OVERLAY };
    case "zoomOut":
      return { out: layer({ transform: `scale(${Math.max(0.05, q).toFixed(4)})`, opacity: q, zIndex: Z_OVER }), in: FULL_UNDER, overlay: NO_OVERLAY };
    case "zoomCross":
      return {
        out: layer({ transform: `scale(${(1 + p * 0.4).toFixed(4)})`, opacity: q, zIndex: Z_OVER }),
        in: layer({ transform: `scale(${(0.7 + 0.3 * p).toFixed(4)})`, zIndex: Z_UNDER }),
        overlay: NO_OVERLAY
      };
    case "spinCW":
    case "spinCCW": {
      const s = type === "spinCW" ? 1 : -1;
      return {
        out: layer({ transform: `rotate(${(s * p * 180).toFixed(2)}deg) scale(${Math.max(0.05, q).toFixed(4)})`, opacity: q, zIndex: Z_OVER }),
        in: layer({ transform: `rotate(${(-s * q * 180).toFixed(2)}deg) scale(${Math.max(0.05, p).toFixed(4)})`, zIndex: Z_UNDER }),
        overlay: NO_OVERLAY
      };
    }

    // ── Motion / camera ─────────────────────────────────────────────────────
    case "shake": {
      const amp = bell(p);
      return {
        out: layer({ transform: `translate(${jitter(1.37, 22 * amp).toFixed(2)}px, ${jitter(1.11, 12 * amp).toFixed(2)}px) rotate(${jitter(0.8, 1.8 * amp).toFixed(3)}deg)`, opacity: q, zIndex: Z_OVER }),
        in: layer({ transform: `translate(${jitter(1.73, 22 * amp).toFixed(2)}px, ${jitter(1.31, 12 * amp).toFixed(2)}px)`, zIndex: Z_UNDER }),
        overlay: NO_OVERLAY
      };
    }
    case "rumble": {
      const amp = bell(p);
      return {
        out: layer({ transform: `translate(${jitter(0.42, 32 * amp).toFixed(2)}px, ${jitter(0.57, 18 * amp).toFixed(2)}px) scale(${(1 + amp * 0.04).toFixed(4)})`, opacity: q, zIndex: Z_OVER }),
        in: layer({ transform: `translate(${jitter(0.62, 32 * amp).toFixed(2)}px, ${jitter(0.77, 18 * amp).toFixed(2)}px) scale(${(1 + amp * 0.04).toFixed(4)})`, zIndex: Z_UNDER }),
        overlay: { background: "radial-gradient(circle, rgba(255,143,61,0.18), rgba(0,0,0,0.45))", opacity: amp * 0.5 }
      };
    }
    case "whipPan":
      return {
        out: layer({ transform: `translateX(${pct(-p * 0.6)})`, opacity: q, zIndex: Z_OVER }, {}, `blur(${(p * 20).toFixed(1)}px)`),
        in: layer({ transform: `translateX(${pct(q * 0.6)})`, zIndex: Z_UNDER }, {}, `blur(${(q * 20).toFixed(1)}px)`),
        overlay: NO_OVERLAY
      };
    case "glitch":
    case "glitchRgb": {
      const amp = bell(p);
      return {
        out: layer({ transform: `translate(${jitter(3.7, 18 * amp).toFixed(2)}px, ${jitter(4.4, 8 * amp).toFixed(2)}px) skew(${jitter(2.6, 2.5 * amp).toFixed(3)}deg)`, opacity: q, zIndex: Z_OVER }),
        in: layer({ transform: `translate(${jitter(2.9, 14 * amp).toFixed(2)}px, 0)`, zIndex: Z_UNDER }),
        overlay: { background: "repeating-linear-gradient(180deg, rgba(95,196,255,0.22) 0px, rgba(95,196,255,0.22) 2px, transparent 2px, transparent 6px)", opacity: amp * 0.9, mixBlendMode: "screen" }
      };
    }
    case "vhsRewind": {
      const amp = bell(p);
      return {
        out: layer({ transform: `translateY(${jitter(5, 6 * amp).toFixed(2)}px)`, opacity: q, zIndex: Z_OVER }),
        in: FULL_UNDER,
        overlay: { background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 4px)", opacity: amp * 0.8 }
      };
    }

    // ── Filter based ────────────────────────────────────────────────────────
    case "blur":
    case "blurDissolve":
      return {
        out: layer({ opacity: q, zIndex: Z_OVER }, {}, `blur(${(p * 8).toFixed(1)}px)`),
        in: layer({ zIndex: Z_UNDER }, {}, `blur(${(q * 8).toFixed(1)}px)`),
        overlay: NO_OVERLAY
      };
    case "filmBurn":
    case "lightLeak":
      return {
        ...dissolve(),
        overlay: { background: `radial-gradient(circle at ${50 + Math.sin(frame * 0.2) * 30}% ${50 + Math.cos(frame * 0.2) * 20}%, rgba(255,160,30,0.7) 0%, rgba(0,0,0,0.0) 70%)`, opacity: bell(p) * 0.85, mixBlendMode: "screen" }
      };
    case "lensFlare":
      return {
        ...dissolve(),
        overlay: { background: "radial-gradient(circle at 80% 20%, rgba(255,255,255,0.9) 0%, rgba(100,150,255,0.4) 20%, transparent 50%)", opacity: bell(p) * 0.7, mixBlendMode: "screen" }
      };
    case "staticNoise":
      return hardSwapBehind({
        background: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E")`,
        opacity: Math.min(1, tri(p) * 1.3)
      });
    case "oldFilm":
      return {
        out: layer({ opacity: q, zIndex: Z_OVER }, {}, `sepia(${(p * 0.6).toFixed(3)}) contrast(${(1 + p * 0.1).toFixed(3)})`),
        in: layer({ zIndex: Z_UNDER }, {}, `sepia(${(q * 0.6).toFixed(3)})`),
        overlay: { background: "radial-gradient(ellipse, transparent 60%, rgba(0,0,0,0.7) 100%)", opacity: bell(p) * 0.6 }
      };
    case "prism":
      return {
        out: layer({ opacity: q, zIndex: Z_OVER }, {}, `hue-rotate(${(p * 180).toFixed(1)}deg)`),
        in: layer({ zIndex: Z_UNDER }, {}, `hue-rotate(${(-q * 180).toFixed(1)}deg)`),
        overlay: { background: "linear-gradient(135deg, rgba(255,0,0,0.25), rgba(0,255,0,0.25), rgba(0,0,255,0.25))", opacity: bell(p) * 0.6, mixBlendMode: "screen" }
      };
    case "vhsStatic":
      return {
        out: layer({ opacity: q, zIndex: Z_OVER }, {}, `saturate(${(1 - p * 0.8).toFixed(3)}) contrast(${(1 + p * 0.3).toFixed(3)})`),
        in: layer({ zIndex: Z_UNDER }, {}, `saturate(${(1 - q * 0.8).toFixed(3)})`),
        overlay: { background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.25) 0px, rgba(0,0,0,0.25) 2px, transparent 2px, transparent 5px)", opacity: bell(p) * 0.9, mixBlendMode: "multiply" }
      };
    case "chromaShift":
      return {
        out: layer({ opacity: q, zIndex: Z_OVER }, {}, `hue-rotate(${(jitter(0.5, 120) * p).toFixed(1)}deg) saturate(${(1 + p * 1.5).toFixed(3)})`),
        in: layer({ zIndex: Z_UNDER }, {}, `hue-rotate(${(jitter(0.7, 120) * q).toFixed(1)}deg) saturate(${(1 + q * 1.5).toFixed(3)})`),
        overlay: NO_OVERLAY
      };
    case "exposure":
      return {
        out: layer({ opacity: p < 0.5 ? 1 : 0, zIndex: Z_OVER }, {}, `brightness(${(1 + tri(p) * 3).toFixed(3)})`),
        in: layer({ opacity: p >= 0.5 ? 1 : 0, zIndex: Z_UNDER }, {}, `brightness(${(1 + tri(p) * 3).toFixed(3)})`),
        overlay: { background: "#fff", opacity: Math.pow(tri(p), 2) * 0.95 }
      };

    // ── Flashes ─────────────────────────────────────────────────────────────
    case "whiteFlash":
    case "filmFlash":
      return hardSwapBehind({ background: "#fff", opacity: Math.min(1, Math.sqrt(bell(p)) * 1.05) });
    case "blackFlash":
      return hardSwapBehind({ background: "#000", opacity: Math.min(1, Math.sqrt(bell(p)) * 1.05) });

    case "cut":
    default:
      return { out: FULL_OVER, in: HIDDEN, overlay: NO_OVERLAY };
  }
}

/**
 * Convenience for a one-sided (edge) transition: only the given role is on
 * screen, the other side is the black stage.  Same numbers as above; this just
 * picks the layer.
 */
export function getEdgeLayerStyle(type: ClipTransitionType, progress: number, role: LayerRole, frame: number): TransitionLayerStyles {
  const s = getTransitionLayerStyles(type, progress, frame);
  // Reveal-type transitions rely on B being clipped ON TOP of a full A. With no
  // A, the reveal must instead clip B itself, which is already what `in` does.
  // Remove-type transitions clip A over a full B — with no B this shows the
  // stage, which is correct.  Dissolve/hard swaps: B underneath is simply absent.
  const isPassive = (l: LayerStyle) =>
    l.wrapper.opacity === undefined && l.video.clipPath === undefined && !l.wrapper.transform;
  if (role === "out") {
    // Edge fade-out: reveal-type transitions leave A untouched (B would have
    // grown over it) — with no B, A itself must fade down to the stage.
    const outStyle = isPassive(s.out)
      ? layer({ ...s.out.wrapper, opacity: 1 - clamp01(progress) }, s.out.video, s.out.filter)
      : s.out;
    return { out: outStyle, in: HIDDEN, overlay: s.overlay };
  }
  // Edge fade-in: remove-type transitions / dissolves leave B untouched (A
  // would have been removed over it) — with no A, B itself must fade up.
  const inStyle = isPassive(s.in)
    ? layer({ ...s.in.wrapper, opacity: clamp01(progress) }, s.in.video, s.in.filter)
    : s.in;
  return { out: HIDDEN, in: inStyle, overlay: s.overlay };
}
