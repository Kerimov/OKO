import type { OkoDb } from "../oko-db.js";
import type { Migration } from "./types.js";

/**
 * ПСД foundation: RBAC roles, collection units hierarchy, package kinds,
 * business-process monitoring, versioned NSI hooks, checks journal,
 * svod registry, transfer maps, integration stubs.
 */
export const psdFoundationMigration: Migration = {
  id: "005_psd_foundation",
  description:
    "PSD: roles, BP monitoring, org hierarchy, package kinds, kontr versions, checks journal, svods, transfers",
  async up(db: OkoDb) {
    // --- organizations hierarchy ---
    const orgCols: Array<[string, string]> = [
      ["unit_kind", "TEXT DEFAULT 'organization'"],
      ["head_zid", "INTEGER"],
      ["branch_code", "TEXT"],
      ["unit_code", "TEXT"],
      ["composite_code", "TEXT"],
      ["guid", "TEXT"],
    ];
    for (const [name, ddl] of orgCols) {
      if (!(await db.columnExists("organizations", name))) {
        await db.exec(`ALTER TABLE organizations ADD COLUMN ${name} ${ddl}`);
      }
    }

    // --- periods / packages: kind OKO|BALANCE ---
    if (!(await db.columnExists("periods", "package_kind"))) {
      await db.exec(`ALTER TABLE periods ADD COLUMN package_kind TEXT DEFAULT 'OKO'`);
    }
    if (!(await db.columnExists("periods", "collection_unit_zid"))) {
      await db.exec(`ALTER TABLE periods ADD COLUMN collection_unit_zid INTEGER`);
    }

    // --- users: extended PSD roles (legacy admin/org remain valid) ---
    if (!(await db.columnExists("users", "psd_role"))) {
      await db.exec(`ALTER TABLE users ADD COLUMN psd_role TEXT`);
    }
    if (!(await db.columnExists("users", "locale"))) {
      await db.exec(`ALTER TABLE users ADD COLUMN locale TEXT DEFAULT 'ru'`);
    }

    await db.exec(`
      UPDATE users SET psd_role = 'support_specialist' WHERE role = 'admin' AND (psd_role IS NULL OR psd_role = '');
      UPDATE users SET psd_role = 'subsidiary_specialist' WHERE role = 'org' AND (psd_role IS NULL OR psd_role = '');
    `);

    await db.exec(`
      UPDATE organizations SET unit_kind = 'organization' WHERE unit_kind IS NULL OR unit_kind = '';
      UPDATE organizations SET head_zid = zid WHERE head_zid IS NULL;
      UPDATE organizations SET composite_code = COALESCE(NULLIF(code, ''), CAST(zid AS TEXT))
        WHERE composite_code IS NULL OR composite_code = '';
      UPDATE periods SET package_kind = 'OKO' WHERE package_kind IS NULL OR package_kind = '';
      UPDATE periods SET collection_unit_zid = zid WHERE collection_unit_zid IS NULL;
    `);

    // --- business process monitoring ---
    await db.exec(`
      CREATE TABLE IF NOT EXISTS business_processes (
        id TEXT PRIMARY KEY,
        eid INTEGER NOT NULL,
        zid INTEGER NOT NULL,
        package_kind TEXT NOT NULL DEFAULT 'OKO',
        status TEXT NOT NULL DEFAULT 'not_started',
        curator_user_id INTEGER,
        deadline_at TEXT,
        iteration INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        last_changed_at TEXT,
        last_changed_by TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (eid, zid, package_kind)
      );
      CREATE INDEX IF NOT EXISTS idx_bp_status ON business_processes(status);
      CREATE INDEX IF NOT EXISTS idx_bp_curator ON business_processes(curator_user_id);
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS business_process_events (
        id SERIAL PRIMARY KEY,
        bp_id TEXT NOT NULL REFERENCES business_processes(id) ON DELETE CASCADE,
        from_status TEXT,
        to_status TEXT NOT NULL,
        actor TEXT,
        note TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bp_events_bp ON business_process_events(bp_id, created_at);
    `);

    // --- versioned contragents ---
    await db.exec(`
      CREATE TABLE IF NOT EXISTS kontragent_versions (
        id SERIAL PRIMARY KEY,
        kontr_id INTEGER NOT NULL,
        guid TEXT,
        version_no INTEGER NOT NULL DEFAULT 1,
        valid_from TEXT,
        valid_to TEXT,
        name TEXT NOT NULL,
        old_name TEXT,
        inn TEXT,
        kpp TEXT,
        ogrn TEXT,
        org_form TEXT,
        org_type INTEGER,
        mandatory_rash INTEGER DEFAULT 0,
        country TEXT,
        city TEXT,
        id_obdnsi TEXT,
        card_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        created_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_kontr_ver_kontr ON kontragent_versions(kontr_id, version_no);
      CREATE INDEX IF NOT EXISTS idx_kontr_ver_guid ON kontragent_versions(guid);
      CREATE INDEX IF NOT EXISTS idx_kontr_ver_valid ON kontragent_versions(valid_from, valid_to);
    `);

    if (!(await db.columnExists("kontragents", "guid"))) {
      await db.exec(`ALTER TABLE kontragents ADD COLUMN guid TEXT`);
    }
    if (!(await db.columnExists("kontragents", "archived"))) {
      await db.exec(`ALTER TABLE kontragents ADD COLUMN archived INTEGER DEFAULT 0`);
    }

    // --- check explanations / journal ---
    await db.exec(`
      CREATE TABLE IF NOT EXISTS check_explanations (
        id SERIAL PRIMARY KEY,
        zid INTEGER NOT NULL,
        eid INTEGER NOT NULL,
        package_kind TEXT NOT NULL DEFAULT 'OKO',
        rule_number INTEGER NOT NULL,
        form_id TEXT NOT NULL DEFAULT '',
        explanation TEXT NOT NULL,
        author TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_check_explanation
        ON check_explanations(zid, eid, package_kind, rule_number, form_id);
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS check_run_journal (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL,
        zid INTEGER NOT NULL,
        eid INTEGER NOT NULL,
        package_kind TEXT NOT NULL DEFAULT 'OKO',
        rule_number INTEGER,
        check_type TEXT,
        passed INTEGER NOT NULL DEFAULT 0,
        left_value DOUBLE PRECISION,
        right_value DOUBLE PRECISION,
        message TEXT,
        form_id TEXT,
        requires_explanation INTEGER NOT NULL DEFAULT 0,
        explanation_id INTEGER,
        actor TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_check_journal_run ON check_run_journal(run_id);
      CREATE INDEX IF NOT EXISTS idx_check_journal_pkg ON check_run_journal(zid, eid, package_kind);
    `);

    // --- svod registry ---
    await db.exec(`
      CREATE TABLE IF NOT EXISTS svod_definitions (
        id TEXT PRIMARY KEY,
        eid INTEGER NOT NULL,
        package_kind TEXT NOT NULL DEFAULT 'OKO',
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT,
        UNIQUE (eid, package_kind, code)
      );
      CREATE TABLE IF NOT EXISTS svod_members (
        id SERIAL PRIMARY KEY,
        svod_id TEXT NOT NULL REFERENCES svod_definitions(id) ON DELETE CASCADE,
        organization_guid TEXT,
        zid INTEGER,
        included INTEGER NOT NULL DEFAULT 1,
        head_company TEXT,
        flag_rsbu INTEGER DEFAULT 0,
        flag_mgk INTEGER DEFAULT 0,
        flag_nkdo INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_svod_members_svod ON svod_members(svod_id);
    `);

    // --- period / balance transfer maps ---
    await db.exec(`
      CREATE TABLE IF NOT EXISTS transfer_maps (
        id SERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        source_form TEXT NOT NULL,
        source_column TEXT,
        source_row TEXT,
        target_form TEXT NOT NULL,
        target_column TEXT,
        target_row TEXT,
        condition_json TEXT NOT NULL DEFAULT '{}',
        aggregation TEXT,
        exclude_rows TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_transfer_maps_kind ON transfer_maps(kind, active, sort_order);
    `);

    // --- MinFin export mappings ---
    await db.exec(`
      CREATE TABLE IF NOT EXISTS minfin_mappings (
        id SERIAL PRIMARY KEY,
        template_name TEXT NOT NULL,
        sheet_name TEXT,
        excel_row INTEGER,
        excel_column TEXT,
        form_id TEXT,
        form_column TEXT,
        form_row TEXT,
        sign_factor INTEGER NOT NULL DEFAULT 1,
        is_header INTEGER NOT NULL DEFAULT 0,
        period_token TEXT,
        active INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_minfin_template ON minfin_mappings(template_name, active);
    `);

    // --- cell comments (universal) ---
    await db.exec(`
      CREATE TABLE IF NOT EXISTS cell_comments (
        id SERIAL PRIMARY KEY,
        instance_id TEXT NOT NULL,
        form_id TEXT NOT NULL,
        row_no INTEGER NOT NULL,
        column_key TEXT NOT NULL,
        amount DOUBLE PRECISION,
        article_code TEXT,
        kontr_id INTEGER,
        free_text TEXT,
        author TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cell_comments_inst ON cell_comments(instance_id, row_no, column_key);
    `);

    // --- integration inbox for DO XML transport ---
    await db.exec(`
      CREATE TABLE IF NOT EXISTS do_transport_inbox (
        id TEXT PRIMARY KEY,
        filename TEXT,
        sha256 TEXT,
        status TEXT NOT NULL DEFAULT 'received',
        received_at TEXT NOT NULL,
        processed_at TEXT,
        actor TEXT,
        zid INTEGER,
        eid INTEGER,
        package_kind TEXT,
        validation_errors TEXT NOT NULL DEFAULT '[]',
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_do_inbox_status ON do_transport_inbox(status, received_at);
    `);

    // Backfill BP rows for existing periods
    const periods = (await db
      .prepare(`SELECT eid, zid, package_kind FROM periods`)
      .all()) as Array<{ eid: number; zid: number; package_kind: string | null }>;
    const now = new Date().toISOString();
    const ins = db.prepare(
      `INSERT INTO business_processes (
         id, eid, zid, package_kind, status, iteration, created_at, last_changed_at
       ) VALUES (?, ?, ?, ?, 'not_started', 0, ?, ?)
       ON CONFLICT (eid, zid, package_kind) DO NOTHING`
    );
    for (const p of periods) {
      const kind = p.package_kind || "OKO";
      const id = `bp-${p.zid}-${p.eid}-${kind}`;
      await ins.run(id, p.eid, p.zid, kind, now, now);
    }
  },
};
