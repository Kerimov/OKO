import fs from "fs";
import path from "path";
import type { DatabaseSync } from "node:sqlite";
import { ROOT } from "./paths.js";

export interface CheckRuleRow {
  number: number;
  expression: string;
  expression_alt: string | null;
  message: string | null;
  for_aggr_only: number;
  first_level: number;
  active: number;
  period_active: number;
  period: string | null;
  info: string | null;
}

export interface CheckRuleDto {
  number: number;
  expression: string;
  expressionAlt?: string | null;
  message?: string | null;
  forAggrOnly?: boolean;
  firstLevel?: boolean;
  active?: boolean;
  periodActive?: boolean;
  period?: string | null;
  info?: string | null;
}

const CHECKS_JSON = path.join(ROOT, "portal", "public", "data", "checks.json");

export function migrateCheckRulesTable(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(check_rules)").all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("first_level")) {
    db.exec("ALTER TABLE check_rules ADD COLUMN first_level INTEGER DEFAULT 0");
  }
  if (!names.has("period")) {
    db.exec("ALTER TABLE check_rules ADD COLUMN period TEXT");
  }
  if (!names.has("info")) {
    db.exec("ALTER TABLE check_rules ADD COLUMN info TEXT");
  }
}

export function rowToDto(row: CheckRuleRow): CheckRuleDto {
  return {
    number: row.number,
    expression: row.expression,
    expressionAlt: row.expression_alt,
    message: row.message,
    forAggrOnly: !!row.for_aggr_only,
    firstLevel: !!row.first_level,
    active: !!row.active,
    periodActive: !!row.period_active,
    period: row.period,
    info: row.info,
  };
}

export function dtoToRow(dto: CheckRuleDto): CheckRuleRow {
  return {
    number: dto.number,
    expression: dto.expression,
    expression_alt: dto.expressionAlt ?? null,
    message: dto.message ?? null,
    for_aggr_only: dto.forAggrOnly ? 1 : 0,
    first_level: dto.firstLevel ? 1 : 0,
    active: dto.active ? 1 : 0,
    period_active: dto.periodActive ? 1 : 0,
    period: dto.period ?? null,
    info: dto.info ?? null,
  };
}

export function seedCheckRulesFromJson(db: DatabaseSync): number {
  if (!fs.existsSync(CHECKS_JSON)) return 0;

  const count = db.prepare("SELECT COUNT(*) AS c FROM check_rules").get() as { c: number };
  if (count.c > 0) return 0;

  const data = JSON.parse(fs.readFileSync(CHECKS_JSON, "utf-8")) as {
    checks: CheckRuleDto[];
  };

  const insert = db.prepare(
    `INSERT INTO check_rules (
      number, expression, expression_alt, message,
      for_aggr_only, first_level, active, period_active, period, info
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.exec("BEGIN");
  try {
    for (const c of data.checks) {
      const r = dtoToRow(c);
      insert.run(
        r.number,
        r.expression,
        r.expression_alt,
        r.message,
        r.for_aggr_only,
        r.first_level,
        r.active,
        r.period_active,
        r.period,
        r.info
      );
    }
    db.exec("COMMIT");
    return data.checks.length;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function reimportCheckRulesFromJson(db: DatabaseSync): number {
  if (!fs.existsSync(CHECKS_JSON)) {
    throw new Error("checks.json not found");
  }
  const data = JSON.parse(fs.readFileSync(CHECKS_JSON, "utf-8")) as {
    checks: CheckRuleDto[];
  };
  db.exec("DELETE FROM check_rules");
  const insert = db.prepare(
    `INSERT INTO check_rules (
      number, expression, expression_alt, message,
      for_aggr_only, first_level, active, period_active, period, info
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.exec("BEGIN");
  try {
    for (const c of data.checks) {
      const r = dtoToRow(c);
      insert.run(
        r.number,
        r.expression,
        r.expression_alt,
        r.message,
        r.for_aggr_only,
        r.first_level,
        r.active,
        r.period_active,
        r.period,
        r.info
      );
    }
    db.exec("COMMIT");
    return data.checks.length;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function getChecksStats(db: DatabaseSync) {
  const total = (db.prepare("SELECT COUNT(*) AS c FROM check_rules").get() as { c: number }).c;
  const active = (
    db.prepare("SELECT COUNT(*) AS c FROM check_rules WHERE active = 1").get() as { c: number }
  ).c;
  const periodActive = (
    db.prepare("SELECT COUNT(*) AS c FROM check_rules WHERE period_active = 1").get() as {
      c: number;
    }
  ).c;
  const aggrOnly = (
    db.prepare("SELECT COUNT(*) AS c FROM check_rules WHERE for_aggr_only = 1").get() as {
      c: number;
    }
  ).c;
  return { total, active, periodActive, aggrOnly };
}

export function exportChecksPayload(db: DatabaseSync) {
  const rows = db
    .prepare(
      `SELECT number, expression, expression_alt, message,
              for_aggr_only, first_level, active, period_active, period, info
       FROM check_rules ORDER BY number`
    )
    .all() as CheckRuleRow[];
  const checks = rows.map(rowToDto);
  const stats = getChecksStats(db);
  return {
    version: "2.0",
    source: "sqlite:check_rules",
    total: stats.total,
    activeCount: stats.periodActive,
    checks,
  };
}
