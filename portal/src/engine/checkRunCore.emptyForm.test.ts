import { describe, expect, it } from "vitest";
import {
  runFormChecksWithData,
  type CheckRule,
} from "./checkRunCore";
import type { OkoFormInstance } from "../types";

function makeInstance(
  templateId: string,
  rows: OkoFormInstance["rows"]
): OkoFormInstance {
  return {
    instanceId: `i-${templateId}`,
    templateId,
    templateTitle: templateId,
    displayName: templateId,
    status: "draft",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    rows,
    meta: {
      organization: "org",
      enterpriseCode: "1",
      periodStart: "2024-01-01",
      periodEnd: "2024-03-31",
      unit: "тыс.руб.",
    },
    signatures: {},
  };
}

const eqBC: CheckRule = {
  number: 10,
  expression: 'Cell("N01","B",1)=Cell("N01","C",1)',
  periodActive: true,
  active: true,
};

const eqB5: CheckRule = {
  number: 20,
  expression: 'Cell("N01","B",5)=Cell("N01","C",5)',
  periodActive: true,
  active: true,
};

describe("runFormChecksWithData unfilled cells", () => {
  it("fails checks whose cells are empty on a wholly empty form", () => {
    const result = runFormChecksWithData(
      [eqBC, eqB5],
      "N01",
      [makeInstance("N01", [{ num: "1", name: "A", B: "", C: "" }, { num: "5", name: "B", B: "", C: "" }])],
      "period"
    );
    expect(result.items[0]?.expression).toContain("iCheckFilledForm");
    const uvyazki = result.items.filter((i) => i.number > 0 && !i.parseError);
    expect(uvyazki.length).toBe(2);
    expect(uvyazki.every((i) => !i.passed)).toBe(true);
    expect(uvyazki[0]?.failedClause).toMatch(/не заполнены/);
  });

  it("fails only checks on empty cells when the form is partially filled", () => {
    const result = runFormChecksWithData(
      [eqBC, eqB5],
      "N01",
      [
        makeInstance("N01", [
          { num: "1", name: "A", B: "10", C: "10" },
          { num: "5", name: "B", B: "", C: "" },
        ]),
      ],
      "period"
    );
    expect(
      result.items.some((i) => i.expression.includes("iCheckFilledForm"))
    ).toBe(false);
    const byNum = new Map(result.items.map((i) => [i.number, i]));
    expect(byNum.get(10)?.passed).toBe(true);
    expect(byNum.get(20)?.passed).toBe(false);
    expect(byNum.get(20)?.failedClause).toMatch(/не заполнены/);
    expect(result.failed).toBe(1);
    expect(result.passed).toBe(1);
  });

  it("keeps genuine passes when referenced cells have amounts", () => {
    const result = runFormChecksWithData(
      [eqBC],
      "N01",
      [makeInstance("N01", [{ num: "1", name: "A", B: "5", C: "5" }])],
      "period"
    );
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(1);
  });
});
