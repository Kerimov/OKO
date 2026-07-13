import fs from "fs";
import path from "path";
import {
  migrateCheckRulesTable,
  seedCheckRulesFromJson,
} from "./checks.js";
import {
  migrateExcelTables,
  seedExcelMappingsFromJson,
} from "./excel.js";
import {
  migrateInstanceTables,
  migratePortalPayloadsToCells,
} from "./instances.js";
import {
  migrateFormTables,
  seedFormsFromJson,
} from "./forms.js";
import {
  migrateSaldoTables,
  seedFormCorrespondenceFromJson,
  seedSaldoRulesFromJson,
} from "./saldo.js";
import { migrateAuditTable } from "./audit.js";
import { migrateOrgTables, seedOrganizationsFromSettings } from "./packages.js";
import { migrateRashTables, seedRashFromJson, seedPlacementsFromJson } from "./rash.js";
import { migrateRashDataTables } from "./rash-data.js";
import {
  migrateKontrTable,
  reimportKontrFromJson,
  seedKontrFromJson,
} from "./kontr.js";
import { migrateUserTables, seedBootstrapAdmin } from "./users.js";
import {
  migrateAggTables,
  seedAggFromJson,
  seedOrganizationsFromAggCodes,
} from "./aggregation.js";
import { getDb, initDatabase, type OkoDb } from "./oko-db.js";
import { DATA_DIR, DB_PATH, ROOT } from "./paths.js";
import { refreshUserAccountsCache } from "./auth.js";

const KONTR_PATH = path.join(ROOT, "portal", "public", "data", "kontr.json");

async function initSchema(database: OkoDb): Promise<void> {
  await migrateCheckRulesTable(database);
  await migrateFormTables(database);
  await migrateSaldoTables(database);
  await migrateExcelTables(database);
  await migrateInstanceTables(database);
  await migrateRashTables(database);
  await migrateRashDataTables(database);
  await migrateKontrTable(database);
  await migrateAuditTable(database);
  await migrateOrgTables(database);
  await migrateUserTables(database);
  await migrateAggTables(database);

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
  return database;
}

export { getDb, DB_PATH, ROOT, DATA_DIR };
