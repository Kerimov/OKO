import type { PackageDatabase } from "./sqliteDb.js";
import type { OkoFormInstance, InstanceSummary } from "@portal/types";

export function resolveRowNo(row: Record<string, string | number>, index: number): number {
  const parsed = parseInt(String(row.num ?? "").trim(), 10);
  if (Number.isFinite(parsed) && parsed !== 0) return parsed;
  return 900_000_000 + index;
}

export function cellValueParts(
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

export function normalizeInstanceStatus(status: string | null | undefined): "draft" | "submitted" {
  return status === "submitted" ? "submitted" : "draft";
}

export function saveInstance(
  db: PackageDatabase,
  inst: OkoFormInstance,
  updatedBy?: string,
  clientId?: string
): void {
  const signaturesJson = JSON.stringify(inst.signatures ?? {});
  const status = normalizeInstanceStatus(inst.status);
  const now = new Date().toISOString();

  db.prepare(
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
  ).run(
    inst.instanceId,
    inst.templateId,
    inst.zid ?? null,
    inst.eid ?? null,
    inst.templateTitle,
    inst.displayName,
    inst.meta.organization ?? "",
    inst.meta.periodStart || null,
    inst.meta.periodEnd || null,
    inst.meta.unit ?? "тыс.руб.",
    inst.meta.enterpriseCode ?? "1@1",
    signaturesJson,
    status,
    inst.createdAt,
    inst.updatedAt || now
  );

  db.prepare("DELETE FROM form_cell_values WHERE instance_id = ?").run(inst.instanceId);

  const insert = db.prepare(
    `INSERT INTO form_cell_values (
      instance_id, row_no, row_name, column_key, value_num, value_text, updated_at, updated_by, updated_client_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (let index = 0; index < inst.rows.length; index++) {
    const row = inst.rows[index];
    const rowNo = resolveRowNo(row, index);
    const rowName = String(row.name ?? "");
    for (const [key, val] of Object.entries(row)) {
      const { value_num, value_text } = cellValueParts(val);
      if (value_num === null && value_text === null) continue;
      insert.run(
        inst.instanceId,
        rowNo,
        rowName || null,
        key,
        value_num,
        value_text,
        now,
        updatedBy ?? null,
        clientId ?? null
      );
    }
    if (!row.num && rowNo >= 900_000_000) {
      insert.run(
        inst.instanceId,
        rowNo,
        rowName || null,
        "_row_index",
        index,
        null,
        now,
        updatedBy ?? null,
        clientId ?? null
      );
    }
  }
}

export function loadInstance(db: PackageDatabase, instanceId: string): OkoFormInstance | null {
  const header = db
    .prepare(
      `SELECT instance_id, template_id, zid, eid, template_title, display_name, organization,
              period_start, period_end, unit, enterprise_code, signatures_json, status,
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
        status: string | null;
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
    status: normalizeInstanceStatus(header.status),
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

export function listSummaries(db: PackageDatabase, zid: number, eid: number): InstanceSummary[] {
  const rows = db
    .prepare(
      `SELECT instance_id, template_id, template_title, display_name, organization,
              period_start, period_end, zid, eid, status, created_at, updated_at
       FROM form_instances
       WHERE zid = ? AND eid = ?
       ORDER BY template_id`
    )
    .all(zid, eid) as Array<{
    instance_id: string;
    template_id: string;
    template_title: string | null;
    display_name: string;
    organization: string | null;
    period_start: string | null;
    period_end: string | null;
    zid: number | null;
    eid: number | null;
    status: string | null;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((r) => ({
    instanceId: r.instance_id,
    templateId: r.template_id,
    templateTitle: r.template_title ?? r.template_id,
    displayName: r.display_name,
    organization: r.organization ?? "",
    periodStart: r.period_start ?? "",
    periodEnd: r.period_end ?? "",
    zid: r.zid,
    eid: r.eid,
    status: normalizeInstanceStatus(r.status),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function countInstances(db: PackageDatabase, zid: number, eid: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM form_instances WHERE zid = ? AND eid = ?")
    .get(zid, eid) as { c: number };
  return row.c;
}
