import type { OkoDb } from "./oko-db.js";

export type TransferMapKind = "period_to_period" | "balance_to_oko" | "oko_to_balance";

export interface TransferMapDto {
  id: number;
  kind: TransferMapKind;
  sourceForm: string;
  sourceColumn: string | null;
  sourceRow: string | null;
  targetForm: string;
  targetColumn: string | null;
  targetRow: string | null;
  condition: Record<string, unknown>;
  aggregation: string | null;
  excludeRows: string | null;
  active: boolean;
  sortOrder: number;
}

export interface MinfinMappingDto {
  id: number;
  templateName: string;
  sheetName: string | null;
  excelRow: number | null;
  excelColumn: string | null;
  formId: string | null;
  formColumn: string | null;
  formRow: string | null;
  signFactor: number;
  isHeader: boolean;
  periodToken: string | null;
  active: boolean;
}

function parseCondition(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function listTransferMaps(
  db: OkoDb,
  kind?: TransferMapKind
): Promise<TransferMapDto[]> {
  const rows = (await db
    .prepare(
      kind
        ? `SELECT * FROM transfer_maps WHERE kind = ? ORDER BY sort_order, id`
        : `SELECT * FROM transfer_maps ORDER BY kind, sort_order, id`
    )
    .all(...(kind ? [kind] : []))) as Array<{
    id: number;
    kind: string;
    source_form: string;
    source_column: string | null;
    source_row: string | null;
    target_form: string;
    target_column: string | null;
    target_row: string | null;
    condition_json: string;
    aggregation: string | null;
    exclude_rows: string | null;
    active: number;
    sort_order: number;
  }>;
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind as TransferMapKind,
    sourceForm: r.source_form,
    sourceColumn: r.source_column,
    sourceRow: r.source_row,
    targetForm: r.target_form,
    targetColumn: r.target_column,
    targetRow: r.target_row,
    condition: parseCondition(r.condition_json || "{}"),
    aggregation: r.aggregation,
    excludeRows: r.exclude_rows,
    active: !!r.active,
    sortOrder: Number(r.sort_order),
  }));
}

export async function bulkUpsertTransferMaps(
  db: OkoDb,
  items: Array<{
    kind: TransferMapKind;
    sourceForm: string;
    sourceColumn?: string | null;
    sourceRow?: string | null;
    targetForm: string;
    targetColumn?: string | null;
    targetRow?: string | null;
    condition?: Record<string, unknown>;
    aggregation?: string | null;
    excludeRows?: string | null;
    active?: boolean;
    sortOrder?: number;
  }>
): Promise<{ inserted: number }> {
  let inserted = 0;
  const ins = db.prepare(
    `INSERT INTO transfer_maps (
       kind, source_form, source_column, source_row, target_form, target_column, target_row,
       condition_json, aggregation, exclude_rows, active, sort_order
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
  );
  for (const it of items) {
    const r = await ins.run(
      it.kind,
      it.sourceForm,
      it.sourceColumn ?? null,
      it.sourceRow ?? null,
      it.targetForm,
      it.targetColumn ?? null,
      it.targetRow ?? null,
      JSON.stringify(it.condition ?? {}),
      it.aggregation ?? null,
      it.excludeRows ?? null,
      it.active === false ? 0 : 1,
      it.sortOrder ?? 0
    );
    inserted += Number(r.changes ?? 0);
  }
  return { inserted };
}

export async function listMinfinMappings(
  db: OkoDb,
  templateName?: string
): Promise<MinfinMappingDto[]> {
  const rows = (await db
    .prepare(
      templateName
        ? `SELECT * FROM minfin_mappings WHERE template_name = ? ORDER BY id`
        : `SELECT * FROM minfin_mappings ORDER BY template_name, id`
    )
    .all(...(templateName ? [templateName] : []))) as Array<{
    id: number;
    template_name: string;
    sheet_name: string | null;
    excel_row: number | null;
    excel_column: string | null;
    form_id: string | null;
    form_column: string | null;
    form_row: string | null;
    sign_factor: number;
    is_header: number;
    period_token: string | null;
    active: number;
  }>;
  return rows.map((r) => ({
    id: Number(r.id),
    templateName: r.template_name,
    sheetName: r.sheet_name,
    excelRow: r.excel_row,
    excelColumn: r.excel_column,
    formId: r.form_id,
    formColumn: r.form_column,
    formRow: r.form_row,
    signFactor: Number(r.sign_factor ?? 1),
    isHeader: !!r.is_header,
    periodToken: r.period_token,
    active: !!r.active,
  }));
}

export async function bulkUpsertMinfinMappings(
  db: OkoDb,
  items: Array<{
    templateName: string;
    sheetName?: string | null;
    excelRow?: number | null;
    excelColumn?: string | null;
    formId?: string | null;
    formColumn?: string | null;
    formRow?: string | null;
    signFactor?: number;
    isHeader?: boolean;
    periodToken?: string | null;
    active?: boolean;
  }>
): Promise<{ inserted: number }> {
  let inserted = 0;
  const ins = db.prepare(
    `INSERT INTO minfin_mappings (
       template_name, sheet_name, excel_row, excel_column, form_id, form_column, form_row,
       sign_factor, is_header, period_token, active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
  );
  for (const it of items) {
    const r = await ins.run(
      it.templateName,
      it.sheetName ?? null,
      it.excelRow ?? null,
      it.excelColumn ?? null,
      it.formId ?? null,
      it.formColumn ?? null,
      it.formRow ?? null,
      it.signFactor ?? 1,
      it.isHeader ? 1 : 0,
      it.periodToken ?? null,
      it.active === false ? 0 : 1
    );
    inserted += Number(r.changes ?? 0);
  }
  return { inserted };
}
