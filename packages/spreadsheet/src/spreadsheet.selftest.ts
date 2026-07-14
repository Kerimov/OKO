import assert from "node:assert/strict";
import {
  assertFormulaAllowed,
  evaluateFormula,
  evalArithmetic,
  evalColumnLetterFormula,
  buildSheetModel,
  recalcSheetFormulas,
  a1FormulaToStable,
  sheetCellsToRowData,
  FORMULA_WHITELIST,
  UNIVER_SPIKE_NOTES,
} from "./index.js";

assert.ok(FORMULA_WHITELIST.includes("SUM"));
assert.equal(UNIVER_SPIKE_NOTES.packages[0], "@univerjs/presets");

assert.equal(evalArithmetic("1+2*3"), 7);
assert.equal(evalArithmetic("(1+2)*3"), 9);
assert.equal(evalColumnLetterFormula("M=B+C", (k) => (k === "B" ? 10 : k === "C" ? 5 : 0)), 15);
assert.equal(evalColumnLetterFormula("X=B-C/2", (k) => (k === "B" ? 10 : 4)), 8);

assert.throws(() => assertFormulaAllowed("=WEBSERVICE(A1)"), /запрещена/);
assert.throws(() => assertFormulaAllowed("=OFFSET(A1,1,1)"), /запрещена/);

{
  const grid = new Map<string, string | number>([
    ["A1", 1],
    ["A2", 2],
    ["B1", 3],
    ["B2", 4],
  ]);
  const resolve = (a1: string) => grid.get(a1.toUpperCase()) ?? null;
  assert.equal(evaluateFormula("=SUM(A1:B2)", resolve).value, 10);
  assert.equal(evaluateFormula("=IF(A1>0, B1, 0)", resolve).value, 3);
  assert.equal(evaluateFormula("=ROUND(10/3, 2)", resolve).value, 3.33);
  assert.equal(evaluateFormula("=ABS(-5)", resolve).value, 5);
  assert.ok(evaluateFormula("=FOO(1)", resolve).error);
}

{
  const schema = {
    id: "N01_1",
    title: "Баланс",
    columns: [
      { key: "num", label: "№", type: "text" as const, frozen: true },
      { key: "name", label: "Наим.", type: "text" as const, frozen: true },
      { key: "B", label: "B", type: "number" as const },
      { key: "C", label: "C", type: "number" as const },
    ],
    rows: [
      { num: "100", name: "Актив" },
      { num: "200", name: "Итого", readonly: true },
    ],
  };
  const model = buildSheetModel({
    schema,
    dataRows: [
      { num: "100", name: "Актив", B: 10, C: 5 },
      { num: "200", name: "Итого", B: "", C: "" },
    ],
    definitions: [
      {
        formId: "N01_1",
        rowId: "N01_1:200",
        columnKey: "B",
        formulaA1: "=B1",
        readonly: true,
      },
    ],
  });
  const recalced = recalcSheetFormulas(model);
  const totalB = recalced.cells.find(
    (c) => c.rowId === "N01_1:200" && c.columnKey === "B"
  );
  assert.equal(totalB?.computed, 10);

  const stable = a1FormulaToStable("=B1+C1", recalced.columns, recalced.rows);
  assert.match(stable, /N01_1:100/);
  assert.match(stable, /col:B/);

  const rows = sheetCellsToRowData(recalced);
  assert.equal(rows[0].B, 10);
}

console.log("spreadsheet.selftest: ok");
