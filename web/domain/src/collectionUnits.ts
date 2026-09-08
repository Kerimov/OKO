import type { OkoDb } from "./oko-db.js";

export type CollectionUnitKind = "organization" | "branch" | "unit";

export interface CollectionUnitDto {
  zid: number;
  name: string;
  code: string | null;
  parentZid: number | null;
  unitKind: CollectionUnitKind;
  headZid: number | null;
  branchCode: string | null;
  unitCode: string | null;
  compositeCode: string | null;
  guid: string | null;
}

type OrgRow = {
  zid: number;
  name: string;
  code: string | null;
  parent_zid: number | null;
  unit_kind?: string | null;
  head_zid?: number | null;
  branch_code?: string | null;
  unit_code?: string | null;
  composite_code?: string | null;
  guid?: string | null;
};

function normalizeKind(raw: string | null | undefined): CollectionUnitKind {
  if (raw === "branch" || raw === "unit") return raw;
  return "organization";
}

function rowToDto(row: OrgRow): CollectionUnitDto {
  return {
    zid: Number(row.zid),
    name: row.name,
    code: row.code,
    parentZid: row.parent_zid == null ? null : Number(row.parent_zid),
    unitKind: normalizeKind(row.unit_kind),
    headZid: row.head_zid == null ? null : Number(row.head_zid),
    branchCode: row.branch_code ?? null,
    unitCode: row.unit_code ?? null,
    compositeCode: row.composite_code ?? null,
    guid: row.guid ?? null,
  };
}

/**
 * Composite code: head@company.branch.unit
 * - organization: head@company
 * - branch: head@company.branch
 * - unit: head@company.branch.unit
 */
export function buildCompositeCode(parts: {
  headCode: string;
  companyCode: string;
  branchCode?: string | null;
  unitCode?: string | null;
}): string {
  const head = parts.headCode.trim() || "head";
  const company = parts.companyCode.trim() || "company";
  const segs = [company];
  if (parts.branchCode?.trim()) segs.push(parts.branchCode.trim());
  if (parts.unitCode?.trim()) segs.push(parts.unitCode.trim());
  return `${head}@${segs.join(".")}`;
}

export async function listCollectionUnits(db: OkoDb): Promise<CollectionUnitDto[]> {
  const rows = (await db
    .prepare(
      `SELECT zid, name, code, parent_zid, unit_kind, head_zid, branch_code, unit_code, composite_code, guid
       FROM organizations
       ORDER BY COALESCE(head_zid, zid), unit_kind, name`
    )
    .all()) as OrgRow[];
  return rows.map(rowToDto);
}

export async function getCollectionUnit(
  db: OkoDb,
  zid: number
): Promise<CollectionUnitDto | null> {
  const row = (await db
    .prepare(
      `SELECT zid, name, code, parent_zid, unit_kind, head_zid, branch_code, unit_code, composite_code, guid
       FROM organizations WHERE zid = ?`
    )
    .get(zid)) as OrgRow | undefined;
  return row ? rowToDto(row) : null;
}

export async function upsertCollectionUnit(
  db: OkoDb,
  input: {
    zid: number;
    name: string;
    code?: string | null;
    parentZid?: number | null;
    unitKind?: CollectionUnitKind;
    headZid?: number | null;
    branchCode?: string | null;
    unitCode?: string | null;
    guid?: string | null;
    headCode?: string | null;
  }
): Promise<CollectionUnitDto> {
  const kind = input.unitKind ?? "organization";
  const headZid = input.headZid ?? input.zid;
  const companyCode = input.code?.trim() || String(input.zid);
  const headCode = input.headCode?.trim() || String(headZid);
  const composite = buildCompositeCode({
    headCode,
    companyCode,
    branchCode: kind === "organization" ? null : input.branchCode,
    unitCode: kind === "unit" ? input.unitCode : null,
  });

  const existing = await getCollectionUnit(db, input.zid);
  if (existing) {
    await db
      .prepare(
        `UPDATE organizations
         SET name = ?, code = ?, parent_zid = ?, unit_kind = ?, head_zid = ?,
             branch_code = ?, unit_code = ?, composite_code = ?, guid = COALESCE(?, guid)
         WHERE zid = ?`
      )
      .run(
        input.name,
        input.code ?? null,
        input.parentZid ?? null,
        kind,
        headZid,
        input.branchCode ?? null,
        input.unitCode ?? null,
        composite,
        input.guid ?? null,
        input.zid
      );
  } else {
    await db
      .prepare(
        `INSERT INTO organizations (
           zid, name, code, parent_zid, unit_kind, head_zid, branch_code, unit_code, composite_code, guid
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.zid,
        input.name,
        input.code ?? null,
        input.parentZid ?? null,
        kind,
        headZid,
        input.branchCode ?? null,
        input.unitCode ?? null,
        composite,
        input.guid ?? null
      );
  }
  return (await getCollectionUnit(db, input.zid))!;
}

export async function listUnitSubtree(
  db: OkoDb,
  headOrUnitZid: number
): Promise<CollectionUnitDto[]> {
  const all = await listCollectionUnits(db);
  const root = all.find((u) => u.zid === headOrUnitZid);
  if (!root) return [];
  const head = root.headZid ?? root.zid;
  return all.filter((u) => (u.headZid ?? u.zid) === head || u.zid === head);
}
