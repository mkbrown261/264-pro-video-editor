// ─────────────────────────────────────────────────────────────────────────────
// 264 Pro – Toast Container
// Renders active toasts in the bottom-right corner
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import { toast, type Toast } from "../lib/toast";

const ICONS: Record<string, string> = {
  info:    "ℹ",
  success: "✓",
  warning: "⚠",
  error:   "✕",
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const unsub = toast.subscribe(setToasts);
    return unsub;
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.type}`}
          role="alert"
        >
          <span className="toast-icon">{ICONS[t.type]}</span>
          <span className="toast-message">{t.message}</span>
          <button
            className="toast-close"
            onClick={() => toast.dismiss(t.id)}
            type="button"
            aria-label="Dismiss notification"
          >×</button>
        </div>
      ))}
    </div>
  );
}
