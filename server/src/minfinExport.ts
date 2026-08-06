import fs from "fs";
import path from "path";
import { createRequire } from "module";
import type { OkoDb } from "./oko-db.js";
import { ROOT } from "./paths.js";
import { listMinfinMappings } from "./transferMaps.js";
import { exportExcelPayload, type ExcelMappingDto } from "./excel.js";
import {
  findInstanceIdByPackageTemplate,
  loadInstance,
} from "./instances.js";
import {
  INTEGRATION_CODES,
  type MinFinExportPort,
  type MinFinExportRequest,
  type MinFinExportResult,
} from "./integrations/ports.js";

const require = createRequire(import.meta.url);

export function resolveMinfinTemplatePath(): string | null {
  const candidates = [
    process.env.OKO_MINFIN_TEMPLATE?.trim(),
    path.join(ROOT, "12345", "ШаблоныФорм-МинФин.xlsx"),
    path.join(ROOT, "portal", "public", "templates", "minfin.xlsx"),
    path.join(ROOT, "reference", "ШаблоныФорм-МинФин.xlsx"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function loadExcelJS(): {
  Workbook: new () => {
    xlsx: { readFile: (p: string) => Promise<unknown>; writeBuffer: () => Promise<ArrayBuffer | Buffer> };
    getWorksheet: (name: string) => any;
    worksheets: any[];
  };
} {
  const candidates = [
    path.join(ROOT, "portal/node_modules/exceljs"),
    path.join(ROOT, "node_modules/exceljs"),
  ];
  for (const c of candidates) {
    try {
      return require(c) as ReturnType<typeof loadExcelJS>;
    } catch {
      /* next */
    }
  }
  throw new Error("exceljs not found (install portal dependencies)");
}

function colToNumber(col: number | string | null | undefined): number | null {
  if (col == null || col === "") return null;
  if (typeof col === "number" && Number.isFinite(col)) return col;
  const s = String(col).trim().toUpperCase();
  if (/^\d+$/.test(s)) return Number(s);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 65 || code > 90) return null;
    n = n * 26 + (code - 64);
  }
  return n || null;
}

function setCell(ws: any, row: number, col: number | string | null | undefined, value: unknown): boolean {
  const c = colToNumber(col);
  if (c == null || !Number.isFinite(row) || row < 1) return false;
  try {
    ws.getCell(row, c).value = value as never;
    return true;
  } catch {
    return false;
  }
}

function rowValue(
  rows: Array<Record<string, string | number>>,
  formRow: string | number | null | undefined,
  formColumn: string | null | undefined
): string | number | null {
  if (formRow == null || !formColumn) return null;
  const key = String(formRow).trim();
  const row = rows.find(
    (r) =>
      String(r.num ?? "").trim() === key ||
      String(r.code ?? "").trim() === key ||
      String(r.account ?? "").trim() === key
  );
  if (!row) return null;
  const v = row[formColumn];
  if (v === undefined || v === null || v === "") return null;
  return v;
}

type FillMapping = {
  sheetName: string | null;
  excelRow: number | null;
  excelColumn: number | string | null;
  formId: string | null;
  formColumn: string | null;
  formRow: string | number | null;
  signFactor: number;
  isHeader: boolean;
  periodToken: string | null;
};

async function resolveFillMappings(
  db: OkoDb,
  templateName: string
): Promise<{ mappings: FillMapping[]; source: string }> {
  const minfin = (await listMinfinMappings(db, templateName)).filter((m) => m.active);
  if (minfin.length > 0) {
    return {
      source: "minfin_mappings",
      mappings: minfin.map((m) => ({
        sheetName: m.sheetName,
        excelRow: m.excelRow,
        excelColumn: m.excelColumn,
        formId: m.formId,
        formColumn: m.formColumn,
        formRow: m.formRow,
        signFactor: m.signFactor || 1,
        isHeader: m.isHeader,
        periodToken: m.periodToken,
      })),
    };
  }

  // Fallback: use classic OKO excel_mappings (seeded from excel-export.json)
  const payload = await exportExcelPayload(db);
  const all = (payload.mappings ?? []) as ExcelMappingDto[];
  const filtered =
    templateName && templateName !== "default" && templateName !== "ШаблоныФорм-МинФин"
      ? all.filter((m) => m.formName === templateName || m.sheetName === templateName)
      : all;
  const use = filtered.length > 0 ? filtered : all;
  return {
    source: "excel_mappings",
    mappings: use.map((m) => ({
      sheetName: m.sheetName,
      excelRow: m.excelRow,
      excelColumn: m.excelColumn,
      formId: m.formName,
      formColumn: m.formColumn,
      formRow: m.formRow,
      signFactor: 1,
      isHeader: m.formRow == null,
      periodToken: null,
    })),
  };
}

export class MappingTableMinFinExport implements MinFinExportPort {
  readonly name = "minfin-template-12345";

  constructor(private readonly db: OkoDb) {}

  isConfigured(): boolean {
    return resolveMinfinTemplatePath() != null;
  }

  async export(req: MinFinExportRequest): Promise<MinFinExportResult & { filename?: string; base64?: string }> {
    const templatePath = resolveMinfinTemplatePath();
    if (!templatePath) {
      return {
        ok: false,
        code: "MINFIN_TEMPLATE_FILE_MISSING",
        message:
          "MinFin template not found. Expected 12345/ШаблоныФорм-МинФин.xlsx (or OKO_MINFIN_TEMPLATE)",
        mappingCount: 0,
      };
    }

    const { mappings, source } = await resolveFillMappings(
      this.db,
      req.templateName?.trim() || "default"
    );
    if (mappings.length === 0) {
      return {
        ok: false,
        code: INTEGRATION_CODES.MINFIN_MAPPINGS_EMPTY,
        message: `No MinFin/excel mappings for template "${req.templateName}"`,
        mappingCount: 0,
      };
    }

    const ExcelJS = loadExcelJS();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(templatePath);

    const instanceCache = new Map<string, Awaited<ReturnType<typeof loadInstance>>>();
    let written = 0;
    let skipped = 0;

    // Org / period header context
    const org = (await this.db
      .prepare(`SELECT name, code FROM organizations WHERE zid = ?`)
      .get(req.zid)) as { name: string; code: string | null } | undefined;
    const period = (await this.db
      .prepare(`SELECT name, period_start, period_end FROM periods WHERE eid = ? AND zid = ?`)
      .get(req.eid, req.zid)) as
      | { name: string; period_start: string | null; period_end: string | null }
      | undefined;

    for (const m of mappings) {
      const sheetName = m.sheetName?.trim() || null;
      const ws = sheetName
        ? wb.getWorksheet(sheetName) ??
          wb.worksheets.find(
            (s: { name: string }) => s.name.toLowerCase() === sheetName.toLowerCase()
          )
        : wb.worksheets[0];
      if (!ws) {
        skipped += 1;
        continue;
      }

      // Header / meta cells
      if (m.isHeader || m.formRow == null) {
        const col = String(m.formColumn ?? m.periodToken ?? "").toLowerCase();
        let val: string | number | null = null;
        if (col === "org" || col === "organization") val = org?.name ?? null;
        else if (col === "code" || col === "org_code") val = org?.code ?? null;
        else if (col === "period" || col === "per_rep" || col === "period_end")
          val = period?.period_end ?? period?.name ?? null;
        else if (col === "period_start") val = period?.period_start ?? null;
        else if (col === "date" || col === "date()")
          val = new Date().toISOString().slice(0, 10);
        if (val == null) {
          skipped += 1;
          continue;
        }
        if (setCell(ws, Number(m.excelRow), m.excelColumn, val)) written += 1;
        else skipped += 1;
        continue;
      }

      const formId = m.formId?.trim();
      if (!formId || m.excelRow == null) {
        skipped += 1;
        continue;
      }

      let inst = instanceCache.get(formId);
      if (inst === undefined) {
        const id = await findInstanceIdByPackageTemplate(this.db, req.zid, req.eid, formId);
        inst = id ? await loadInstance(this.db, id) : null;
        instanceCache.set(formId, inst);
      }
      if (!inst?.rows?.length) {
        skipped += 1;
        continue;
      }

      let val = rowValue(inst.rows as Array<Record<string, string | number>>, m.formRow, m.formColumn);
      if (val == null) {
        skipped += 1;
        continue;
      }
      if (typeof val === "number" && m.signFactor && m.signFactor !== 1) {
        val = val * m.signFactor;
      } else if (typeof val === "string" && m.signFactor && m.signFactor !== 1) {
        const n = parseFloat(val.replace(/\s/g, "").replace(",", "."));
        if (Number.isFinite(n)) val = n * m.signFactor;
      }

      if (setCell(ws, Number(m.excelRow), m.excelColumn, val)) written += 1;
      else skipped += 1;
    }

    const raw = await wb.xlsx.writeBuffer();
    const buf = Buffer.isBuffer(raw)
      ? raw
      : Buffer.from(new Uint8Array(raw as ArrayBuffer));
    const filename = `minfin-${req.zid}-${req.eid}.xlsx`;
    return {
      ok: true,
      code: "OK",
      message: `Filled from ${path.basename(templatePath)} via ${source}: written=${written}, skipped=${skipped}`,
      mappingCount: mappings.length,
      buffer: buf,
      filename,
      base64: buf.toString("base64"),
    };
  }
}

/** Re-export path helper for integrations status. */
export function minfinTemplateConfigured(): boolean {
  return resolveMinfinTemplatePath() != null;
}
