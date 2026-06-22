import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
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

export function migrateOrgTables(db: DatabaseSync): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_instances_zid_eid ON form_instances(zid, eid);
    CREATE INDEX IF NOT EXISTS idx_instances_package ON form_instances(zid, eid, template_id);
    CREATE INDEX IF NOT EXISTS idx_periods_zid ON periods(zid);
  `);
}

export function seedOrganizationsFromSettings(db: DatabaseSync): number {
  const count = (db.prepare("SELECT COUNT(*) AS c FROM organizations").get() as { c: number }).c;
  if (count > 0) return 0;

  let orgName = "Организация по умолчанию";
  let periodStart = "";
  let periodEnd = "";

  const settings = db.prepare("SELECT key, value FROM app_settings").all() as Array<{
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

  db.prepare("INSERT INTO organizations (zid, name, code) VALUES (1, ?, ?)").run(
    orgName,
    null
  );

  const periodName =
    periodStart && periodEnd ? `${periodStart} — ${periodEnd}` : "Текущий период";
  db.prepare(
    `INSERT INTO periods (eid, zid, name, period_start, period_end)
     VALUES (1, 1, ?, ?, ?)`
  ).run(periodName, periodStart || null, periodEnd || null);

  const upsert = db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  upsert.run("workZid", "1");
  upsert.run("workEid", "1");

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
    periodStart: row.period_start,
    periodEnd: row.period_end,
    quarter: row.quarter,
    year: row.year,
  };
}

export function listOrganizations(db: DatabaseSync): OrganizationDto[] {
  const rows = db
    .prepare("SELECT zid, name, code, parent_zid FROM organizations ORDER BY name")
    .all() as Array<{
    zid: number;
    name: string;
    code: string | null;
    parent_zid: number | null;
  }>;
  return rows.map(rowToOrg);
}

export function createOrganization(
  db: DatabaseSync,
  input: { name: string; code?: string; parentZid?: number }
): OrganizationDto {
  const max = db.prepare("SELECT COALESCE(MAX(zid), 0) AS m FROM organizations").get() as {
    m: number;
  };
  const zid = max.m + 1;
  db.prepare(
    "INSERT INTO organizations (zid, name, code, parent_zid) VALUES (?, ?, ?, ?)"
  ).run(zid, input.name.trim(), input.code?.trim() || null, input.parentZid ?? null);
  return {
    zid,
    name: input.name.trim(),
    code: input.code?.trim() || null,
    parentZid: input.parentZid ?? null,
  };
}

export function listPeriods(db: DatabaseSync, zid?: number): PeriodDto[] {
  if (zid) {
    const rows = db
      .prepare(
        `SELECT eid, zid, name, period_start, period_end, quarter, year
         FROM periods WHERE zid = ? ORDER BY period_start DESC, eid DESC`
      )
      .all(zid) as Array<{
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
  const rows = db
    .prepare(
      `SELECT eid, zid, name, period_start, period_end, quarter, year
       FROM periods ORDER BY zid, period_start DESC, eid DESC`
    )
    .all() as Array<{
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

export function createPeriod(
  db: DatabaseSync,
  input: {
    zid: number;
    name: string;
    periodStart?: string;
    periodEnd?: string;
    quarter?: number;
    year?: number;
  }
): PeriodDto {
  const org = db.prepare("SELECT 1 FROM organizations WHERE zid = ?").get(input.zid);
  if (!org) throw new Error("Organization not found");

  const max = db.prepare("SELECT COALESCE(MAX(eid), 0) AS m FROM periods").get() as { m: number };
  const eid = max.m + 1;
  db.prepare(
    `INSERT INTO periods (eid, zid, name, period_start, period_end, quarter, year)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    eid,
    input.zid,
    input.name.trim(),
    input.periodStart || null,
    input.periodEnd || null,
    input.quarter ?? null,
    input.year ?? null
  );
  return {
    eid,
    zid: input.zid,
    name: input.name.trim(),
    periodStart: input.periodStart || null,
    periodEnd: input.periodEnd || null,
    quarter: input.quarter ?? null,
    year: input.year ?? null,
  };
}

export function getWorkContext(db: DatabaseSync): WorkContextDto {
  const rows = db.prepare("SELECT key, value FROM app_settings").all() as Array<{
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

export function setWorkContext(db: DatabaseSync, ctx: WorkContextDto): WorkContextDto {
  const upsert = db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  if (ctx.zid != null) upsert.run("workZid", String(ctx.zid));
  else db.prepare("DELETE FROM app_settings WHERE key = 'workZid'").run();
  if (ctx.eid != null) upsert.run("workEid", String(ctx.eid));
  else db.prepare("DELETE FROM app_settings WHERE key = 'workEid'").run();
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

function existingTemplatesForPackage(
  db: DatabaseSync,
  zid: number,
  eid: number
): Set<string> {
  const rows = db
    .prepare(
      `SELECT template_id FROM form_instances WHERE zid = ? AND eid = ?`
    )
    .all(zid, eid) as Array<{ template_id: string }>;
  return new Set(rows.map((r) => r.template_id));
}

export function getPackageCompleteness(
  db: DatabaseSync,
  zid: number,
  eid: number
): PackageCompletenessDto {
  const catalog = exportCatalog(db);
  const instances = db
    .prepare(
      `SELECT instance_id, template_id, display_name, status, updated_at
       FROM form_instances WHERE zid = ? AND eid = ?
       ORDER BY updated_at DESC`
    )
    .all(zid, eid) as Array<{
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

export function getPackagesDashboard(db: DatabaseSync): PackageDashboardRow[] {
  const catalog = exportCatalog(db);
  const totalForms = catalog.forms.length;

  const periods = db
    .prepare(
      `SELECT p.eid, p.zid, p.name, p.period_start, p.period_end,
              o.name AS org_name, o.code AS org_code
       FROM periods p
       JOIN organizations o ON o.zid = p.zid
       ORDER BY o.name, p.period_start DESC, p.eid DESC`
    )
    .all() as unknown as Array<{
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
    const completeness = getPackageCompleteness(db, p.zid, p.eid);
    rows.push({
      zid: p.zid,
      eid: p.eid,
      organizationName: p.org_name,
      organizationCode: p.org_code,
      periodName: p.name,
      periodStart: p.period_start,
      periodEnd: p.period_end,
      total: totalForms,
      filled: completeness.filled,
      draft: completeness.draft,
      submitted: completeness.submitted,
      percent: totalForms > 0 ? Math.round((completeness.filled / totalForms) * 100) : 0,
    });
  }
  return rows;
}

export function createReportPackage(
  db: DatabaseSync,
  zid: number,
  eid: number
): CreatePackageResult {
  const org = db
    .prepare("SELECT name FROM organizations WHERE zid = ?")
    .get(zid) as { name: string } | undefined;
  if (!org) throw new Error("Organization not found");

  const period = db
    .prepare(
      "SELECT name, period_start, period_end FROM periods WHERE eid = ? AND zid = ?"
    )
    .get(eid, zid) as
    | { name: string; period_start: string | null; period_end: string | null }
    | undefined;
  if (!period) throw new Error("Period not found");

  const catalog = exportCatalog(db);
  const existing = existingTemplatesForPackage(db, zid, eid);
  const now = new Date().toISOString();
  const instanceIds: string[] = [];
  let created = 0;
  let skipped = 0;

  const enterpriseCode = (() => {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'globalMeta'").get() as
      | { value: string }
      | undefined;
    if (!row) return "1@1";
    try {
      const meta = JSON.parse(row.value) as { enterpriseCode?: string };
      return meta.enterpriseCode ?? "1@1";
    } catch {
      return "1@1";
    }
  })();

  db.exec("BEGIN");
  try {
    for (const form of catalog.forms) {
      if (existing.has(form.id)) {
        skipped++;
        continue;
      }
      const schema = loadFormSchema(db, form.id);
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
          periodStart: period.period_start ?? "",
          periodEnd: period.period_end ?? "",
          unit: schema.meta.unit || "тыс.руб.",
        },
        rows: buildInitialRows(schema),
        signatures,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };

      saveInstanceCells(db, inst);
      instanceIds.push(inst.instanceId);
      created++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return { created, skipped, total: catalog.forms.length, instanceIds };
}
