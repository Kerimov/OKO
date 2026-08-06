/**
 * Smoke test for withTiming / OKO_PERF_LOG flag.
 */
import assert from "node:assert/strict";
import { withTiming } from "./perf.js";

const prev = process.env.OKO_PERF_LOG;
process.env.OKO_PERF_LOG = "1";

let ran = false;
const result = await withTiming("perf.selftest", async () => {
  ran = true;
  return 42;
}, { zid: 1, eid: 2 });

assert.equal(ran, true);
assert.equal(result, 42);

process.env.OKO_PERF_LOG = "0";
await withTiming("perf.selftest.quiet", async () => "ok");

if (prev === undefined) delete process.env.OKO_PERF_LOG;
else process.env.OKO_PERF_LOG = prev;

console.log("perf.selftest: ok");
