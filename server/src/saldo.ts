import fs from "fs";
import path from "path";
import type { OkoDb } from "./oko-db.js";
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

export async function migrateSaldoTables(db: OkoDb): Promise<void> {
  if (!(await db.columnExists("saldo_rules", "saldo_t"))) {
    await db.exec("ALTER TABLE saldo_rules ADD COLUMN saldo_t INTEGER DEFAULT 0");
  }
  if (!(await db.columnExists("saldo_rules", "saldo_s"))) {
    await db.exec("ALTER TABLE saldo_rules ADD COLUMN saldo_s INTEGER DEFAULT 0");
  }
  if (!(await db.columnExists("saldo_rules", "saldo_g"))) {
    await db.exec("ALTER TABLE saldo_rules ADD COLUMN saldo_g INTEGER DEFAULT 0");
  }
  if (!(await db.columnExists("saldo_rules", "name"))) {
    await db.exec("ALTER TABLE saldo_rules ADD COLUMN name TEXT");
  }
  if (!(await db.columnExists("saldo_rules", "conditional"))) {
    await db.exec("ALTER TABLE saldo_rules ADD COLUMN conditional INTEGER DEFAULT 0");
  }

  if (!(await db.columnExists("form_templates", "saldo_yellow"))) {
    await db.exec("ALTER TABLE form_templates ADD COLUMN saldo_yellow TEXT");
  }
  if (!(await db.columnExists("form_templates", "saldo_red"))) {
    await db.exec("ALTER TABLE form_templates ADD COLUMN saldo_red TEXT");
  }
  if (!(await db.columnExists("form_templates", "saldo_blue"))) {
    await db.exec("ALTER TABLE form_templates ADD COLUMN saldo_blue TEXT");
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

async function insertSaldoRules(db: OkoDb, rules: SaldoRuleDto[]): Promise<void> {
  const insert = db.prepare(INSERT_SALDO);
  for (const dto of rules) {
    const r = dtoToRow(dto);
    await insert.run(
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

export async function seedSaldoRulesFromJson(db: OkoDb): Promise<number> {
  if (!fs.existsSync(SALDO_JSON)) return 0;
  const count = (await db.prepare("SELECT COUNT(*) AS c FROM saldo_rules").get()) as { c: number };
  if (count.c > 0) return 0;

  const data = JSON.parse(fs.readFileSync(SALDO_JSON, "utf-8")) as { rules: SaldoRuleDto[] };
  return db.transaction(async (tx) => {
    await insertSaldoRules(tx, data.rules);
    return data.rules.length;
  });
}

export async function reimportSaldoRulesFromJson(db: OkoDb): Promise<number> {
  if (!fs.existsSync(SALDO_JSON)) throw new Error("saldo-rules.json not found");
  const data = JSON.parse(fs.readFileSync(SALDO_JSON, "utf-8")) as { rules: SaldoRuleDto[] };
  await db.exec("DELETE FROM saldo_rules");
  return db.transaction(async (tx) => {
    await insertSaldoRules(tx, data.rules);
    return data.rules.length;
  });
}

export async function getSaldoStats(db: OkoDb) {
  const total = ((await db.prepare("SELECT COUNT(*) AS c FROM saldo_rules").get()) as { c: number })
    .c;
  const typeT = (
    (await db.prepare("SELECT COUNT(*) AS c FROM saldo_rules WHERE saldo_t = 1").get()) as {
      c: number;
    }
  ).c;
  const typeS = (
    (await db.prepare("SELECT COUNT(*) AS c FROM saldo_rules WHERE saldo_s = 1").get()) as {
      c: number;
    }
  ).c;
  const typeG = (
    (await db.prepare("SELECT COUNT(*) AS c FROM saldo_rules WHERE saldo_g = 1").get()) as {
      c: number;
    }
  ).c;
  return { total, typeT, typeS, typeG };
}

export async function exportSaldoPayload(db: OkoDb) {
  const rows = (await db
    .prepare(
      `SELECT number, target_form, target_column, target_row,
              source_form, source_column, source_row,
              end_form, end_column, end_row,
              saldo_t, saldo_s, saldo_g, name, conditional
       FROM saldo_rules ORDER BY number`
    )
    .all()) as SaldoRuleRow[];
  const stats = await getSaldoStats(db);
  return {
    version: "2.0",
    source: "sqlite:saldo_rules",
    total: stats.total,
    rules: rows.map(rowToDto),
  };
}

export async function seedFormCorrespondenceFromJson(db: OkoDb): Promise<number> {
  if (!fs.existsSync(CORRESPONDENCE_JSON)) return 0;
  const seeded = (
    (await db
      .prepare("SELECT COUNT(*) AS c FROM form_templates WHERE saldo_yellow IS NOT NULL")
      .get()) as {
      c: number;
    }
  ).c;
  if (seeded > 0) return 0;

  const data = JSON.parse(fs.readFileSync(CORRESPONDENCE_JSON, "utf-8")) as {
    forms: FormCorrespondenceDto[];
  };
  return applyCorrespondenceList(db, data.forms);
}

export async function reimportFormCorrespondenceFromJson(db: OkoDb): Promise<number> {
  if (!fs.existsSync(CORRESPONDENCE_JSON)) throw new Error("form-correspondence.json not found");
  const data = JSON.parse(fs.readFileSync(CORRESPONDENCE_JSON, "utf-8")) as {
    forms: FormCorrespondenceDto[];
  };
  return applyCorrespondenceList(db, data.forms);
}

async function applyCorrespondenceList(db: OkoDb, forms: FormCorrespondenceDto[]): Promise<number> {
  return db.transaction(async (tx) => {
    const update = tx.prepare(
      `UPDATE form_templates SET
      saldo_yellow = ?, saldo_red = ?, saldo_blue = ?,
      pages = COALESCE(?, pages)
     WHERE form_id = ?`
    );
    let n = 0;
    for (const f of forms) {
      const result = await update.run(
        f.saldoYellow ?? null,
        f.saldoRed ?? null,
        f.saldoBlue ?? null,
        f.pages ?? null,
        f.formId
      );
      if (result.changes > 0) n++;
    }
    return n;
  });
}

export async function exportFormCorrespondencePayload(db: OkoDb) {
  const rows = (await db
    .prepare(
      `SELECT form_id, pages, saldo_yellow, saldo_red, saldo_blue
       FROM form_templates ORDER BY sort_order, form_id`
    )
    .all()) as Array<{
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

export async function getFormCorrespondence(
  db: OkoDb,
  formId: string
): Promise<FormCorrespondenceDto | null> {
  const row = (await db
    .prepare(
      `SELECT form_id, pages, saldo_yellow, saldo_red, saldo_blue
       FROM form_templates WHERE form_id = ?`
    )
    .get(formId)) as
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

export async function updateFormCorrespondence(
  db: OkoDb,
  formId: string,
  patch: FormCorrespondenceDto
): Promise<FormCorrespondenceDto | null> {
  const exists = await db.prepare("SELECT 1 FROM form_templates WHERE form_id = ?").get(formId);
  if (!exists) return null;

  await db
    .prepare(
      `UPDATE form_templates SET
      saldo_yellow = ?, saldo_red = ?, saldo_blue = ?
     WHERE form_id = ?`
    )
    .run(patch.saldoYellow ?? null, patch.saldoRed ?? null, patch.saldoBlue ?? null, formId);

  return getFormCorrespondence(db, formId);
}
