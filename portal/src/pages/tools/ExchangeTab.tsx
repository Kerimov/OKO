import { Link } from "react-router-dom";
import { verdictLabel, type PackageCellDiff, type PackageDiffRow } from "../../engine/packageDiff";
import { readReportPackageFile } from "../../engine/packageExport";

type PendingPackage = Awaited<ReturnType<typeof readReportPackageFile>>;

export interface ExchangeTabProps {
  work: {
    zid: number | null;
    eid: number | null;
    formCount: number;
  };
  exportZip: boolean;
  onExportZipChange: (value: boolean) => void;
  importOverwrite: boolean;
  onImportOverwriteChange: (value: boolean) => void;
  importing: boolean;
  busy: boolean;
  pending: {
    package: PendingPackage | null;
    diffRows: PackageDiffRow[];
    selectedIds: Set<string>;
    cellDiffs: PackageCellDiff[];
    showCellDiffs: boolean;
  };
  onShowCellDiffsChange: (value: boolean) => void;
  onPackageJson: () => void;
  onPackageExcel: () => void;
  onImportPreview: (file: File) => void;
  onAcceptPartial: () => void;
  onImportAll: () => void;
  onCancelPending: () => void;
  onSelectByVerdict: (predicate: (r: PackageDiffRow) => boolean) => void;
  onToggleImportId: (templateId: string) => void;
  onClearSelection: () => void;
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

export function ExchangeTab({
  work,
  exportZip,
  onExportZipChange,
  importOverwrite,
  onImportOverwriteChange,
  importing,
  busy,
  pending,
  onShowCellDiffsChange,
  onPackageJson,
  onPackageExcel,
  onImportPreview,
  onAcceptPartial,
  onImportAll,
  onCancelPending,
  onSelectByVerdict,
  onToggleImportId,
  onClearSelection,
  inbox,
}: ExchangeTabProps) {
  return (
    <section className="tools-section">
      <h2>Обмен комплектами</h2>
      <p>
        Выгрузите комплект форм на диск или примите комплект дочерней организации.
        Аналог Access «Сохранить на диск» / «Принять комплект». В файл дополнительно
        кладётся справочник правил — при импорте он <strong>не перезаписывает</strong>{" "}
        локальные правила, применяются только данные форм.
      </p>
      <p className="hint-text">
        Рабочий контекст: организация {work.zid ?? "—"}, период {work.eid ?? "—"}.
        Задаётся в разделе <Link to="/package">Комплект</Link>.
      </p>
      <div className="toolbar-actions" style={{ marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void onPackageJson()}
          disabled={work.formCount === 0}
        >
          Скачать комплект ({work.formCount})
          {exportZip ? " ZIP" : " JSON"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void onPackageExcel()}
          disabled={busy || work.formCount === 0}
        >
          Excel
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={importing}
          onClick={() => document.getElementById("import-package-file")?.click()}
        >
          {importing ? "Импорт…" : "Принять комплект…"}
        </button>
        <input
          id="import-package-file"
          type="file"
          accept=".json,.zip,application/json,application/zip"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onImportPreview(file);
            e.target.value = "";
          }}
        />
      </div>
      <label className="checkbox-inline">
        <input
          type="checkbox"
          checked={exportZip}
          onChange={(e) => onExportZipChange(e.target.checked)}
        />
        Экспорт в ZIP (JSON внутри; как архив Access)
      </label>
      <label className="checkbox-inline">
        <input
          type="checkbox"
          checked={importOverwrite}
          onChange={(e) => onImportOverwriteChange(e.target.checked)}
        />
        Перезаписать существующие формы комплекта (иначе — только новые шаблоны)
      </label>
      {pending.package && (
        <div className="package-partial-accept" style={{ marginTop: "1rem" }}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>
            Принять частично ({pending.package.organization || "комплект"},{" "}
            {pending.package.instances.length} форм в файле)
          </h3>
          <p className="hint-text" style={{ marginBottom: "0.5rem" }}>
            Сравнение с рабочим комплектом (орг. {work.zid}, период {work.eid}). Отметьте формы
            для принятия — аналог Access «Принять частично».
          </p>
          <div
            className="toolbar-actions"
            style={{ marginBottom: "0.5rem", flexWrap: "wrap", gap: "0.5rem" }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                onSelectByVerdict((r) => r.verdict === "new" || r.verdict === "changed")
              }
            >
              Новые и изменённые
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onSelectByVerdict(() => true)}
            >
              Все из файла
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClearSelection}
            >
              Снять все
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={importing || pending.selectedIds.size === 0}
              onClick={() => void onAcceptPartial()}
            >
              {importing ? "Принятие…" : `Принять выбранные (${pending.selectedIds.size})`}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={importing}
              onClick={() => void onImportAll()}
            >
              Принять весь комплект
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={importing}
              onClick={onCancelPending}
            >
              Отмена
            </button>
          </div>
          <div className="table-wrap">
            <table className="form-table" style={{ minWidth: "36rem" }}>
              <thead>
                <tr>
                  <th style={{ width: "2.5rem" }} />
                  <th>Форма</th>
                  <th>Статус</th>
                  <th>В файле</th>
                  <th>Локально</th>
                </tr>
              </thead>
              <tbody>
                {pending.diffRows.map((row) => {
                  const canSelect = row.verdict !== "only-local";
                  return (
                    <tr key={row.templateId}>
                      <td>
                        {canSelect ? (
                          <input
                            type="checkbox"
                            checked={pending.selectedIds.has(row.templateId)}
                            onChange={() => onToggleImportId(row.templateId)}
                            aria-label={`Принять ${row.templateId}`}
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
          {pending.cellDiffs.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onShowCellDiffsChange(!pending.showCellDiffs)}
              >
                {pending.showCellDiffs ? "Скрыть" : "Показать"} сравнение ячеек (frmCompare,{" "}
                {pending.cellDiffs.length})
              </button>
              {pending.showCellDiffs && (
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
                      {(pending.selectedIds.size
                        ? pending.cellDiffs.filter((d) => pending.selectedIds.has(d.templateId))
                        : pending.cellDiffs
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
        </div>
      )}
      {work.formCount === 0 && work.zid != null && work.eid != null && (
        <p className="hint-text" style={{ marginTop: "0.75rem" }}>
          Формы для организации {work.zid}, периода {work.eid} не найдены. В разделе{" "}
          <Link to="/package">Комплект</Link> выберите эту организацию и период, затем
          нажмите «Завести пустые формы».
        </p>
      )}

      {inbox?.backend && (
        <div style={{ marginTop: "1.5rem" }}>
          <h3>Inbox (карантин)</h3>
          <p className="hint-text">
            Загрузка в quarantine с SHA-256, проверкой ZID/EID и последующим accept в
            текущий комплект. Только admin.
          </p>
          <div className="toolbar-actions" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
              В inbox…
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
                        {(item.warnings.length > 0 || item.validationErrors.length > 0) && (
                          <div className="table-sub">
                            {[...item.validationErrors, ...item.warnings].slice(0, 2).join("; ")}
                          </div>
                        )}
                      </td>
                      <td>{item.status}</td>
                      <td>{item.instanceCount}</td>
                      <td>
                        {(item.status === "received" || item.status === "validated") && (
                          <div className="toolbar-actions" style={{ gap: "0.35rem" }}>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={busy || work.zid == null || work.eid == null}
                              onClick={() => inbox.onPreview(item.id)}
                            >
                              Превью
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={busy || importing || work.zid == null || work.eid == null}
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
        </div>
      )}
    </section>
  );
}
