import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckResultsPanel } from "@portal/components/CheckResultsPanel";
import { FormTable } from "@portal/components/FormTable";
import { isKontrForm } from "@portal/constants";
import { type CheckRunResult } from "@portal/engine/checkRunCore";
import { failedCellsForForm } from "@portal/engine/cellErrors";
import { exportFormToExcel } from "@portal/engine/exportExcel";
import type { RashValidationIssue } from "@portal/engine/rashEngine";
import {
  exportInstance,
  saveGlobalMeta,
  saveInstance,
  setInstanceStatus,
  setDesktopActor,
} from "../desktopStorage";
import type {
  FormInstanceStatus,
  FormMeta,
  FormSchema,
  KontrAgent,
  OkoFormInstance,
  RowData,
} from "@portal/types";
import { buildInitialRows, formatPeriod, formStatusLabel } from "@portal/utils";
import { usePackage } from "../context/PackageContext";
import { useSyncStatus } from "../context/SyncContext";
import { useCollaborativeForm } from "../hooks/useCollaborativeForm";
import { useCoordinator } from "../context/CoordinatorContext";
import { CoordinatorPinModal } from "../components/CoordinatorPinModal";
import {
  getCachedForm,
  patchCachedInstance,
  setCachedForm,
} from "../formLoadCache";

export function FormPage() {
  const { instanceId } = useParams<{ instanceId: string }>();
  const { userName } = usePackage();
  const { isCoordinator, hasPin } = useCoordinator();
  const [unlockPinOpen, setUnlockPinOpen] = useState(false);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [instance, setInstance] = useState<OkoFormInstance | null>(null);
  const [rows, setRows] = useState<RowData[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [meta, setMeta] = useState<FormMeta>({
    organization: "",
    enterpriseCode: "1@1",
    periodStart: "",
    periodEnd: "",
    unit: "тыс.руб.",
  });
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [kontrAgents, setKontrAgents] = useState<KontrAgent[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [exportingExcel, setExportingExcel] = useState(false);
  const [recalcing, setRecalcing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckRunResult | null>(null);
  const [rashIssues, setRashIssues] = useState<RashValidationIssue[] | null>(null);
  const [rashRuleCount, setRashRuleCount] = useState<number | null>(null);
  const [checkingRash, setCheckingRash] = useState(false);
  const [autoRecalc, setAutoRecalc] = useState(
    () => localStorage.getItem("oko-auto-recalc") !== "0"
  );
  const [recalcRuleCount, setRecalcRuleCount] = useState<number | null>(null);
  const recalcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadGenRef = useRef(0);
  const [formLoading, setFormLoading] = useState(true);

  const kontrMode = schema ? isKontrForm(schema.id) : false;
  const instanceStatus: FormInstanceStatus = instance?.status ?? "draft";
  const isLocked = instanceStatus === "submitted";

  const { setSync } = useSyncStatus();
  const collab = useCollaborativeForm({
    instanceId,
    userName,
    rows,
    setRows,
    disabled: isLocked,
  });

  useEffect(() => {
    setSync(collab.syncStatus, collab.lockMessage || collab.conflictMessage);
  }, [collab.syncStatus, collab.lockMessage, collab.conflictMessage, setSync]);

  const handleForceUnlockForm = async (pin: string) => {
    if (!instance) return false;
    const n = await window.oko.forceUnlock({
      instanceId: instance.instanceId,
      actor: userName,
      pin: pin || undefined,
    });
    setStatus(n > 0 ? `Снято блокировок: ${n}` : "Активных блокировок нет");
    setTimeout(() => setStatus(""), 4000);
    return true;
  };

  useEffect(() => {
    setDesktopActor(userName);
  }, [userName]);

  useEffect(() => {
    if (!instanceId) return;
    const gen = ++loadGenRef.current;
    const loadStartedAt = Date.now();
    const loadResolvedRef = { current: false };
    const hadCacheRef = { current: false };
    setError("");
    setCheckResult(null);
    setRashIssues(null);

    const cached = getCachedForm(instanceId);
    if (cached?.instance && cached.schema) {
      hadCacheRef.current = true;
      setInstance(cached.instance);
      setSchema(cached.schema);
      setDisplayName(cached.instance.displayName ?? "");
      setMeta(cached.instance.meta);
      setRows(cached.instance.rows);
      setSignatures(cached.instance.signatures ?? {});
      setFormLoading(false);
    } else {
      setFormLoading(true);
    }

    void (async () => {
      try {
        const inst = await window.oko.loadInstance(instanceId);
        if (loadGenRef.current !== gen) return;
        if (!inst) throw new Error("Форма не найдена");
        const sch = await window.oko.loadSchema(inst.templateId);
        if (loadGenRef.current !== gen) return;
        setInstance(inst);
        setDisplayName(inst.displayName ?? "");
        setMeta(inst.meta);
        setRows(inst.rows);
        setSignatures(inst.signatures ?? {});
        setSchema(sch);
        setCachedForm(instanceId, inst, sch);
      } catch (e) {
        if (loadGenRef.current !== gen) return;
        const msg = e instanceof Error ? e.message : "Ошибка загрузки формы";
        if (msg.includes("не открыт")) {
          setError("Комплект не открыт. Вернитесь на главную и откройте папку комплекта.");
        } else if (msg.includes("не найдена")) {
          setError(
            "Форма не найдена в базе. Вернитесь к комплекту и откройте форму заново (после импорта список обновляется)."
          );
        } else {
          setError(msg);
        }
      } finally {
        if (loadGenRef.current === gen) {
          loadResolvedRef.current = true;
          setFormLoading(false);
          const ms = Date.now() - loadStartedAt;
          void window.oko
            .log("info", `Form load done in ${ms}ms (id=${instanceId})`)
            .catch(() => {});
        }
      }
    })();

    const t = setTimeout(() => {
      if (loadGenRef.current !== gen || loadResolvedRef.current) return;
      setFormLoading(false);
      if (hadCacheRef.current) {
        void window.oko
          .log(
            "warn",
            `Form refresh slow (>15s), showing cached data (id=${instanceId})`
          )
          .catch(() => {});
        return;
      }
      setError(
        "Загрузка формы зависла. Обычно причина — блокировка сетевой папки/антивирус или ошибка IPC. Проверьте файл .oko/logs/renderer.log в папке комплекта и пришлите последние строки."
      );
    }, 15000);

    return () => {
      clearTimeout(t);
    };
  }, [instanceId]);

  useEffect(() => {
    if (!schema) return;
    void window.oko
      .getFormRuleCounts(schema.id)
      .then(({ rashRuleCount: rash, recalcRuleCount: recalc }) => {
        setRashRuleCount(kontrMode ? rash : null);
        setRecalcRuleCount(recalc);
      })
      .catch(() => {
        setRashRuleCount(null);
        setRecalcRuleCount(null);
      });
  }, [kontrMode, schema]);

  useEffect(() => {
    if (!kontrMode || !schema) return;
    void window.oko
      .getKontrAgents()
      .then(setKontrAgents)
      .catch(() => setKontrAgents([]));
  }, [kontrMode, schema]);

  const handleRowsChange = useCallback(
    (next: RowData[]) => {
      setRows(next);
      if (!autoRecalc || !schema || !(recalcRuleCount && recalcRuleCount > 0)) return;
      if (recalcTimer.current) clearTimeout(recalcTimer.current);
      recalcTimer.current = setTimeout(() => {
        void window.oko.recalcForm(schema.id, next).then(setRows);
      }, 450);
    },
    [autoRecalc, schema, recalcRuleCount]
  );

  useEffect(() => {
    return () => {
      if (recalcTimer.current) clearTimeout(recalcTimer.current);
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, []);

  const cellErrors = useMemo(() => {
    if (!schema) return undefined;
    return failedCellsForForm(schema.id, checkResult);
  }, [schema, checkResult]);

  const persist = useCallback(
    async (
      overrides?: Partial<Pick<OkoFormInstance, "displayName" | "rows" | "meta" | "signatures">>
    ) => {
      if (!instance || !schema) return null;
      const updated: OkoFormInstance = {
        ...instance,
        displayName: overrides?.displayName ?? displayName,
        meta: overrides?.meta ?? meta,
        rows: overrides?.rows ?? rows,
        signatures: overrides?.signatures ?? signatures,
        updatedAt: new Date().toISOString(),
      };
      const saved = await saveInstance(updated);
      await saveGlobalMeta(updated.meta);
      setInstance(saved);
      if (instanceId) patchCachedInstance(instanceId, saved);
      return saved;
    },
    [instance, schema, displayName, meta, rows, signatures, instanceId]
  );

  const schedulePersist = useCallback(
    (overrides?: Partial<Pick<OkoFormInstance, "displayName" | "rows" | "meta" | "signatures">>) => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        void persist(overrides);
      }, 500);
    },
    [persist]
  );

  const flushPersist = useCallback(async () => {
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    return persist();
  }, [persist]);

  const handleSave = useCallback(async () => {
    if (!instance || isLocked) return;
    await flushPersist();
    setStatus("Сохранено " + new Date().toLocaleTimeString("ru-RU"));
    setTimeout(() => setStatus(""), 3000);
  }, [instance, isLocked, flushPersist]);

  const handleSubmitForm = async () => {
    if (!instance || instanceStatus === "submitted") return;
    if (
      !confirm(
        "Отметить форму готовой? После этого редактирование будет недоступно (координатор может вернуть в черновик)."
      )
    ) {
      return;
    }
    await flushPersist();
    const updated = await setInstanceStatus(instance.instanceId, "submitted");
    setInstance(updated);
    setStatus("Форма отмечена готовой");
  };

  const handleReopenForm = async () => {
    if (!instance) return;
    if (!confirm("Вернуть форму в черновик?")) return;
    const updated = await setInstanceStatus(instance.instanceId, "draft");
    setInstance(updated);
    setStatus("Форма возвращена в черновик");
  };

  const handleReset = async () => {
    if (!schema || !instance) return;
    if (!confirm("Сбросить все введённые данные к шаблону?")) return;
    const fresh = buildInitialRows(schema);
    const sigs: Record<string, string> = {};
    for (const name of schema.signatures) sigs[name] = "";
    setRows(fresh);
    setSignatures(sigs);
    await persist({ rows: fresh, signatures: sigs });
    setCheckResult(null);
    setRashIssues(null);
    setStatus("Данные сброшены к шаблону");
  };

  const handleExport = () => {
    if (!instance) return;
    exportInstance({
      ...instance,
      displayName,
      meta,
      rows,
      signatures,
    });
  };

  const handleRecalc = async () => {
    if (!schema) return;
    setRecalcing(true);
    try {
      await flushPersist();
      const next = await window.oko.recalcForm(schema.id, rows);
      setRows(next);
      await persist({ rows: next });
      setStatus("Строки пересчитаны");
      setTimeout(() => setStatus(""), 3000);
    } catch {
      setError("Ошибка пересчёта");
    } finally {
      setRecalcing(false);
    }
  };

  const handleExportExcel = async () => {
    if (!schema || !instance) return;
    setExportingExcel(true);
    try {
      await flushPersist();
      await exportFormToExcel({
        schema,
        displayName,
        meta,
        rows,
        saveAs: async (fileName, data) => {
          let binary = "";
          for (let i = 0; i < data.length; i++) {
            binary += String.fromCharCode(data[i]);
          }
          await window.oko.saveExcelFile(fileName, btoa(binary));
        },
      });
      setStatus("Excel сохранён");
      setTimeout(() => setStatus(""), 3000);
    } catch {
      setError("Не удалось сформировать Excel");
    } finally {
      setExportingExcel(false);
    }
  };

  const handleCheckRash = async () => {
    if (!schema || !kontrMode) return;
    setCheckingRash(true);
    setRashIssues(null);
    try {
      const issues = await window.oko.runRashChecks(schema.id, rows);
      setRashIssues(issues);
      setStatus(
        issues.length === 0
          ? "Расшифровки: замечаний нет"
          : `Расшифровки: ${issues.filter((i) => i.severity === "error").length} ошибок, ${issues.filter((i) => i.severity === "warning").length} предупреждений`
      );
      setTimeout(() => setStatus(""), 5000);
    } catch {
      setError("Не удалось проверить расшифровки");
    } finally {
      setCheckingRash(false);
    }
  };

  const handleCheck = async () => {
    if (!schema || !instance) return;
    setChecking(true);
    setCheckResult(null);
    setError("");
    await new Promise<void>((r) => setTimeout(r, 0));
    try {
      await flushPersist();
      const result = await window.oko.runFormChecks(schema.id, {
        instanceId: instance.instanceId,
        rows,
      });
      setCheckResult(result);
      setStatus(
        result.failed === 0 ? "Проверка пройдена" : `Ошибок увязок: ${result.failed}`
      );
      setTimeout(() => setStatus(""), 5000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось выполнить проверку";
      setError(msg);
    } finally {
      setChecking(false);
    }
  };

  if (error && !schema && !instance) {
    return (
      <div className="content form-page">
        <p className="error">{error}</p>
        <Link to="/package">← К комплекту</Link>
      </div>
    );
  }

  if (!schema || !instance) {
    if (formLoading || !error) {
      return <div className="content muted loading">Загрузка формы…</div>;
    }
    return (
      <div className="content form-page">
        <p className="error">{error}</p>
        <Link to="/package">← К комплекту</Link>
      </div>
    );
  }

  return (
    <div className="content form-page">
      <div className="form-toolbar">
        <div className="form-title-block form-title-block-wide">
          <label className="display-name-label">
            Название формы
            <input
              className="display-name-input"
              value={displayName}
              disabled={isLocked}
              onChange={(e) => setDisplayName(e.target.value)}
              onBlur={() => schedulePersist({ displayName })}
            />
          </label>
          <div className="form-subtitle">
            <span className="form-code">{schema.id}</span>
            <span>{schema.title}</span>
            <span className={`status-badge ${instanceStatus}`}>
              {formStatusLabel(instanceStatus)}
            </span>
          </div>
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleRecalc()}
            disabled={recalcing || isLocked}
            title={
              recalcRuleCount != null ? `Правил пересчёта: ${recalcRuleCount}` : undefined
            }
          >
            {recalcing ? "…" : "Пересчёт"}
          </button>
          {(recalcRuleCount ?? 0) > 0 && (
            <label className="auto-recalc-toggle" title="Пересчёт итоговых строк и граф">
              <input
                type="checkbox"
                checked={autoRecalc}
                disabled={isLocked}
                onChange={(e) => {
                  const on = e.target.checked;
                  setAutoRecalc(on);
                  localStorage.setItem("oko-auto-recalc", on ? "1" : "0");
                }}
              />
              Автопересчёт
            </label>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleExportExcel()}
            disabled={exportingExcel}
          >
            {exportingExcel ? "Excel…" : "Excel"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleCheck()}
            disabled={checking}
          >
            {checking ? "Проверка…" : "Проверить увязки"}
          </button>
          {kontrMode && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleCheckRash()}
              disabled={checkingRash}
              title={
                rashRuleCount != null
                  ? `Правил sp_rash для ${schema.id}: ${rashRuleCount}`
                  : undefined
              }
            >
              {checkingRash ? "Расшифровка…" : "Проверить расшифровки"}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={handleExport}>
            Экспорт JSON
          </button>
          {isCoordinator && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setUnlockPinOpen(true)}
              title="Снять зависшие блокировки ячеек на этой форме"
            >
              Снять блокировки
            </button>
          )}
          {!isLocked && (
            <button type="button" className="btn btn-secondary" onClick={() => void handleReset()}>
              Сбросить данные
            </button>
          )}
          {instanceStatus === "draft" && !isLocked && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleSubmitForm()}
            >
              Отметить готовой
            </button>
          )}
          {instanceStatus === "submitted" && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleReopenForm()}
            >
              Вернуть в черновик
            </button>
          )}
          {!isLocked && (
            <button type="button" className="btn btn-primary" onClick={() => void handleSave()}>
              Сохранить
            </button>
          )}
        </div>
      </div>

      {status && <div className="status-bar">{status}</div>}
      {error && <p className="error">{error}</p>}
      {collab.lockMessage && <p className="error">{collab.lockMessage}</p>}
      {collab.conflictMessage && <p className="warn-block">{collab.conflictMessage}</p>}
      {isLocked && (
        <div className="status-bar status-locked">
          Форма отмечена готовой и доступна только для просмотра. Координатор может вернуть её в
          черновик.
        </div>
      )}

      <CheckResultsPanel result={checkResult} loading={checking} />

      {kontrMode && rashRuleCount != null && rashRuleCount > 0 && (
        <p className="tools-hint">
          Форма с расшифровкой контрагентов: правил <code>sp_rash</code> —{" "}
          <strong>{rashRuleCount}</strong>. Пороги: 1 тыс. / 5 млн / 50 млн руб.
        </p>
      )}

      {rashIssues && rashIssues.length > 0 && (
        <section className="rash-results">
          <div className="rash-summary">
            <span className="rash-stat fail">
              Ошибок: {rashIssues.filter((i) => i.severity === "error").length}
            </span>
            <span className="rash-stat warn">
              Предупреждений: {rashIssues.filter((i) => i.severity === "warning").length}
            </span>
          </div>
          <ul className="rash-issues-list">
            {rashIssues.map((issue, idx) => (
              <li key={idx} className={issue.severity === "error" ? "rash-error" : "rash-warn"}>
                Строка {issue.rowIndex + 1} ({issue.rowLabel}), гр. {issue.column}: {issue.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="form-meta-panel">
        <div className="meta-grid">
          <label>
            Код предприятия
            <input
              value={meta.enterpriseCode}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, enterpriseCode: e.target.value })}
              onBlur={() => schedulePersist({ meta })}
            />
          </label>
          <label className="meta-wide">
            Организация
            <input
              value={meta.organization}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, organization: e.target.value })}
              onBlur={() => schedulePersist({ meta })}
              placeholder="Наименование организации"
            />
          </label>
          <label>
            Начало периода
            <input
              type="date"
              value={meta.periodStart}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, periodStart: e.target.value })}
              onBlur={() => schedulePersist({ meta })}
            />
          </label>
          <label>
            Конец периода
            <input
              type="date"
              value={meta.periodEnd}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, periodEnd: e.target.value })}
              onBlur={() => schedulePersist({ meta })}
            />
          </label>
          <label>
            Ед. изм.
            <input
              value={meta.unit}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, unit: e.target.value })}
              onBlur={() => schedulePersist({ meta })}
            />
          </label>
        </div>
        <p className="period-hint">
          Отчётный период: {formatPeriod(meta.periodStart, meta.periodEnd)} · {meta.unit}
        </p>
      </section>

      <FormTable
        columns={schema.columns}
        rows={rows}
        onChange={handleRowsChange}
        allowAddRows={schema.allowAddRows || kontrMode}
        kontrMode={kontrMode}
        kontrAgents={kontrAgents}
        cellErrors={cellErrors}
        readOnly={isLocked}
        occupiedCells={collab.occupiedCells}
        presenceUsers={collab.presenceUsers}
        highlightedCells={collab.highlightedCells}
        onCellFocus={(info) => void collab.handleCellFocus(info)}
        onCellBlur={(info) => void collab.handleCellBlur(info)}
        onCellEdit={(info) => collab.handleCellEdit(info)}
      />

      <CoordinatorPinModal
        open={unlockPinOpen}
        title="Снять блокировки на форме"
        requirePin={hasPin}
        onClose={() => setUnlockPinOpen(false)}
        onSubmit={handleForceUnlockForm}
      />

      {schema.signatures.length > 0 && (
        <section className="signatures">
          <h3>Подписи</h3>
          <div className="sig-grid">
            {schema.signatures.map((name) => (
              <label key={name}>
                {name}
                <input
                  value={signatures[name] ?? ""}
                  disabled={isLocked}
                  onChange={(e) => setSignatures((s) => ({ ...s, [name]: e.target.value }))}
                  onBlur={() => schedulePersist({ signatures })}
                  placeholder="ФИО"
                />
              </label>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
