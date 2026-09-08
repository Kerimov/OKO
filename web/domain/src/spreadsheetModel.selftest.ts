/**
 * Smoke-test spreadsheet domain helpers that do not require a live DB.
 */
import assert from "node:assert/strict";
import { buildChecksums, diffMethodologyChecksums } from "./methodology.js";

const sums = buildChecksums({
  checks: [{ n: 1 }],
  forms: [{ id: "N01_1" }],
  recalc: { rules: [] },
});
assert.ok(sums.checks);
assert.ok(sums.forms);
assert.ok(sums.recalc);

const diffs = diffMethodologyChecksums(sums, {
  ...sums,
  forms: "deadbeef",
});
const formsDiff = diffs.find((d) => d.key === "forms");
assert.ok(formsDiff && !formsDiff.same);

console.log("spreadsheetModel.selftest: ok");
