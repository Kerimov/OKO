import type { OkoDb } from "./oko-db.js";
import { normalizePackageKind, type PackageKind } from "./businessProcessTypes.js";

export type CheckRuleType = "mandatory" | "explain";
export interface CheckRuleDto {
  id: number;
  code: string;
  number: number | null;
  type: CheckRuleType;
  validFrom: string | null;
  validTo: string | null;
  yearOnly: number | null;
  scope: string;
  includeGuids: string[];
  excludeGuids: string[];
  affectedForms: string[];
  severity: string;
  version: string | null;
  expressionRaw: string;
  packageKind: PackageKind;
  active: boolean;
}

type RuleRow = {
  id: number; code: string; number: number | null; type: string; valid_from: string | null;
  valid_to: string | null; year_only: number | null; scope: string; include_guids_json: string;
  exclude_guids_json: string; affected_forms_json: string; severity: string; version: string | null;
  expression_raw: string; package_kind: string; active: number;
};
const parseList = (value: string | null | undefined): string[] => {
  try { const list = JSON.parse(value || "[]"); return Array.isArray(list) ? list.map(String) : []; } catch { return []; }
};
const dto = (row: RuleRow): CheckRuleDto => ({
  id: Number(row.id), code: row.code, number: row.number == null ? null : Number(row.number),
  type: row.type === "explain" ? "explain" : "mandatory", validFrom: row.valid_from,
  validTo: row.valid_to, yearOnly: row.year_only == null ? null : Number(row.year_only),
  scope: row.scope, includeGuids: parseList(row.include_guids_json),
  excludeGuids: parseList(row.exclude_guids_json), affectedForms: parseList(row.affected_forms_json),
  severity: row.severity, version: row.version || null, expressionRaw: row.expression_raw,
  packageKind: normalizePackageKind(row.package_kind), active: !!row.active,
});

export async function listCheckRules(db: OkoDb, packageKind?: PackageKind): Promise<CheckRuleDto[]> {
  const rows = await db.prepare(
    packageKind
      ? "SELECT * FROM check_rules_registry WHERE package_kind = ? ORDER BY number NULLS LAST, id"
      : "SELECT * FROM check_rules_registry ORDER BY package_kind, number NULLS LAST, id"
  ).all(...(packageKind ? [packageKind] : [])) as RuleRow[];
  return rows.map(dto);
}

export async function upsertCheckRule(
  db: OkoDb,
  input: Omit<Partial<CheckRuleDto>, "id" | "packageKind"> & {
    code: string; expressionRaw: string; packageKind?: PackageKind;
  }
): Promise<CheckRuleDto> {
  const kind = normalizePackageKind(input.packageKind);
  const now = new Date().toISOString();
  const version = input.version ?? "";
  await db.prepare(
    `INSERT INTO check_rules_registry (
      code, number, type, valid_from, valid_to, year_only, scope, include_guids_json,
      exclude_guids_json, affected_forms_json, severity, version, expression_raw, package_kind,
      active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (code, package_kind, version) DO UPDATE SET
      number = EXCLUDED.number, type = EXCLUDED.type, valid_from = EXCLUDED.valid_from,
      valid_to = EXCLUDED.valid_to, year_only = EXCLUDED.year_only, scope = EXCLUDED.scope,
      include_guids_json = EXCLUDED.include_guids_json, exclude_guids_json = EXCLUDED.exclude_guids_json,
      affected_forms_json = EXCLUDED.affected_forms_json, severity = EXCLUDED.severity,
      expression_raw = EXCLUDED.expression_raw, active = EXCLUDED.active, updated_at = EXCLUDED.updated_at`
  ).run(
    input.code.trim(), input.number ?? null, input.type === "explain" ? "explain" : "mandatory",
    input.validFrom ?? null, input.validTo ?? null, input.yearOnly ?? null, input.scope ?? "package",
    JSON.stringify(input.includeGuids ?? []), JSON.stringify(input.excludeGuids ?? []),
    JSON.stringify(input.affectedForms ?? []), input.severity ?? "error", version,
    input.expressionRaw.trim(), kind, input.active === false ? 0 : 1, now, now
  );
  return (await listCheckRules(db, kind)).find(
    (rule) => rule.code === input.code.trim() && (rule.version ?? "") === version
  )!;
}

export async function deleteCheckRule(db: OkoDb, id: number): Promise<boolean> {
  return (await db.prepare("DELETE FROM check_rules_registry WHERE id = ?").run(id)).changes > 0;
}

export async function listActivePackageRules(
  db: OkoDb,
  input: { packageKind?: PackageKind; year?: number | null; organizationGuid?: string | null; asOf?: string }
): Promise<CheckRuleDto[]> {
  const today = input.asOf ?? new Date().toISOString().slice(0, 10);
  return (await listCheckRules(db, normalizePackageKind(input.packageKind))).filter((rule) => {
    if (!rule.active || (rule.validFrom && rule.validFrom > today) || (rule.validTo && rule.validTo < today)) return false;
    if (rule.yearOnly != null && rule.yearOnly !== input.year) return false;
    if (rule.includeGuids.length && (!input.organizationGuid || !rule.includeGuids.includes(input.organizationGuid))) return false;
    return !input.organizationGuid || !rule.excludeGuids.includes(input.organizationGuid);
  });
}
