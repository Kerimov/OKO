import { createHash, randomUUID } from "node:crypto";
import type { OkoDb } from "./oko-db.js";

export const METHODOLOGY_SETTINGS_KEY = "methodologyRelease";

export interface MethodologyChecksums {
  checks?: string;
  rash?: string;
  recalc?: string;
  rowFormulas?: string;
  saldo?: string;
  correspondence?: string;
  kontr?: string;
}

export interface MethodologyRelease {
  kind: "methodology-release";
  version: string;
  exportedAt: string;
  activatedAt?: string | null;
  source?: string | null;
  checksums: MethodologyChecksums;
  /** Opaque history id (set when archived). */
  id?: string;
  active?: boolean;
  /** Optional embedded payloads (used when activating / shipping). */
  checks?: unknown;
  rash?: unknown;
  recalc?: unknown;
  rowFormulas?: unknown;
  saldo?: unknown;
  correspondence?: unknown;
  kontr?: unknown;
}

export type MethodologyChecksumDiff = {
  key: keyof MethodologyChecksums;
  left: string | null;
  right: string | null;
  same: boolean;
};

/** Stable JSON for hashing (sorted object keys). */
export function canonicalJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(obj).sort()) {
        out[key] = normalize(obj[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(normalize(value));
}

export function sha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function buildChecksums(parts: {
  checks?: unknown;
  rash?: unknown;
  recalc?: unknown;
  rowFormulas?: unknown;
  saldo?: unknown;
  correspondence?: unknown;
  kontr?: unknown;
}): MethodologyChecksums {
  const out: MethodologyChecksums = {};
  if (parts.checks != null) out.checks = sha256Hex(parts.checks);
  if (parts.rash != null) out.rash = sha256Hex(parts.rash);
  if (parts.recalc != null) out.recalc = sha256Hex(parts.recalc);
  if (parts.rowFormulas != null) out.rowFormulas = sha256Hex(parts.rowFormulas);
  if (parts.saldo != null) out.saldo = sha256Hex(parts.saldo);
  if (parts.correspondence != null) out.correspondence = sha256Hex(parts.correspondence);
  if (parts.kontr != null) out.kontr = sha256Hex(parts.kontr);
  return out;
}

export function diffMethodologyChecksums(
  left: MethodologyChecksums | null | undefined,
  right: MethodologyChecksums | null | undefined
): MethodologyChecksumDiff[] {
  const keys: Array<keyof MethodologyChecksums> = [
    "checks",
    "rash",
    "recalc",
    "rowFormulas",
    "saldo",
    "correspondence",
    "kontr",
  ];
  return keys.map((key) => {
    const l = left?.[key] ?? null;
    const r = right?.[key] ?? null;
    return { key, left: l, right: r, same: l != null && r != null && l === r };
  });
}

function stripHeavy(release: MethodologyRelease): MethodologyRelease {
  return {
    kind: "methodology-release",
    id: release.id,
    version: release.version,
    exportedAt: release.exportedAt,
    activatedAt: release.activatedAt ?? null,
    source: release.source ?? null,
    checksums: release.checksums ?? {},
  };
}

export async function migrateMethodologyHistory(db: OkoDb): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS methodology_releases (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      exported_at TEXT NOT NULL,
      activated_at TEXT NOT NULL,
      source TEXT,
      checksums TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_methodology_releases_act
      ON methodology_releases(active, activated_at DESC);
  `);
}

export async function getMethodologyRelease(db: OkoDb): Promise<MethodologyRelease | null> {
  await migrateMethodologyHistory(db);
  const row = (await db
    .prepare(
      `SELECT id, version, exported_at, activated_at, source, checksums
       FROM methodology_releases WHERE active = 1
       ORDER BY activated_at DESC LIMIT 1`
    )
    .get()) as
    | {
        id: string;
        version: string;
        exported_at: string;
        activated_at: string;
        source: string | null;
        checksums: string;
      }
    | undefined;

  if (row) {
    return {
      kind: "methodology-release",
      id: row.id,
      version: row.version,
      exportedAt: row.exported_at,
      activatedAt: row.activated_at,
      source: row.source,
      checksums: JSON.parse(row.checksums) as MethodologyChecksums,
    };
  }

  // Legacy fallback: single app_settings blob
  const legacy = (await db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(METHODOLOGY_SETTINGS_KEY)) as { value: string } | undefined;
  if (!legacy?.value) return null;
  try {
    const parsed = JSON.parse(legacy.value) as MethodologyRelease;
    if (!parsed?.version) return null;
    return stripHeavy(parsed);
  } catch {
    return null;
  }
}

export async function listMethodologyReleases(
  db: OkoDb,
  limit = 50
): Promise<MethodologyRelease[]> {
  await migrateMethodologyHistory(db);
  const rows = (await db
    .prepare(
      `SELECT id, version, exported_at, activated_at, source, checksums, active
       FROM methodology_releases
       ORDER BY activated_at DESC
       LIMIT ?`
    )
    .all(Math.min(limit, 200))) as Array<{
    id: string;
    version: string;
    exported_at: string;
    activated_at: string;
    source: string | null;
    checksums: string;
    active: number;
  }>;

  if (rows.length) {
    return rows.map((row) => ({
      kind: "methodology-release" as const,
      id: row.id,
      version: row.version,
      exportedAt: row.exported_at,
      activatedAt: row.activated_at,
      source: row.source,
      checksums: JSON.parse(row.checksums) as MethodologyChecksums,
      ...(row.active ? { active: true as const } : { active: false as const }),
    }));
  }

  const active = await getMethodologyRelease(db);
  return active ? [active] : [];
}

export async function getMethodologyReleaseById(
  db: OkoDb,
  id: string
): Promise<MethodologyRelease | null> {
  await migrateMethodologyHistory(db);
  const row = (await db
    .prepare(
      `SELECT id, version, exported_at, activated_at, source, checksums
       FROM methodology_releases WHERE id = ?`
    )
    .get(id)) as
    | {
        id: string;
        version: string;
        exported_at: string;
        activated_at: string;
        source: string | null;
        checksums: string;
      }
    | undefined;
  if (!row) return null;
  return {
    kind: "methodology-release",
    id: row.id,
    version: row.version,
    exportedAt: row.exported_at,
    activatedAt: row.activated_at,
    source: row.source,
    checksums: JSON.parse(row.checksums) as MethodologyChecksums,
  };
}

export async function saveMethodologyRelease(
  db: OkoDb,
  release: MethodologyRelease
): Promise<MethodologyRelease> {
  return activateMethodologyRelease(db, release);
}

/**
 * Activate overlay metadata. Heavy reimport from embedded payloads is optional —
 * primary goal is a versioned checksum record all clients can display.
 */
export async function activateMethodologyRelease(
  db: OkoDb,
  release: MethodologyRelease
): Promise<MethodologyRelease> {
  await migrateMethodologyHistory(db);
  if (!release.version?.trim()) {
    throw new Error("methodology version required");
  }
  const checksums =
    release.checksums && Object.keys(release.checksums).length > 0
      ? release.checksums
      : buildChecksums(release);
  const id = release.id?.trim() || randomUUID();
  const activatedAt = new Date().toISOString();
  const stored = stripHeavy({
    ...release,
    id,
    kind: "methodology-release",
    checksums,
    activatedAt,
  });

  await db.transaction(async (tx) => {
    await tx.prepare(`UPDATE methodology_releases SET active = 0 WHERE active = 1`).run();
    await tx
      .prepare(
        `INSERT INTO methodology_releases
         (id, version, exported_at, activated_at, source, checksums, active)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version,
           exported_at = excluded.exported_at,
           activated_at = excluded.activated_at,
           source = excluded.source,
           checksums = excluded.checksums,
           active = 1`
      )
      .run(
        stored.id!,
        stored.version,
        stored.exportedAt || activatedAt,
        activatedAt,
        stored.source ?? null,
        JSON.stringify(stored.checksums),
      );
    await tx
      .prepare(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(METHODOLOGY_SETTINGS_KEY, JSON.stringify(stored));
  });

  return stored;
}

export async function rollbackMethodologyRelease(
  db: OkoDb,
  id: string
): Promise<MethodologyRelease> {
  const target = await getMethodologyReleaseById(db, id);
  if (!target) throw new Error("Methodology release not found");
  return activateMethodologyRelease(db, {
    ...target,
    exportedAt: target.exportedAt,
    source: target.source ?? `rollback:${id}`,
  });
}

export async function compareMethodologyReleases(
  db: OkoDb,
  leftId: string | null,
  rightId: string | null
): Promise<{
  left: MethodologyRelease | null;
  right: MethodologyRelease | null;
  diff: MethodologyChecksumDiff[];
}> {
  const left = leftId
    ? await getMethodologyReleaseById(db, leftId)
    : await getMethodologyRelease(db);
  const right = rightId ? await getMethodologyReleaseById(db, rightId) : null;
  return {
    left,
    right,
    diff: diffMethodologyChecksums(left?.checksums, right?.checksums),
  };
}
