import type { OkoDb } from "../oko-db.js";
import type { Migration } from "./types.js";

export const spreadsheetCellModelMigration: Migration = {
  id: "002_spreadsheet_cell_model",
  description: "form_cell_definitions, revisions, cell_change_log, recalc_rules columns",
  async up(db: OkoDb) {
    if (!(await db.columnExists("form_instances", "revision"))) {
      await db.exec("ALTER TABLE form_instances ADD COLUMN revision INTEGER DEFAULT 1");
    }
    if (!(await db.columnExists("form_instances", "template_schema_version"))) {
      await db.exec(
        "ALTER TABLE form_instances ADD COLUMN template_schema_version INTEGER DEFAULT 1"
      );
    }
  },
};
