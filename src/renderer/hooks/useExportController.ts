/**
 * Export and render-queue controller (extracted from App.tsx).
 *
 * Owns the export busy/progress state and the render queue, picks the render
 * engine (FFmpeg graph vs. the viewer's GPU engine) and drives the queue.
 */
import { useEffect, useRef, useState } from "react";
import type { EditorProject } from "../../shared/models";
import type { TimelineSegment } from "../../shared/timeline";
import type { RenderJob } from "../components/RenderQueuePanel";
import { exportNeedsGpu, runGpuExport } from "../lib/gpuExport";
import { toast } from "../lib/toast";

export interface ExportContext {
  project: EditorProject;
  segments: TimelineSegment[];
  fsLinked: boolean;
  setExportMessage: (msg: string | null) => void;
  setBridgeReady: (ready: boolean) => void;
}

export function useExportController(getContext: () => ExportContext) {
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [lastExportedPath, setLastExportedPath] = useState<string | null>(null);
  const [renderQueueOpen, setRenderQueueOpen] = useState(false);
  const [renderJobs, setRenderJobs] = useState<RenderJob[]>([]);
  const renderQueueProcessingRef = useRef(false);

  /** Render with the FFmpeg graph, or with the viewer engine (GPU) when needed/asked. */
  async function renderExport(request: import("../../shared/models").ExportRequest, engine: "auto" | "ffmpeg" | "gpu" = "auto", onProgress?: (pct: number) => void) {
    const useGpu = engine === "gpu" || (engine === "auto" && exportNeedsGpu(request).needsGpu);
    if (useGpu && window.editorApi?.gpuExportStart) {
      toast.info("Rendering with the GPU engine (matches the viewer exactly)");
      return runGpuExport({ request, onProgress });
    }
    return window.editorApi.exportSequence(request);
  }

  async function handleExport(opts?: { codec?: import("../../shared/models").ExportCodec; outputWidth?: number; outputHeight?: number; background?: boolean; loudnormTarget?: -14 | -23; burnIn?: { timecode?: boolean; watermarkText?: string }; burnSubtitles?: boolean; renderEngine?: "auto" | "ffmpeg" | "gpu" }) {
    const { project, segments, fsLinked, setExportMessage, setBridgeReady } = getContext();
    if (!window.editorApi) { setBridgeReady(false); setExportMessage("Export unavailable."); return; }
    setExportMessage(null);
    if (!segments.length) { setExportMessage("Add clips before exporting."); return; }
    // Guard: don't allow concurrent exports
    if (exportBusy) return;
    const codec = opts?.codec;
    const ext = (codec === "libvpx-vp9") ? "webm" : (codec === "prores_ks") ? "mov" : "mp4";
    const suggestedName = `${project.sequence.name}.${ext}`;
    // Safety timeout — reset exportBusy after 10 minutes max regardless of export state
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      const outputPath = await window.editorApi.chooseExportFile(suggestedName);
      if (!outputPath) return;

      // ── Background export mode ───────────────────────────────────────
      // (The GPU engine renders in this window, so it always runs in the foreground.)
      const wantsGpu = opts?.renderEngine === "gpu" ||
        ((opts?.renderEngine ?? "auto") === "auto" && exportNeedsGpu({ project, codec }).needsGpu);
      if (opts?.background && !wantsGpu) {
        const jobId = `bgexport_${Date.now()}`;
        window.editorApi.onBgExportProgress?.((jid, pct) => {
          if (jid === jobId) setExportProgress(pct);
        });
        window.editorApi.onBgExportComplete?.((jid, success, outPath, error) => {
          if (jid !== jobId) return;
          setExportBusy(false);
          setExportProgress(0);
          if (success) setExportMessage(`✔ Background export complete: ${outPath}`);
          else setExportMessage(`✗ Background export failed: ${error}`);
        });
        setExportBusy(true);
        setExportProgress(0);
        const bgResult = await window.editorApi.exportSequenceBg?.({
          jobId, outputPath, project, codec,
          outputWidth: opts.outputWidth, outputHeight: opts.outputHeight,
          loudnormTarget: opts.loudnormTarget, burnIn: opts.burnIn, burnSubtitles: opts.burnSubtitles,
        });
        if (!bgResult?.success) {
          setExportBusy(false);
          setExportMessage(`✗ Could not start background export: ${bgResult?.error}`);
        } else {
          setExportMessage(`⏳ Exporting in background (${bgResult.mode}) — editor stays live`);
        }
        return;
      }
      // ── Blocking export (original behaviour) ───────────────────────────
      setExportBusy(true);
      setExportProgress(0);
      // Stall watchdog: long renders are fine as long as progress keeps moving.
      const armWatchdog = () => {
        if (safetyTimer) clearTimeout(safetyTimer);
        safetyTimer = setTimeout(() => {
          setExportBusy(false);
          setExportProgress(0);
          setExportMessage("✗ Export stalled — no progress for 10 minutes.");
        }, 10 * 60 * 1000);
      };
      armWatchdog();
      // Subscribe to progress events
      const unsubProgress = window.editorApi.onExportProgress?.((pct) => {
        armWatchdog();
        setExportProgress(pct);
      });
      try {
        const result = await renderExport({
          outputPath,
          project,
          codec,
          outputWidth: opts?.outputWidth,
          outputHeight: opts?.outputHeight,
          loudnormTarget: opts?.loudnormTarget,
          burnIn: opts?.burnIn,
          burnSubtitles: opts?.burnSubtitles,
        }, opts?.renderEngine, (pct) => { setExportProgress(pct); });
        setExportProgress(100);
        setExportMessage(`✓ Rendered to ${result.outputPath}`);
        for (const w of result.warnings ?? []) toast.warning(w);
        setLastExportedPath(result.outputPath);
        // Notify FlowState of export activity
        if (window.flowstateAPI && fsLinked) {
          void window.flowstateAPI.apiCall('/api/264pro/activity', 'POST', {
            event: 'export_completed',
            projectName: project.name ?? 'Untitled',
            format: ext,
            outputPath: result.outputPath,
          });
        }
      } finally {
        unsubProgress?.();
      }
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Render failed.");
    } finally {
      if (safetyTimer) clearTimeout(safetyTimer);
      setExportBusy(false);
    }
  }

  // ── Render Queue ───────────────────────────────────────────────────────────
  function handleAddToQueue(opts: { codec: import("../../shared/models").ExportCodec; outputWidth: number; outputHeight: number; label: string; loudnormTarget?: -14 | -23; burnIn?: { timecode?: boolean; watermarkText?: string; watermarkOpacity?: number }; burnSubtitles?: boolean; renderEngine?: "auto" | "ffmpeg" | "gpu" }) {
    const job: RenderJob = {
      id: `rj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label: opts.label,
      codec: opts.codec,
      outputWidth: opts.outputWidth,
      outputHeight: opts.outputHeight,
      status: "queued",
      progress: 0,
      createdAt: Date.now(),
      loudnormTarget: opts.loudnormTarget,
      burnIn: opts.burnIn,
      burnSubtitles: opts.burnSubtitles,
      renderEngine: opts.renderEngine,
    };
    setRenderJobs((prev) => [...prev, job]);
    setRenderQueueOpen(true);
  }

  // Process render queue sequentially — called whenever jobs change
  useEffect(() => {
    async function processQueue() {
      const { project } = getContext();
      if (renderQueueProcessingRef.current) return;
      if (!window.editorApi) return;
      const pendingJob = renderJobs.find((j) => j.status === "queued");
      if (!pendingJob) return;

      renderQueueProcessingRef.current = true;

      // Prompt for output path
      const ext = pendingJob.codec === "libvpx-vp9" ? "webm" : pendingJob.codec === "prores_ks" ? "mov" : "mp4";
      let outputPath: string | null = null;
      try {
        outputPath = await window.editorApi.chooseExportFile(`${project.sequence.name}.${ext}`);
      } catch {
        outputPath = null;
      }

      if (!outputPath) {
        // User cancelled — remove the job
        setRenderJobs((prev) => prev.filter((j) => j.id !== pendingJob.id));
        renderQueueProcessingRef.current = false;
        return;
      }

      // Mark as rendering
      setRenderJobs((prev) => prev.map((j) => j.id === pendingJob.id ? { ...j, status: "rendering" as const, progress: 0 } : j));

      // Subscribe to progress
      const unsubProgress = window.editorApi.onExportProgress?.((pct) => {
        setRenderJobs((prev) => prev.map((j) => j.id === pendingJob.id ? { ...j, progress: pct } : j));
      });

      try {
        const result = await renderExport({
          outputPath,
          project,
          codec: pendingJob.codec,
          outputWidth: pendingJob.outputWidth,
          outputHeight: pendingJob.outputHeight,
          loudnormTarget: pendingJob.loudnormTarget,
          burnIn: pendingJob.burnIn,
          burnSubtitles: pendingJob.burnSubtitles,
        }, pendingJob.renderEngine, (pct) => {
          setRenderJobs((prev) => prev.map((j) => j.id === pendingJob.id ? { ...j, progress: pct } : j));
        });
        for (const w of result.warnings ?? []) toast.warning(w);
        setRenderJobs((prev) => prev.map((j) => j.id === pendingJob.id ? { ...j, status: "done" as const, progress: 100, outputPath: result.outputPath } : j));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Render failed.";
        setRenderJobs((prev) => prev.map((j) => j.id === pendingJob.id ? { ...j, status: "error" as const, errorMessage: msg } : j));
      } finally {
        unsubProgress?.();
        renderQueueProcessingRef.current = false;
      }
    }

    void processQueue();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderJobs]);


  return {
    exportBusy, exportProgress, setExportProgress, lastExportedPath, setLastExportedPath,
    renderJobs, setRenderJobs, renderQueueOpen, setRenderQueueOpen,
    handleExport, handleAddToQueue, renderExport,
  };
}
