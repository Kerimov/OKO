import fs from "fs";
import path from "path";
import {
  extractCellKRefs,
  extractCellRefs,
  extractCellSvRefs,
} from "@oko/engine";
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

export function referencedFormsFromExpression(
  expression: string,
  expressionAlt?: string | null
): string[] {
  const full = `${expression ?? ""}\n${expressionAlt ?? ""}`;
  const forms = new Set<string>();
  for (const r of extractCellRefs(full)) {
    if (r.form) forms.add(r.form);
  }
  for (const r of extractCellSvRefs(full)) {
    if (r.form) forms.add(r.form);
  }
  for (const r of extractCellKRefs(full)) {
    if (r.form) forms.add(r.form);
  }
  return [...forms].sort();
}

export async function syncCheckRuleForms(
  db: OkoDb,
  ruleNumber: number,
  expression: string,
  expressionAlt?: string | null
): Promise<void> {
  await db.prepare(`DELETE FROM check_rule_forms WHERE rule_number = ?`).run(ruleNumber);
  const forms = referencedFormsFromExpression(expression, expressionAlt);
  if (forms.length === 0) return;
  const ins = db.prepare(
    `INSERT INTO check_rule_forms (rule_number, form_id) VALUES (?, ?) ON CONFLICT DO NOTHING`
  );
  for (const formId of forms) {
    await ins.run(ruleNumber, formId);
  }
}

export async function backfillCheckRuleForms(db: OkoDb): Promise<number> {
  const rows = (await db
    .prepare(`SELECT number, expression, expression_alt FROM check_rules`)
    .all()) as Array<{ number: number; expression: string; expression_alt: string | null }>;
  let n = 0;
  for (const r of rows) {
    await syncCheckRuleForms(db, r.number, r.expression, r.expression_alt);
    n++;
  }
  return n;
}

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
  await db.exec(`
    CREATE TABLE IF NOT EXISTS check_rule_forms (
      rule_number INTEGER NOT NULL REFERENCES check_rules(number) ON DELETE CASCADE,
      form_id TEXT NOT NULL,
      PRIMARY KEY (rule_number, form_id)
    );
    CREATE INDEX IF NOT EXISTS idx_check_rule_forms_form ON check_rule_forms(form_id);
    CREATE INDEX IF NOT EXISTS idx_check_rules_active_period
      ON check_rules(active, period_active, number);
  `);
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
      await syncCheckRuleForms(tx, r.number, r.expression, r.expression_alt);
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
  await db.exec("DELETE FROM check_rule_forms");
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
      await syncCheckRuleForms(tx, r.number, r.expression, r.expression_alt);
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

export interface ListCheckRulesOptions {
  limit?: number;
  offset?: number;
  q?: string;
  formId?: string;
  active?: string;
  periodActive?: string;
}

export async function listCheckRules(db: OkoDb, options: ListCheckRulesOptions = {}) {
  const limit = Math.min(options.limit ?? 50, 500);
  const offset = options.offset ?? 0;
  const q = (options.q ?? "").trim();
  const formId = (options.formId ?? "").trim();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (q) {
    conditions.push(
      "(CAST(number AS TEXT) LIKE ? OR expression LIKE ? OR message LIKE ? OR expression_alt LIKE ?)"
    );
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (formId) {
    conditions.push(
      `number IN (SELECT rule_number FROM check_rule_forms WHERE form_id = ?)`
    );
    params.push(formId);
  }
  if (options.active === "1" || options.active === "true") {
    conditions.push("active = 1");
  }
  if (options.periodActive === "1" || options.periodActive === "true") {
    conditions.push("period_active = 1");
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = (
    await db.prepare(`SELECT COUNT(*) AS c FROM check_rules ${where}`).get(...params)
  )?.c as number;

  const rows = (await db
    .prepare(
      `SELECT number, expression, expression_alt, message,
              for_aggr_only, first_level, active, period_active, period, info
       FROM check_rules ${where}
       ORDER BY number
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)) as CheckRuleRow[];

  return { total, limit, offset, items: rows.map(rowToDto) };
}

export async function getCheckRuleByNumber(
  db: OkoDb,
  number: number
): Promise<CheckRuleDto | null> {
  const row = (await db
    .prepare(
      `SELECT number, expression, expression_alt, message,
              for_aggr_only, first_level, active, period_active, period, info
       FROM check_rules WHERE number = ?`
    )
    .get(number)) as CheckRuleRow | undefined;
  return row ? rowToDto(row) : null;
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
