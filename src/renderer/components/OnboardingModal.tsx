/**
 * OnboardingModal — 8-slide first-time user tour
 * Shows on first launch (localStorage flag 264pro_onboarded).
 * Accessible from Help menu → "Feature Tour".
 */

import React, { useState, useEffect, useCallback } from "react";

interface OnboardingModalProps {
  onFinish: () => void;
  onOpenClawFlow: () => void;
  onOpenHiggsfield: () => void;
  onOpenColor: () => void;
  onOpenAudio: () => void;
  onOpenExport: () => void;
}

interface Slide {
  id: number;
  icon: string;
  headline: string;
  subheadline: string;
  body: string[];
  cta: string;
  ctaHandler?: () => void;
  bgAccent: string;
  badge?: string;
  isRevenue?: boolean;
}

function OnboardingModal({
  onFinish,
  onOpenClawFlow,
  onOpenHiggsfield,
  onOpenColor,
  onOpenAudio,
  onOpenExport,
}: OnboardingModalProps) {
  const [visible, setVisible] = useState(() => {
    try { return !localStorage.getItem("264pro_onboarded"); } catch { return true; }
  });
  const [slide, setSlide] = useState(0);

  const finish = useCallback(() => {
    try { localStorage.setItem("264pro_onboarded", "1"); } catch { /* ignore */ }
    setVisible(false);
    onFinish();
  }, [onFinish]);

  // Re-show if triggered externally by Help menu
  useEffect(() => {
    const handler = () => { setSlide(0); setVisible(true); };
    window.addEventListener("264pro:show-onboarding", handler);
    return () => window.removeEventListener("264pro:show-onboarding", handler);
  }, []);

  // Escape key closes modal (marks as onboarded)
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, finish]);

  if (!visible) return null;

  const slides: Slide[] = [
    {
      id: 0,
      icon: "264",
      headline: "264 PRO VIDEO EDITOR",
      subheadline: "The video editor that thinks like a creator.",
      body: ["Professional editing power. AI intelligence. No learning curve."],
      cta: "Start Tour →",
      bgAccent: "#7c3aed",
    },
    {
      id: 1,
      icon: "⚡",
      headline: "LIGHTNING TIMELINE",
      subheadline: "The timeline DaVinci Resolve wishes it had.",
      body: [
        "J · K · L playback. S to split. Ripple delete.",
        "Infinite tracks. Fixed playhead mode.",
        "Beat sync that cuts your video to music automatically.",
      ],
      cta: "Try Timeline",
      ctaHandler: onFinish,
      bgAccent: "#f59e0b",
    },
    {
      id: 2,
      icon: "🎨",
      headline: "PROFESSIONAL COLOR — IN SECONDS",
      subheadline: "Grade like a colorist. Work like a creator.",
      body: [
        "One-click Auto Color Match normalizes your entire timeline.",
        "ColorSlice 6-vector grading for surgical hue control.",
        "12 one-click looks · LUT browser · Still store gallery.",
      ],
      cta: "Open Color Page",
      ctaHandler: () => { finish(); onOpenColor(); },
      bgAccent: "#10b981",
    },
    {
      id: 3,
      icon: "🎵",
      headline: "FAIRLIGHT AUDIO ENGINE",
      subheadline: "Mix that hits. Every time.",
      body: [
        "5-band parametric EQ. Compressor. Channel strips.",
        "One-click -14 LUFS normalization for streaming.",
        "Music Remixer: isolate vocals, drums, bass instantly.",
      ],
      cta: "Open Audio Mixer",
      ctaHandler: () => { finish(); onOpenAudio(); },
      bgAccent: "#3b82f6",
    },
    {
      id: 4,
      icon: "⚡",
      headline: "CLAWFLOW — THE AI THAT EDITS FOR YOU",
      subheadline: "Stop doing the mechanical work. Start creating.",
      body: [
        "Beat Detection: drops cut points at every beat automatically.",
        "Auto Color Match: grades your whole timeline in one click.",
        "Text-Based Editing: select words, cut video.",
        "AI Storyboard: describe your video, get a rough cut.",
        "Smart Gap Filler: detects and heals timeline gaps instantly.",
      ],
      cta: "Explore ClawFlow ⚡",
      ctaHandler: () => { finish(); onOpenClawFlow(); },
      bgAccent: "#7c3aed",
      badge: "⚡ CLAWFLOW AI",
      isRevenue: true,
    },
    {
      id: 5,
      icon: "🎬",
      headline: "HIGGSFIELD AI — GENERATE CINEMATIC VIDEO",
      subheadline: "Generate video you could never shoot.",
      body: [
        '▶ "A glowing neon city at night, rain falling, empty streets"',
        '▶ "A hand placing a trophy on a podium, slow motion, golden light"',
        '▶ "Abstract purple particles forming a logo, looping"',
        "Turn text prompts into 4K cinematic footage. No credits needed.",
      ],
      cta: "Generate Your First Clip 🎬",
      ctaHandler: () => { finish(); onOpenHiggsfield(); },
      bgAccent: "#ec4899",
      badge: "🎬 HIGGSFIELD AI",
      isRevenue: true,
    },
    {
      id: 6,
      icon: "📱",
      headline: "EXPORT FOR EVERY PLATFORM — ONE CLICK",
      subheadline: "Finish once. Publish everywhere.",
      body: [
        "One-Click Delivery Package: YouTube · Instagram Reel · TikTok · Twitter · ProRes · Audio.",
        "Social Auto-Resize: 16:9 → 9:16 → 1:1 → 4:5 automatically.",
        "Smart center crop for every social format.",
      ],
      cta: "Open Export",
      ctaHandler: () => { finish(); onOpenExport(); },
      bgAccent: "#2fc77a",
    },
    {
      id: 7,
      icon: "🚀",
      headline: "YOU'RE READY TO CREATE",
      subheadline: "264 Pro is built for creators who move fast.",
      body: [
        "Space — Play/Pause        S — Split clip",
        "J/K/L — Transport         M — Add marker",
        "I/O — In/Out points       Cmd+Z — Undo",
        "Cmd+K — Command palette   Cmd+Shift+A — Clawbot",
        "",
        "Drop your footage. Let's build something.",
      ],
      cta: "🎬 Start Editing",
      ctaHandler: finish,
      bgAccent: "#7c3aed",
    },
  ];

  const current = slides[slide];
  const isLast = slide === slides.length - 1;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 99999,
      background: "rgba(0,0,0,0.85)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backdropFilter: "blur(8px)",
    }}>
      <div style={{
        width: 580,
        maxWidth: "95vw",
        background: "#0d1117",
        borderRadius: 18,
        border: `1px solid ${current.isRevenue ? "rgba(124,58,237,0.5)" : "rgba(255,255,255,0.1)"}`,
        boxShadow: current.isRevenue
          ? `0 0 60px rgba(124,58,237,0.3), 0 20px 60px rgba(0,0,0,0.8)`
          : "0 20px 60px rgba(0,0,0,0.8)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}>
        {/* Accent bar */}
        <div style={{
          height: 4,
          background: `linear-gradient(90deg, ${current.bgAccent}, ${current.isRevenue ? "#a855f7" : current.bgAccent}88)`,
        }} />

        {/* Content */}
        <div style={{ padding: "32px 40px", flex: 1 }}>
          {/* Badge */}
          {current.badge && (
            <div style={{
              display: "inline-block",
              padding: "3px 10px",
              borderRadius: 20,
              background: "rgba(124,58,237,0.2)",
              border: "1px solid rgba(124,58,237,0.4)",
              color: "#c4b5fd",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.1em",
              marginBottom: 12,
            }}>
              {current.badge}
            </div>
          )}

          {/* Icon / headline */}
          <div style={{ fontSize: current.id === 0 ? 28 : 40, marginBottom: 8, lineHeight: 1 }}>
            {current.id === 0 ? (
              <span style={{
                fontWeight: 900,
                background: "linear-gradient(135deg,#a855f7,#7c3aed)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                fontSize: 36,
              }}>264</span>
            ) : current.icon}
          </div>

          <h2 style={{
            margin: "0 0 8px",
            fontSize: 22,
            fontWeight: 900,
            color: "#fff",
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
          }}>
            {current.headline}
          </h2>

          <p style={{
            margin: "0 0 20px",
            fontSize: 15,
            fontWeight: 600,
            color: current.bgAccent,
            lineHeight: 1.4,
          }}>
            {current.subheadline}
          </p>

          <ul style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}>
            {current.body.map((line, i) => (
              <li key={i} style={{
                fontSize: 13,
                color: line === "" ? "transparent" : "rgba(255,255,255,0.7)",
                lineHeight: 1.5,
                fontFamily: line.startsWith("▶") || line.includes("—") ? "monospace" : "inherit",
              }}>
                {line}
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div style={{
          padding: "16px 40px 24px",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}>
          {/* Dots */}
          <div style={{ display: "flex", gap: 5, flex: 1 }}>
            {slides.map((_, i) => (
              <div
                key={i}
                onClick={() => setSlide(i)}
                style={{
                  width: i === slide ? 20 : 6,
                  height: 6,
                  borderRadius: 3,
                  background: i === slide ? current.bgAccent : "rgba(255,255,255,0.15)",
                  transition: "all 0.2s",
                  cursor: "pointer",
                }}
              />
            ))}
          </div>

          {/* Skip (only on non-last slides) */}
          {!isLast && (
            <button
              type="button"
              onClick={finish}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "rgba(255,255,255,0.4)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Skip Tour
            </button>
          )}

          {/* Previous */}
          {slide > 0 && (
            <button
              type="button"
              onClick={() => setSlide(s => s - 1)}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#94a3b8",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              ← Back
            </button>
          )}

          {/* CTA / Next */}
          <button
            type="button"
            onClick={() => {
              if (current.ctaHandler) {
                current.ctaHandler();
              } else if (!isLast) {
                setSlide(s => s + 1);
              } else {
                finish();
              }
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 9,
              background: current.isRevenue
                ? "linear-gradient(135deg,#7c3aed,#a855f7)"
                : `linear-gradient(135deg,${current.bgAccent},${current.bgAccent}cc)`,
              border: "none",
              color: "#fff",
              fontSize: 13,
              fontWeight: 800,
              cursor: "pointer",
              boxShadow: current.isRevenue ? "0 4px 20px rgba(124,58,237,0.4)" : "none",
            }}
          >
            {current.ctaHandler ? current.cta : isLast ? current.cta : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default OnboardingModal;
