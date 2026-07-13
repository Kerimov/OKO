import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const portalPublic = path.resolve(__dirname, "../../portal/public");
const portalSrc = path.resolve(__dirname, "../../portal/src");
const enginePkg = path.resolve(__dirname, "../../packages/engine/src/index.ts");
const portalStorage = path.resolve(portalSrc, "storage.ts");
const desktopStorage = path.resolve(__dirname, "src/desktopStorage.ts");
const apiStub = path.resolve(__dirname, "src/portalApiStub.ts");

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  plugins: [react()],
  publicDir: portalPublic,
  resolve: {
    alias: [
      { find: "@oko/engine", replacement: enginePkg },
      { find: "@portal/storage", replacement: desktopStorage },
      { find: portalStorage, replacement: desktopStorage },
      { find: /portal[\\/]src[\\/]storage\.ts$/, replacement: desktopStorage },
      { find: path.resolve(portalSrc, "api.ts"), replacement: apiStub },
      { find: "@portal", replacement: portalSrc },
    ],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
