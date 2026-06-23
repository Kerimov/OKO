import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FormCatalog, FormSchema, OkoFormInstance } from "@portal/types";
import { buildInitialRows } from "@portal/utils";
import {
  DB_FILE,
  migrateDb,
  PACKAGE_META,
  readPackageMetaFile,
  writePackageMetaFile,
  type PackageMeta,
} from "./schema.js";
import { countInstances, listSummaries, loadInstance, saveInstance } from "./instances.js";
import { PackageDatabase } from "./sqliteDb.js";
import {
  getRulesSyncInfo,
  importRulesBundle,
  readRulesFromPackageDb,
  type PackageRulesInput,
} from "./rulesDb.js";

export interface OpenPackageResult {
  folderPath: string;
  meta: PackageMeta;
  instanceCount: number;
}

export interface PackageSession {
  folderPath: string;
  dbPath: string;
  meta: PackageMeta;
  db: PackageDatabase;
}

let session: PackageSession | null = null;
let portalPublicPath: string | null = null;

export function setPortalPublicDir(dir: string): void {
  portalPublicPath = dir;
}

function portalPublicDir(): string {
  if (!portalPublicPath) {
    throw new Error("Не задан каталог данных форм (portal public)");
  }
  return portalPublicPath;
}

function schemasRoot(): string {
  return path.join(portalPublicDir(), "schemas");
}

function catalogPath(): string {
  return path.join(schemasRoot(), "catalog.json");
}

export function loadCatalogFromDisk(): FormCatalog {
  const raw = fs.readFileSync(catalogPath(), "utf8");
  return JSON.parse(raw) as FormCatalog;
}

export function loadSchemaFromDisk(formId: string): FormSchema {
  const p = path.join(schemasRoot(), `${formId}.json`);
  if (!fs.existsSync(p)) throw new Error(`Схема ${formId} не найдена`);
  return JSON.parse(fs.readFileSync(p, "utf8")) as FormSchema;
}

/** Чтение JSON: сначала из oko.db (импорт с ЦО), иначе из dist/portal public. */
export function readPublicJson(relativePath: string): unknown {
  const normalized = relativePath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (normalized.includes("..")) throw new Error("Недопустимый путь");

  if (session) {
    const fromDb = readRulesFromPackageDb(session.db, normalized);
    if (fromDb !== null) return fromDb;
  }

  const full = path.join(portalPublicDir(), normalized);
  if (!fs.existsSync(full)) throw new Error(`Файл не найден: ${relativePath}`);
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

function defaultDisplayName(templateId: string, title: string, org: string): string {
  return `${templateId} — ${title} (${org})`;
}

function ensureOkoDir(folderPath: string): void {
  const okoDir = path.join(folderPath, ".oko");
  if (!fs.existsSync(okoDir)) fs.mkdirSync(okoDir, { recursive: true });
}

export function closePackage(): void {
  if (session) {
    session.db.close();
    session = null;
  }
}

export function getSession(): PackageSession | null {
  return session;
}

export async function openPackageFolder(folderPath: string): Promise<OpenPackageResult> {
  closePackage();

  const metaPath = path.join(folderPath, PACKAGE_META);
  const dbPath = path.join(folderPath, DB_FILE);

  if (!fs.existsSync(metaPath)) {
    throw new Error("В папке нет package.meta.json. Создайте комплект или импортируйте JSON.");
  }

  const meta = readPackageMetaFile(metaPath);
  ensureOkoDir(folderPath);

  const db = await PackageDatabase.open(dbPath);
  migrateDb(db);

  session = { folderPath, dbPath, meta, db };

  return {
    folderPath,
    meta,
    instanceCount: countInstances(db, meta.zid, meta.eid),
  };
}

export async function createPackageInFolder(
  folderPath: string,
  metaInput: Omit<PackageMeta, "formatVersion" | "createdAt">,
  options?: { skipSeed?: boolean }
): Promise<OpenPackageResult> {
  closePackage();
  fs.mkdirSync(folderPath, { recursive: true });
  ensureOkoDir(folderPath);

  const meta: PackageMeta = {
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    settings: {
      heartbeatIntervalSec: 5,
      presenceStaleSec: 30,
      syncPollIntervalSec: 3,
      restrictExecutorsToAssignments: false,
    },
    ...metaInput,
  };

  writePackageMetaFile(path.join(folderPath, PACKAGE_META), meta);

  const dbPath = path.join(folderPath, DB_FILE);
  const db = await PackageDatabase.open(dbPath);
  migrateDb(db);
  session = { folderPath, dbPath, meta, db };

  if (!options?.skipSeed) {
    seedEmptyPackage(db, meta);
  }

  return {
    folderPath,
    meta,
    instanceCount: countInstances(db, meta.zid, meta.eid),
  };
}

export function seedEmptyPackage(db: PackageDatabase, meta: PackageMeta): { created: number } {
  const catalog = loadCatalogFromDisk();
  const now = new Date().toISOString();
  let created = 0;

  db.transaction(() => {
    for (const form of catalog.forms) {
      const existing = db
        .prepare(
          "SELECT 1 AS ok FROM form_instances WHERE zid = ? AND eid = ? AND template_id = ? LIMIT 1"
        )
        .get(meta.zid, meta.eid, form.id) as { ok: number } | undefined;
      if (existing) continue;

      const schema = loadSchemaFromDisk(form.id);
      const signatures: Record<string, string> = {};
      for (const name of schema.signatures) signatures[name] = "";

      const inst: OkoFormInstance = {
        instanceId: randomUUID(),
        templateId: schema.id,
        templateTitle: schema.title,
        displayName: defaultDisplayName(schema.id, schema.title, meta.organization),
        zid: meta.zid,
        eid: meta.eid,
        meta: {
          organization: meta.organization,
          enterpriseCode: meta.enterpriseCode,
          periodStart: meta.periodStart,
          periodEnd: meta.periodEnd,
          unit: schema.meta?.unit || "тыс.руб.",
        },
        rows: buildInitialRows(schema),
        signatures,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };
      saveInstance(db, inst);
      created++;
    }
  });

  return { created };
}

export interface ReportPackageInput {
  version: string;
  organization: string;
  periodStart: string;
  periodEnd: string;
  zid?: number | null;
  eid?: number | null;
  instances: OkoFormInstance[];
  rules?: PackageRulesInput;
}

export async function importJsonPackage(
  folderPath: string,
  pkg: ReportPackageInput
): Promise<OpenPackageResult> {
  const zid = pkg.zid ?? 1;
  const eid = pkg.eid ?? 1;
  const meta: Omit<PackageMeta, "formatVersion" | "createdAt"> = {
    zid,
    eid,
    organization: pkg.organization,
    periodStart: pkg.periodStart,
    periodEnd: pkg.periodEnd,
    enterpriseCode: pkg.instances[0]?.meta?.enterpriseCode ?? "1@1",
  };

  const result = await createPackageInFolder(folderPath, meta, { skipSeed: true });
  const db = session!.db;
  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare("DELETE FROM form_instances WHERE zid = ? AND eid = ?").run(zid, eid);
    for (const raw of pkg.instances) {
      const inst: OkoFormInstance = {
        ...raw,
        zid,
        eid,
        status: raw.status === "submitted" ? "submitted" : "draft",
        updatedAt: now,
        meta: {
          ...raw.meta,
          organization: pkg.organization || raw.meta.organization,
        },
      };
      saveInstance(db, inst);
    }
    if (pkg.rules) {
      importRulesBundle(db, pkg.rules);
    }
  });

  return {
    ...result,
    instanceCount: countInstances(db, zid, eid),
  };
}

export function listPackageInstances() {
  if (!session) throw new Error("Комплект не открыт");
  return listSummaries(session.db, session.meta.zid, session.meta.eid);
}

export function getPackageInstance(instanceId: string) {
  if (!session) throw new Error("Комплект не открыт");
  return loadInstance(session.db, instanceId);
}

export function savePackageInstance(inst: OkoFormInstance, userName?: string) {
  if (!session) throw new Error("Комплект не открыт");
  inst.updatedAt = new Date().toISOString();
  session.db.transaction(() => saveInstance(session.db, inst, userName));
  return inst;
}

export function loadAllPackageInstances(): OkoFormInstance[] {
  if (!session) throw new Error("Комплект не открыт");
  const summaries = listSummaries(session.db, session.meta.zid, session.meta.eid);
  const instances: OkoFormInstance[] = [];
  for (const s of summaries) {
    const inst = loadInstance(session.db, s.instanceId);
    if (inst) instances.push(inst);
  }
  return instances;
}

export function setPackageInstanceStatus(
  instanceId: string,
  status: "draft" | "submitted"
): OkoFormInstance {
  if (!session) throw new Error("Комплект не открыт");
  const inst = loadInstance(session.db, instanceId);
  if (!inst) throw new Error("Форма не найдена");
  inst.status = status;
  inst.updatedAt = new Date().toISOString();
  session.db.transaction(() => saveInstance(session.db, inst));
  return inst;
}

export function exportPackageJson(): ReportPackageInput {
  if (!session) throw new Error("Комплект не открыт");
  const { meta, db } = session;
  const summaries = listSummaries(db, meta.zid, meta.eid);
  const instances: OkoFormInstance[] = [];
  for (const s of summaries) {
    const inst = loadInstance(db, s.instanceId);
    if (inst) instances.push(inst);
  }
  return {
    version: "1.1",
    organization: meta.organization,
    periodStart: meta.periodStart,
    periodEnd: meta.periodEnd,
    zid: meta.zid,
    eid: meta.eid,
    instances,
  };
}

export function getPackageRulesInfo() {
  if (!session) throw new Error("Комплект не открыт");
  return getRulesSyncInfo(session.db);
}

export function getOsUserName(): string {
  return process.env.USERNAME || process.env.USER || "user";
}

export function getMachineName(): string {
  return process.env.COMPUTERNAME || process.env.HOSTNAME || "pc";
}
