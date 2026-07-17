import { describe, expect, it } from "vitest";
import { alignInstanceRowsToSchema } from "./utils";
import type { FormSchema, RowData } from "./types";

const schema = {
  id: "N01_1",
  title: "Test",
  category: "N01",
  columns: [
    { key: "num", label: "№", type: "text" },
    { key: "name", label: "Наименование", type: "text" },
    { key: "B", label: "B", type: "number" },
  ],
  rows: [
    { num: "100", name: "Старая", kind: "data" },
    { num: "2000", name: "Тест", kind: "data" },
  ],
  meta: {
    organization: "",
    enterpriseCode: "1@1",
    periodStart: "",
    periodEnd: "",
    unit: "тыс.руб.",
  },
  signatures: [],
} as FormSchema;

describe("alignInstanceRowsToSchema", () => {
  it("adds missing template rows without dropping existing values", () => {
    const rows: RowData[] = [{ num: "100", name: "Старая", B: 42 }];
    const { rows: next, added } = alignInstanceRowsToSchema(schema, rows);
    expect(added).toBe(1);
    expect(next.map((r) => String(r.num))).toEqual(["100", "2000"]);
    expect(next[0].B).toBe(42);
    expect(next[1].name).toBe("Тест");
  });

  it("keeps user-only rows not present in the template", () => {
    const rows: RowData[] = [
      { num: "100", name: "Старая", B: 1 },
      { num: "9999", name: "Своя", B: 7 },
    ];
    const { rows: next, added } = alignInstanceRowsToSchema(schema, rows);
    expect(added).toBe(1);
    expect(next.map((r) => String(r.num))).toEqual(["100", "2000", "9999"]);
  });
});
