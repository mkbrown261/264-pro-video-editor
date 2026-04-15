import { useState, useCallback, useRef } from 'react';
import type { MediaAsset } from '../../shared/models';

interface ProxyState {
  generating: Set<string>;            // assetIds currently being generated
  proxyPaths: Record<string, string>; // assetId -> proxyPath
  proxyEnabled: boolean;              // global toggle
}

export function useProxyManager(
  assets: MediaAsset[],
  onUpdateAsset: (id: string, updates: Partial<MediaAsset>) => void
) {
  const [state, setState] = useState<ProxyState>({
    generating: new Set(),
    proxyPaths: {},
    proxyEnabled: true,
  });
  const proxyDirRef = useRef<string | null>(null);

  const getProxyDir = useCallback(async (): Promise<string> => {
    if (proxyDirRef.current) return proxyDirRef.current;
    const dir = await window.electronAPI?.getProxyDir?.() ?? '/tmp/264pro-proxies';
    proxyDirRef.current = dir;
    return dir;
  }, []);

  const generateProxy = useCallback(async (asset: MediaAsset) => {
    if (!asset.sourcePath || state.generating.has(asset.id)) return;
    if (asset.proxyReady && asset.proxyPath) return; // already done

    // Only generate for large files (> 100MB) or high res (> 1920px wide)
    const shouldProxy =
      (asset.width ?? 0) > 1920 ||
      (asset.fileSizeBytes ?? 0) > 100 * 1024 * 1024;
    if (!shouldProxy) return;

    setState(s => ({ ...s, generating: new Set([...s.generating, asset.id]) }));
    onUpdateAsset(asset.id, { proxyGenerating: true });

    try {
      const proxyDir = await getProxyDir();
      const result = await window.electronAPI?.generateProxy?.({
        assetId: asset.id,
        sourcePath: asset.sourcePath,
        proxyDir,
      });

      if (result?.success && result.proxyPath) {
        setState(s => ({
          ...s,
          generating: new Set([...s.generating].filter(id => id !== asset.id)),
          proxyPaths: { ...s.proxyPaths, [asset.id]: result.proxyPath! },
        }));
        onUpdateAsset(asset.id, {
          proxyPath: result.proxyPath,
          proxyReady: true,
          proxyGenerating: false,
        });
      } else {
        setState(s => ({
          ...s,
          generating: new Set([...s.generating].filter(id => id !== asset.id)),
        }));
        onUpdateAsset(asset.id, { proxyGenerating: false });
      }
    } catch {
      setState(s => ({
        ...s,
        generating: new Set([...s.generating].filter(id => id !== asset.id)),
      }));
      onUpdateAsset(asset.id, { proxyGenerating: false });
    }
  }, [state.generating, getProxyDir, onUpdateAsset]);

  // Get the effective path for playback — proxy if available and enabled, else original
  const getPlaybackPath = useCallback((asset: MediaAsset): string => {
    if (state.proxyEnabled && asset.proxyReady && asset.proxyPath) {
      return asset.proxyPath;
    }
    return asset.sourcePath ?? '';
  }, [state.proxyEnabled]);

  const toggleProxyEnabled = useCallback(() => {
    setState(s => ({ ...s, proxyEnabled: !s.proxyEnabled }));
  }, []);

  // Suppress unused warning — assets param is provided for callers to drive
  // generateProxy calls; keep the reference stable.
  void assets;

  return {
    proxyEnabled: state.proxyEnabled,
    isGenerating: (assetId: string) => state.generating.has(assetId),
    getPlaybackPath,
    generateProxy,
    toggleProxyEnabled,
  };
}
