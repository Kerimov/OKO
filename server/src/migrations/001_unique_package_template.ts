import { deleteInstanceFromDb } from "../instances.js";
import type { OkoDb } from "../oko-db.js";
import type { Migration } from "./types.js";

/**
 * Keep newest instance per (zid, eid, template_id), delete older duplicates,
 * then enforce uniqueness for package-scoped forms.
 */
export async function ensureUniquePackageTemplate(db: OkoDb): Promise<{
  removedDuplicates: number;
  indexCreated: boolean;
}> {
  const groups = (await db
    .prepare(
      `SELECT zid, eid, template_id, COUNT(*) AS c
       FROM form_instances
       WHERE zid IS NOT NULL AND eid IS NOT NULL
       GROUP BY zid, eid, template_id
       HAVING COUNT(*) > 1`
    )
    .all()) as Array<{ zid: number; eid: number; template_id: string; c: number }>;

  let removed = 0;
  for (const g of groups) {
    const rows = (await db
      .prepare(
        `SELECT instance_id FROM form_instances
         WHERE zid = ? AND eid = ? AND template_id = ?
         ORDER BY updated_at DESC, instance_id DESC`
      )
      .all(g.zid, g.eid, g.template_id)) as Array<{ instance_id: string }>;
    for (const row of rows.slice(1)) {
      await deleteInstanceFromDb(db, row.instance_id);
      removed++;
    }
  }

  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_form_instances_package_tpl
    ON form_instances (zid, eid, template_id)
    WHERE zid IS NOT NULL AND eid IS NOT NULL
  `);

  return { removedDuplicates: removed, indexCreated: true };
}

export const uniquePackageTemplateMigration: Migration = {
  id: "001_unique_package_template",
  description:
    "Unique (zid, eid, template_id) for package-scoped form_instances; dedupe first",
  up: async (db) => {
    await ensureUniquePackageTemplate(db);
  },
};
