import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const portalPublic = path.resolve(__dirname, "../../portal/public");
const portalSrc = path.resolve(__dirname, "../../portal/src");
const portalStorage = path.resolve(portalSrc, "storage.ts");

const sharedAlias = {
  "@portal": portalSrc,
  [path.resolve(portalSrc, "apiClient.ts")]: path.resolve(__dirname, "src/desktopApiClient.ts"),
  [portalStorage]: path.resolve(__dirname, "src/desktopStorage.ts"),
};

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          resolve: { alias: sharedAlias },
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron", "sql.js"],
            },
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron"],
              output: {
                format: "cjs",
                entryFileNames: "preload.cjs",
              },
            },
          },
        },
      },
    }),
  ],
  resolve: {
    alias: sharedAlias,
  },
  publicDir: portalPublic,
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
