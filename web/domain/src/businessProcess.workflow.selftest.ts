import assert from "node:assert/strict";
import { packageStatusForBp } from "./businessProcess.js";
import { canTransitionBp, isBpLocked } from "./businessProcessTypes.js";

// package_status is compatibility data, synchronized from the BP status.
assert.equal(packageStatusForBp("not_started"), "draft");
assert.equal(packageStatusForBp("collecting"), "draft");
assert.equal(packageStatusForBp("pending_curator_approval"), "submitted");
assert.equal(packageStatusForBp("curator_approved"), "accepted");
assert.equal(packageStatusForBp("completed"), "accepted");

// Completed packages are locked for data mutations; only the explicit BP reopen
// path may leave that state.
assert.equal(isBpLocked("completed"), true);
assert.equal(isBpLocked("curator_approved"), false);
assert.equal(canTransitionBp("completed", "collecting"), true);
assert.equal(canTransitionBp("completed", "completed"), false);

console.log("businessProcess.workflow.selftest: ok");
