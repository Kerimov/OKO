import type { OkoDb } from "../oko-db.js";
import type { Migration } from "./types.js";

/** Hot-path indexes for ~1000+ orgs / package workspace / bulk period open. */
export const scaleIndexesMigration: Migration = {
  id: "013_scale_indexes",
  description:
    "Indexes for organizations(name), periods(zid,quarter,year), business_processes(zid,eid)",
  async up(db: OkoDb) {
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_organizations_name ON organizations(name);
      CREATE INDEX IF NOT EXISTS idx_periods_zid_quarter_year ON periods(zid, quarter, year);
      CREATE INDEX IF NOT EXISTS idx_bp_zid_eid ON business_processes(zid, eid);
      CREATE INDEX IF NOT EXISTS idx_instances_zid_eid ON form_instances(zid, eid);
    `);
  },
};
