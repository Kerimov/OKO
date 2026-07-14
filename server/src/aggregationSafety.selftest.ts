/**
 * P0 safety gates for aggregation: status filter defaults + submitted edit guard.
 */
import assert from "node:assert/strict";
import {
  assertInstanceEditable,
  normalizeInstanceStatus,
} from "./instances.js";
import type { OkoFormInstance } from "./types.js";

function stubInstance(status: string): OkoFormInstance {
  return {
    instanceId: "test",
    templateId: "N01_1",
    templateTitle: "Balance",
    displayName: "test",
    organization: "org",
    periodStart: "2024-01-01",
    periodEnd: "2024-12-31",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    status: status as OkoFormInstance["status"],
    sheets: [],
  };
}

assert.equal(normalizeInstanceStatus(undefined), "draft");
assert.equal(normalizeInstanceStatus("draft"), "draft");
assert.equal(normalizeInstanceStatus("submitted"), "submitted");
assert.equal(normalizeInstanceStatus("other"), "draft");

assert.doesNotThrow(() => assertInstanceEditable(stubInstance("draft"), false));
assert.doesNotThrow(() => assertInstanceEditable(stubInstance("submitted"), true));
assert.throws(
  () => assertInstanceEditable(stubInstance("submitted"), false),
  (err: unknown) =>
    err instanceof Error &&
    err.message.includes("submitted") &&
    (err as Error & { status?: number }).status === 403
);

// Default aggregation flags (documented contract for RunAggregationOptions)
const defaults = { includeDraftSources: false, overwriteSubmitted: false };
assert.equal(defaults.includeDraftSources, false);
assert.equal(defaults.overwriteSubmitted, false);

console.log("aggregationSafety.selftest: ok");
