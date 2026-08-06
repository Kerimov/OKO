import assert from "node:assert/strict";
import { validateTzHeader } from "./scripts/tzImport/importers.js";
import { transferConditionMatches } from "./transferApply.js";

assert.equal(validateTzHeader(["id", "ExcelSheetName"], ["id", "ExcelSheetName"]), null);
assert.equal(validateTzHeader(["id", "sheet"], ["id", "ExcelSheetName"]), "header mismatch");
assert.equal(transferConditionMatches({ scenario: "cross_year" }, { sourceEid: 1, targetEid: 2, scenario: "cross_year" }), true);
assert.equal(transferConditionMatches({ scenario: "same_year" }, { sourceEid: 1, targetEid: 2, scenario: "cross_year" }), false);
console.log("tzImport.selftest: ok");
