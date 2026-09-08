import { randomUUID } from "node:crypto";
import type { OkoDb } from "./oko-db.js";
import { dateToString } from "./dbValues.js";
import {
  buildInitialRowsFromSchema,
  exportCatalog,
  loadFormSchemas,
  type FormSchemaDto,
} from "./forms.js";
import {
  deleteInstancesForPackages,
  isLazyCellsEnabled,
  saveInstanceCells,
  saveInstanceHeadersBulk,
} from "./instances.js";
import {
  assertPeriodWritable,
  ensurePeriodFormSet,
  listChildOrganizations,
  normalizePeriodStatus,
  replacePeriodFormSet,
} from "./periodLifecycle.js";
import { saveRashEntries } from "./rash-data.js";
import { withTiming } from "./perf.js";
import type { OkoFormInstance } from "./types.js";
import {
  createPeriod,
  quarterDateRange,
  quarterPeriodName,
  resolvePackageContext,
} from "./packageOrganizations.js";
import {
  newPackageGuid,
  type BulkDeletePackageItem,
  type BulkDeletePackageItemResult,
  type BulkDeletePackageResult,
  type BulkExportManifestEntry,
  type BulkExportPackageItem,
  type BulkExportPackagesResult,
  type CreatePackageResult,
  type DeletePackageResult,
  type ImportPackageResult,
  type PackageConstructInput,
  type PackageConstructResult,
  type PackageConstructRowResult,
  type ReportPackageInput,
} from "./packageTypes.js";

function buildInitialRows(schema: FormSchemaDto): Record<string, string | number>[] {
  return buildInitialRowsFromSchema(schema);
}

function defaultDisplayName(
  templateId: string,
  templateTitle: string,
  organization: string
): string {
  if (organization.trim()) {
    return `${templateId} — ${organization.trim().slice(0, 40)}`;
  }
  const shortTitle =
    templateTitle.length > 45 ? templateTitle.slice(0, 45) + "…" : templateTitle;
  return `${templateId} — ${shortTitle}`;
}

async function existingTemplatesForPackage(
  db: OkoDb,
  zid: number,
  eid: number
): Promise<Set<string>> {
  const rows = (await db
    .prepare(`SELECT template_id FROM form_instances WHERE zid = ? AND eid = ?`)
    .all(zid, eid)) as Array<{ template_id: string }>;
  return new Set(rows.map((r) => r.template_id));
}

function pairsWhereSql(
  pairs: Array<{ zid: number; eid: number }>,
  alias?: string
): {
  where: string;
  params: unknown[];
} {
  const z = alias ? `${alias}.zid` : "zid";
  const e = alias ? `${alias}.eid` : "eid";
  const where = pairs.map(() => `(${z} = ? AND ${e} = ?)`).join(" OR ");
  const params = pairs.flatMap((p) => [p.zid, p.eid]);
  return { where, params };
}

async function listPackageInstanceIds(
  db: OkoDb,
  zid: number,
  eid: number
): Promise<string[]> {
  const normalized = (await db
    .prepare("SELECT instance_id FROM form_instances WHERE zid = ? AND eid = ?")
    .all(zid, eid)) as Array<{ instance_id: string }>;
  return normalized.map((row) => row.instance_id);
}

async function purgePackageRelationsMany(
  db: OkoDb,
  pairs: Array<{ zid: number; eid: number }>,
  opts?: { removeFormSet?: boolean }
): Promise<void> {
  if (!pairs.length) return;
  const PAIR_CHUNK = 80;
  for (let offset = 0; offset < pairs.length; offset += PAIR_CHUNK) {
    const chunk = pairs.slice(offset, offset + PAIR_CHUNK);
    const { where, params } = pairsWhereSql(chunk);
    const eids = [...new Set(chunk.map((p) => p.eid))];
    const eidPlaceholders = eids.map(() => "?").join(",");

    await tryDelete(db, `DELETE FROM business_processes WHERE ${where}`, ...params);
    if (opts?.removeFormSet) {
      await tryDelete(
        db,
        `DELETE FROM period_form_set WHERE eid IN (${eidPlaceholders})`,
        ...eids
      );
    }
    await tryDelete(db, `DELETE FROM check_explanations WHERE ${where}`, ...params);
    await tryDelete(db, `DELETE FROM check_run_journal WHERE ${where}`, ...params);
    await tryDelete(
      db,
      `DELETE FROM agg_run_locks WHERE ${chunk.map(() => "(parent_zid = ? AND eid = ?)").join(" OR ")}`,
      ...params
    );
    await tryDelete(
      db,
      `DELETE FROM agg_corr_sets WHERE source_eid IN (${eidPlaceholders})`,
      ...eids
    );
    await tryDelete(
      db,
      `DELETE FROM svod_results WHERE eid IN (${eidPlaceholders})`,
      ...eids
    );
    await tryDelete(
      db,
      `DELETE FROM svod_definitions WHERE eid IN (${eidPlaceholders})`,
      ...eids
    );
    await tryDelete(
      db,
      `DELETE FROM package_inbox WHERE ${chunk
        .map(() => "(pkg_zid = ? AND pkg_eid = ?) OR (target_zid = ? AND target_eid = ?)")
        .join(" OR ")}`,
      ...chunk.flatMap((p) => [p.zid, p.eid, p.zid, p.eid])
    );
    await tryDelete(db, `DELETE FROM do_transport_inbox WHERE ${where}`, ...params);
    await tryDelete(
      db,
      `DELETE FROM transfer_batches WHERE ${chunk
        .map(
          () =>
            "(source_zid = ? AND source_eid = ?) OR (target_zid = ? AND target_eid = ?)"
        )
        .join(" OR ")}`,
      ...chunk.flatMap((p) => [p.zid, p.eid, p.zid, p.eid])
    );
    await tryDelete(db, `DELETE FROM package_exchange WHERE ${where}`, ...params);

    try {
      const packageIds = (await db
        .prepare(
          `SELECT package_id FROM periods WHERE ${where} AND package_id IS NOT NULL AND btrim(package_id) <> ''`
        )
        .all(...params)) as Array<{ package_id: string }>;
      for (const row of packageIds) {
        if (!row.package_id) continue;
        await tryDelete(
          db,
          `DELETE FROM package_exchange WHERE package_id = ?`,
          row.package_id
        );
      }
    } catch {
      /* best-effort */
    }
  }
}

/** Best-effort DELETE: skip if table/columns are missing (older DBs / optional PSD tables). */
async function tryDelete(
  db: OkoDb,
  sql: string,
  ...params: unknown[]
): Promise<void> {
  try {
    await db.prepare(sql).run(...params);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      /does not exist|no such table|undefined.?column|column .+ does not exist/i.test(
        msg
      )
    ) {
      return;
    }
    throw e;
  }
}

/**
 * Remove package-scoped relations for zid × eid.
 * Keeps the periods row and (by default) period_form_set so the period stays open.
 */
async function purgePackageRelations(
  db: OkoDb,
  zid: number,
  eid: number,
  opts?: { removeFormSet?: boolean }
): Promise<void> {
  await purgePackageRelationsMany(db, [{ zid, eid }], opts);
}

/**
 * Delete a report package completely: forms, BP, exchange, and the periods row.
 * No empty period shell remains in the period list; re-open it to create a new package.
 */
export async function deleteReportPackage(
  db: OkoDb,
  zid: number,
  eid: number
): Promise<DeletePackageResult> {
  const period = (await db
    .prepare("SELECT 1 FROM periods WHERE eid = ? AND zid = ?")
    .get(eid, zid)) as { 1: number } | undefined;
  if (!period) throw new Error("Period not found");

  let deletedInstances = 0;
  await db.transaction(async (tx) => {
    deletedInstances = await deleteInstancesForPackages(tx, [{ zid, eid }]);
    try {
      await purgePackageRelations(tx, zid, eid, { removeFormSet: true });
    } catch (e) {
      console.warn(
        "[deleteReportPackage] purgePackageRelations:",
        e instanceof Error ? e.message : e
      );
    }
    await tx
      .prepare("DELETE FROM periods WHERE eid = ? AND zid = ?")
      .run(eid, zid);
  });

  return { deletedInstances, periodRemoved: true };
}

/** Soft cap per HTTP request; portal clients chunk larger selections. */
const BULK_DELETE_MAX = 500;

export async function deleteReportPackagesBulk(
  db: OkoDb,
  items: BulkDeletePackageItem[]
): Promise<BulkDeletePackageResult> {
  return withTiming(
    "packages.bulkDelete",
    async () => {
      if (!Array.isArray(items) || items.length === 0) {
        const err = new Error("Укажите хотя бы один комплект");
        (err as Error & { status: number }).status = 400;
        throw err;
      }
      if (items.length > BULK_DELETE_MAX) {
        const err = new Error(
          `За один раз можно удалить не более ${BULK_DELETE_MAX} комплектов`
        );
        (err as Error & { status: number }).status = 400;
        throw err;
      }

      const seen = new Set<string>();
      const unique: BulkDeletePackageItem[] = [];
      for (const raw of items) {
        const zid = Number(raw?.zid);
        const eid = Number(raw?.eid);
        if (!Number.isFinite(zid) || !Number.isFinite(eid) || zid <= 0 || eid <= 0) {
          continue;
        }
        const key = `${zid}:${eid}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push({ zid, eid });
      }
      if (unique.length === 0) {
        const err = new Error("Нет корректных пар zid/eid");
        (err as Error & { status: number }).status = 400;
        throw err;
      }

      const existing = new Set<string>();
      {
        const PAIR_CHUNK = 80;
        for (let offset = 0; offset < unique.length; offset += PAIR_CHUNK) {
          const chunk = unique.slice(offset, offset + PAIR_CHUNK);
          const { where, params } = pairsWhereSql(chunk);
          const rows = (await db
            .prepare(`SELECT zid, eid FROM periods WHERE ${where}`)
            .all(...params)) as Array<{ zid: number; eid: number }>;
          for (const r of rows) existing.add(`${r.zid}:${r.eid}`);
        }
      }

      const toDelete = unique.filter((p) => existing.has(`${p.zid}:${p.eid}`));
      const results: BulkDeletePackageItemResult[] = [];
      let deletedInstances = 0;

      if (toDelete.length > 0) {
        await db.transaction(async (tx) => {
          deletedInstances = await deleteInstancesForPackages(tx, toDelete);
          try {
            await purgePackageRelationsMany(tx, toDelete, { removeFormSet: true });
          } catch (e) {
            console.warn(
              "[deleteReportPackagesBulk] purgePackageRelationsMany:",
              e instanceof Error ? e.message : e
            );
          }
          const PAIR_CHUNK = 80;
          for (let offset = 0; offset < toDelete.length; offset += PAIR_CHUNK) {
            const chunk = toDelete.slice(offset, offset + PAIR_CHUNK);
            const { where, params } = pairsWhereSql(chunk);
            await tx.prepare(`DELETE FROM periods WHERE ${where}`).run(...params);
          }
        });
      }

      for (const item of unique) {
        if (existing.has(`${item.zid}:${item.eid}`)) {
          results.push({ zid: item.zid, eid: item.eid, ok: true });
        } else {
          results.push({
            zid: item.zid,
            eid: item.eid,
            ok: false,
            error: "Period not found",
          });
        }
      }

      return {
        deleted: toDelete.length,
        failed: unique.length - toDelete.length,
        deletedInstances,
        results,
      };
    },
    () => ({ items: items?.length ?? 0 })
  );
}

const BULK_EXPORT_MAX = 200;

function sanitizePackageFilePart(value: string, max = 40): string {
  const cleaned = value
    .replace(/[^\wа-яА-ЯёЁ.-]+/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return (cleaned || "oko").slice(0, max);
}

async function buildExportPackageForKey(
  db: OkoDb,
  zid: number,
  eid: number
): Promise<{
  json: string;
  filename: string;
  entry: BulkExportManifestEntry;
}> {
  const { listInstanceSummaries, loadInstance } = await import("./instances.js");
  const { normalizePackageKind } = await import("./businessProcessTypes.js");

  const period = (await db
    .prepare(
      `SELECT p.name, p.period_start, p.period_end, p.package_kind, p.package_id,
              o.name AS org_name, o.code AS org_code
       FROM periods p
       JOIN organizations o ON o.zid = p.zid
       WHERE p.eid = ? AND p.zid = ?`
    )
    .get(eid, zid)) as
    | {
        name: string;
        period_start: string | null;
        period_end: string | null;
        package_kind: string | null;
        package_id: string | null;
        org_name: string;
        org_code: string | null;
      }
    | undefined;
  if (!period) throw new Error("Период не найден");

  let packageId = period.package_id?.trim() || "";
  if (!packageId) {
    packageId = newPackageGuid();
    await db
      .prepare(`UPDATE periods SET package_id = ? WHERE zid = ? AND eid = ?`)
      .run(packageId, zid, eid);
  }

  const summaries = await listInstanceSummaries(db, { zid, eid });
  const instances: OkoFormInstance[] = [];
  let submitted = 0;
  for (const s of summaries) {
    const inst = await loadInstance(db, s.instanceId);
    if (!inst) continue;
    instances.push({ ...inst, zid, eid });
    if (s.status === "submitted") submitted++;
  }

  const packageKind = normalizePackageKind(period.package_kind);
  const orgPart = sanitizePackageFilePart(
    period.org_code || period.org_name || `zid${zid}`
  );
  const periodPart = sanitizePackageFilePart(period.name || `eid${eid}`, 30);
  const filename = `oko_package_${orgPart}_${periodPart}_z${zid}_e${eid}.json`;

  const pkg = {
    version: "1.3",
    exportedAt: new Date().toISOString(),
    organization: period.org_name,
    periodStart: dateToString(period.period_start),
    periodEnd: dateToString(period.period_end),
    zid,
    eid,
    packageId,
    packageKind,
    instanceCount: instances.length,
    instances,
  };

  return {
    json: JSON.stringify(pkg, null, 2),
    filename,
    entry: {
      zid,
      eid,
      organizationName: period.org_name,
      organizationCode: period.org_code,
      periodName: period.name,
      packageKind,
      formCount: instances.length,
      filled: instances.length,
      submitted,
      filename,
      ok: true,
    },
  };
}

export async function exportReportPackagesBulk(
  db: OkoDb,
  items: BulkExportPackageItem[]
): Promise<BulkExportPackagesResult> {
  const { zipStoreFiles } = await import("./zipStore.js");

  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error("Укажите хотя бы один комплект");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  if (items.length > BULK_EXPORT_MAX) {
    const err = new Error(`За один раз можно выгрузить не более ${BULK_EXPORT_MAX} комплектов`);
    (err as Error & { status: number }).status = 400;
    throw err;
  }

  const seen = new Set<string>();
  const unique: BulkExportPackageItem[] = [];
  for (const raw of items) {
    const zid = Number(raw?.zid);
    const eid = Number(raw?.eid);
    if (!Number.isFinite(zid) || !Number.isFinite(eid) || zid <= 0 || eid <= 0) continue;
    const key = `${zid}:${eid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ zid, eid });
  }
  if (unique.length === 0) {
    const err = new Error("Нет корректных пар zid/eid");
    (err as Error & { status: number }).status = 400;
    throw err;
  }

  const exportedAt = new Date().toISOString();
  const files: Array<{ name: string; data: string }> = [];
  const manifestPackages: BulkExportManifestEntry[] = [];
  let exported = 0;
  let failed = 0;
  const usedNames = new Set<string>();

  for (const item of unique) {
    try {
      const built = await buildExportPackageForKey(db, item.zid, item.eid);
      let name = built.filename;
      if (usedNames.has(name)) {
        name = name.replace(/\.json$/i, `_${exported + failed + 1}.json`);
      }
      usedNames.add(name);
      files.push({ name, data: built.json });
      manifestPackages.push({ ...built.entry, filename: name });
      exported += 1;
      try {
        const { touchPackageExported } = await import("./packageExchange.js");
        const ctx = await resolvePackageContext(db, {
          zid: item.zid,
          eid: item.eid,
        });
        if (ctx?.packageId) {
          await touchPackageExported(
            db,
            ctx.packageId,
            item.zid,
            item.eid,
            exportedAt
          );
        }
      } catch {
        /* exchange mark is best-effort */
      }
    } catch (e) {
      failed += 1;
      manifestPackages.push({
        zid: item.zid,
        eid: item.eid,
        organizationName: "",
        organizationCode: null,
        periodName: "",
        packageKind: "OKO",
        formCount: 0,
        filled: 0,
        submitted: 0,
        filename: "",
        ok: false,
        error: e instanceof Error ? e.message : "Ошибка выгрузки",
      });
    }
  }

  if (exported === 0) {
    const err = new Error(
      failed > 0
        ? `Не удалось выгрузить ни одного комплекта (${failed} ошибок)`
        : "Нет комплектов для выгрузки"
    );
    (err as Error & { status: number }).status = 400;
    throw err;
  }

  const manifest = {
    exportedAt,
    packages: manifestPackages,
  };
  files.unshift({
    name: "manifest.json",
    data: JSON.stringify(manifest, null, 2),
  });

  const zip = zipStoreFiles(files);
  const day = exportedAt.slice(0, 10);
  const filename = `oko_packages_${day}_${exported}orgs.zip`;
  return { zip, filename, exported, failed, manifest };
}

export async function createReportPackage(
  db: OkoDb,
  zid: number,
  eid: number,
  opts?: {
    onProgress?: (progress: number, message?: string) => void | Promise<void>;
    /** If set — create only these templates (subset). */
    formIds?: string[];
    /** Preloaded schemas (skip loadFormSchemas). */
    schemas?: Map<string, FormSchemaDto>;
  }
): Promise<CreatePackageResult> {
  let created = 0;
  let skipped = 0;
  let total = 0;
  let instances = 0;

  return withTiming(
    "packages.create",
    async () => {
      await assertPeriodWritable(db, eid, zid);
      await opts?.onProgress?.(5, "Проверка периода");

      const org = (await db
        .prepare("SELECT name FROM organizations WHERE zid = ?")
        .get(zid)) as { name: string } | undefined;
      if (!org) throw new Error("Organization not found");

      const period = (await db
        .prepare("SELECT name, period_start, period_end FROM periods WHERE eid = ? AND zid = ?")
        .get(eid, zid)) as
        | { name: string; period_start: string | null; period_end: string | null }
        | undefined;
      if (!period) throw new Error("Period not found");

      let formSet = await ensurePeriodFormSet(db, eid);
      if (opts?.formIds?.length) {
        const allow = new Set(
          opts.formIds.map((id) => String(id).trim()).filter(Boolean)
        );
        formSet = formSet.filter((entry) => allow.has(entry.formId));
      }
      const existing = await existingTemplatesForPackage(db, zid, eid);
      const now = new Date().toISOString();
      const instanceIds: string[] = [];
      created = 0;
      skipped = 0;
      total = formSet.length;

      const enterpriseCode = await (async () => {
        const row = (await db
          .prepare("SELECT value FROM app_settings WHERE key = 'globalMeta'")
          .get()) as { value: string } | undefined;
        if (!row) return "1@1";
        try {
          const meta = JSON.parse(row.value) as { enterpriseCode?: string };
          return meta.enterpriseCode ?? "1@1";
        } catch {
          return "1@1";
        }
      })();

      const toCreate = formSet.filter((entry) => !existing.has(entry.formId));
      skipped += formSet.length - toCreate.length;

      await opts?.onProgress?.(15, `Загрузка схем (${toCreate.length})`);
      const missingSchemaIds = toCreate
        .map((e) => e.formId)
        .filter((id) => !opts?.schemas?.has(id));
      const loaded =
        missingSchemaIds.length > 0
          ? await loadFormSchemas(db, missingSchemaIds)
          : new Map<string, FormSchemaDto>();
      const schemas = new Map<string, FormSchemaDto>(opts?.schemas ?? []);
      for (const [id, schema] of loaded) schemas.set(id, schema);

      const lazy = isLazyCellsEnabled();
      const built: OkoFormInstance[] = [];
      for (const entry of toCreate) {
        const schema = schemas.get(entry.formId);
        if (!schema) {
          skipped++;
          continue;
        }

        const signatures: Record<string, string> = {};
        for (const name of schema.signatures) signatures[name] = "";

        const schemaVersion = entry.schemaVersion || schema.schemaVersion || 1;
        built.push({
          instanceId: randomUUID(),
          templateId: schema.id,
          templateTitle: schema.title,
          displayName: defaultDisplayName(schema.id, schema.title, org.name),
          zid,
          eid,
          templateSchemaVersion: schemaVersion,
          meta: {
            organization: org.name,
            enterpriseCode,
            periodStart: dateToString(period.period_start),
            periodEnd: dateToString(period.period_end),
            unit: schema.meta.unit || "тыс.руб.",
          },
          rows: lazy ? [] : buildInitialRows(schema),
          signatures,
          status: "draft",
          createdAt: now,
          updatedAt: now,
        });
      }

      await db.transaction(async (tx) => {
        if (lazy) {
          await saveInstanceHeadersBulk(tx, built);
          for (let i = 0; i < built.length; i++) {
            instanceIds.push(built[i]!.instanceId);
            created++;
            if (built.length > 0 && (i === 0 || i === built.length - 1 || (i + 1) % 25 === 0)) {
              const pct = 15 + Math.round(((i + 1) / built.length) * 80);
              await opts?.onProgress?.(pct, `Формы: ${i + 1}/${built.length}`);
            }
          }
        } else {
          let i = 0;
          for (const inst of built) {
            await saveInstanceCells(tx, inst, { materializeCells: true });
            instanceIds.push(inst.instanceId);
            created++;
            i++;
            if (built.length > 0 && (i === 1 || i === built.length || i % 5 === 0)) {
              const pct = 15 + Math.round((i / built.length) * 80);
              await opts?.onProgress?.(pct, `Формы: ${i}/${built.length}`);
            }
          }
        }
      });

      instances = instanceIds.length;
      await opts?.onProgress?.(100, "Готово");
      return { created, skipped, total, instanceIds };
    },
    () => ({ zid, eid, created, skipped, total, instances })
  );
}

export async function distributePackagesToChildren(
  db: OkoDb,
  parentZid: number,
  sourceEid: number,
  opts?: {
    createEmptyPackages?: boolean;
    /** Explicit target orgs; if omitted — children by parent_zid. */
    childZids?: number[];
    /** If no children: use all other organizations. */
    fallbackAllOthers?: boolean;
  }
): Promise<{
  parentZid: number;
  sourceEid: number;
  createdPeriods: number;
  createdPackages: number;
  children: Array<{
    zid: number;
    name: string;
    eid: number;
    created: number;
    skipped: number;
  }>;
}> {
  const source = (await db
    .prepare(
      `SELECT name, period_start, period_end, quarter, year, methodology_release_id
       FROM periods WHERE zid = ? AND eid = ?`
    )
    .get(parentZid, sourceEid)) as
    | {
        name: string;
        period_start: string | null;
        period_end: string | null;
        quarter: number | null;
        year: number | null;
        methodology_release_id: string | null;
      }
    | undefined;
  if (!source) throw new Error("Source period not found");

  const sourceForms = await ensurePeriodFormSet(db, sourceEid);

  let children: Array<{ zid: number; name: string }> = [];
  if (opts?.childZids?.length) {
    const placeholders = opts.childZids.map(() => "?").join(",");
    children = (await db
      .prepare(
        `SELECT zid, name FROM organizations
         WHERE zid IN (${placeholders}) AND zid <> ?
         ORDER BY name`
      )
      .all(...opts.childZids, parentZid)) as Array<{ zid: number; name: string }>;
  } else {
    children = await listChildOrganizations(db, parentZid);
    if (children.length === 0 && opts?.fallbackAllOthers) {
      children = (await db
        .prepare(
          `SELECT zid, name FROM organizations WHERE zid <> ? ORDER BY name`
        )
        .all(parentZid)) as Array<{ zid: number; name: string }>;
    }
  }

  if (children.length === 0) {
    const err = new Error(
      "Нет организаций для раздачи: укажите parent_zid у дочерних или раздайте всем остальным org"
    );
    (err as Error & { status: number }).status = 400;
    throw err;
  }

  const result: Array<{
    zid: number;
    name: string;
    eid: number;
    created: number;
    skipped: number;
  }> = [];
  let createdPackages = 0;

  for (const child of children) {
    const period = await createPeriod(db, {
      zid: child.zid,
      name: source.name,
      periodStart: dateToString(source.period_start) || undefined,
      periodEnd: dateToString(source.period_end) || undefined,
      quarter: source.quarter ?? undefined,
      year: source.year ?? undefined,
      methodologyReleaseId: source.methodology_release_id,
    });
    await db.prepare("DELETE FROM period_form_set WHERE eid = ?").run(period.eid);
    const ins = db.prepare(
      `INSERT INTO period_form_set (eid, form_id, schema_version) VALUES (?, ?, ?)`
    );
    for (const f of sourceForms) {
      await ins.run(period.eid, f.formId, f.schemaVersion);
    }

    let created = 0;
    let skipped = 0;
    if (opts?.createEmptyPackages !== false) {
      const pkg = await createReportPackage(db, child.zid, period.eid);
      created = pkg.created;
      skipped = pkg.skipped;
      createdPackages++;
    }
    result.push({
      zid: child.zid,
      name: child.name,
      eid: period.eid,
      created,
      skipped,
    });
  }

  return {
    parentZid,
    sourceEid,
    createdPeriods: result.length,
    createdPackages,
    children: result,
  };
}

async function resolveConstructFormIds(
  db: OkoDb,
  forms: PackageConstructInput["forms"]
): Promise<string[]> {
  const catalog = await exportCatalog(db);
  const active = catalog.forms
    .filter((f) => !(f as { archived?: boolean }).archived)
    .map((f) => f.id);
  if (forms.mode !== "selected") return active;
  const requested = [...new Set((forms.formIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
  if (!requested.length) {
    const err = new Error("Выберите хотя бы одну форму");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  const allow = new Set(active);
  const selected = requested.filter((id) => allow.has(id));
  if (!selected.length) {
    const err = new Error("Выбранные формы не найдены в каталоге");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  return selected;
}

function constructPeriodLabel(period: PackageConstructInput["period"]): string {
  return String(period.name ?? "").trim() || "Период";
}

function normalizeConstructInput(input: PackageConstructInput): PackageConstructInput {
  const rawQuarter = input.period?.quarter != null ? Number(input.period.quarter) : NaN;
  const rawYear = input.period?.year != null ? Number(input.period.year) : NaN;
  const hasQuarter =
    Number.isFinite(rawQuarter) &&
    rawQuarter >= 1 &&
    rawQuarter <= 4 &&
    Number.isFinite(rawYear) &&
    rawYear >= 2000 &&
    rawYear <= 2100;

  let name = String(input.period?.name ?? "").trim();
  let periodStart = input.period?.periodStart;
  let periodEnd = input.period?.periodEnd;
  let quarter: number | undefined;
  let year: number | undefined;

  if (hasQuarter) {
    quarter = Math.trunc(rawQuarter);
    year = Math.trunc(rawYear);
    name = quarterPeriodName(quarter, year);
    const range = quarterDateRange(quarter, year);
    periodStart = range.periodStart;
    periodEnd = range.periodEnd;
  }

  const rawEid = input.period?.eid != null ? Number(input.period.eid) : NaN;
  const eid =
    Number.isFinite(rawEid) && rawEid > 0 ? Math.trunc(rawEid) : undefined;

  if (!name && eid == null) {
    const err = new Error("Укажите квартал и год отчётного периода");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  if (!name && eid != null) {
    name = `EID ${eid}`;
  }
  const targets = (input.targets ?? [])
    .map((t) => ({ zid: Number(t.zid) }))
    .filter((t) => Number.isFinite(t.zid) && t.zid > 0);
  if (!targets.length) {
    const err = new Error("Выберите хотя бы одну организацию");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  const unique = new Map<number, { zid: number }>();
  for (const t of targets) unique.set(t.zid, t);
  return {
    mode: input.mode === "bulk" ? "bulk" : "single",
    targets: [...unique.values()],
    period: {
      eid,
      name,
      periodStart,
      periodEnd,
      quarter,
      year,
      packageKind: input.period.packageKind === "BALANCE" ? "BALANCE" : "OKO",
      reuseExisting: input.period.reuseExisting !== false,
      methodologyReleaseId: input.period.methodologyReleaseId,
      collectionUnitZid: input.period.collectionUnitZid,
    },
    forms: {
      mode: input.forms?.mode === "selected" ? "selected" : "all",
      formIds: input.forms?.formIds,
    },
    options: {
      createInstances: input.options?.createInstances !== false,
      continueOnError: input.options?.continueOnError !== false,
      allowCreatePeriod: input.options?.allowCreatePeriod === true,
    },
  };
}

async function findExistingPeriodForConstruct(
  db: OkoDb,
  zid: number,
  period: PackageConstructInput["period"],
  packageKind: "OKO" | "BALANCE"
): Promise<{
  eid: number;
  name: string;
  period_status: string | null;
  package_kind: string | null;
} | null> {
  if (period.eid != null) {
    const byEid = (await db
      .prepare(
        `SELECT eid, name, period_status, package_kind
         FROM periods
         WHERE eid = ? AND zid = ?
         LIMIT 1`
      )
      .get(period.eid, zid)) as
      | {
          eid: number;
          name: string;
          period_status: string | null;
          package_kind: string | null;
        }
      | undefined;
    if (byEid) return byEid;
  }

  if (period.quarter != null && period.year != null) {
    const byQy = (await db
      .prepare(
        `SELECT eid, name, period_status, package_kind
         FROM periods
         WHERE zid = ?
           AND quarter = ?
           AND year = ?
           AND COALESCE(package_kind, 'OKO') = ?
         ORDER BY eid DESC
         LIMIT 1`
      )
      .get(zid, period.quarter, period.year, packageKind)) as
      | {
          eid: number;
          name: string;
          period_status: string | null;
          package_kind: string | null;
        }
      | undefined;
    if (byQy) return byQy;
  }

  const name = String(period.name ?? "").trim();
  if (!name) return null;
  const row = (await db
    .prepare(
      `SELECT eid, name, period_status, package_kind
       FROM periods
       WHERE zid = ? AND name = ? AND COALESCE(package_kind, 'OKO') = ?
       ORDER BY eid DESC
       LIMIT 1`
    )
    .get(zid, name, packageKind)) as
    | {
        eid: number;
        name: string;
        period_status: string | null;
        package_kind: string | null;
      }
    | undefined;
  return row ?? null;
}

async function previewOneConstructTarget(
  db: OkoDb,
  zid: number,
  input: PackageConstructInput,
  formIds: string[]
): Promise<PackageConstructRowResult> {
  const org = (await db
    .prepare("SELECT name FROM organizations WHERE zid = ?")
    .get(zid)) as { name: string } | undefined;
  if (!org) {
    return {
      zid,
      organizationName: `Организация ${zid}`,
      periodName: constructPeriodLabel(input.period),
      status: "error",
      periodCreated: false,
      formsTotal: formIds.length,
      formsCreated: 0,
      formsSkipped: 0,
      warnings: [],
      error: "Организация не найдена",
    };
  }

  const packageKind = input.period.packageKind === "BALANCE" ? "BALANCE" : "OKO";
  const existing = await findExistingPeriodForConstruct(
    db,
    zid,
    input.period,
    packageKind
  );
  const warnings: string[] = [];
  let periodCreated = false;
  let eid: number | undefined;
  let formsSkipped = 0;
  let formsCreated = formIds.length;

  if (existing) {
    eid = Number(existing.eid);
    if (!input.period.reuseExisting) {
      return {
        zid,
        organizationName: org.name,
        eid,
        periodName: existing.name,
        status: "error",
        periodCreated: false,
        formsTotal: formIds.length,
        formsCreated: 0,
        formsSkipped: 0,
        warnings,
        error: "Период с таким названием уже существует",
      };
    }
    if (normalizePeriodStatus(existing.period_status) === "closed") {
      return {
        zid,
        organizationName: org.name,
        eid,
        periodName: existing.name,
        status: "error",
        periodCreated: false,
        formsTotal: formIds.length,
        formsCreated: 0,
        formsSkipped: 0,
        warnings,
        error: "Период закрыт — создание/дозаведение недоступно",
      };
    }
    warnings.push("Период уже есть — будут дозаведены недостающие формы");
    const existingTemplates = await existingTemplatesForPackage(db, zid, eid);
    formsSkipped = formIds.filter((id) => existingTemplates.has(id)).length;
    formsCreated = Math.max(0, formIds.length - formsSkipped);
    if (!input.options?.createInstances) {
      formsCreated = 0;
      warnings.push("Создание пустых форм отключено");
    } else if (formsCreated === 0) {
      warnings.push("Все выбранные формы уже заведены");
    }
  } else {
    if (input.options?.allowCreatePeriod !== true) {
      return {
        zid,
        organizationName: org.name,
        periodName: constructPeriodLabel(input.period),
        status: "error",
        periodCreated: false,
        formsTotal: formIds.length,
        formsCreated: 0,
        formsSkipped: 0,
        warnings,
        error: "Сначала создайте период",
      };
    }
    periodCreated = true;
    if (!input.options?.createInstances) {
      formsCreated = 0;
      warnings.push("Будет создан только период без пустых форм");
    }
  }

  return {
    zid,
    organizationName: org.name,
    eid,
    periodName: constructPeriodLabel(input.period),
    status: "ready",
    periodCreated,
    formsTotal: formIds.length,
    formsCreated,
    formsSkipped,
    warnings,
  };
}

export async function previewPackageConstruction(
  db: OkoDb,
  raw: PackageConstructInput
): Promise<PackageConstructResult> {
  const input = normalizeConstructInput(raw);
  const formIds = await resolveConstructFormIds(db, input.forms);
  const rows: PackageConstructRowResult[] = [];
  for (const t of input.targets) {
    rows.push(await previewOneConstructTarget(db, t.zid, input, formIds));
  }
  return {
    summary: {
      targets: rows.length,
      periodsCreated: rows.filter((r) => r.status === "ready" && r.periodCreated).length,
      formsCreated: rows
        .filter((r) => r.status === "ready")
        .reduce((n, r) => n + r.formsCreated, 0),
      skipped: rows.reduce((n, r) => n + r.formsSkipped, 0),
      errors: rows.filter((r) => r.status === "error").length,
    },
    rows,
  };
}

async function constructOnePackage(
  db: OkoDb,
  zid: number,
  input: PackageConstructInput,
  formIds: string[],
  schemas?: Map<string, FormSchemaDto>
): Promise<PackageConstructRowResult> {
  const org = (await db
    .prepare("SELECT name FROM organizations WHERE zid = ?")
    .get(zid)) as { name: string } | undefined;
  if (!org) {
    return {
      zid,
      organizationName: `Организация ${zid}`,
      periodName: constructPeriodLabel(input.period),
      status: "error",
      periodCreated: false,
      formsTotal: formIds.length,
      formsCreated: 0,
      formsSkipped: 0,
      warnings: [],
      error: "Организация не найдена",
    };
  }

  const packageKind = input.period.packageKind === "BALANCE" ? "BALANCE" : "OKO";
  const warnings: string[] = [];
  let eid: number | undefined;
  let periodCreated = false;

  try {
    const existing = await findExistingPeriodForConstruct(
      db,
      zid,
      input.period,
      packageKind
    );

    if (existing) {
      eid = Number(existing.eid);
      if (!input.period.reuseExisting) {
        return {
          zid,
          organizationName: org.name,
          eid,
          periodName: existing.name,
          status: "error",
          periodCreated: false,
          formsTotal: formIds.length,
          formsCreated: 0,
          formsSkipped: 0,
          warnings,
          error: "Период с таким названием уже существует",
        };
      }
      if (normalizePeriodStatus(existing.period_status) === "closed") {
        return {
          zid,
          organizationName: org.name,
          eid,
          periodName: existing.name,
          status: "error",
          periodCreated: false,
          formsTotal: formIds.length,
          formsCreated: 0,
          formsSkipped: 0,
          warnings,
          error: "Период закрыт — создание/дозаведение недоступно",
        };
      }
      warnings.push("Период уже есть — будут дозаведены недостающие формы");
    } else {
      if (input.options?.allowCreatePeriod !== true) {
        return {
          zid,
          organizationName: org.name,
          periodName: constructPeriodLabel(input.period),
          status: "error",
          periodCreated: false,
          formsTotal: formIds.length,
          formsCreated: 0,
          formsSkipped: 0,
          warnings,
          error: "Сначала создайте период",
        };
      }
      const period = await createPeriod(db, {
        zid,
        name: input.period.name!,
        periodStart: input.period.periodStart,
        periodEnd: input.period.periodEnd,
        quarter: input.period.quarter,
        year: input.period.year,
        packageKind,
        methodologyReleaseId: input.period.methodologyReleaseId,
        collectionUnitZid: input.period.collectionUnitZid,
      });
      eid = period.eid;
      periodCreated = true;
    }

    if (input.forms.mode === "selected") {
      const existingTemplates = await existingTemplatesForPackage(db, zid, eid!);
      if (periodCreated || existingTemplates.size === 0) {
        await replacePeriodFormSet(db, eid!, formIds);
      }
    } else if (!periodCreated) {
      await ensurePeriodFormSet(db, eid!);
    }

    let formsCreated = 0;
    let formsSkipped = 0;
    if (input.options?.createInstances !== false) {
      const pkg = await createReportPackage(db, zid, eid!, {
        formIds: input.forms.mode === "selected" ? formIds : undefined,
        schemas,
      });
      formsCreated = pkg.created;
      formsSkipped = pkg.skipped;
    }

    return {
      zid,
      organizationName: org.name,
      eid,
      periodName: constructPeriodLabel(input.period),
      status: "created",
      periodCreated,
      formsTotal: formIds.length,
      formsCreated,
      formsSkipped,
      warnings,
    };
  } catch (e) {
    return {
      zid,
      organizationName: org.name,
      eid,
      periodName: constructPeriodLabel(input.period),
      status: "error",
      periodCreated,
      formsTotal: formIds.length,
      formsCreated: 0,
      formsSkipped: 0,
      warnings,
      error: e instanceof Error ? e.message : "Ошибка создания комплекта",
    };
  }
}

export async function constructPackages(
  db: OkoDb,
  raw: PackageConstructInput,
  opts?: {
    onProgress?: (
      progress: number,
      message?: string,
      meta?: { done: number; total: number }
    ) => void | Promise<void>;
  }
): Promise<PackageConstructResult> {
  return withTiming(
    "packages.construct",
    async () => {
      const input = normalizeConstructInput(raw);
      const formIds = await resolveConstructFormIds(db, input.forms);
      const continueOnError = input.options?.continueOnError !== false;
      const rows: PackageConstructRowResult[] = [];

      let schemas: Map<string, FormSchemaDto> | undefined;
      if (input.options?.createInstances !== false && formIds.length > 0) {
        await opts?.onProgress?.(2, `Загрузка схем (${formIds.length})`);
        schemas = await loadFormSchemas(db, formIds);
      }

      const total = input.targets.length;
      for (let i = 0; i < input.targets.length; i++) {
        const t = input.targets[i]!;
        const row = await constructOnePackage(db, t.zid, input, formIds, schemas);
        rows.push(row);
        const done = i + 1;
        const pct = Math.min(99, Math.round((done / total) * 100));
        await opts?.onProgress?.(
          pct,
          `Организации: ${done}/${total}` +
            (row.organizationName ? ` — ${row.organizationName}` : ""),
          { done, total }
        );
        if (row.status === "error" && !continueOnError) break;
      }

      await opts?.onProgress?.(100, "Готово", { done: rows.length, total });

      return {
        summary: {
          targets: rows.length,
          periodsCreated: rows.filter((r) => r.periodCreated && r.status === "created").length,
          formsCreated: rows
            .filter((r) => r.status === "created")
            .reduce((n, r) => n + r.formsCreated, 0),
          skipped: rows.reduce((n, r) => n + r.formsSkipped, 0),
          errors: rows.filter((r) => r.status === "error").length,
        },
        rows,
      };
    },
    () => ({ targets: Array.isArray(raw?.targets) ? raw.targets.length : 0 })
  );
}

async function findInstanceByTemplate(
  db: OkoDb,
  zid: number,
  eid: number,
  templateId: string
): Promise<string | null> {
  const row = (await db
    .prepare(
      `SELECT instance_id FROM form_instances
       WHERE zid = ? AND eid = ? AND template_id = ?
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(zid, eid, templateId)) as { instance_id: string } | undefined;
  return row?.instance_id ?? null;
}

export async function importReportPackage(
  db: OkoDb,
  targetZid: number,
  targetEid: number,
  pkg: ReportPackageInput,
  overwrite: boolean,
  templateIds?: string[]
): Promise<ImportPackageResult> {
  await assertPeriodWritable(db, targetEid, targetZid);
  const org = (await db
    .prepare("SELECT name FROM organizations WHERE zid = ?")
    .get(targetZid)) as { name: string } | undefined;
  if (!org) throw new Error("Organization not found");

  const period = (await db
    .prepare("SELECT name, period_start, period_end FROM periods WHERE eid = ? AND zid = ?")
    .get(targetEid, targetZid)) as
    | { name: string; period_start: string | null; period_end: string | null }
    | undefined;
  if (!period) throw new Error("Period not found");

  const organization =
    pkg.organization?.trim() || org.name;
  const periodStart = pkg.periodStart || dateToString(period.period_start);
  const periodEnd = pkg.periodEnd || dateToString(period.period_end);
  const allow = templateIds?.length ? new Set(templateIds) : null;

  const result: ImportPackageResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  if (!pkg.instances?.length) {
    throw new Error("Package has no instances");
  }

  await db.transaction(async (tx) => {
    for (const raw of pkg.instances) {
      try {
        if (!raw.templateId) {
          result.errors.push("Форма без templateId пропущена");
          continue;
        }
        if (allow && !allow.has(raw.templateId)) {
          result.skipped++;
          continue;
        }
        const existingId = await findInstanceByTemplate(
          tx,
          targetZid,
          targetEid,
          raw.templateId
        );

        if (existingId && !overwrite) {
          result.skipped++;
          continue;
        }

        const now = new Date().toISOString();
        const inst: OkoFormInstance = {
          ...raw,
          instanceId: existingId ?? raw.instanceId ?? randomUUID(),
          zid: targetZid,
          eid: targetEid,
          templateTitle: raw.templateTitle ?? raw.templateId,
          displayName: raw.displayName ?? raw.templateId,
          status: raw.status === "submitted" ? "submitted" : "draft",
          meta: {
            organization,
            enterpriseCode: raw.meta?.enterpriseCode ?? "1@1",
            periodStart: raw.meta?.periodStart || periodStart,
            periodEnd: raw.meta?.periodEnd || periodEnd,
            unit: raw.meta?.unit ?? "тыс.руб.",
          },
          rows: raw.rows ?? [],
          signatures: raw.signatures ?? {},
          createdAt: existingId ? raw.createdAt ?? now : now,
          updatedAt: now,
        };

        await saveInstanceCells(tx, inst);
        if (raw.rashEntries !== undefined) {
          const formId = inst.templateId;
          const forForm = (raw.rashEntries ?? []).filter(
            (e) => !e.formId || e.formId === formId
          );
          await saveRashEntries(
            tx,
            inst.instanceId,
            formId,
            forForm.map((e) => ({ ...e, formId: e.formId || formId }))
          );
        }
        if (existingId) result.updated++;
        else result.created++;
      } catch (e) {
        result.errors.push(
          `${raw.templateId ?? "?"}: ${e instanceof Error ? e.message : "import failed"}`
        );
      }
    }
  });

  // Mark exchange even when all forms were skipped (already present):
  // bulk re-upload of an existing package must still count as «загружено».
  if (result.created > 0 || result.updated > 0 || result.skipped > 0) {
    try {
      const { touchPackageImported } = await import("./packageExchange.js");
      const ctx = await resolvePackageContext(db, {
        zid: targetZid,
        eid: targetEid,
      });
      if (ctx?.packageId) {
        await touchPackageImported(db, ctx.packageId, targetZid, targetEid);
      }
    } catch {
      /* exchange mark is best-effort */
    }
  }

  return result;
}
