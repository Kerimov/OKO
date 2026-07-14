import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FormRashEntry, KontrAgent, RashRulesData, RowData } from "../types";
import {
  buildRashCellSlots,
  defaultKontrShowFilter,
  effectiveOrgType,
  effectiveRashFormula,
  filterKontrByShow,
  kontrInsertIndex,
  looksLikeRashTotalFormula,
  numVal,
  parseRefFilter,
  rashSlotVisible,
  syncAllRashToRows,
  syncRashToParentRow,
  sumRashSubformTotal,
  entriesForRash,
  entryLineTotal,
  validateCellRash,
  validateKontrAmountPolicy,
  validateUnknownKontrName,
} from "./rashEngine";
import { refOptionsForSpec, type RashRefsData } from "./rashRefs";
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

describe("rash P0/P1 fixes", () => {
  it("flags mandatory empty rash when parent value exceeds threshold", () => {
    const rule = rashData.rules.find((r) => r.kod === 51112);
    expect(rule).toBeTruthy();
    if (!rule) return;

    const columns = [
      { key: "num", label: "№", type: "text" as const },
      { key: "name", label: "Наименование", type: "text" as const },
      { key: "B", label: "B", type: "number" as const },
      { key: "M", label: "M", type: "number" as const },
    ];
    const rows: RowData[] = [{ num: "20", name: "Нефть", B: "100", M: "100" }];
    const data: RashRulesData = {
      version: "test",
      total: 1,
      rules: [rule],
      addsum: [],
      thresholds,
    };
    const issues = validateCellRash(
      "N05_11",
      rows,
      columns,
      [],
      data,
      rowIndex as RowRashIndexData,
      []
    );
    expect(issues.some((i) => i.message.includes("Требуется расшифровка"))).toBe(true);
  });

  it("does not put classifier numeric codes into allowedTypes", () => {
    const country = parseRefFilter("Страна/31,32,RU");
    expect(country?.allowedTypes).toEqual([]);
    expect(country?.allowedCodes).toEqual(["31", "32", "RU"]);

    const kontr = parseRefFilter("Контрагент/1, 2, 101");
    expect(kontr?.allowedTypes).toEqual([1, 2]);
    expect(kontr?.allowedCodes).toEqual(["101"]);
  });

  it("filters ref options by numeric allowedCodes", () => {
    const refs: RashRefsData = {
      version: "1",
      byName: {
        Регион: [
          { kod: "31", value: "A" },
          { kod: "32", value: "B" },
          { kod: "99", value: "C" },
        ],
      },
    };
    const opts = refOptionsForSpec(refs, "Регион/31,32");
    expect(opts.map((o) => o.kod)).toEqual(["31", "32"]);
  });

  it("syncs multi-column rashes without dropping by parentRowNo:kod alone", () => {
    const rule = {
      kod: 90001,
      name: "T01",
      totalFormula: null as string | null,
    };
    const rows: RowData[] = [{ num: "10", name: "x", B: 0, C: 0 }];
    const rashEntries: FormRashEntry[] = [
      {
        formId: "T01",
        parentRowNo: 10,
        columnKey: "B",
        rashKod: 90001,
        lineNo: 0,
        kontrName: "A",
        values: { B: 5 },
      },
      {
        formId: "T01",
        parentRowNo: 10,
        columnKey: "C",
        rashKod: 90001,
        lineNo: 0,
        kontrName: "A",
        values: { C: 7 },
      },
    ];
    const synced = syncAllRashToRows("T01", rows, rashEntries, [rule as never]);
    expect(numVal(synced[0].B)).toBe(5);
    expect(numVal(synced[0].C)).toBe(7);
  });

  it("sumRashSubformTotal uses formula components, not empty total column", () => {
    const rule = {
      kod: 51112,
      name: "N05_11",
      totalFormula: "M=B+C+D",
    };
    const entries: FormRashEntry[] = [
      {
        formId: "N05_11",
        parentRowNo: 1,
        columnKey: "B",
        rashKod: 51112,
        lineNo: 0,
        kontrName: "A",
        values: { B: 10, C: 20, D: 5 },
      },
      {
        formId: "N05_11",
        parentRowNo: 1,
        columnKey: "B",
        rashKod: 51112,
        lineNo: 1,
        kontrName: "B",
        values: { B: 1, C: 2, D: 3 },
      },
    ];
    // Naive sum of M would be 0; Access-style total is (10+1)+(20+2)+(5+3)=41
    expect(sumRashSubformTotal(entries, rule as never, "M")).toBe(41);
  });

  it("entriesForRash merges legacy per-column saves for same kontr", () => {
    const entries: FormRashEntry[] = [
      {
        formId: "N02_2",
        parentRowNo: 10,
        columnKey: "B",
        rashKod: 224,
        lineNo: 0,
        kontrName: "Арктика N",
        values: { B: 1, C: 2 },
      },
      {
        formId: "N02_2",
        parentRowNo: 10,
        columnKey: "C",
        rashKod: 224,
        lineNo: 0,
        kontrName: "Арктика N",
        values: { C: 2, D: 3 },
      },
    ];
    const merged = entriesForRash(entries, "N02_2", 10, 224, "C");
    expect(merged).toHaveLength(1);
    expect(numVal(merged[0].values.B)).toBe(1);
    expect(numVal(merged[0].values.C)).toBe(2);
    expect(numVal(merged[0].values.D)).toBe(3);
    expect(
      entryLineTotal(merged[0], { kod: 224, name: "x", totalFormula: "M=B+C+D" } as never)
    ).toBe(6);
  });

  it("ignores prose totalFormula (kod 121 style)", () => {
    expect(looksLikeRashTotalFormula("Не расшифровывается")).toBe(false);
    expect(effectiveRashFormula({
      kod: 121,
      name: "x",
      totalFormula: "см. методику",
    } as never)).toBeNull();
    expect(effectiveRashFormula({
      kod: 1,
      name: "x",
      totalFormula: "M=B+C+D",
    } as never)).toBe("M=B+C+D");
  });

  it("inserts kontr row after parent group, not at end of form", () => {
    const rows: RowData[] = [
      { num: "1", name: "Parent A" },
      { num: "", name: "Child A1" },
      { num: "2", name: "Parent B" },
      { num: "", name: "Child B1" },
    ];
    expect(kontrInsertIndex(rows, 0)).toBe(2);
    expect(kontrInsertIndex(rows, 2)).toBe(4);
  });
});
