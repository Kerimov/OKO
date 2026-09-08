import type { OkoDb } from "./oko-db.js";
import {
  findInstanceIdByPackageTemplate,
  loadInstance,
  patchInstanceCells,
} from "./instances.js";
import { listTransferMaps, type TransferMapKind } from "./transferMaps.js";
import { randomUUID } from "node:crypto";

export type TransferApplyResult = {
  copied: number;
  skipped: number;
  errors: string[];
  batchId?: string;
};

function scenarioForYears(sourceEid: number, targetEid: number): "same_year" | "cross_year" {
  // EIDs are opaque in the current schema; callers may pass explicit period years in condition.
  return sourceEid === targetEid ? "same_year" : "cross_year";
}

export function transferConditionMatches(
  condition: Record<string, unknown>,
  input: { sourceEid: number; targetEid: number; scenario: string }
): boolean {
  const expected = condition.scenario ?? condition.yearScenario;
  return expected == null || expected === input.scenario || expected === "any";
}

/** Match a form row by num / code / account / name (best-effort). */
export function rowMatchesTransferKey(
  row: Record<string, string | number>,
  rowKey: string | null | undefined
): boolean {
  const key = String(rowKey ?? "").trim();
  if (!key) return true;
  const fields = [row.num, row.code, row.account, row.name].map((v) =>
    String(v ?? "").trim()
  );
  return fields.some((f) => f === key || (f.length > 0 && f.includes(key)));
}

/** Resolve a numeric cell value from rows for column + optional row key. */
export function findTransferNumericValue(
  rows: Array<Record<string, string | number>>,
  column: string | null | undefined,
  rowKey: string | null | undefined
): { value: number; rowNo: number } | null {
  const col = String(column ?? "").trim();
  if (!col) return null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (!rowMatchesTransferKey(row, rowKey)) continue;
    const raw = row[col];
    if (raw === undefined || raw === null || raw === "") continue;
    const n =
      typeof raw === "number"
        ? raw
        : parseFloat(String(raw).replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n)) continue;
    const parsed = parseInt(String(row.num ?? "").trim(), 10);
    const rowNo = Number.isFinite(parsed) && parsed !== 0 ? parsed : 900_000_000 + i;
    return { value: n, rowNo };
  }
  return null;
}

/** Resolve target row_no for a row key within existing rows (or invent from key). */
export function resolveTransferTargetRowNo(
  rows: Array<Record<string, string | number>>,
  rowKey: string | null | undefined
): number | null {
  const key = String(rowKey ?? "").trim();
  if (!key) {
    // No row key: copy into first data row if any
    if (rows.length === 0) return null;
    const row = rows[0]!;
    const parsed = parseInt(String(row.num ?? "").trim(), 10);
    return Number.isFinite(parsed) && parsed !== 0 ? parsed : 900_000_000;
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (!rowMatchesTransferKey(row, key)) continue;
    const parsed = parseInt(String(row.num ?? "").trim(), 10);
    return Number.isFinite(parsed) && parsed !== 0 ? parsed : 900_000_000 + i;
  }
  const asNum = parseInt(key, 10);
  if (Number.isFinite(asNum) && asNum !== 0) return asNum;
  return null;
}

/**
 * Apply active transfer_maps for `kind`: copy numeric cells between package instances.
 * Best-effort — missing source/target instances or cells are skipped.
 */
export async function applyTransferMaps(
  db: OkoDb,
  input: {
    kind: TransferMapKind;
    sourceZid: number;
    sourceEid: number;
    targetZid: number;
    targetEid: number;
    packageKind?: "OKO" | "BALANCE";
    dryRun?: boolean;
    actor?: string | null;
  }
): Promise<TransferApplyResult> {
  // Reject writes into locked / not-started / closed packages.
  const { assertFormsWritableForBp } = await import("./businessProcess.js");
  const { assertPeriodWritableForInstance } = await import("./periodLifecycle.js");
  const pkgKind = input.packageKind === "BALANCE" ? "BALANCE" : "OKO";
  await assertPeriodWritableForInstance(db, input.targetZid, input.targetEid);
  await assertFormsWritableForBp(db, input.targetZid, input.targetEid, pkgKind);

  const maps = (await listTransferMaps(db, input.kind)).filter((m) => m.active);
  let copied = 0;
  let skipped = 0;
  const errors: string[] = [];
  const batchId = input.dryRun ? undefined : randomUUID();
  if (batchId) {
    await db.prepare(
      `INSERT INTO transfer_batches (id, kind, source_zid, source_eid, target_zid, target_eid, dry_run, status, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'applying', ?, ?)`
    ).run(batchId, input.kind, input.sourceZid, input.sourceEid, input.targetZid, input.targetEid, input.actor ?? null, new Date().toISOString());
  }

  // Cache loaded instances by template within each package
  const sourceCache = new Map<string, Awaited<ReturnType<typeof loadInstance>>>();
  const targetCache = new Map<string, Awaited<ReturnType<typeof loadInstance>>>();

  async function loadPkg(
    zid: number,
    eid: number,
    formId: string,
    cache: Map<string, Awaited<ReturnType<typeof loadInstance>>>
  ) {
    if (cache.has(formId)) return cache.get(formId) ?? null;
    const id = await findInstanceIdByPackageTemplate(db, zid, eid, formId);
    if (!id) {
      cache.set(formId, null);
      return null;
    }
    const inst = await loadInstance(db, id);
    cache.set(formId, inst);
    return inst;
  }

  for (const map of maps) {
    const label = `map#${map.id} ${map.sourceForm}.${map.sourceColumn ?? "?"}[${map.sourceRow ?? ""}]→${map.targetForm}.${map.targetColumn ?? "?"}[${map.targetRow ?? ""}]`;
    try {
      if (!transferConditionMatches(map.condition, {
        sourceEid: input.sourceEid, targetEid: input.targetEid,
        scenario: scenarioForYears(input.sourceEid, input.targetEid),
      })) { skipped++; continue; }
      const source = await loadPkg(
        input.sourceZid,
        input.sourceEid,
        map.sourceForm,
        sourceCache
      );
      if (!source) {
        skipped += 1;
        continue;
      }
      const target = await loadPkg(
        input.targetZid,
        input.targetEid,
        map.targetForm,
        targetCache
      );
      if (!target) {
        skipped += 1;
        continue;
      }

      const found = findTransferNumericValue(
        source.rows ?? [],
        map.sourceColumn,
        map.sourceRow
      );
      if (!found) {
        skipped += 1;
        continue;
      }
      if ((map.excludeRows ?? "").split(",").map((x) => x.trim()).includes(String(found.rowNo))) {
        skipped += 1; continue;
      }

      const targetCol = String(map.targetColumn ?? "").trim();
      if (!targetCol) {
        skipped += 1;
        continue;
      }

      const targetRowNo = resolveTransferTargetRowNo(target.rows ?? [], map.targetRow);
      if (targetRowNo == null) {
        skipped += 1;
        continue;
      }

      if (!input.dryRun) {
        const old = (await db.prepare(
          `SELECT value_num, value_text FROM form_cell_values WHERE instance_id = ? AND row_no = ? AND column_key = ?`
        ).get(target.instanceId, targetRowNo, targetCol)) as { value_num: number | null; value_text: string | null } | undefined;
        const oldValue = old ? (old.value_num != null ? String(old.value_num) : old.value_text) : null;
        let value = found.value;
        if (map.aggregation === "sum") {
          const oldNumber = Number(oldValue);
          value = (Number.isFinite(oldNumber) ? oldNumber : 0) + value;
        }
        await patchInstanceCells(
          db,
          target.instanceId,
          [{ rowNo: targetRowNo, columnKey: targetCol, value }],
          input.actor ?? "transfer"
        );
        await db.prepare(
          `INSERT INTO transfer_batch_patches (batch_id, instance_id, row_no, column_key, old_value, new_value)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(batchId, target.instanceId, targetRowNo, targetCol, oldValue, String(value));
      }
      // Keep in-memory cache coherent for subsequent maps on same target
      const row =
        (target.rows ?? []).find((r, i) => {
          const parsed = parseInt(String(r.num ?? "").trim(), 10);
          const rn = Number.isFinite(parsed) && parsed !== 0 ? parsed : 900_000_000 + i;
          return rn === targetRowNo;
        }) ?? null;
      if (row) row[targetCol] = found.value;
      copied += 1;
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      skipped += 1;
    }
  }
  if (batchId) {
    await db.prepare(`UPDATE transfer_batches SET status = ?, summary_json = ? WHERE id = ?`)
      .run(errors.length ? "completed_with_errors" : "completed", JSON.stringify({ copied, skipped, errors }), batchId);
  }
  return { copied, skipped, errors, batchId };
}

export async function rollbackTransferBatch(
  db: OkoDb, batchId: string, actor?: string | null
): Promise<{ restored: number }> {
  const batch = await db.prepare(`SELECT status FROM transfer_batches WHERE id = ?`).get(batchId) as { status: string } | undefined;
  if (!batch) throw new Error("Transfer batch not found");
  if (batch.status === "rolled_back") throw new Error("Transfer batch already rolled back");
  const patches = await db.prepare(
    `SELECT instance_id, row_no, column_key, old_value FROM transfer_batch_patches WHERE batch_id = ? ORDER BY id DESC`
  ).all(batchId) as Array<{ instance_id: string; row_no: number; column_key: string; old_value: string | null }>;
  for (const p of patches) {
    await patchInstanceCells(db, p.instance_id, [{ rowNo: Number(p.row_no), columnKey: p.column_key, value: p.old_value }], actor ?? "transfer-rollback");
  }
  await db.prepare(`UPDATE transfer_batches SET status = 'rolled_back', rolled_back_at = ?, rolled_back_by = ? WHERE id = ?`)
    .run(new Date().toISOString(), actor ?? null, batchId);
  return { restored: patches.length };
}
