import fs from "fs";
import path from "path";
import {
  ACC_FORM_IDS,
  aggregateInstances,
  BALANCE_FORM_ID,
  cellMaskIsEmpty,
  checkRelationsAccRows,
  colorFieldKey,
  corrFieldKey,
  DEFAULT_UNCHECKING_ROWS,
  FILL_BALANCE_SOURCE_FORM,
  fillBalanceRows,
  mergeRules,
  parseCorrespondenceSpec,
  parseReorgUpdateFlag,
  recalcRowsFull,
  unionCellMasks,
  validateAggrAccountPackage,
  type AccFormId,
  type AggrAccountValidation,
  type CorrespondenceCellMask,
  type CorrespondenceColor,
  type FillBalanceRowsResult,
  type RecalcRule,
  type RelationsAccRowsResult,
  type RowFormula,
} from "@oko/engine";
import type { OkoDb } from "./oko-db.js";
import { dateToString } from "./dbValues.js";
import { randomUUID } from "node:crypto";
import { exportCatalog } from "./forms.js";
import { loadInstance, upsertInstance } from "./instances.js";
import { getFormCorrespondence, type FormCorrespondenceDto } from "./saldo.js";
import type { OkoFormInstance } from "./types.js";
import { ROOT } from "./paths.js";

export type AggregationColorMode = "full" | CorrespondenceColor;

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

export interface RunAggregationOptions {
  parentZid: number;
  eid: number;
  /** Override a_tblAgg_List Include? selection for this run (Access AggrListSelected). */
  childZids?: number[];
  /** Optional subset of forms; default = full catalog. */
  formIds?: string[];
  /** Only aggregate a form when every selected child has it (strict). Default false = sum available. */
  requireAllChildren?: boolean;
  /** Recalc each written parent form after sum (AggrSetTableRecalc). */
  recalc?: boolean;
  /**
   * Access AggrSetReorg{Green,Yellow,Red,Blue}: sum only FormCorrespondence color mask.
   * Default `full` = AggregateSet (all numeric cells).
   */
  colorMode?: AggregationColorMode;
  /**
   * Access btnReorg / ReorgUpdate: in color mode skip forms without ReorgUpdate=`*`.
   */
  reorg?: boolean;
  /**
   * Access AggrGreenUpdate approximation: refresh mask cells on an existing parent
   * form (корректирующий набор), preserve cells outside the mask.
   */
  updateCorrSet?: boolean;
  /**
   * Write destination ZID (Access k_zid / корректирующий набор).
   * Default = parentZid (сворачивающая по a_tblAgg_List).
   */
  targetZid?: number;
}

export interface AggFormPreview {
  formId: string;
  title: string;
  presentChildZids: number[];
  missingChildZids: number[];
  ready: boolean;
  willAggregate: boolean;
  /** Color-mode: FormCorrespondence mask present for selected color. */
  maskPresent?: boolean;
  /** Why form will be skipped beyond missing children. */
  skippedReason?:
    | "no-color-spec"
    | "reorg-update-blocked"
    | "no-existing-corr"
    | null;
}

export interface AggregationPreview {
  parentZid: number;
  eid: number;
  children: number[];
  forms: AggFormPreview[];
  willAggregate: number;
  willSkip: number;
  targetZid?: number;
}

export interface RunAggregationResult {
  parentZid: number;
  eid: number;
  children: number[];
  aggregated: number;
  skipped: number;
  missing: string[];
  instanceIds: string[];
  targetZid?: number;
  forms?: Array<{
    formId: string;
    status: "ok" | "skipped" | "partial";
    sourceChildZids: number[];
    instanceId?: string;
  }>;
  checkSummary?: { total: number; passed: number; failed: number };
}

const AGG_JSON = path.join(ROOT, "portal", "public", "data", "agg-list.json");
const CORRESPONDENCE_JSON = path.join(
  ROOT,
  "portal",
  "public",
  "data",
  "form-correspondence.json"
);

let correspondenceJsonCache: FormCorrespondenceDto[] | null = null;

function loadCorrespondenceJsonFallback(): FormCorrespondenceDto[] {
  if (correspondenceJsonCache) return correspondenceJsonCache;
  if (!fs.existsSync(CORRESPONDENCE_JSON)) {
    correspondenceJsonCache = [];
    return correspondenceJsonCache;
  }
  try {
    const data = JSON.parse(fs.readFileSync(CORRESPONDENCE_JSON, "utf-8")) as {
      forms?: FormCorrespondenceDto[];
    };
    correspondenceJsonCache = data.forms ?? [];
  } catch {
    correspondenceJsonCache = [];
  }
  return correspondenceJsonCache;
}

async function loadFormColorMeta(
  db: OkoDb,
  formId: string
): Promise<FormCorrespondenceDto | null> {
  const fromDb = await getFormCorrespondence(db, formId);
  const fromJson = loadCorrespondenceJsonFallback().find((f) => f.formId === formId) ?? null;
  if (!fromDb && !fromJson) return null;
  return {
    formId,
    pages: fromDb?.pages ?? fromJson?.pages ?? null,
    saldoYellow: fromDb?.saldoYellow ?? fromJson?.saldoYellow ?? null,
    saldoRed: fromDb?.saldoRed ?? fromJson?.saldoRed ?? null,
    saldoBlue: fromDb?.saldoBlue ?? fromJson?.saldoBlue ?? null,
    saldoGreen: fromDb?.saldoGreen ?? fromJson?.saldoGreen ?? null,
    saldoYellowCorr: fromDb?.saldoYellowCorr ?? fromJson?.saldoYellowCorr ?? null,
    saldoRedCorr: fromDb?.saldoRedCorr ?? fromJson?.saldoRedCorr ?? null,
    saldoBlueCorr: fromDb?.saldoBlueCorr ?? fromJson?.saldoBlueCorr ?? null,
    reorgUpdate: fromDb?.reorgUpdate ?? fromJson?.reorgUpdate ?? null,
    reorgUpdate2: fromDb?.reorgUpdate2 ?? fromJson?.reorgUpdate2 ?? null,
  };
}

function colorSpecFromMeta(
  meta: FormCorrespondenceDto | null,
  color: CorrespondenceColor
): string | null {
  if (!meta) return null;
  const key = colorFieldKey(color);
  const v = meta[key];
  return v != null && String(v).trim() ? String(v) : null;
}

function corrSpecFromMeta(
  meta: FormCorrespondenceDto | null,
  color: CorrespondenceColor
): string | null {
  if (!meta || color === "green") return null;
  const key = corrFieldKey(color);
  const v = meta[key];
  return v != null && String(v).trim() ? String(v) : null;
}

/**
 * Access AggrSetReorg*: primary color mask; for yellow/red/blue also ∪ *Corr
 * when present (YellowCorr / RedCorr path).
 */
function resolveColorMask(
  meta: FormCorrespondenceDto | null,
  colorMode: AggregationColorMode
): CorrespondenceCellMask | undefined {
  if (colorMode === "full") return undefined;
  const primary = colorSpecFromMeta(meta, colorMode);
  const corr = corrSpecFromMeta(meta, colorMode);
  if (!primary && !corr) return undefined;
  const mask = unionCellMasks(
    primary ? parseCorrespondenceSpec(primary) : null,
    corr ? parseCorrespondenceSpec(corr) : null
  );
  return cellMaskIsEmpty(mask) ? undefined : mask;
}

export async function migrateAggTables(db: OkoDb): Promise<void> {
  if (db.dialect !== "postgres") {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS agg_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_zid INTEGER NOT NULL REFERENCES organizations(zid) ON DELETE CASCADE,
        child_zid INTEGER NOT NULL REFERENCES organizations(zid) ON DELETE CASCADE,
        included INTEGER NOT NULL DEFAULT 1,
        UNIQUE(parent_zid, child_zid)
      );
      CREATE INDEX IF NOT EXISTS idx_agg_parent ON agg_list(parent_zid);
      CREATE INDEX IF NOT EXISTS idx_agg_child ON agg_list(child_zid);
      CREATE TABLE IF NOT EXISTS agg_corr_sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_zid INTEGER NOT NULL REFERENCES organizations(zid) ON DELETE CASCADE,
        corr_zid INTEGER NOT NULL REFERENCES organizations(zid) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        source_eid INTEGER NOT NULL REFERENCES periods(eid),
        label TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(corr_zid)
      );
      CREATE INDEX IF NOT EXISTS idx_agg_corr_parent ON agg_corr_sets(parent_zid);
    `);
    return;
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS agg_corr_sets (
      id SERIAL PRIMARY KEY,
      parent_zid INTEGER NOT NULL REFERENCES organizations(zid) ON DELETE CASCADE,
      corr_zid INTEGER NOT NULL REFERENCES organizations(zid) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      source_eid INTEGER NOT NULL REFERENCES periods(eid),
      label TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(corr_zid)
    );
    CREATE INDEX IF NOT EXISTS idx_agg_corr_parent ON agg_corr_sets(parent_zid);
  `);
}

async function orgName(db: OkoDb, zid: number): Promise<string | null> {
  const row = (await db.prepare("SELECT name, code FROM organizations WHERE zid = ?").get(zid)) as
    | { name: string; code: string | null }
    | undefined;
  return row?.name ?? null;
}

async function orgCode(db: OkoDb, zid: number): Promise<string | null> {
  const row = (await db.prepare("SELECT code FROM organizations WHERE zid = ?").get(zid)) as
    | { code: string | null }
    | undefined;
  return row?.code ?? null;
}

export async function rowToDto(db: OkoDb, row: AggListRow): Promise<AggListDto> {
  return {
    id: row.id,
    parentZid: row.parent_zid,
    childZid: row.child_zid,
    included: !!row.included,
    parentName: await orgName(db, row.parent_zid),
    childName: await orgName(db, row.child_zid),
    parentCode: await orgCode(db, row.parent_zid),
    childCode: await orgCode(db, row.child_zid),
  };
}

export async function listAggEntries(db: OkoDb, parentZid?: number): Promise<AggListDto[]> {
  const rows = parentZid
    ? ((await db
        .prepare(
          `SELECT id, parent_zid, child_zid, included FROM agg_list
           WHERE parent_zid = ? ORDER BY child_zid`
        )
        .all(parentZid)) as unknown as AggListRow[])
    : ((await db
        .prepare(
          `SELECT id, parent_zid, child_zid, included FROM agg_list ORDER BY parent_zid, child_zid`
        )
        .all()) as unknown as AggListRow[]);
  return Promise.all(rows.map((r) => rowToDto(db, r)));
}

export async function getAggStats(db: OkoDb) {
  const total = ((await db.prepare("SELECT COUNT(*) AS c FROM agg_list").get()) as { c: number }).c;
  const included = (
    (await db.prepare("SELECT COUNT(*) AS c FROM agg_list WHERE included = 1").get()) as {
      c: number;
    }
  ).c;
  const parents = (
    (await db.prepare("SELECT COUNT(DISTINCT parent_zid) AS c FROM agg_list").get()) as {
      c: number;
    }
  ).c;
  return { total, included, parents };
}

export async function upsertAggEntry(
  db: OkoDb,
  input: { parentZid: number; childZid: number; included?: boolean; id?: number }
): Promise<AggListDto> {
  if (input.parentZid === input.childZid) {
    throw new Error("parent and child must differ");
  }
  const included = input.included !== false ? 1 : 0;
  if (input.id) {
    await db
      .prepare(`UPDATE agg_list SET parent_zid = ?, child_zid = ?, included = ? WHERE id = ?`)
      .run(input.parentZid, input.childZid, included, input.id);
    const row = (await db
      .prepare("SELECT id, parent_zid, child_zid, included FROM agg_list WHERE id = ?")
      .get(input.id)) as unknown as AggListRow;
    return rowToDto(db, row);
  }
  await db
    .prepare(
      `INSERT INTO agg_list (parent_zid, child_zid, included) VALUES (?, ?, ?)
       ON CONFLICT(parent_zid, child_zid) DO UPDATE SET included = excluded.included`
    )
    .run(input.parentZid, input.childZid, included);
  const row = (await db
    .prepare(
      "SELECT id, parent_zid, child_zid, included FROM agg_list WHERE parent_zid = ? AND child_zid = ?"
    )
    .get(input.parentZid, input.childZid)) as unknown as AggListRow;
  return rowToDto(db, row);
}

export async function deleteAggEntry(db: OkoDb, id: number): Promise<boolean> {
  const r = await db.prepare("DELETE FROM agg_list WHERE id = ?").run(id);
  return r.changes > 0;
}

async function resolveZidByCode(db: OkoDb, code: string): Promise<number | null> {
  const row = (await db.prepare("SELECT zid FROM organizations WHERE code = ?").get(code)) as
    | { zid: number }
    | undefined;
  return row?.zid ?? null;
}

/** Create organizations from agg-list.json legacy codes (dev/demo seed). */
export async function seedOrganizationsFromAggCodes(db: OkoDb): Promise<number> {
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
    if ((await resolveZidByCode(db, code)) != null) continue;
    const max = (await db
      .prepare("SELECT COALESCE(MAX(zid), 0) AS m FROM organizations")
      .get()) as { m: number };
    const zid = max.m + 1;
    await db.prepare("INSERT INTO organizations (zid, name, code) VALUES (?, ?, ?)").run(
      zid,
      name,
      code
    );
    created++;
  }
  return created;
}

export async function seedAggFromJson(db: OkoDb): Promise<number> {
  if (!fs.existsSync(AGG_JSON)) return 0;
  const existing = ((await db.prepare("SELECT COUNT(*) AS c FROM agg_list").get()) as { c: number })
    .c;
  if (existing > 0) return 0;

  const data = JSON.parse(fs.readFileSync(AGG_JSON, "utf-8")) as {
    entries?: AggListEntryJson[];
  };
  let seeded = 0;
  for (const e of data.entries ?? []) {
    const parentZid =
      e.parentZid ?? (e.parentCode ? await resolveZidByCode(db, e.parentCode) : null);
    const childZid = e.childZid ?? (e.childCode ? await resolveZidByCode(db, e.childCode) : null);
    if (parentZid == null || childZid == null) continue;
    await upsertAggEntry(db, {
      parentZid,
      childZid,
      included: e.included !== false,
    });
    seeded++;
  }
  return seeded;
}

export async function exportAggPayload(db: OkoDb) {
  const entries = await listAggEntries(db);
  return {
    version: "1.0",
    source: "sqlite",
    total: (await getAggStats(db)).total,
    entries: entries.map((e) => ({
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

export async function reimportAggFromJson(db: OkoDb): Promise<number> {
  if (!fs.existsSync(AGG_JSON)) throw new Error("agg-list.json not found");
  await db.exec("DELETE FROM agg_list");
  const data = JSON.parse(fs.readFileSync(AGG_JSON, "utf-8")) as {
    entries?: AggListEntryJson[];
  };
  let count = 0;
  for (const e of data.entries ?? []) {
    const parentZid =
      e.parentZid ?? (e.parentCode ? await resolveZidByCode(db, e.parentCode) : null);
    const childZid = e.childZid ?? (e.childCode ? await resolveZidByCode(db, e.childCode) : null);
    if (parentZid == null || childZid == null) continue;
    await upsertAggEntry(db, { parentZid, childZid, included: e.included !== false });
    count++;
  }
  return count;
}

async function latestInstanceForTemplate(
  db: OkoDb,
  zid: number,
  eid: number,
  templateId: string
): Promise<OkoFormInstance | null> {
  const row = (await db
    .prepare(
      `SELECT instance_id FROM form_instances
       WHERE zid = ? AND eid = ? AND template_id = ?
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(zid, eid, templateId)) as { instance_id: string } | undefined;
  if (!row) return null;
  return loadInstance(db, row.instance_id);
}

/** Sum numeric columns — delegates to @oko/engine (Access AggregateSet / AggrSetSumReorg). */
export function sumInstances(
  templateId: string,
  sources: OkoFormInstance[],
  cellMask?: CorrespondenceCellMask,
  preserveRows?: OkoFormInstance["rows"]
): OkoFormInstance {
  const { instance } = aggregateInstances({
    templateId,
    sources: sources as Parameters<typeof aggregateInstances>[0]["sources"],
    cellMask,
    preserveUnmasked: !cellMask,
    preserveRows,
  });
  return {
    ...instance,
    zid: sources[0]?.zid,
    eid: sources[0]?.eid,
  } as OkoFormInstance;
}

export async function getIncludedChildren(db: OkoDb, parentZid: number): Promise<number[]> {
  const rows = (await db
    .prepare(
      `SELECT child_zid FROM agg_list WHERE parent_zid = ? AND included = 1 ORDER BY child_zid`
    )
    .all(parentZid)) as unknown as Array<{ child_zid: number }>;
  return rows.map((r) => r.child_zid);
}

export async function getAllAggChildren(db: OkoDb, parentZid: number): Promise<AggListDto[]> {
  return listAggEntries(db, parentZid);
}

async function resolveChildren(
  db: OkoDb,
  parentZid: number,
  childZids?: number[]
): Promise<number[]> {
  if (childZids && childZids.length > 0) {
    const allowed = new Set((await listAggEntries(db, parentZid)).map((e) => e.childZid));
    const selected = [...new Set(childZids)].filter((z) => allowed.has(z));
    if (selected.length === 0) {
      throw new Error("Не выбраны участники свода из списка агрегации");
    }
    return selected.sort((a, b) => a - b);
  }
  const children = await getIncludedChildren(db, parentZid);
  if (children.length === 0) {
    throw new Error("Нет включённых дочерних организаций в списке агрегации");
  }
  return children;
}

async function loadParentContext(db: OkoDb, parentZid: number, eid: number) {
  const parent = (await db
    .prepare("SELECT name FROM organizations WHERE zid = ?")
    .get(parentZid)) as { name: string } | undefined;
  if (!parent) throw new Error("Сводная организация не найдена");

  const period = (await db
    .prepare("SELECT name, period_start, period_end FROM periods WHERE eid = ? AND zid = ?")
    .get(eid, parentZid)) as
    | { name: string; period_start: string | null; period_end: string | null }
    | undefined;
  if (!period) throw new Error("Период не найден для сводной организации");

  return { parent, period, enterpriseCode: (await orgCode(db, parentZid)) ?? "1@1" };
}

/** Preview readiness matrix (frmAggrMain before AggregateSet / AggrSetReorg*). */
export async function previewPackageAggregation(
  db: OkoDb,
  options: RunAggregationOptions
): Promise<AggregationPreview> {
  const {
    parentZid,
    eid,
    requireAllChildren = false,
    colorMode = "full",
    reorg = false,
    updateCorrSet = false,
  } = options;
  const targetZid = options.targetZid ?? parentZid;
  await loadParentContext(db, parentZid, eid);
  if (targetZid !== parentZid) {
    const target = (await db
      .prepare("SELECT name FROM organizations WHERE zid = ?")
      .get(targetZid)) as { name: string } | undefined;
    if (!target) throw new Error("Целевая организация (корректирующий набор) не найдена");
  }
  const children = await resolveChildren(db, parentZid, options.childZids);
  const catalog = await exportCatalog(db);
  const formFilter =
    options.formIds && options.formIds.length > 0 ? new Set(options.formIds) : null;
  const gateReorg = reorg || updateCorrSet;

  const forms: AggFormPreview[] = [];
  for (const form of catalog.forms) {
    if (formFilter && !formFilter.has(form.id)) continue;
    const presentChildZids: number[] = [];
    const missingChildZids: number[] = [];
    for (const childZid of children) {
      const inst = await latestInstanceForTemplate(db, childZid, eid, form.id);
      if (inst) presentChildZids.push(childZid);
      else missingChildZids.push(childZid);
    }

    const meta = await loadFormColorMeta(db, form.id);
    const mask = resolveColorMask(meta, colorMode);
    const maskPresent = colorMode === "full" ? true : !!mask;
    let skippedReason: AggFormPreview["skippedReason"] = null;
    if (colorMode !== "full" && !mask) skippedReason = "no-color-spec";
    else if (
      gateReorg &&
      colorMode !== "full" &&
      !parseReorgUpdateFlag(meta?.reorgUpdate ?? meta?.reorgUpdate2)
    ) {
      skippedReason = "reorg-update-blocked";
    } else if (updateCorrSet && colorMode !== "full") {
      const existing = await latestInstanceForTemplate(db, targetZid, eid, form.id);
      if (!existing) skippedReason = "no-existing-corr";
    }

    const dataReady = requireAllChildren
      ? missingChildZids.length === 0 && presentChildZids.length > 0
      : presentChildZids.length > 0;
    const ready = dataReady && !skippedReason;
    const willAggregate = ready;

    forms.push({
      formId: form.id,
      title: form.title,
      presentChildZids,
      missingChildZids,
      ready,
      willAggregate,
      maskPresent,
      skippedReason,
    });
  }

  return {
    parentZid,
    eid,
    children,
    forms,
    willAggregate: forms.filter((f) => f.willAggregate).length,
    willSkip: forms.filter((f) => !f.willAggregate).length,
    targetZid,
  };
}

/**
 * Package свод: Access AggregateSet / AggrSetReorg* / AggrGreenUpdate over a_tblAgg_List.
 * Children → parent forms for one period; optional form subset and Include? override.
 */
export async function runPackageAggregation(
  db: OkoDb,
  parentZidOrOpts: number | RunAggregationOptions,
  eidMaybe?: number
): Promise<RunAggregationResult> {
  const options: RunAggregationOptions =
    typeof parentZidOrOpts === "number"
      ? { parentZid: parentZidOrOpts, eid: eidMaybe! }
      : parentZidOrOpts;

  const {
    parentZid,
    eid,
    requireAllChildren = false,
    recalc = true,
    colorMode = "full",
    reorg = false,
    updateCorrSet = false,
  } = options;
  const targetZid = options.targetZid ?? parentZid;
  const { parent: _parent, period, enterpriseCode } = await loadParentContext(db, parentZid, eid);
  const targetOrg = (await db
    .prepare("SELECT name FROM organizations WHERE zid = ?")
    .get(targetZid)) as { name: string } | undefined;
  if (!targetOrg) throw new Error("Целевая организация (корректирующий набор) не найдена");
  const children = await resolveChildren(db, parentZid, options.childZids);
  const gateReorg = reorg || updateCorrSet;

  const catalog = await exportCatalog(db);
  const formFilter =
    options.formIds && options.formIds.length > 0 ? new Set(options.formIds) : null;

  return db.transaction(async (tx) => {
    const missing: string[] = [];
    const instanceIds: string[] = [];
    const formResults: NonNullable<RunAggregationResult["forms"]> = [];
    let aggregated = 0;
    let skipped = 0;

    for (const form of catalog.forms) {
      if (formFilter && !formFilter.has(form.id)) continue;

      const meta = await loadFormColorMeta(tx, form.id);
      const mask = resolveColorMask(meta, colorMode);
      if (colorMode !== "full" && !mask) {
        missing.push(form.id);
        skipped++;
        formResults.push({ formId: form.id, status: "skipped", sourceChildZids: [] });
        continue;
      }
      if (
        gateReorg &&
        colorMode !== "full" &&
        !parseReorgUpdateFlag(meta?.reorgUpdate ?? meta?.reorgUpdate2)
      ) {
        skipped++;
        formResults.push({ formId: form.id, status: "skipped", sourceChildZids: [] });
        continue;
      }

      const existing = await latestInstanceForTemplate(tx, targetZid, eid, form.id);
      if (updateCorrSet && colorMode !== "full" && !existing) {
        skipped++;
        formResults.push({ formId: form.id, status: "skipped", sourceChildZids: [] });
        continue;
      }

      const sources: OkoFormInstance[] = [];
      const sourceChildZids: number[] = [];
      for (const childZid of children) {
        const inst = await latestInstanceForTemplate(tx, childZid, eid, form.id);
        if (inst) {
          sources.push(inst);
          sourceChildZids.push(childZid);
        }
      }

      if (sources.length === 0 || (requireAllChildren && sourceChildZids.length < children.length)) {
        missing.push(form.id);
        skipped++;
        formResults.push({
          formId: form.id,
          status: "skipped",
          sourceChildZids,
        });
        continue;
      }

      const summed = sumInstances(
        form.id,
        sources,
        mask,
        updateCorrSet && existing ? existing.rows : undefined
      );
      const now = new Date().toISOString();

      let rows = summed.rows;
      if (recalc) {
        rows = await recalcAggregatedRows(tx, form.id, rows);
      }

      const modeLabel =
        colorMode === "full"
          ? "свод"
          : updateCorrSet
            ? `обновл-${colorMode}`
            : reorg
              ? `реорг-${colorMode}`
              : `свод-${colorMode}`;

      const targetName = targetOrg.name;
      const instance: OkoFormInstance = {
        ...summed,
        rows,
        instanceId: existing?.instanceId ?? randomUUID(),
        zid: targetZid,
        eid,
        status: "draft",
        displayName: `${form.id} — ${targetName.slice(0, 40)} (${modeLabel})`,
        meta: {
          organization: targetName,
          enterpriseCode,
          periodStart: dateToString(period.period_start),
          periodEnd: dateToString(period.period_end),
          unit: sources[0].meta.unit ?? "тыс.руб.",
        },
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await upsertInstance(tx, instance);
      instanceIds.push(instance.instanceId);
      aggregated++;
      formResults.push({
        formId: form.id,
        status: sourceChildZids.length === children.length ? "ok" : "partial",
        sourceChildZids,
        instanceId: instance.instanceId,
      });
    }

    return {
      parentZid,
      eid,
      children,
      aggregated,
      skipped,
      missing,
      instanceIds,
      forms: formResults,
      targetZid,
    };
  });
}

async function recalcAggregatedRows(
  db: OkoDb,
  formId: string,
  rows: OkoFormInstance["rows"]
): Promise<OkoFormInstance["rows"]> {
  try {
    const { loadFormSchema } = await import("./forms.js");
    const schema = await loadFormSchema(db, formId);
    if (!schema) return rows;

    const modernPath = path.join(ROOT, "portal", "public", "data", "recalc-rules.json");
    const legacyPath = path.join(ROOT, "portal", "public", "data", "row-formulas.json");
    let modern: RecalcRule[] | undefined;
    let legacy: RowFormula[] | undefined;
    if (fs.existsSync(modernPath)) {
      const data = JSON.parse(fs.readFileSync(modernPath, "utf-8")) as {
        byForm?: Record<string, RecalcRule[]>;
      };
      modern = data.byForm?.[formId];
    }
    if (fs.existsSync(legacyPath)) {
      const data = JSON.parse(fs.readFileSync(legacyPath, "utf-8")) as {
        byForm?: Record<string, RowFormula[]>;
      };
      legacy = data.byForm?.[formId];
    }
    const rules = mergeRules(modern, legacy);
    if (rules.length === 0) return rows;
    return recalcRowsFull(schema as never, rows, rules);
  } catch {
    return rows;
  }
}

export type CorrSetKind = "correct" | "mirror";

export interface AggCorrSetDto {
  id: number;
  parentZid: number;
  corrZid: number;
  kind: CorrSetKind;
  sourceEid: number;
  label: string | null;
  corrName?: string | null;
  corrCode?: string | null;
  formCount?: number;
}

export interface CreateCorrSetResult {
  set: AggCorrSetDto;
  formsCreated: number;
  formsMirrored: number;
}

/** List Access CreateCorrectReorg / набор-зеркало registrations for a parent. */
export async function listCorrSets(db: OkoDb, parentZid: number): Promise<AggCorrSetDto[]> {
  const rows = (await db
    .prepare(
      `SELECT id, parent_zid, corr_zid, kind, source_eid, label
       FROM agg_corr_sets WHERE parent_zid = ? ORDER BY id`
    )
    .all(parentZid)) as Array<{
    id: number;
    parent_zid: number;
    corr_zid: number;
    kind: string;
    source_eid: number;
    label: string | null;
  }>;

  const out: AggCorrSetDto[] = [];
  for (const r of rows) {
    const formCount = (
      (await db
        .prepare(
          `SELECT COUNT(DISTINCT template_id) AS c FROM form_instances
           WHERE zid = ? AND eid = ?`
        )
        .get(r.corr_zid, r.source_eid)) as { c: number }
    ).c;
    out.push({
      id: r.id,
      parentZid: r.parent_zid,
      corrZid: r.corr_zid,
      kind: r.kind === "mirror" ? "mirror" : "correct",
      sourceEid: r.source_eid,
      label: r.label,
      corrName: await orgName(db, r.corr_zid),
      corrCode: await orgCode(db, r.corr_zid),
      formCount,
    });
  }
  return out;
}

/**
 * Access CreateCorrectReorg: new org (k_zid) under parent + empty or mirrored forms
 * on the same period eid (shared campaign).
 */
export async function createCorrectReorg(
  db: OkoDb,
  input: {
    parentZid: number;
    eid: number;
    kind?: CorrSetKind;
    label?: string;
  }
): Promise<CreateCorrSetResult> {
  const kind: CorrSetKind = input.kind === "mirror" ? "mirror" : "correct";
  const { parent, period, enterpriseCode } = await loadParentContext(
    db,
    input.parentZid,
    input.eid
  );
  const parentCode = (await orgCode(db, input.parentZid)) ?? String(input.parentZid);
  const suffix = kind === "mirror" ? "Z" : "K";
  const label =
    input.label?.trim() ||
    (kind === "mirror"
      ? `${parent.name} — набор-зеркало`
      : `${parent.name} — корректирующий набор`);

  const { createOrganization } = await import("./packages.js");
  const { loadFormSchema, exportCatalog } = await import("./forms.js");
  const { saveInstanceCells } = await import("./instances.js");
  const catalog = await exportCatalog(db);

  return db.transaction(async (tx) => {
    const org = await createOrganization(tx, {
      name: label,
      code: `${parentCode}-${suffix}`,
      parentZid: input.parentZid,
    });

    const now = new Date().toISOString();
    let formsCreated = 0;
    let formsMirrored = 0;

    for (const form of catalog.forms) {
      const existingCorr = await latestInstanceForTemplate(tx, org.zid, input.eid, form.id);
      if (existingCorr) continue;

      if (kind === "mirror") {
        const src = await latestInstanceForTemplate(tx, input.parentZid, input.eid, form.id);
        if (src) {
          const clone: OkoFormInstance = {
            ...src,
            instanceId: randomUUID(),
            zid: org.zid,
            eid: input.eid,
            displayName: `${form.id} — ${label.slice(0, 40)} (зеркало)`,
            meta: {
              ...src.meta,
              organization: label,
              enterpriseCode,
              periodStart: dateToString(period.period_start),
              periodEnd: dateToString(period.period_end),
            },
            status: "draft",
            createdAt: now,
            updatedAt: now,
          };
          await upsertInstance(tx, clone);
          formsMirrored++;
          continue;
        }
      }

      const schema = await loadFormSchema(tx, form.id);
      if (!schema) continue;
      const signatures: Record<string, string> = {};
      for (const name of schema.signatures) signatures[name] = "";
      const rows =
        schema.rows.length > 0
          ? schema.rows.map((t) => {
              const row: Record<string, string | number> = {};
              for (const col of schema.columns) row[col.key] = "";
              if (t.num) row.num = t.num;
              if (t.code) row.code = t.code;
              if (t.name) row.name = t.name;
              return row;
            })
          : [
              (() => {
                const row: Record<string, string | number> = {};
                for (const col of schema.columns) row[col.key] = "";
                return row;
              })(),
            ];

      const inst: OkoFormInstance = {
        instanceId: randomUUID(),
        templateId: schema.id,
        templateTitle: schema.title,
        displayName: `${schema.id} — ${label.slice(0, 40)}`,
        zid: org.zid,
        eid: input.eid,
        meta: {
          organization: label,
          enterpriseCode,
          periodStart: dateToString(period.period_start),
          periodEnd: dateToString(period.period_end),
          unit: schema.meta.unit || "тыс.руб.",
        },
        rows,
        signatures,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };
      await saveInstanceCells(tx, inst);
      formsCreated++;
    }

    await tx
      .prepare(
        `INSERT INTO agg_corr_sets (parent_zid, corr_zid, kind, source_eid, label)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.parentZid, org.zid, kind, input.eid, label);

    const sets = await listCorrSets(tx, input.parentZid);
    const set = sets.find((s) => s.corrZid === org.zid);
    if (!set) throw new Error("Не удалось зарегистрировать корректирующий набор");

    return { set, formsCreated, formsMirrored };
  });
}

export async function deleteCorrSet(db: OkoDb, id: number): Promise<boolean> {
  const r = await db.prepare("DELETE FROM agg_corr_sets WHERE id = ?").run(id);
  return r.changes > 0;
}

/**
 * Access AggrSetAccount structural check on target package (N01_01/N01_02 ↔ N01_1).
 */
export async function validatePackageAccountRows(
  db: OkoDb,
  options: {
    parentZid: number;
    eid: number;
    targetZid?: number;
    forms?: AccFormId[];
  }
): Promise<AggrAccountValidation & { zid: number; eid: number }> {
  const zid = options.targetZid ?? options.parentZid;
  const formIds = options.forms?.length
    ? options.forms
    : ([...ACC_FORM_IDS] as AccFormId[]);

  const bal = await latestInstanceForTemplate(db, zid, options.eid, BALANCE_FORM_ID);
  const forms: Array<{ formId: AccFormId; accRows: OkoFormInstance["rows"] }> = [];
  for (const formId of formIds) {
    const inst = await latestInstanceForTemplate(db, zid, options.eid, formId);
    forms.push({ formId, accRows: inst?.rows ?? [] });
  }

  const result = validateAggrAccountPackage({
    forms,
    balRows: bal?.rows ?? null,
  });
  return { ...result, zid, eid: options.eid };
}

function loadUncheckingRows(): string[] {
  try {
    const refsPath = path.join(ROOT, "portal", "public", "data", "rash-refs.json");
    if (!fs.existsSync(refsPath)) return [...DEFAULT_UNCHECKING_ROWS];
    const data = JSON.parse(fs.readFileSync(refsPath, "utf-8")) as {
      byName?: Record<string, Array<{ value?: string; kod?: string }>>;
    };
    const items = data.byName?.a__UncheckingRows ?? [];
    if (!items.length) return [...DEFAULT_UNCHECKING_ROWS];
    return items.map((i) => String(i.value ?? i.kod ?? "").trim()).filter(Boolean);
  } catch {
    return [...DEFAULT_UNCHECKING_ROWS];
  }
}

/** Access CheckRelationsAccRows: N01_02 sums vs N01_1.H */
export async function checkPackageRelationsAccRows(
  db: OkoDb,
  options: { parentZid: number; eid: number; targetZid?: number; tolerance?: number }
): Promise<RelationsAccRowsResult & { zid: number; eid: number }> {
  const zid = options.targetZid ?? options.parentZid;
  const acc = await latestInstanceForTemplate(db, zid, options.eid, FILL_BALANCE_SOURCE_FORM);
  const bal = await latestInstanceForTemplate(db, zid, options.eid, BALANCE_FORM_ID);
  const result = checkRelationsAccRows({
    accRows: acc?.rows ?? [],
    balRows: bal?.rows ?? [],
    uncheckingRows: loadUncheckingRows(),
    tolerance: options.tolerance,
  });
  return { ...result, zid, eid: options.eid };
}

/** Access FillBalanceRows: fill N01_1.H from N01_02 and persist. */
export async function fillPackageBalanceRows(
  db: OkoDb,
  options: {
    parentZid: number;
    eid: number;
    targetZid?: number;
    mode?: "ifEmpty" | "overwrite";
  }
): Promise<FillBalanceRowsResult & { zid: number; eid: number; instanceId?: string }> {
  const zid = options.targetZid ?? options.parentZid;
  const acc = await latestInstanceForTemplate(db, zid, options.eid, FILL_BALANCE_SOURCE_FORM);
  const bal = await latestInstanceForTemplate(db, zid, options.eid, BALANCE_FORM_ID);
  if (!bal) {
    return {
      ok: false,
      message: `Нет формы ${BALANCE_FORM_ID} для заполнения баланса`,
      mode: options.mode ?? "ifEmpty",
      updated: 0,
      skippedNonEmpty: 0,
      skippedUnchecking: 0,
      rows: [],
      zid,
      eid: options.eid,
    };
  }

  const filled = fillBalanceRows({
    accRows: acc?.rows ?? [],
    balRows: bal.rows,
    mode: options.mode ?? "ifEmpty",
    uncheckingRows: loadUncheckingRows(),
  });

  if (!filled.ok) {
    return { ...filled, zid, eid: options.eid, instanceId: bal.instanceId };
  }

  const now = new Date().toISOString();
  const next: OkoFormInstance = {
    ...bal,
    rows: filled.rows,
    updatedAt: now,
  };
  await upsertInstance(db, next);
  return { ...filled, zid, eid: options.eid, instanceId: next.instanceId };
}
