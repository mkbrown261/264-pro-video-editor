import { rmSync } from "fs";
for (const dir of ["dist", "dist-electron"]) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}
console.log("Cleaned dist + dist-electron");
