import { randomUUID } from "node:crypto";
import type { OkoDb } from "./oko-db.js";
import { dateOrNull, dateToString } from "./dbValues.js";
import { exportCatalog, loadFormSchema, type FormSchemaDto } from "./forms.js";
import { saveInstanceCells } from "./instances.js";
import type { OkoFormInstance } from "./types.js";

export interface OrganizationDto {
  zid: number;
  name: string;
  code: string | null;
  parentZid: number | null;
}

export interface PeriodDto {
  eid: number;
  zid: number;
  name: string;
  periodStart: string | null;
  periodEnd: string | null;
  quarter: number | null;
  year: number | null;
}

export interface WorkContextDto {
  zid: number | null;
  eid: number | null;
}

export interface PackageCompletenessItem {
  formId: string;
  title: string;
  category: string;
  filled: boolean;
  instanceId?: string;
  displayName?: string;
  status?: "draft" | "submitted";
}

export interface PackageCompletenessDto {
  zid: number;
  eid: number;
  total: number;
  filled: number;
  draft: number;
  submitted: number;
  items: PackageCompletenessItem[];
}

export interface PackageDashboardRow {
  zid: number;
  eid: number;
  organizationName: string;
  organizationCode: string | null;
  periodName: string;
  periodStart: string | null;
  periodEnd: string | null;
  total: number;
  filled: number;
  draft: number;
  submitted: number;
  percent: number;
}

export interface CreatePackageResult {
  created: number;
  skipped: number;
  total: number;
  instanceIds: string[];
}

export interface ImportPackageResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface ReportPackageInput {
  organization?: string;
  periodStart?: string;
  periodEnd?: string;
  zid?: number | null;
  eid?: number | null;
  instances: OkoFormInstance[];
}

export async function migrateOrgTables(db: OkoDb): Promise<void> {
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_instances_zid_eid ON form_instances(zid, eid);
    CREATE INDEX IF NOT EXISTS idx_instances_package ON form_instances(zid, eid, template_id);
    CREATE INDEX IF NOT EXISTS idx_periods_zid ON periods(zid);
  `);
}

export async function seedOrganizationsFromSettings(db: OkoDb): Promise<number> {
  const count = (
    (await db.prepare("SELECT COUNT(*) AS c FROM organizations").get()) as { c: number }
  ).c;
  if (count > 0) return 0;

  let orgName = "Организация по умолчанию";
  let periodStart = "";
  let periodEnd = "";

  const settings = (await db.prepare("SELECT key, value FROM app_settings").all()) as Array<{
    key: string;
    value: string;
  }>;
  for (const s of settings) {
    if (s.key !== "globalMeta") continue;
    try {
      const meta = JSON.parse(s.value) as {
        organization?: string;
        periodStart?: string;
        periodEnd?: string;
      };
      if (meta.organization?.trim()) orgName = meta.organization.trim();
      periodStart = meta.periodStart ?? "";
      periodEnd = meta.periodEnd ?? "";
    } catch {
      /* ignore */
    }
  }

  await db.prepare("INSERT INTO organizations (zid, name, code) VALUES (1, ?, ?)").run(
    orgName,
    null
  );

  const periodName =
    periodStart && periodEnd ? `${periodStart} — ${periodEnd}` : "Текущий период";
  await db
    .prepare(
      `INSERT INTO periods (eid, zid, name, period_start, period_end)
     VALUES (1, 1, ?, ?, ?)`
    )
    .run(periodName, dateOrNull(periodStart), dateOrNull(periodEnd));

  const upsert = db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  await upsert.run("workZid", "1");
  await upsert.run("workEid", "1");

  return 1;
}

function rowToOrg(row: {
  zid: number;
  name: string;
  code: string | null;
  parent_zid: number | null;
}): OrganizationDto {
  return {
    zid: row.zid,
    name: row.name,
    code: row.code,
    parentZid: row.parent_zid,
  };
}

function rowToPeriod(row: {
  eid: number;
  zid: number;
  name: string;
  period_start: string | null;
  period_end: string | null;
  quarter: number | null;
  year: number | null;
}): PeriodDto {
  return {
    eid: row.eid,
    zid: row.zid,
    name: row.name,
    periodStart: dateOrNull(row.period_start),
    periodEnd: dateOrNull(row.period_end),
    quarter: row.quarter,
    year: row.year,
  };
}

export async function listOrganizations(db: OkoDb): Promise<OrganizationDto[]> {
  const rows = (await db
    .prepare("SELECT zid, name, code, parent_zid FROM organizations ORDER BY name")
    .all()) as Array<{
    zid: number;
    name: string;
    code: string | null;
    parent_zid: number | null;
  }>;
  return rows.map(rowToOrg);
}

export async function createOrganization(
  db: OkoDb,
  input: { name: string; code?: string; parentZid?: number }
): Promise<OrganizationDto> {
  const max = (await db.prepare("SELECT COALESCE(MAX(zid), 0) AS m FROM organizations").get()) as {
    m: number;
  };
  const zid = max.m + 1;
  await db
    .prepare("INSERT INTO organizations (zid, name, code, parent_zid) VALUES (?, ?, ?, ?)")
    .run(zid, input.name.trim(), input.code?.trim() || null, input.parentZid ?? null);
  return {
    zid,
    name: input.name.trim(),
    code: input.code?.trim() || null,
    parentZid: input.parentZid ?? null,
  };
}

export async function listPeriods(db: OkoDb, zid?: number): Promise<PeriodDto[]> {
  if (zid) {
    const rows = (await db
      .prepare(
        `SELECT eid, zid, name, period_start, period_end, quarter, year
         FROM periods WHERE zid = ? ORDER BY period_start DESC, eid DESC`
      )
      .all(zid)) as Array<{
      eid: number;
      zid: number;
      name: string;
      period_start: string | null;
      period_end: string | null;
      quarter: number | null;
      year: number | null;
    }>;
    return rows.map(rowToPeriod);
  }
  const rows = (await db
    .prepare(
      `SELECT eid, zid, name, period_start, period_end, quarter, year
       FROM periods ORDER BY zid, period_start DESC, eid DESC`
    )
    .all()) as Array<{
    eid: number;
    zid: number;
    name: string;
    period_start: string | null;
    period_end: string | null;
    quarter: number | null;
    year: number | null;
  }>;
  return rows.map(rowToPeriod);
}

export async function createPeriod(
  db: OkoDb,
  input: {
    zid: number;
    name: string;
    periodStart?: string;
    periodEnd?: string;
    quarter?: number;
    year?: number;
  }
): Promise<PeriodDto> {
  const org = await db.prepare("SELECT 1 FROM organizations WHERE zid = ?").get(input.zid);
  if (!org) throw new Error("Organization not found");

  const max = (await db.prepare("SELECT COALESCE(MAX(eid), 0) AS m FROM periods").get()) as {
    m: number;
  };
  const eid = max.m + 1;
  await db
    .prepare(
      `INSERT INTO periods (eid, zid, name, period_start, period_end, quarter, year)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      eid,
      input.zid,
      input.name.trim(),
      dateOrNull(input.periodStart),
      dateOrNull(input.periodEnd),
      input.quarter ?? null,
      input.year ?? null
    );
  return {
    eid,
    zid: input.zid,
    name: input.name.trim(),
    periodStart: dateOrNull(input.periodStart),
    periodEnd: dateOrNull(input.periodEnd),
    quarter: input.quarter ?? null,
    year: input.year ?? null,
  };
}

export async function getWorkContext(db: OkoDb): Promise<WorkContextDto> {
  const rows = (await db.prepare("SELECT key, value FROM app_settings").all()) as Array<{
    key: string;
    value: string;
  }>;
  let zid: number | null = null;
  let eid: number | null = null;
  for (const r of rows) {
    if (r.key === "workZid" && r.value) zid = Number(r.value) || null;
    if (r.key === "workEid" && r.value) eid = Number(r.value) || null;
  }
  return { zid, eid };
}

export async function setWorkContext(db: OkoDb, ctx: WorkContextDto): Promise<WorkContextDto> {
  const upsert = db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  if (ctx.zid != null) await upsert.run("workZid", String(ctx.zid));
  else await db.prepare("DELETE FROM app_settings WHERE key = 'workZid'").run();
  if (ctx.eid != null) await upsert.run("workEid", String(ctx.eid));
  else await db.prepare("DELETE FROM app_settings WHERE key = 'workEid'").run();
  return getWorkContext(db);
}

function buildInitialRows(schema: FormSchemaDto): Record<string, string | number>[] {
  if (schema.rows.length > 0) {
    return schema.rows.map((t) => {
      const row: Record<string, string | number> = {};
      for (const col of schema.columns) row[col.key] = "";
      if (t.num) row.num = t.num;
      if (t.code) row.code = t.code;
      if (t.name) row.name = t.name;
      const accountCode = t.code ?? t.num;
      if (schema.columns.some((c) => c.key === "account") && accountCode) {
        row.account = `${accountCode} ${t.name ?? ""}`.trim();
      }
      return row;
    });
  }
  const row: Record<string, string | number> = {};
  for (const col of schema.columns) row[col.key] = "";
  return [row];
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

export async function getPackageCompleteness(
  db: OkoDb,
  zid: number,
  eid: number
): Promise<PackageCompletenessDto> {
  const catalog = await exportCatalog(db);
  const instances = (await db
    .prepare(
      `SELECT instance_id, template_id, display_name, status, updated_at
       FROM form_instances WHERE zid = ? AND eid = ?
       ORDER BY updated_at DESC`
    )
    .all(zid, eid)) as Array<{
    instance_id: string;
    template_id: string;
    display_name: string;
    status: string | null;
    updated_at: string;
  }>;

  const latestByTemplate = new Map<
    string,
    { instanceId: string; displayName: string; status: "draft" | "submitted" }
  >();
  for (const inst of instances) {
    if (!latestByTemplate.has(inst.template_id)) {
      latestByTemplate.set(inst.template_id, {
        instanceId: inst.instance_id,
        displayName: inst.display_name,
        status: inst.status === "submitted" ? "submitted" : "draft",
      });
    }
  }

  let draft = 0;
  let submitted = 0;
  const items: PackageCompletenessItem[] = catalog.forms.map((f) => {
    const hit = latestByTemplate.get(f.id);
    if (hit?.status === "submitted") submitted++;
    else if (hit) draft++;
    return {
      formId: f.id,
      title: f.title,
      category: f.category,
      filled: !!hit,
      instanceId: hit?.instanceId,
      displayName: hit?.displayName,
      status: hit?.status,
    };
  });

  const filled = items.filter((i) => i.filled).length;
  return { zid, eid, total: items.length, filled, draft, submitted, items };
}

export async function getPackagesDashboard(db: OkoDb): Promise<PackageDashboardRow[]> {
  const catalog = await exportCatalog(db);
  const totalForms = catalog.forms.length;

  const periods = (await db
    .prepare(
      `SELECT p.eid, p.zid, p.name, p.period_start, p.period_end,
              o.name AS org_name, o.code AS org_code
       FROM periods p
       JOIN organizations o ON o.zid = p.zid
       ORDER BY o.name, p.period_start DESC, p.eid DESC`
    )
    .all()) as unknown as Array<{
    eid: number;
    zid: number;
    name: string;
    period_start: string | null;
    period_end: string | null;
    org_name: string;
    org_code: string | null;
  }>;

  const rows: PackageDashboardRow[] = [];
  for (const p of periods) {
    const completeness = await getPackageCompleteness(db, p.zid, p.eid);
    rows.push({
      zid: p.zid,
      eid: p.eid,
      organizationName: p.org_name,
      organizationCode: p.org_code,
      periodName: p.name,
      periodStart: dateOrNull(p.period_start),
      periodEnd: dateOrNull(p.period_end),
      total: totalForms,
      filled: completeness.filled,
      draft: completeness.draft,
      submitted: completeness.submitted,
      percent: totalForms > 0 ? Math.round((completeness.filled / totalForms) * 100) : 0,
    });
  }
  return rows;
}

export async function createReportPackage(
  db: OkoDb,
  zid: number,
  eid: number
): Promise<CreatePackageResult> {
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

  const catalog = await exportCatalog(db);
  const existing = await existingTemplatesForPackage(db, zid, eid);
  const now = new Date().toISOString();
  const instanceIds: string[] = [];
  let created = 0;
  let skipped = 0;

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

  await db.transaction(async (tx) => {
    for (const form of catalog.forms) {
      if (existing.has(form.id)) {
        skipped++;
        continue;
      }
      const schema = await loadFormSchema(tx, form.id);
      if (!schema) {
        skipped++;
        continue;
      }

      const signatures: Record<string, string> = {};
      for (const name of schema.signatures) signatures[name] = "";

      const inst: OkoFormInstance = {
        instanceId: randomUUID(),
        templateId: schema.id,
        templateTitle: schema.title,
        displayName: defaultDisplayName(schema.id, schema.title, org.name),
        zid,
        eid,
        meta: {
          organization: org.name,
          enterpriseCode,
          periodStart: dateToString(period.period_start),
          periodEnd: dateToString(period.period_end),
          unit: schema.meta.unit || "тыс.руб.",
        },
        rows: buildInitialRows(schema),
        signatures,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };

      await saveInstanceCells(tx, inst);
      instanceIds.push(inst.instanceId);
      created++;
    }
  });

  return { created, skipped, total: catalog.forms.length, instanceIds };
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
  overwrite: boolean
): Promise<ImportPackageResult> {
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
        if (existingId) result.updated++;
        else result.created++;
      } catch (e) {
        result.errors.push(
          `${raw.templateId ?? "?"}: ${e instanceof Error ? e.message : "import failed"}`
        );
      }
    }
  });

  return result;
}
