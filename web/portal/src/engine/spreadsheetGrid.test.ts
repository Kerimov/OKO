import { describe, expect, it } from "vitest";
import {
  evaluateFormula,
  evalColumnLetterFormula,
  FORMULA_WHITELIST,
  assertFormulaAllowed,
} from "@oko/spreadsheet";

describe("@oko/spreadsheet whitelist", () => {
  it("includes core Excel functions", () => {
    expect(FORMULA_WHITELIST).toContain("SUM");
    expect(FORMULA_WHITELIST).toContain("IF");
  });

  it("rejects forbidden tokens", () => {
    expect(() => assertFormulaAllowed("=WEBSERVICE(A1)")).toThrow(/запрещена/);
  });
});

describe("formula engine", () => {
  it("evaluates SUM and IF", () => {
    const grid = new Map([
      ["A1", 1],
      ["A2", 2],
      ["B1", 10],
    ]);
    const r = (a1: string) => grid.get(a1.toUpperCase()) ?? null;
    expect(evaluateFormula("=SUM(A1:A2)", r).value).toBe(3);
    expect(evaluateFormula("=IF(B1>5,\"ok\",\"no\")", r).value).toBe("ok");
  });

  it("evaluates column letter rash formulas safely", () => {
    expect(evalColumnLetterFormula("M=B+C", (k) => (k === "B" ? 3 : k === "C" ? 4 : 0))).toBe(7);
  });
});
