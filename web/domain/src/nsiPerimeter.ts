import type { OkoDb } from "./oko-db.js";
import { getKontrVersionAt, type KontrVersionDto } from "./kontrVersions.js";

export type CardSectionKey = "basic" | "requisites" | "perimeter";

export interface PerimeterOrgRow {
  zid: number;
  name: string;
  code: string | null;
  unitKind: string | null;
  headZid: number | null;
  compositeCode: string | null;
  guid: string | null;
}

export interface PerimeterKontrRow {
  id: number;
  guid: string | null;
  name: string;
  inn: string | null;
  kpp: string | null;
  orgType: number | null;
  country: string | null;
  city: string | null;
  archived: boolean;
}

function parseJsonObj(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Return structured card sections for a kontr version (fallback to card_json). */
export function sectionsFromVersion(ver: KontrVersionDto & {
  sectionBasic?: Record<string, unknown>;
  sectionRequisites?: Record<string, unknown>;
  sectionPerimeter?: Record<string, unknown>;
}): Record<CardSectionKey, Record<string, unknown>> {
  const card = ver.card ?? {};
  return {
    basic:
      ver.sectionBasic && Object.keys(ver.sectionBasic).length
        ? ver.sectionBasic
        : {
            name: ver.name,
            oldName: ver.oldName,
            orgForm: ver.orgForm,
            orgType: ver.orgType,
            mandatoryRash: ver.mandatoryRash,
            ...(typeof card.basic === "object" && card.basic
              ? (card.basic as Record<string, unknown>)
              : {}),
          },
    requisites:
      ver.sectionRequisites && Object.keys(ver.sectionRequisites).length
        ? ver.sectionRequisites
        : {
            inn: ver.inn,
            kpp: ver.kpp,
            ogrn: ver.ogrn,
            country: ver.country,
            city: ver.city,
            idObdnsi: ver.idObdnsi,
            ...(typeof card.requisites === "object" && card.requisites
              ? (card.requisites as Record<string, unknown>)
              : {}),
          },
    perimeter:
      ver.sectionPerimeter && Object.keys(ver.sectionPerimeter).length
        ? ver.sectionPerimeter
        : typeof card.perimeter === "object" && card.perimeter
          ? (card.perimeter as Record<string, unknown>)
          : {},
  };
}

export async function getKontrCardSections(
  db: OkoDb,
  kontrId: number,
  asOf?: string
): Promise<{
  kontrId: number;
  guid: string | null;
  version: KontrVersionDto | null;
  sections: Record<CardSectionKey, Record<string, unknown>>;
}> {
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  let version = await getKontrVersionAt(db, kontrId, date);
  if (!version) {
    const latest = (await db
      .prepare(
        `SELECT * FROM kontragent_versions WHERE kontr_id = ? ORDER BY version_no DESC LIMIT 1`
      )
      .get(kontrId)) as
      | {
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
          section_basic_json?: string;
          section_requisites_json?: string;
          section_perimeter_json?: string;
        }
      | undefined;
    if (latest) {
      version = {
        id: Number(latest.id),
        kontrId: Number(latest.kontr_id),
        guid: latest.guid,
        versionNo: Number(latest.version_no),
        validFrom: latest.valid_from,
        validTo: latest.valid_to,
        name: latest.name,
        oldName: latest.old_name,
        inn: latest.inn,
        kpp: latest.kpp,
        ogrn: latest.ogrn,
        orgForm: latest.org_form,
        orgType: latest.org_type == null ? null : Number(latest.org_type),
        mandatoryRash: !!latest.mandatory_rash,
        country: latest.country,
        city: latest.city,
        idObdnsi: latest.id_obdnsi,
        card: parseJsonObj(latest.card_json),
        createdAt: latest.created_at,
        createdBy: latest.created_by,
      };
      return {
        kontrId,
        guid: version.guid,
        version,
        sections: sectionsFromVersion({
          ...version,
          sectionBasic: parseJsonObj(latest.section_basic_json),
          sectionRequisites: parseJsonObj(latest.section_requisites_json),
          sectionPerimeter: parseJsonObj(latest.section_perimeter_json),
        }),
      };
    }
  }

  const header = (await db
    .prepare(`SELECT id, guid, name FROM kontragents WHERE id = ?`)
    .get(kontrId)) as { id: number; guid: string | null; name: string } | undefined;
  if (!header) {
    const err = new Error("Kontragent not found");
    (err as Error & { status: number }).status = 404;
    throw err;
  }

  if (!version) {
    return {
      kontrId,
      guid: header.guid,
      version: null,
      sections: { basic: { name: header.name }, requisites: {}, perimeter: {} },
    };
  }

  const verRow = (await db
    .prepare(
      `SELECT section_basic_json, section_requisites_json, section_perimeter_json
       FROM kontragent_versions WHERE id = ?`
    )
    .get(version.id)) as
    | {
        section_basic_json?: string;
        section_requisites_json?: string;
        section_perimeter_json?: string;
      }
    | undefined;

  return {
    kontrId,
    guid: version.guid ?? header.guid,
    version,
    sections: sectionsFromVersion({
      ...version,
      sectionBasic: parseJsonObj(verRow?.section_basic_json),
      sectionRequisites: parseJsonObj(verRow?.section_requisites_json),
      sectionPerimeter: parseJsonObj(verRow?.section_perimeter_json),
    }),
  };
}

export async function updateKontrCardSection(
  db: OkoDb,
  input: {
    kontrId: number;
    section: CardSectionKey;
    data: Record<string, unknown>;
    actor?: string | null;
  }
): Promise<ReturnType<typeof getKontrCardSections> extends Promise<infer T> ? T : never> {
  const current = await getKontrCardSections(db, input.kontrId);
  const nextSections = { ...current.sections, [input.section]: input.data };
  const { createKontrVersion } = await import("./kontrVersions.js");
  const name =
    String(nextSections.basic.name ?? current.version?.name ?? "").trim() ||
    current.version?.name ||
    "Без названия";
  await createKontrVersion(db, {
    kontrId: input.kontrId,
    fields: {
      name,
      oldName: (nextSections.basic.oldName as string | null | undefined) ?? current.version?.oldName,
      inn: (nextSections.requisites.inn as string | null | undefined) ?? current.version?.inn,
      kpp: (nextSections.requisites.kpp as string | null | undefined) ?? current.version?.kpp,
      ogrn: (nextSections.requisites.ogrn as string | null | undefined) ?? current.version?.ogrn,
      orgForm:
        (nextSections.basic.orgForm as string | null | undefined) ?? current.version?.orgForm,
      orgType:
        (nextSections.basic.orgType as number | null | undefined) ?? current.version?.orgType,
      mandatoryRash: Boolean(
        nextSections.basic.mandatoryRash ?? current.version?.mandatoryRash ?? false
      ),
      country:
        (nextSections.requisites.country as string | null | undefined) ??
        current.version?.country,
      city:
        (nextSections.requisites.city as string | null | undefined) ?? current.version?.city,
      idObdnsi:
        (nextSections.requisites.idObdnsi as string | null | undefined) ??
        current.version?.idObdnsi,
      card: {
        ...(current.version?.card ?? {}),
        basic: nextSections.basic,
        requisites: nextSections.requisites,
        perimeter: nextSections.perimeter,
      },
    },
    createdBy: input.actor ?? null,
  });

  const latest = (await db
    .prepare(
      `SELECT id FROM kontragent_versions WHERE kontr_id = ? ORDER BY version_no DESC LIMIT 1`
    )
    .get(input.kontrId)) as { id: number };
  await db
    .prepare(
      `UPDATE kontragent_versions SET
         section_basic_json = ?,
         section_requisites_json = ?,
         section_perimeter_json = ?
       WHERE id = ?`
    )
    .run(
      JSON.stringify(nextSections.basic),
      JSON.stringify(nextSections.requisites),
      JSON.stringify(nextSections.perimeter),
      latest.id
    );

  return getKontrCardSections(db, input.kontrId);
}

export async function listPerimeterOrganizations(
  db: OkoDb,
  filter?: { q?: string; zid?: number }
): Promise<PerimeterOrgRow[]> {
  const params: unknown[] = [];
  let where = "1=1";
  if (filter?.zid != null) {
    where += " AND zid = ?";
    params.push(filter.zid);
  }
  if (filter?.q?.trim()) {
    where += " AND (name ILIKE ? OR code ILIKE ? OR CAST(zid AS TEXT) = ? OR guid ILIKE ?)";
    const q = `%${filter.q.trim()}%`;
    params.push(q, q, filter.q.trim(), q);
  }
  const rows = (await db
    .prepare(
      `SELECT zid, name, code, unit_kind, head_zid, composite_code, guid
       FROM organizations
       WHERE ${where}
       ORDER BY name
       LIMIT 500`
    )
    .all(...params)) as Array<{
    zid: number;
    name: string;
    code: string | null;
    unit_kind: string | null;
    head_zid: number | null;
    composite_code: string | null;
    guid: string | null;
  }>;
  return rows.map((r) => ({
    zid: Number(r.zid),
    name: r.name,
    code: r.code,
    unitKind: r.unit_kind,
    headZid: r.head_zid == null ? null : Number(r.head_zid),
    compositeCode: r.composite_code,
    guid: r.guid,
  }));
}

export async function listPerimeterKontragents(
  db: OkoDb,
  filter?: { q?: string; includeArchived?: boolean }
): Promise<PerimeterKontrRow[]> {
  const params: unknown[] = [];
  let where = filter?.includeArchived ? "1=1" : "COALESCE(archived,0) = 0";
  if (filter?.q?.trim()) {
    where +=
      " AND (name ILIKE ? OR inn ILIKE ? OR guid ILIKE ? OR CAST(id AS TEXT) = ?)";
    const q = `%${filter.q.trim()}%`;
    params.push(q, q, q, filter.q.trim());
  }
  const rows = (await db
    .prepare(
      `SELECT id, guid, name, inn, kpp, org_type, country, city, COALESCE(archived,0) AS archived
       FROM kontragents
       WHERE ${where}
       ORDER BY name
       LIMIT 500`
    )
    .all(...params)) as Array<{
    id: number;
    guid: string | null;
    name: string;
    inn: string | null;
    kpp: string | null;
    org_type: number | null;
    country: string | null;
    city: string | null;
    archived: number;
  }>;
  return rows.map((r) => ({
    id: Number(r.id),
    guid: r.guid,
    name: r.name,
    inn: r.inn,
    kpp: r.kpp,
    orgType: r.org_type == null ? null : Number(r.org_type),
    country: r.country,
    city: r.city,
    archived: !!r.archived,
  }));
}

export async function findKontrByGuid(
  db: OkoDb,
  guid: string
): Promise<PerimeterKontrRow | null> {
  const row = (await db
    .prepare(
      `SELECT id, guid, name, inn, kpp, org_type, country, city, COALESCE(archived,0) AS archived
       FROM kontragents WHERE guid = ? LIMIT 1`
    )
    .get(guid)) as
    | {
        id: number;
        guid: string | null;
        name: string;
        inn: string | null;
        kpp: string | null;
        org_type: number | null;
        country: string | null;
        city: string | null;
        archived: number;
      }
    | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    guid: row.guid,
    name: row.name,
    inn: row.inn,
    kpp: row.kpp,
    orgType: row.org_type == null ? null : Number(row.org_type),
    country: row.country,
    city: row.city,
    archived: !!row.archived,
  };
}
