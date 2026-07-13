import type { OkoDb } from "./oko-db.js";
import { dateOrNull, dateToString, intOrNull } from "./dbValues.js";
import type { OkoFormInstance } from "./types.js";

const META_KEYS = new Set(["num", "code", "name", "account"]);

export async function migrateInstanceTables(db: OkoDb): Promise<void> {
  if (!(await db.columnExists("form_instances", "template_title"))) {
    await db.exec("ALTER TABLE form_instances ADD COLUMN template_title TEXT");
  }
  if (!(await db.columnExists("form_instances", "enterprise_code"))) {
    await db.exec("ALTER TABLE form_instances ADD COLUMN enterprise_code TEXT");
  }
  if (!(await db.columnExists("form_instances", "signatures_json"))) {
    await db.exec("ALTER TABLE form_instances ADD COLUMN signatures_json TEXT DEFAULT '{}'");
  }
  if (!(await db.columnExists("form_instances", "status"))) {
    await db.exec("ALTER TABLE form_instances ADD COLUMN status TEXT DEFAULT 'draft'");
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

export function normalizeInstanceStatus(status: string | null | undefined): "draft" | "submitted" {
  return status === "submitted" ? "submitted" : "draft";
}

export async function saveInstanceCells(db: OkoDb, inst: OkoFormInstance): Promise<void> {
  const signaturesJson = JSON.stringify(inst.signatures ?? {});
  const status = normalizeInstanceStatus(inst.status);

  await db
    .prepare(
      `INSERT INTO form_instances (
      instance_id, template_id, zid, eid, template_title, display_name, organization,
      period_start, period_end, unit, enterprise_code, signatures_json, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      status = excluded.status,
      updated_at = excluded.updated_at`
    )
    .run(
      inst.instanceId,
      inst.templateId,
      inst.zid ?? null,
      inst.eid ?? null,
      inst.templateTitle,
      inst.displayName,
      inst.meta.organization ?? "",
      dateOrNull(inst.meta.periodStart),
      dateOrNull(inst.meta.periodEnd),
      inst.meta.unit ?? "тыс.руб.",
      inst.meta.enterpriseCode ?? "1@1",
      signaturesJson,
      status,
      inst.createdAt,
      inst.updatedAt
    );

  await db.prepare("DELETE FROM form_cell_values WHERE instance_id = ?").run(inst.instanceId);

  const insert = db.prepare(
    `INSERT INTO form_cell_values (instance_id, row_no, row_name, column_key, value_num, value_text)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  for (let index = 0; index < inst.rows.length; index++) {
    const row = inst.rows[index];
    const rowNo = resolveRowNo(row, index);
    const rowName = String(row.name ?? "");
    for (const [key, val] of Object.entries(row)) {
      const { value_num, value_text } = cellValueParts(val);
      if (value_num === null && value_text === null) continue;
      await insert.run(inst.instanceId, rowNo, rowName || null, key, value_num, value_text);
    }
    if (!row.num && rowNo >= 900_000_000) {
      await insert.run(inst.instanceId, rowNo, rowName || null, "_row_index", index, null);
    }
  }
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

export async function loadInstanceFromDb(
  db: OkoDb,
  instanceId: string
): Promise<OkoFormInstance | null> {
  const header = (await db
    .prepare(
      `SELECT instance_id, template_id, zid, eid, template_title, display_name, organization,
              period_start, period_end, unit, enterprise_code, signatures_json, status,
              created_at, updated_at
       FROM form_instances WHERE instance_id = ?`
    )
    .get(instanceId)) as
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
        status: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!header) return null;

  const cells = (await db
    .prepare(
      `SELECT row_no, row_name, column_key, value_num, value_text
       FROM form_cell_values WHERE instance_id = ?
       ORDER BY row_no, column_key`
    )
    .all(instanceId)) as Array<{
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
    zid: intOrNull(header.zid),
    eid: intOrNull(header.eid),
    status: normalizeInstanceStatus(header.status),
    meta: {
      organization: header.organization ?? "",
      enterpriseCode: header.enterprise_code ?? "1@1",
      periodStart: dateToString(header.period_start),
      periodEnd: dateToString(header.period_end),
      unit: header.unit ?? "тыс.руб.",
    },
    rows: rowsFromCells(cells),
    signatures,
    createdAt: header.created_at,
    updatedAt: header.updated_at,
  };
}

export async function loadInstanceFromPayload(
  db: OkoDb,
  instanceId: string
): Promise<OkoFormInstance | null> {
  const row = (await db
    .prepare("SELECT payload FROM portal_instances WHERE instance_id = ?")
    .get(instanceId)) as { payload: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.payload) as OkoFormInstance;
}

export async function listInstanceSummaries(
  db: OkoDb,
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

  const normalized = (await db
    .prepare(
      `SELECT instance_id, template_id, zid, eid, template_title, display_name, organization,
              period_start, period_end, status, created_at, updated_at
       FROM form_instances ${where} ORDER BY updated_at DESC`
    )
    .all(...params)) as Array<{
    instance_id: string;
    template_id: string;
    zid: number | null;
    eid: number | null;
    template_title: string | null;
    display_name: string;
    organization: string | null;
    period_start: string | null;
    period_end: string | null;
    status: string | null;
    created_at: string;
    updated_at: string;
  }>;

  const mapRow = (r: (typeof normalized)[0]) => ({
    instanceId: r.instance_id,
    templateId: r.template_id,
    templateTitle: r.template_title ?? r.template_id,
    displayName: r.display_name,
    organization: r.organization ?? "",
    periodStart: dateToString(r.period_start),
    periodEnd: dateToString(r.period_end),
    zid: intOrNull(r.zid),
    eid: intOrNull(r.eid),
    status: normalizeInstanceStatus(r.status),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  let results = normalized.map(mapRow);

  if (filter?.zid != null || filter?.eid != null) {
    results = results.filter((s) => {
      if (filter.zid != null && intOrNull(s.zid) !== filter.zid) return false;
      if (filter.eid != null && intOrNull(s.eid) !== filter.eid) return false;
      return true;
    });
  }

  results.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  return results;
}

export async function deleteInstanceFromDb(db: OkoDb, instanceId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.prepare("DELETE FROM form_cell_values WHERE instance_id = ?").run(instanceId);
    await tx.prepare("DELETE FROM form_instances WHERE instance_id = ?").run(instanceId);
    await tx.prepare("DELETE FROM portal_instances WHERE instance_id = ?").run(instanceId);
  });
}

export async function setInstanceStatus(
  db: OkoDb,
  instanceId: string,
  status: "draft" | "submitted"
): Promise<OkoFormInstance | null> {
  const existing = await loadInstanceFromDb(db, instanceId);
  if (!existing) return null;
  const now = new Date().toISOString();
  await db
    .prepare(`UPDATE form_instances SET status = ?, updated_at = ? WHERE instance_id = ?`)
    .run(status, now, instanceId);
  return { ...existing, status, updatedAt: now };
}

export function assertInstanceEditable(inst: OkoFormInstance, isAdmin: boolean): void {
  if (isAdmin) return;
  if (normalizeInstanceStatus(inst.status) === "submitted") {
    const err = new Error("Form is submitted and cannot be edited");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
}

export async function upsertInstance(db: OkoDb, inst: OkoFormInstance): Promise<void> {
  await saveInstanceCells(db, inst);
  await db
    .prepare(
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
    )
    .run(
      inst.instanceId,
      inst.templateId,
      inst.templateTitle,
      inst.displayName,
      inst.meta.organization ?? "",
      dateOrNull(inst.meta.periodStart),
      dateOrNull(inst.meta.periodEnd),
      JSON.stringify(inst),
      inst.createdAt,
      inst.updatedAt
    );
}

export async function loadInstance(
  db: OkoDb,
  instanceId: string
): Promise<OkoFormInstance | null> {
  const normalized = await loadInstanceFromDb(db, instanceId);
  if (normalized) return normalized;
  return loadInstanceFromPayload(db, instanceId);
}

export async function migratePortalPayloadsToCells(db: OkoDb): Promise<number> {
  const portals = (await db
    .prepare("SELECT instance_id, payload FROM portal_instances")
    .all()) as Array<{
    instance_id: string;
    payload: string;
  }>;

  let migrated = 0;
  for (const p of portals) {
    const exists = await db
      .prepare("SELECT 1 FROM form_instances WHERE instance_id = ?")
      .get(p.instance_id);
    if (exists) continue;
    try {
      const inst = JSON.parse(p.payload) as OkoFormInstance;
      await saveInstanceCells(db, inst);
      await db.prepare("DELETE FROM portal_instances WHERE instance_id = ?").run(p.instance_id);
      migrated++;
    } catch {
      /* skip invalid payload */
    }
  }
  return migrated;
}

export async function getInstanceStorageStats(db: OkoDb) {
  const instances = (
    (await db.prepare("SELECT COUNT(*) AS c FROM form_instances").get()) as { c: number }
  ).c;
  const cells = (
    (await db.prepare("SELECT COUNT(*) AS c FROM form_cell_values").get()) as { c: number }
  ).c;
  const legacy = (
    (await db.prepare("SELECT COUNT(*) AS c FROM portal_instances").get()) as { c: number }
  ).c;
  const legacyOnly = (
    (await db
      .prepare(
        `SELECT COUNT(*) AS c FROM portal_instances p
         WHERE NOT EXISTS (SELECT 1 FROM form_instances f WHERE f.instance_id = p.instance_id)`
      )
      .get()) as { c: number }
  ).c;
  return { instances, cells, legacyPayloads: legacy, pendingMigration: legacyOnly };
}

export async function buildCellIndexForLatestInstances(db: OkoDb) {
  const latest = (await db
    .prepare(
      `SELECT fi.instance_id, fi.template_id
       FROM form_instances fi
       ORDER BY fi.updated_at DESC`
    )
    .all()) as Array<{ instance_id: string; template_id: string }>;

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
    const cells = (await cellStmt.all(instanceId)) as Array<{
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

export async function buildEvalSnapshotFromDb(db: OkoDb, zid?: number) {
  const latest =
    zid != null
      ? ((await db
          .prepare(
            `SELECT instance_id, template_id FROM form_instances
           WHERE zid = ? ORDER BY updated_at DESC`
          )
          .all(zid)) as Array<{ instance_id: string; template_id: string }>)
      : ((await db
          .prepare(`SELECT instance_id, template_id FROM form_instances ORDER BY updated_at DESC`)
          .all()) as Array<{ instance_id: string; template_id: string }>);

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
    const cells = (await cellStmt.all(instanceId)) as Array<{
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
