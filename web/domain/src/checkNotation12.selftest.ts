import assert from "node:assert/strict";
import { evaluateCheckNotation12, parseCheckNotation12 } from "./checkNotation12.js";

function evaluate(source: string, cells: Record<string, number>) {
  const parsed = parseCheckNotation12(source);
  assert.equal(parsed.ok, true, parsed.error);
  return evaluateCheckNotation12(parsed.ast!, (form, column, row) => cells[`${form};${column};${row}`] ?? null);
}

assert.equal(
  evaluate("{001;3;10} + {001;3;11} = {001;3;12}", {
    "001;3;10": 2, "001;3;11": 3, "001;3;12": 5,
  }).passed,
  true
);
assert.equal(
  evaluate("Round({001;3;10} / 3; 2) = 3.33 and {001;3;10} > 0", { "001;3;10": 10 }).passed,
  true
);
assert.equal(
  evaluate("if({001;3;10} > 0; {001;3;11} = 1; {001;3;11} = 0)", {
    "001;3;10": 0, "001;3;11": 0,
  }).passed,
  true
);
assert.equal(
  evaluate("{001;3;10:12} = 6 xor {001;3;10} = 0", {
    "001;3;10": 1, "001;3;11": 2, "001;3;12": 3,
  }).passed,
  true
);
assert.equal(parseCheckNotation12("{001;3;10} + = 1").ok, false);
console.log("checkNotation12 selftest: OK");
