/**
 * Bring a file a processing tool wrote back into the edit: probe it, then
 * either swap it in for a clip's media (same timing, undoable) or just add it
 * to the Media Pool (when the result shouldn't replace the clip).
 */
import type { MediaAsset } from "../../shared/models";
import { useEditorStore } from "../store/editorStore";

type Probe = (paths: string[]) => Promise<MediaAsset[]>;

export async function adoptProcessedFile(outputPath: string | undefined, label: string, replaceClipId: string | null): Promise<string> {
  const probe = (window as unknown as { electronAPI?: { probePaths?: Probe } }).electronAPI?.probePaths;
  if (!outputPath || !probe) return `Saved: ${outputPath ?? ""}`;
  try {
    const [asset] = await probe([outputPath]);
    if (!asset) return `Saved: ${outputPath}`;
    const st = useEditorStore.getState();
    const clip = replaceClipId ? st.project.sequence.clips.find((c) => c.id === replaceClipId) : null;
    const original = clip ? st.project.assets.find((a) => a.id === clip.assetId) : null;
    const named = { ...asset, name: `${original?.name ?? asset.name} (${label})` };
    if (clip) {
      st.replaceClipMedia(clip.id, named);
      return `✓ ${label} applied to the clip — undo to revert`;
    }
    st.addAssetToPool(named);
    return `✓ ${label} added to the Media Pool`;
  } catch {
    return `Saved: ${outputPath}`;
  }
}
