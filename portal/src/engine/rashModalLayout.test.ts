import { describe, expect, it } from "vitest";
import type { FormColumn, FormRashEntry, RashModalRow, RashRule } from "../types";
import {
  buildRashModalLayout,
  getRashNumericColumns,
  isFixedRashEntry,
  seedRashEntriesFromModalLayout,
} from "./rashEngine";

const rule: RashRule = {
  kod: 90001,
  name: "Тест",
  totalFormula: "L=B+C",
  refA1Name: "Контрагент;1;2;3",
  refA1Title: "Контрагент",
  isActive: true,
};

const columns: FormColumn[] = [
  { key: "B", label: "Дебет", type: "number", width: 100 },
  { key: "C", label: "Кредит", type: "number", width: 100 },
  { key: "L", label: "Итог", type: "number", width: 100 },
];

const fixedRows: RashModalRow[] = [
  {
    kod: 90001,
    rowKey: "row_a",
    label: "Строка A",
    sort: 0,
    required: true,
  },
  {
    kod: 90001,
    rowKey: "row_b",
    label: "Строка B",
    sort: 1,
    required: false,
  },
];

describe("buildRashModalLayout", () => {
  it("builds the same columns as getRashNumericColumns and respects row modes", () => {
    const layout = buildRashModalLayout({
      rule,
      formColumns: columns,
      addsum: [{ kod: 90001, sort: 0, sumTitle: "Комментарий", fldType: "Текст" }],
      modalSettings: { rowMode: "fixed" },
      modalRows: fixedRows,
    });
    expect(layout.columns.map((c) => c.key)).toEqual(
      getRashNumericColumns(rule, columns, [
        { kod: 90001, sort: 0, sumTitle: "Комментарий", fldType: "Текст" },
      ]).map((c) => c.key)
    );
    expect(layout.totalCol).toBe("L");
    expect(layout.allowAddRows).toBe(false);
    expect(layout.fixedRows).toHaveLength(2);

    const mixed = buildRashModalLayout({
      rule,
      formColumns: columns,
      addsum: [],
      modalSettings: { rowMode: "mixed" },
      modalRows: fixedRows,
    });
    expect(mixed.allowAddRows).toBe(true);
    expect(mixed.allowRemoveDynamic).toBe(true);
  });
});

describe("seedRashEntriesFromModalLayout", () => {
  it("creates fixed rows with templateRowKey and preserves existing values", () => {
    const existing: FormRashEntry[] = [
      {
        formId: "N01_1",
        parentRowNo: 2000,
        rashKod: 90001,
        lineNo: 0,
        templateRowKey: "row_a",
        kontrName: "Строка A",
        values: { B: 10 },
      },
      {
        formId: "N01_1",
        parentRowNo: 2000,
        rashKod: 90001,
        lineNo: 1,
        kontrName: "Динамический",
        values: { C: 5 },
      },
    ];
    const layout = buildRashModalLayout({
      rule,
      formColumns: columns,
      addsum: [],
      modalSettings: { rowMode: "mixed" },
      modalRows: fixedRows,
    });
    const seeded = seedRashEntriesFromModalLayout(existing, layout, {
      formId: "N01_1",
      parentRowNo: 2000,
      rashKod: 90001,
    });
    expect(seeded).toHaveLength(3);
    expect(seeded[0].templateRowKey).toBe("row_a");
    expect(seeded[0].values.B).toBe(10);
    expect(seeded[1].templateRowKey).toBe("row_b");
    expect(seeded[1].kontrName).toBe("Строка B");
    expect(seeded[2].kontrName).toBe("Динамический");
    expect(isFixedRashEntry(seeded[0])).toBe(true);
    expect(isFixedRashEntry(seeded[2])).toBe(false);
  });

  it("drops dynamic rows in fixed mode", () => {
    const layout = buildRashModalLayout({
      rule,
      formColumns: columns,
      addsum: [],
      modalSettings: { rowMode: "fixed" },
      modalRows: fixedRows,
    });
    const seeded = seedRashEntriesFromModalLayout(
      [
        {
          formId: "N01_1",
          parentRowNo: 1,
          rashKod: 90001,
          lineNo: 0,
          kontrName: "Лишнее",
          values: {},
        },
      ],
      layout,
      { formId: "N01_1", parentRowNo: 1, rashKod: 90001 }
    );
    expect(seeded).toHaveLength(2);
    expect(seeded.every(isFixedRashEntry)).toBe(true);
  });

  it("keeps dynamic behaviour when rowMode is dynamic", () => {
    const layout = buildRashModalLayout({
      rule,
      formColumns: columns,
      addsum: [],
      modalSettings: { rowMode: "dynamic" },
      modalRows: fixedRows,
    });
    const existing: FormRashEntry[] = [
      {
        formId: "N01_1",
        parentRowNo: 1,
        rashKod: 90001,
        lineNo: 0,
        kontrName: "Только динамика",
        values: { B: 1 },
      },
    ];
    const seeded = seedRashEntriesFromModalLayout(existing, layout, {
      formId: "N01_1",
      parentRowNo: 1,
      rashKod: 90001,
    });
    expect(seeded).toHaveLength(1);
    expect(seeded[0].templateRowKey).toBeUndefined();
  });
});
