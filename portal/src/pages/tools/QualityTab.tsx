import { CheckResultsPanel } from "../../components/CheckResultsPanel";
import type { CheckMode, CheckRunResult } from "../../engine/checkEngine";
import type { RecalcPackageItem } from "../../engine/recalcEngine";

export interface QualityTabProps {
  work: {
    zid: number | null;
    eid: number | null;
    formCount: number;
  };
  busy: boolean;
  checking: boolean;
  checkMode: CheckMode;
  onCheckModeChange: (mode: CheckMode) => void;
  ruleCounts: {
    period: number;
    active: number;
    all: number;
    aggrExcluded: number;
  } | null;
  checkResult: CheckRunResult | null;
  recalcReport: RecalcPackageItem[] | null;
  onRecalcAll: () => void;
  onCheckAll: () => void;
}

export function QualityTab({
  work,
  busy,
  checking,
  checkMode,
  onCheckModeChange,
  ruleCounts,
  checkResult,
  recalcReport,
  onRecalcAll,
  onCheckAll,
}: QualityTabProps) {
  const recalcFailed = recalcReport?.filter((i) => !i.ok) ?? [];
  const recalcChanged = recalcReport?.filter((i) => i.ok && i.changed) ?? [];

  return (
    <>
      <section className="tools-section">
        <h2>Пересчёт форм</h2>
        <p>
          Сначала все формы пересчитываются в памяти. Если хотя бы одна форма упала —
          ничего не сохраняется. Успешный пакет пишется атомарно (одна транзакция на
          сервере). Перед массовым пересчётом полезно выгрузить комплект на вкладке
          «Обмен».
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void onRecalcAll()}
          disabled={busy || work.formCount === 0}
        >
          {busy ? "Пересчёт…" : `Пересчитать все (${work.formCount})`}
        </button>
        {recalcReport && (
          <div style={{ marginTop: "0.75rem" }}>
            <p className="tools-hint">
              Отчёт: {recalcReport.length} форм, изменилось {recalcChanged.length}
              {recalcFailed.length > 0 ? `, ошибок ${recalcFailed.length}` : ""}
            </p>
            {recalcFailed.length > 0 && (
              <ul className="hint-text">
                {recalcFailed.slice(0, 10).map((item) => (
                  <li key={item.instanceId}>
                    <code>{item.templateId}</code> — {item.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="tools-section">
        <h2>Проверка форм</h2>
        <p className="tools-hint">
          Увязки считаются по формам текущего комплекта
          {work.zid != null && work.eid != null
            ? ` (орг. ${work.zid}, период ${work.eid})`
            : " (если ZID/EID не заданы — по датам периода, последняя форма каждого шаблона)"}
          .
        </p>
        <div className="tools-grid">
          <label>
            Режим
            <select
              value={checkMode}
              onChange={(e) => onCheckModeChange(e.target.value as CheckMode)}
            >
              <option value="period">
                За период ({ruleCounts?.period ?? "…"})
              </option>
              <option value="active">
                Активные ({ruleCounts?.active ?? "…"})
              </option>
              <option value="all">
                Все правила ({ruleCounts?.all ?? "…"}, без агрегации
                {ruleCounts ? ` −${ruleCounts.aggrExcluded}` : ""})
              </option>
            </select>
          </label>
        </div>
        {ruleCounts && (
          <p className="tools-hint">
            Исключено правил только для агрегации: {ruleCounts.aggrExcluded}. Всего правил в
            справочнике: 3600.
          </p>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void onCheckAll()}
          disabled={checking || work.formCount === 0}
        >
          {checking ? "Проверка…" : "Проверить формы комплекта"}
        </button>
        <CheckResultsPanel result={checkResult} loading={checking} />
      </section>
    </>
  );
}
