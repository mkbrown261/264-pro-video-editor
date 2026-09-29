/** Asset classification and smart-bin rules for the media pool. */
import type { MediaAsset, SmartBinRule } from "./models.js";

export type AssetKind = "video" | "audio" | "image";

const STILL = /\.(png|jpe?g|webp|bmp|tiff?|gif|heic|avif)$/i;

export function assetKind(a: MediaAsset): AssetKind {
  if (!a.width && a.hasAudio) return "audio";
  if (STILL.test(a.sourcePath)) return "image";
  return "video";
}

/** Does an asset satisfy a smart bin's rule? */
export function matchesSmartBin(a: MediaAsset, rule: SmartBinRule, usedAssetIds?: Set<string>): boolean {
  if (rule.kind && rule.kind !== "any" && assetKind(a) !== rule.kind) return false;
  if (rule.nameContains && !a.name.toLowerCase().includes(rule.nameContains.toLowerCase())) return false;
  if (rule.minSeconds != null && a.durationSeconds < rule.minSeconds) return false;
  if (rule.maxSeconds != null && a.durationSeconds > rule.maxSeconds) return false;
  if (rule.minHeight != null && (a.height || 0) < rule.minHeight) return false;
  if (rule.codec && !(a.videoCodec ?? a.audioCodec ?? "").toLowerCase().includes(rule.codec.toLowerCase())) return false;
  if (rule.usage && rule.usage !== "any" && usedAssetIds) {
    const used = usedAssetIds.has(a.id);
    if (rule.usage === "used" ? !used : used) return false;
  }
  return true;
}
