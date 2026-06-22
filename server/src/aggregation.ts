import fs from "fs";
import path from "path";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { exportCatalog } from "./forms.js";
import { loadInstance, upsertInstance } from "./instances.js";
import type { OkoFormInstance } from "./types.js";
import { ROOT } from "./paths.js";

export interface AggListRow {
  id: number;
  parent_zid: number;
  child_zid: number;
  included: number;
}

export interface AggListDto {
  id: number;
  parentZid: number;
  childZid: number;
  included: boolean;
  parentName?: string | null;
  childName?: string | null;
  parentCode?: string | null;
  childCode?: string | null;
}

export interface AggListEntryJson {
  parentCode?: string;
  childCode?: string;
  parentZid?: number;
  childZid?: number;
  included?: boolean;
  parentName?: string | null;
  childName?: string | null;
}

export interface RunAggregationResult {
  parentZid: number;
  eid: number;
  children: number[];
  aggregated: number;
  skipped: number;
  missing: string[];
  instanceIds: string[];
  checkSummary?: { total: number; passed: number; failed: number };
}

const AGG_JSON = path.join(ROOT, "portal", "public", "data", "agg-list.json");

export function migrateAggTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agg_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_zid INTEGER NOT NULL REFERENCES organizations(zid) ON DELETE CASCADE,
      child_zid INTEGER NOT NULL REFERENCES organizations(zid) ON DELETE CASCADE,
      included INTEGER NOT NULL DEFAULT 1,
      UNIQUE(parent_zid, child_zid)
    );
    CREATE INDEX IF NOT EXISTS idx_agg_parent ON agg_list(parent_zid);
    CREATE INDEX IF NOT EXISTS idx_agg_child ON agg_list(child_zid);
  `);
}

function orgName(db: DatabaseSync, zid: number): string | null {
  const row = db.prepare("SELECT name, code FROM organizations WHERE zid = ?").get(zid) as
    | { name: string; code: string | null }
    | undefined;
  return row?.name ?? null;
}

function orgCode(db: DatabaseSync, zid: number): string | null {
  const row = db.prepare("SELECT code FROM organizations WHERE zid = ?").get(zid) as
    | { code: string | null }
    | undefined;
  return row?.code ?? null;
}

export function rowToDto(db: DatabaseSync, row: AggListRow): AggListDto {
  return {
    id: row.id,
    parentZid: row.parent_zid,
    childZid: row.child_zid,
    included: !!row.included,
    parentName: orgName(db, row.parent_zid),
    childName: orgName(db, row.child_zid),
    parentCode: orgCode(db, row.parent_zid),
    childCode: orgCode(db, row.child_zid),
  };
}

export function listAggEntries(db: DatabaseSync, parentZid?: number): AggListDto[] {
  const rows = parentZid
    ? (db
        .prepare(
          `SELECT id, parent_zid, child_zid, included FROM agg_list
           WHERE parent_zid = ? ORDER BY child_zid`
        )
        .all(parentZid) as unknown as AggListRow[])
    : (db
        .prepare(
          `SELECT id, parent_zid, child_zid, included FROM agg_list ORDER BY parent_zid, child_zid`
        )
        .all() as unknown as AggListRow[]);
  return rows.map((r) => rowToDto(db, r));
}

export function getAggStats(db: DatabaseSync) {
  const total = (db.prepare("SELECT COUNT(*) AS c FROM agg_list").get() as { c: number }).c;
  const included = (
    db.prepare("SELECT COUNT(*) AS c FROM agg_list WHERE included = 1").get() as { c: number }
  ).c;
  const parents = (
    db.prepare("SELECT COUNT(DISTINCT parent_zid) AS c FROM agg_list").get() as { c: number }
  ).c;
  return { total, included, parents };
}

export function upsertAggEntry(
  db: DatabaseSync,
  input: { parentZid: number; childZid: number; included?: boolean; id?: number }
): AggListDto {
  if (input.parentZid === input.childZid) {
    throw new Error("parent and child must differ");
  }
  const included = input.included !== false ? 1 : 0;
  if (input.id) {
    db.prepare(
      `UPDATE agg_list SET parent_zid = ?, child_zid = ?, included = ? WHERE id = ?`
    ).run(input.parentZid, input.childZid, included, input.id);
    const row = db
      .prepare("SELECT id, parent_zid, child_zid, included FROM agg_list WHERE id = ?")
      .get(input.id) as unknown as AggListRow;
    return rowToDto(db, row);
  }
  const result = db
    .prepare(
      `INSERT INTO agg_list (parent_zid, child_zid, included) VALUES (?, ?, ?)
       ON CONFLICT(parent_zid, child_zid) DO UPDATE SET included = excluded.included`
    )
    .run(input.parentZid, input.childZid, included);
  const id = Number(result.lastInsertRowid);
  const row = db
    .prepare("SELECT id, parent_zid, child_zid, included FROM agg_list WHERE id = ?")
    .get(id) as unknown as AggListRow;
  return rowToDto(db, row);
}

export function deleteAggEntry(db: DatabaseSync, id: number): boolean {
  const r = db.prepare("DELETE FROM agg_list WHERE id = ?").run(id);
  return r.changes > 0;
}

function resolveZidByCode(db: DatabaseSync, code: string): number | null {
  const row = db.prepare("SELECT zid FROM organizations WHERE code = ?").get(code) as
    | { zid: number }
    | undefined;
  return row?.zid ?? null;
}

/** Create organizations from agg-list.json legacy codes (dev/demo seed). */
export function seedOrganizationsFromAggCodes(db: DatabaseSync): number {
  if (!fs.existsSync(AGG_JSON)) return 0;
  const data = JSON.parse(fs.readFileSync(AGG_JSON, "utf-8")) as {
    entries?: AggListEntryJson[];
  };
  const orgs = new Map<string, string>();
  for (const e of data.entries ?? []) {
    if (e.parentCode) orgs.set(e.parentCode, e.parentName?.trim() || e.parentCode);
    if (e.childCode) orgs.set(e.childCode, e.childName?.trim() || e.childCode);
  }
  let created = 0;
  for (const [code, name] of orgs) {
    if (resolveZidByCode(db, code) != null) continue;
    const max = db
      .prepare("SELECT COALESCE(MAX(zid), 0) AS m FROM organizations")
      .get() as { m: number };
    const zid = max.m + 1;
    db.prepare("INSERT INTO organizations (zid, name, code) VALUES (?, ?, ?)").run(
      zid,
      name,
      code
    );
    created++;
  }
  return created;
}

export function seedAggFromJson(db: DatabaseSync): number {
  if (!fs.existsSync(AGG_JSON)) return 0;
  const existing = (db.prepare("SELECT COUNT(*) AS c FROM agg_list").get() as { c: number }).c;
  if (existing > 0) return 0;

  const data = JSON.parse(fs.readFileSync(AGG_JSON, "utf-8")) as {
    entries?: AggListEntryJson[];
  };
  let seeded = 0;
  for (const e of data.entries ?? []) {
    const parentZid =
      e.parentZid ?? (e.parentCode ? resolveZidByCode(db, e.parentCode) : null);
    const childZid = e.childZid ?? (e.childCode ? resolveZidByCode(db, e.childCode) : null);
    if (parentZid == null || childZid == null) continue;
    upsertAggEntry(db, {
      parentZid,
      childZid,
      included: e.included !== false,
    });
    seeded++;
  }
  return seeded;
}

export function exportAggPayload(db: DatabaseSync) {
  return {
    version: "1.0",
    source: "sqlite",
    total: getAggStats(db).total,
    entries: listAggEntries(db).map((e) => ({
      parentZid: e.parentZid,
      childZid: e.childZid,
      included: e.included,
      parentCode: e.parentCode,
      childCode: e.childCode,
      parentName: e.parentName,
      childName: e.childName,
    })),
  };
}

export function reimportAggFromJson(db: DatabaseSync): number {
  if (!fs.existsSync(AGG_JSON)) throw new Error("agg-list.json not found");
  db.exec("DELETE FROM agg_list");
  const data = JSON.parse(fs.readFileSync(AGG_JSON, "utf-8")) as {
    entries?: AggListEntryJson[];
  };
  let count = 0;
  for (const e of data.entries ?? []) {
    const parentZid =
      e.parentZid ?? (e.parentCode ? resolveZidByCode(db, e.parentCode) : null);
    const childZid = e.childZid ?? (e.childCode ? resolveZidByCode(db, e.childCode) : null);
    if (parentZid == null || childZid == null) continue;
    upsertAggEntry(db, { parentZid, childZid, included: e.included !== false });
    count++;
  }
  return count;
}

function rowKey(row: Record<string, string | number>): string {
  return String(row.num ?? "").trim();
}

function parseNum(v: string | number | undefined): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function isNumericColumn(key: string): boolean {
  return !["num", "name", "code", "account"].includes(key);
}

export function sumInstances(templateId: string, sources: OkoFormInstance[]): OkoFormInstance {
  if (sources.length === 0) throw new Error("No sources");
  if (sources.some((s) => s.templateId !== templateId)) {
    throw new Error("Template mismatch");
  }

  const base = sources[0];
  const rowMaps = sources.map((inst) => {
    const m = new Map<string, Record<string, string | number>>();
    for (const r of inst.rows) {
      const k = rowKey(r);
      if (k) m.set(k, r);
    }
    return m;
  });

  const allKeys = new Set<string>();
  for (const m of rowMaps) for (const k of m.keys()) allKeys.add(k);

  const columnKeys = new Set<string>();
  for (const inst of sources) {
    for (const row of inst.rows) {
      for (const key of Object.keys(row)) {
        if (isNumericColumn(key)) columnKeys.add(key);
      }
    }
  }

  const rows: Record<string, string | number>[] = [];
  for (const num of Array.from(allKeys).sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  })) {
    const template = rowMaps.find((m) => m.has(num))?.get(num);
    const row: Record<string, string | number> = {};
    if (template?.name) row.name = String(template.name);
    if (template?.code) row.code = String(template.code);
    row.num = num;
    for (const col of columnKeys) {
      let sum = 0;
      let any = false;
      for (const m of rowMaps) {
        const r = m.get(num);
        if (!r) continue;
        const v = r[col];
        if (v !== undefined && v !== "") {
          sum += parseNum(v);
          any = true;
        }
      }
      row[col] = any ? sum : "";
    }
    rows.push(row);
  }

  const now = new Date().toISOString();
  return {
    instanceId: randomUUID(),
    templateId,
    templateTitle: base.templateTitle,
    displayName: base.displayName,
    meta: { ...base.meta },
    rows,
    signatures: { ...base.signatures },
    zid: base.zid,
    eid: base.eid,
    createdAt: now,
    updatedAt: now,
  };
}

function latestInstanceForTemplate(
  db: DatabaseSync,
  zid: number,
  eid: number,
  templateId: string
): OkoFormInstance | null {
  const row = db
    .prepare(
      `SELECT instance_id FROM form_instances
       WHERE zid = ? AND eid = ? AND template_id = ?
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(zid, eid, templateId) as { instance_id: string } | undefined;
  if (!row) return null;
  return loadInstance(db, row.instance_id);
}

export function getIncludedChildren(db: DatabaseSync, parentZid: number): number[] {
  const rows = db
    .prepare(
      `SELECT child_zid FROM agg_list WHERE parent_zid = ? AND included = 1 ORDER BY child_zid`
    )
    .all(parentZid) as unknown as Array<{ child_zid: number }>;
  return rows.map((r) => r.child_zid);
}

export function runPackageAggregation(
  db: DatabaseSync,
  parentZid: number,
  eid: number
): RunAggregationResult {
  const parent = db.prepare("SELECT name FROM organizations WHERE zid = ?").get(parentZid) as
    | { name: string }
    | undefined;
  if (!parent) throw new Error("Parent organization not found");

  const period = db
    .prepare("SELECT name, period_start, period_end FROM periods WHERE eid = ? AND zid = ?")
    .get(eid, parentZid) as
    | { name: string; period_start: string | null; period_end: string | null }
    | undefined;
  if (!period) throw new Error("Period not found for parent organization");

  const children = getIncludedChildren(db, parentZid);
  if (children.length === 0) {
    throw new Error("No included child organizations in aggregation list");
  }

  const catalog = exportCatalog(db);
  const missing: string[] = [];
  const instanceIds: string[] = [];
  let aggregated = 0;
  let skipped = 0;

  const enterpriseCode = orgCode(db, parentZid) ?? "1@1";

  for (const form of catalog.forms) {
    const sources: OkoFormInstance[] = [];
    for (const childZid of children) {
      const inst = latestInstanceForTemplate(db, childZid, eid, form.id);
      if (inst) sources.push(inst);
    }
    if (sources.length === 0) {
      missing.push(form.id);
      skipped++;
      continue;
    }

    const summed = sumInstances(form.id, sources);
    const now = new Date().toISOString();

    const existing = latestInstanceForTemplate(db, parentZid, eid, form.id);
    const instance: OkoFormInstance = {
      ...summed,
      instanceId: existing?.instanceId ?? randomUUID(),
      zid: parentZid,
      eid,
      displayName: `${form.id} — ${parent.name.slice(0, 40)} (свод)`,
      meta: {
        organization: parent.name,
        enterpriseCode,
        periodStart: period.period_start ?? "",
        periodEnd: period.period_end ?? "",
        unit: sources[0].meta.unit ?? "тыс.руб.",
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    upsertInstance(db, instance);
    instanceIds.push(instance.instanceId);
    aggregated++;
  }

  return {
    parentZid,
    eid,
    children,
    aggregated,
    skipped,
    missing,
    instanceIds,
  };
}
