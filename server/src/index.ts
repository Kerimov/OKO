import cors from "cors";
import express from "express";
import fs from "fs";
import path from "path";
import { getDb, ROOT } from "./db.js";
import type { OkoFormInstance } from "./types.js";

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, db: "sqlite" });
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

function rowToSummary(row: {
  instance_id: string;
  template_id: string;
  template_title: string;
  display_name: string;
  organization: string;
  period_start: string;
  period_end: string;
  created_at: string;
  updated_at: string;
}) {
  return {
    instanceId: row.instance_id,
    templateId: row.template_id,
    templateTitle: row.template_title,
    displayName: row.display_name,
    organization: row.organization,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

app.get("/api/instances", (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT instance_id, template_id, template_title, display_name, organization, period_start, period_end, created_at, updated_at FROM portal_instances ORDER BY updated_at DESC"
    )
    .all();
  res.json(rows.map((r) => rowToSummary(r as never)));
});

app.get("/api/instances/:id", (req, res) => {
  const db = getDb();
  const row = db
    .prepare("SELECT payload FROM portal_instances WHERE instance_id = ?")
    .get(req.params.id) as { payload: string } | undefined;
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(JSON.parse(row.payload) as OkoFormInstance);
});

app.post("/api/instances", (req, res) => {
  const inst = req.body as OkoFormInstance;
  upsertInstance(inst);
  res.status(201).json(inst);
});

app.put("/api/instances/:id", (req, res) => {
  const inst = req.body as OkoFormInstance;
  if (inst.instanceId !== req.params.id) {
    res.status(400).json({ error: "ID mismatch" });
    return;
  }
  upsertInstance(inst);
  res.json(inst);
});

app.delete("/api/instances/:id", (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM portal_instances WHERE instance_id = ?").run(req.params.id);
  res.json({ ok: true });
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
    upsertInstance(inst);
    count++;
  }
  res.json({ migrated: count });
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

function upsertInstance(inst: OkoFormInstance): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO portal_instances (
      instance_id, template_id, template_title, display_name,
      organization, period_start, period_end, payload, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(instance_id) DO UPDATE SET
      template_id = excluded.template_id,
      template_title = excluded.template_title,
      display_name = excluded.display_name,
      organization = excluded.organization,
      period_start = excluded.period_start,
      period_end = excluded.period_end,
      payload = excluded.payload,
      updated_at = excluded.updated_at`
  ).run(
    inst.instanceId,
    inst.templateId,
    inst.templateTitle,
    inst.displayName,
    inst.meta.organization ?? "",
    inst.meta.periodStart ?? "",
    inst.meta.periodEnd ?? "",
    JSON.stringify(inst),
    inst.createdAt,
    inst.updatedAt
  );
}

app.listen(PORT, () => {
  getDb();
  console.log(`OKO API http://localhost:${PORT}`);
});
