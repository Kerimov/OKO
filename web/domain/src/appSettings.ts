import type { OkoDb } from "./oko-db.js";

function isWorkContextKey(key: string): boolean {
  return (
    key === "workZid" ||
    key === "workEid" ||
    key.startsWith("workZid:") ||
    key.startsWith("workEid:")
  );
}

/** Public app settings without per-user work-context keys. */
export async function listPublicAppSettings(db: OkoDb): Promise<Record<string, string>> {
  const rows = (await db.prepare("SELECT key, value FROM app_settings").all()) as Array<{
    key: string;
    value: string;
  }>;
  const settings: Record<string, string> = {};
  for (const r of rows) {
    if (isWorkContextKey(r.key)) continue;
    settings[r.key] = r.value;
  }
  return settings;
}

/** Upsert global settings; work-context keys are ignored. */
export async function upsertPublicAppSettings(
  db: OkoDb,
  body: Record<string, unknown>
): Promise<{ ok: true }> {
  await db.transaction(async (tx) => {
    const upsert = tx.prepare(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
    for (const [key, value] of Object.entries(body)) {
      if (isWorkContextKey(key)) continue;
      const stored = typeof value === "string" ? value : JSON.stringify(value);
      await upsert.run(key, stored);
    }
  });
  return { ok: true as const };
}
