/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** `1`/`true` force Excel-like grid; `0`/`false` legacy FormTable. Default: enabled. */
  readonly VITE_SPREADSHEET_GRID?: string;
  /** Optional: `univer` when @univerjs presets are installed. Default: native. */
  readonly VITE_SPREADSHEET_BACKEND?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.md?raw" {
  const content: string;
  export default content;
}
