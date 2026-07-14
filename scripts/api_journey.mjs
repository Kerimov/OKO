#!/usr/bin/env node
/**
 * Critical API journey against a running Nest server:
 * health → ready → login → package create → instance write → checks → workflow.
 *
 * Env:
 *   OKO_API_URL (default http://127.0.0.1:3001)
 *   OKO_E2E_USER / OKO_E2E_PASSWORD (fallback OKO_BOOTSTRAP_ADMIN_*)
 */
const BASE = (process.env.OKO_API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const USER =
  process.env.OKO_E2E_USER ||
  process.env.OKO_BOOTSTRAP_ADMIN_USER ||
  "admin";
const PASS =
  process.env.OKO_E2E_PASSWORD ||
  process.env.OKO_BOOTSTRAP_ADMIN_PASSWORD ||
  "";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function req(method, path, { token, body } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, ok: res.ok, data };
}

async function main() {
  console.log(`API journey → ${BASE}`);

  const health = await req("GET", "/api/health");
  assert(health.ok && health.data?.ok === true, `health failed: ${health.status}`);
  console.log("✓ health");

  const ready = await req("GET", "/api/ready");
  assert(ready.ok && ready.data?.ok === true, `ready failed: ${ready.status}`);
  console.log("✓ ready");

  assert(PASS.length >= 6, "Set OKO_E2E_PASSWORD or OKO_BOOTSTRAP_ADMIN_PASSWORD");

  const login = await req("POST", "/api/auth/login", {
    body: { username: USER, password: PASS },
  });
  assert(login.ok && login.data?.token, `login failed: ${JSON.stringify(login.data)}`);
  const token = login.data.token;
  console.log(`✓ login as ${USER} (role=${login.data.role})`);

  const orgs = await req("GET", "/api/organizations", { token });
  assert(orgs.ok && Array.isArray(orgs.data) && orgs.data.length > 0, "no organizations");
  const zid = orgs.data[0].zid;
  const periods = await req("GET", `/api/periods?zid=${zid}`, { token });
  assert(periods.ok && Array.isArray(periods.data) && periods.data.length > 0, "no periods");
  const eid = periods.data[0].eid;
  console.log(`✓ org/period zid=${zid} eid=${eid}`);

  const created = await req("POST", "/api/packages/create", {
    token,
    body: { zid, eid },
  });
  assert(
    created.status === 201 || created.status === 200 || created.ok,
    `package create failed: ${created.status} ${JSON.stringify(created.data)}`
  );
  console.log(
    `✓ package create (created=${created.data?.created ?? "?"}, skipped=${created.data?.skipped ?? "?"})`
  );

  const list = await req("GET", `/api/instances?zid=${zid}&eid=${eid}`, { token });
  assert(list.ok && Array.isArray(list.data) && list.data.length > 0, "no instances");
  const summary = list.data[0];
  console.log(`✓ instances listed (${list.data.length}), sample ${summary.templateId}`);

  const full = await req("GET", `/api/instances/${summary.instanceId}`, { token });
  assert(full.ok && full.data?.instanceId, "load instance failed");
  const inst = full.data;
  if (Array.isArray(inst.rows) && inst.rows.length > 0) {
    const row = { ...inst.rows[0] };
    const keys = Object.keys(row).filter((k) => !["num", "code", "name", "account"].includes(k));
    if (keys[0]) row[keys[0]] = row[keys[0]] === "" || row[keys[0]] == null ? 1 : row[keys[0]];
    inst.rows = [row, ...inst.rows.slice(1)];
  }
  const saved = await req("PUT", `/api/instances/${inst.instanceId}`, {
    token,
    body: inst,
  });
  assert(saved.ok, `instance save failed: ${saved.status} ${JSON.stringify(saved.data)}`);
  console.log("✓ instance write");

  const checks = await req("POST", `/api/instances/${inst.instanceId}/run-checks`, {
    token,
    body: { mode: "period" },
  });
  assert(checks.ok || checks.status === 422, `run-checks unexpected ${checks.status}`);
  console.log(
    `✓ run-checks (status=${checks.status}, failed=${checks.data?.failed ?? checks.data?.result?.failed ?? "n/a"})`
  );

  const workflow = await req("POST", "/api/packages/workflow", {
    token,
    body: { zid, eid, status: "submitted", comment: "api-journey" },
  });
  assert(
    workflow.ok,
    `workflow failed: ${workflow.status} ${JSON.stringify(workflow.data)}`
  );
  console.log(`✓ workflow → ${workflow.data?.status ?? "submitted"}`);

  const logout = await req("POST", "/api/auth/logout", { token });
  assert(logout.ok, "logout failed");
  console.log("✓ logout");

  console.log("API journey: ok");
}

main().catch((err) => {
  console.error("API journey failed:", err.message || err);
  process.exit(1);
});
