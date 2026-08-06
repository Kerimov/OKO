/**
 * Regression selftest for saveInstanceCells bulk insert + rowsFromCells roundtrip.
 * Uses an in-memory OkoDb stub (no PostgreSQL required).
 */
import assert from "node:assert/strict";
import type { OkoDb, OkoStatement, RunResult } from "./oko-db.js";
import {
  loadInstanceFromDb,
  rowsFromCells,
  saveInstanceCells,
} from "./instances.js";
import type { OkoFormInstance } from "./types.js";

type Header = {
  instance_id: string;
  template_id: string;
  zid: number | null;
  eid: number | null;
  template_title: string | null;
  display_name: string;
  organization: string | null;
  period_start: string | null;
  period_end: string | null;
  unit: string | null;
  enterprise_code: string | null;
  signatures_json: string;
  status: string | null;
  revision: number;
  template_schema_version: number;
  created_at: string;
  updated_at: string;
};

type Cell = {
  instance_id: string;
  row_no: number;
  row_name: string | null;
  column_key: string;
  value_num: number | null;
  value_text: string | null;
};

class MemStatement implements OkoStatement {
  constructor(
    private readonly db: MemoryDb,
    private readonly sql: string
  ) {}

  async get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined> {
    const rows = await this.all<T>(...params);
    return rows[0];
  }

  async all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]> {
    const sql = this.sql.replace(/\s+/g, " ").trim();

    if (/FROM form_instances WHERE instance_id = \?/i.test(sql)) {
      const id = String(params[0]);
      const h = this.db.headers.get(id);
      return h ? ([h] as T[]) : [];
    }

    if (/FROM form_cell_values WHERE instance_id = \?/i.test(sql)) {
      const id = String(params[0]);
      const cells = this.db.cells
        .filter((c) => c.instance_id === id)
        .sort((a, b) => a.row_no - b.row_no || a.column_key.localeCompare(b.column_key));
      return cells as unknown as T[];
    }

    if (/FROM form_rash_entries/i.test(sql)) {
      return [] as T[];
    }

    if (/FROM form_instances/i.test(sql) && /WHERE/i.test(sql)) {
      // bulk load filters — return matching headers
      let list = [...this.db.headers.values()];
      // naive: if instance_id IN
      if (/instance_id IN/i.test(sql)) {
        const ids = new Set(params.map(String));
        list = list.filter((h) => ids.has(h.instance_id));
      }
      if (/zid = \?/i.test(sql)) {
        const zidIdx = [...sql.matchAll(/\?/g)].length; // fallthrough handled below
        void zidIdx;
      }
      return list as unknown as T[];
    }

    if (/FROM form_cell_values/i.test(sql) && /instance_id IN/i.test(sql)) {
      const ids = new Set(params.map(String));
      return this.db.cells.filter((c) => ids.has(c.instance_id)) as unknown as T[];
    }

    return [] as T[];
  }

  async run(...params: unknown[]): Promise<RunResult> {
    const sql = this.sql.replace(/\s+/g, " ").trim();

    if (/INSERT INTO form_instances/i.test(sql)) {
      const [
        instance_id,
        template_id,
        zid,
        eid,
        template_title,
        display_name,
        organization,
        period_start,
        period_end,
        unit,
        enterprise_code,
        signatures_json,
        status,
        template_schema_version,
        created_at,
        updated_at,
      ] = params as [
        string,
        string,
        number | null,
        number | null,
        string | null,
        string,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
        string,
        string,
        number,
        string,
        string,
      ];
      const prev = this.db.headers.get(instance_id);
      this.db.headers.set(instance_id, {
        instance_id,
        template_id,
        zid,
        eid,
        template_title,
        display_name,
        organization,
        period_start,
        period_end,
        unit,
        enterprise_code,
        signatures_json,
        status,
        revision: prev?.revision ?? 1,
        template_schema_version: Number(template_schema_version ?? 1),
        created_at,
        updated_at,
      });
      return { changes: 1 };
    }

    if (/DELETE FROM form_cell_values WHERE instance_id = \?/i.test(sql)) {
      const id = String(params[0]);
      const before = this.db.cells.length;
      this.db.cells = this.db.cells.filter((c) => c.instance_id !== id);
      return { changes: before - this.db.cells.length };
    }

    if (/INSERT INTO form_cell_values/i.test(sql)) {
      // Multi-row: VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?), ...
      const valueGroups = (sql.match(/\(\?,\s*\?,\s*\?,\s*\?,\s*\?,\s*\?\)/g) ?? []).length;
      const cols = 6;
      assert.ok(valueGroups > 0, "expected cell value placeholders");
      assert.equal(params.length, valueGroups * cols, "param count must match VALUES");
      for (let g = 0; g < valueGroups; g++) {
        const o = g * cols;
        this.db.cells.push({
          instance_id: String(params[o]),
          row_no: Number(params[o + 1]),
          row_name: (params[o + 2] as string | null) ?? null,
          column_key: String(params[o + 3]),
          value_num: (params[o + 4] as number | null) ?? null,
          value_text: (params[o + 5] as string | null) ?? null,
        });
      }
      return { changes: valueGroups };
    }

    return { changes: 0 };
  }
}

class MemoryDb implements OkoDb {
  readonly dialect = "postgres" as const;
  headers = new Map<string, Header>();
  cells: Cell[] = [];

  async exec(_sql: string): Promise<void> {
    /* no-op */
  }

  prepare(sql: string): OkoStatement {
    return new MemStatement(this, sql);
  }

  async transaction<T>(fn: (db: OkoDb) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async columnExists(_table: string, _column: string): Promise<boolean> {
    return true;
  }
}

function stubInst(rows: OkoFormInstance["rows"], id = "inst-1"): OkoFormInstance {
  return {
    instanceId: id,
    templateId: "N01_01",
    templateTitle: "Test",
    displayName: "Test form",
    zid: 1,
    eid: 2,
    status: "draft",
    meta: {
      organization: "Org",
      enterpriseCode: "1@1",
      periodStart: "2024-01-01",
      periodEnd: "2024-03-31",
      unit: "тыс.руб.",
    },
    rows,
    signatures: { Руководитель: "" },
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

function significantRows(rows: OkoFormInstance["rows"]) {
  return rows.map((r) => {
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(r)) {
      if (v === "" || v === undefined || v === null) continue;
      // num may round-trip as number via value_num — normalize for compare
      if (k === "num") out[k] = String(v);
      else out[k] = v;
    }
    return out;
  });
}

async function main() {
  // 1) Normal rows + empty named row + unnamed row
  {
    const db = new MemoryDb();
    const inst = stubInst([
      { num: "100", name: "Актив", A: 10, B: "x" },
      { num: "200", name: "Пустая" }, // empty numeric cells → placeholder num
      { name: "Контрагент", A: 5 }, // no num → _row_index
    ]);
    await saveInstanceCells(db, inst);
    const loaded = await loadInstanceFromDb(db, inst.instanceId);
    assert.ok(loaded, "loaded instance");
    assert.equal(loaded!.templateId, "N01_01");
    assert.equal(loaded!.rows.length, 3);
    assert.equal(String(loaded!.rows[0].num), "100");
    assert.equal(loaded!.rows[0].A, 10);
    assert.equal(String(loaded!.rows[1].num), "200");
    assert.equal(String(loaded!.rows[1].name), "Пустая");
    // unnamed row keeps data
    assert.equal(loaded!.rows[2].A, 5);
    assert.equal(String(loaded!.rows[2].name), "Контрагент");
  }

  // 2) Repeated save replaces cells (no duplicates)
  {
    const db = new MemoryDb();
    const inst = stubInst([{ num: "1", name: "R", A: 1 }]);
    await saveInstanceCells(db, inst);
    const n1 = db.cells.length;
    inst.rows = [{ num: "1", name: "R", A: 2 }];
    inst.updatedAt = "2024-01-02T00:00:00.000Z";
    await saveInstanceCells(db, inst);
    assert.equal(db.cells.length, n1, "cell count must not grow on replace");
    const loaded = await loadInstanceFromDb(db, inst.instanceId);
    assert.equal(loaded!.rows[0].A, 2);
  }

  // 3) Large payload > one chunk (800 cells)
  {
    const db = new MemoryDb();
    const rows: OkoFormInstance["rows"] = [];
    for (let i = 1; i <= 300; i++) {
      rows.push({
        num: String(i),
        name: `Row ${i}`,
        A: i,
        B: i * 2,
        C: `t${i}`,
      });
    }
    const inst = stubInst(rows, "inst-big");
    await saveInstanceCells(db, inst);
    assert.ok(db.cells.length > 800, `expected >800 cells, got ${db.cells.length}`);
    const loaded = await loadInstanceFromDb(db, inst.instanceId);
    assert.equal(loaded!.rows.length, 300);
    assert.deepEqual(significantRows(loaded!.rows), significantRows(rows));
  }

  // 4) Pure rowsFromCells roundtrip for _row_index ordering
  {
    const cells = [
      { row_no: 900_000_001, row_name: "B", column_key: "A", value_num: 2, value_text: null },
      { row_no: 900_000_001, row_name: "B", column_key: "_row_index", value_num: 1, value_text: null },
      { row_no: 900_000_000, row_name: "A", column_key: "A", value_num: 1, value_text: null },
      { row_no: 900_000_000, row_name: "A", column_key: "_row_index", value_num: 0, value_text: null },
    ];
    const rows = rowsFromCells(cells);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].A, 1);
    assert.equal(rows[1].A, 2);
  }

  console.log("instancesCells.selftest: ok");
}

await main();
