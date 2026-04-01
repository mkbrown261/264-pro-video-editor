// ─────────────────────────────────────────────────────────────────────────────
// 264 Pro – Toast notification system
// Lightweight singleton event bus + React hook
// ─────────────────────────────────────────────────────────────────────────────

export type ToastType = "info" | "success" | "warning" | "error";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number; // ms, 0 = persistent until dismissed
  timestamp: number;
}

type ToastListener = (toasts: Toast[]) => void;

// ── Singleton store ──────────────────────────────────────────────────────────

let _toasts: Toast[] = [];
const _listeners = new Set<ToastListener>();
const _timers = new Map<string, ReturnType<typeof setTimeout>>();

function notify() {
  _listeners.forEach((l) => l([..._toasts]));
}

function addToast(message: string, type: ToastType = "info", duration = 3500): string {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const toast: Toast = { id, message, type, duration, timestamp: Date.now() };
  _toasts = [..._toasts, toast];
  notify();

  if (duration > 0) {
    const timer = setTimeout(() => removeToast(id), duration);
    _timers.set(id, timer);
  }

  return id;
}

function removeToast(id: string) {
  _toasts = _toasts.filter((t) => t.id !== id);
  const timer = _timers.get(id);
  if (timer) { clearTimeout(timer); _timers.delete(id); }
  notify();
}

function subscribe(listener: ToastListener): () => void {
  _listeners.add(listener);
  listener([..._toasts]);
  return () => _listeners.delete(listener);
}

// ── Public API ───────────────────────────────────────────────────────────────

export const toast = {
  info:    (msg: string, dur?: number) => addToast(msg, "info", dur),
  success: (msg: string, dur?: number) => addToast(msg, "success", dur),
  warning: (msg: string, dur?: number) => addToast(msg, "warning", dur),
  error:   (msg: string, dur?: number) => addToast(msg, "error", dur),
  dismiss: removeToast,
  subscribe,
};
