const KEY = "oko-table-density";

export type TableDensity = "normal" | "compact";

export function readTableDensity(): TableDensity {
  try {
    return localStorage.getItem(KEY) === "compact" ? "compact" : "normal";
  } catch {
    return "normal";
  }
}

export function writeTableDensity(value: TableDensity): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* ignore */
  }
}
