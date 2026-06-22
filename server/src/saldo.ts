import fs from "fs";
import path from "path";
import type { DatabaseSync } from "node:sqlite";
import { ROOT } from "./paths.js";

export interface SaldoRuleRow {
  number: number;
  target_form: string;
  target_column: string;
  target_row: number;
  source_form: string | null;
  source_column: string | null;
  source_row: number | null;
  end_form: string | null;
  end_column: string | null;
  end_row: number | null;
  saldo_t: number;
  saldo_s: number;
  saldo_g: number;
  name: string | null;
  conditional: number;
}

export interface SaldoRuleDto {
  number: number;
  targetForm: string;
  targetColumn: string;
  targetRow: number | null;
  sourceForm: string | null;
  sourceColumn: string | null;
  sourceRow: number | null;
  endForm?: string | null;
  endColumn?: string | null;
  endRow?: number | null;
  saldoT?: boolean;
  saldoS?: boolean;
  saldoG?: boolean;
  name?: string | null;
  conditional?: boolean;
}

export interface FormCorrespondenceDto {
  formId: string;
  saldoYellow?: string | null;
  saldoRed?: string | null;
  saldoBlue?: string | null;
  pages?: number | null;
}

const SALDO_JSON = path.join(ROOT, "portal", "public", "data", "saldo-rules.json");
const CORRESPONDENCE_JSON = path.join(ROOT, "portal", "public", "data", "form-correspondence.json");

const INSERT_SALDO = `INSERT INTO saldo_rules (
  number, target_form, target_column, target_row,
  source_form, source_column, source_row,
  end_form, end_column, end_row,
  saldo_t, saldo_s, saldo_g, name, conditional
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function migrateSaldoTables(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(saldo_rules)").all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("saldo_t")) {
    db.exec("ALTER TABLE saldo_rules ADD COLUMN saldo_t INTEGER DEFAULT 0");
  }
  if (!names.has("saldo_s")) {
    db.exec("ALTER TABLE saldo_rules ADD COLUMN saldo_s INTEGER DEFAULT 0");
  }
  if (!names.has("saldo_g")) {
    db.exec("ALTER TABLE saldo_rules ADD COLUMN saldo_g INTEGER DEFAULT 0");
  }
  if (!names.has("name")) {
    db.exec("ALTER TABLE saldo_rules ADD COLUMN name TEXT");
  }
  if (!names.has("conditional")) {
    db.exec("ALTER TABLE saldo_rules ADD COLUMN conditional INTEGER DEFAULT 0");
  }

  const tplCols = db.prepare("PRAGMA table_info(form_templates)").all() as Array<{ name: string }>;
  const tplNames = new Set(tplCols.map((c) => c.name));
  if (!tplNames.has("saldo_yellow")) {
    db.exec("ALTER TABLE form_templates ADD COLUMN saldo_yellow TEXT");
  }
  if (!tplNames.has("saldo_red")) {
    db.exec("ALTER TABLE form_templates ADD COLUMN saldo_red TEXT");
  }
  if (!tplNames.has("saldo_blue")) {
    db.exec("ALTER TABLE form_templates ADD COLUMN saldo_blue TEXT");
  }
}

export function rowToDto(row: SaldoRuleRow): SaldoRuleDto {
  return {
    number: row.number,
    targetForm: row.target_form,
    targetColumn: row.target_column,
    targetRow: row.target_row,
    sourceForm: row.source_form,
    sourceColumn: row.source_column,
    sourceRow: row.source_row,
    endForm: row.end_form,
    endColumn: row.end_column,
    endRow: row.end_row,
    saldoT: !!row.saldo_t,
    saldoS: !!row.saldo_s,
    saldoG: !!row.saldo_g,
    name: row.name,
    conditional: !!row.conditional,
  };
}

export function dtoToRow(dto: SaldoRuleDto): SaldoRuleRow {
  return {
    number: dto.number,
    target_form: dto.targetForm,
    target_column: dto.targetColumn,
    target_row: dto.targetRow ?? 0,
    source_form: dto.sourceForm ?? null,
    source_column: dto.sourceColumn ?? null,
    source_row: dto.sourceRow ?? null,
    end_form: dto.endForm ?? null,
    end_column: dto.endColumn ?? null,
    end_row: dto.endRow ?? null,
    saldo_t: dto.saldoT ? 1 : 0,
    saldo_s: dto.saldoS ? 1 : 0,
    saldo_g: dto.saldoG ? 1 : 0,
    name: dto.name ?? null,
    conditional: dto.conditional ? 1 : 0,
  };
}

function insertSaldoRules(db: DatabaseSync, rules: SaldoRuleDto[]): void {
  const insert = db.prepare(INSERT_SALDO);
  for (const dto of rules) {
    const r = dtoToRow(dto);
    insert.run(
      r.number,
      r.target_form,
      r.target_column,
      r.target_row,
      r.source_form,
      r.source_column,
      r.source_row,
      r.end_form,
      r.end_column,
      r.end_row,
      r.saldo_t,
      r.saldo_s,
      r.saldo_g,
      r.name,
      r.conditional
    );
  }
}

export function seedSaldoRulesFromJson(db: DatabaseSync): number {
  if (!fs.existsSync(SALDO_JSON)) return 0;
  const count = db.prepare("SELECT COUNT(*) AS c FROM saldo_rules").get() as { c: number };
  if (count.c > 0) return 0;

  const data = JSON.parse(fs.readFileSync(SALDO_JSON, "utf-8")) as { rules: SaldoRuleDto[] };
  db.exec("BEGIN");
  try {
    insertSaldoRules(db, data.rules);
    db.exec("COMMIT");
    return data.rules.length;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function reimportSaldoRulesFromJson(db: DatabaseSync): number {
  if (!fs.existsSync(SALDO_JSON)) throw new Error("saldo-rules.json not found");
  const data = JSON.parse(fs.readFileSync(SALDO_JSON, "utf-8")) as { rules: SaldoRuleDto[] };
  db.exec("DELETE FROM saldo_rules");
  db.exec("BEGIN");
  try {
    insertSaldoRules(db, data.rules);
    db.exec("COMMIT");
    return data.rules.length;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function getSaldoStats(db: DatabaseSync) {
  const total = (db.prepare("SELECT COUNT(*) AS c FROM saldo_rules").get() as { c: number }).c;
  const typeT = (
    db.prepare("SELECT COUNT(*) AS c FROM saldo_rules WHERE saldo_t = 1").get() as { c: number }
  ).c;
  const typeS = (
    db.prepare("SELECT COUNT(*) AS c FROM saldo_rules WHERE saldo_s = 1").get() as { c: number }
  ).c;
  const typeG = (
    db.prepare("SELECT COUNT(*) AS c FROM saldo_rules WHERE saldo_g = 1").get() as { c: number }
  ).c;
  return { total, typeT, typeS, typeG };
}

export function exportSaldoPayload(db: DatabaseSync) {
  const rows = db
    .prepare(
      `SELECT number, target_form, target_column, target_row,
              source_form, source_column, source_row,
              end_form, end_column, end_row,
              saldo_t, saldo_s, saldo_g, name, conditional
       FROM saldo_rules ORDER BY number`
    )
    .all() as SaldoRuleRow[];
  const stats = getSaldoStats(db);
  return {
    version: "2.0",
    source: "sqlite:saldo_rules",
    total: stats.total,
    rules: rows.map(rowToDto),
  };
}

export function seedFormCorrespondenceFromJson(db: DatabaseSync): number {
  if (!fs.existsSync(CORRESPONDENCE_JSON)) return 0;
  const seeded = (
    db.prepare("SELECT COUNT(*) AS c FROM form_templates WHERE saldo_yellow IS NOT NULL").get() as {
      c: number;
    }
  ).c;
  if (seeded > 0) return 0;

  const data = JSON.parse(fs.readFileSync(CORRESPONDENCE_JSON, "utf-8")) as {
    forms: FormCorrespondenceDto[];
  };
  return applyCorrespondenceList(db, data.forms);
}

export function reimportFormCorrespondenceFromJson(db: DatabaseSync): number {
  if (!fs.existsSync(CORRESPONDENCE_JSON)) throw new Error("form-correspondence.json not found");
  const data = JSON.parse(fs.readFileSync(CORRESPONDENCE_JSON, "utf-8")) as {
    forms: FormCorrespondenceDto[];
  };
  return applyCorrespondenceList(db, data.forms);
}

function applyCorrespondenceList(db: DatabaseSync, forms: FormCorrespondenceDto[]): number {
  const update = db.prepare(
    `UPDATE form_templates SET
      saldo_yellow = ?, saldo_red = ?, saldo_blue = ?,
      pages = COALESCE(?, pages)
     WHERE form_id = ?`
  );
  let n = 0;
  db.exec("BEGIN");
  try {
    for (const f of forms) {
      const result = update.run(
        f.saldoYellow ?? null,
        f.saldoRed ?? null,
        f.saldoBlue ?? null,
        f.pages ?? null,
        f.formId
      );
      if (result.changes > 0) n++;
    }
    db.exec("COMMIT");
    return n;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function exportFormCorrespondencePayload(db: DatabaseSync) {
  const rows = db
    .prepare(
      `SELECT form_id, pages, saldo_yellow, saldo_red, saldo_blue
       FROM form_templates ORDER BY sort_order, form_id`
    )
    .all() as Array<{
    form_id: string;
    pages: number;
    saldo_yellow: string | null;
    saldo_red: string | null;
    saldo_blue: string | null;
  }>;

  const forms: FormCorrespondenceDto[] = rows.map((r) => ({
    formId: r.form_id,
    pages: r.pages,
    saldoYellow: r.saldo_yellow,
    saldoRed: r.saldo_red,
    saldoBlue: r.saldo_blue,
  }));

  return {
    version: "2.0",
    source: "sqlite:form_templates",
    total: forms.length,
    forms,
  };
}

export function getFormCorrespondence(db: DatabaseSync, formId: string): FormCorrespondenceDto | null {
  const row = db
    .prepare(
      `SELECT form_id, pages, saldo_yellow, saldo_red, saldo_blue
       FROM form_templates WHERE form_id = ?`
    )
    .get(formId) as
    | {
        form_id: string;
        pages: number;
        saldo_yellow: string | null;
        saldo_red: string | null;
        saldo_blue: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    formId: row.form_id,
    pages: row.pages,
    saldoYellow: row.saldo_yellow,
    saldoRed: row.saldo_red,
    saldoBlue: row.saldo_blue,
  };
}

export function updateFormCorrespondence(
  db: DatabaseSync,
  formId: string,
  patch: FormCorrespondenceDto
): FormCorrespondenceDto | null {
  const exists = db.prepare("SELECT 1 FROM form_templates WHERE form_id = ?").get(formId);
  if (!exists) return null;

  db.prepare(
    `UPDATE form_templates SET
      saldo_yellow = ?, saldo_red = ?, saldo_blue = ?
     WHERE form_id = ?`
  ).run(patch.saldoYellow ?? null, patch.saldoRed ?? null, patch.saldoBlue ?? null, formId);

  return getFormCorrespondence(db, formId);
}
