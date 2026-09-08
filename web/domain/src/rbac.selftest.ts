/**
 * RBAC roles CRUD + permission cache invalidation selftest (in-memory PG not required:
 * uses the same OkoDb as other selftests when DATABASE_URL is set; otherwise skips).
 */
import assert from "node:assert/strict";
import { getDb, initDatabase } from "./oko-db.js";
import { runNumberedMigrations } from "./migrations/runner.js";
import {
  createRole,
  deleteRole,
  listRoles,
  loadRolePermissionCache,
  setRolePermissions,
} from "./rbac.js";
import { hasPermission } from "./psdRoles.js";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // Unit-level: fallback matrix without DB
    assert.equal(hasPermission("support_specialist", "roles.manage"), true);
    assert.equal(hasPermission("auditor_readonly", "forms.write"), false);
    console.log("rbac.selftest: ok (no DATABASE_URL — fallback matrix only)");
    return;
  }

  await initDatabase();
  const db = await getDb();
  await runNumberedMigrations(db);
  await loadRolePermissionCache(db);

  const roles = await listRoles(db);
  assert.ok(roles.some((r) => r.code === "support_specialist" && r.system));
  assert.equal(hasPermission("support_specialist", "roles.manage"), true);

  const code = `custom_rbac_${Date.now().toString(36)}`;
  const created = await createRole(db, {
    code,
    nameRu: "Тест RBAC",
    permissions: ["bp.view", "forms.read"],
  });
  assert.equal(created.system, false);
  assert.equal(hasPermission(code, "bp.view"), true);
  assert.equal(hasPermission(code, "forms.write"), false);

  await setRolePermissions(db, code, ["bp.view", "forms.read", "forms.write"]);
  assert.equal(hasPermission(code, "forms.write"), true);

  await deleteRole(db, code);
  assert.equal(hasPermission(code, "forms.write"), false);

  console.log("rbac.selftest: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
