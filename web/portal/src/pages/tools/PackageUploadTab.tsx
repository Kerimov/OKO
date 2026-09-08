import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
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
import {
  importReportPackage,
  importReportPackagesBulk,
  type BulkImportPackageResult,
} from "../../packagesApi";
import { packageKindLabel } from "../../uiLabels";
import { Button, StatusBadge } from "../../components/ui";
import { isPackageFile, loadPackageInstances } from "./ExchangeShared";
import type { WorkspaceListApi } from "./useWorkspacePackageList";
import {
  ExchangePeriodSidebar,
  WorkspaceFilters,
  WorkspacePackagesTable,
} from "./ExchangeWorkspaceUi";

type DropJob = {
  id: string;
  fileName: string;
  status: "queued" | "parsing" | "importing" | "done" | "error";
  detail?: string;
};

export interface PackageUploadTabProps {
  list: WorkspaceListApi;
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
  list,
  importOverwrite,
  onImportOverwriteChange,
  onStatus,
  onImported,
  inbox,
}: PackageUploadTabProps) {
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

  const refreshList = async () => {
    try {
      await list.reloadWorkspace();
    } catch {
      /* ignore */
    }
  };

  const importedCount = useMemo(
    () =>
      list.filteredRows.filter((r) => r.lastImportedAt).length,
    [list.filteredRows]
  );
  const pendingCount = list.filteredRows.length - importedCount;

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
          Комплекты кампании{" "}
          <span className="cat-count">
            загружено {importedCount} · ждут {pendingCount}
          </span>
        </h2>
        <p className="hint-text">
          Выберите кампанию слева — видно, какие комплекты уже приняты обратно.
        </p>
        {list.workspaceError ? (
          <p className="error-box">{list.workspaceError}</p>
        ) : null}

        <div className="package-workspace-layout exchange-layout">
          <ExchangePeriodSidebar
            campaigns={list.campaigns}
            selectedKey={list.selectedCampaignKey}
            loading={list.workspaceLoading}
            onSelect={list.setSelectedCampaignKey}
          />
          <div className="exchange-period-detail">
            {list.selectedCampaign ? (
              <header className="exchange-campaign-head">
                <h3>
                  {list.selectedCampaign.periodName} ·{" "}
                  {packageKindLabel(list.selectedCampaign.packageKind)}
                </h3>
              </header>
            ) : null}
            <WorkspaceFilters filters={list.filters} showUploadMarkFilter />
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
                Обновить
              </Button>
            </div>
            <WorkspacePackagesTable
              rows={list.filteredRows}
              loading={list.workspaceLoading}
              campaign={list.selectedCampaign}
              highlightImported
              showExportedMark={false}
            />
          </div>
        </div>
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
