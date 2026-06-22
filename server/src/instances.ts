import type { DatabaseSync } from "node:sqlite";
import type { OkoFormInstance } from "./types.js";

const META_KEYS = new Set(["num", "code", "name", "account"]);

export function migrateInstanceTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS form_instances (
      instance_id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      zid INTEGER,
      eid INTEGER,
      display_name TEXT NOT NULL,
      organization TEXT,
      period_start TEXT,
      period_end TEXT,
      unit TEXT DEFAULT 'тыс.руб.',
      status TEXT DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      template_title TEXT,
      enterprise_code TEXT,
      signatures_json TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS form_cell_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT NOT NULL,
      row_no INTEGER NOT NULL,
      row_name TEXT,
      column_key TEXT NOT NULL,
      value_num REAL,
      value_text TEXT,
      UNIQUE (instance_id, row_no, column_key),
      FOREIGN KEY (instance_id) REFERENCES form_instances(instance_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cells_instance ON form_cell_values(instance_id);
    CREATE INDEX IF NOT EXISTS idx_cells_lookup ON form_cell_values(instance_id, row_no, column_key);
    CREATE INDEX IF NOT EXISTS idx_instances_template ON form_instances(template_id);
    CREATE INDEX IF NOT EXISTS idx_instances_period ON form_instances(period_start, period_end);
  `);

  const cols = db.prepare("PRAGMA table_info(form_instances)").all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("template_title")) {
    db.exec("ALTER TABLE form_instances ADD COLUMN template_title TEXT");
  }
  if (!names.has("enterprise_code")) {
    db.exec("ALTER TABLE form_instances ADD COLUMN enterprise_code TEXT");
  }
  if (!names.has("signatures_json")) {
    db.exec("ALTER TABLE form_instances ADD COLUMN signatures_json TEXT DEFAULT '{}'");
  }
}

function resolveRowNo(row: Record<string, string | number>, index: number): number {
  const parsed = parseInt(String(row.num ?? "").trim(), 10);
  if (Number.isFinite(parsed) && parsed !== 0) return parsed;
  return 900_000_000 + index;
}

function cellValueParts(
  val: string | number | undefined
): { value_num: number | null; value_text: string | null } {
  if (val === undefined || val === null || val === "") {
    return { value_num: null, value_text: null };
  }
  if (typeof val === "number" && Number.isFinite(val)) {
    return { value_num: val, value_text: null };
  }
  const s = String(val);
  const n = parseFloat(s.replace(/\s/g, "").replace(",", "."));
  if (s.trim() !== "" && Number.isFinite(n) && /^-?[\d\s.,]+$/.test(s.trim())) {
    return { value_num: n, value_text: null };
  }
  return { value_num: null, value_text: s };
}

function readCellValue(value_num: number | null, value_text: string | null): string | number {
  if (value_text !== null && value_text !== "") return value_text;
  if (value_num !== null && Number.isFinite(value_num)) return value_num;
  return "";
}

export function saveInstanceCells(db: DatabaseSync, inst: OkoFormInstance): void {
  const signaturesJson = JSON.stringify(inst.signatures ?? {});

  db.prepare(
    `INSERT INTO form_instances (
      instance_id, template_id, zid, eid, template_title, display_name, organization,
      period_start, period_end, unit, enterprise_code, signatures_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(instance_id) DO UPDATE SET
      template_id = excluded.template_id,
      zid = excluded.zid,
      eid = excluded.eid,
      template_title = excluded.template_title,
      display_name = excluded.display_name,
      organization = excluded.organization,
      period_start = excluded.period_start,
      period_end = excluded.period_end,
      unit = excluded.unit,
      enterprise_code = excluded.enterprise_code,
      signatures_json = excluded.signatures_json,
      updated_at = excluded.updated_at`
  ).run(
    inst.instanceId,
    inst.templateId,
    inst.zid ?? null,
    inst.eid ?? null,
    inst.templateTitle,
    inst.displayName,
    inst.meta.organization ?? "",
    inst.meta.periodStart ?? "",
    inst.meta.periodEnd ?? "",
    inst.meta.unit ?? "тыс.руб.",
    inst.meta.enterpriseCode ?? "1@1",
    signaturesJson,
    inst.createdAt,
    inst.updatedAt
  );

  db.prepare("DELETE FROM form_cell_values WHERE instance_id = ?").run(inst.instanceId);

  const insert = db.prepare(
    `INSERT INTO form_cell_values (instance_id, row_no, row_name, column_key, value_num, value_text)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  inst.rows.forEach((row, index) => {
    const rowNo = resolveRowNo(row, index);
    const rowName = String(row.name ?? "");
    for (const [key, val] of Object.entries(row)) {
      const { value_num, value_text } = cellValueParts(val);
      if (value_num === null && value_text === null) continue;
      insert.run(inst.instanceId, rowNo, rowName || null, key, value_num, value_text);
    }
    if (!row.num && rowNo >= 900_000_000) {
      insert.run(inst.instanceId, rowNo, rowName || null, "_row_index", index, null);
    }
  });
}

export function rowsFromCells(
  cells: Array<{
    row_no: number;
    row_name: string | null;
    column_key: string;
    value_num: number | null;
    value_text: string | null;
  }>
): Record<string, string | number>[] {
  const byRow = new Map<
    number,
    { row: Record<string, string | number>; rowName: string | null; sortIndex?: number }
  >();

  for (const c of cells) {
    if (c.column_key === "_row_index") {
      const bucket = byRow.get(c.row_no) ?? { row: {}, rowName: c.row_name };
      bucket.sortIndex = c.value_num ?? undefined;
      byRow.set(c.row_no, bucket);
      continue;
    }
    const bucket = byRow.get(c.row_no) ?? { row: {}, rowName: c.row_name };
    bucket.row[c.column_key] = readCellValue(c.value_num, c.value_text);
    if (c.row_name && !bucket.rowName) bucket.rowName = c.row_name;
    byRow.set(c.row_no, bucket);
  }

  const sorted = [...byRow.entries()].sort((a, b) => {
    const ai = a[1].sortIndex ?? a[0];
    const bi = b[1].sortIndex ?? b[0];
    if (a[0] >= 900_000_000 && b[0] >= 900_000_000) return ai - bi;
    return a[0] - b[0];
  });

  return sorted.map(([rowNo, { row, rowName }]) => {
    const out = { ...row };
    if (rowName && !out.name) out.name = rowName;
    if (!out.num && rowNo < 900_000_000) out.num = String(rowNo);
    return out;
  });
}

export function loadInstanceFromDb(db: DatabaseSync, instanceId: string): OkoFormInstance | null {
  const header = db
    .prepare(
      `SELECT instance_id, template_id, zid, eid, template_title, display_name, organization,
              period_start, period_end, unit, enterprise_code, signatures_json,
              created_at, updated_at
       FROM form_instances WHERE instance_id = ?`
    )
    .get(instanceId) as
    | {
        instance_id: string;
        template_id: string;
        zid: number | null;
        eid: number | null;
        template_title: string | null;
        display_name: string;
        organization: string | null;
        period_start: string | null;
        period_end: string | null;
        unit: string | null;
        enterprise_code: string | null;
        signatures_json: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!header) return null;

  const cells = db
    .prepare(
      `SELECT row_no, row_name, column_key, value_num, value_text
       FROM form_cell_values WHERE instance_id = ?
       ORDER BY row_no, column_key`
    )
    .all(instanceId) as Array<{
    row_no: number;
    row_name: string | null;
    column_key: string;
    value_num: number | null;
    value_text: string | null;
  }>;

  let signatures: Record<string, string> = {};
  try {
    signatures = JSON.parse(header.signatures_json || "{}");
  } catch {
    signatures = {};
  }

  return {
    instanceId: header.instance_id,
    templateId: header.template_id,
    templateTitle: header.template_title ?? header.template_id,
    displayName: header.display_name,
    zid: header.zid,
    eid: header.eid,
    meta: {
      organization: header.organization ?? "",
      enterpriseCode: header.enterprise_code ?? "1@1",
      periodStart: header.period_start ?? "",
      periodEnd: header.period_end ?? "",
      unit: header.unit ?? "тыс.руб.",
    },
    rows: rowsFromCells(cells),
    signatures,
    createdAt: header.created_at,
    updatedAt: header.updated_at,
  };
}

export function loadInstanceFromPayload(db: DatabaseSync, instanceId: string): OkoFormInstance | null {
  const row = db
    .prepare("SELECT payload FROM portal_instances WHERE instance_id = ?")
    .get(instanceId) as { payload: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.payload) as OkoFormInstance;
}

export function listInstanceSummaries(
  db: DatabaseSync,
  filter?: { zid?: number; eid?: number }
) {
  const conditions: string[] = [];
  const params: number[] = [];
  if (filter?.zid != null) {
    conditions.push("zid = ?");
    params.push(filter.zid);
  }
  if (filter?.eid != null) {
    conditions.push("eid = ?");
    params.push(filter.eid);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const normalized = db
    .prepare(
      `SELECT instance_id, template_id, zid, eid, template_title, display_name, organization,
              period_start, period_end, created_at, updated_at
       FROM form_instances ${where} ORDER BY updated_at DESC`
    )
    .all(...params) as Array<{
    instance_id: string;
    template_id: string;
    zid: number | null;
    eid: number | null;
    template_title: string | null;
    display_name: string;
    organization: string | null;
    period_start: string | null;
    period_end: string | null;
    created_at: string;
    updated_at: string;
  }>;

  if (normalized.length > 0 || where) {
    return normalized.map((r) => ({
      instanceId: r.instance_id,
      templateId: r.template_id,
      templateTitle: r.template_title ?? r.template_id,
      displayName: r.display_name,
      organization: r.organization ?? "",
      periodStart: r.period_start ?? "",
      periodEnd: r.period_end ?? "",
      zid: r.zid,
      eid: r.eid,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  const legacy = db
    .prepare(
      `SELECT instance_id, template_id, template_title, display_name, organization,
              period_start, period_end, created_at, updated_at
       FROM portal_instances ORDER BY updated_at DESC`
    )
    .all() as Array<{
    instance_id: string;
    template_id: string;
    template_title: string;
    display_name: string;
    organization: string;
    period_start: string;
    period_end: string;
    created_at: string;
    updated_at: string;
  }>;

  return legacy.map((r) => ({
    instanceId: r.instance_id,
    templateId: r.template_id,
    templateTitle: r.template_title,
    displayName: r.display_name,
    organization: r.organization,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    zid: null,
    eid: null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function deleteInstanceFromDb(db: DatabaseSync, instanceId: string): void {
  db.prepare("DELETE FROM form_instances WHERE instance_id = ?").run(instanceId);
  db.prepare("DELETE FROM portal_instances WHERE instance_id = ?").run(instanceId);
}

export function upsertInstance(db: DatabaseSync, inst: OkoFormInstance): void {
  saveInstanceCells(db, inst);
  db.prepare(
    `INSERT INTO portal_instances (
      instance_id, template_id, template_title, display_name,
      organization, period_start, period_end, payload, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(instance_id) DO UPDATE SET
      template_id = excluded.template_id,
      template_title = excluded.template_title,
      display_name = excluded.display_name,
      organization = excluded.organization,
      period_start = excluded.period_start,
      period_end = excluded.period_end,
      payload = excluded.payload,
      updated_at = excluded.updated_at`
  ).run(
    inst.instanceId,
    inst.templateId,
    inst.templateTitle,
    inst.displayName,
    inst.meta.organization ?? "",
    inst.meta.periodStart ?? "",
    inst.meta.periodEnd ?? "",
    JSON.stringify(inst),
    inst.createdAt,
    inst.updatedAt
  );
}

export function loadInstance(db: DatabaseSync, instanceId: string): OkoFormInstance | null {
  const normalized = loadInstanceFromDb(db, instanceId);
  if (normalized) return normalized;
  const legacy = loadInstanceFromPayload(db, instanceId);
  if (legacy) {
    saveInstanceCells(db, legacy);
    return legacy;
  }
  return null;
}

export function migratePortalPayloadsToCells(db: DatabaseSync): number {
  const portals = db.prepare("SELECT instance_id, payload FROM portal_instances").all() as Array<{
    instance_id: string;
    payload: string;
  }>;

  let migrated = 0;
  for (const p of portals) {
    const exists = db
      .prepare("SELECT 1 FROM form_instances WHERE instance_id = ?")
      .get(p.instance_id);
    if (exists) continue;
    try {
      const inst = JSON.parse(p.payload) as OkoFormInstance;
      saveInstanceCells(db, inst);
      migrated++;
    } catch {
      /* skip invalid payload */
    }
  }
  return migrated;
}

export function getInstanceStorageStats(db: DatabaseSync) {
  const instances = (
    db.prepare("SELECT COUNT(*) AS c FROM form_instances").get() as { c: number }
  ).c;
  const cells = (db.prepare("SELECT COUNT(*) AS c FROM form_cell_values").get() as { c: number }).c;
  const legacy = (
    db.prepare("SELECT COUNT(*) AS c FROM portal_instances").get() as { c: number }
  ).c;
  const legacyOnly = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM portal_instances p
         WHERE NOT EXISTS (SELECT 1 FROM form_instances f WHERE f.instance_id = p.instance_id)`
      )
      .get() as { c: number }
  ).c;
  return { instances, cells, legacyPayloads: legacy, pendingMigration: legacyOnly };
}

export function buildCellIndexForLatestInstances(db: DatabaseSync) {
  const latest = db
    .prepare(
      `SELECT fi.instance_id, fi.template_id
       FROM form_instances fi
       ORDER BY fi.updated_at DESC`
    )
    .all() as Array<{ instance_id: string; template_id: string }>;

  const picked = new Map<string, string>();
  for (const r of latest) {
    if (!picked.has(r.template_id)) picked.set(r.template_id, r.instance_id);
  }

  const index: Record<string, Record<string, Record<string, number>>> = {};

  const cellStmt = db.prepare(
    `SELECT row_no, column_key, value_num, value_text
     FROM form_cell_values WHERE instance_id = ?`
  );

  for (const [templateId, instanceId] of picked) {
    const cells = cellStmt.all(instanceId) as Array<{
      row_no: number;
      column_key: string;
      value_num: number | null;
      value_text: string | null;
    }>;
    const template: Record<string, Record<string, number>> = {};
    for (const c of cells) {
      if (META_KEYS.has(c.column_key) || c.column_key === "_row_index") continue;
      const rowKey = String(c.row_no);
      const rowMap = template[rowKey] ?? {};
      const raw = readCellValue(c.value_num, c.value_text);
      const n = parseFloat(String(raw).replace(/\s/g, "").replace(",", "."));
      rowMap[c.column_key] = Number.isFinite(n) ? n : 0;
      template[rowKey] = rowMap;
    }
    index[templateId] = template;
  }

  return index;
}

export function buildEvalSnapshotFromDb(db: DatabaseSync, zid?: number) {
  const latest = zid != null
    ? (db
        .prepare(
          `SELECT instance_id, template_id FROM form_instances
           WHERE zid = ? ORDER BY updated_at DESC`
        )
        .all(zid) as Array<{ instance_id: string; template_id: string }>)
    : (db
        .prepare(
          `SELECT instance_id, template_id FROM form_instances ORDER BY updated_at DESC`
        )
        .all() as Array<{ instance_id: string; template_id: string }>);

  const picked = new Map<string, string>();
  for (const r of latest) {
    if (!picked.has(r.template_id)) picked.set(r.template_id, r.instance_id);
  }

  const rowsByForm: Record<string, Record<string, string | number>[]> = {};
  const cellIndex: Record<string, Record<string, Record<string, number>>> = {};

  const cellStmt = db.prepare(
    `SELECT row_no, row_name, column_key, value_num, value_text
     FROM form_cell_values WHERE instance_id = ?`
  );

  for (const [templateId, instanceId] of picked) {
    const cells = cellStmt.all(instanceId) as Array<{
      row_no: number;
      row_name: string | null;
      column_key: string;
      value_num: number | null;
      value_text: string | null;
    }>;
    rowsByForm[templateId] = rowsFromCells(cells);

    const template: Record<string, Record<string, number>> = {};
    for (const c of cells) {
      if (META_KEYS.has(c.column_key) || c.column_key === "_row_index") continue;
      const rowKey = String(c.row_no);
      const rowMap = template[rowKey] ?? {};
      const raw = readCellValue(c.value_num, c.value_text);
      const n = parseFloat(String(raw).replace(/\s/g, "").replace(",", "."));
      rowMap[c.column_key] = Number.isFinite(n) ? n : 0;
      template[rowKey] = rowMap;
    }
    cellIndex[templateId] = template;
  }

  return { rowsByForm, cellIndex };
}
