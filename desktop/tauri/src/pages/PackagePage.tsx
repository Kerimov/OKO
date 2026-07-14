import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { loadCatalog } from "@portal/api";
import type { InstanceSummary, PackageCompleteness } from "@portal/types";
import { categoryLabel, formStatusLabel } from "@portal/utils";
import { usePackage } from "../context/PackageContext";
import { useCoordinator } from "../context/CoordinatorContext";
import {
  CoordinatorPinModal,
  SetCoordinatorPinModal,
} from "../components/CoordinatorPinModal";
import {
  transferSaldoFromPackageText,
  type SaldoPhase,
} from "../saldoTransfer";

export function PackagePage() {
  const { session, refreshSession, userName } = usePackage();
  const { isCoordinator, hasPin, login, logoutPin, setPin } = useCoordinator();
  const location = useLocation();
  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [completeness, setCompleteness] = useState<PackageCompleteness | null>(null);
  const [assignments, setAssignments] = useState<Record<string, { assignee: string }>>({});
  const [editors, setEditors] = useState<Record<string, string[]>>({});
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [exportMsg, setExportMsg] = useState("");
  const [warnMsg, setWarnMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [myFormsOnly, setMyFormsOnly] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [setPinModalOpen, setSetPinModalOpen] = useState(false);
  const [saldoPhase, setSaldoPhase] = useState<SaldoPhase>("previous_period");
  const [saldoSourceLabel, setSaldoSourceLabel] = useState("");
  const [saldoDryRun, setSaldoDryRun] = useState(false);
  const [backups, setBackups] = useState<
    Array<{ name: string; path: string; sizeBytes: number; modifiedAt?: string | null }>
  >([]);
  const [selectedBackup, setSelectedBackup] = useState("");
  const [pendingAction, setPendingAction] = useState<
    "export" | "backup" | "restore" | "compact" | null
  >(null);

  const restrictAssignments = session?.restrictExecutorsToAssignments ?? false;

  const reload = useCallback(() => {
    if (!window.oko) return;
    void window.oko.listInstances().then(setInstances).catch((e) => {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    });
    void window.oko.getCompleteness().then(setCompleteness).catch(() => setCompleteness(null));
    void window.oko.getAssignments().then((a) => {
      const map: Record<string, { assignee: string }> = {};
      for (const item of a.items) map[item.templateId] = { assignee: item.assignee };
      setAssignments(map);
    });
    void window.oko.listPackageEditors().then(setEditors).catch(() => setEditors({}));
    void window.oko
      .listBackups()
      .then((list) => {
        setBackups(list);
        setSelectedBackup((prev) => prev || list[0]?.name || "");
      })
      .catch(() => setBackups([]));
  }, []);

  useEffect(() => {
    void loadCatalog()
      .then((c) => setCategories(c.categories))
      .catch(() => setCategories({}));
  }, []);

  useEffect(() => {
    reload();
    void refreshSession();
  }, [session?.folderPath, location.pathname, reload, refreshSession]);

  useEffect(() => {
    const notice = sessionStorage.getItem("oko.dailyBackupNotice");
    if (notice) {
      sessionStorage.removeItem("oko.dailyBackupNotice");
      setExportMsg(`Ежедневная резервная копия: ${notice}`);
    }
  }, [session?.folderPath]);

  const visibleInstances = useMemo(() => {
    let list = instances;
    if ((myFormsOnly || (restrictAssignments && !isCoordinator)) && userName) {
      list = list.filter((inst) => {
        const assignee = assignments[inst.templateId]?.assignee;
        if (!assignee) return !restrictAssignments || isCoordinator;
        return assignee.toLowerCase() === userName.toLowerCase();
      });
    }
    return list;
  }, [instances, myFormsOnly, restrictAssignments, isCoordinator, userName, assignments]);

  const grouped = useMemo(() => {
    const map = new Map<string, InstanceSummary[]>();
    for (const inst of visibleInstances) {
      const cat = inst.templateId.split("_")[0] ?? "Прочее";
      const list = map.get(cat) ?? [];
      list.push(inst);
      map.set(cat, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visibleInstances]);

  const runWithPin = async (
    action: "export" | "backup" | "restore" | "compact",
    pin: string
  ) => {
    setBusy(true);
    setError("");
    setExportMsg("");
    setWarnMsg("");
    try {
      if (action === "backup") {
        const r = await window.oko.backupDatabase({ pin, actor: userName });
        setExportMsg(`Резервная копия: ${r.filePath}`);
        reload();
        return;
      }
      if (action === "restore") {
        if (!selectedBackup) {
          setError("Выберите файл резервной копии");
          return;
        }
        if (
          !confirm(
            `Восстановить комплект из «${selectedBackup}»?\nТекущая БД будет сохранена как oko_pre_restore_*.db`
          )
        ) {
          return;
        }
        const r = await window.oko.restoreDatabase({
          backupName: selectedBackup,
          pin,
          actor: userName,
        });
        setExportMsg(r.message);
        reload();
        await refreshSession();
        return;
      }
      if (action === "compact") {
        const r = await window.oko.compactDatabase({ pin, actor: userName });
        const mb = (n: number) => (n / (1024 * 1024)).toFixed(2);
        setExportMsg(
          `Сжатие БД (VACUUM): ${mb(r.beforeBytes)} → ${mb(r.afterBytes)} МБ`
        );
        return;
      }
      if (hasPin && confirm("Сделать резервную копию БД перед экспортом?")) {
        const r = await window.oko.backupDatabase({ pin, actor: userName });
        setExportMsg(`Бэкап: ${r.filePath}`);
      }
      const result = await window.oko.exportJson({ pin, actor: userName });
      setExportMsg((prev) =>
        prev
          ? `${prev}\nЭкспорт (ZIP+JSON): ${result.filePath}`
          : `Сохранено: ${result.filePath}`
      );
      if (result.warnings?.length) {
        setWarnMsg(result.warnings.join("\n"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  };

  const handleCoordinatorAction = (action: "export" | "backup" | "restore" | "compact") => {
    if (!hasPin) {
      void runWithPin(action, "");
      return;
    }
    setPendingAction(action);
    setPinOpen(true);
  };

  const handleSeed = async () => {
    setBusy(true);
    setError("");
    try {
      await window.oko.seedPackage();
      reload();
      await refreshSession();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  const handleSaldoTransfer = async () => {
    if (!window.oko) return;
    const path = await window.oko.pickJsonFile();
    if (!path) return;
    setBusy(true);
    setError("");
    setExportMsg("");
    try {
      const text = await window.oko.readTextFile(path);
      const result = await transferSaldoFromPackageText(text, saldoPhase, {
        dryRun: saldoDryRun,
      });
      setSaldoSourceLabel(path.split(/[/\\]/).pop() ?? path);
      reload();
      const errPart =
        result.errors.length > 0
          ? ` Ошибки: ${result.errors.slice(0, 3).join("; ")}`
          : "";
      if (saldoDryRun && result.compare) {
        setExportMsg(
          `Сверка сальдо (${saldoPhase === "previous_period" ? "начало периода" : "аналог. год"}): форм ${result.compare.formsCompared}, с расхождениями ${result.compare.formsWithDiffs}, ячеек ${result.compare.totalDiffs}. Данные не изменены.${errPart}`
        );
      } else {
        setExportMsg(
          `Сальдо (${saldoPhase === "previous_period" ? "начало периода" : "аналог. период прошлого года"}): обновлено ${result.updated}, без источника ${result.skippedNoSource}, без данных/правил ${result.skippedEmpty}.${errPart}`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка переноса сальдо");
    } finally {
      setBusy(false);
    }
  };

  const rulesSync = session?.rulesSync;
  const rulesFresh =
    rulesSync?.fromPackage && (rulesSync.hasChecks || rulesSync.hasRash);
  const rulesAgeHours =
    rulesSync?.exportedAt != null
      ? Math.max(
          0,
          (Date.now() - new Date(rulesSync.exportedAt).getTime()) / 3_600_000
        )
      : null;
  const rulesLabel = rulesSync?.fromPackage
    ? `Правила с ЦО${rulesSync.version ? ` (${rulesSync.version})` : ""}: ${
        rulesSync.exportedAt
          ? new Date(rulesSync.exportedAt).toLocaleString("ru-RU")
          : "импортированы"
      }${
        rulesAgeHours != null && rulesAgeHours > 24 * 30
          ? " · устарели (>30 дн.)"
          : rulesFresh
            ? " · актуальны для комплекта"
            : ""
      }`
    : "Правила: встроенные в программу (импортируйте комплект с ЦО для актуальных)";

  return (
    <div className="content">
      <div className="toolbar">
        <div className="stats">
          {completeness ? (
            <>
              <span>
                Полнота: <strong>{completeness.filled}/{completeness.total}</strong>
              </span>
              <span>
                Черновики: <strong>{completeness.draft}</strong> · Сдано:{" "}
                <strong>{completeness.submitted}</strong>
              </span>
            </>
          ) : (
            <span>
              Форм: <strong>{instances.length}</strong>
            </span>
          )}
          <span className="muted rules-hint">{rulesLabel}</span>
        </div>
        <div className="toolbar-actions">
          <label className="filter-toggle">
            <input
              type="checkbox"
              checked={myFormsOnly}
              onChange={(e) => setMyFormsOnly(e.target.checked)}
            />
            Мои формы
          </label>
          <button type="button" disabled={busy} onClick={() => void handleSeed()}>
            Завести пустые формы
          </button>
          {isCoordinator && (
            <>
              <button type="button" disabled={busy} onClick={() => handleCoordinatorAction("backup")}>
                Резервная копия
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || instances.length === 0}
                onClick={() => handleCoordinatorAction("export")}
              >
                Экспорт комплекта для ЦО
              </button>
            </>
          )}
          {!isCoordinator && hasPin && (
            <button type="button" onClick={() => setPinOpen(true)}>
              Координатор
            </button>
          )}
          {!hasPin && (
            <button type="button" onClick={() => setSetPinModalOpen(true)}>
              Задать ПИН
            </button>
          )}
          {isCoordinator && hasPin && (
            <button type="button" className="btn-link" onClick={logoutPin}>
              Выйти (коорд.)
            </button>
          )}
        </div>
      </div>

      {completeness && (
        <div className="completeness-bar" title="Доля заведённых форм из каталога">
          <div
            className="completeness-fill"
            style={{ width: `${(completeness.filled / completeness.total) * 100}%` }}
          />
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {exportMsg && <p className="success">{exportMsg}</p>}
      {warnMsg && <p className="warn-block">{warnMsg}</p>}

      {(isCoordinator || !hasPin) && instances.length > 0 && (
        <section className="package-saldo-panel">
          <h2>Перенос сальдо</h2>
          <p className="muted">
            Из JSON/ZIP комплекта прошлого периода (или аналог. периода прошлого года) — по правилам
            соответствия форм (графы Yellow / Red). Сданные формы не меняются. Правила переноса —
            <Link to="/saldo-rules"> просмотр на десктопе</Link>
            {" "}(редактирование — портал `/admin/saldo`).
          </p>
          <div className="toolbar-actions" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            <label className="filter-toggle">
              <input
                type="radio"
                name="saldo-phase"
                checked={saldoPhase === "previous_period"}
                onChange={() => setSaldoPhase("previous_period")}
              />
              На начало периода
            </label>
            <label className="filter-toggle">
              <input
                type="radio"
                name="saldo-phase"
                checked={saldoPhase === "analog_period"}
                onChange={() => setSaldoPhase("analog_period")}
              />
              Аналог. период прошлого года
            </label>
            <label className="filter-toggle">
              <input
                type="checkbox"
                checked={saldoDryRun}
                onChange={(e) => setSaldoDryRun(e.target.checked)}
              />
              Только проверить
            </label>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void handleSaldoTransfer()}
            >
              {saldoDryRun ? "Выбрать JSON и сверить" : "Выбрать JSON и перенести"}
            </button>
          </div>
          {saldoSourceLabel && (
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              Источник: {saldoSourceLabel}
            </p>
          )}
        </section>
      )}

      {isCoordinator && (
        <section className="package-saldo-panel">
          <h2>Резервные копии и сжатие</h2>
          <p className="muted">
            Восстановление из <code>backups/</code> (как Access из daily backup). Перед заменой
            текущая БД сохраняется как <code>oko_pre_restore_*.db</code>. Сжатие — SQLite VACUUM.
          </p>
          <div className="toolbar-actions" style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            <select
              value={selectedBackup}
              onChange={(e) => setSelectedBackup(e.target.value)}
              style={{ minWidth: "14rem", maxWidth: "24rem" }}
              disabled={backups.length === 0}
            >
              {backups.length === 0 ? (
                <option value="">Нет копий</option>
              ) : (
                backups.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                    {b.sizeBytes ? ` (${Math.round(b.sizeBytes / 1024)} КБ)` : ""}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              disabled={busy || !selectedBackup}
              onClick={() => handleCoordinatorAction("restore")}
            >
              Восстановить
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleCoordinatorAction("compact")}
            >
              Сжать БД
            </button>
            <button type="button" disabled={busy} onClick={() => reload()}>
              Обновить список
            </button>
          </div>
        </section>
      )}

      {visibleInstances.length === 0 ? (
        <p className="muted">
          {instances.length === 0
            ? "Комплект пуст. Нажмите «Завести пустые формы» или импортируйте комплект."
            : "Нет форм по выбранному фильтру."}
        </p>
      ) : (
        <div className="form-groups">
          {grouped.map(([cat, items]) => (
            <section key={cat} className="form-group">
              <h2>{categoryLabel(categories, cat)}</h2>
              <ul className="instance-list">
                {items.map((inst) => {
                  const who = editors[inst.instanceId] ?? [];
                  const assignee = assignments[inst.templateId]?.assignee;
                  return (
                    <li key={inst.instanceId}>
                      <Link to={`/form/${inst.instanceId}`} className="instance-card">
                        <span className="instance-id">{inst.templateId}</span>
                        <span className="instance-title">{inst.templateTitle}</span>
                        {assignee && (
                          <span className="instance-assignee" title="Исполнитель">
                            {assignee}
                          </span>
                        )}
                        {who.length > 0 && (
                          <span className="instance-editors" title="Сейчас в форме">
                            {who.join(", ")}
                          </span>
                        )}
                        <span className={`badge status-${inst.status ?? "draft"}`}>
                          {formStatusLabel(inst.status)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <CoordinatorPinModal
        open={pinOpen}
        title={
          pendingAction === "backup"
            ? "Резервная копия — ПИН координатора"
            : pendingAction === "restore"
              ? "Восстановление — ПИН координатора"
              : pendingAction === "compact"
                ? "Сжатие БД — ПИН координатора"
                : pendingAction === "export"
                  ? "Экспорт — ПИН координатора"
                  : "Вход координатора"
        }
        requirePin={hasPin}
        onClose={() => {
          setPinOpen(false);
          setPendingAction(null);
        }}
        onSubmit={async (pin) => {
          if (pendingAction) {
            await runWithPin(pendingAction, pin);
            return true;
          }
          return login(pin);
        }}
      />

      <SetCoordinatorPinModal
        open={setPinModalOpen}
        hasExistingPin={hasPin}
        onClose={() => setSetPinModalOpen(false)}
        onSave={setPin}
      />
    </div>
  );
}
