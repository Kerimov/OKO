import { useEffect, useRef } from "react";
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreRuRU from "@univerjs/preset-sheets-core/locales/ru-RU";
import "@univerjs/preset-sheets-core/lib/index.css";
import {
  buildSheetModel,
  indexToCol,
  type SheetModel,
} from "@oko/spreadsheet";
import type { FormColumn, RowData } from "../types";

export interface UniverFormHostProps {
  formId: string;
  title?: string;
  columns: FormColumn[];
  rows: RowData[];
  readOnly?: boolean;
  onChange?: (rows: RowData[]) => void;
  height?: number | string;
}

function modelToWorkbookData(model: SheetModel) {
  const visible = model.columns.filter((c) => !c.hidden);
  const cellData: Record<number, Record<number, { v?: string | number; f?: string }>> = {};
  for (let r = 0; r < model.rows.length; r++) {
    const row = model.rows[r];
    cellData[r] = {};
    for (let c = 0; c < visible.length; c++) {
      const col = visible[c];
      const cell = model.cells.find(
        (x) => x.rowId === row.rowId && x.columnKey === col.key
      );
      if (!cell) continue;
      const entry: { v?: string | number; f?: string } = {};
      if (cell.formula?.trim().startsWith("=")) entry.f = cell.formula.trim();
      else if (cell.value !== null && cell.value !== undefined && cell.value !== "") {
        entry.v = typeof cell.value === "boolean" ? (cell.value ? 1 : 0) : cell.value;
      }
      cellData[r][c] = entry;
    }
  }
  return {
    id: model.formId,
    name: model.title || model.formId,
    sheetOrder: ["sheet1"],
    sheets: {
      sheet1: {
        id: "sheet1",
        name: model.formId.slice(0, 31),
        rowCount: Math.max(model.rows.length + 20, 50),
        columnCount: Math.max(visible.length + 5, 26),
        cellData,
      },
    },
  };
}

/**
 * Univer OSS host for OKO forms (Apache-2.0).
 * Enabled when VITE_SPREADSHEET_BACKEND=univer.
 */
export function UniverFormHost({
  formId,
  title,
  columns,
  rows,
  readOnly = false,
  onChange,
  height = 480,
}: UniverFormHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<SheetModel | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const model = buildSheetModel({
      schema: {
        id: formId,
        title: title ?? formId,
        columns,
        rows: rows.map((r, i) => ({
          num: String(r.num ?? ""),
          name: String(r.name ?? ""),
          rowId: `${formId}:${String(r.num ?? "").trim() || `i${i}`}`,
        })),
      },
      dataRows: rows,
    });
    modelRef.current = model;

    const { univerAPI } = createUniver({
      locale: LocaleType.RU_RU,
      locales: {
        [LocaleType.RU_RU]: mergeLocales(UniverPresetSheetsCoreRuRU),
      },
      presets: [
        UniverSheetsCorePreset({
          container: el,
          toolbar: !readOnly,
          formulaBar: true,
          footer: false,
        }),
      ],
    });

    univerAPI.createWorkbook(modelToWorkbookData(model));

    const visible = model.columns.filter((c) => !c.hidden);
    const syncFromUniver = () => {
      if (!onChange || readOnly) return;
      try {
        const fWorkbook = univerAPI.getActiveWorkbook();
        const fSheet = fWorkbook?.getActiveSheet();
        if (!fSheet) return;
        const next = rows.map((r) => ({ ...r }));
        for (let r = 0; r < model.rows.length; r++) {
          for (let c = 0; c < visible.length; c++) {
            const col = visible[c];
            if (col.readonly) continue;
            const addr = `${indexToCol(c + 1)}${r + 1}`;
            const range = fSheet.getRange(addr);
            const v = range?.getValue();
            if (v === undefined || v === null) continue;
            next[r] = { ...next[r], [col.key]: v as string | number };
          }
        }
        onChange(next);
      } catch {
        /* ignore sync glitches during dispose */
      }
    };

    const timer = window.setInterval(syncFromUniver, 1200);

    return () => {
      window.clearInterval(timer);
      try {
        univerAPI.dispose();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remount on structural identity
  }, [formId, readOnly, columns.map((c) => c.key).join(","), rows.length]);

  return (
    <div className="univer-form-host" style={{ height, minHeight: 360, width: "100%" }}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
      <p className="tools-hint spreadsheet-hint">
        Режим Univer OSS (Apache-2.0). Доменные правила OKO (увязки, FTotal, rash) считаются отдельно.
      </p>
    </div>
  );
}

export { isUniverBackendEnabled } from "./spreadsheetFlags";
