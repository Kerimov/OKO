import cors from "cors";
import express from "express";
import fs from "fs";
import path from "path";
import {
  dtoToRow,
  exportChecksPayload,
  getChecksStats,
  reimportCheckRulesFromJson,
  rowToDto,
  type CheckRuleDto,
  type CheckRuleRow,
} from "./checks.js";
import {
  exportCatalog,
  loadFormSchema,
  reimportFormsFromJson,
  replaceFormColumns,
  replaceFormRows,
  updateFormMeta,
  type FormColumnDto,
  type FormRowDto,
  type FormSchemaDto,
} from "./forms.js";
import {
  createExcelMapping,
  deleteExcelMapping,
  exportExcelPayload,
  getExcelMapping,
  getExcelStats,
  reimportExcelMappingsFromJson,
  rowToDto as excelRowToDto,
  updateExcelMapping,
  type ExcelMappingDto,
  type ExcelMappingRow,
} from "./excel.js";
import {
  dtoToRow as saldoDtoToRow,
  exportFormCorrespondencePayload,
  exportSaldoPayload,
  getFormCorrespondence,
  getSaldoStats,
  reimportFormCorrespondenceFromJson,
  reimportSaldoRulesFromJson,
  rowToDto as saldoRowToDto,
  updateFormCorrespondence,
  type FormCorrespondenceDto,
  type SaldoRuleDto,
  type SaldoRuleRow,
} from "./saldo.js";
import { getDb } from "./db.js";
import { ROOT } from "./paths.js";
import {
  auditMiddleware,
  listAuditLog,
} from "./audit.js";
import {
  authMiddleware,
  getAuthConfig,
  loginHandler,
  logoutHandler,
  requireAdmin,
  userWriteGuard,
} from "./auth.js";
import {
  assertOrgInstanceAccess,
  assertOrgZidParam,
  enforceOrgInstanceWrite,
  handleOrgError,
  mergeOrgFilter,
  userZid,
} from "./orgScope.js";
import {
  buildEvalSnapshotFromDb,
  assertInstanceEditable,
  deleteInstanceFromDb,
  getInstanceStorageStats,
  listInstanceSummaries,
  loadInstance,
  migratePortalPayloadsToCells,
  setInstanceStatus,
  upsertInstance,
} from "./instances.js";
import {
  createOrganization,
  createPeriod,
  createReportPackage,
  getPackageCompleteness,
  getPackagesDashboard,
  getWorkContext,
  listOrganizations,
  listPeriods,
  setWorkContext,
} from "./packages.js";
import {
  deleteRashRule,
  exportRashPayload,
  getRashRule,
  getRashStats,
  getRashThresholds,
  listRashAddsum,
  reimportRashFromJson,
  rowToDto as rashRowToDto,
  setRashThresholds,
  upsertRashRule,
  type RashRuleDto,
  type RashRuleRow,
  type RashThresholdsDto,
} from "./rash.js";
import type { OkoFormInstance } from "./types.js";
import {
  createUser,
  getUserById,
  listUsers,
  updateUser,
} from "./users.js";

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.get("/api/health", (_req, res) => {
  const stats = getInstanceStorageStats(getDb());
  res.json({ ok: true, db: "sqlite", cells: stats, auth: getAuthConfig() });
});

app.use(authMiddleware);
app.use(auditMiddleware);
app.use(userWriteGuard);

app.get("/api/auth/me", (req, res) => {
  const config = getAuthConfig();
  let user: Record<string, unknown> | null = null;
  if (req.apiUser) {
    const dto = getUserById(getDb(), req.apiUser.id);
    if (dto) {
      user = {
        id: dto.id,
        username: dto.username,
        displayName: dto.displayName,
        role: dto.role,
        zid: dto.zid,
        organizationName: dto.organizationName ?? null,
      };
    }
  }
  res.json({
    role: req.apiRole ?? null,
    user,
    ...config,
  });
});

app.post("/api/auth/login", loginHandler);
app.post("/api/auth/logout", logoutHandler);

app.get("/api/audit", requireAdmin, (req, res) => {
  const q = String(req.query.q ?? "");
  const limit = Number(req.query.limit) || 50;
  const offset = Number(req.query.offset) || 0;
  res.json(listAuditLog(getDb(), { q, limit, offset }));
});

app.get("/api/settings", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM app_settings").all() as Array<{
    key: string;
    value: string;
  }>;
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

app.put("/api/settings", (req, res) => {
  const db = getDb();
  const body = req.body as Record<string, string>;
  const upsert = db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const tx = () => {
    db.exec("BEGIN");
    try {
      for (const [key, value] of Object.entries(body)) {
        const stored = typeof value === "string" ? value : JSON.stringify(value);
        upsert.run(key, stored);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  tx();
  res.json({ ok: true });
});

app.get("/api/instances/stats", (_req, res) => {
  res.json(getInstanceStorageStats(getDb()));
});

app.get("/api/instances/eval-snapshot", (req, res) => {
  const zid = userZid(req);
  res.json(buildEvalSnapshotFromDb(getDb(), zid ?? undefined));
});

app.post("/api/instances/normalize", (_req, res) => {
  try {
    const count = migratePortalPayloadsToCells(getDb());
    res.json({ migrated: count });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "normalize failed" });
  }
});

app.get("/api/instances", (req, res) => {
  const zidRaw = req.query.zid;
  const eidRaw = req.query.eid;
  const filter =
    zidRaw != null || eidRaw != null
      ? {
          zid: zidRaw != null ? Number(zidRaw) : undefined,
          eid: eidRaw != null ? Number(eidRaw) : undefined,
        }
      : undefined;
  res.json(listInstanceSummaries(getDb(), mergeOrgFilter(req, filter)));
});

app.get("/api/instances/:id", (req, res) => {
  const inst = loadInstance(getDb(), req.params.id);
  if (!inst) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  try {
    assertOrgInstanceAccess(req, inst);
  } catch (e) {
    if (handleOrgError(res, e)) return;
    throw e;
  }
  res.json(inst);
});

app.post("/api/instances", (req, res) => {
  try {
    const inst = enforceOrgInstanceWrite(req, req.body as OkoFormInstance);
    if (!inst.status) inst.status = "draft";
    upsertInstance(getDb(), inst);
    res.status(201).json(inst);
  } catch (e) {
    if (handleOrgError(res, e)) return;
    res.status(500).json({ error: e instanceof Error ? e.message : "save failed" });
  }
});

app.put("/api/instances/:id", (req, res) => {
  const inst = req.body as OkoFormInstance;
  if (inst.instanceId !== req.params.id) {
    res.status(400).json({ error: "ID mismatch" });
    return;
  }
  try {
    const existing = loadInstance(getDb(), req.params.id);
    if (existing) {
      assertOrgInstanceAccess(req, existing);
      assertInstanceEditable(existing, req.apiRole === "admin");
    }
    const scoped = enforceOrgInstanceWrite(req, inst);
    upsertInstance(getDb(), scoped);
    res.json(scoped);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) {
      res.status(403).json({ error: err.message });
      return;
    }
    if (handleOrgError(res, e)) return;
    res.status(500).json({ error: e instanceof Error ? e.message : "save failed" });
  }
});

app.patch("/api/instances/:id/status", (req, res) => {
  const { status } = req.body as { status?: string };
  if (status !== "draft" && status !== "submitted") {
    res.status(400).json({ error: "status must be draft or submitted" });
    return;
  }
  try {
    const existing = loadInstance(getDb(), req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    assertOrgInstanceAccess(req, existing);
    if (status === "draft" && req.apiRole !== "admin") {
      res.status(403).json({ error: "Only admin can reopen submitted forms" });
      return;
    }
    const updated = setInstanceStatus(getDb(), req.params.id, status);
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(updated);
  } catch (e) {
    if (handleOrgError(res, e)) return;
    res.status(500).json({ error: e instanceof Error ? e.message : "status update failed" });
  }
});

app.delete("/api/instances/:id", (req, res) => {
  try {
    const existing = loadInstance(getDb(), req.params.id);
    if (existing) assertOrgInstanceAccess(req, existing);
    deleteInstanceFromDb(getDb(), req.params.id);
    res.json({ ok: true });
  } catch (e) {
    if (handleOrgError(res, e)) return;
    res.status(500).json({ error: e instanceof Error ? e.message : "delete failed" });
  }
});

app.post("/api/instances/migrate", (req, res) => {
  const { instances, settings } = req.body as {
    instances?: OkoFormInstance[];
    settings?: Record<string, string>;
  };
  if (settings) {
    const db = getDb();
    const upsert = db.prepare(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
    for (const [key, value] of Object.entries(settings)) {
      const stored = typeof value === "string" ? value : JSON.stringify(value);
      upsert.run(key, stored);
    }
  }
  let count = 0;
  for (const inst of instances ?? []) {
    upsertInstance(getDb(), inst);
    count++;
  }
  res.json({ migrated: count });
});

// --- Organizations / periods / report packages (ZID / EID) ---

app.get("/api/organizations", (req, res) => {
  const orgZid = userZid(req);
  const all = listOrganizations(getDb());
  res.json(orgZid != null ? all.filter((o) => o.zid === orgZid) : all);
});

app.post("/api/organizations", requireAdmin, (req, res) => {
  const { name, code, parentZid } = req.body as {
    name?: string;
    code?: string;
    parentZid?: number;
  };
  if (!name?.trim()) {
    res.status(400).json({ error: "name required" });
    return;
  }
  try {
    const org = createOrganization(getDb(), { name, code, parentZid });
    res.status(201).json(org);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "create failed" });
  }
});

app.get("/api/periods", (req, res) => {
  const orgZid = userZid(req);
  const zid = orgZid ?? (req.query.zid != null ? Number(req.query.zid) : undefined);
  res.json(listPeriods(getDb(), zid));
});

app.post("/api/periods", requireAdmin, (req, res) => {
  const { zid, name, periodStart, periodEnd, quarter, year } = req.body as {
    zid?: number;
    name?: string;
    periodStart?: string;
    periodEnd?: string;
    quarter?: number;
    year?: number;
  };
  if (!zid || !name?.trim()) {
    res.status(400).json({ error: "zid and name required" });
    return;
  }
  try {
    const period = createPeriod(getDb(), {
      zid,
      name,
      periodStart,
      periodEnd,
      quarter,
      year,
    });
    res.status(201).json(period);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "create failed" });
  }
});

app.get("/api/work-context", (req, res) => {
  const ctx = getWorkContext(getDb());
  const orgZid = userZid(req);
  if (orgZid != null) {
    res.json({ zid: orgZid, eid: ctx.eid });
    return;
  }
  res.json(ctx);
});

app.put("/api/work-context", (req, res) => {
  const body = req.body as { zid?: number | null; eid?: number | null };
  const orgZid = userZid(req);
  res.json(
    setWorkContext(getDb(), {
      zid: orgZid ?? body.zid ?? null,
      eid: body.eid ?? null,
    })
  );
});

app.get("/api/packages/completeness", (req, res) => {
  const zid = Number(req.query.zid);
  const eid = Number(req.query.eid);
  if (!Number.isFinite(zid) || !Number.isFinite(eid)) {
    res.status(400).json({ error: "zid and eid required" });
    return;
  }
  try {
    assertOrgZidParam(req, zid);
    res.json(getPackageCompleteness(getDb(), zid, eid));
  } catch (e) {
    if (handleOrgError(res, e)) return;
    res.status(500).json({ error: e instanceof Error ? e.message : "failed" });
  }
});

app.post("/api/packages/create", (req, res) => {
  const { zid, eid } = req.body as { zid?: number; eid?: number };
  if (!zid || !eid) {
    res.status(400).json({ error: "zid and eid required" });
    return;
  }
  try {
    assertOrgZidParam(req, zid);
    const result = createReportPackage(getDb(), zid, eid);
    res.status(201).json(result);
  } catch (e) {
    if (handleOrgError(res, e)) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "create failed" });
  }
});

app.get("/api/packages/dashboard", requireAdmin, (_req, res) => {
  res.json(getPackagesDashboard(getDb()));
});

// --- User accounts (org cabinets) ---

app.get("/api/users", requireAdmin, (_req, res) => {
  res.json(listUsers(getDb()));
});

app.post("/api/users", requireAdmin, (req, res) => {
  const body = req.body as {
    username?: string;
    password?: string;
    displayName?: string;
    role?: "admin" | "org";
    zid?: number | null;
  };
  try {
    const user = createUser(getDb(), {
      username: body.username ?? "",
      password: body.password ?? "",
      displayName: body.displayName,
      role: body.role ?? "org",
      zid: body.zid,
    });
    res.status(201).json(user);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "create failed" });
  }
});

app.put("/api/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const body = req.body as {
    displayName?: string | null;
    password?: string;
    role?: "admin" | "org";
    zid?: number | null;
    active?: boolean;
  };
  try {
    const user = updateUser(getDb(), id, body);
    if (!user) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(user);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "update failed" });
  }
});

// --- Aggregation (a_tblAgg_List) ---

app.get("/api/aggregation/stats", (_req, res) => {
  res.json(getAggStats(getDb()));
});

app.get("/api/aggregation/export", (_req, res) => {
  res.json(exportAggPayload(getDb()));
});

app.post("/api/aggregation/reimport", requireAdmin, (_req, res) => {
  try {
    const count = reimportAggFromJson(getDb());
    res.json({ reimported: count });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "reimport failed" });
  }
});

app.get("/api/aggregation/list", (req, res) => {
  const parentZid = req.query.parentZid != null ? Number(req.query.parentZid) : undefined;
  res.json(listAggEntries(getDb(), parentZid));
});

app.post("/api/aggregation/list", requireAdmin, (req, res) => {
  const body = req.body as {
    parentZid?: number;
    childZid?: number;
    included?: boolean;
  };
  if (!body.parentZid || !body.childZid) {
    res.status(400).json({ error: "parentZid and childZid required" });
    return;
  }
  try {
    const entry = upsertAggEntry(getDb(), {
      parentZid: body.parentZid,
      childZid: body.childZid,
      included: body.included,
    });
    res.status(201).json(entry);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "create failed" });
  }
});

app.put("/api/aggregation/list/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as {
    parentZid?: number;
    childZid?: number;
    included?: boolean;
  };
  if (!Number.isFinite(id) || !body.parentZid || !body.childZid) {
    res.status(400).json({ error: "invalid id or missing zids" });
    return;
  }
  try {
    res.json(
      upsertAggEntry(getDb(), {
        id,
        parentZid: body.parentZid,
        childZid: body.childZid,
        included: body.included,
      })
    );
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "update failed" });
  }
});

app.delete("/api/aggregation/list/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const ok = deleteAggEntry(getDb(), id);
  if (!ok) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/aggregation/run", (req, res) => {
  const { parentZid, eid } = req.body as { parentZid?: number; eid?: number };
  if (!parentZid || !eid) {
    res.status(400).json({ error: "parentZid and eid required" });
    return;
  }
  try {
    assertOrgZidParam(req, parentZid);
    const result = runPackageAggregation(getDb(), parentZid, eid);
    res.json(result);
  } catch (e) {
    if (handleOrgError(res, e)) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "aggregation failed" });
  }
});

// --- Rash rules (sp_rash / sp_rash_addsum) ---

app.get("/api/rash/stats", (_req, res) => {
  res.json(getRashStats(getDb()));
});

app.get("/api/rash/thresholds", (_req, res) => {
  res.json(getRashThresholds(getDb()));
});

app.put("/api/rash/thresholds", (req, res) => {
  res.json(setRashThresholds(getDb(), req.body as RashThresholdsDto));
});

app.get("/api/rash/export", (_req, res) => {
  res.json(exportRashPayload(getDb()));
});

app.get("/api/rash", (req, res) => {
  const db = getDb();
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  const q = String(req.query.q ?? "").trim();
  const formId = String(req.query.formId ?? "").trim();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (q) {
    conditions.push("(CAST(kod AS TEXT) LIKE ? OR name LIKE ? OR note LIKE ? OR ref_rows LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (formId) {
    conditions.push("ref_rows LIKE ?");
    params.push(`%${formId}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM rash_rules ${where}`).get(...params) as { c: number }
  ).c;

  const rows = db
    .prepare(
      `SELECT kod, name, note, ref_rows, total_formula,
              ref_a1_name, ref_a1_title, ref_a2_name, ref_a2_title,
              ref_a3_name, ref_a3_title, ref_a4_name, ref_a4_title
       FROM rash_rules ${where}
       ORDER BY kod
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as RashRuleRow[];

  res.json({
    total,
    limit,
    offset,
    items: rows.map(rashRowToDto),
  });
});

app.get("/api/rash/:kod", (req, res) => {
  const kod = Number(req.params.kod);
  const rule = getRashRule(getDb(), kod);
  if (!rule) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({
    ...rule,
    addsum: listRashAddsum(getDb(), kod),
  });
});

app.post("/api/rash", (req, res) => {
  const dto = req.body as RashRuleDto;
  if (!dto.kod || !dto.name?.trim()) {
    res.status(400).json({ error: "kod and name required" });
    return;
  }
  try {
    upsertRashRule(getDb(), dto);
    res.status(201).json(dto);
  } catch (e) {
    res.status(409).json({ error: e instanceof Error ? e.message : "insert failed" });
  }
});

app.put("/api/rash/:kod", (req, res) => {
  const kod = Number(req.params.kod);
  const dto = req.body as RashRuleDto;
  if (dto.kod !== kod) {
    res.status(400).json({ error: "kod mismatch" });
    return;
  }
  upsertRashRule(getDb(), dto);
  res.json(dto);
});

app.delete("/api/rash/:kod", (req, res) => {
  if (!deleteRashRule(getDb(), Number(req.params.kod))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/rash/reimport", (_req, res) => {
  try {
    const count = reimportRashFromJson(getDb());
    res.json({ reimported: count });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "reimport failed" });
  }
});

const RECALC_JSON = path.join(ROOT, "portal", "public", "data", "recalc-rules.json");

app.get("/api/recalc/export", (_req, res) => {
  if (!fs.existsSync(RECALC_JSON)) {
    res.status(404).json({ error: "recalc-rules.json not found" });
    return;
  }
  res.json(JSON.parse(fs.readFileSync(RECALC_JSON, "utf-8")));
});

app.get("/api/kontr", (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, name, org_form, inn, kpp FROM kontragents ORDER BY name")
    .all();
  res.json(
    rows.map((r) => {
      const row = r as {
        id: number;
        name: string;
        org_form: string | null;
        inn: string | null;
        kpp: string | null;
      };
      return {
        id: row.id,
        name: row.name,
        orgForm: row.org_form,
        inn: row.inn,
        kpp: row.kpp,
      };
    })
  );
});

app.post("/api/kontr", (req, res) => {
  const { name, orgForm, inn, kpp } = req.body as {
    name: string;
    orgForm?: string;
    inn?: string;
    kpp?: string;
  };
  const db = getDb();
  const maxId = db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM kontragents").get() as {
    m: number;
  };
  const id = maxId.m + 1;
  db.prepare(
    "INSERT INTO kontragents (id, name, org_form, inn, kpp) VALUES (?, ?, ?, ?, ?)"
  ).run(id, name, orgForm ?? null, inn ?? null, kpp ?? null);
  res.status(201).json({ id, name, orgForm, inn, kpp });
});

app.get("/api/templates/minfin", (_req, res) => {
  const templatePath = path.join(ROOT, "reference", "ШаблоныФорм-МинФин.xlsx");
  if (!fs.existsSync(templatePath)) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.sendFile(templatePath);
});

// --- Check rules (a_tblchecks analog) ---

app.get("/api/checks/stats", (_req, res) => {
  res.json(getChecksStats(getDb()));
});

app.get("/api/checks/export", (_req, res) => {
  res.json(exportChecksPayload(getDb()));
});

app.get("/api/checks", (req, res) => {
  const db = getDb();
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  const q = String(req.query.q ?? "").trim();
  const formId = String(req.query.formId ?? "").trim();
  const active = req.query.active;
  const periodActive = req.query.periodActive;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (q) {
    conditions.push(
      "(CAST(number AS TEXT) LIKE ? OR expression LIKE ? OR message LIKE ? OR expression_alt LIKE ?)"
    );
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (formId) {
    conditions.push("(expression LIKE ? OR expression_alt LIKE ?)");
    params.push(`%${formId}%`, `%${formId}%`);
  }
  if (active === "1" || active === "true") {
    conditions.push("active = 1");
  }
  if (periodActive === "1" || periodActive === "true") {
    conditions.push("period_active = 1");
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM check_rules ${where}`).get(...params) as { c: number }
  ).c;

  const rows = db
    .prepare(
      `SELECT number, expression, expression_alt, message,
              for_aggr_only, first_level, active, period_active, period, info
       FROM check_rules ${where}
       ORDER BY number
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as CheckRuleRow[];

  res.json({
    total,
    limit,
    offset,
    items: rows.map(rowToDto),
  });
});

app.get("/api/checks/:number", (req, res) => {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT number, expression, expression_alt, message,
              for_aggr_only, first_level, active, period_active, period, info
       FROM check_rules WHERE number = ?`
    )
    .get(Number(req.params.number)) as CheckRuleRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(rowToDto(row));
});

app.post("/api/checks", (req, res) => {
  const dto = req.body as CheckRuleDto;
  if (!dto.number || !dto.expression?.trim()) {
    res.status(400).json({ error: "number and expression required" });
    return;
  }
  const db = getDb();
  const r = dtoToRow(dto);
  try {
    db.prepare(
      `INSERT INTO check_rules (
        number, expression, expression_alt, message,
        for_aggr_only, first_level, active, period_active, period, info
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      r.number,
      r.expression,
      r.expression_alt,
      r.message,
      r.for_aggr_only,
      r.first_level,
      r.active,
      r.period_active,
      r.period,
      r.info
    );
    res.status(201).json(dto);
  } catch {
    res.status(409).json({ error: "Rule number already exists" });
  }
});

app.put("/api/checks/:number", (req, res) => {
  const dto = req.body as CheckRuleDto;
  const num = Number(req.params.number);
  if (dto.number !== num) {
    res.status(400).json({ error: "number mismatch" });
    return;
  }
  const db = getDb();
  const r = dtoToRow(dto);
  const result = db
    .prepare(
      `UPDATE check_rules SET
        expression = ?, expression_alt = ?, message = ?,
        for_aggr_only = ?, first_level = ?, active = ?, period_active = ?,
        period = ?, info = ?
       WHERE number = ?`
    )
    .run(
      r.expression,
      r.expression_alt,
      r.message,
      r.for_aggr_only,
      r.first_level,
      r.active,
      r.period_active,
      r.period,
      r.info,
      num
    );
  if (result.changes === 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(dto);
});

app.delete("/api/checks/:number", (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM check_rules WHERE number = ?").run(Number(req.params.number));
  if (result.changes === 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/checks/reimport", (_req, res) => {
  try {
    const count = reimportCheckRulesFromJson(getDb());
    res.json({ reimported: count });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "reimport failed" });
  }
});

// --- Form templates (a_stblROWs / a_stblFIELDs analog) ---

app.get("/api/forms/catalog", (_req, res) => {
  res.json(exportCatalog(getDb()));
});

app.get("/api/forms/:id", (req, res) => {
  const schema = loadFormSchema(getDb(), req.params.id);
  if (!schema) {
    res.status(404).json({ error: "Form not found" });
    return;
  }
  res.json(schema);
});

app.put("/api/forms/:id/meta", (req, res) => {
  const formId = req.params.id;
  const exists = loadFormSchema(getDb(), formId);
  if (!exists) {
    res.status(404).json({ error: "Form not found" });
    return;
  }
  updateFormMeta(getDb(), formId, req.body);
  res.json(loadFormSchema(getDb(), formId));
});

app.put("/api/forms/:id/columns", (req, res) => {
  const formId = req.params.id;
  if (!loadFormSchema(getDb(), formId)) {
    res.status(404).json({ error: "Form not found" });
    return;
  }
  const columns = req.body as FormColumnDto[];
  if (!Array.isArray(columns)) {
    res.status(400).json({ error: "columns array required" });
    return;
  }
  replaceFormColumns(getDb(), formId, columns);
  res.json(loadFormSchema(getDb(), formId));
});

app.put("/api/forms/:id/rows", (req, res) => {
  const formId = req.params.id;
  if (!loadFormSchema(getDb(), formId)) {
    res.status(404).json({ error: "Form not found" });
    return;
  }
  const rows = req.body as FormRowDto[];
  if (!Array.isArray(rows)) {
    res.status(400).json({ error: "rows array required" });
    return;
  }
  replaceFormRows(getDb(), formId, rows);
  res.json(loadFormSchema(getDb(), formId));
});

app.put("/api/forms/:id/schema", (req, res) => {
  const formId = req.params.id;
  const body = req.body as FormSchemaDto;
  if (body.id !== formId) {
    res.status(400).json({ error: "id mismatch" });
    return;
  }
  if (!loadFormSchema(getDb(), formId)) {
    res.status(404).json({ error: "Form not found" });
    return;
  }
  updateFormMeta(getDb(), formId, {
    title: body.title,
    pages: body.pages,
    allowAddRows: body.allowAddRows,
    kontrForm: body.kontrForm,
    signatures: body.signatures,
  });
  replaceFormColumns(getDb(), formId, body.columns);
  replaceFormRows(getDb(), formId, body.rows);
  res.json(loadFormSchema(getDb(), formId));
});

app.post("/api/forms/reimport", (_req, res) => {
  try {
    const count = reimportFormsFromJson(getDb());
    res.json({ reimported: count });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "reimport failed" });
  }
});

// --- Saldo rules (a_tblsaldo) + FormCorrespondence ---

app.get("/api/saldo/stats", (_req, res) => {
  res.json(getSaldoStats(getDb()));
});

app.get("/api/saldo/export", (_req, res) => {
  res.json(exportSaldoPayload(getDb()));
});

app.get("/api/saldo", (req, res) => {
  const db = getDb();
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  const q = String(req.query.q ?? "").trim();
  const formId = String(req.query.formId ?? "").trim();
  const saldoType = String(req.query.saldoType ?? "").trim();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (q) {
    conditions.push(
      "(CAST(number AS TEXT) LIKE ? OR name LIKE ? OR target_form LIKE ? OR source_form LIKE ?)"
    );
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (formId) {
    conditions.push("(target_form = ? OR source_form = ?)");
    params.push(formId, formId);
  }
  if (saldoType === "t") conditions.push("saldo_t = 1");
  if (saldoType === "s") conditions.push("saldo_s = 1");
  if (saldoType === "g") conditions.push("saldo_g = 1");

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM saldo_rules ${where}`).get(...params) as { c: number }
  ).c;

  const rows = db
    .prepare(
      `SELECT number, target_form, target_column, target_row,
              source_form, source_column, source_row,
              end_form, end_column, end_row,
              saldo_t, saldo_s, saldo_g, name, conditional
       FROM saldo_rules ${where}
       ORDER BY number
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as SaldoRuleRow[];

  res.json({
    total,
    limit,
    offset,
    items: rows.map(saldoRowToDto),
  });
});

app.get("/api/saldo/:number", (req, res) => {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT number, target_form, target_column, target_row,
              source_form, source_column, source_row,
              end_form, end_column, end_row,
              saldo_t, saldo_s, saldo_g, name, conditional
       FROM saldo_rules WHERE number = ?`
    )
    .get(Number(req.params.number)) as SaldoRuleRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(saldoRowToDto(row));
});

app.post("/api/saldo", (req, res) => {
  const dto = req.body as SaldoRuleDto;
  if (!dto.number || !dto.targetForm?.trim()) {
    res.status(400).json({ error: "number and targetForm required" });
    return;
  }
  const db = getDb();
  const r = saldoDtoToRow(dto);
  try {
    db.prepare(
      `INSERT INTO saldo_rules (
        number, target_form, target_column, target_row,
        source_form, source_column, source_row,
        end_form, end_column, end_row,
        saldo_t, saldo_s, saldo_g, name, conditional
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      r.number,
      r.target_form,
      r.target_column,
      r.target_row,
      r.source_form,
      r.source_column,
      r.source_row,
      r.end_form,
      r.end_column,
      r.end_row,
      r.saldo_t,
      r.saldo_s,
      r.saldo_g,
      r.name,
      r.conditional
    );
    res.status(201).json(saldoRowToDto(r));
  } catch (e) {
    res.status(409).json({ error: e instanceof Error ? e.message : "insert failed" });
  }
});

app.put("/api/saldo/:number", (req, res) => {
  const dto = req.body as SaldoRuleDto;
  const number = Number(req.params.number);
  const db = getDb();
  const r = saldoDtoToRow({ ...dto, number });
  const result = db
    .prepare(
      `UPDATE saldo_rules SET
        target_form = ?, target_column = ?, target_row = ?,
        source_form = ?, source_column = ?, source_row = ?,
        end_form = ?, end_column = ?, end_row = ?,
        saldo_t = ?, saldo_s = ?, saldo_g = ?, name = ?, conditional = ?
       WHERE number = ?`
    )
    .run(
      r.target_form,
      r.target_column,
      r.target_row,
      r.source_form,
      r.source_column,
      r.source_row,
      r.end_form,
      r.end_column,
      r.end_row,
      r.saldo_t,
      r.saldo_s,
      r.saldo_g,
      r.name,
      r.conditional,
      number
    );
  if (result.changes === 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(saldoRowToDto(r));
});

app.delete("/api/saldo/:number", (req, res) => {
  const result = getDb()
    .prepare("DELETE FROM saldo_rules WHERE number = ?")
    .run(Number(req.params.number));
  if (result.changes === 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/saldo/reimport", (_req, res) => {
  try {
    const count = reimportSaldoRulesFromJson(getDb());
    res.json({ reimported: count });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "reimport failed" });
  }
});

app.get("/api/correspondence/export", (_req, res) => {
  res.json(exportFormCorrespondencePayload(getDb()));
});

app.get("/api/correspondence/:formId", (req, res) => {
  const item = getFormCorrespondence(getDb(), req.params.formId);
  if (!item) {
    res.status(404).json({ error: "Form not found" });
    return;
  }
  res.json(item);
});

app.put("/api/correspondence/:formId", (req, res) => {
  const formId = req.params.formId;
  const body = req.body as FormCorrespondenceDto;
  const updated = updateFormCorrespondence(getDb(), formId, { ...body, formId });
  if (!updated) {
    res.status(404).json({ error: "Form not found" });
    return;
  }
  res.json(updated);
});

app.post("/api/correspondence/reimport", (_req, res) => {
  try {
    const count = reimportFormCorrespondenceFromJson(getDb());
    res.json({ reimported: count });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "reimport failed" });
  }
});

// --- Excel mappings (tblExcelExport) ---

app.get("/api/excel/stats", (_req, res) => {
  res.json(getExcelStats(getDb()));
});

app.get("/api/excel/export", (_req, res) => {
  res.json(exportExcelPayload(getDb()));
});

app.get("/api/excel", (req, res) => {
  const db = getDb();
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  const q = String(req.query.q ?? "").trim();
  const formName = String(req.query.formName ?? "").trim();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (q) {
    conditions.push(
      "(form_name LIKE ? OR sheet_name LIKE ? OR form_column LIKE ? OR CAST(excel_row AS TEXT) LIKE ?)"
    );
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (formName) {
    conditions.push("form_name = ?");
    params.push(formName);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM excel_mappings ${where}`).get(...params) as { c: number }
  ).c;

  const rows = db
    .prepare(
      `SELECT id, form_name, sheet_name, excel_row, excel_column,
              form_column, form_row, period, add_text
       FROM excel_mappings ${where}
       ORDER BY form_name, id
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as ExcelMappingRow[];

  res.json({
    total,
    limit,
    offset,
    items: rows.map(excelRowToDto),
  });
});

app.get("/api/excel/:id", (req, res) => {
  const item = getExcelMapping(getDb(), Number(req.params.id));
  if (!item) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(item);
});

app.post("/api/excel", (req, res) => {
  const dto = req.body as ExcelMappingDto;
  if (!dto.formName?.trim()) {
    res.status(400).json({ error: "formName required" });
    return;
  }
  try {
    const created = createExcelMapping(getDb(), dto);
    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "insert failed" });
  }
});

app.put("/api/excel/:id", (req, res) => {
  const id = Number(req.params.id);
  const updated = updateExcelMapping(getDb(), id, req.body as ExcelMappingDto);
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(updated);
});

app.delete("/api/excel/:id", (req, res) => {
  if (!deleteExcelMapping(getDb(), Number(req.params.id))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/excel/reimport", (_req, res) => {
  try {
    const count = reimportExcelMappingsFromJson(getDb());
    res.json({ reimported: count });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "reimport failed" });
  }
});

app.listen(PORT, () => {
  getDb();
  console.log(`OKO API http://localhost:${PORT}`);
});
