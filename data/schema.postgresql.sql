-- OKO PostgreSQL schema (target production)
-- Source: data/schema.sql + server migrations

CREATE TABLE IF NOT EXISTS organizations (
    zid         INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    code        TEXT,
    parent_zid  INTEGER REFERENCES organizations(zid),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS periods (
    eid         INTEGER PRIMARY KEY,
    zid         INTEGER NOT NULL REFERENCES organizations(zid),
    name        TEXT NOT NULL,
    period_start DATE,
    period_end   DATE,
    quarter     INTEGER,
    year        INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS form_templates (
    form_id     TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    category    TEXT NOT NULL,
    pages       INTEGER DEFAULT 1,
    saldo_yellow TEXT,
    saldo_red   TEXT,
    saldo_blue  TEXT,
    sort_order  DOUBLE PRECISION,
    pdf_file    TEXT,
    allow_add_rows INTEGER DEFAULT 0,
    kontr_form  INTEGER DEFAULT 0,
    signatures_json TEXT DEFAULT '["Руководитель","Главный бухгалтер"]'
);

CREATE TABLE IF NOT EXISTS form_template_columns (
    id          SERIAL PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS form_template_rows (
    id          SERIAL PRIMARY KEY,
    form_id     TEXT NOT NULL REFERENCES form_templates(form_id) ON DELETE CASCADE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    row_num     TEXT,
    row_code    TEXT,
    row_name    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_form_rows_form ON form_template_rows(form_id, sort_order);

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
    created_at  TIMESTAMPTZ NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL,
    template_title TEXT,
    enterprise_code TEXT,
    signatures_json TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS form_cell_values (
    id          SERIAL PRIMARY KEY,
    instance_id TEXT NOT NULL REFERENCES form_instances(instance_id) ON DELETE CASCADE,
    row_no      INTEGER NOT NULL,
    row_name    TEXT,
    column_key  TEXT NOT NULL,
    value_num   DOUBLE PRECISION,
    value_text  TEXT,
    UNIQUE (instance_id, row_no, column_key)
);

CREATE INDEX IF NOT EXISTS idx_cells_instance ON form_cell_values(instance_id);
CREATE INDEX IF NOT EXISTS idx_cells_lookup ON form_cell_values(instance_id, row_no, column_key);
CREATE INDEX IF NOT EXISTS idx_instances_template ON form_instances(template_id);
CREATE INDEX IF NOT EXISTS idx_instances_period ON form_instances(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_instances_zid_eid ON form_instances(zid, eid);
CREATE INDEX IF NOT EXISTS idx_instances_package ON form_instances(zid, eid, template_id);

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

CREATE TABLE IF NOT EXISTS check_results (
    id          SERIAL PRIMARY KEY,
    run_id      TEXT NOT NULL,
    rule_number INTEGER NOT NULL REFERENCES check_rules(number),
    passed      INTEGER NOT NULL,
    left_value  DOUBLE PRECISION,
    right_value DOUBLE PRECISION,
    message     TEXT,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS excel_mappings (
    id              SERIAL PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS report_log (
    id          SERIAL PRIMARY KEY,
    action      TEXT NOT NULL,
    instance_id TEXT,
    entity_type TEXT,
    entity_id   TEXT,
    actor       TEXT,
    details     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_log_created ON report_log(created_at);

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
    id          SERIAL PRIMARY KEY,
    kod         INTEGER NOT NULL REFERENCES rash_rules(kod) ON DELETE CASCADE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    sum_title   TEXT NOT NULL,
    fld_type    TEXT NOT NULL DEFAULT 'Сумма'
);

CREATE INDEX IF NOT EXISTS idx_rash_addsum_kod ON rash_addsum(kod);
CREATE INDEX IF NOT EXISTS idx_rash_rules_ref ON rash_rules(ref_rows);

-- Cell → sp_rash.kod (a_stblROWs letter-cell binding)
CREATE TABLE IF NOT EXISTS rash_placements (
    id          SERIAL PRIMARY KEY,
    form_id     TEXT NOT NULL,
    row_no      TEXT NOT NULL,
    column_key  TEXT NOT NULL DEFAULT '',
    kod         INTEGER NOT NULL REFERENCES rash_rules(kod) ON DELETE CASCADE,
    UNIQUE (form_id, row_no, column_key)
);

CREATE INDEX IF NOT EXISTS idx_rash_placements_kod ON rash_placements(kod);
CREATE INDEX IF NOT EXISTS idx_rash_placements_form ON rash_placements(form_id);

CREATE TABLE IF NOT EXISTS form_rash_entries (
    id              SERIAL PRIMARY KEY,
    instance_id     TEXT NOT NULL REFERENCES form_instances(instance_id) ON DELETE CASCADE,
    form_id         TEXT NOT NULL,
    parent_row_no   INTEGER NOT NULL,
    column_key      TEXT,
    rash_kod        INTEGER NOT NULL REFERENCES rash_rules(kod),
    line_no         INTEGER NOT NULL DEFAULT 0,
    kontr_id        INTEGER,
    kontr_name      TEXT,
    inn             TEXT,
    kpp             TEXT,
    attr_a2         TEXT,
    attr_a3         TEXT,
    attr_a4         TEXT,
    values_json     TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_rash_entries_instance ON form_rash_entries(instance_id);
CREATE INDEX IF NOT EXISTS idx_rash_entries_lookup
  ON form_rash_entries(instance_id, form_id, parent_row_no, rash_kod);

CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    username        TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    display_name    TEXT,
    role            TEXT NOT NULL DEFAULT 'org',
    zid             INTEGER REFERENCES organizations(zid),
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_zid ON users(zid);

CREATE TABLE IF NOT EXISTS agg_list (
    id          SERIAL PRIMARY KEY,
    parent_zid  INTEGER NOT NULL REFERENCES organizations(zid) ON DELETE CASCADE,
    child_zid   INTEGER NOT NULL REFERENCES organizations(zid) ON DELETE CASCADE,
    included    INTEGER NOT NULL DEFAULT 1,
    UNIQUE(parent_zid, child_zid)
);

CREATE INDEX IF NOT EXISTS idx_agg_parent ON agg_list(parent_zid);
CREATE INDEX IF NOT EXISTS idx_agg_child ON agg_list(child_zid);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portal_instances (
    instance_id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    template_title TEXT NOT NULL,
    display_name TEXT NOT NULL,
    organization TEXT DEFAULT '',
    period_start TEXT DEFAULT '',
    period_end TEXT DEFAULT '',
    payload TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_portal_instances_template ON portal_instances(template_id);
CREATE INDEX IF NOT EXISTS idx_portal_instances_period ON portal_instances(period_start, period_end);

CREATE TABLE IF NOT EXISTS kontragents (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    org_form TEXT,
    inn TEXT,
    kpp TEXT,
    org_type INTEGER,
    mandatory_rash INTEGER DEFAULT 0,
    country TEXT,
    city TEXT,
    ogrn TEXT
);

CREATE INDEX IF NOT EXISTS idx_kontragents_name ON kontragents(name);
CREATE INDEX IF NOT EXISTS idx_kontragents_org_type ON kontragents(org_type);

CREATE INDEX IF NOT EXISTS idx_periods_zid ON periods(zid);
