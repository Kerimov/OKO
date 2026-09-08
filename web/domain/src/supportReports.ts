import type { OkoDb } from "./oko-db.js";

export interface SupportReportPresetDto {
  id: number;
  code: string;
  nameRu: string;
  nameEn: string | null;
  description: string | null;
  queryKind: string;
  active: boolean;
}

export async function listSupportReportPresets(
  db: OkoDb
): Promise<SupportReportPresetDto[]> {
  const rows = (await db
    .prepare(
      `SELECT id, code, name_ru, name_en, description, query_kind, active
       FROM support_report_presets WHERE active = 1 ORDER BY id`
    )
    .all()) as Array<{
    id: number;
    code: string;
    name_ru: string;
    name_en: string | null;
    description: string | null;
    query_kind: string;
    active: number;
  }>;
  return rows.map((r) => ({
    id: Number(r.id),
    code: r.code,
    nameRu: r.name_ru,
    nameEn: r.name_en,
    description: r.description,
    queryKind: r.query_kind,
    active: !!r.active,
  }));
}

/**
 * Safe fixed-query report runner — no arbitrary SQL from clients.
 */
export async function runSupportReport(
  db: OkoDb,
  input: {
    code: string;
    zid?: number;
    eid?: number;
    locale?: "ru" | "en";
  }
): Promise<{ code: string; title: string; columns: string[]; rows: Record<string, unknown>[] }> {
  const presets = await listSupportReportPresets(db);
  const preset = presets.find((p) => p.code === input.code);
  if (!preset) {
    const err = new Error(`Unknown report preset: ${input.code}`);
    (err as Error & { status: number }).status = 404;
    throw err;
  }
  const title =
    input.locale === "en" && preset.nameEn ? preset.nameEn : preset.nameRu;

  if (preset.queryKind === "package_summary") {
    if (input.zid == null || input.eid == null) {
      const err = new Error("zid and eid required");
      (err as Error & { status: number }).status = 400;
      throw err;
    }
    const rows = (await db
      .prepare(
        `SELECT instance_id, template_id, display_name, status, updated_at
         FROM form_instances WHERE zid = ? AND eid = ?
         ORDER BY template_id`
      )
      .all(input.zid, input.eid)) as Array<Record<string, unknown>>;
    return {
      code: preset.code,
      title,
      columns: ["instance_id", "template_id", "display_name", "status", "updated_at"],
      rows,
    };
  }

  if (preset.queryKind === "bp_status") {
    const where: string[] = ["1=1"];
    const params: unknown[] = [];
    if (input.zid != null) {
      where.push("zid = ?");
      params.push(input.zid);
    }
    if (input.eid != null) {
      where.push("eid = ?");
      params.push(input.eid);
    }
    const rows = (await db
      .prepare(
        `SELECT id, eid, zid, package_kind, status, curator_user_id, iteration, deadline_at, last_changed_at
         FROM business_processes WHERE ${where.join(" AND ")}
         ORDER BY eid DESC, zid`
      )
      .all(...params)) as Array<Record<string, unknown>>;
    return {
      code: preset.code,
      title,
      columns: [
        "id",
        "eid",
        "zid",
        "package_kind",
        "status",
        "curator_user_id",
        "iteration",
        "deadline_at",
        "last_changed_at",
      ],
      rows,
    };
  }

  if (preset.queryKind === "check_failures") {
    if (input.zid == null || input.eid == null) {
      const err = new Error("zid and eid required");
      (err as Error & { status: number }).status = 400;
      throw err;
    }
    const rows = (await db
      .prepare(
        `SELECT run_id, rule_number, check_type, message, form_id, requires_explanation, created_at
         FROM check_run_journal
         WHERE zid = ? AND eid = ? AND passed = 0
         ORDER BY created_at DESC, id DESC
         LIMIT 200`
      )
      .all(input.zid, input.eid)) as Array<Record<string, unknown>>;
    return {
      code: preset.code,
      title,
      columns: [
        "run_id",
        "rule_number",
        "check_type",
        "message",
        "form_id",
        "requires_explanation",
        "created_at",
      ],
      rows,
    };
  }

  const err = new Error(`Unsupported query_kind: ${preset.queryKind}`);
  (err as Error & { status: number }).status = 400;
  throw err;
}
