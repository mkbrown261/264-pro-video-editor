import { Component, StrictMode } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { useEditorStore } from "./store/editorStore";
import { exportNeedsGpu, runGpuExport } from "./lib/gpuExport";
import { trackSubject } from "./lib/subjectTracker";
import "./styles.css";

// Automation hook for end-to-end tests (renderer code can reach the store anyway).
Object.assign(window as unknown as Record<string, unknown>, {
  __264proStore: useEditorStore,
  __264proExport: { runGpuExport, exportNeedsGpu },
  __264proTrackSubject: trackSubject,
});

// ── Error Boundary ─────────────────────────────────────────────────────────────
interface EBState { error: Error | null; info: ErrorInfo | null }
class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null, info: null };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info });
    console.error("[ErrorBoundary]", error, info);
  }
  override render() {
    const { error, info } = this.state;
    if (error) {
      return (
        <div style={{
          background: "#0a1520", color: "#e8eaf0", fontFamily: "monospace",
          padding: "32px", height: "100vh", overflow: "auto", boxSizing: "border-box"
        }}>
          <h1 style={{ color: "#ff5f5f", fontSize: 18, marginBottom: 12 }}>
            ⚠ 264 Pro — Render Error
          </h1>
          <pre style={{
            background: "#111c26", padding: "16px", borderRadius: 4,
            color: "#ffb347", whiteSpace: "pre-wrap", wordBreak: "break-all",
            fontSize: 13, marginBottom: 16
          }}>
            {error.message}
          </pre>
          <details>
            <summary style={{ cursor: "pointer", color: "#7ec8e3", marginBottom: 8 }}>
              Stack trace
            </summary>
            <pre style={{
              background: "#111c26", padding: "12px", borderRadius: 4,
              color: "#aaa", whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 12
            }}>
              {error.stack ?? "(no stack)"}
              {"\n\nComponent stack:"}
              {info?.componentStack ?? ""}
            </pre>
          </details>
          <button
            style={{
              marginTop: 20, padding: "8px 20px", background: "#1e3a5f",
              color: "#fff", border: "1px solid #3a6ea8", borderRadius: 4,
              cursor: "pointer", fontSize: 13
            }}
            onClick={() => this.setState({ error: null, info: null })}
          >
            Try to recover
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Mount ──────────────────────────────────────────────────────────────────────
const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
