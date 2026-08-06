import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { CollapsibleFilters, countActiveFilters } from "../../components/CollapsibleFilters";
import {
  buildPackageCellDiffs,
  buildPackageDiff,
  verdictLabel,
  type PackageCellDiff,
  type PackageDiffRow,
} from "../../engine/packageDiff";
import {
  readReportPackagesFromFile,
  type ReportPackage,
} from "../../engine/packageExport";
import { downloadBlob } from "../../engine/zipStore";
import {
  exportReportPackagesBulk,
  fetchPackageWorkspace,
  importReportPackage,
  importReportPackagesBulk,
  type BulkImportPackageResult,
} from "../../packagesApi";
import { listInstances, loadInstance } from "../../storage";
import type { OkoFormInstance, PackageWorkspaceRow } from "../../types";
import { bpStatusLabel, packageKindLabel } from "../../uiLabels";
import { loadSchema } from "../../api";
import type { ExchangeMode } from "./tabs";
import { Button, StatusBadge } from "../../components/ui";

function formatExchangeAt(iso: string | null | undefined): string {
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

function rowKey(r: { zid: number; eid: number }): string {
  return `${r.zid}:${r.eid}`;
}

function isPackageFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".json") ||
    name.endsWith(".zip") ||
    file.type === "application/json" ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed"
  );
}

async function loadPackageInstances(zid: number, eid: number): Promise<OkoFormInstance[]> {
  const summaries = await listInstances({ zid, eid });
  const instances: OkoFormInstance[] = [];
  for (const s of summaries) {
    const inst = await loadInstance(s.instanceId);
    if (inst) instances.push({ ...inst, zid, eid });
  }
  return instances;
}

type UploadMarkFilter = "" | "imported" | "pending";

function useWorkspacePackageList() {
  const [workspaceRows, setWorkspaceRows] = useState<PackageWorkspaceRow[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [bulkSearch, setBulkSearch] = useState("");
  const [bulkPeriod, setBulkPeriod] = useState("");
  const [bulkKind, setBulkKind] = useState("");
  const [bulkBp, setBulkBp] = useState("");
  const [bulkOnlyFilled, setBulkOnlyFilled] = useState(false);
  const [uploadMark, setUploadMark] = useState<UploadMarkFilter>("");

  const reloadWorkspace = useCallback(async () => {
    setWorkspaceLoading(true);
    try {
      setWorkspaceRows(await fetchPackageWorkspace());
    } catch (e) {
      // Keep previous rows — clearing the list on a transient error looks like
      // «комплекты пропали».
      throw e instanceof Error
        ? e
        : new Error("Не удалось загрузить список комплектов");
    } finally {
      setWorkspaceLoading(false);
    }
  }, []);

  const periodOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of workspaceRows) {
      const key = r.periodName || String(r.eid);
      if (!map.has(key)) map.set(key, key);
    }
    return [...map.keys()].sort((a, b) => a.localeCompare(b, "ru"));
  }, [workspaceRows]);

  const filteredRows = useMemo(() => {
    const q = bulkSearch.trim().toLowerCase();
    return workspaceRows.filter((r) => {
      if (bulkPeriod && (r.periodName || String(r.eid)) !== bulkPeriod) return false;
      if (bulkKind && r.packageKind !== bulkKind) return false;
      if (bulkBp && r.bpStatus !== bulkBp) return false;
      if (bulkOnlyFilled && !(r.total > 0 && r.filled >= r.total)) return false;
      if (uploadMark === "imported" && !r.lastImportedAt) return false;
      if (uploadMark === "pending" && r.lastImportedAt) return false;
      if (!q) return true;
      return (
        r.organizationName.toLowerCase().includes(q) ||
        (r.organizationCode ?? "").toLowerCase().includes(q) ||
        (r.periodName ?? "").toLowerCase().includes(q) ||
        String(r.zid).includes(q) ||
        String(r.eid).includes(q)
      );
    });
  }, [
    workspaceRows,
    bulkSearch,
    bulkPeriod,
    bulkKind,
    bulkBp,
    bulkOnlyFilled,
    uploadMark,
  ]);

  return {
    workspaceRows,
    workspaceLoading,
    reloadWorkspace,
    periodOptions,
    filteredRows,
    filters: {
      bulkSearch,
      setBulkSearch,
      bulkPeriod,
      setBulkPeriod,
      bulkKind,
      setBulkKind,
      bulkBp,
      setBulkBp,
      bulkOnlyFilled,
      setBulkOnlyFilled,
      uploadMark,
      setUploadMark,
    },
  };
}

function ExchangeMarksCell({
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

function WorkspaceFilters({
  periodOptions,
  filters,
  showUploadMarkFilter,
}: {
  periodOptions: string[];
  filters: ReturnType<typeof useWorkspacePackageList>["filters"];
  showUploadMarkFilter?: boolean;
}) {
  const {
    bulkSearch,
    setBulkSearch,
    bulkPeriod,
    setBulkPeriod,
    bulkKind,
    setBulkKind,
    bulkBp,
    setBulkBp,
    bulkOnlyFilled,
    setBulkOnlyFilled,
    uploadMark,
    setUploadMark,
  } = filters;

  return (
    <CollapsibleFilters
      activeCount={countActiveFilters(
        bulkSearch.trim().length > 0,
        bulkPeriod !== "",
        bulkKind !== "",
        bulkBp !== "",
        bulkOnlyFilled,
        Boolean(showUploadMarkFilter && uploadMark)
      )}
      bodyClassName="tools-grid"
    >
      <label>
        Поиск
        <input
          type="search"
          value={bulkSearch}
          onChange={(e) => setBulkSearch(e.target.value)}
          placeholder="Организация или период…"
        />
      </label>
      <label>
        Период
        <select value={bulkPeriod} onChange={(e) => setBulkPeriod(e.target.value)}>
          <option value="">Все</option>
          {periodOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label>
        Тип
        <select value={bulkKind} onChange={(e) => setBulkKind(e.target.value)}>
          <option value="">Все</option>
          <option value="OKO">{packageKindLabel("OKO")}</option>
          <option value="BALANCE">{packageKindLabel("BALANCE")}</option>
        </select>
      </label>
      <label>
        Статус БП
        <select value={bulkBp} onChange={(e) => setBulkBp(e.target.value)}>
          <option value="">Все</option>
          <option value="not_started">{bpStatusLabel("not_started")}</option>
          <option value="collecting">{bpStatusLabel("collecting")}</option>
          <option value="pending_curator_approval">
            {bpStatusLabel("pending_curator_approval")}
          </option>
          <option value="curator_approved">{bpStatusLabel("curator_approved")}</option>
          <option value="completed">{bpStatusLabel("completed")}</option>
        </select>
      </label>
      {showUploadMarkFilter && (
        <label>
          Загрузка
          <select
            value={uploadMark}
            onChange={(e) => setUploadMark(e.target.value as UploadMarkFilter)}
          >
            <option value="">Все</option>
            <option value="pending">Не загружено</option>
            <option value="imported">Уже загружено</option>
          </select>
        </label>
      )}
      <label className="checkbox-inline" style={{ alignSelf: "end" }}>
        <input
          type="checkbox"
          checked={bulkOnlyFilled}
          onChange={(e) => setBulkOnlyFilled(e.target.checked)}
        />
        Только полные
      </label>
    </CollapsibleFilters>
  );
}

function WorkspacePackagesTable({
  rows,
  loading,
  selectable,
  checkedKeys,
  busy,
  onToggle,
  highlightImported,
  showExportedMark = true,
}: {
  rows: PackageWorkspaceRow[];
  loading: boolean;
  selectable?: boolean;
  checkedKeys?: Set<string>;
  busy?: boolean;
  onToggle?: (key: string, checked: boolean) => void;
  highlightImported?: boolean;
  showExportedMark?: boolean;
}) {
  if (loading) {
    return <p className="hint-text">Загрузка комплектов…</p>;
  }
  return (
    <div className="table-wrap exchange-table-wrap">
      <table className="form-table exchange-packages-table">
        <thead>
          <tr>
            {selectable ? <th className="table-col-check" /> : null}
            <th>Организация</th>
            <th>Период</th>
            <th>Тип</th>
            <th>Формы</th>
            <th>Обмен</th>
            <th>БП</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = rowKey(r);
            const imported = Boolean(r.lastImportedAt);
            return (
              <tr
                key={key}
                className={
                  highlightImported && imported ? "exchange-row-imported" : undefined
                }
              >
                {selectable ? (
                  <td>
                    <input
                      type="checkbox"
                      checked={checkedKeys?.has(key) ?? false}
                      disabled={busy}
                      onChange={(e) => onToggle?.(key, e.target.checked)}
                      aria-label={`Выбрать ${r.organizationName}`}
                    />
                  </td>
                ) : null}
                <td>
                  <div>{r.organizationName}</div>
                  <div className="table-sub">
                    ZID {r.zid}
                    {r.organizationCode ? ` · ${r.organizationCode}` : ""}
                  </div>
                </td>
                <td>
                  <div>{r.periodName}</div>
                  <div className="table-sub">EID {r.eid}</div>
                </td>
                <td>{packageKindLabel(r.packageKind)}</td>
                <td>
                  {r.filled}/{r.total} · сдано {r.submitted}
                  <div className="table-sub">{r.percent}%</div>
                </td>
                <td>
                  <ExchangeMarksCell row={r} showExported={showExportedMark} />
                </td>
                <td>
                  {r.bpStatus ? (
                    <StatusBadge
                      status={r.bpStatus}
                      label={bpStatusLabel(r.bpStatus)}
                    />
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={selectable ? 7 : 6}>Нет комплектов по фильтрам</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export interface PackageExportTabProps {
  onStatus?: (message: string) => void;
}

export function PackageExportTab({ onStatus }: PackageExportTabProps) {
  const list = useWorkspacePackageList();
  const [busy, setBusy] = useState(false);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    void list.reloadWorkspace().catch((e) => {
      onStatus?.(e instanceof Error ? e.message : "Не удалось загрузить список комплектов");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkedRows = useMemo(
    () => list.filteredRows.filter((r) => checkedKeys.has(rowKey(r))),
    [list.filteredRows, checkedKeys]
  );
  const singleSelected = checkedRows.length === 1 ? checkedRows[0]! : null;
  const allFilteredChecked =
    list.filteredRows.length > 0 &&
    list.filteredRows.every((r) => checkedKeys.has(rowKey(r)));

  const toggleChecked = (key: string, checked: boolean) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    if (allFilteredChecked) {
      setCheckedKeys((prev) => {
        const next = new Set(prev);
        for (const r of list.filteredRows) next.delete(rowKey(r));
        return next;
      });
      return;
    }
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      for (const r of list.filteredRows) next.add(rowKey(r));
      return next;
    });
  };

  const handleDownloadSelected = async () => {
    if (!checkedRows.length) {
      onStatus?.("Отметьте один или несколько комплектов для скачивания");
      return;
    }
    setBusy(true);
    try {
      const result = await exportReportPackagesBulk(
        checkedRows.map((r) => ({ zid: r.zid, eid: r.eid }))
      );
      downloadBlob(result.blob, result.filename);
      await list.reloadWorkspace().catch(() => undefined);
      onStatus?.(
        checkedRows.length === 1
          ? `Скачан комплект: ${checkedRows[0]!.organizationName} → ${result.filename}`
          : `Скачано комплектов: ${result.exported}` +
              (result.failed ? ` · ошибок ${result.failed}` : "") +
              ` → ${result.filename}`
      );
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : "Ошибка выгрузки");
    } finally {
      setBusy(false);
    }
  };

  const handleExcelSelected = async () => {
    if (!singleSelected) {
      onStatus?.("Для Excel отметьте ровно один комплект");
      return;
    }
    setBusy(true);
    try {
      const instances = await loadPackageInstances(singleSelected.zid, singleSelected.eid);
      if (!instances.length) {
        onStatus?.("В выбранном комплекте нет форм");
        return;
      }
      const schemas = new Map(
        await Promise.all(
          [...new Set(instances.map((i) => i.templateId))].map(
            async (id) => [id, await loadSchema(id)] as const
          )
        )
      );
      const { exportPackageToExcel } = await import("../../engine/exportExcel");
      await exportPackageToExcel(instances, schemas);
      onStatus?.(
        `Excel: ${singleSelected.organizationName} · ${instances.length} форм`
      );
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : "Ошибка Excel");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tools-section">
      <h2>Выгрузить комплекты</h2>
      <p>
        Отметьте один или несколько комплектов и скачайте ZIP — внутри отдельный файл на
        каждую организацию и <code>manifest.json</code>.
      </p>
      <p className="hint-text">
        Создание комплектов — в <Link to="/package">Комплектах</Link>. Обратная загрузка —
        переключатель «Загрузить» выше.
      </p>

      <WorkspaceFilters periodOptions={list.periodOptions} filters={list.filters} />

      <div
        className="toolbar-actions"
        style={{ marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}
      >
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={allFilteredChecked}
            disabled={list.workspaceLoading || list.filteredRows.length === 0}
            onChange={toggleSelectAllFiltered}
          />
          Выбрать все ({list.filteredRows.length})
        </label>
        <Button
          disabled={busy || checkedRows.length === 0}
          onClick={() => void handleDownloadSelected()}
        >
          {busy
            ? "Выгрузка…"
            : checkedRows.length <= 1
              ? `Скачать${checkedRows.length === 1 ? " комплект" : ""} (${checkedRows.length})`
              : `Скачать выбранные (${checkedRows.length})`}
        </Button>
        <Button
          variant="secondary"
          disabled={busy || !singleSelected}
          onClick={() => void handleExcelSelected()}
          title="Excel только для одного отмеченного комплекта"
        >
          Excel
        </Button>
        <Button
          variant="secondary"
          disabled={list.workspaceLoading || busy}
          onClick={() =>
            void list.reloadWorkspace().catch((e) => {
              onStatus?.(
                e instanceof Error ? e.message : "Не удалось обновить список"
              );
            })
          }
        >
          Обновить список
        </Button>
      </div>

      <WorkspacePackagesTable
        rows={list.filteredRows}
        loading={list.workspaceLoading}
        selectable
        checkedKeys={checkedKeys}
        busy={busy}
        onToggle={toggleChecked}
      />
    </section>
  );
}

type DropJob = {
  id: string;
  fileName: string;
  status: "queued" | "parsing" | "importing" | "done" | "error";
  detail?: string;
};

export interface PackageUploadTabProps {
  importOverwrite: boolean;
  onImportOverwriteChange: (value: boolean) => void;
  onStatus?: (message: string) => void;
  onImported?: () => void;
  inbox?: {
    backend: boolean;
    items: Array<{
      id: string;
      receivedAt: string;
      filename: string | null;
      status: string;
      organization: string | null;
      instanceCount: number;
      sha256: string;
      warnings: string[];
      validationErrors: string[];
    }>;
    onRefresh: () => void;
    onQuarantineFile: (file: File) => void;
    onPreview: (id: string) => void;
    onAccept: (id: string) => void;
    onReject: (id: string) => void;
  };
}

export function PackageUploadTab({
  importOverwrite,
  onImportOverwriteChange,
  onStatus,
  onImported,
  inbox,
}: PackageUploadTabProps) {
  const list = useWorkspacePackageList();
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [jobs, setJobs] = useState<DropJob[]>([]);
  const [bulkImportReport, setBulkImportReport] = useState<BulkImportPackageResult | null>(
    null
  );
  const [pendingPackage, setPendingPackage] = useState<ReportPackage | null>(null);
  const [pendingName, setPendingName] = useState("");
  const [pendingTarget, setPendingTarget] = useState<{ zid: number; eid: number } | null>(
    null
  );
  const [diffRows, setDiffRows] = useState<PackageDiffRow[]>([]);
  const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set());
  const [cellDiffs, setCellDiffs] = useState<PackageCellDiff[]>([]);
  const [showCellDiffs, setShowCellDiffs] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void list.reloadWorkspace().catch((e) => {
      onStatus?.(e instanceof Error ? e.message : "Не удалось загрузить список комплектов");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshList = async () => {
    try {
      await list.reloadWorkspace();
    } catch {
      /* ignore */
    }
  };

  const importedCount = useMemo(
    () => list.workspaceRows.filter((r) => r.lastImportedAt).length,
    [list.workspaceRows]
  );
  const pendingCount = list.workspaceRows.length - importedCount;

  const updateJob = useCallback((id: string, patch: Partial<DropJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const openSinglePreview = async (pkg: ReportPackage, name: string) => {
    const zid = pkg.zid != null ? Number(pkg.zid) : NaN;
    const eid = pkg.eid != null ? Number(pkg.eid) : NaN;
    if (!Number.isFinite(zid) || !Number.isFinite(eid)) {
      throw new Error(
        "В файле нет zid/eid — выгрузите комплект заново из портала или положите файл в очередь."
      );
    }
    const local = await loadPackageInstances(zid, eid);
    const rows = buildPackageDiff(pkg, local, { zid, eid });
    setPendingPackage(pkg);
    setPendingName(name);
    setPendingTarget({ zid, eid });
    setDiffRows(rows);
    setSelectedImportIds(
      new Set(
        rows
          .filter((r) => r.selectedDefault && r.verdict !== "only-local")
          .map((r) => r.templateId)
      )
    );
    setCellDiffs(buildPackageCellDiffs(pkg, local));
    setShowCellDiffs(false);
    setBulkImportReport(null);
    onStatus?.(
      `Сравнение: ${pkg.organization || name} → орг. ${zid}, период ${eid} · ` +
        `${rows.filter((r) => r.verdict === "changed").length} изменённых, ` +
        `${rows.filter((r) => r.verdict === "new").length} новых`
    );
  };

  const processFiles = async (rawFiles: FileList | File[]) => {
    const files = [...rawFiles].filter(isPackageFile);
    if (!files.length) {
      onStatus?.("Нужны файлы .json или .zip");
      return;
    }

    const newJobs: DropJob[] = files.map((f, i) => ({
      id: `${Date.now()}-${i}-${f.name}`,
      fileName: f.name,
      status: "queued",
    }));
    setJobs(newJobs);
    setBulkImportReport(null);
    setPendingPackage(null);
    setBusy(true);

    try {
      const packages: Array<{ name: string; package: ReportPackage; jobId: string }> = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const job = newJobs[i]!;
        updateJob(job.id, { status: "parsing", detail: "чтение…" });
        try {
          const fromFile = await readReportPackagesFromFile(file);
          if (!fromFile.length) {
            updateJob(job.id, { status: "error", detail: "в файле нет комплектов" });
            continue;
          }
          updateJob(job.id, {
            status: "queued",
            detail:
              fromFile.length === 1
                ? `1 комплект`
                : `${fromFile.length} комплектов в архиве`,
          });
          for (const entry of fromFile) {
            packages.push({ ...entry, jobId: job.id });
          }
        } catch (e) {
          updateJob(job.id, {
            status: "error",
            detail: e instanceof Error ? e.message : "ошибка чтения",
          });
        }
      }

      if (!packages.length) {
        onStatus?.("Не удалось разобрать ни одного комплекта");
        return;
      }

      // Один комплект — сравнение перед приёмом
      if (packages.length === 1) {
        const only = packages[0]!;
        updateJob(only.jobId, { status: "done", detail: "готово к сравнению" });
        await openSinglePreview(only.package, only.name);
        return;
      }

      // Куча файлов — сразу принимаем
      for (const job of newJobs) {
        if (job.status !== "error") {
          updateJob(job.id, { status: "importing", detail: "загрузка…" });
        }
      }

      const result = await importReportPackagesBulk(
        packages.map(({ name, package: pkg }) => ({ name, package: pkg })),
        { overwrite: importOverwrite }
      );
      setBulkImportReport(result);

      const byJob = new Map<string, { ok: number; fail: number; msgs: string[] }>();
      for (const pkg of packages) {
        if (!byJob.has(pkg.jobId)) byJob.set(pkg.jobId, { ok: 0, fail: 0, msgs: [] });
      }
      for (let i = 0; i < result.results.length; i++) {
        const r = result.results[i]!;
        const jobId = packages[i]?.jobId;
        if (!jobId) continue;
        const bucket = byJob.get(jobId)!;
        if (r.ok) bucket.ok += 1;
        else {
          bucket.fail += 1;
          if (r.error) bucket.msgs.push(r.error);
        }
      }
      for (const [jobId, bucket] of byJob) {
        if (bucket.fail && !bucket.ok) {
          updateJob(jobId, {
            status: "error",
            detail: bucket.msgs[0] ?? `ошибок ${bucket.fail}`,
          });
        } else if (bucket.fail) {
          updateJob(jobId, {
            status: "done",
            detail: `загружено ${bucket.ok}, ошибок ${bucket.fail}`,
          });
        } else {
          updateJob(jobId, {
            status: "done",
            detail: bucket.ok ? `загружено (${bucket.ok})` : "загружено",
          });
        }
      }

      await refreshList();
      onImported?.();
      onStatus?.(
        `Загружено комплектов: ${result.imported}` +
          (result.failed ? ` · ошибок ${result.failed}` : "") +
          ` · форм +${result.created}/≈${result.updated}`
      );
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setBusy(false);
    }
  };

  const handleAcceptPartial = async () => {
    if (!pendingPackage || !pendingTarget) return;
    const ids = [...selectedImportIds];
    if (!ids.length) {
      onStatus?.("Выберите хотя бы одну форму");
      return;
    }
    setBusy(true);
    try {
      const result = await importReportPackage(
        pendingTarget.zid,
        pendingTarget.eid,
        pendingPackage,
        importOverwrite,
        ids
      );
      setPendingPackage(null);
      setDiffRows([]);
      setSelectedImportIds(new Set());
      await refreshList();
      onImported?.();
      onStatus?.(
        `Принято: +${result.created} / ≈${result.updated}, пропуск ${result.skipped}` +
          (result.errors.length ? `. ${result.errors.slice(0, 2).join("; ")}` : "")
      );
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : "Ошибка импорта");
    } finally {
      setBusy(false);
    }
  };

  const handleAcceptAllPending = async () => {
    if (!pendingPackage || !pendingTarget) return;
    setBusy(true);
    try {
      const result = await importReportPackage(
        pendingTarget.zid,
        pendingTarget.eid,
        pendingPackage,
        importOverwrite
      );
      setPendingPackage(null);
      setDiffRows([]);
      setSelectedImportIds(new Set());
      await refreshList();
      onImported?.();
      onStatus?.(
        `Принят весь комплект: +${result.created} / ≈${result.updated}, пропуск ${result.skipped}`
      );
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : "Ошибка импорта");
    } finally {
      setBusy(false);
    }
  };

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    setDragOver(true);
  };

  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragOver(false);
    }
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragOver(false);
    if (busy) return;
    const files = e.dataTransfer.files;
    if (files?.length) void processFiles(files);
  };

  return (
    <>
      <section className="tools-section">
        <h2>Загрузить комплекты</h2>
        <p>
          Перетащите сюда один или много файлов <code>.json</code> / <code>.zip</code>.
          Система разберёт архивы и примет каждый комплект в организацию/период по{" "}
          <code>zid/eid</code> внутри файла. Один файл — сначала сравнение форм.
        </p>

        <label className="checkbox-inline" style={{ marginBottom: "0.75rem" }}>
          <input
            type="checkbox"
            checked={importOverwrite}
            onChange={(e) => onImportOverwriteChange(e.target.checked)}
            disabled={busy}
          />
          Перезаписывать уже существующие формы
        </label>

        <div
          className={`exchange-dropzone${dragOver ? " is-dragover" : ""}${busy ? " is-busy" : ""}`}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onClick={() => {
            if (!busy) fileInputRef.current?.click();
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!busy) fileInputRef.current?.click();
            }
          }}
          aria-label="Зона загрузки комплектов"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.zip,application/json,application/zip"
            multiple
            hidden
            disabled={busy}
            onChange={(e) => {
              const files = e.target.files;
              if (files?.length) void processFiles(files);
              e.target.value = "";
            }}
          />
          <div className="exchange-dropzone-title">
            {busy
              ? "Обработка файлов…"
              : dragOver
                ? "Отпустите файлы"
                : "Перетащите файлы сюда"}
          </div>
          <div className="exchange-dropzone-hint">
            или нажмите, чтобы выбрать · можно сразу много JSON и ZIP
          </div>
        </div>

        {jobs.length > 0 && (
          <div className="table-wrap" style={{ marginTop: "1rem" }}>
            <table className="form-table" style={{ minWidth: "28rem" }}>
              <thead>
                <tr>
                  <th>Файл</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <code>{j.fileName}</code>
                    </td>
                    <td>
                      {j.status === "queued" && (j.detail || "в очереди")}
                      {j.status === "parsing" && (j.detail || "разбор…")}
                      {j.status === "importing" && (j.detail || "загрузка…")}
                      {j.status === "done" && (
                        <StatusBadge
                          tone="imported"
                          label={
                            j.detail?.startsWith("готово к сравнению")
                              ? j.detail
                              : j.detail || "Загружено"
                          }
                        />
                      )}
                      {j.status === "error" && (
                        <StatusBadge tone="error" label={j.detail || "ошибка"} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="tools-section">
        <h2>
          Комплекты{" "}
          <span className="cat-count">
            загружено {importedCount} · ждут {pendingCount}
          </span>
        </h2>
        <p className="hint-text">
          Та же таблица, что при выгрузке: видно, какие комплекты уже приняты обратно.
        </p>

        <WorkspaceFilters
          periodOptions={list.periodOptions}
          filters={list.filters}
          showUploadMarkFilter
        />

        <div className="toolbar-actions section-actions">
          <Button
            variant="secondary"
            disabled={list.workspaceLoading || busy}
            onClick={() =>
              void list.reloadWorkspace().catch((e) => {
                onStatus?.(
                  e instanceof Error ? e.message : "Не удалось обновить список"
                );
              })
            }
          >
            Обновить список
          </Button>
        </div>

        <WorkspacePackagesTable
          rows={list.filteredRows}
          loading={list.workspaceLoading}
          highlightImported
          showExportedMark={false}
        />
      </section>

      {pendingPackage && pendingTarget && (
        <section className="tools-section">
          <h2>
            Сравнение перед приёмом
            <span className="cat-count">
              {pendingPackage.organization || pendingName} → орг. {pendingTarget.zid},
              период {pendingTarget.eid}
            </span>
          </h2>
          <div className="toolbar-actions section-actions">
            <Button
              variant="secondary"
              onClick={() =>
                setSelectedImportIds(
                  new Set(
                    diffRows
                      .filter(
                        (r) =>
                          r.verdict !== "only-local" &&
                          (r.verdict === "new" || r.verdict === "changed")
                      )
                      .map((r) => r.templateId)
                  )
                )
              }
            >
              Новые и изменённые
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                setSelectedImportIds(
                  new Set(
                    diffRows
                      .filter((r) => r.verdict !== "only-local")
                      .map((r) => r.templateId)
                  )
                )
              }
            >
              Все из файла
            </Button>
            <Button variant="secondary" onClick={() => setSelectedImportIds(new Set())}>
              Снять все
            </Button>
            <Button
              disabled={busy || selectedImportIds.size === 0}
              onClick={() => void handleAcceptPartial()}
            >
              Принять выбранные ({selectedImportIds.size})
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void handleAcceptAllPending()}
            >
              Принять весь комплект
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setPendingPackage(null);
                setDiffRows([]);
                setCellDiffs([]);
                setSelectedImportIds(new Set());
              }}
            >
              Отмена
            </Button>
          </div>
          <div className="table-wrap">
            <table className="form-table exchange-diff-table">
              <thead>
                <tr>
                  <th className="table-col-check" />
                  <th>Форма</th>
                  <th>Статус</th>
                  <th>В файле</th>
                  <th>Локально</th>
                </tr>
              </thead>
              <tbody>
                {diffRows.map((row) => {
                  const canSelect = row.verdict !== "only-local";
                  return (
                    <tr key={row.templateId}>
                      <td>
                        {canSelect ? (
                          <input
                            type="checkbox"
                            checked={selectedImportIds.has(row.templateId)}
                            onChange={() => {
                              setSelectedImportIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(row.templateId)) next.delete(row.templateId);
                                else next.add(row.templateId);
                                return next;
                              });
                            }}
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <code>{row.templateId}</code>
                        {row.title !== row.templateId ? (
                          <span className="hint-text"> — {row.title}</span>
                        ) : null}
                      </td>
                      <td>{verdictLabel(row.verdict)}</td>
                      <td>
                        {row.verdict === "only-local"
                          ? "—"
                          : `${row.pkgRows ?? 0} стр.${row.pkgStatus ? `, ${row.pkgStatus}` : ""}`}
                      </td>
                      <td>
                        {row.localRows != null
                          ? `${row.localRows} стр.${row.localStatus ? `, ${row.localStatus}` : ""}`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {cellDiffs.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowCellDiffs(!showCellDiffs)}
              >
                {showCellDiffs ? "Скрыть" : "Показать"} расхождения ячеек ({cellDiffs.length})
              </button>
              {showCellDiffs && (
                <div
                  className="table-wrap"
                  style={{ marginTop: "0.5rem", maxHeight: "16rem", overflow: "auto" }}
                >
                  <table className="form-table" style={{ minWidth: "32rem" }}>
                    <thead>
                      <tr>
                        <th>Форма</th>
                        <th>Строка</th>
                        <th>Графа</th>
                        <th>В файле</th>
                        <th>Локально</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedImportIds.size
                        ? cellDiffs.filter((d) => selectedImportIds.has(d.templateId))
                        : cellDiffs
                      )
                        .slice(0, 300)
                        .map((d, i) => (
                          <tr key={`${d.templateId}-${d.rowNum}-${d.column}-${i}`}>
                            <td>
                              <code>{d.templateId}</code>
                            </td>
                            <td>{d.rowNum}</td>
                            <td>{d.column}</td>
                            <td>{d.packageValue ?? "—"}</td>
                            <td>{d.localValue ?? "—"}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {bulkImportReport && (
        <section className="tools-section">
          <h2>
            Результат загрузки{" "}
            <span className="cat-count">
              {bulkImportReport.imported} загружено / {bulkImportReport.failed} ошибок
            </span>
          </h2>
          <div className="table-wrap">
            <table className="form-table" style={{ minWidth: "36rem" }}>
              <thead>
                <tr>
                  <th>Файл</th>
                  <th>Организация</th>
                  <th>ZID/EID</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {bulkImportReport.results.map((r, i) => (
                  <tr key={`${r.name}-${i}`}>
                    <td>
                      <code>{r.name}</code>
                    </td>
                    <td>{r.organization || "—"}</td>
                    <td>
                      {r.zid != null && r.eid != null ? `${r.zid} / ${r.eid}` : "—"}
                    </td>
                    <td>
                      {r.ok ? (
                        <StatusBadge
                          tone="imported"
                          label={`Загружено (+${r.created ?? 0} / ≈${r.updated ?? 0})`}
                        />
                      ) : (
                        <StatusBadge tone="error" label={r.error ?? "ошибка"} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {inbox?.backend && (
        <section className="tools-section">
          <h2>Очередь входящих</h2>
          <p className="hint-text">
            Запасной путь: сначала в очередь с проверкой, затем принять вручную. Обычно
            достаточно зоны выше.
          </p>
          <div className="toolbar-actions" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
              В очередь…
              <input
                type="file"
                accept=".json,.zip,application/json,application/zip"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) inbox.onQuarantineFile(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button type="button" className="btn btn-secondary" onClick={inbox.onRefresh}>
              Обновить список
            </button>
          </div>
          {inbox.items.length === 0 ? (
            <p className="hint-text">Очередь пуста.</p>
          ) : (
            <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
              <table className="form-table" style={{ minWidth: "36rem" }}>
                <thead>
                  <tr>
                    <th>Когда</th>
                    <th>Файл</th>
                    <th>Статус</th>
                    <th>Форм</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {inbox.items.map((item) => (
                    <tr key={item.id}>
                      <td>{new Date(item.receivedAt).toLocaleString("ru-RU")}</td>
                      <td>
                        <div>{item.filename || item.organization || "—"}</div>
                        <div className="table-sub">
                          <code>{item.sha256.slice(0, 12)}…</code>
                        </div>
                      </td>
                      <td>{item.status}</td>
                      <td>{item.instanceCount}</td>
                      <td>
                        {(item.status === "received" || item.status === "validated") && (
                          <div className="toolbar-actions" style={{ gap: "0.35rem" }}>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={busy}
                              onClick={() => inbox.onPreview(item.id)}
                            >
                              Превью
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={busy}
                              onClick={() => inbox.onAccept(item.id)}
                            >
                              Принять
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={busy}
                              onClick={() => inbox.onReject(item.id)}
                            >
                              Отклонить
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}

export interface ExchangeTabProps extends PackageUploadTabProps {
  mode: ExchangeMode;
  onModeChange: (mode: ExchangeMode) => void;
}

export function ExchangeTab({
  mode,
  onModeChange,
  ...uploadProps
}: ExchangeTabProps) {
  return (
    <>
      <div className="tools-subtabs" role="tablist" aria-label="Обмен комплектами">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "export"}
          className={mode === "export" ? "active" : undefined}
          onClick={() => onModeChange("export")}
        >
          Выгрузить
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "upload"}
          className={mode === "upload" ? "active" : undefined}
          onClick={() => onModeChange("upload")}
        >
          Загрузить
        </button>
      </div>
      {mode === "export" ? (
        <PackageExportTab onStatus={uploadProps.onStatus} />
      ) : (
        <PackageUploadTab {...uploadProps} />
      )}
    </>
  );
}


