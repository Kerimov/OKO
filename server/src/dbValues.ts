/** Normalize DB/API date values for PostgreSQL (Date objects) and SQLite (strings). */
export function dateOrNull(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  if (s === "" || s === "null" || s === "undefined") return null;
  if (s.includes("T")) return s.slice(0, 10);
  return s;
}

/** For API / form meta — always a string (empty if no date). */
export function dateToString(value: unknown): string {
  return dateOrNull(value) ?? "";
}
