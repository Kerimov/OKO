/**
 * FormCorrespondence color-spec grammar (Access Green/Yellow/Red/Blue/Corr).
 *
 *   spec   := clause (';' clause)* ';'?
 *   clause := cols '-' rows
 *   cols   := '*' | COL (',' COL)*
 *   rows   := '*' | N (',' N)*
 *
 * Examples: `B,C,G-*;` · `B,C,D-10,30;` · `*-110;*-120;` · `*-*`
 */

export type CorrespondenceColor = "green" | "yellow" | "red" | "blue";

export interface CorrespondenceCellMask {
  /** Entire form (`*-*` or empty clauses that mean all). */
  all: boolean;
  /** Explicit cells `"COL:ROW"` (both sides concrete). */
  cells: Set<string>;
  /** Columns with rows=`*`. */
  columnsAllRows: Set<string>;
  /** Rows with cols=`*`. */
  rowsAllColumns: Set<string>;
}

export function emptyCellMask(): CorrespondenceCellMask {
  return {
    all: false,
    cells: new Set(),
    columnsAllRows: new Set(),
    rowsAllColumns: new Set(),
  };
}

export function cellMaskIsEmpty(mask: CorrespondenceCellMask): boolean {
  return (
    !mask.all &&
    mask.cells.size === 0 &&
    mask.columnsAllRows.size === 0 &&
    mask.rowsAllColumns.size === 0
  );
}

export function cellMatchesMask(
  mask: CorrespondenceCellMask | undefined,
  col: string,
  row: string
): boolean {
  if (!mask || mask.all) return true;
  if (mask.cells.has(`${col}:${row}`)) return true;
  if (mask.columnsAllRows.has(col)) return true;
  if (mask.rowsAllColumns.has(row)) return true;
  return false;
}

/** Union of masks (Access Yellow ∪ YellowCorr on reorg yellow path). */
export function unionCellMasks(
  ...masks: Array<CorrespondenceCellMask | undefined | null>
): CorrespondenceCellMask {
  const out = emptyCellMask();
  for (const m of masks) {
    if (!m || cellMaskIsEmpty(m)) continue;
    if (m.all) {
      out.all = true;
      return out;
    }
    for (const c of m.cells) out.cells.add(c);
    for (const c of m.columnsAllRows) out.columnsAllRows.add(c);
    for (const r of m.rowsAllColumns) out.rowsAllColumns.add(r);
  }
  return out;
}

export function corrFieldKey(
  color: Exclude<CorrespondenceColor, "green">
): "saldoYellowCorr" | "saldoRedCorr" | "saldoBlueCorr" {
  switch (color) {
    case "yellow":
      return "saldoYellowCorr";
    case "red":
      return "saldoRedCorr";
    case "blue":
      return "saldoBlueCorr";
  }
}

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Parse one color/corr mask into a cell filter. Null/blank → empty mask (skip form). */
export function parseCorrespondenceSpec(spec: string | null | undefined): CorrespondenceCellMask {
  const mask = emptyCellMask();
  if (!spec) return mask;
  const text = String(spec).trim();
  if (!text) return mask;

  const clauses = text
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const dash = clause.indexOf("-");
    if (dash < 0) {
      // Bare `*` / flag text — not a cell mask clause.
      if (clause === "*") mask.all = true;
      continue;
    }
    const colsRaw = clause.slice(0, dash).trim();
    const rowsRaw = clause.slice(dash + 1).trim();
    const allCols = colsRaw === "*" || colsRaw === "";
    const allRows = rowsRaw === "*" || rowsRaw === "";
    const cols = allCols ? [] : splitList(colsRaw);
    const rows = allRows ? [] : splitList(rowsRaw).map((r) => r.replace(/^0+(\d)/, "$1"));

    if (allCols && allRows) {
      mask.all = true;
      continue;
    }
    if (allCols && !allRows) {
      for (const r of rows) mask.rowsAllColumns.add(r);
      continue;
    }
    if (!allCols && allRows) {
      for (const c of cols) mask.columnsAllRows.add(c);
      continue;
    }
    for (const c of cols) {
      for (const r of rows) mask.cells.add(`${c}:${r}`);
    }
  }

  return mask;
}

/** Column keys implied by a spec (for saldo transfer / UI). Fixes `B,C,D-10,30` → B,C,D. */
export function columnsFromCorrespondenceSpec(spec: string | null | undefined): string[] {
  if (!spec) return [];
  const text = String(spec).trim();
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const clause of text.split(";").map((c) => c.trim()).filter(Boolean)) {
    const dash = clause.indexOf("-");
    const colsRaw = dash < 0 ? clause : clause.slice(0, dash).trim();
    if (!colsRaw || colsRaw === "*") continue;
    for (const c of splitList(colsRaw)) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }
  return out;
}

/**
 * Access ReorgUpdate / ReorgUpdate2: leading `*` means allow row refresh;
 * comments like «нет обновления» disable it.
 */
export function parseReorgUpdateFlag(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  const s = String(raw).trim();
  if (!s) return false;
  if (/нет\s+обновления/i.test(s)) return false;
  return s.startsWith("*");
}

export function colorFieldKey(
  color: CorrespondenceColor
): "saldoGreen" | "saldoYellow" | "saldoRed" | "saldoBlue" {
  switch (color) {
    case "green":
      return "saldoGreen";
    case "yellow":
      return "saldoYellow";
    case "red":
      return "saldoRed";
    case "blue":
      return "saldoBlue";
  }
}
