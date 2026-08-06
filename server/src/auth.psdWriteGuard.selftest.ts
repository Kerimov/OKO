/**
 * Self-test: Express userWriteGuard must not block PSD write paths for org users.
 * Run: npx tsx src/auth.psdWriteGuard.selftest.ts
 */
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";

process.env.OKO_ADMIN_TOKEN = process.env.OKO_ADMIN_TOKEN || "admin-test";
process.env.OKO_USER_TOKEN = process.env.OKO_USER_TOKEN || "user-test";

const { userWriteGuard } = await import("./auth.js");

function mockReq(path: string, method = "POST"): Request {
  return {
    path,
    method,
    apiRole: "user",
    apiUser: { role: "org", zid: 1, username: "do" },
  } as unknown as Request;
}

function run(path: string): number {
  let status = 200;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };
  userWriteGuard(mockReq(path), res, next);
  if (nextCalled) return 200;
  return status;
}

const allowed = [
  "/api/business-processes/bp-1-1-OKO/transition",
  "/api/psd-checks/explanations",
  "/api/cell-comments",
  "/api/kontr",
  "/api/transfers/apply",
  "/api/collection-units/1",
  "/api/svods",
  "/api/minfin/export",
  "/api/support-reports/run",
  "/api/integrations/do-inbox",
];

for (const p of allowed) {
  const code = run(p);
  assert.equal(code, 200, `expected allow for ${p}, got ${code}`);
}

// Still block unrelated admin-only writes
assert.equal(run("/api/instances/normalize"), 403);
assert.equal(run("/api/methodology/publish"), 403);

console.log("auth.psdWriteGuard.selftest: OK");
