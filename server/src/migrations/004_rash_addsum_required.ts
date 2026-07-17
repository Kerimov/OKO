import type { OkoDb } from "../oko-db.js";
import type { Migration } from "./types.js";

/**
 * Repair migration: 003 gained the rash_addsum.required ALTER after some
 * databases had already recorded 003 as applied, leaving them without the column.
 */
export const rashAddsumRequiredMigration: Migration = {
  id: "004_rash_addsum_required",
  description: "ensure rash_addsum.required exists (003 ran before the column was added)",
  async up(db: OkoDb) {
    if (!(await db.columnExists("rash_addsum", "required"))) {
      await db.exec("ALTER TABLE rash_addsum ADD COLUMN required INTEGER NOT NULL DEFAULT 0");
    }
  },
};
