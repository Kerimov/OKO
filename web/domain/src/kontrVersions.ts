import { randomUUID } from "node:crypto";
import type { OkoDb } from "./oko-db.js";

export interface KontrCardFields {
  name: string;
  oldName?: string | null;
  inn?: string | null;
  kpp?: string | null;
  ogrn?: string | null;
  orgForm?: string | null;
  orgType?: number | null;
  mandatoryRash?: boolean;
  country?: string | null;
  city?: string | null;
  idObdnsi?: string | null;
  /** Full card 066–068 extras */
  card?: Record<string, unknown>;
}

export interface KontrVersionDto {
  id: number;
  kontrId: number;
  guid: string | null;
  versionNo: number;
  validFrom: string | null;
  validTo: string | null;
  name: string;
  oldName: string | null;
  inn: string | null;
  kpp: string | null;
  ogrn: string | null;
  orgForm: string | null;
  orgType: number | null;
  mandatoryRash: boolean;
  country: string | null;
  city: string | null;
  idObdnsi: string | null;
  card: Record<string, unknown>;
  createdAt: string;
  createdBy: string | null;
}

type VerRow = {
  id: number;
  kontr_id: number;
  guid: string | null;
  version_no: number;
  valid_from: string | null;
  valid_to: string | null;
  name: string;
  old_name: string | null;
  inn: string | null;
  kpp: string | null;
  ogrn: string | null;
  org_form: string | null;
  org_type: number | null;
  mandatory_rash: number | null;
  country: string | null;
  city: string | null;
  id_obdnsi: string | null;
  card_json: string;
  created_at: string;
  created_by: string | null;
};

function parseCard(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function rowToDto(row: VerRow): KontrVersionDto {
  return {
    id: Number(row.id),
    kontrId: Number(row.kontr_id),
    guid: row.guid,
    versionNo: Number(row.version_no),
    validFrom: row.valid_from,
    validTo: row.valid_to,
    name: row.name,
    oldName: row.old_name,
    inn: row.inn,
    kpp: row.kpp,
    ogrn: row.ogrn,
    orgForm: row.org_form,
    orgType: row.org_type == null ? null : Number(row.org_type),
    mandatoryRash: !!row.mandatory_rash,
    country: row.country,
    city: row.city,
    idObdnsi: row.id_obdnsi,
    card: parseCard(row.card_json || "{}"),
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export async function ensureKontrGuid(db: OkoDb, kontrId: number): Promise<string> {
  const row = (await db
    .prepare(`SELECT guid FROM kontragents WHERE id = ?`)
    .get(kontrId)) as { guid: string | null } | undefined;
  if (!row) {
    const err = new Error("Kontragent not found");
    (err as Error & { status: number }).status = 404;
    throw err;
  }
  if (row.guid) return row.guid;
  const guid = randomUUID();
  await db.prepare(`UPDATE kontragents SET guid = ? WHERE id = ?`).run(guid, kontrId);
  return guid;
}

export async function listKontrVersions(
  db: OkoDb,
  kontrId: number
): Promise<KontrVersionDto[]> {
  const rows = (await db
    .prepare(
      `SELECT * FROM kontragent_versions WHERE kontr_id = ? ORDER BY version_no DESC`
    )
    .all(kontrId)) as VerRow[];
  return rows.map(rowToDto);
}

export async function getKontrVersionAt(
  db: OkoDb,
  kontrId: number,
  asOf: string
): Promise<KontrVersionDto | null> {
  const row = (await db
    .prepare(
      `SELECT * FROM kontragent_versions
       WHERE kontr_id = ?
         AND (valid_from IS NULL OR valid_from <= ?)
         AND (valid_to IS NULL OR valid_to >= ?)
       ORDER BY version_no DESC
       LIMIT 1`
    )
    .get(kontrId, asOf, asOf)) as VerRow | undefined;
  return row ? rowToDto(row) : null;
}

export async function createKontrVersion(
  db: OkoDb,
  input: {
    kontrId: number;
    validFrom?: string | null;
    validTo?: string | null;
    fields: KontrCardFields;
    createdBy?: string | null;
    closePrevious?: boolean;
  }
): Promise<KontrVersionDto> {
  const guid = await ensureKontrGuid(db, input.kontrId);
  const maxRow = (await db
    .prepare(`SELECT COALESCE(MAX(version_no), 0) AS m FROM kontragent_versions WHERE kontr_id = ?`)
    .get(input.kontrId)) as { m: number };
  const versionNo = Number(maxRow.m) + 1;
  const now = new Date().toISOString();
  const validFrom = input.validFrom ?? now.slice(0, 10);

  if (input.closePrevious !== false) {
    await db
      .prepare(
        `UPDATE kontragent_versions
         SET valid_to = ?
         WHERE kontr_id = ? AND valid_to IS NULL AND version_no < ?`
      )
      .run(validFrom, input.kontrId, versionNo);
  }

  const f = input.fields;
  const inserted = (await db
    .prepare(
      `INSERT INTO kontragent_versions (
         kontr_id, guid, version_no, valid_from, valid_to, name, old_name, inn, kpp, ogrn,
         org_form, org_type, mandatory_rash, country, city, id_obdnsi, card_json, created_at, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`
    )
    .get(
      input.kontrId,
      guid,
      versionNo,
      validFrom,
      input.validTo ?? null,
      f.name,
      f.oldName ?? null,
      f.inn ?? null,
      f.kpp ?? null,
      f.ogrn ?? null,
      f.orgForm ?? null,
      f.orgType ?? null,
      f.mandatoryRash ? 1 : 0,
      f.country ?? null,
      f.city ?? null,
      f.idObdnsi ?? null,
      JSON.stringify(f.card ?? {}),
      now,
      input.createdBy ?? null
    )) as { id: number };

  // Keep current kontragents row in sync with latest version
  await db
    .prepare(
      `UPDATE kontragents SET
         name = ?, old_name = ?, inn = ?, kpp = ?, ogrn = ?, org_form = ?, org_type = ?,
         mandatory_rash = ?, country = ?, city = ?, id_obdnsi = ?, guid = ?
       WHERE id = ?`
    )
    .run(
      f.name,
      f.oldName ?? null,
      f.inn ?? null,
      f.kpp ?? null,
      f.ogrn ?? null,
      f.orgForm ?? null,
      f.orgType ?? null,
      f.mandatoryRash ? 1 : 0,
      f.country ?? null,
      f.city ?? null,
      f.idObdnsi ?? null,
      guid,
      input.kontrId
    );

  const row = (await db
    .prepare(`SELECT * FROM kontragent_versions WHERE id = ?`)
    .get(inserted.id)) as VerRow;
  return rowToDto(row);
}

export interface KontrUsageHit {
  formId: string;
  instanceId: string;
  eid: number | null;
  zid: number | null;
  rowNo: number | null;
  columnKey: string | null;
  source: "rash" | "cell_comment";
}

/**
 * Find usages of a kontragent before delete/archive. Best-effort across rash entries and comments.
 */
export async function findKontrUsages(
  db: OkoDb,
  kontrId: number,
  limit = 50
): Promise<KontrUsageHit[]> {
  const hits: KontrUsageHit[] = [];

  const comments = (await db
    .prepare(
      `SELECT cc.instance_id, cc.form_id, cc.row_no, cc.column_key, fi.eid, fi.zid
       FROM cell_comments cc
       LEFT JOIN form_instances fi ON fi.instance_id = cc.instance_id
       WHERE cc.kontr_id = ?
       LIMIT ?`
    )
    .all(kontrId, limit)) as Array<{
    instance_id: string;
    form_id: string;
    row_no: number;
    column_key: string;
    eid: number | null;
    zid: number | null;
  }>;
  for (const c of comments) {
    hits.push({
      formId: c.form_id,
      instanceId: c.instance_id,
      eid: c.eid,
      zid: c.zid,
      rowNo: c.row_no,
      columnKey: c.column_key,
      source: "cell_comment",
    });
  }

  // rash entries may store kontr id inside values_json — scan limited sample
  if (hits.length < limit) {
    const remaining = limit - hits.length;
    const rash = (await db
      .prepare(
        `SELECT re.instance_id, re.form_id, re.parent_row_no, fi.eid, fi.zid, re.values_json
         FROM form_rash_entries re
         LEFT JOIN form_instances fi ON fi.instance_id = re.instance_id
         WHERE re.values_json LIKE ?
         LIMIT ?`
      )
      .all(`%"kontrId":${kontrId}%`, remaining)) as Array<{
      instance_id: string;
      form_id: string;
      parent_row_no: number | null;
      eid: number | null;
      zid: number | null;
      values_json: string;
    }>;
    for (const r of rash) {
      hits.push({
        formId: r.form_id,
        instanceId: r.instance_id,
        eid: r.eid,
        zid: r.zid,
        rowNo: r.parent_row_no,
        columnKey: null,
        source: "rash",
      });
    }
  }

  return hits;
}

export async function archiveKontragent(
  db: OkoDb,
  kontrId: number,
  force = false
): Promise<{ archived: boolean; usages: KontrUsageHit[] }> {
  const usages = await findKontrUsages(db, kontrId, 20);
  if (usages.length > 0 && !force) {
    return { archived: false, usages };
  }
  await db.prepare(`UPDATE kontragents SET archived = 1 WHERE id = ?`).run(kontrId);
  return { archived: true, usages };
}
