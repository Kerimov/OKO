import type { OkoFormInstance } from "../types";
import type { PackageRulesBundle } from "./packageRules";
import { downloadBlob, zipStoreFiles } from "./zipStore";

export interface ReportPackage {
  version: string;
  exportedAt: string;
  organization: string;
  periodStart: string;
  periodEnd: string;
  zid?: number | null;
  eid?: number | null;
  /** Stable package GUID from periods.package_id. */
  packageId?: string | null;
  instanceCount: number;
  instances: OkoFormInstance[];
  /** Правила проверок и справочники с ЦО (v1.2+). */
  rules?: PackageRulesBundle;
}

export async function buildReportPackage(
  instances: OkoFormInstance[],
  options?: { includeRules?: boolean }
): Promise<ReportPackage> {
  const meta = instances[0]?.meta;
  const first = instances[0];
  const { loadPackageRulesBundle } = await import("./packageRules");

  const pkg: ReportPackage = {
    version: "1.2",
    exportedAt: new Date().toISOString(),
    organization: meta?.organization ?? "",
    periodStart: meta?.periodStart ?? "",
    periodEnd: meta?.periodEnd ?? "",
    zid: first?.zid ?? null,
    eid: first?.eid ?? null,
    instanceCount: instances.length,
    instances,
  };

  if (options?.includeRules !== false) {
    pkg.rules = await loadPackageRulesBundle();
  }

  return pkg;
}

function packageBaseName(pkg: ReportPackage, filename?: string): string {
  if (filename) return filename.replace(/\.zip$/i, "").replace(/\.json$/i, "");
  const org = (pkg.organization || "oko")
    .replace(/[^\wа-яА-ЯёЁ.-]+/gi, "_")
    .slice(0, 30);
  const period = (pkg.periodEnd || pkg.periodStart || "report")
    .replace(/\D/g, "")
    .slice(0, 8);
  return `oko_package_${org}_${period || "report"}`;
}

export async function downloadReportPackage(
  instances: OkoFormInstance[],
  filename?: string,
  options?: { zip?: boolean }
): Promise<void> {
  const pkg = await buildReportPackage(instances);
  const base = packageBaseName(pkg, filename);
  const jsonName = `${base}.json`;
  const jsonText = JSON.stringify(pkg, null, 2);

  if (options?.zip) {
    const zipped = zipStoreFiles([{ name: jsonName, data: jsonText }]);
    downloadBlob(
      new Blob([zipped], { type: "application/zip" }),
      `${base}.zip`
    );
    return;
  }

  downloadBlob(
    new Blob([jsonText], { type: "application/json" }),
    filename?.endsWith(".json") ? filename : `${base}.json`
  );
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
    rules: data.rules,
  };
}

export async function readReportPackageFile(file: File): Promise<ReportPackage> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip")) {
    const { unzipFirstJson } = await import("./zipRead");
    const text = await unzipFirstJson(await file.arrayBuffer());
    return parseReportPackageFile(text);
  }
  const text = await file.text();
  return parseReportPackageFile(text);
}

/**
 * Read one or many ReportPackages from a JSON file or a ZIP
 * (bulk export: several oko_package_*.json + optional manifest.json).
 */
export async function readReportPackagesFromFile(
  file: File
): Promise<Array<{ name: string; package: ReportPackage }>> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip")) {
    const { unzipAllPackageJson } = await import("./zipRead");
    const entries = await unzipAllPackageJson(await file.arrayBuffer());
    const packages: Array<{ name: string; package: ReportPackage }> = [];
    for (const entry of entries) {
      try {
        const parsed = JSON.parse(entry.text) as { instances?: unknown };
        // Skip non-package JSON (e.g. empty objects)
        if (!parsed.instances || !Array.isArray(parsed.instances)) continue;
        packages.push({
          name: entry.name.split("/").pop() ?? entry.name,
          package: parseReportPackageFile(entry.text),
        });
      } catch {
        /* skip invalid entry */
      }
    }
    if (!packages.length) {
      throw new Error("В ZIP нет распознанных комплектов OKO");
    }
    return packages;
  }
  const text = await file.text();
  const pkg = parseReportPackageFile(text);
  return [{ name: file.name, package: pkg }];
}

