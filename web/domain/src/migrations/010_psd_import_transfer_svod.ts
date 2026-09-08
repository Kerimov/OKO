import type { OkoDb } from "../oko-db.js";
import type { Migration } from "./types.js";

/** Import provenance, reversible transfer patches, and materialized svod results. */
export const psdImportTransferSvodMigration: Migration = {
  id: "010_psd_import_transfer_svod",
  description: "PSD: TZ import batches, reversible transfers, svod results and detail mappings",
  async up(db: OkoDb) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS import_batches (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
        summary_json TEXT NOT NULL DEFAULT '{}', reject_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL, completed_at TEXT, actor TEXT
      );
      CREATE TABLE IF NOT EXISTS transfer_batches (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, source_zid INTEGER NOT NULL, source_eid INTEGER NOT NULL,
        target_zid INTEGER NOT NULL, target_eid INTEGER NOT NULL, dry_run INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL, summary_json TEXT NOT NULL DEFAULT '{}', actor TEXT, created_at TEXT NOT NULL,
        rolled_back_at TEXT, rolled_back_by TEXT
      );
      CREATE TABLE IF NOT EXISTS transfer_batch_patches (
        id SERIAL PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES transfer_batches(id) ON DELETE CASCADE,
        instance_id TEXT NOT NULL, row_no INTEGER NOT NULL, column_key TEXT NOT NULL,
        old_value TEXT, new_value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_transfer_batch_patches_batch ON transfer_batch_patches(batch_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_transfer_maps_deterministic ON transfer_maps
        (kind, source_form, COALESCE(source_column,''), COALESCE(source_row,''), target_form, COALESCE(target_column,''), COALESCE(target_row,''));
      CREATE UNIQUE INDEX IF NOT EXISTS uq_minfin_mappings_deterministic ON minfin_mappings
        (template_name, COALESCE(sheet_name,''), COALESCE(excel_row,-1), COALESCE(excel_column,''), COALESCE(form_id,''), COALESCE(form_column,''), COALESCE(form_row,''));
      CREATE TABLE IF NOT EXISTS svod_results (
        svod_id TEXT NOT NULL REFERENCES svod_definitions(id) ON DELETE CASCADE,
        eid INTEGER NOT NULL, package_kind TEXT NOT NULL, form_id TEXT NOT NULL, row_no INTEGER NOT NULL,
        column_key TEXT NOT NULL, value_num DOUBLE PRECISION NOT NULL, calculated_at TEXT NOT NULL,
        PRIMARY KEY (svod_id, eid, package_kind, form_id, row_no, column_key)
      );
      CREATE TABLE IF NOT EXISTS svod_detail_mappings (
        id SERIAL PRIMARY KEY, form_id TEXT NOT NULL, detail_form TEXT NOT NULL,
        source_column TEXT, source_row TEXT, target_column TEXT, target_row TEXT, active INTEGER NOT NULL DEFAULT 1,
        UNIQUE(form_id, detail_form, source_column, source_row, target_column, target_row)
      );
    `);
  },
};
