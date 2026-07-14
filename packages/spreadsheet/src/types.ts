/** Spreadsheet / Excel-like types for OKO managed forms. */

export type SpreadsheetValue = string | number | boolean | null;

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  decimals?: number | null;
  bg?: string | null;
  color?: string | null;
  wrap?: boolean;
}

export interface CellValidation {
  required?: boolean;
  min?: number | null;
  max?: number | null;
  pattern?: string | null;
  list?: string[] | null;
}

/**
 * Canonical cell address — stable across row reorder.
 * A1 is only a display projection.
 */
export interface StableCellRef {
  rowId: string;
  columnKey: string;
}

export interface FormCellDefinition {
  formId: string;
  rowId: string;
  columnKey: string;
  /** Display formula in A1 / Excel style (optional). */
  formulaA1?: string | null;
  /** Canonical formula with stable refs, e.g. `{rid:abc}:{col:B}+{rid:def}:{col:C}`. */
  formulaStable?: string | null;
  readonly?: boolean;
  style?: CellStyle | null;
  validation?: CellValidation | null;
  numberFormat?: string | null;
  helpText?: string | null;
}

export interface SheetColumn {
  key: string;
  label: string;
  type: "text" | "number";
  width: number;
  frozen: boolean;
  readonly: boolean;
  hidden: boolean;
  align?: "left" | "center" | "right" | null;
  decimals?: number | null;
  formula?: string | null;
  helpText?: string | null;
}

export interface SheetRow {
  /** Stable id — never changes on reorder. */
  rowId: string;
  /** Business row number (a_stblROWs.num). */
  rowNo: string;
  name: string;
  code?: string;
  kind?: "data" | "header" | "total" | "section" | "hidden" | null;
  level?: number | null;
  readonly?: boolean;
  formula?: string | null;
}

export interface SheetCell {
  rowId: string;
  columnKey: string;
  value: SpreadsheetValue;
  formula?: string | null;
  computed?: SpreadsheetValue;
  readonly?: boolean;
  error?: string | null;
  style?: CellStyle | null;
}

export interface SheetModel {
  formId: string;
  title: string;
  columns: SheetColumn[];
  rows: SheetRow[];
  cells: SheetCell[];
  definitions?: FormCellDefinition[];
}

export interface CellSelection {
  rowId: string;
  columnKey: string;
}

export interface RangeSelection {
  start: CellSelection;
  end: CellSelection;
}

export interface CellPatch {
  rowId?: string;
  rowNo?: number;
  columnKey: string;
  value?: SpreadsheetValue;
  formula?: string | null;
}

export interface SpreadsheetProviderKind {
  /** Native OKO Excel-like grid (default). */
  native: "native";
  /** Univer OSS host (optional, when packages are installed). */
  univer: "univer";
}

export type SpreadsheetBackend = keyof SpreadsheetProviderKind;

/** Minimal row bag compatible with OKO forms. */
export type RowData = Record<string, string | number>;

export interface FormColumn {
  key: string;
  type: "text" | "number";
  label?: string;
  width?: number;
  frozen?: boolean;
  readonly?: boolean;
  fTotal?: boolean;
  hidden?: boolean;
  align?: "left" | "center" | "right" | null;
  decimals?: number | null;
  formula?: string | null;
  helpText?: string | null;
}

export interface FormSchema {
  id: string;
  title: string;
  columns: FormColumn[];
}
