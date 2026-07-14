/**
 * Pure session-policy helpers (no DB) — keep TTL / cap math regression-safe.
 */
import assert from "node:assert/strict";
import { maxSessionsPerUser, sessionTtlMs } from "./users.js";

const prev = {
  hours: process.env.OKO_SESSION_TTL_HOURS,
  days: process.env.OKO_SESSION_DAYS,
  max: process.env.OKO_SESSION_MAX_PER_USER,
};

try {
  delete process.env.OKO_SESSION_TTL_HOURS;
  delete process.env.OKO_SESSION_DAYS;
  delete process.env.OKO_SESSION_MAX_PER_USER;
  assert.equal(sessionTtlMs(), 7 * 86_400_000);
  assert.equal(maxSessionsPerUser(), 10);

  process.env.OKO_SESSION_TTL_HOURS = "12";
  assert.equal(sessionTtlMs(), 12 * 3_600_000);

  delete process.env.OKO_SESSION_TTL_HOURS;
  process.env.OKO_SESSION_DAYS = "2";
  assert.equal(sessionTtlMs(), 2 * 86_400_000);

  process.env.OKO_SESSION_MAX_PER_USER = "3";
  assert.equal(maxSessionsPerUser(), 3);

  process.env.OKO_SESSION_MAX_PER_USER = "9999";
  assert.equal(maxSessionsPerUser(), 100);

  console.log("sessionPolicy.selftest: ok");
} finally {
  if (prev.hours === undefined) delete process.env.OKO_SESSION_TTL_HOURS;
  else process.env.OKO_SESSION_TTL_HOURS = prev.hours;
  if (prev.days === undefined) delete process.env.OKO_SESSION_DAYS;
  else process.env.OKO_SESSION_DAYS = prev.days;
  if (prev.max === undefined) delete process.env.OKO_SESSION_MAX_PER_USER;
  else process.env.OKO_SESSION_MAX_PER_USER = prev.max;
}
