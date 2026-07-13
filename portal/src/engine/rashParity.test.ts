import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FormRashEntry, KontrAgent, RashRulesData, RowData } from "../types";
import {
  buildRashCellSlots,
  defaultKontrShowFilter,
  effectiveOrgType,
  filterKontrByShow,
  numVal,
  rashSlotVisible,
  syncRashToParentRow,
  validateKontrAmountPolicy,
  validateUnknownKontrName,
} from "./rashEngine";
import type { RowRashIndexData } from "./rowRashIndex";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "../../public/data");

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(dataDir, name), "utf-8")) as T;
}

const thresholds = {
  level1: 1,
  level2: 5000,
  level3: 50000,
  unit: "тыс.руб.",
  labels: ["1 тыс. руб.", "5 млн руб.", "50 млн руб."],
};

const kontrAgents = (loadJson<{ items: KontrAgent[] }>("kontr.json").items ?? []) as KontrAgent[];
const rashData = loadJson<RashRulesData>("rash-rules.json");
const rowIndex = loadJson<RowRashIndexData>("row-rash-index.json");

interface TRasFixtureEntry {
  formId: string;
  parentRowNo: number;
  columnKey: string;
  kontrName: string;
  values: Record<string, number>;
}

describe("kontr show filter", () => {
  it("defaults to internal+associated for Контрагент/1, 2", () => {
    expect(defaultKontrShowFilter("Контрагент/1, 2")).toBe("1,2");
  });

  it("filters agents by show filter", () => {
    const all = filterKontrByShow(kontrAgents, "Контрагент/1, 2", "1");
    const names = all.map((a) => a.name);
    expect(names).toContain("ПРОЧИЕ");
    expect(all.every((a) => a.orgType === 1 || a.name === "ПРОЧИЕ" || a.name === "ФИЗИЧЕСКИЕ ЛИЦА")).toBe(
      true
    );
  });
});

describe("per-orgType thresholds", () => {
  it("treats обяз.расшифровка as associated (5M)", () => {
    const agent: KontrAgent = {
      id: 25179,
      name: "Газпром СПГ Владивосток ООО",
      orgType: 3,
      mandatoryRash: true,
    };
    expect(effectiveOrgType(agent)).toBe(2);
    const issue = validateKontrAmountPolicy(
      agent.name,
      100,
      kontrAgents,
      thresholds,
      0,
      "test",
      "B"
    );
    expect(issue?.message).toContain("ПРОЧИЕ");
  });

  it("requires ПРОЧИЕ for external below 50M", () => {
    const external = kontrAgents.find((a) => a.orgType === 3 && a.name !== "ПРОЧИЕ");
    if (!external) return;
    const issue = validateKontrAmountPolicy(
      external.name,
      1000,
      kontrAgents,
      thresholds,
      0,
      "test",
      "B"
    );
    expect(issue?.severity).toBe("error");
    expect(issue?.message).toContain("ПРОЧИЕ");
  });
});

describe("t_ras parity", () => {
  const fixture = JSON.parse(
    readFileSync(join(here, "fixtures/t-ras-sample.json"), "utf-8")
  ) as { entries: TRasFixtureEntry[] };

  it("syncs N06_11 row 110 column B from t_ras fixture", () => {
    const group = fixture.entries.filter(
      (e) => e.formId === "N06_11" && e.parentRowNo === 110 && e.columnKey === "B"
    );
    expect(group.length).toBeGreaterThan(0);

    const meta = rowIndex.forms.N06_11?.["110"];
    expect(meta?.defaultKod).toBeTruthy();

    const rule = rashData.rules.find((r) => r.kod === meta!.defaultKod);
    expect(rule).toBeTruthy();
    if (!rule) return;

    const rashEntries: FormRashEntry[] = group.map((e, i) => ({
      formId: e.formId,
      parentRowNo: e.parentRowNo,
      columnKey: e.columnKey,
      rashKod: meta!.defaultKod!,
      lineNo: i,
      kontrName: e.kontrName,
      values: e.values,
    }));

    const rows: RowData[] = [{ num: "110", name: "test", B: "" }];
    const synced = syncRashToParentRow(rows, 0, rashEntries, "N06_11", rule.kod, rule);
    const expected = group.reduce((s, e) => s + (e.values.B ?? 0), 0);
    expect(numVal(synced[0].B)).toBeCloseTo(expected, 2);
  });

  it("builds cell slots from row index for N05_11 row 20", () => {
    const rows: RowData[] = [{ num: "20", name: "Нефть", B: "100" }];
    const schemaCols = [
      { key: "num", label: "№", type: "text" as const },
      { key: "name", label: "Наименование", type: "text" as const },
      { key: "B", label: "B", type: "number" as const },
      { key: "M", label: "M", type: "number" as const },
    ];
    const slots = buildRashCellSlots(
      "N05_11",
      rows,
      schemaCols,
      rashData.rules,
      thresholds,
      rowIndex
    );
    const bSlot = slots.find((s) => s.rowNum === "20" && (s.displayColumnKey ?? s.columnKey) === "B");
    expect(bSlot?.rashKod).toBe(51112);
  });

  it("groups t_ras by form and verifies slot count", () => {
    const forms = new Set(fixture.entries.map((e) => e.formId));
    expect(forms.size).toBeGreaterThan(0);
    for (const formId of forms) {
      const formEntries = fixture.entries.filter((e) => e.formId === formId);
      const rowNos = new Set(formEntries.map((e) => e.parentRowNo));
      expect(rowNos.size).toBeGreaterThan(0);
    }
  });

  it("rashSlotVisible hides button below threshold", () => {
    const rows: RowData[] = [{ num: "20", name: "Нефть", B: "0.5", M: "0" }];
    const schemaCols = [
      { key: "num", label: "№", type: "text" as const },
      { key: "B", label: "B", type: "number" as const },
      { key: "M", label: "M", type: "number" as const },
    ];
    const slots = buildRashCellSlots(
      "N05_11",
      rows,
      schemaCols,
      rashData.rules,
      thresholds,
      rowIndex
    );
    const slot = slots.find((s) => s.rowNum === "20");
    expect(slot).toBeTruthy();
    if (!slot) return;
    expect(rashSlotVisible(slot, rows[0], thresholds, new Map())).toBe(false);
    expect(
      rashSlotVisible(slot, { ...rows[0], B: "100" }, thresholds, new Map())
    ).toBe(true);
  });

  it("warns on unknown kontr name", () => {
    const issue = validateUnknownKontrName(
      "Несуществующий ООО",
      kontrAgents,
      0,
      "test",
      "B"
    );
    expect(issue?.message).toContain("справочнике");
  });
});
