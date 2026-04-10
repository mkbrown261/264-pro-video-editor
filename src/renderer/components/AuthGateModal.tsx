import React, { useCallback, useEffect, useRef, useState } from "react";

// ── Window type augmentation for Electron APIs ────────────────────────────────
declare global {
  interface Window {
    electronAPI?: {
      openExternal?: (url: string) => void;
      startAuthFlow?: (state: string) => void;
      getAppVersion?: () => Promise<string>;
    };
  }
}

// ── Constants ──────────────────────────────────────────────────────────────────
const FS_BASE = "https://flowst8.cc";
const CLAWFLOW_PRICE = "$40/mo";
const CLAWFLOW_INTRO = "First month $20";
const PRO_PRICE = "$12/mo";

// ── Types ──────────────────────────────────────────────────────────────────────
export type RequiredAccess =
  | "any_account"   // just needs sign-in (free is fine)
  | "pro"           // needs Pro, Team, or Enterprise
  | "clawflow";     // needs ClawFlow (separate add-on)

export interface AuthGateConfig {
  toolName: string;
  toolIcon?: string;
  requiredAccess: RequiredAccess;
  description?: string;      // one-line description of what the tool does
}

interface AuthState {
  signedIn: boolean;
  tier: string;              // "free" | "pro" | "team" | "enterprise" | ""
  hasClawflow: boolean;
  email: string;
}

// ── Auth state helpers ─────────────────────────────────────────────────────────
async function getAuthState(): Promise<AuthState> {
  try {
    const user = await window.flowstateAPI?.getUser?.();
    if (!user) return { signedIn: false, tier: "", hasClawflow: false, email: "" };
    const tier = (user.tier ?? "free").toLowerCase();
    return {
      signedIn: true,
      tier,
      hasClawflow: tier === "clawflow",
      email: user.email ?? "",
    };
  } catch {
    return { signedIn: false, tier: "", hasClawflow: false, email: "" };
  }
}

function hasAccess(auth: AuthState, required: RequiredAccess): boolean {
  if (!auth.signedIn) return false;
  if (required === "any_account") return true;
  if (required === "clawflow") return auth.hasClawflow;
  if (required === "pro") {
    return ["pro", "personal_pro", "team", "team_starter", "team_growth", "enterprise"].includes(auth.tier);
  }
  return false;
}

// ── useAuthGate hook ───────────────────────────────────────────────────────────
// Call `checkAndRun(config, callback)` anywhere in a component.
// If the user has access → runs callback immediately.
// If not → shows modal with correct messaging, runs callback if they sign in.
export function useAuthGate() {
  const [modal, setModal] = useState<{
    config: AuthGateConfig;
    auth: AuthState;
    onGranted: () => void;
  } | null>(null);

  const checkAndRun = useCallback(async (
    config: AuthGateConfig,
    onGranted: () => void,
  ) => {
    const auth = await getAuthState();
    if (hasAccess(auth, config.requiredAccess)) {
      onGranted();
    } else {
      setModal({ config, auth, onGranted });
    }
  }, []);

  const closeModal = useCallback(() => setModal(null), []);

  return { modal, checkAndRun, closeModal };
}

// ── AuthGateModal component ────────────────────────────────────────────────────
interface AuthGateModalProps {
  config: AuthGateConfig;
  auth: AuthState;
  onClose: () => void;
  onGranted: () => void;
}

export function AuthGateModal({ config, auth, onClose, onGranted }: AuthGateModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [checking, setChecking] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // After sign-in browser tab closes the deep link fires → re-check auth
  useEffect(() => {
    const handler = () => {
      setChecking(true);
      getAuthState().then(newAuth => {
        if (hasAccess(newAuth, config.requiredAccess)) {
          onClose();
          onGranted();
        }
        setChecking(false);
      });
    };
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
  }, [config.requiredAccess, onClose, onGranted]);

  function openSignIn() {
    const state = Math.random().toString(36).slice(2);
    window.flowstateAPI?.apiCall?.(`/api/264pro/auth?state=${state}&redirect=264pro://auth`, "GET");
    // Also open in browser as fallback
    const url = `${FS_BASE}/api/264pro/auth?state=${encodeURIComponent(state)}&redirect=264pro://auth`;
    window.open?.(url, "_blank") ?? window.electronAPI?.openExternal?.(url);
  }

  function openPlans() {
    const url = config.requiredAccess === "clawflow"
      ? `${FS_BASE}/#clawflow`
      : `${FS_BASE}/#pricing`;
    window.open?.(url, "_blank") ?? window.electronAPI?.openExternal?.(url);
  }

  function openClawFlow() {
    window.open?.(`${FS_BASE}/#clawflow`, "_blank") ?? window.electronAPI?.openExternal?.(`${FS_BASE}/#clawflow`);
  }

  // ── Content based on state ─────────────────────────────────────────────────
  const icon = config.toolIcon ?? "🔒";
  const toolName = config.toolName;

  let headline = "";
  let body = "";
  let primaryLabel = "";
  let primaryAction = () => {};
  let secondaryLabel = "";
  let secondaryAction = () => {};
  let badge = "";
  let badgeColor = "";

  if (!auth.signedIn) {
    // Not signed in at all
    headline = "Sign in to use " + toolName;
    body = "AI tools require a free FlowState account. Sign in to get started — your local editing work is always free.";
    primaryLabel = "Sign In";
    primaryAction = openSignIn;
    secondaryLabel = "Create Account";
    secondaryAction = () => {
      const url = `${FS_BASE}/auth`;
      window.open?.(url, "_blank") ?? window.electronAPI?.openExternal?.(url);
    };
    badge = "FREE ACCOUNT";
    badgeColor = "#6b7280";
  } else if (config.requiredAccess === "clawflow") {
    // Signed in but no ClawFlow
    headline = toolName + " is part of ClawFlow";
    body = `ClawFlow is a separate AI subscription that works alongside your FlowState account — it's not a tier upgrade. ClawFlow unlocks ClawBot, AI video tools, and advanced generation across all your apps.`;
    primaryLabel = `Get ClawFlow — ${CLAWFLOW_PRICE}`;
    primaryAction = openClawFlow;
    secondaryLabel = "Learn More";
    secondaryAction = () => {
      window.open?.(`${FS_BASE}/#clawflow`, "_blank");
    };
    badge = CLAWFLOW_INTRO;
    badgeColor = "#a855f7";
  } else if (config.requiredAccess === "pro") {
    // Signed in but on free tier
    headline = toolName + " requires Pro";
    body = `You're on the Free plan. ${toolName} is available on Pro and above — ${PRO_PRICE} gets you the full AI suite, 4K exports, and unlimited projects.`;
    primaryLabel = `Upgrade to Pro — ${PRO_PRICE}`;
    primaryAction = openPlans;
    secondaryLabel = "View All Plans";
    secondaryAction = openPlans;
    badge = "PRO FEATURE";
    badgeColor = "#3b82f6";
  }

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(4px)",
        animation: "ag-fade-in 0.15s ease",
      }}
    >
      <style>{`
        @keyframes ag-fade-in { from { opacity:0; transform:scale(.96) } to { opacity:1; transform:scale(1) } }
        .ag-modal { background:#1a1a2e; border:1px solid #2d2d4e; border-radius:16px; padding:32px; width:420px; max-width:90vw; box-shadow:0 24px 80px rgba(0,0,0,.6); }
        .ag-icon  { font-size:2.4rem; margin-bottom:16px; display:block; }
        .ag-badge { display:inline-block; padding:3px 10px; border-radius:99px; font-size:10px; font-weight:700; letter-spacing:.08em; margin-bottom:12px; }
        .ag-headline { font-size:1.15rem; font-weight:700; color:#f3f4f6; margin-bottom:10px; line-height:1.35; }
        .ag-body { font-size:.875rem; color:#9ca3af; line-height:1.6; margin-bottom:24px; }
        .ag-user  { display:flex; align-items:center; gap:8px; background:#12122a; border-radius:8px; padding:8px 12px; margin-bottom:20px; font-size:.8rem; color:#6b7280; }
        .ag-user strong { color:#d1d5db; }
        .ag-btn-primary { width:100%; padding:12px; border-radius:10px; border:none; background:#a855f7; color:#fff; font-size:.9rem; font-weight:600; cursor:pointer; margin-bottom:10px; transition:background .15s; }
        .ag-btn-primary:hover { background:#9333ea; }
        .ag-btn-secondary { width:100%; padding:10px; border-radius:10px; border:1px solid #2d2d4e; background:transparent; color:#9ca3af; font-size:.85rem; font-weight:500; cursor:pointer; margin-bottom:8px; transition:border-color .15s, color .15s; }
        .ag-btn-secondary:hover { border-color:#4b5563; color:#d1d5db; }
        .ag-btn-later { width:100%; padding:8px; border:none; background:transparent; color:#6b7280; font-size:.8rem; cursor:pointer; }
        .ag-btn-later:hover { color:#9ca3af; }
        .ag-checking { display:flex; align-items:center; gap:8px; font-size:.8rem; color:#6b7280; justify-content:center; margin-top:8px; }
        @keyframes ag-spin { to { transform:rotate(360deg) } }
        .ag-spinner { width:14px; height:14px; border:2px solid #374151; border-top-color:#a855f7; border-radius:50%; animation:ag-spin .7s linear infinite; }
      `}</style>

      <div className="ag-modal">
        <span className="ag-icon">{icon}</span>

        {badge && (
          <div className="ag-badge" style={{ background: badgeColor + "22", color: badgeColor, border: `1px solid ${badgeColor}44` }}>
            {badge}
          </div>
        )}

        <div className="ag-headline">{headline}</div>

        {auth.signedIn && auth.email && (
          <div className="ag-user">
            <span>Signed in as</span>
            <strong>{auth.email}</strong>
            <span style={{ marginLeft: "auto", textTransform: "capitalize", color: auth.tier === "free" ? "#6b7280" : "#a855f7" }}>
              {auth.tier || "free"} plan
            </span>
          </div>
        )}

        <div className="ag-body">{body}</div>

        {config.description && (
          <div style={{ fontSize: ".8rem", color: "#6b7280", background: "#12122a", borderRadius: "8px", padding: "10px 12px", marginBottom: "20px" }}>
            <strong style={{ color: "#9ca3af" }}>About this tool: </strong>{config.description}
          </div>
        )}

        <button className="ag-btn-primary" onClick={primaryAction}>
          {primaryLabel}
        </button>
        <button className="ag-btn-secondary" onClick={secondaryAction}>
          {secondaryLabel}
        </button>
        <button className="ag-btn-later" onClick={onClose}>
          Maybe Later
        </button>

        {checking && (
          <div className="ag-checking">
            <div className="ag-spinner" />
            Checking access…
          </div>
        )}
      </div>
    </div>
  );
}

// ── AuthGateWrapper — drop-in wrapper that renders the modal when needed ───────
// Usage: wrap your component tree with this, pass the modal+closeModal from hook
export function AuthGateWrapper({
  modal, closeModal, children,
}: {
  modal: ReturnType<typeof useAuthGate>["modal"];
  closeModal: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal && (
        <AuthGateModal
          config={modal.config}
          auth={modal.auth}
          onClose={closeModal}
          onGranted={modal.onGranted}
        />
      )}
    </>
  );
}
