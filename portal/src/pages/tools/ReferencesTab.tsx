import { Link } from "react-router-dom";
import type { MethodologyChecksums, MethodologyRelease } from "../../engine/packageRules";
import {
  KZS_GROUP,
  NZS_GROUP,
  type LoansNzsPackage,
} from "../../engine/refsPackage";
import type { KontrAgent } from "../../types";
import { loansTableRows } from "./loansTable";

export interface ReferencesTabProps {
  loans: {
    pkg: LoansNzsPackage | null;
    mergeMode: "merge" | "replace";
    onMergeModeChange: (mode: "merge" | "replace") => void;
  };
  n99: {
    rows: KontrAgent[];
    allAgents: KontrAgent[];
    renameId: number | "";
    renameTo: string;
    onRenameIdChange: (id: number | "") => void;
    onRenameToChange: (name: string) => void;
  };
  backend: boolean;
  busy: boolean;
  onExportLoans: () => void;
  onImportLoans: (file: File) => void;
  onN99Csv: () => void;
  onRefreshN99: () => void;
  onRenameN99: () => void;
  methodology?: {
    version: string | null;
    activatedAt: string | null;
    checksums?: MethodologyChecksums | null;
    history?: MethodologyRelease[];
    onSnapshot: () => void;
    onDryRun?: () => void;
    onRollback?: (id: string) => void;
  };
}

export function ReferencesTab({
  loans,
  n99,
  backend,
  busy,
  onExportLoans,
  onImportLoans,
  onN99Csv,
  onRefreshN99,
  onRenameN99,
  methodology,
}: ReferencesTabProps) {
  return (
    <>
      {methodology && backend && (
        <section className="tools-section">
          <h2>Методология</h2>
          <p className="hint-text">
            Активный релиз (checksums правил из <code>portal/public/data</code>). Версия
            уходит в комплект при экспорте правил.
          </p>
          <p>
            Версия: <strong>{methodology.version ?? "не активирована"}</strong>
            {methodology.activatedAt
              ? ` · ${new Date(methodology.activatedAt).toLocaleString("ru-RU")}`
              : ""}
          </p>
          {methodology.checksums && Object.keys(methodology.checksums).length > 0 && (
            <p className="hint-text">
              Checksums:{" "}
              {Object.entries(methodology.checksums)
                .filter(([, v]) => v)
                .map(([k, v]) => `${k}=${String(v).slice(0, 8)}…`)
                .join(" · ") || "—"}
            </p>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={methodology.onSnapshot}
          >
            Снапшот и активировать
          </button>
          {methodology.onDryRun && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={methodology.onDryRun}
              style={{ marginLeft: "0.5rem" }}
            >
              Dry-run checksums
            </button>
          )}
          {methodology.history && methodology.history.length > 0 && (
            <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
              <table className="form-table" style={{ minWidth: "28rem" }}>
                <thead>
                  <tr>
                    <th>Версия</th>
                    <th>Активирован</th>
                    <th>Источник</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {methodology.history.map((row) => (
                    <tr key={row.id || row.version + (row.activatedAt ?? "")}>
                      <td>
                        <code>{row.version}</code>
                        {row.active || row.version === methodology.version
                          ? " · активна"
                          : ""}
                      </td>
                      <td>
                        {row.activatedAt
                          ? new Date(row.activatedAt).toLocaleString("ru-RU")
                          : "—"}
                      </td>
                      <td>{row.source || "—"}</td>
                      <td>
                        {row.id &&
                          methodology.onRollback &&
                          row.version !== methodology.version && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={busy}
                              onClick={() => methodology.onRollback?.(row.id!)}
                            >
                              Откатить
                            </button>
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
      <section className="tools-section">
        <h2>Справочники займов / НЗС</h2>
        <p>
          Аналог Access «Администрирование → Принять-Сохранить справочники»: головная
          выгружает каталоги «{KZS_GROUP}» и «{NZS_GROUP}», филиалы пополняют свой
          справочник.
        </p>
        <p className="hint-text">
          Сейчас: {KZS_GROUP} — {loans.pkg?.groups?.[KZS_GROUP]?.length ?? "…"}; {NZS_GROUP} —{" "}
          {loans.pkg?.groups?.[NZS_GROUP]?.length ?? "…"}.
        </p>
        <div
          className="toolbar-actions"
          style={{ marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}
        >
          <button type="button" className="btn btn-primary" onClick={() => void onExportLoans()}>
            Выгрузить справочники
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => document.getElementById("import-loans-nzs-file")?.click()}
          >
            Принять справочники…
          </button>
          <input
            id="import-loans-nzs-file"
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImportLoans(file);
              e.target.value = "";
            }}
          />
        </div>
        <label className="checkbox-inline">
          <input
            type="radio"
            name="loans-merge"
            checked={loans.mergeMode === "merge"}
            onChange={() => loans.onMergeModeChange("merge")}
          />
          Слияние по newkod (пополнить)
        </label>{" "}
        <label className="checkbox-inline">
          <input
            type="radio"
            name="loans-merge"
            checked={loans.mergeMode === "replace"}
            onChange={() => loans.onMergeModeChange("replace")}
          />
          Заменить группы целиком
        </label>
        {loans.pkg && (
          <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
            <table className="form-table" style={{ minWidth: "28rem" }}>
              <thead>
                <tr>
                  <th>Группа</th>
                  <th>Код</th>
                  <th>Наименование</th>
                  <th>newkod</th>
                  <th>Кредитор / период</th>
                </tr>
              </thead>
              <tbody>
                {loansTableRows(loans.pkg).map((row) => (
                  <tr key={`${row.group}-${row.newkod || row.kod}-${row.value}`}>
                    <td>{row.groupShort}</td>
                    <td>
                      <code>{row.kod || "—"}</code>
                    </td>
                    <td>{row.value}</td>
                    <td>
                      <code>{row.newkod || "—"}</code>
                    </td>
                    <td className="hint-text">
                      {[row.creditor, row.dateStart, row.dateFinish].filter(Boolean).join(" · ") ||
                        "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="tools-section">
        <h2>N99 — изменения контрагентов</h2>
        <p>
          Список добавленных/изменённых данных в справочнике (Access форма N99). Поле
          «Другое наименование» (`oldName`) — прежнее имя при переименовании. Редактор
          справочника: <Link to="/admin/kontr">/admin/kontr</Link>. Если изменений нет —
          лист в головную не направляют.
        </p>
        <div
          className="toolbar-actions"
          style={{ marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}
        >
          <button
            type="button"
            className="btn btn-primary"
            onClick={onN99Csv}
            disabled={n99.rows.length === 0}
          >
            Скачать N99 CSV ({n99.rows.length})
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onRefreshN99}
          >
            Обновить список
          </button>
        </div>
        {backend && (
          <div className="toolbar-actions" style={{ marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <select
              value={n99.renameId === "" ? "" : String(n99.renameId)}
              onChange={(e) =>
                n99.onRenameIdChange(e.target.value ? Number(e.target.value) : "")
              }
            >
              <option value="">— контрагент для переименования —</option>
              {n99.allAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  #{a.id} {a.name}
                </option>
              ))}
            </select>
            <input
              value={n99.renameTo}
              onChange={(e) => n99.onRenameToChange(e.target.value)}
              placeholder="Новое наименование"
              style={{ minWidth: "14rem" }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={n99.renameId === "" || !n99.renameTo.trim()}
              onClick={onRenameN99}
            >
              Переименовать → oldName
            </button>
          </div>
        )}
        {n99.rows.length === 0 ? (
          <p className="hint-text">
            Изменений нет — CSV не формируется. Для полного списка и GUID —{" "}
            <Link to="/admin/kontr">админка контрагентов</Link>.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="form-table" style={{ minWidth: "32rem" }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Наименование</th>
                  <th>Другое наименование</th>
                  <th>ИНН</th>
                  <th>Тип</th>
                </tr>
              </thead>
              <tbody>
                {n99.rows.map((a) => (
                  <tr key={a.id}>
                    <td>{a.id}</td>
                    <td>{a.name}</td>
                    <td>{a.oldName}</td>
                    <td>{a.inn || "—"}</td>
                    <td>{a.orgType ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
