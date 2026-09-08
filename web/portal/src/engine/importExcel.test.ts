import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { previewXlsxFormImport } from "./importExcel";
import type { FormSchema, RowData } from "../types";

async function sampleWorkbook(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("N01");
  ws.addRow(["num", "B", "C"]);
  ws.addRow([100, 10, 20]);
  ws.addRow([200, 1, 2]);
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

describe("previewXlsxFormImport", () => {
  it("maps row numbers and skips readonly", async () => {
    const schema: FormSchema = {
      id: "N01_1",
      title: "T",
      category: "N01",
      pages: 1,
      meta: {
        organization: "",
        enterpriseCode: "1@1",
        periodStart: "",
        periodEnd: "",
        unit: "тыс.руб.",
      },
      columns: [
        { key: "num", label: "№", type: "text" },
        { key: "name", label: "Имя", type: "text" },
        { key: "B", label: "B", type: "number" },
        { key: "C", label: "C", type: "number", readonly: true },
      ],
      rows: [],
      signatures: [],
    };
    const current: RowData[] = [
      { num: "100", name: "A", B: 0, C: 0 },
      { num: "200", name: "B", B: 0, C: 0 },
    ];
    const preview = await previewXlsxFormImport({
      buffer: await sampleWorkbook(),
      schema,
      currentRows: current,
    });
    expect(preview.matchedRows).toBe(2);
    expect(preview.proposedRows[0].B).toBe(10);
    expect(preview.diffs.some((d) => d.columnKey === "C" && d.readonly)).toBe(true);
  });

  it("rejects raw Excel formulas and keeps current value", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("N01");
    ws.addRow(["num", "B"]);
    ws.addRow([100, "=1+2"]);
    const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const schema: FormSchema = {
      id: "N01_1",
      title: "T",
      category: "N01",
      pages: 1,
      meta: {
        organization: "",
        enterpriseCode: "1@1",
        periodStart: "",
        periodEnd: "",
        unit: "тыс.руб.",
      },
      columns: [
        { key: "num", label: "№", type: "text" },
        { key: "name", label: "Имя", type: "text" },
        { key: "B", label: "B", type: "number" },
      ],
      rows: [],
      signatures: [],
    };
    const preview = await previewXlsxFormImport({
      buffer: buf,
      schema,
      currentRows: [{ num: "100", name: "A", B: 7 }],
    });
    expect(preview.proposedRows[0].B).toBe(7);
    expect(preview.warnings.some((w) => /формул/i.test(w))).toBe(true);
  });
});
