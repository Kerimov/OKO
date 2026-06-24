import type { PackageDatabase } from "./sqliteDb.js";
import { cellValueParts, resolveRowNo } from "./instances.js";
import type { RowData } from "@portal/types";

export interface CellChange {
  rowNo: number;
  columnKey: string;
  value: string | number;
  updatedAt: string;
  updatedBy: string | null;
  updatedClientId: string | null;
}

function readCellValueFromDb(value_num: number | null, value_text: string | null): string | number {
  if (value_text !== null && value_text !== "") return value_text;
  if (value_num !== null && Number.isFinite(value_num)) return value_num;
  return "";
}

export function listCellChangesSince(
  db: PackageDatabase,
  instanceId: string,
  sinceIso: string
): CellChange[] {
  const rows = db
    .prepare(
      `SELECT row_no, column_key, value_num, value_text, updated_at, updated_by, updated_client_id
       FROM form_cell_values
       WHERE instance_id = ? AND updated_at > ? AND column_key != '_row_index'
       ORDER BY updated_at`
    )
    .all(instanceId, sinceIso) as Array<{
    row_no: number;
    column_key: string;
    value_num: number | null;
    value_text: string | null;
    updated_at: string | null;
    updated_by: string | null;
    updated_client_id: string | null;
  }>;

  return rows
    .filter((r) => r.updated_at)
    .map((r) => ({
      rowNo: r.row_no,
      columnKey: r.column_key,
      value: readCellValueFromDb(r.value_num, r.value_text),
      updatedAt: r.updated_at!,
      updatedBy: r.updated_by,
      updatedClientId: r.updated_client_id,
    }));
}

export function saveSingleCell(
  db: PackageDatabase,
  params: {
    instanceId: string;
    rowNo: number;
    rowName: string | null;
    columnKey: string;
    value: string | number | undefined;
    updatedBy: string;
    clientId: string;
  }
): string {
  return db.transaction(() => {
    const now = new Date().toISOString();
    const { value_num, value_text } = cellValueParts(params.value);

    if (value_num === null && value_text === null) {
      db.prepare(
        `DELETE FROM form_cell_values
         WHERE instance_id = ? AND row_no = ? AND column_key = ?`
      ).run(params.instanceId, params.rowNo, params.columnKey);
    } else {
      db.prepare(
        `INSERT INTO form_cell_values (
          instance_id, row_no, row_name, column_key, value_num, value_text, updated_at, updated_by, updated_client_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(instance_id, row_no, column_key) DO UPDATE SET
          row_name = excluded.row_name,
          value_num = excluded.value_num,
          value_text = excluded.value_text,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by,
          updated_client_id = excluded.updated_client_id`
      ).run(
        params.instanceId,
        params.rowNo,
        params.rowName,
        params.columnKey,
        value_num,
        value_text,
        now,
        params.updatedBy,
        params.clientId
      );
    }

    db.prepare("UPDATE form_instances SET updated_at = ? WHERE instance_id = ?").run(
      now,
      params.instanceId
    );

    return now;
  });
}

export function findRowIndexByRowNo(rows: RowData[], rowNo: number): number {
  for (let i = 0; i < rows.length; i++) {
    const parsed = parseInt(String(rows[i].num ?? "").trim(), 10);
    if (Number.isFinite(parsed) && parsed !== 0 && parsed === rowNo) return i;
    if (resolveRowNo(rows[i], i) === rowNo) return i;
  }
  return -1;
}

export function applyCellChanges(
  rows: RowData[],
  changes: CellChange[],
  skipKeys: Set<string>
): RowData[] {
  if (changes.length === 0) return rows;
  let next = rows.map((r) => ({ ...r }));

  for (const ch of changes) {
    const key = `${ch.rowNo}:${ch.columnKey}`;
    if (skipKeys.has(key)) continue;

    const idx = findRowIndexByRowNo(next, ch.rowNo);
    if (idx < 0) continue;

    if (next[idx][ch.columnKey] !== ch.value) {
      next[idx] = { ...next[idx], [ch.columnKey]: ch.value };
    }
  }

  return next;
}
