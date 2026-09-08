import { listInstances, loadInstance } from "../../storage";
import type { OkoFormInstance, PackageWorkspaceRow } from "../../types";
import { StatusBadge } from "../../components/ui";

export function formatExchangeAt(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function rowKey(r: { packageId?: string; zid: number; eid: number }): string {
  return r.packageId?.trim() || `${r.zid}:${r.eid}`;
}

export function isPackageFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".json") ||
    name.endsWith(".zip") ||
    file.type === "application/json" ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed"
  );
}

export async function loadPackageInstances(zid: number, eid: number): Promise<OkoFormInstance[]> {
  const summaries = await listInstances({ zid, eid });
  const instances: OkoFormInstance[] = [];
  for (const s of summaries) {
    const inst = await loadInstance(s.instanceId);
    if (inst) instances.push({ ...inst, zid, eid });
  }
  return instances;
}

export type UploadMarkFilter = "" | "imported" | "pending";

export function ExchangeMarksCell({
  row,
  showExported = true,
}: {
  row: PackageWorkspaceRow;
  showExported?: boolean;
}) {
  const importVersionNum = Number(row.importVersion ?? 0);
  const importVersion =
    row.lastImportedAt && importVersionNum > 0 ? importVersionNum : null;
  return (
    <>
      <div className="exchange-marks">
        {row.lastImportedAt ? (
          <StatusBadge
            tone="imported"
            title={
              formatExchangeAt(row.lastImportedAt) +
              (importVersion != null ? ` · версия ${importVersion}` : "")
            }
            label={`Загружено${importVersion != null ? ` · v${importVersion}` : ""}`}
          />
        ) : (
          <StatusBadge tone="draft" title="Файл ещё не принимали" label="Не загружено" />
        )}
        {showExported && row.lastExportedAt ? (
          <StatusBadge
            tone="exported"
            title={formatExchangeAt(row.lastExportedAt)}
            label="Выгружено"
          />
        ) : null}
      </div>
      <div className="table-sub">
        {row.lastImportedAt
          ? [
              formatExchangeAt(row.lastImportedAt),
              importVersion != null ? `версия ${importVersion}` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : showExported && row.lastExportedAt
            ? `выгрузка ${formatExchangeAt(row.lastExportedAt)}`
            : "—"}
      </div>
    </>
  );
}
