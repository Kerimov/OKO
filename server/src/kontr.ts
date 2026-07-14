import fs from "fs";
import path from "path";
import type { OkoDb } from "./oko-db.js";
import { ROOT } from "./paths.js";

const KONTR_PATH = path.join(ROOT, "portal", "public", "data", "kontr.json");

export interface KontrAgentDto {
  id: number;
  name: string;
  orgForm?: string | null;
  inn?: string | null;
  kpp?: string | null;
  orgType?: number | null;
  mandatoryRash?: boolean;
  country?: string | null;
  city?: string | null;
  ogrn?: string | null;
  /** Access OldName — «Другое наименование» */
  oldName?: string | null;
  /** Access idOBDNSI / GUID для Excel ОБДНСИ */
  idObdnsi?: string | null;
}

interface KontrJsonPayload {
  version?: string;
  source?: string;
  total?: number;
  items: KontrAgentDto[];
}

function rowToDto(row: {
  id: number;
  name: string;
  org_form: string | null;
  inn: string | null;
  kpp: string | null;
  org_type: number | null;
  mandatory_rash: number | null;
  country: string | null;
  city: string | null;
  ogrn: string | null;
  old_name?: string | null;
  id_obdnsi?: string | null;
}): KontrAgentDto {
  return {
    id: row.id,
    name: row.name,
    orgForm: row.org_form,
    inn: row.inn,
    kpp: row.kpp,
    orgType: row.org_type,
    mandatoryRash: row.mandatory_rash === 1,
    country: row.country,
    city: row.city,
    ogrn: row.ogrn,
    oldName: row.old_name ?? null,
    idObdnsi: row.id_obdnsi ?? null,
  };
}

export function loadKontrJsonPayload(): KontrJsonPayload {
  if (!fs.existsSync(KONTR_PATH)) {
    return { items: [] };
  }
  return JSON.parse(fs.readFileSync(KONTR_PATH, "utf-8")) as KontrJsonPayload;
}

export async function migrateKontrTable(db: OkoDb): Promise<void> {
  const cols: Array<[string, string]> = [
    ["org_type", "INTEGER"],
    ["mandatory_rash", "INTEGER DEFAULT 0"],
    ["country", "TEXT"],
    ["city", "TEXT"],
    ["ogrn", "TEXT"],
    ["old_name", "TEXT"],
    ["id_obdnsi", "TEXT"],
  ];
  for (const [name, ddl] of cols) {
    if (!(await db.columnExists("kontragents", name))) {
      await db.exec(`ALTER TABLE kontragents ADD COLUMN ${name} ${ddl}`);
    }
  }
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_kontragents_name ON kontragents(name)"
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_kontragents_org_type ON kontragents(org_type)"
  );
}

export async function importKontrPayload(
  db: OkoDb,
  payload: KontrJsonPayload
): Promise<number> {
  const items = payload.items ?? [];
  await db.transaction(async (tx) => {
    await tx.exec("DELETE FROM kontragents");
    const insert = tx.prepare(
      `INSERT INTO kontragents (
         id, name, org_form, inn, kpp, org_type, mandatory_rash, country, city, ogrn, old_name, id_obdnsi
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const k of items) {
      await insert.run(
        k.id,
        k.name,
        k.orgForm ?? null,
        k.inn ?? null,
        k.kpp ?? null,
        k.orgType ?? null,
        k.mandatoryRash ? 1 : 0,
        k.country ?? null,
        k.city ?? null,
        k.ogrn ?? null,
        k.oldName ?? null,
        k.idObdnsi ?? null
      );
    }
  });
  return items.length;
}

export async function seedKontrFromJson(db: OkoDb): Promise<number> {
  const count = (
    (await db.prepare("SELECT COUNT(*) AS c FROM kontragents").get()) as { c: number }
  ).c;
  if (count > 0) return 0;
  return reimportKontrFromJson(db);
}

export async function reimportKontrFromJson(db: OkoDb): Promise<number> {
  return importKontrPayload(db, loadKontrJsonPayload());
}

export async function listKontrAgents(db: OkoDb): Promise<KontrAgentDto[]> {
  const rows = (await db
    .prepare(
      `SELECT id, name, org_form, inn, kpp, org_type, mandatory_rash, country, city, ogrn, old_name, id_obdnsi
       FROM kontragents ORDER BY name`
    )
    .all()) as Array<{
    id: number;
    name: string;
    org_form: string | null;
    inn: string | null;
    kpp: string | null;
    org_type: number | null;
    mandatory_rash: number | null;
    country: string | null;
    city: string | null;
    ogrn: string | null;
    old_name: string | null;
    id_obdnsi: string | null;
  }>;
  return rows.map(rowToDto);
}

export async function searchKontrAgents(
  db: OkoDb,
  query: string,
  orgTypes: number[] | null,
  limit: number
): Promise<KontrAgentDto[]> {
  const q = query.trim();
  const cap = Math.min(Math.max(limit, 1), 500);
  const params: unknown[] = [];
  let sql = `SELECT id, name, org_form, inn, kpp, org_type, mandatory_rash, country, city, ogrn, old_name, id_obdnsi
             FROM kontragents WHERE 1=1`;

  if (orgTypes && orgTypes.length > 0) {
    sql += ` AND (org_type IN (${orgTypes.map(() => "?").join(",")}) OR name IN ('ПРОЧИЕ', 'ФИЗИЧЕСКИЕ ЛИЦА'))`;
    params.push(...orgTypes);
  }

  if (q) {
    sql += " AND (name LIKE ? OR inn LIKE ? OR kpp LIKE ? OR COALESCE(old_name,'') LIKE ? OR COALESCE(id_obdnsi,'') LIKE ?)";
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }

  sql += " ORDER BY name LIMIT ?";
  params.push(cap);

  const rows = (await db.prepare(sql).all(...params)) as Array<{
    id: number;
    name: string;
    org_form: string | null;
    inn: string | null;
    kpp: string | null;
    org_type: number | null;
    mandatory_rash: number | null;
    country: string | null;
    city: string | null;
    ogrn: string | null;
    old_name: string | null;
    id_obdnsi: string | null;
  }>;
  return rows.map(rowToDto);
}

export async function getKontrStats(db: OkoDb): Promise<{ total: number }> {
  const total = (
    (await db.prepare("SELECT COUNT(*) AS c FROM kontragents").get()) as { c: number }
  ).c;
  return { total };
}

export async function createKontrAgent(
  db: OkoDb,
  input: Omit<KontrAgentDto, "id"> & { name: string }
): Promise<KontrAgentDto> {
  const maxId = (await db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM kontragents").get()) as {
    m: number;
  };
  const id = maxId.m + 1;
  await db
    .prepare(
      `INSERT INTO kontragents (
         id, name, org_form, inn, kpp, org_type, mandatory_rash, country, city, ogrn, old_name, id_obdnsi
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name,
      input.orgForm ?? null,
      input.inn ?? null,
      input.kpp ?? null,
      input.orgType ?? null,
      input.mandatoryRash ? 1 : 0,
      input.country ?? null,
      input.city ?? null,
      input.ogrn ?? null,
      input.oldName ?? null,
      input.idObdnsi ?? null
    );
  return {
    id,
    name: input.name,
    orgForm: input.orgForm,
    inn: input.inn,
    kpp: input.kpp,
    orgType: input.orgType ?? null,
    mandatoryRash: !!input.mandatoryRash,
    country: input.country,
    city: input.city,
    ogrn: input.ogrn,
    oldName: input.oldName ?? null,
    idObdnsi: input.idObdnsi ?? null,
  };
}

export async function updateKontrAgent(
  db: OkoDb,
  id: number,
  patch: Partial<Omit<KontrAgentDto, "id">>
): Promise<KontrAgentDto> {
  const existing = (await db
    .prepare(
      `SELECT id, name, org_form, inn, kpp, org_type, mandatory_rash, country, city, ogrn, old_name, id_obdnsi
       FROM kontragents WHERE id = ?`
    )
    .get(id)) as
    | {
        id: number;
        name: string;
        org_form: string | null;
        inn: string | null;
        kpp: string | null;
        org_type: number | null;
        mandatory_rash: number | null;
        country: string | null;
        city: string | null;
        ogrn: string | null;
        old_name: string | null;
        id_obdnsi: string | null;
      }
    | undefined;
  if (!existing) throw new Error("Kontr agent not found");

  const next = {
    name: patch.name ?? existing.name,
    orgForm: patch.orgForm !== undefined ? patch.orgForm : existing.org_form,
    inn: patch.inn !== undefined ? patch.inn : existing.inn,
    kpp: patch.kpp !== undefined ? patch.kpp : existing.kpp,
    orgType: patch.orgType !== undefined ? patch.orgType : existing.org_type,
    mandatoryRash:
      patch.mandatoryRash !== undefined
        ? patch.mandatoryRash
        : existing.mandatory_rash === 1,
    country: patch.country !== undefined ? patch.country : existing.country,
    city: patch.city !== undefined ? patch.city : existing.city,
    ogrn: patch.ogrn !== undefined ? patch.ogrn : existing.ogrn,
    oldName: patch.oldName !== undefined ? patch.oldName : existing.old_name,
    idObdnsi: patch.idObdnsi !== undefined ? patch.idObdnsi : existing.id_obdnsi,
  };

  await db
    .prepare(
      `UPDATE kontragents SET
         name = ?, org_form = ?, inn = ?, kpp = ?, org_type = ?, mandatory_rash = ?,
         country = ?, city = ?, ogrn = ?, old_name = ?, id_obdnsi = ?
       WHERE id = ?`
    )
    .run(
      next.name,
      next.orgForm ?? null,
      next.inn ?? null,
      next.kpp ?? null,
      next.orgType ?? null,
      next.mandatoryRash ? 1 : 0,
      next.country ?? null,
      next.city ?? null,
      next.ogrn ?? null,
      next.oldName ?? null,
      next.idObdnsi ?? null,
      id
    );

  return { id, ...next };
}

/** Access «Другое наименование»: current name → oldName, then apply new name. */
export async function renameKontrAgent(
  db: OkoDb,
  id: number,
  newName: string
): Promise<KontrAgentDto> {
  const name = newName.trim();
  if (!name) throw new Error("name required");
  const existing = (await db
    .prepare(`SELECT name, old_name FROM kontragents WHERE id = ?`)
    .get(id)) as { name: string; old_name: string | null } | undefined;
  if (!existing) throw new Error("Kontr agent not found");
  if (existing.name === name) {
    return updateKontrAgent(db, id, {});
  }
  const oldName =
    existing.old_name && existing.old_name.trim()
      ? existing.old_name
      : existing.name;
  return updateKontrAgent(db, id, { name, oldName });
}
