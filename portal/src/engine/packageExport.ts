import type { OkoFormInstance } from "../types";

export interface ReportPackage {
  version: string;
  exportedAt: string;
  organization: string;
  periodStart: string;
  periodEnd: string;
  instanceCount: number;
  instances: OkoFormInstance[];
}

export function buildReportPackage(instances: OkoFormInstance[]): ReportPackage {
  const meta = instances[0]?.meta;
  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    organization: meta?.organization ?? "",
    periodStart: meta?.periodStart ?? "",
    periodEnd: meta?.periodEnd ?? "",
    instanceCount: instances.length,
    instances,
  };
}

export function downloadReportPackage(instances: OkoFormInstance[]): void {
  const pkg = buildReportPackage(instances);
  const blob = new Blob([JSON.stringify(pkg, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const org = (pkg.organization || "oko").replace(/[^\wа-яА-ЯёЁ.-]+/gi, "_").slice(0, 30);
  a.download = `oko_package_${org}_${pkg.periodEnd || "report"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function filterInstancesByPeriod(
  instances: OkoFormInstance[],
  periodStart: string,
  periodEnd: string
): OkoFormInstance[] {
  return instances.filter(
    (i) =>
      (!periodStart || i.meta.periodStart === periodStart) &&
      (!periodEnd || i.meta.periodEnd === periodEnd)
  );
}
