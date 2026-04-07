import { cpSync, mkdirSync } from "fs";
mkdirSync("dist-electron/electron", { recursive: true });
cpSync("electron/gate.html", "dist-electron/electron/gate.html");
