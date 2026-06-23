import type { ChecksData } from "@portal/api";
import type { RowData } from "@portal/types";
import {
  formsUsedByFormChecks,
  runFormChecksWithData,
  type CheckRule,
  type CheckRunResult,
} from "@portal/engine/checkRunCore";
import {
  getPackageInstance,
  loadPackageInstancesForTemplates,
  readPublicJson,
} from "./packageDb.js";

function readCheckRules(): CheckRule[] {
  const raw = readPublicJson("data/checks.json");
  if (Array.isArray(raw)) return raw as CheckRule[];
  const data = raw as ChecksData;
  if (Array.isArray(data?.checks)) return data.checks;
  throw new Error(
    "Правила увязок не найдены. Импортируйте JSON от ЦО с блоком rules или положите data/checks.json."
  );
}

export function runPackageFormChecks(
  formId: string,
  live?: { instanceId: string; rows: RowData[] }
): CheckRunResult {
  const checks = readCheckRules();
  const templateIds = formsUsedByFormChecks(checks, formId);
  let instances = loadPackageInstancesForTemplates(templateIds);

  if (live) {
    let found = false;
    instances = instances.map((inst) => {
      if (inst.instanceId !== live.instanceId) return inst;
      found = true;
      return { ...inst, rows: live.rows };
    });
    if (!found) {
      const current = getPackageInstance(live.instanceId);
      if (current) {
        instances.push({ ...current, rows: live.rows });
      }
    }
  }

  return runFormChecksWithData(checks, formId, instances);
}
