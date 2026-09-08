/** Spreadsheet feature flags (keep free of heavy UI deps). */

export function isSpreadsheetGridEnabled(): boolean {
  const env = import.meta.env.VITE_SPREADSHEET_GRID;
  if (env === "0" || env === "false") return false;
  if (env === "1" || env === "true") return true;
  return true;
}

export function isUniverBackendEnabled(): boolean {
  return import.meta.env.VITE_SPREADSHEET_BACKEND === "univer";
}
