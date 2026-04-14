import React, { useState, useEffect } from "react";
import { toast } from "../lib/toast";

interface FollowFreebie {
  platform: "instagram" | "tiktok" | "youtube";
  handle: string;
  url: string;
  reward: string;
  credits: number;
  icon: string;
}

const FOLLOW_OFFERS: FollowFreebie[] = [
  {
    platform: "instagram",
    handle: "@264pro",
    url: "https://instagram.com/264pro",
    reward: "50 AI Credits",
    credits: 50,
    icon: "📸",
  },
  {
    platform: "tiktok",
    handle: "@264pro",
    url: "https://tiktok.com/@264pro",
    reward: "50 AI Credits",
    credits: 50,
    icon: "🎵",
  },
  {
    platform: "youtube",
    handle: "264 Pro",
    url: "https://youtube.com/@264pro",
    reward: "25 AI Credits + 1 Pro Feature Unlock",
    credits: 25,
    icon: "▶️",
  },
];

interface FollowForFreebieProps {
  onClose: () => void;
  aiCredits: number;
  onAddCredits: (amount: number) => void;
}

export function FollowForFreebie({ onClose, aiCredits, onAddCredits }: FollowForFreebieProps) {
  const [claimed, setClaimed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    FOLLOW_OFFERS.forEach(o => {
      initial[o.platform] = localStorage.getItem(`264pro_followed_${o.platform}`) === "1";
    });
    setClaimed(initial);
  }, []);

  function handleOpen(url: string) {
    if (typeof (window as any).electronAPI?.openExternalUrl === "function") {
      (window as any).electronAPI.openExternalUrl(url);
    } else {
      window.open(url, "_blank");
    }
  }

  function handleClaim(offer: FollowFreebie) {
    if (claimed[offer.platform]) return;
    localStorage.setItem(`264pro_followed_${offer.platform}`, "1");
    setClaimed(prev => ({ ...prev, [offer.platform]: true }));
    onAddCredits(offer.credits);
    toast.success(`🎉 ${offer.credits} AI Credits added! Use them in the AI Tools panel.`);
  }

  const cardStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    padding: "14px 16px",
    marginBottom: 10,
  };

  const btnPrimary: React.CSSProperties = {
    padding: "7px 13px",
    borderRadius: 7,
    border: "none",
    background: "linear-gradient(135deg,#7c3aed,#a855f7)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    marginRight: 8,
  };

  const btnSecondary: React.CSSProperties = {
    padding: "7px 13px",
    borderRadius: 7,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.07)",
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };

  const btnClaimed: React.CSSProperties = {
    ...btnSecondary,
    color: "#4ade80",
    cursor: "default",
    border: "1px solid rgba(74,222,128,0.3)",
    background: "rgba(74,222,128,0.08)",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 480,
        background: "#0f172a",
        border: "1px solid rgba(124,58,237,0.4)",
        borderRadius: 16,
        padding: 28,
        boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
        position: "relative",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>🎁 Get FREE AI Credits</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
              Follow us on social media and get free AI credits
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 20 }}>✕</button>
        </div>

        {/* Credits balance */}
        <div style={{
          background: "rgba(124,58,237,0.15)",
          border: "1px solid rgba(124,58,237,0.3)",
          borderRadius: 8,
          padding: "8px 14px",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <span style={{ fontSize: 14 }}>💎</span>
          <span style={{ fontSize: 13, color: "#c4b5fd", fontWeight: 700 }}>{aiCredits} credits remaining</span>
        </div>

        {/* Offers */}
        {FOLLOW_OFFERS.map(offer => (
          <div key={offer.platform} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>{offer.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
                  {offer.platform.charAt(0).toUpperCase() + offer.platform.slice(1)} {offer.handle}
                </div>
                <div style={{ fontSize: 11, color: "#a855f7", fontWeight: 600 }}>
                  Follow → get {offer.reward}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={btnPrimary} onClick={() => handleOpen(offer.url)}>
                Open {offer.platform.charAt(0).toUpperCase() + offer.platform.slice(1)}
              </button>
              {claimed[offer.platform] ? (
                <button style={btnClaimed} disabled>✓ Claimed</button>
              ) : (
                <button style={btnSecondary} onClick={() => handleClaim(offer)}>
                  I followed! Claim Credits
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Footer notes */}
        <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.6 }}>
            ✓ Credits can be used for: AI Video Gen, Upscale, Slow Motion, Background Remove, and more.<br />
            ✓ One claim per platform. No credit card required.
          </div>
        </div>
      </div>
    </div>
  );
}
