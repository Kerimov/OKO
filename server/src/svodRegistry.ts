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
