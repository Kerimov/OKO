import fs from "fs";
import path from "path";
import type { OkoDb } from "./oko-db.js";
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

export async function migrateCheckRulesTable(db: OkoDb): Promise<void> {
  if (!(await db.columnExists("check_rules", "first_level"))) {
    await db.exec("ALTER TABLE check_rules ADD COLUMN first_level INTEGER DEFAULT 0");
  }
  if (!(await db.columnExists("check_rules", "period"))) {
    await db.exec("ALTER TABLE check_rules ADD COLUMN period TEXT");
  }
  if (!(await db.columnExists("check_rules", "info"))) {
    await db.exec("ALTER TABLE check_rules ADD COLUMN info TEXT");
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

export async function seedCheckRulesFromJson(db: OkoDb): Promise<number> {
  if (!fs.existsSync(CHECKS_JSON)) return 0;

  const count = (await db.prepare("SELECT COUNT(*) AS c FROM check_rules").get()) as { c: number };
  if (count.c > 0) return 0;

  const data = JSON.parse(fs.readFileSync(CHECKS_JSON, "utf-8")) as {
    checks: CheckRuleDto[];
  };

  return db.transaction(async (tx) => {
    const insert = tx.prepare(
      `INSERT INTO check_rules (
      number, expression, expression_alt, message,
      for_aggr_only, first_level, active, period_active, period, info
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of data.checks) {
      const r = dtoToRow(c);
      await insert.run(
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
    return data.checks.length;
  });
}

export async function reimportCheckRulesFromJson(db: OkoDb): Promise<number> {
  if (!fs.existsSync(CHECKS_JSON)) {
    throw new Error("checks.json not found");
  }
  const data = JSON.parse(fs.readFileSync(CHECKS_JSON, "utf-8")) as {
    checks: CheckRuleDto[];
  };
  await db.exec("DELETE FROM check_rules");
  return db.transaction(async (tx) => {
    const insert = tx.prepare(
      `INSERT INTO check_rules (
      number, expression, expression_alt, message,
      for_aggr_only, first_level, active, period_active, period, info
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of data.checks) {
      const r = dtoToRow(c);
      await insert.run(
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
    return data.checks.length;
  });
}

export async function getChecksStats(db: OkoDb) {
  const total = ((await db.prepare("SELECT COUNT(*) AS c FROM check_rules").get()) as { c: number })
    .c;
  const active = (
    (await db.prepare("SELECT COUNT(*) AS c FROM check_rules WHERE active = 1").get()) as {
      c: number;
    }
  ).c;
  const periodActive = (
    (await db.prepare("SELECT COUNT(*) AS c FROM check_rules WHERE period_active = 1").get()) as {
      c: number;
    }
  ).c;
  const aggrOnly = (
    (await db.prepare("SELECT COUNT(*) AS c FROM check_rules WHERE for_aggr_only = 1").get()) as {
      c: number;
    }
  ).c;
  return { total, active, periodActive, aggrOnly };
}

export async function exportChecksPayload(db: OkoDb) {
  const rows = (await db
    .prepare(
      `SELECT number, expression, expression_alt, message,
              for_aggr_only, first_level, active, period_active, period, info
       FROM check_rules ORDER BY number`
    )
    .all()) as CheckRuleRow[];
  const checks = rows.map(rowToDto);
  const stats = await getChecksStats(db);
  return {
    version: "2.0",
    source: "sqlite:check_rules",
    total: stats.total,
    activeCount: stats.periodActive,
    checks,
  };
}
