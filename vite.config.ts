import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev mode Electron loads the renderer from the Vite dev server
// (http://localhost:5173) so asset paths must be absolute ("/").
// In production Electron loads dist/index.html via file://, so paths
// must be relative ("./") to avoid broken asset URLs.
const isDev = process.env.NODE_ENV !== "production";

export default defineConfig({
  plugins: [react()],
  base: isDev ? "/" : "./",
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist"
  },
});
