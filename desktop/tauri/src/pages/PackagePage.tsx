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
  const [pendingAction, setPendingAction] = useState<"export" | "backup" | null>(null);

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

  const runWithPin = async (action: "export" | "backup", pin: string) => {
    setBusy(true);
    setError("");
    setExportMsg("");
    setWarnMsg("");
    try {
      if (action === "backup") {
        const r = await window.oko.backupDatabase({ pin, actor: userName });
        setExportMsg(`Резервная копия: ${r.filePath}`);
        return;
      }
      if (hasPin && confirm("Сделать резервную копию БД перед экспортом?")) {
        const r = await window.oko.backupDatabase({ pin, actor: userName });
        setExportMsg(`Бэкап: ${r.filePath}`);
      }
      const result = await window.oko.exportJson({ pin, actor: userName });
      setExportMsg((prev) =>
        prev ? `${prev}\nЭкспорт: ${result.filePath}` : `Сохранено: ${result.filePath}`
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

  const handleCoordinatorAction = (action: "export" | "backup") => {
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

  const rulesSync = session?.rulesSync;
  const rulesLabel = rulesSync?.fromPackage
    ? `Правила с ЦО: ${rulesSync.exportedAt ? new Date(rulesSync.exportedAt).toLocaleString("ru-RU") : "импортированы"}`
    : "Правила: встроенные в программу (импортируйте JSON с ЦО для актуальных)";

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
                Экспорт JSON для ЦО
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
              Задать PIN
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

      {visibleInstances.length === 0 ? (
        <p className="muted">
          {instances.length === 0
            ? "Комплект пуст. Нажмите «Завести пустые формы» или импортируйте JSON."
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
            ? "Резервная копия — PIN координатора"
            : pendingAction === "export"
              ? "Экспорт — PIN координатора"
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
