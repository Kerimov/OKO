import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import type { FormColumn, FormMeta, FormSchema, RowData } from "./types";
import { formatPeriod } from "./utils";

// pdfmake vfs ships Roboto with Cyrillic
const vfs = (pdfFonts as { pdfMake?: { vfs: Record<string, string> } }).pdfMake?.vfs;
if (vfs) {
  (pdfMake as unknown as { vfs: Record<string, string> }).vfs = vfs;
}

function cellText(value: string | number | undefined): string {
  if (value === undefined || value === null || value === "") return "";
  return String(value);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\wа-яА-ЯёЁ.-]+/gi, "_").slice(0, 80);
}

function columnWidths(columns: FormColumn[]): (string | number)[] {
  const n = columns.length;
  if (n <= 3) return columns.map((c) => c.width ?? "*");
  if (n <= 6) return columns.map((c) => (c.frozen ? 90 : "auto"));
  return columns.map((c, i) => {
    if (i === 0 && c.key === "num") return 28;
    if (c.key === "name" || c.key === "account") return "*";
    return "auto";
  });
}

export function exportFormToPdf(options: {
  schema: FormSchema;
  displayName: string;
  meta: FormMeta;
  rows: RowData[];
  signatures: Record<string, string>;
}): void {
  const { schema, displayName, meta, rows, signatures } = options;
  const dataColumns = schema.columns;
  const colCount = dataColumns.length;

  const headerRow: TableCell[] = dataColumns.map((col) => ({
    text: `${col.key}\n${col.label}`,
    style: "tableHeader",
    alignment: col.type === "number" ? "right" : "left",
  }));

  const bodyRows: TableCell[][] = rows.map((row, idx) =>
    dataColumns.map((col) => {
      const raw = row[col.key];
      const text = col.readonly
        ? cellText(raw as string)
        : cellText(raw as string | number);
      return {
        text: text || (col.key === "num" ? String(idx + 1) : ""),
        alignment: col.type === "number" ? "right" : "left",
        fontSize: colCount > 10 ? 6 : colCount > 6 ? 7 : 8,
      };
    })
  );

  const content: Content[] = [
    { text: schema.id, style: "formCode" },
    { text: schema.title, style: "title" },
    { text: displayName, style: "subtitle", margin: [0, 0, 0, 8] },
    {
      columns: [
        {
          width: "*",
          stack: [
            {
              text: `Предприятие: ${meta.enterpriseCode || "—"}`,
              style: "meta",
            },
            {
              text: `Организация: ${meta.organization || "—"}`,
              style: "meta",
            },
          ],
        },
        {
          width: "auto",
          stack: [
            {
              text: `Отчётный период: ${formatPeriod(meta.periodStart, meta.periodEnd)}`,
              style: "meta",
            },
            { text: `Ед. изм.: ${meta.unit || "—"}`, style: "meta" },
            {
              text: `Дата выгрузки: ${new Date().toLocaleString("ru-RU")}`,
              style: "meta",
            },
          ],
        },
      ],
      margin: [0, 0, 0, 10],
    },
    {
      table: {
        headerRows: 1,
        widths: columnWidths(dataColumns),
        body: [headerRow, ...bodyRows],
      },
      layout: {
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => "#cccccc",
        vLineColor: () => "#cccccc",
        paddingLeft: () => 3,
        paddingRight: () => 3,
        paddingTop: () => 2,
        paddingBottom: () => 2,
      },
    },
  ];

  const sigEntries = Object.entries(signatures).filter(([, v]) => v.trim());
  if (schema.signatures.length > 0) {
    content.push({ text: "\n" });
    content.push({ text: "Подписи", style: "sectionTitle", margin: [0, 8, 0, 4] });
    for (const name of schema.signatures) {
      content.push({
        text: `${name}: ${signatures[name]?.trim() || "________________"}`,
        style: "signature",
        margin: [0, 4, 0, 0],
      });
    }
  } else if (sigEntries.length > 0) {
    for (const [name, val] of sigEntries) {
      content.push({
        text: `${name}: ${val}`,
        style: "signature",
        margin: [0, 8, 0, 0],
      });
    }
  }

  const useLandscape = colCount > 5;
  const fontSize = colCount > 14 ? 6 : colCount > 8 ? 7 : 8;

  const doc: TDocumentDefinitions = {
    pageSize: colCount > 12 ? "A3" : "A4",
    pageOrientation: useLandscape ? "landscape" : "portrait",
    pageMargins: [28, 36, 28, 36],
    defaultStyle: {
      font: "Roboto",
      fontSize,
    },
    styles: {
      formCode: { fontSize: 10, bold: true, color: "#003d7a" },
      title: { fontSize: 12, bold: true, margin: [0, 2, 0, 0] },
      subtitle: { fontSize: 9, italics: true, color: "#444444" },
      meta: { fontSize: 8, margin: [0, 1, 0, 1] },
      sectionTitle: { fontSize: 10, bold: true },
      tableHeader: {
        bold: true,
        fontSize: colCount > 10 ? 6 : 7,
        fillColor: "#002855",
        color: "#ffffff",
      },
      signature: { fontSize: 9 },
    },
    content,
    footer: (currentPage, pageCount) => ({
      text: `Стр. ${currentPage} из ${pageCount}`,
      alignment: "center",
      fontSize: 8,
      color: "#666666",
      margin: [0, 8, 0, 0],
    }),
  };

  const filename = `${sanitizeFilename(displayName || schema.id)}.pdf`;
  pdfMake.createPdf(doc).download(filename);
}
