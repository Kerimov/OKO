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
    sort_order  REAL
);

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
    updated_at  TEXT NOT NULL
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
    active          INTEGER DEFAULT 0,
    period_active   INTEGER DEFAULT 0
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
    saldo_type      TEXT CHECK (saldo_type IN ('t', 's', 'g'))
);

-- Excel export mapping (tblExcelExport)
CREATE TABLE IF NOT EXISTS excel_mappings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    form_name       TEXT NOT NULL,
    sheet_name      TEXT,
    excel_row       INTEGER,
    excel_column    TEXT,
    form_column     TEXT,
    form_row        INTEGER
);

-- Audit log
CREATE TABLE IF NOT EXISTS report_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    action      TEXT NOT NULL,
    instance_id TEXT,
    details     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
