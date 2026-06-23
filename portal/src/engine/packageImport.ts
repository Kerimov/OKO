import type { OkoFormInstance } from "../types";
import type { ReportPackage } from "./packageExport";

export interface ImportPackageOptions {
  targetZid: number;
  targetEid: number;
  overwrite: boolean;
}

export interface ImportPackageResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export function normalizeImportedInstance(
  inst: OkoFormInstance,
  targetZid: number,
  targetEid: number,
  organization: string
): OkoFormInstance {
  const now = new Date().toISOString();
  return {
    ...inst,
    zid: targetZid,
    eid: targetEid,
    meta: {
      ...inst.meta,
      organization: organization || inst.meta.organization,
    },
    status: inst.status === "submitted" ? "submitted" : "draft",
    createdAt: inst.createdAt || now,
    updatedAt: now,
  };
}

/** localStorage: merge package into existing instances by templateId. */
export function mergePackageIntoInstances(
  pkg: ReportPackage,
  existing: OkoFormInstance[],
  options: ImportPackageOptions
): { instances: OkoFormInstance[]; result: ImportPackageResult } {
  const { targetZid, targetEid, overwrite } = options;
  const organization = pkg.organization || pkg.instances[0]?.meta?.organization || "";
  const byTemplate = new Map<string, OkoFormInstance>();
  for (const inst of existing) {
    if (inst.zid === targetZid && inst.eid === targetEid) {
      byTemplate.set(inst.templateId, inst);
    }
  }

  const result: ImportPackageResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  const output = existing.filter(
    (i) => !(i.zid === targetZid && i.eid === targetEid)
  );
  const importedForPeriod: OkoFormInstance[] = [];

  for (const raw of pkg.instances) {
    try {
      const normalized = normalizeImportedInstance(
        raw,
        targetZid,
        targetEid,
        organization
      );
      const prev = byTemplate.get(normalized.templateId);
      if (prev) {
        if (!overwrite) {
          importedForPeriod.push(prev);
          result.skipped++;
          continue;
        }
        normalized.instanceId = prev.instanceId;
        normalized.createdAt = prev.createdAt;
        importedForPeriod.push(normalized);
        result.updated++;
      } else {
        if (!normalized.instanceId) {
          normalized.instanceId = crypto.randomUUID();
        }
        importedForPeriod.push(normalized);
        result.created++;
      }
    } catch (e) {
      result.errors.push(
        `${raw.templateId ?? "?"}: ${e instanceof Error ? e.message : "ошибка"}`
      );
    }
  }

  return {
    instances: [...output, ...importedForPeriod],
    result,
  };
}
