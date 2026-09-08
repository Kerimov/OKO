import type { OkoDb } from "../oko-db.js";
import type { Migration } from "./types.js";

/**
 * NSI card 3.1 structured sections, GUID uniqueness, archival-safe kontr model.
 */
export const psdNsiCardMigration: Migration = {
  id: "009_psd_nsi_card",
  description: "PSD: structured kontr card sections, GUID uniqueness, archived flag",
  async up(db: OkoDb) {
    if (!(await db.columnExists("kontragents", "guid"))) {
      await db.exec(`ALTER TABLE kontragents ADD COLUMN guid TEXT`);
    }
    if (!(await db.columnExists("kontragents", "archived"))) {
      await db.exec(`ALTER TABLE kontragents ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
    }
    if (!(await db.columnExists("kontragent_versions", "section_basic_json"))) {
      await db.exec(
        `ALTER TABLE kontragent_versions ADD COLUMN section_basic_json TEXT NOT NULL DEFAULT '{}'`
      );
    }
    if (!(await db.columnExists("kontragent_versions", "section_requisites_json"))) {
      await db.exec(
        `ALTER TABLE kontragent_versions ADD COLUMN section_requisites_json TEXT NOT NULL DEFAULT '{}'`
      );
    }
    if (!(await db.columnExists("kontragent_versions", "section_perimeter_json"))) {
      await db.exec(
        `ALTER TABLE kontragent_versions ADD COLUMN section_perimeter_json TEXT NOT NULL DEFAULT '{}'`
      );
    }

    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_kontragents_guid
        ON kontragents(guid) WHERE guid IS NOT NULL AND guid <> '';
      CREATE UNIQUE INDEX IF NOT EXISTS uq_kontragent_versions_kontr_ver
        ON kontragent_versions(kontr_id, version_no);
      CREATE INDEX IF NOT EXISTS idx_kontragents_archived ON kontragents(archived);
    `);

    // Backfill missing GUIDs from versions or generate stable placeholders by id.
    await db.exec(`
      UPDATE kontragents k
      SET guid = v.guid
      FROM (
        SELECT DISTINCT ON (kontr_id) kontr_id, guid
        FROM kontragent_versions
        WHERE guid IS NOT NULL AND guid <> ''
        ORDER BY kontr_id, version_no DESC
      ) v
      WHERE k.id = v.kontr_id AND (k.guid IS NULL OR k.guid = '');
    `);
    await db.exec(`
      UPDATE kontragents
      SET guid = 'kontr-' || id::text
      WHERE guid IS NULL OR guid = '';
    `);
    await db.exec(`
      UPDATE kontragent_versions kv
      SET guid = k.guid
      FROM kontragents k
      WHERE kv.kontr_id = k.id AND (kv.guid IS NULL OR kv.guid = '');
    `);
  },
};
