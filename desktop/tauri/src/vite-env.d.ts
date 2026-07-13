interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

import type { OkoDesktopApi } from "./desktopApi";

declare global {
  interface Window {
    oko: OkoDesktopApi;
  }
}

export {};
