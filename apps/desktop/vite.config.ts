import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Puerto fijo que Tauri espera en desarrollo (ver src-tauri/tauri.conf.json)
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022", outDir: "dist" },
});
