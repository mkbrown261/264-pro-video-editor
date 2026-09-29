/**
 * URL for a file shipped in the renderer's public/ folder (dist/ when built).
 *
 * The packaged app loads from file://, where fetch() (and so WASM streaming,
 * LUT and model loading) is blocked; those go through the media:// protocol,
 * which serves local files with fetch support. In dev (http://) it's a plain
 * relative URL.
 */
export function appAssetUrl(relativePath: string): string {
  const rel = relativePath.replace(/^\.?\//, "");
  if (typeof location !== "undefined" && location.protocol === "file:") {
    const dir = decodeURIComponent(location.pathname).replace(/\/[^/]*$/, "");
    // Windows file URLs look like /C:/…; drop the leading slash.
    const abs = /^\/[A-Za-z]:\//.test(dir) ? dir.slice(1) : dir;
    return `media://asset?path=${encodeURIComponent(`${abs}/${rel}`)}`;
  }
  return `./${rel}`;
}
