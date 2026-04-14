/**
 * SmartSuggestionsBar — UX 4: Smart Suggestions Bar
 * Persistent bottom bar on the color page with one-click fix buttons.
 * Analyzes the timeline and surfaces actionable suggestions.
 */
import React, { useCallback, useEffect, useState } from "react";
import type { TimelineSegment } from "../../shared/timeline";

interface Suggestion {
  id: string;
  icon: string;
  message: string;
  fixLabel: string;
  onFix: () => void;
  severity: "warn" | "info" | "ok";
}

interface Props {
  segments: TimelineSegment[];
  selectedClipId: string | null;
  onNormalizeWhiteBalance: (clipId: string) => void;
  onRecoverHighlights: (clipId: string) => void;
  onCompressAudio: () => void;
  onAutoColorGrade: (clipId: string) => void;
}

export function SmartSuggestionsBar({
  segments,
  selectedClipId,
  onNormalizeWhiteBalance,
  onRecoverHighlights,
  onCompressAudio,
  onAutoColorGrade,
}: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const analyze = useCallback(() => {
    const suggs: Suggestion[] = [];

    const videoSegs = segments.filter(s => s.track.kind === "video");
    const audioSegs = segments.filter(s => s.track.kind === "audio");

    // Check white balance inconsistency across clips
    const temperatures = videoSegs
      .map(s => s.clip.colorGrade?.temperature ?? 0)
      .filter(t => t !== 0);
    if (temperatures.length > 1) {
      const mean = temperatures.reduce((a, b) => a + b, 0) / temperatures.length;
      const maxDev = Math.max(...temperatures.map(t => Math.abs(t - mean)));
      if (maxDev > 15) {
        suggs.push({
          id: "wb_inconsistent",
          icon: "🌡️",
          message: `${videoSegs.length} clips have inconsistent white balance (max ±${Math.round(maxDev)}K)`,
          fixLabel: "Normalize WB",
          severity: "warn",
          onFix: () => {
            if (selectedClipId) onNormalizeWhiteBalance(selectedClipId);
          },
        });
      }
    }

    // Check for blown highlights (high exposure)
    const overexposed = videoSegs.filter(s => (s.clip.colorGrade?.exposure ?? 0) > 1.5);
    if (overexposed.length > 0) {
      const clipId = overexposed[0].clip.id;
      suggs.push({
        id: "blown_highlights",
        icon: "☀️",
        message: `${overexposed.length} clip${overexposed.length > 1 ? "s" : ""} may have blown highlights (exposure > +1.5)`,
        fixLabel: "Recover Highlights",
        severity: "warn",
        onFix: () => onRecoverHighlights(clipId),
      });
    }

    // Check audio peaks
    const loudAudio = audioSegs.filter(s => (s.clip.volume ?? 1) > 1.3);
    if (loudAudio.length > 0) {
      suggs.push({
        id: "audio_peaks",
        icon: "🔊",
        message: `${loudAudio.length} audio clip${loudAudio.length > 1 ? "s" : ""} above +3dB — may cause clipping`,
        fixLabel: "Apply Compression",
        severity: "warn",
        onFix: () => onCompressAudio(),
      });
    }

    // Check for ungraded clips
    const ungraded = videoSegs.filter(s => !s.clip.colorGrade || s.clip.colorGrade.bypass);
    if (ungraded.length > 0 && videoSegs.length > 1) {
      const clipId = ungraded[0].clip.id;
      suggs.push({
        id: "ungraded",
        icon: "🎨",
        message: `${ungraded.length} clip${ungraded.length > 1 ? "s" : ""} have no color grade applied`,
        fixLabel: "Auto Grade",
        severity: "info",
        onFix: () => onAutoColorGrade(clipId),
      });
    }

    // All good
    if (suggs.length === 0) {
      suggs.push({
        id: "ok",
        icon: "✅",
        message: "Timeline looks great! No issues detected.",
        fixLabel: "",
        severity: "ok",
        onFix: () => {},
      });
    }

    setSuggestions(suggs);
  }, [segments, selectedClipId, onNormalizeWhiteBalance, onRecoverHighlights, onCompressAudio, onAutoColorGrade]);

  useEffect(() => {
    analyze();
  }, [analyze]);

  const visible = suggestions.filter(s => !dismissed.has(s.id));
  if (visible.length === 0) return null;

  const severityColor = (s: Suggestion["severity"]) =>
    s === "warn" ? "#f7c948" : s === "ok" ? "#2fc77a" : "#4f8ef7";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "6px 12px",
      background: "rgba(0,0,0,0.5)",
      borderTop: "1px solid rgba(255,255,255,0.06)",
      overflowX: "auto",
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap", flexShrink: 0 }}>
        Smart Fixes
      </span>
      {visible.map(sugg => (
        <div
          key={sugg.id}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "rgba(255,255,255,0.05)", border: `1px solid rgba(${sugg.severity === "warn" ? "247,201,72" : sugg.severity === "ok" ? "47,199,122" : "79,142,247"},0.2)`,
            borderRadius: 7, padding: "4px 8px", flexShrink: 0, whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontSize: 12 }}>{sugg.icon}</span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.6)" }}>{sugg.message}</span>
          {sugg.fixLabel && (
            <button
              onClick={sugg.onFix}
              style={{
                padding: "2px 8px", borderRadius: 4,
                background: `rgba(${sugg.severity === "warn" ? "247,201,72" : "79,142,247"},0.15)`,
                border: `1px solid rgba(${sugg.severity === "warn" ? "247,201,72" : "79,142,247"},0.35)`,
                color: severityColor(sugg.severity),
                fontSize: 10, fontWeight: 700, cursor: "pointer",
              }}
              type="button"
            >
              {sugg.fixLabel}
            </button>
          )}
          <button
            onClick={() => setDismissed(prev => new Set([...prev, sugg.id]))}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.2)", cursor: "pointer", fontSize: 11, padding: 0 }}
            type="button"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={() => { setDismissed(new Set()); analyze(); }}
        style={{ padding: "3px 8px", borderRadius: 5, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)", fontSize: 10, cursor: "pointer", flexShrink: 0 }}
        type="button"
      >
        ↻ Refresh
      </button>
    </div>
  );
}
