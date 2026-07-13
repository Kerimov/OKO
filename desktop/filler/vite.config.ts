import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const portalPublic = path.resolve(__dirname, "../../portal/public");
const portalSrc = path.resolve(__dirname, "../../portal/src");
const enginePkg = path.resolve(__dirname, "../../packages/engine/src/index.ts");
const portalStorage = path.resolve(portalSrc, "storage.ts");
const portalApi = path.resolve(portalSrc, "api.ts");
const desktopStorage = path.resolve(__dirname, "src/desktopStorage.ts");

/** @portal/storage and portal relative `../storage` must resolve before the @portal directory alias. */
const sharedAlias = [
  { find: "@oko/engine", replacement: enginePkg },
  { find: "@portal/storage", replacement: desktopStorage },
  { find: portalStorage, replacement: desktopStorage },
  { find: /portal[\\/]src[\\/]storage\.ts$/, replacement: desktopStorage },
  { find: "@portal", replacement: portalSrc },
  {
    find: path.resolve(portalSrc, "apiClient.ts"),
    replacement: path.resolve(__dirname, "src/desktopApiClient.ts"),
  },
];

const mainStorageStub = path.resolve(__dirname, "electron/mainStorageStub.ts");

const mainAlias = [
  { find: "@oko/engine", replacement: enginePkg },
  { find: "@portal/storage", replacement: mainStorageStub },
  { find: portalStorage, replacement: mainStorageStub },
  { find: /portal[\\/]src[\\/]storage\.ts$/, replacement: mainStorageStub },
  { find: "@portal", replacement: portalSrc },
  {
    find: path.resolve(portalSrc, "apiClient.ts"),
    replacement: path.resolve(__dirname, "src/desktopApiClient.ts"),
  },
  { find: portalApi, replacement: path.resolve(__dirname, "electron/mainPortalApiLite.ts") },
];

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    ...(process.env.VITE_DESKTOP_ELECTRON === "0"
      ? []
      : [
          electron({
            main: {
              entry: "electron/main.ts",
              vite: {
                resolve: { alias: mainAlias },
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
        ]),
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
