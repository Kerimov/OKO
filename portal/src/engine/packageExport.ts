import type { OkoFormInstance } from "../types";

export interface ReportPackage {
  version: string;
  exportedAt: string;
  organization: string;
  periodStart: string;
  periodEnd: string;
  zid?: number | null;
  eid?: number | null;
  instanceCount: number;
  instances: OkoFormInstance[];
}

export function buildReportPackage(instances: OkoFormInstance[]): ReportPackage {
  const meta = instances[0]?.meta;
  const first = instances[0];
  return {
    version: "1.1",
    exportedAt: new Date().toISOString(),
    organization: meta?.organization ?? "",
    periodStart: meta?.periodStart ?? "",
    periodEnd: meta?.periodEnd ?? "",
    zid: first?.zid ?? null,
    eid: first?.eid ?? null,
    instanceCount: instances.length,
    instances,
  };
}

export function downloadReportPackage(
  instances: OkoFormInstance[],
  filename?: string
): void {
  const pkg = buildReportPackage(instances);
  const blob = new Blob([JSON.stringify(pkg, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const org = (pkg.organization || "oko")
    .replace(/[^\wа-яА-ЯёЁ.-]+/gi, "_")
    .slice(0, 30);
  const period = (pkg.periodEnd || pkg.periodStart || "report").replace(/\D/g, "").slice(0, 8);
  a.download =
    filename ?? `oko_package_${org}_${period || "report"}.json`;
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

export function parseReportPackageFile(text: string): ReportPackage {
  const data = JSON.parse(text) as ReportPackage & {
    instances?: unknown;
  };
  if (!data.instances || !Array.isArray(data.instances)) {
    throw new Error("Файл не является комплектом OKO: нет массива instances");
  }
  if (data.instances.length === 0) {
    throw new Error("Комплект пуст (0 форм)");
  }
  for (let i = 0; i < data.instances.length; i++) {
    const inst = data.instances[i] as OkoFormInstance;
    if (!inst.templateId) {
      throw new Error(`Форма #${i + 1}: отсутствует templateId`);
    }
    if (!inst.meta) {
      throw new Error(`Форма ${inst.templateId}: отсутствуют реквизиты (meta)`);
    }
    if (!Array.isArray(inst.rows)) {
      throw new Error(`Форма ${inst.templateId}: отсутствуют данные (rows)`);
    }
  }
  return {
    version: data.version ?? "1.0",
    exportedAt: data.exportedAt ?? new Date().toISOString(),
    organization: data.organization ?? data.instances[0]?.meta?.organization ?? "",
    periodStart: data.periodStart ?? data.instances[0]?.meta?.periodStart ?? "",
    periodEnd: data.periodEnd ?? data.instances[0]?.meta?.periodEnd ?? "",
    zid: data.zid ?? data.instances[0]?.zid ?? null,
    eid: data.eid ?? data.instances[0]?.eid ?? null,
    instanceCount: data.instances.length,
    instances: data.instances as OkoFormInstance[],
  };
}

export async function readReportPackageFile(file: File): Promise<ReportPackage> {
  const text = await file.text();
  return parseReportPackageFile(text);
}
