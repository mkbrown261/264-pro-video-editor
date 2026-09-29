// Copies MediaPipe's vision WASM runtime into public/mediapipe so the app can
// run AI background removal fully offline (see src/renderer/lib/backgroundRemoval.ts).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const dest = join(root, "public", "mediapipe");
if (!existsSync(src)) {
  console.warn("[copy-mediapipe] @mediapipe/tasks-vision not installed — background removal disabled");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"]) copyFileSync(join(src, f), join(dest, f));
console.log("[copy-mediapipe] copied WASM runtime to public/mediapipe");
