import type { PackageDatabase } from "./sqliteDb.js";

export const RULES_META = {
  exportedAt: "rules_exported_at",
  checks: "rules_checks",
  rash: "rules_rash",
  recalc: "rules_recalc",
  rowFormulas: "rules_row_formulas",
  kontr: "rules_kontr",
} as const;

/** Относительный путь (portal public) → ключ в app_meta. */
export const RULES_PUBLIC_PATHS: Record<string, keyof typeof RULES_META | "exportedAt"> = {
  "data/checks.json": "checks",
  "data/rash-rules.json": "rash",
  "data/recalc-rules.json": "recalc",
  "data/row-formulas.json": "rowFormulas",
  "data/kontr.json": "kontr",
};

export interface PackageRulesInput {
  exportedAt?: string;
  checks?: unknown;
  rash?: unknown;
  recalc?: unknown;
  rowFormulas?: unknown;
  kontr?: { items?: unknown[] };
}

export function readAppMeta(db: PackageDatabase, key: string): string | null {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function writeAppMeta(db: PackageDatabase, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

export function importRulesBundle(db: PackageDatabase, bundle: PackageRulesInput): void {
  const exportedAt = bundle.exportedAt ?? new Date().toISOString();

  if (bundle.checks) {
    writeAppMeta(db, RULES_META.checks, JSON.stringify(bundle.checks));
  }
  if (bundle.rash) {
    writeAppMeta(db, RULES_META.rash, JSON.stringify(bundle.rash));
  }
  if (bundle.recalc) {
    writeAppMeta(db, RULES_META.recalc, JSON.stringify(bundle.recalc));
  }
  if (bundle.rowFormulas) {
    writeAppMeta(db, RULES_META.rowFormulas, JSON.stringify(bundle.rowFormulas));
  }
  if (bundle.kontr) {
    writeAppMeta(db, RULES_META.kontr, JSON.stringify(bundle.kontr));
  }
  writeAppMeta(db, RULES_META.exportedAt, exportedAt);
}

export function readRulesFromPackageDb(
  db: PackageDatabase,
  relativePath: string
): unknown | null {
  const normalized = relativePath.replace(/^\/+/, "").replace(/\\/g, "/");
  const field = RULES_PUBLIC_PATHS[normalized];
  if (!field || field === "exportedAt") return null;

  const raw = readAppMeta(db, RULES_META[field]);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getRulesSyncInfo(db: PackageDatabase): {
  exportedAt: string | null;
  hasChecks: boolean;
  hasRash: boolean;
  fromPackage: boolean;
} {
  const exportedAt = readAppMeta(db, RULES_META.exportedAt);
  const hasChecks = !!readAppMeta(db, RULES_META.checks);
  const hasRash = !!readAppMeta(db, RULES_META.rash);
  return {
    exportedAt,
    hasChecks,
    hasRash,
    fromPackage: hasChecks || hasRash,
  };
}
