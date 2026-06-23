import JSZip from "jszip";
import type { OkoFormInstance } from "../types";
import { buildReportPackage } from "./packageExport";

const TEMPLATE_URL = "/offline-kit-template.zip";

function kitFilename(instances: OkoFormInstance[]): string {
  const pkg = buildReportPackage(instances);
  const org = (pkg.organization || "oko")
    .replace(/[^\wа-яА-ЯёЁ.-]+/gi, "_")
    .slice(0, 30);
  const period = (pkg.periodEnd || pkg.periodStart || "report")
    .replace(/\D/g, "")
    .slice(0, 8);
  return `oko-offline-kit_${org}_${period || "report"}.zip`;
}

/**
 * Скачать ZIP offline-kit: шаблон портала + offline-package.json с комплектом.
 */
export async function downloadOfflineKit(instances: OkoFormInstance[]): Promise<void> {
  if (instances.length === 0) {
    throw new Error("Нет форм для комплекта");
  }

  const res = await fetch(TEMPLATE_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      "Шаблон offline-kit не найден на сервере. Администратору: выполните npm run build (или build:offline-template) при деплое."
    );
  }

  const pkg = buildReportPackage(instances);
  const templateBuf = await res.arrayBuffer();
  const zip = await JSZip.loadAsync(templateBuf);
  zip.file("offline-package.json", JSON.stringify(pkg, null, 2));

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = kitFilename(instances);
  a.click();
  URL.revokeObjectURL(url);
}
