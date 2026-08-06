import type { OkoDb } from "./oko-db.js";
import { dateOrNull, dateToString, intOrNull } from "./dbValues.js";
import { loadRashEntries, loadRashEntriesByInstanceIds, saveRashEntries } from "./rash-data.js";
import { withTiming } from "./perf.js";
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
  if (!(await db.columnExists("form_instances", "template_schema_version"))) {
    await db.exec(
      "ALTER TABLE form_instances ADD COLUMN template_schema_version INTEGER DEFAULT 1"
    );
  }
  if (!(await db.columnExists("form_instances", "revision"))) {
    await db.exec("ALTER TABLE form_instances ADD COLUMN revision INTEGER DEFAULT 1");
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

/** Multi-row INSERT chunk size (6 params/row; stay well under PG 65535 param limit). */
const CELL_INSERT_CHUNK = 800;

type CellInsertRow = [
  string,
  number,
  string | null,
  string,
  number | null,
  string | null,
];

async function insertCellValuesBulk(db: OkoDb, cells: CellInsertRow[]): Promise<void> {
  if (cells.length === 0) return;
  for (let offset = 0; offset < cells.length; offset += CELL_INSERT_CHUNK) {
    const chunk = cells.slice(offset, offset + CELL_INSERT_CHUNK);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
    const params: unknown[] = [];
    for (const row of chunk) params.push(...row);
    await db
      .prepare(
        `INSERT INTO form_cell_values (instance_id, row_no, row_name, column_key, value_num, value_text)
         VALUES ${placeholders}`
      )
      .run(...params);
  }
}

export function isLazyCellsEnabled(): boolean {
  return process.env.OKO_LAZY_CELLS === "1" || process.env.OKO_LAZY_CELLS === "true";
}

export async function saveInstanceCells(
  db: OkoDb,
  inst: OkoFormInstance,
  opts?: { materializeCells?: boolean }
): Promise<void> {
  const signaturesJson = JSON.stringify(inst.signatures ?? {});
  const status = normalizeInstanceStatus(inst.status);
  const rows = Array.isArray(inst.rows) ? inst.rows : [];
  const schemaVersion = Number(inst.templateSchemaVersion ?? 1);
  const materialize = opts?.materializeCells !== false;

  await db
    .prepare(
      `INSERT INTO form_instances (
      instance_id, template_id, zid, eid, template_title, display_name, organization,
      period_start, period_end, unit, enterprise_code, signatures_json, status,
      template_schema_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      template_schema_version = COALESCE(excluded.template_schema_version, form_instances.template_schema_version),
      updated_at = excluded.updated_at`
    )
    .run(
      inst.instanceId,
      inst.templateId,
      inst.zid ?? null,
      inst.eid ?? null,
      inst.templateTitle,
      inst.displayName,
      inst.meta?.organization ?? "",
      dateOrNull(inst.meta?.periodStart),
      dateOrNull(inst.meta?.periodEnd),
      inst.meta?.unit ?? "тыс.руб.",
      inst.meta?.enterpriseCode ?? "1@1",
      signaturesJson,
      status,
      schemaVersion,
      inst.createdAt,
      inst.updatedAt
    );

  if (!materialize) {
    return;
  }

  await db.prepare("DELETE FROM form_cell_values WHERE instance_id = ?").run(inst.instanceId);

  const cells: CellInsertRow[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const rowNo = resolveRowNo(row, index);
    const rowName = String(row.name ?? "") || null;
    let wrote = false;
    for (const [key, val] of Object.entries(row)) {
      const { value_num, value_text } = cellValueParts(val);
      if (value_num === null && value_text === null) continue;
      cells.push([inst.instanceId, rowNo, rowName, key, value_num, value_text]);
      wrote = true;
    }
    // Строка только с номером/пустыми графами иначе пропадает при load (rowsFromCells).
    if (!wrote && rowNo < 900_000_000) {
      cells.push([
        inst.instanceId,
        rowNo,
        rowName,
        "num",
        null,
        String(row.num ?? rowNo),
      ]);
    }
    if (!row.num && rowNo >= 900_000_000) {
      cells.push([inst.instanceId, rowNo, rowName, "_row_index", index, null]);
    }
  }

  await insertCellValuesBulk(db, cells);
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
  const map = await loadInstancesBulk(db, { instanceIds: [instanceId] });
  return map.get(instanceId) ?? null;
}

type InstanceHeaderRow = {
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
  revision: number | null;
  template_schema_version: number | null;
  created_at: string;
  updated_at: string;
};

type CellValueRow = {
  instance_id: string;
  row_no: number;
  row_name: string | null;
  column_key: string;
  value_num: number | null;
  value_text: string | null;
};

function headerToInstance(
  header: InstanceHeaderRow,
  cells: Array<{
    row_no: number;
    row_name: string | null;
    column_key: string;
    value_num: number | null;
    value_text: string | null;
  }>,
  rashEntries?: Awaited<ReturnType<typeof loadRashEntries>>
): OkoFormInstance {
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
    revision: Number(header.revision ?? 1),
    templateSchemaVersion: Number(header.template_schema_version ?? 1),
    meta: {
      organization: header.organization ?? "",
      enterpriseCode: header.enterprise_code ?? "1@1",
      periodStart: dateToString(header.period_start),
      periodEnd: dateToString(header.period_end),
      unit: header.unit ?? "тыс.руб.",
    },
    rows: rowsFromCells(cells),
    signatures,
    rashEntries: rashEntries && rashEntries.length > 0 ? rashEntries : undefined,
    createdAt: header.created_at,
    updatedAt: header.updated_at,
  };
}

/**
 * Bulk-load full instances (headers + cells + rash) with a few SQL queries
 * instead of N× (header + cells + rash).
 */
export async function loadInstancesBulk(
  db: OkoDb,
  filter?: { zid?: number; zids?: number[]; eid?: number; instanceIds?: string[] }
): Promise<Map<string, OkoFormInstance>> {
  let instances = 0;
  return withTiming(
    "instances.bulk",
    async () => {
      const out = await loadInstancesBulkImpl(db, filter);
      instances = out.size;
      return out;
    },
    () => ({
      zid: filter?.zid ?? null,
      eid: filter?.eid ?? null,
      zids: filter?.zids?.length ?? null,
      idFilter: filter?.instanceIds?.length ?? null,
      instances,
    })
  );
}

async function loadInstancesBulkImpl(
  db: OkoDb,
  filter?: { zid?: number; zids?: number[]; eid?: number; instanceIds?: string[] }
): Promise<Map<string, OkoFormInstance>> {
  const out = new Map<string, OkoFormInstance>();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.instanceIds?.length) {
    const ids = [...new Set(filter.instanceIds.filter(Boolean))];
    if (ids.length === 0) return out;
    conditions.push(`instance_id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  if (filter?.zids?.length) {
    const zids = [...new Set(filter.zids.filter((z) => Number.isFinite(z)))];
    if (zids.length === 0) return out;
    conditions.push(`zid IN (${zids.map(() => "?").join(",")})`);
    params.push(...zids);
  } else if (filter?.zid != null) {
    conditions.push("zid = ?");
    params.push(filter.zid);
  }
  if (filter?.eid != null) {
    conditions.push("eid = ?");
    params.push(filter.eid);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const headers = (await db
    .prepare(
      `SELECT instance_id, template_id, zid, eid, template_title, display_name, organization,
              period_start, period_end, unit, enterprise_code, signatures_json, status,
              revision, template_schema_version, created_at, updated_at
       FROM form_instances ${where}
       ORDER BY updated_at DESC`
    )
    .all(...params)) as InstanceHeaderRow[];

  if (headers.length === 0) return out;

  const ids = headers.map((h) => h.instance_id);
  const cellsByInstance = new Map<string, CellValueRow[]>();
  const ID_CHUNK = 500;
  for (let offset = 0; offset < ids.length; offset += ID_CHUNK) {
    const chunk = ids.slice(offset, offset + ID_CHUNK);
    const idPlaceholders = chunk.map(() => "?").join(",");
    const cells = (await db
      .prepare(
        `SELECT instance_id, row_no, row_name, column_key, value_num, value_text
         FROM form_cell_values
         WHERE instance_id IN (${idPlaceholders})
         ORDER BY instance_id, row_no, column_key`
      )
      .all(...chunk)) as CellValueRow[];
    for (const cell of cells) {
      const list = cellsByInstance.get(cell.instance_id) ?? [];
      list.push(cell);
      cellsByInstance.set(cell.instance_id, list);
    }
  }

  const rashByInstance = new Map<string, Awaited<ReturnType<typeof loadRashEntries>>>();
  for (let offset = 0; offset < ids.length; offset += ID_CHUNK) {
    const chunk = ids.slice(offset, offset + ID_CHUNK);
    const part = await loadRashEntriesByInstanceIds(db, chunk);
    for (const [id, entries] of part) {
      rashByInstance.set(id, entries);
    }
  }

  for (const header of headers) {
    out.set(
      header.instance_id,
      headerToInstance(
        header,
        cellsByInstance.get(header.instance_id) ?? [],
        rashByInstance.get(header.instance_id)
      )
    );
  }

  // Lazy cells: headers without form_cell_values get template rows on read.
  const needsHydrate: string[] = [];
  for (const id of ids) {
    if (!(cellsByInstance.get(id)?.length)) needsHydrate.push(id);
  }
  if (needsHydrate.length > 0) {
    const { loadFormSchemas, buildInitialRowsFromSchema } = await import("./forms.js");
    const formIds = [
      ...new Set(
        needsHydrate
          .map((id) => out.get(id)?.templateId)
          .filter((x): x is string => Boolean(x))
      ),
    ];
    const schemas = await loadFormSchemas(db, formIds);
    for (const id of needsHydrate) {
      const inst = out.get(id);
      if (!inst) continue;
      const schema = schemas.get(inst.templateId);
      if (schema) inst.rows = buildInitialRowsFromSchema(schema);
    }
  }

  return out;
}

/** Convenience: full instances for a package (zid + eid), as array. */
export async function loadInstancesForPackage(
  db: OkoDb,
  zid: number,
  eid: number
): Promise<OkoFormInstance[]> {
  const map = await loadInstancesBulk(db, { zid, eid });
  return [...map.values()].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
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

export async function findInstanceIdByPackageTemplate(
  db: OkoDb,
  zid: number,
  eid: number,
  templateId: string
): Promise<string | null> {
  const row = (await db
    .prepare(
      `SELECT instance_id FROM form_instances
       WHERE zid = ? AND eid = ? AND template_id = ?
       LIMIT 1`
    )
    .get(zid, eid, templateId)) as { instance_id: string } | undefined;
  return row?.instance_id ?? null;
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
    await tx.prepare("DELETE FROM cell_comments WHERE instance_id = ?").run(instanceId);
    await tx.prepare("DELETE FROM cell_change_log WHERE instance_id = ?").run(instanceId);
    await tx.prepare("DELETE FROM form_rash_entries WHERE instance_id = ?").run(instanceId);
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
  if (normalizeInstanceStatus(inst.status) === "submitted" && !isAdmin) {
    const err = new Error("Form is submitted and cannot be edited");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
}

/** Async check: submitted (non-admin) OR closed period OR completed BP. */
export async function assertInstanceWritable(
  db: OkoDb,
  inst: OkoFormInstance,
  isAdmin: boolean,
  opts?: { force?: boolean }
): Promise<void> {
  assertInstanceEditable(inst, isAdmin);
  const { assertPeriodWritableForInstance } = await import("./periodLifecycle.js");
  await assertPeriodWritableForInstance(db, inst.zid, inst.eid, opts);
  if (opts?.force) return;
  if (inst.zid != null && inst.eid != null) {
    try {
      const { assertFormsWritableForBp } = await import("./businessProcess.js");
      const kindRow = (await db
        .prepare(`SELECT package_kind FROM periods WHERE eid = ? AND zid = ?`)
        .get(inst.eid, inst.zid)) as { package_kind: string | null } | undefined;
      const kind = kindRow?.package_kind === "BALANCE" ? "BALANCE" : "OKO";
      await assertFormsWritableForBp(db, inst.zid, inst.eid, kind);
    } catch (e) {
      const err = e as Error & { status?: number };
      // Ignore missing BP tables during early boot; rethrow lock/conflict.
      if (err.status === 409) throw e;
      if (String(err.message || "").includes("business_processes")) return;
    }
  }
}

export interface CellPatchInput {
  rowNo: number;
  columnKey: string;
  value?: string | number | null;
}

/**
 * Batch upsert cells without full DELETE/INSERT of the instance.
 * Bumps revision and writes cell_change_log entries.
 */
export async function patchInstanceCells(
  db: OkoDb,
  instanceId: string,
  patches: CellPatchInput[],
  actor?: string,
  expectedRevision?: number
): Promise<{ revision: number; updated: number }> {
  if (patches.length > 5000) {
    const err = new Error("Too many cells in one patch (max 5000)");
    (err as Error & { status: number }).status = 400;
    throw err;
  }

  const header = (await db
    .prepare(
      `SELECT revision, status, zid, eid FROM form_instances WHERE instance_id = ?`
    )
    .get(instanceId)) as {
    revision: number | null;
    status: string | null;
    zid: number | null;
    eid: number | null;
  } | undefined;
  if (!header) {
    const err = new Error("Not found");
    (err as Error & { status: number }).status = 404;
    throw err;
  }

  // Domain-level BP + period locks (not only Nest controllers).
  if (header.zid != null && header.eid != null) {
    const { assertPeriodWritableForInstance } = await import("./periodLifecycle.js");
    await assertPeriodWritableForInstance(db, header.zid, header.eid);
    try {
      const { assertFormsWritableForBp } = await import("./businessProcess.js");
      const kindRow = (await db
        .prepare(`SELECT package_kind FROM periods WHERE eid = ? AND zid = ?`)
        .get(header.eid, header.zid)) as { package_kind: string | null } | undefined;
      const kind = kindRow?.package_kind === "BALANCE" ? "BALANCE" : "OKO";
      await assertFormsWritableForBp(db, header.zid, header.eid, kind);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409) throw e;
      if (String(err.message || "").includes("business_processes")) {
        // table may be missing in very early boot
      } else {
        throw e;
      }
    }
  }

  const currentRev = Number(header.revision ?? 1);
  if (expectedRevision != null && expectedRevision !== currentRev) {
    const err = new Error(`Revision conflict: expected ${expectedRevision}, got ${currentRev}`);
    (err as Error & { status: number }).status = 409;
    throw err;
  }

  const now = new Date().toISOString();
  let updated = 0;

  await db.transaction(async (tx) => {
    const upsert = tx.prepare(
      `INSERT INTO form_cell_values (instance_id, row_no, row_name, column_key, value_num, value_text)
       VALUES (?, ?, NULL, ?, ?, ?)
       ON CONFLICT(instance_id, row_no, column_key) DO UPDATE SET
         value_num = excluded.value_num,
         value_text = excluded.value_text`
    );
    const del = tx.prepare(
      `DELETE FROM form_cell_values WHERE instance_id = ? AND row_no = ? AND column_key = ?`
    );
    const log = tx.prepare(
      `INSERT INTO cell_change_log (instance_id, row_no, column_key, old_value, new_value, actor)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const getOld = tx.prepare(
      `SELECT value_num, value_text FROM form_cell_values
       WHERE instance_id = ? AND row_no = ? AND column_key = ?`
    );

    for (const p of patches) {
      const old = (await getOld.get(instanceId, p.rowNo, p.columnKey)) as
        | { value_num: number | null; value_text: string | null }
        | undefined;
      const oldStr =
        old == null
          ? null
          : old.value_num != null
            ? String(old.value_num)
            : old.value_text;
      const newStr =
        p.value === undefined || p.value === null || p.value === ""
          ? null
          : String(p.value);

      if (newStr === null) {
        await del.run(instanceId, p.rowNo, p.columnKey);
      } else {
        const parts = cellValueParts(p.value as string | number);
        await upsert.run(
          instanceId,
          p.rowNo,
          p.columnKey,
          parts.value_num,
          parts.value_text
        );
      }
      await log.run(instanceId, p.rowNo, p.columnKey, oldStr, newStr, actor ?? null);
      updated++;
    }

    await tx
      .prepare(
        `UPDATE form_instances SET revision = ?, updated_at = ? WHERE instance_id = ?`
      )
      .run(currentRev + 1, now, instanceId);
  });

  return { revision: currentRev + 1, updated };
}

export async function upsertInstance(db: OkoDb, inst: OkoFormInstance): Promise<void> {
  if (!inst.meta) {
    inst.meta = {
      organization: "",
      enterpriseCode: "1@1",
      periodStart: "",
      periodEnd: "",
      unit: "тыс.руб.",
    };
  }
  await saveInstanceCells(db, inst);
  // Persist t_ras detail when present on the payload (packages / local saves).
  // Dedicated PUT /rash remains the primary editor path; undefined means leave as-is.
  if (inst.rashEntries !== undefined) {
    const formId = inst.templateId;
    const forForm = inst.rashEntries.filter((e) => !e.formId || e.formId === formId);
    await saveRashEntries(
      db,
      inst.instanceId,
      formId,
      forForm.map((e) => ({ ...e, formId: e.formId || formId }))
    );
  }
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
      inst.meta?.organization ?? "",
      dateOrNull(inst.meta?.periodStart),
      dateOrNull(inst.meta?.periodEnd),
      JSON.stringify(inst),
      inst.createdAt,
      inst.updatedAt
    );
}

/** Save many instances in one DB transaction (or none). */
export async function upsertInstancesBatch(
  db: OkoDb,
  instances: OkoFormInstance[],
  isAdmin: boolean
): Promise<{ saved: number }> {
  if (!instances.length) return { saved: 0 };

  const ids = [...new Set(instances.map((i) => i.instanceId).filter(Boolean))];
  const headers = await loadInstanceHeadersByIds(db, ids);

  await db.transaction(async (tx) => {
    const packageChecked = new Set<string>();
    for (const inst of instances) {
      const existing = headers.get(inst.instanceId);
      if (existing) {
        assertInstanceEditable(
          {
            ...inst,
            status: existing.status,
            zid: existing.zid,
            eid: existing.eid,
          },
          isAdmin
        );
        const zid = existing.zid ?? inst.zid ?? null;
        const eid = existing.eid ?? inst.eid ?? null;
        const pkgKey = zid != null && eid != null ? `${zid}:${eid}` : null;
        if (pkgKey && !packageChecked.has(pkgKey)) {
          await assertInstanceWritable(
            tx,
            { ...inst, status: existing.status, zid, eid },
            isAdmin
          );
          packageChecked.add(pkgKey);
        } else if (!pkgKey) {
          await assertInstanceWritable(
            tx,
            { ...inst, status: existing.status, zid, eid },
            isAdmin
          );
        }
      }
      await upsertInstance(tx, inst);
    }
  });
  return { saved: instances.length };
}

/** Lightweight headers for batch writable checks (no cells). */
export async function loadInstanceHeadersByIds(
  db: OkoDb,
  instanceIds: string[]
): Promise<
  Map<
    string,
    {
      instanceId: string;
      status: "draft" | "submitted";
      zid: number | null;
      eid: number | null;
    }
  >
> {
  const out = new Map<
    string,
    {
      instanceId: string;
      status: "draft" | "submitted";
      zid: number | null;
      eid: number | null;
    }
  >();
  const ids = [...new Set(instanceIds.filter(Boolean))];
  if (!ids.length) return out;
  const CHUNK = 500;
  for (let offset = 0; offset < ids.length; offset += CHUNK) {
    const chunk = ids.slice(offset, offset + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = (await db
      .prepare(
        `SELECT instance_id, status, zid, eid
         FROM form_instances
         WHERE instance_id IN (${placeholders})`
      )
      .all(...chunk)) as Array<{
      instance_id: string;
      status: string | null;
      zid: number | null;
      eid: number | null;
    }>;
    for (const r of rows) {
      out.set(r.instance_id, {
        instanceId: r.instance_id,
        status: normalizeInstanceStatus(r.status),
        zid: intOrNull(r.zid),
        eid: intOrNull(r.eid),
      });
    }
  }
  return out;
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

export async function buildEvalSnapshotFromDb(
  db: OkoDb,
  zidOrOpts?: number | { zid?: number; eid?: number }
) {
  const opts =
    typeof zidOrOpts === "number" || zidOrOpts == null
      ? { zid: zidOrOpts ?? undefined }
      : zidOrOpts;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.zid != null) {
    conditions.push("zid = ?");
    params.push(opts.zid);
  }
  if (opts.eid != null) {
    conditions.push("eid = ?");
    params.push(opts.eid);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const latest = (await db
    .prepare(
      `SELECT instance_id, template_id FROM form_instances ${where} ORDER BY updated_at DESC`
    )
    .all(...params)) as Array<{ instance_id: string; template_id: string }>;

  const picked = new Map<string, string>();
  for (const r of latest) {
    if (!picked.has(r.template_id)) picked.set(r.template_id, r.instance_id);
  }

  const rowsByForm: Record<string, Record<string, string | number>[]> = {};
  const cellIndex: Record<string, Record<string, Record<string, number>>> = {};

  const instanceIds = [...picked.values()];
  const cellsByInstance = new Map<
    string,
    Array<{
      row_no: number;
      row_name: string | null;
      column_key: string;
      value_num: number | null;
      value_text: string | null;
    }>
  >();
  const ID_CHUNK = 500;
  for (let offset = 0; offset < instanceIds.length; offset += ID_CHUNK) {
    const chunk = instanceIds.slice(offset, offset + ID_CHUNK);
    if (chunk.length === 0) continue;
    const cells = (await db
      .prepare(
        `SELECT instance_id, row_no, row_name, column_key, value_num, value_text
         FROM form_cell_values
         WHERE instance_id IN (${chunk.map(() => "?").join(",")})
         ORDER BY instance_id, row_no, column_key`
      )
      .all(...chunk)) as Array<{
      instance_id: string;
      row_no: number;
      row_name: string | null;
      column_key: string;
      value_num: number | null;
      value_text: string | null;
    }>;
    for (const c of cells) {
      const list = cellsByInstance.get(c.instance_id) ?? [];
      list.push(c);
      cellsByInstance.set(c.instance_id, list);
    }
  }

  for (const [templateId, instanceId] of picked) {
    const cells = cellsByInstance.get(instanceId) ?? [];
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
