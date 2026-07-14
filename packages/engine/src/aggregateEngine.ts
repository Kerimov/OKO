import type { OkoFormInstance, RowData } from "./types.js";
import {
  cellMatchesMask,
  type CorrespondenceCellMask,
} from "./correspondenceSpec.js";

export interface AggregateOptions {
  templateId: string;
  sources: OkoFormInstance[];
  displayName?: string;
  /**
   * If set, sum only cells matching the FormCorrespondence color mask
   * (Access AggrSetSumReorg / AggrSetReorg*).
   */
  cellMask?: CorrespondenceCellMask;
  /**
   * When masking: keep non-mask numeric values from the first source.
   * Default false — blank outside the mask (typical Reorg color create).
   */
  preserveUnmasked?: boolean;
  /**
   * AggrGreenUpdate: outside-mask cells taken from this prior parent form
   * (existing корректирующий набор), mask cells re-summed from children.
   */
  preserveRows?: RowData[];
}

export interface AggregateResult {
  instance: OkoFormInstance;
  sourceCount: number;
}

function rowKey(row: RowData): string {
  return String(row.num ?? "").trim();
}

function parseNum(v: string | number | undefined): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function isNumericColumn(key: string): boolean {
  return !["num", "name", "code", "account"].includes(key);
}

/** Sum numeric columns across instances row-by-row (match by num). */
export function aggregateInstances(options: AggregateOptions): AggregateResult {
  const {
    templateId,
    sources,
    cellMask,
    preserveUnmasked = false,
    preserveRows,
  } = options;
  if (sources.length === 0) throw new Error("Нет форм для агрегации");
  if (sources.some((s) => s.templateId !== templateId)) {
    throw new Error("Все формы должны быть одного шаблона");
  }

  const base = sources[0];
  const rowMaps = sources.map((inst) => {
    const m = new Map<string, RowData>();
    for (const r of inst.rows) {
      const k = rowKey(r);
      if (k) m.set(k, r);
    }
    return m;
  });

  const preserveMap = new Map<string, RowData>();
  if (preserveRows) {
    for (const r of preserveRows) {
      const k = rowKey(r);
      if (k) preserveMap.set(k, r);
    }
  }

  const allKeys = new Set<string>();
  for (const m of rowMaps) {
    for (const k of m.keys()) allKeys.add(k);
  }
  for (const k of preserveMap.keys()) allKeys.add(k);

  const columnKeys = new Set<string>();
  for (const inst of sources) {
    for (const row of inst.rows) {
      for (const key of Object.keys(row)) {
        if (isNumericColumn(key)) columnKeys.add(key);
      }
    }
  }
  for (const row of preserveRows ?? []) {
    for (const key of Object.keys(row)) {
      if (isNumericColumn(key)) columnKeys.add(key);
    }
  }

  const rows: RowData[] = [];
  for (const num of Array.from(allKeys).sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  })) {
    const template =
      rowMaps.find((m) => m.has(num))?.get(num) ?? preserveMap.get(num);
    const row: RowData = {};
    if (template?.name) row.name = String(template.name);
    if (template?.code) row.code = String(template.code);
    row.num = num;

    for (const col of columnKeys) {
      const inMask = cellMatchesMask(cellMask, col, num);
      if (!inMask) {
        if (preserveMap.size > 0) {
          const v = preserveMap.get(num)?.[col];
          row[col] = v !== undefined && v !== "" ? v : "";
        } else if (preserveUnmasked) {
          const v = rowMaps[0].get(num)?.[col];
          row[col] = v !== undefined && v !== "" ? v : "";
        } else {
          row[col] = "";
        }
        continue;
      }

      let sum = 0;
      let any = false;
      for (const m of rowMaps) {
        const r = m.get(num);
        if (!r) continue;
        const v = r[col];
        if (v !== undefined && v !== "") {
          sum += parseNum(v);
          any = true;
        }
      }
      row[col] = any ? sum : "";
    }
    rows.push(row);
  }

  const now = new Date().toISOString();
  const instance: OkoFormInstance = {
    instanceId: crypto.randomUUID(),
    templateId,
    templateTitle: base.templateTitle,
    displayName:
      options.displayName ??
      `${templateId} — агрегация (${sources.length}) — ${new Date().toLocaleString("ru-RU")}`,
    meta: { ...base.meta },
    rows,
    signatures: { ...base.signatures },
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };

  return { instance, sourceCount: sources.length };
}
