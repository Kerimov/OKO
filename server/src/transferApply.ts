import type { OkoDb } from "./oko-db.js";
import {
  findInstanceIdByPackageTemplate,
  loadInstance,
  patchInstanceCells,
} from "./instances.js";
import { listTransferMaps, type TransferMapKind } from "./transferMaps.js";

export type TransferApplyResult = {
  copied: number;
  skipped: number;
  errors: string[];
};

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
    actor?: string | null;
  }
): Promise<TransferApplyResult> {
  const maps = (await listTransferMaps(db, input.kind)).filter((m) => m.active);
  let copied = 0;
  let skipped = 0;
  const errors: string[] = [];

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

      await patchInstanceCells(
        db,
        target.instanceId,
        [{ rowNo: targetRowNo, columnKey: targetCol, value: found.value }],
        input.actor ?? "transfer"
      );
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

  return { copied, skipped, errors };
}
