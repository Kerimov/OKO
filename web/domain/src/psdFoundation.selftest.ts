import assert from "node:assert/strict";
import {
  canTransitionBp,
  isBpLocked,
  normalizeBpStatus,
  normalizePackageKind,
} from "./businessProcessTypes.js";
import {
  hasPermission,
  legacyToPsdRole,
  resolvePsdRole,
  assertPermission,
} from "./psdRoles.js";
import { parseCheckDsl, evalCheckDsl } from "./checkDsl.js";
import { buildCompositeCode } from "./collectionUnits.js";
import {
  computeMissingExplanations,
  formatApprovalBlockersMessage,
} from "./checkJournal.js";
import {
  findTransferNumericValue,
  resolveTransferTargetRowNo,
  rowMatchesTransferKey,
} from "./transferApply.js";
import { mapCheckRunResultToJournal } from "./instance-submit.js";
import type { CheckRunResult } from "@oko/engine";

// --- roles ---
assert.equal(legacyToPsdRole("admin"), "support_specialist");
assert.equal(legacyToPsdRole("org"), "subsidiary_specialist");
assert.equal(
  resolvePsdRole({ legacyRole: "org", psdRole: "department_curator" }),
  "department_curator"
);
assert.equal(hasPermission("auditor_readonly", "forms.write"), false);
assert.equal(hasPermission("subsidiary_specialist", "forms.write"), true);
assert.equal(hasPermission("business_process_manager", "bp.start"), true);
assert.throws(() => assertPermission("auditor_readonly", "forms.write"), /Permission denied/);

// --- BP transitions ---
assert.equal(canTransitionBp("not_started", "collecting"), true);
assert.equal(canTransitionBp("collecting", "pending_curator_approval"), true);
assert.equal(canTransitionBp("pending_curator_approval", "curator_approved"), true);
assert.equal(canTransitionBp("curator_approved", "completed"), true);
assert.equal(canTransitionBp("completed", "collecting"), true);
assert.equal(canTransitionBp("not_started", "completed"), false);
assert.equal(isBpLocked("completed"), true);
assert.equal(isBpLocked("collecting"), false);
assert.equal(normalizeBpStatus("bogus"), "not_started");
assert.equal(normalizePackageKind("BALANCE"), "BALANCE");

// --- composite code ---
assert.equal(buildCompositeCode({ headCode: "H", companyCode: "C" }), "H@C");
assert.equal(
  buildCompositeCode({ headCode: "H", companyCode: "C", branchCode: "B", unitCode: "U" }),
  "H@C.B.U"
);

// --- check DSL ---
const parsed = parseCheckDsl("F1.A[1] = F1.B[1]");
assert.equal(parsed.ok, true);
const evaled = evalCheckDsl(parsed.ast!, (form, col, row) => {
  if (col === "A" && row === "1") return 10;
  if (col === "B" && row === "1") return 10;
  return 0;
});
assert.equal(evaled.passed, true);

const fail = evalCheckDsl(parsed.ast!, (form, col, row) => {
  if (col === "A") return 10;
  return 5;
});
assert.equal(fail.passed, false);

const sumParsed = parseCheckDsl("SUM(F1.A[1..3]) = 6");
assert.equal(sumParsed.ok, true);
const sumEval = evalCheckDsl(sumParsed.ast!, (_f, _c, row) => Number(row));
assert.equal(sumEval.passed, true);

const bad = parseCheckDsl("NOT_A_CHECK");
assert.equal(bad.ok, false);

// --- transferApply pure helpers ---
assert.equal(rowMatchesTransferKey({ num: "10", name: "Revenue" }, "10"), true);
assert.equal(rowMatchesTransferKey({ code: "ABC" }, "ABC"), true);
assert.equal(rowMatchesTransferKey({ num: "1" }, "99"), false);
assert.equal(rowMatchesTransferKey({ num: "1" }, ""), true);

const rows: Array<Record<string, string | number>> = [
  { num: "1", A: 100, B: "x" },
  { num: "2", A: 200 },
];
const found = findTransferNumericValue(rows, "A", "2");
assert.ok(found);
assert.equal(found!.value, 200);
assert.equal(found!.rowNo, 2);
assert.equal(findTransferNumericValue(rows, "B", "1"), null); // non-numeric
assert.equal(findTransferNumericValue(rows, "A", "99"), null);
assert.equal(resolveTransferTargetRowNo(rows, "1"), 1);
assert.equal(resolveTransferTargetRowNo(rows, "99"), 99); // numeric key invents row_no

// --- check journal mapping / approval blockers (pure) ---
const sampleResult: CheckRunResult = {
  total: 3,
  passed: 1,
  failed: 1,
  skipped: 1,
  items: [
    {
      number: 1,
      expression: "a=b",
      message: "ok",
      passed: true,
      left: 1,
      right: 1,
    },
    {
      number: 2,
      expression: "a=b",
      message: "mismatch",
      passed: false,
      left: 1,
      right: 2,
    },
    {
      number: 3,
      expression: "bad",
      message: null,
      passed: false,
      left: 0,
      right: 0,
      parseError: true,
      error: "parse",
    },
  ],
};
const journalRows = mapCheckRunResultToJournal(sampleResult, "F1");
assert.equal(journalRows.length, 3);
assert.equal(journalRows[0]!.requiresExplanation, false);
assert.equal(journalRows[0]!.passed, true);
assert.equal(journalRows[1]!.requiresExplanation, true);
assert.equal(journalRows[1]!.formId, "F1");
assert.equal(journalRows[2]!.requiresExplanation, false); // parse/skip
assert.equal(journalRows[2]!.checkType, "parse");

const missing = computeMissingExplanations(
  [
    { rule_number: 2, form_id: "F1", message: "mismatch" },
    { rule_number: 5, form_id: null, message: "x" },
  ],
  new Set(["5::"])
);
assert.equal(missing.length, 1);
assert.equal(missing[0]!.ruleNumber, 2);
assert.match(formatApprovalBlockersMessage(missing), /missing explanations.*2/);
assert.equal(formatApprovalBlockersMessage([]), "Approval blocked");

// Approval actions that must gate (documented contract for transitionBusinessProcess)
const APPROVAL_GATE_ACTIONS = ["submit_for_approval", "curator_approve"] as const;
assert.ok(APPROVAL_GATE_ACTIONS.includes("submit_for_approval"));
assert.ok(APPROVAL_GATE_ACTIONS.includes("curator_approve"));

console.log("psdFoundation.selftest: ok");
