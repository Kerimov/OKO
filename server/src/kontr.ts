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
         id, name, org_form, inn, kpp, org_type, mandatory_rash, country, city, ogrn
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        k.ogrn ?? null
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
      `SELECT id, name, org_form, inn, kpp, org_type, mandatory_rash, country, city, ogrn
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
  let sql = `SELECT id, name, org_form, inn, kpp, org_type, mandatory_rash, country, city, ogrn
             FROM kontragents WHERE 1=1`;

  if (orgTypes && orgTypes.length > 0) {
    sql += ` AND (org_type IN (${orgTypes.map(() => "?").join(",")}) OR name IN ('ПРОЧИЕ', 'ФИЗИЧЕСКИЕ ЛИЦА'))`;
    params.push(...orgTypes);
  }

  if (q) {
    sql += " AND (name LIKE ? OR inn LIKE ? OR kpp LIKE ?)";
    const like = `%${q}%`;
    params.push(like, like, like);
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
         id, name, org_form, inn, kpp, org_type, mandatory_rash, country, city, ogrn
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      input.ogrn ?? null
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
  };
}
