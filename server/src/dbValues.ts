/** PostgreSQL DATE rejects ""; SQLite TEXT accepts it. Use null for empty dates on write. */
export function dateOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
