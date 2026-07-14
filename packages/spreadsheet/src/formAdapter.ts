import type { FormColumn, FormSchema, RowData } from "./types.js";
import { makeRowId } from "./cellRefs.js";
import { evaluateFormula, indexToCol } from "./formulaEngine.js";
import type {
  FormCellDefinition,
  SheetCell,
  SheetColumn,
  SheetModel,
  SheetRow,
  SpreadsheetValue,
} from "./types.js";

export interface FormLikeSchema {
  id: string;
  title: string;
  columns: Array<
    FormColumn & {
      hidden?: boolean;
      align?: "left" | "center" | "right" | null;
      decimals?: number | null;
      formula?: string | null;
      helpText?: string | null;
      label?: string;
      width?: number;
    }
  >;
  rows?: Array<{
    num?: string;
    code?: string;
    name: string;
    kind?: SheetRow["kind"];
    level?: number | null;
    readonly?: boolean;
    formula?: string | null;
    rowId?: string;
  }>;
}

export function schemaToSheetColumns(schema: FormLikeSchema): SheetColumn[] {
  return schema.columns.map((c) => ({
    key: c.key,
    label: c.label ?? c.key,
    type: c.type,
    width: c.width ?? 100,
    frozen: !!c.frozen,
    readonly: !!c.readonly,
    hidden: !!c.hidden,
    align: c.align ?? null,
    decimals: c.decimals ?? null,
    formula: c.formula ?? null,
    helpText: c.helpText ?? null,
  }));
}

export function schemaToSheetRows(schema: FormLikeSchema): SheetRow[] {
  const rows = schema.rows ?? [];
  return rows.map((r, i) => ({
    rowId: r.rowId ?? makeRowId(schema.id, String(r.num ?? ""), i),
    rowNo: String(r.num ?? "").trim(),
    name: r.name,
    code: r.code,
    kind: r.kind ?? "data",
    level: r.level ?? 0,
    readonly: !!r.readonly,
    formula: r.formula ?? null,
  }));
}

export function rowsDataToCells(
  sheetRows: SheetRow[],
  columns: SheetColumn[],
  dataRows: RowData[],
  definitions?: FormCellDefinition[]
): SheetCell[] {
  const defMap = new Map(
    (definitions ?? []).map((d) => [`${d.rowId}:${d.columnKey}`, d] as const)
  );
  const cells: SheetCell[] = [];
  for (let i = 0; i < sheetRows.length; i++) {
    const sr = sheetRows[i];
    const data = dataRows[i] ?? {};
    for (const col of columns) {
      if (col.hidden) continue;
      const def = defMap.get(`${sr.rowId}:${col.key}`);
      const raw = data[col.key];
      cells.push({
        rowId: sr.rowId,
        columnKey: col.key,
        value: (raw ?? "") as SpreadsheetValue,
        formula: def?.formulaA1 ?? null,
        readonly: def?.readonly || col.readonly || sr.readonly,
        style: def?.style ?? null,
      });
    }
  }
  return cells;
}

export function buildSheetModel(options: {
  schema: FormLikeSchema;
  dataRows: RowData[];
  definitions?: FormCellDefinition[];
}): SheetModel {
  const columns = schemaToSheetColumns(options.schema);
  const rows = schemaToSheetRows(options.schema);
  const cells = rowsDataToCells(rows, columns, options.dataRows, options.definitions);
  return {
    formId: options.schema.id,
    title: options.schema.title,
    columns,
    rows,
    cells,
    definitions: options.definitions,
  };
}

export function sheetCellsToRowData(
  model: SheetModel,
  preferComputed = true
): RowData[] {
  const byRow = new Map<string, RowData>();
  for (const row of model.rows) {
    byRow.set(row.rowId, {
      num: row.rowNo,
      name: row.name,
      ...(row.code ? { code: row.code } : {}),
    });
  }
  for (const cell of model.cells) {
    const row = byRow.get(cell.rowId);
    if (!row) continue;
    const v =
      preferComputed && cell.computed !== undefined && cell.computed !== null
        ? cell.computed
        : cell.value;
    if (v === null || v === undefined || v === "") continue;
    row[cell.columnKey] = typeof v === "boolean" ? (v ? 1 : 0) : v;
  }
  return model.rows.map((r) => byRow.get(r.rowId) ?? { name: r.name });
}

/**
 * Recalculate sheet formulas.
 * A1 addresses use OKO column keys when they are letters (`B2` → columnKey B, row index 2).
 */
export function recalcSheetFormulas(model: SheetModel): SheetModel {
  const visibleCols = model.columns.filter((c) => !c.hidden);
  const a1Map = new Map<string, SpreadsheetValue>();

  for (let r = 0; r < model.rows.length; r++) {
    const row = model.rows[r];
    for (let c = 0; c < visibleCols.length; c++) {
      const col = visibleCols[c];
      const cell = model.cells.find(
        (x) => x.rowId === row.rowId && x.columnKey === col.key
      );
      if (!cell) continue;
      const rowIdx = r + 1;
      // Prefer business column letter (B, C, …) matching FormColumn.key.
      if (/^[A-Z]+$/i.test(col.key)) {
        a1Map.set(`${col.key.toUpperCase()}${rowIdx}`, cell.value);
      }
      a1Map.set(`${indexToCol(c + 1)}${rowIdx}`, cell.value);
    }
  }

  const nextCells = model.cells.map((cell) => {
    const formula = cell.formula?.trim();
    if (!formula) return cell;
    const result = evaluateFormula(formula, (a1) => a1Map.get(a1.toUpperCase()) ?? null);
    return {
      ...cell,
      computed: result.error ? null : result.value,
      error: result.error ?? null,
    };
  });

  return { ...model, cells: nextCells };
}

/** Ensure FormSchema from portal is accepted (structural). */
export function asFormLike(schema: FormSchema | FormLikeSchema): FormLikeSchema {
  return schema as FormLikeSchema;
}
