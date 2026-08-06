/**
 * Import TZ Excel appendices into PSD registries (transfers / minfin / svods).
 *
 * Usage (DATABASE_URL required):
 *   npm run import:tz --prefix server
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { ROOT } from "../paths.js";
import { getDb } from "../db.js";
import { bulkUpsertMinfinMappings, bulkUpsertTransferMaps } from "../transferMaps.js";
import { createSvodDefinition } from "../svodRegistry.js";

const require = createRequire(import.meta.url);

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && v && "text" in (v as object)) {
    return String((v as { text: string }).text ?? "");
  }
  if (typeof v === "object" && v && "result" in (v as object)) {
    return String((v as { result: unknown }).result ?? "");
  }
  return String(v).trim();
}

function loadExcelJS(): { Workbook: new () => any } {
  const candidates = [
    path.join(ROOT, "portal/node_modules/exceljs"),
    path.join(ROOT, "node_modules/exceljs"),
  ];
  for (const c of candidates) {
    try {
      return require(c) as { Workbook: new () => any };
    } catch {
      /* try next */
    }
  }
  throw new Error("exceljs not found — install portal dependencies first");
}

async function main(): Promise<void> {
  const db = await getDb();
  const ExcelJS = loadExcelJS();
  const tzDir = path.join(ROOT, "TZ");
  const report: string[] = [];

  const big = path.join(tzDir, "Приложение 1-10,14-16,18.xlsx");
  if (fs.existsSync(big)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(big);
    let transferRows = 0;
    let minfinRows = 0;
    for (const sheet of wb.worksheets as any[]) {
      const name = String(sheet.name || "").toLowerCase();
      const header: string[] = [];
      sheet.getRow(1).eachCell((c: { value: unknown }, col: number) => {
        header[col] = cellText(c.value).toLowerCase();
      });
      const looksTransfer =
        name.includes("перенос") ||
        name.includes("transfer") ||
        header.some((h) => h.includes("source") || h.includes("источник"));
      const looksMinfin =
        name.includes("минфин") ||
        name.includes("minfin") ||
        header.some((h) => h.includes("excel"));

      const items: Array<Record<string, unknown>> = [];
      sheet.eachRow((row: { eachCell: Function }, rowNumber: number) => {
        if (rowNumber === 1) return;
        const vals: string[] = [];
        row.eachCell((c: { value: unknown }, col: number) => {
          vals[col] = cellText(c.value);
        });
        if (vals.every((v) => !v)) return;
        if (looksTransfer) {
          items.push({
            kind: name.includes("баланс") ? "balance_to_oko" : "period_to_period",
            sourceForm: vals[1] || vals[2] || "UNKNOWN",
            sourceColumn: vals[3] || null,
            sourceRow: vals[4] || null,
            targetForm: vals[5] || vals[2] || "UNKNOWN",
            targetColumn: vals[6] || null,
            targetRow: vals[7] || null,
            condition: { sheet: sheet.name, row: rowNumber },
            active: true,
            sortOrder: rowNumber,
          });
        } else if (looksMinfin) {
          items.push({
            templateName: vals[1] || sheet.name,
            sheetName: vals[2] || sheet.name,
            excelRow: Number(vals[3]) || null,
            excelColumn: vals[4] || null,
            formId: vals[5] || null,
            formColumn: vals[6] || null,
            formRow: vals[7] || null,
            signFactor: Number(vals[8]) || 1,
            active: true,
          });
        }
      });

      if (looksTransfer && items.length) {
        const r = await bulkUpsertTransferMaps(db, items as never);
        transferRows += r.inserted;
        report.push(`Sheet "${sheet.name}": +${r.inserted} transfer_maps`);
      } else if (looksMinfin && items.length) {
        const r = await bulkUpsertMinfinMappings(db, items as never);
        minfinRows += r.inserted;
        report.push(`Sheet "${sheet.name}": +${r.inserted} minfin_mappings`);
      } else {
        report.push(`Sheet "${sheet.name}": skipped (layout not recognized)`);
      }
    }
    report.push(`Totals: transfers=${transferRows}, minfin=${minfinRows}`);
  } else {
    report.push(`Missing ${big}`);
  }

  const svodFile = path.join(tzDir, "Приложение 19_Реестр сводов форм.xlsx");
  if (fs.existsSync(svodFile)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(svodFile);
    const sheet = wb.worksheets[0];
    let created = 0;
    if (sheet) {
      for (let r = 2; r <= (sheet.rowCount || 0); r++) {
        const row = sheet.getRow(r);
        const code = cellText(row.getCell(1).value);
        const name = cellText(row.getCell(2).value) || code;
        if (!code) continue;
        try {
          await createSvodDefinition(db, {
            eid: 1,
            code: `${code}-r${r}`,
            name,
            createdBy: "tz-import",
            members: [],
          });
          created += 1;
        } catch (e) {
          report.push(`svod ${code}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    report.push(`Svod definitions created: ${created}`);
  } else {
    report.push(`Missing ${svodFile}`);
  }

  console.log(report.join("\n"));
  console.log("importTzAppendices: done");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
