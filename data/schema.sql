-- OKO analog database schema (SQLite / PostgreSQL compatible)
-- Source: z261.mdb structure

-- Organizations / data sets (a_tblZIDs, a_tblPERs)
CREATE TABLE IF NOT EXISTS organizations (
    zid         INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    code        TEXT,
    parent_zid  INTEGER REFERENCES organizations(zid),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reporting periods / subdivisions (EID)
CREATE TABLE IF NOT EXISTS periods (
    eid         INTEGER PRIMARY KEY,
    zid         INTEGER NOT NULL REFERENCES organizations(zid),
    name        TEXT NOT NULL,
    period_start DATE,
    period_end   DATE,
    quarter     INTEGER,
    year        INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Form template registry (FormCorrespondence)
CREATE TABLE IF NOT EXISTS form_templates (
    form_id     TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    category    TEXT NOT NULL,
    pages       INTEGER DEFAULT 1,
    saldo_yellow TEXT,
    saldo_red   TEXT,
    saldo_blue  TEXT,
    sort_order  REAL,
    pdf_file    TEXT,
    allow_add_rows INTEGER DEFAULT 0,
    kontr_form  INTEGER DEFAULT 0,
    signatures_json TEXT DEFAULT '["Руководитель","Главный бухгалтер"]'
);

-- Form columns (a_stblFIELDs)
CREATE TABLE IF NOT EXISTS form_template_columns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    form_id     TEXT NOT NULL REFERENCES form_templates(form_id) ON DELETE CASCADE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    column_key  TEXT NOT NULL,
    label       TEXT NOT NULL,
    col_type    TEXT NOT NULL DEFAULT 'number',
    width       INTEGER DEFAULT 100,
    frozen      INTEGER DEFAULT 0,
    readonly    INTEGER DEFAULT 0,
    f_total     INTEGER DEFAULT 0,
    UNIQUE (form_id, column_key)
);

CREATE INDEX IF NOT EXISTS idx_form_cols_form ON form_template_columns(form_id, sort_order);

-- Form rows (a_stblROWs)
CREATE TABLE IF NOT EXISTS form_template_rows (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    form_id     TEXT NOT NULL REFERENCES form_templates(form_id) ON DELETE CASCADE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    row_num     TEXT,
    row_code    TEXT,
    row_name    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_form_rows_form ON form_template_rows(form_id, sort_order);

-- Saved form instances (filled reports)
CREATE TABLE IF NOT EXISTS form_instances (
    instance_id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL REFERENCES form_templates(form_id),
    zid         INTEGER REFERENCES organizations(zid),
    eid         INTEGER REFERENCES periods(eid),
    display_name TEXT NOT NULL,
    organization TEXT,
    period_start DATE,
    period_end   DATE,
    unit        TEXT DEFAULT 'тыс.руб.',
    status      TEXT DEFAULT 'draft',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    template_title TEXT,
    enterprise_code TEXT,
    signatures_json TEXT DEFAULT '{}'
);

-- Cell values: one row per form line (Number = RowNo from a_stblROWs)
CREATE TABLE IF NOT EXISTS form_cell_values (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id TEXT NOT NULL REFERENCES form_instances(instance_id) ON DELETE CASCADE,
    row_no      INTEGER NOT NULL,
    row_name    TEXT,
    column_key  TEXT NOT NULL,
    value_num   REAL,
    value_text  TEXT,
    UNIQUE (instance_id, row_no, column_key)
);

CREATE INDEX IF NOT EXISTS idx_cells_instance ON form_cell_values(instance_id);
CREATE INDEX IF NOT EXISTS idx_cells_lookup ON form_cell_values(instance_id, row_no, column_key);
CREATE INDEX IF NOT EXISTS idx_instances_template ON form_instances(template_id);
CREATE INDEX IF NOT EXISTS idx_instances_period ON form_instances(period_start, period_end);

-- Validation rules (a_tblchecks)
CREATE TABLE IF NOT EXISTS check_rules (
    number          INTEGER PRIMARY KEY,
    expression      TEXT NOT NULL,
    expression_alt  TEXT,
    message         TEXT,
    for_aggr_only   INTEGER DEFAULT 0,
    first_level     INTEGER DEFAULT 0,
    active          INTEGER DEFAULT 0,
    period_active   INTEGER DEFAULT 0,
    period          TEXT,
    info            TEXT
);

-- Check run results
CREATE TABLE IF NOT EXISTS check_results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT NOT NULL,
    rule_number INTEGER NOT NULL REFERENCES check_rules(number),
    passed      INTEGER NOT NULL,
    left_value  REAL,
    right_value REAL,
    message     TEXT,
    evaluated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Saldo transfer rules (a_tblsaldo)
CREATE TABLE IF NOT EXISTS saldo_rules (
    number          INTEGER PRIMARY KEY,
    target_form     TEXT NOT NULL,
    target_column   TEXT NOT NULL,
    target_row      INTEGER NOT NULL,
    source_form     TEXT,
    source_column   TEXT,
    source_row      INTEGER,
    end_form        TEXT,
    end_column      TEXT,
    end_row         INTEGER,
    saldo_t         INTEGER DEFAULT 0,
    saldo_s         INTEGER DEFAULT 0,
    saldo_g         INTEGER DEFAULT 0,
    name            TEXT,
    conditional     INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_saldo_rules_target ON saldo_rules(target_form);
CREATE INDEX IF NOT EXISTS idx_saldo_rules_source ON saldo_rules(source_form);

-- Excel export mapping (tblExcelExport)
CREATE TABLE IF NOT EXISTS excel_mappings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    form_name       TEXT NOT NULL,
    sheet_name      TEXT,
    excel_row       INTEGER,
    excel_column    TEXT,
    form_column     TEXT,
    form_row        INTEGER,
    period          INTEGER DEFAULT 0,
    add_text        TEXT
);

CREATE INDEX IF NOT EXISTS idx_excel_mappings_form ON excel_mappings(form_name);

-- Audit log
CREATE TABLE IF NOT EXISTS report_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    action      TEXT NOT NULL,
    instance_id TEXT,
    entity_type TEXT,
    entity_id   TEXT,
    actor       TEXT,
    details     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_report_log_created ON report_log(created_at);

-- Rash / counterparty breakdown rules (sp_rash, sp_rash_addsum)
CREATE TABLE IF NOT EXISTS rash_rules (
    kod             INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    note            TEXT,
    ref_rows        TEXT,
    total_formula   TEXT,
    ref_a1_name     TEXT,
    ref_a1_title    TEXT,
    ref_a2_name     TEXT,
    ref_a2_title    TEXT,
    ref_a3_name     TEXT,
    ref_a3_title    TEXT,
    ref_a4_name     TEXT,
    ref_a4_title    TEXT
);

CREATE TABLE IF NOT EXISTS rash_addsum (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kod         INTEGER NOT NULL REFERENCES rash_rules(kod) ON DELETE CASCADE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    sum_title   TEXT NOT NULL,
    fld_type    TEXT NOT NULL DEFAULT 'Сумма'
);

CREATE INDEX IF NOT EXISTS idx_rash_addsum_kod ON rash_addsum(kod);

-- User accounts (org cabinets, Phase 3.5)
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash   TEXT NOT NULL,
    display_name    TEXT,
    role            TEXT NOT NULL DEFAULT 'org',
    zid             INTEGER REFERENCES organizations(zid),
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_zid ON users(zid);

-- Aggregation list (a_tblAgg_List): parent org sums child orgs
CREATE TABLE IF NOT EXISTS agg_list (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_zid  INTEGER NOT NULL REFERENCES organizations(zid) ON DELETE CASCADE,
    child_zid   INTEGER NOT NULL REFERENCES organizations(zid) ON DELETE CASCADE,
    included    INTEGER NOT NULL DEFAULT 1,
    UNIQUE(parent_zid, child_zid)
);

CREATE INDEX IF NOT EXISTS idx_agg_parent ON agg_list(parent_zid);
CREATE INDEX IF NOT EXISTS idx_agg_child ON agg_list(child_zid);
