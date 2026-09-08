import { parseReportPackageFile } from "@portal/engine/packageExport";
import {
  applySaldoToTarget,
  compareSaldoByColumns,
  transferSaldoByColumns,
  type SaldoCompareResult,
  type SaldoPhase,
} from "@portal/engine/saldoEngine";
import { loadAllInstances, saveInstance } from "./desktopStorage";

export type { SaldoPhase, SaldoCompareResult };

export interface DesktopSaldoResult {
  updated: number;
  skippedNoSource: number;
  skippedEmpty: number;
  errors: string[];
  compare?: {
    formsCompared: number;
    formsWithDiffs: number;
    totalDiffs: number;
    samples: Array<{ templateId: string; diffs: number }>;
  };
}

/** B3/B4: copy saldo columns from a previous-period ReportPackage JSON into the open kit. */
export async function transferSaldoFromPackageText(
  jsonText: string,
  phase: SaldoPhase,
  options?: { dryRun?: boolean }
): Promise<DesktopSaldoResult> {
  const dryRun = options?.dryRun === true;
  const pkg = parseReportPackageFile(jsonText);
  const byTpl = new Map(pkg.instances.map((i) => [i.templateId, i]));
  const targets = await loadAllInstances();
  const result: DesktopSaldoResult = {
    updated: 0,
    skippedNoSource: 0,
    skippedEmpty: 0,
    errors: [],
  };

  if (dryRun) {
    let formsCompared = 0;
    let formsWithDiffs = 0;
    let totalDiffs = 0;
    const samples: Array<{ templateId: string; diffs: number }> = [];
    for (const target of targets) {
      const source = byTpl.get(target.templateId);
      if (!source) {
        result.skippedNoSource++;
        continue;
      }
      try {
        const cmp = await compareSaldoByColumns({ source, target, phase });
        formsCompared++;
        if (cmp.diffs.length === 0) {
          result.skippedEmpty++;
          continue;
        }
        formsWithDiffs++;
        totalDiffs += cmp.diffs.length;
        if (samples.length < 30) {
          samples.push({ templateId: target.templateId, diffs: cmp.diffs.length });
        }
      } catch (e) {
        result.errors.push(
          `${target.templateId}: ${e instanceof Error ? e.message : "ошибка"}`
        );
      }
    }
    result.compare = { formsCompared, formsWithDiffs, totalDiffs, samples };
    return result;
  }

  for (const target of targets) {
    if (target.status === "submitted") {
      result.skippedEmpty++;
      continue;
    }
    const source = byTpl.get(target.templateId);
    if (!source) {
      result.skippedNoSource++;
      continue;
    }
    try {
      const transfer = await transferSaldoByColumns({ source, target, phase });
      if (transfer.rowsUpdated === 0) {
        result.skippedEmpty++;
        continue;
      }
      await saveInstance(applySaldoToTarget(target, transfer.rows));
      result.updated++;
    } catch (e) {
      result.errors.push(
        `${target.templateId}: ${e instanceof Error ? e.message : "ошибка"}`
      );
    }
  }

  return result;
}
