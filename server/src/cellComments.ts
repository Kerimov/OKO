import type { OkoDb } from "./oko-db.js";

export interface CellCommentDto {
  id: number;
  instanceId: string;
  formId: string;
  rowNo: number;
  columnKey: string;
  amount: number | null;
  articleCode: string | null;
  kontrId: number | null;
  freeText: string | null;
  author: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listCellComments(
  db: OkoDb,
  instanceId: string
): Promise<CellCommentDto[]> {
  const rows = (await db
    .prepare(
      `SELECT * FROM cell_comments WHERE instance_id = ? ORDER BY row_no, column_key, id`
    )
    .all(instanceId)) as Array<{
    id: number;
    instance_id: string;
    form_id: string;
    row_no: number;
    column_key: string;
    amount: number | null;
    article_code: string | null;
    kontr_id: number | null;
    free_text: string | null;
    author: string | null;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((r) => ({
    id: Number(r.id),
    instanceId: r.instance_id,
    formId: r.form_id,
    rowNo: Number(r.row_no),
    columnKey: r.column_key,
    amount: r.amount,
    articleCode: r.article_code,
    kontrId: r.kontr_id == null ? null : Number(r.kontr_id),
    freeText: r.free_text,
    author: r.author,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function upsertCellComment(
  db: OkoDb,
  input: {
    instanceId: string;
    formId: string;
    rowNo: number;
    columnKey: string;
    amount?: number | null;
    articleCode?: string | null;
    kontrId?: number | null;
    freeText?: string | null;
    author?: string | null;
  }
): Promise<CellCommentDto> {
  const now = new Date().toISOString();
  const existing = (await db
    .prepare(
      `SELECT id FROM cell_comments
       WHERE instance_id = ? AND form_id = ? AND row_no = ? AND column_key = ?
       LIMIT 1`
    )
    .get(input.instanceId, input.formId, input.rowNo, input.columnKey)) as
    | { id: number }
    | undefined;

  if (existing) {
    await db
      .prepare(
        `UPDATE cell_comments SET
           amount = ?, article_code = ?, kontr_id = ?, free_text = ?, author = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.amount ?? null,
        input.articleCode ?? null,
        input.kontrId ?? null,
        input.freeText ?? null,
        input.author ?? null,
        now,
        existing.id
      );
  } else {
    await db
      .prepare(
        `INSERT INTO cell_comments (
           instance_id, form_id, row_no, column_key, amount, article_code, kontr_id, free_text, author, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.instanceId,
        input.formId,
        input.rowNo,
        input.columnKey,
        input.amount ?? null,
        input.articleCode ?? null,
        input.kontrId ?? null,
        input.freeText ?? null,
        input.author ?? null,
        now,
        now
      );
  }

  const list = await listCellComments(db, input.instanceId);
  return list.find(
    (c) =>
      c.formId === input.formId &&
      c.rowNo === input.rowNo &&
      c.columnKey === input.columnKey
  )!;
}
