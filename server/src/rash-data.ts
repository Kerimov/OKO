import type { OkoDb } from "./oko-db.js";

export interface RashEntryRow {
  id: number;
  instance_id: string;
  form_id: string;
  parent_row_no: number;
  column_key: string | null;
  rash_kod: number;
  line_no: number;
  kontr_id: number | null;
  kontr_name: string | null;
  inn: string | null;
  kpp: string | null;
  attr_a2: string | null;
  attr_a3: string | null;
  attr_a4: string | null;
  template_row_key: string | null;
  values_json: string;
}

export interface RashEntryDto {
  id?: number;
  formId: string;
  parentRowNo: number;
  columnKey?: string | null;
  rashKod: number;
  lineNo: number;
  kontrId?: number | null;
  kontrName?: string | null;
  inn?: string | null;
  kpp?: string | null;
  attrA2?: string | null;
  attrA3?: string | null;
  attrA4?: string | null;
  templateRowKey?: string | null;
  values: Record<string, string | number>;
}

export async function migrateRashDataTables(db: OkoDb): Promise<void> {
  await db.exec(`
      CREATE TABLE IF NOT EXISTS form_rash_entries (
        id              SERIAL PRIMARY KEY,
        instance_id     TEXT NOT NULL REFERENCES form_instances(instance_id) ON DELETE CASCADE,
        form_id         TEXT NOT NULL,
        parent_row_no   INTEGER NOT NULL,
        column_key      TEXT,
        rash_kod        INTEGER NOT NULL REFERENCES rash_rules(kod),
        line_no         INTEGER NOT NULL DEFAULT 0,
        kontr_id        INTEGER,
        kontr_name      TEXT,
        inn             TEXT,
        kpp             TEXT,
        attr_a2         TEXT,
        attr_a3         TEXT,
        attr_a4         TEXT,
        template_row_key TEXT,
        values_json     TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_rash_entries_instance ON form_rash_entries(instance_id);
      CREATE INDEX IF NOT EXISTS idx_rash_entries_lookup
        ON form_rash_entries(instance_id, form_id, parent_row_no, rash_kod);
    `);
}

function rowToDto(row: RashEntryRow): RashEntryDto {
  let values: Record<string, string | number> = {};
  try {
    values = JSON.parse(row.values_json || "{}") as Record<string, string | number>;
  } catch {
    values = {};
  }
  return {
    id: row.id,
    formId: row.form_id,
    parentRowNo: row.parent_row_no,
    columnKey: row.column_key,
    rashKod: row.rash_kod,
    lineNo: row.line_no,
    kontrId: row.kontr_id,
    kontrName: row.kontr_name,
    inn: row.inn,
    kpp: row.kpp,
    attrA2: row.attr_a2,
    attrA3: row.attr_a3,
    attrA4: row.attr_a4,
    templateRowKey: row.template_row_key,
    values,
  };
}

export async function loadRashEntries(
  db: OkoDb,
  instanceId: string,
  formId?: string
): Promise<RashEntryDto[]> {
  const params: (string | number)[] = [instanceId];
  let where = "WHERE instance_id = ?";
  if (formId) {
    where += " AND form_id = ?";
    params.push(formId);
  }
  const rows = (await db
    .prepare(
      `SELECT id, instance_id, form_id, parent_row_no, column_key, rash_kod, line_no,
              kontr_id, kontr_name, inn, kpp, attr_a2, attr_a3, attr_a4,
              template_row_key, values_json
       FROM form_rash_entries ${where}
       ORDER BY parent_row_no, rash_kod, line_no, id`
    )
    .all(...params)) as RashEntryRow[];
  return rows.map(rowToDto);
}

export async function saveRashEntries(
  db: OkoDb,
  instanceId: string,
  formId: string,
  entries: RashEntryDto[]
): Promise<RashEntryDto[]> {
  await db.transaction(async (tx) => {
    await tx
      .prepare("DELETE FROM form_rash_entries WHERE instance_id = ? AND form_id = ?")
      .run(instanceId, formId);

    const insert = tx.prepare(
      `INSERT INTO form_rash_entries (
        instance_id, form_id, parent_row_no, column_key, rash_kod, line_no,
        kontr_id, kontr_name, inn, kpp, attr_a2, attr_a3, attr_a4,
        template_row_key, values_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const valuesJson = JSON.stringify(e.values ?? {});
      await insert.run(
        instanceId,
        formId,
        e.parentRowNo,
        e.columnKey ?? null,
        e.rashKod,
        e.lineNo ?? i,
        e.kontrId ?? null,
        e.kontrName ?? null,
        e.inn ?? null,
        e.kpp ?? null,
        e.attrA2 ?? null,
        e.attrA3 ?? null,
        e.attrA4 ?? null,
        e.templateRowKey ?? null,
        valuesJson
      );
    }

    const now = new Date().toISOString();
    await tx
      .prepare(
        `UPDATE form_instances
         SET revision = COALESCE(revision, 1) + 1, updated_at = ?
         WHERE instance_id = ?`
      )
      .run(now, instanceId);
  });
  return loadRashEntries(db, instanceId, formId);
}

export async function deleteRashEntriesForInstance(db: OkoDb, instanceId: string): Promise<void> {
  await db.prepare("DELETE FROM form_rash_entries WHERE instance_id = ?").run(instanceId);
}
