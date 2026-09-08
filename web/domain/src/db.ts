import fs from "fs";
import path from "path";
import { seedCheckRulesFromJson } from "./checks.js";
import { seedExcelMappingsFromJson } from "./excel.js";
import { migratePortalPayloadsToCells } from "./instances.js";
import { seedFormsFromJson } from "./forms.js";
import {
  seedFormCorrespondenceFromJson,
  seedSaldoRulesFromJson,
} from "./saldo.js";
import {
  seedDefaultPeriodIfMissing,
  seedOrganizationsFromSettings,
} from "./packages.js";
import { seedRashFromJson, seedPlacementsFromJson } from "./rash.js";
import {
  reimportKontrFromJson,
  seedKontrFromJson,
} from "./kontr.js";
import { seedBootstrapAdmin } from "./users.js";
import {
  seedAggFromJson,
  seedOrganizationsFromAggCodes,
} from "./aggregation.js";
import { migratePackageExchange } from "./packageExchange.js";
import { seedRecalcRulesFromJson } from "./spreadsheet.js";
import { runNumberedMigrations } from "./migrations/runner.js";
import { startBackgroundJobWorker } from "./jobs.js";
import { getDb, initDatabase, type OkoDb } from "./oko-db.js";
import { DATA_DIR, ROOT } from "./paths.js";
import { refreshUserAccountsCache } from "./auth.js";
import { loadRolePermissionCache } from "./rbac.js";

const KONTR_PATH = path.join(ROOT, "web", "portal", "public", "data", "kontr.json");

async function initSchema(database: OkoDb): Promise<void> {
  // Schema changes: numbered migrations only (015 absorbs former migrate*Tables DDL).
  await runNumberedMigrations(database);
  // Data transform: legacy zid/eid exchange → GUID PK (idempotent).
  await migratePackageExchange(database);
  await loadRolePermissionCache(database);

  const seededRecalc = await seedRecalcRulesFromJson(database);
  if (seededRecalc > 0) {
    console.log(`Seeded ${seededRecalc} recalc rules from recalc-rules.json`);
  }

  const seededAggOrgs = await seedOrganizationsFromAggCodes(database);
  if (seededAggOrgs > 0) {
    console.log(`Seeded ${seededAggOrgs} organizations from agg-list.json codes`);
  }
  const seededAgg = await seedAggFromJson(database);
  if (seededAgg > 0) {
    console.log(`Seeded ${seededAgg} aggregation rules from agg-list.json`);
  }
  const seededAdmin = await seedBootstrapAdmin(database);
  if (seededAdmin > 0) {
    console.log("Created bootstrap admin user (see OKO_BOOTSTRAP_ADMIN_* env)");
  }
  const seededOrgs = await seedOrganizationsFromSettings(database);
  if (seededOrgs > 0) {
    console.log("Seeded default organization and period (zid=1, eid=1)");
  }
  const seededPeriod = await seedDefaultPeriodIfMissing(database);
  if (seededPeriod > 0) {
    console.log("Seeded default period (eid=1) — periods table was empty");
  }
  const seededRash = await seedRashFromJson(database);
  if (seededRash > 0) {
    console.log(`Seeded ${seededRash} rash rules from rash-rules.json`);
  }
  const seededPlacements = await seedPlacementsFromJson(database);
  if (seededPlacements > 0) {
    console.log(`Seeded ${seededPlacements} rash cell placements from row-rash-index.json`);
  }
  const seededChecks = await seedCheckRulesFromJson(database);
  if (seededChecks > 0) {
    console.log(`Seeded ${seededChecks} check rules from checks.json`);
  }
  const seededForms = await seedFormsFromJson(database);
  if (seededForms > 0) {
    console.log(`Seeded ${seededForms} form templates from schemas`);
  }
  const seededCorrespondence = await seedFormCorrespondenceFromJson(database);
  if (seededCorrespondence > 0) {
    console.log(`Seeded saldo correspondence for ${seededCorrespondence} forms`);
  }
  const seededSaldo = await seedSaldoRulesFromJson(database);
  if (seededSaldo > 0) {
    console.log(`Seeded ${seededSaldo} saldo rules from saldo-rules.json`);
  }
  const seededExcel = await seedExcelMappingsFromJson(database);
  if (seededExcel > 0) {
    console.log(`Seeded ${seededExcel} excel mappings from excel-export.json`);
  }
  const migratedInstances = await migratePortalPayloadsToCells(database);
  if (migratedInstances > 0) {
    console.log(`Migrated ${migratedInstances} instances from payload to form_cell_values`);
  }
  const seededKontr = await seedKontrFromJson(database);
  if (seededKontr > 0) {
    console.log(`Seeded ${seededKontr} kontr agents from kontr.json`);
  } else if (process.env.OKO_REIMPORT_KONTR_ON_START === "1" && fs.existsSync(KONTR_PATH)) {
    const n = await reimportKontrFromJson(database);
    console.log(`Reimported ${n} kontr agents from kontr.json`);
  }
  await refreshUserAccountsCache();
}

export async function bootstrapDatabase(): Promise<OkoDb> {
  const database = await initDatabase();
  await initSchema(database);
  startBackgroundJobWorker(() => getDb());
  return database;
}

export { getDb, ROOT, DATA_DIR };
