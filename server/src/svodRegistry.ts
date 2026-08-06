import { randomUUID } from "node:crypto";
import type { OkoDb } from "./oko-db.js";
import { normalizePackageKind, type PackageKind } from "./businessProcessTypes.js";

export interface SvodDefinitionDto {
  id: string;
  eid: number;
  packageKind: PackageKind;
  code: string;
  name: string;
  createdAt: string;
  createdBy: string | null;
  members: SvodMemberDto[];
}

export interface SvodMemberDto {
  id: number;
  svodId: string;
  organizationGuid: string | null;
  zid: number | null;
  included: boolean;
  headCompany: string | null;
  flagRsbu: boolean;
  flagMgk: boolean;
  flagNkdo: boolean;
}

export async function listSvodDefinitions(
  db: OkoDb,
  eid?: number
): Promise<SvodDefinitionDto[]> {
  const rows = (await db
    .prepare(
      eid != null
        ? `SELECT * FROM svod_definitions WHERE eid = ? ORDER BY code`
        : `SELECT * FROM svod_definitions ORDER BY eid DESC, code`
    )
    .all(...(eid != null ? [eid] : []))) as Array<{
    id: string;
    eid: number;
    package_kind: string;
    code: string;
    name: string;
    created_at: string;
    created_by: string | null;
  }>;
  const result: SvodDefinitionDto[] = [];
  for (const r of rows) {
    result.push({
      id: r.id,
      eid: Number(r.eid),
      packageKind: normalizePackageKind(r.package_kind),
      code: r.code,
      name: r.name,
      createdAt: r.created_at,
      createdBy: r.created_by,
      members: await listSvodMembers(db, r.id),
    });
  }
  return result;
}

export async function listSvodMembers(db: OkoDb, svodId: string): Promise<SvodMemberDto[]> {
  const rows = (await db
    .prepare(`SELECT * FROM svod_members WHERE svod_id = ? ORDER BY id`)
    .all(svodId)) as Array<{
    id: number;
    svod_id: string;
    organization_guid: string | null;
    zid: number | null;
    included: number;
    head_company: string | null;
    flag_rsbu: number | null;
    flag_mgk: number | null;
    flag_nkdo: number | null;
  }>;
  return rows.map((r) => ({
    id: Number(r.id),
    svodId: r.svod_id,
    organizationGuid: r.organization_guid,
    zid: r.zid == null ? null : Number(r.zid),
    included: !!r.included,
    headCompany: r.head_company,
    flagRsbu: !!r.flag_rsbu,
    flagMgk: !!r.flag_mgk,
    flagNkdo: !!r.flag_nkdo,
  }));
}

export async function createSvodDefinition(
  db: OkoDb,
  input: {
    eid: number;
    packageKind?: PackageKind;
    code: string;
    name: string;
    createdBy?: string | null;
    members?: Array<{
      organizationGuid?: string | null;
      zid?: number | null;
      included?: boolean;
      headCompany?: string | null;
      flagRsbu?: boolean;
      flagMgk?: boolean;
      flagNkdo?: boolean;
    }>;
  }
): Promise<SvodDefinitionDto> {
  const id = randomUUID();
  const kind = normalizePackageKind(input.packageKind);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO svod_definitions (id, eid, package_kind, code, name, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, input.eid, kind, input.code.trim(), input.name.trim(), now, input.createdBy ?? null);

  for (const m of input.members ?? []) {
    await db
      .prepare(
        `INSERT INTO svod_members (
           svod_id, organization_guid, zid, included, head_company, flag_rsbu, flag_mgk, flag_nkdo
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        m.organizationGuid ?? null,
        m.zid ?? null,
        m.included === false ? 0 : 1,
        m.headCompany ?? null,
        m.flagRsbu ? 1 : 0,
        m.flagMgk ? 1 : 0,
        m.flagNkdo ? 1 : 0
      );
  }

  const list = await listSvodDefinitions(db, input.eid);
  return list.find((s) => s.id === id)!;
}

/**
 * Drill-down placeholder: company → comments/rash for a form cell context.
 */
export async function svodDetailDrilldown(
  db: OkoDb,
  input: { zid: number; eid: number; formId?: string }
): Promise<{
  organization: { zid: number; name: string; guid: string | null } | null;
  comments: Array<{
    formId: string;
    rowNo: number;
    columnKey: string;
    amount: number | null;
    freeText: string | null;
    articleCode: string | null;
  }>;
}> {
  const org = (await db
    .prepare(`SELECT zid, name, guid FROM organizations WHERE zid = ?`)
    .get(input.zid)) as { zid: number; name: string; guid: string | null } | undefined;

  const comments = (await db
    .prepare(
      `SELECT cc.form_id, cc.row_no, cc.column_key, cc.amount, cc.free_text, cc.article_code
       FROM cell_comments cc
       JOIN form_instances fi ON fi.instance_id = cc.instance_id
       WHERE fi.zid = ? AND fi.eid = ?
         AND (?::text IS NULL OR cc.form_id = ?)
       ORDER BY cc.form_id, cc.row_no
       LIMIT 200`
    )
    .all(input.zid, input.eid, input.formId ?? null, input.formId ?? null)) as Array<{
    form_id: string;
    row_no: number;
    column_key: string;
    amount: number | null;
    free_text: string | null;
    article_code: string | null;
  }>;

  return {
    organization: org
      ? { zid: Number(org.zid), name: org.name, guid: org.guid }
      : null,
    comments: comments.map((c) => ({
      formId: c.form_id,
      rowNo: Number(c.row_no),
      columnKey: c.column_key,
      amount: c.amount,
      freeText: c.free_text,
      articleCode: c.article_code,
    })),
  };
}

/** Copies a definition's membership into another reporting period, idempotently by code. */
export async function copySvodFromPreviousPeriod(
  db: OkoDb, input: { sourceSvodId: string; targetEid: number; createdBy?: string | null }
): Promise<SvodDefinitionDto> {
  const source = (await listSvodDefinitions(db)).find((s) => s.id === input.sourceSvodId);
  if (!source) throw new Error("Source svod not found");
  const existing = (await listSvodDefinitions(db, input.targetEid))
    .find((s) => s.code === source.code && s.packageKind === source.packageKind);
  if (existing) return existing;
  return createSvodDefinition(db, {
    eid: input.targetEid, packageKind: source.packageKind, code: source.code, name: source.name,
    createdBy: input.createdBy,
    members: source.members.map((m) => ({
      organizationGuid: m.organizationGuid, zid: m.zid, included: m.included, headCompany: m.headCompany,
      flagRsbu: m.flagRsbu, flagMgk: m.flagMgk, flagNkdo: m.flagNkdo,
    })),
  });
}

/** Materialize the sum of every numeric source cell for included members. */
export async function calculateSvod(
  db: OkoDb, input: { svodId: string; eid: number; packageKind?: PackageKind }
): Promise<{ cells: number; members: number }> {
  const def = (await listSvodDefinitions(db)).find((s) => s.id === input.svodId);
  if (!def) throw new Error("Svod not found");
  const kind = normalizePackageKind(input.packageKind ?? def.packageKind);
  const zids = def.members.filter((m) => m.included && m.zid != null).map((m) => m.zid!);
  await db.prepare(`DELETE FROM svod_results WHERE svod_id = ? AND eid = ? AND package_kind = ?`).run(def.id, input.eid, kind);
  if (!zids.length) return { cells: 0, members: 0 };
  const placeholders = zids.map(() => "?").join(",");
  const rows = await db.prepare(
    `SELECT fi.template_id AS form_id, fc.row_no, fc.column_key, SUM(fc.value_num) AS value_num
     FROM form_instances fi JOIN form_cell_values fc ON fc.instance_id = fi.instance_id
     WHERE fi.eid = ? AND fi.zid IN (${placeholders}) AND fc.value_num IS NOT NULL
     GROUP BY fi.template_id, fc.row_no, fc.column_key`
  ).all(input.eid, ...zids) as Array<{ form_id: string; row_no: number; column_key: string; value_num: number }>;
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO svod_results (svod_id, eid, package_kind, form_id, row_no, column_key, value_num, calculated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of rows) await insert.run(def.id, input.eid, kind, row.form_id, row.row_no, row.column_key, row.value_num, now);
  return { cells: rows.length, members: zids.length };
}

/** App 17 navigation: 058 companies, 059 contextual comments, 060 raw rash entries. */
export async function svodDrilldown(
  db: OkoDb, input: { svodId: string; eid: number; formId: string; rowNo: number; columnKey: string; level: "058" | "059" | "060" }
): Promise<unknown> {
  const def = (await listSvodDefinitions(db)).find((s) => s.id === input.svodId);
  if (!def) throw new Error("Svod not found");
  const zids = def.members.filter((m) => m.included && m.zid != null).map((m) => m.zid!);
  if (!zids.length) return [];
  const q = zids.map(() => "?").join(",");
  if (input.level === "058") return db.prepare(
    `SELECT fi.zid, o.name, fc.value_num AS amount FROM form_instances fi
     JOIN form_cell_values fc ON fc.instance_id = fi.instance_id LEFT JOIN organizations o ON o.zid = fi.zid
     WHERE fi.eid = ? AND fi.zid IN (${q}) AND fi.template_id = ? AND fc.row_no = ? AND fc.column_key = ?`
  ).all(input.eid, ...zids, input.formId, input.rowNo, input.columnKey);
  if (input.level === "059") return db.prepare(
    `SELECT fi.zid, cc.kontr_id, cc.article_code, cc.free_text, cc.amount FROM cell_comments cc
     JOIN form_instances fi ON fi.instance_id = cc.instance_id
     WHERE fi.eid = ? AND fi.zid IN (${q}) AND cc.form_id = ? AND cc.row_no = ? AND cc.column_key = ?`
  ).all(input.eid, ...zids, input.formId, input.rowNo, input.columnKey);
  return db.prepare(
    `SELECT fi.zid, re.* FROM form_rash_entries re JOIN form_instances fi ON fi.instance_id = re.instance_id
     WHERE fi.eid = ? AND fi.zid IN (${q}) AND re.form_id = ? AND re.parent_row_no = ?`
  ).all(input.eid, ...zids, input.formId, input.rowNo);
}
