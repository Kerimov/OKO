import { Link } from "react-router-dom";
import {
  type AggCorrSet,
  type AggrAccountValidationResult,
  type AggregationColorMode,
  type AggregationPreview,
  type AggListEntry,
  type FillBalanceApiResult,
  type RelationsAccRowsApiResult,
} from "../../aggregationApi";
import { CampaignAggregationFlow } from "../../components/CampaignAggregationFlow";
import { CheckResultsPanel } from "../../components/CheckResultsPanel";
import type { CheckRunResult } from "../../engine/checkEngine";

export interface AggregationTabProps {
  backend: boolean;
  busy: boolean;
  selection: {
    parentZid: number | "";
    eid: number | "";
    targetZid: number | "";
    parents: Array<{ zid: number; name: string; code?: string | null }>;
    periods: Array<{ eid: number; name: string }>;
    corrSets: AggCorrSet[];
    childEntries: AggListEntry[];
    selectedChildren: number[];
  };
  options: {
    colorMode: AggregationColorMode;
    requireAll: boolean;
    recalc: boolean;
    reorg: boolean;
    updateCorr: boolean;
    fillBalanceMode: "ifEmpty" | "overwrite";
    includeDraftSources: boolean;
    overwriteSubmitted: boolean;
  };
  results: {
    preview: AggregationPreview | null;
    aggrChecks: CheckRunResult | null;
    reorgChecks: CheckRunResult | null;
    accountRows: AggrAccountValidationResult | null;
    relations: RelationsAccRowsApiResult | null;
    fillBalance: FillBalanceApiResult | null;
  };
  onParentChange: (zid: number) => void;
  onEidChange: (eid: number) => void;
  onTargetZidChange: (zid: number | "") => void;
  onToggleChild: (childZid: number) => void;
  onSelectAllChildren: () => void;
  onSelectIncludedChildren: () => void;
  onClearChildren: () => void;
  onColorModeChange: (mode: AggregationColorMode) => void;
  onRequireAllChange: (value: boolean) => void;
  onRecalcChange: (value: boolean) => void;
  onReorgChange: (value: boolean) => void;
  onUpdateCorrChange: (value: boolean) => void;
  onFillBalanceModeChange: (mode: "ifEmpty" | "overwrite") => void;
  onIncludeDraftSourcesChange: (value: boolean) => void;
  onOverwriteSubmittedChange: (value: boolean) => void;
  onCreateCorrSet: (kind: "correct" | "mirror") => void;
  onPreview: () => void;
  onAggregate: () => void;
  onCheckRelations: () => void;
  onFillBalance: () => void;
  onClearPreview: () => void;
  onSyncWithWorkContext?: () => void;
  workContext?: { zid: number | null; eid: number | null };
}

function skippedReasonLabel(reason: AggregationPreview["forms"][number]["skippedReason"]): string {
  if (reason === "no-color-spec") return "нет маски цвета";
  if (reason === "reorg-update-blocked") return "нет разрешения на обновление";
  if (reason === "no-existing-corr") return "нет корр. набора";
  if (reason === "draft-only-sources") return "только черновики";
  if (reason === "target-submitted") return "цель уже сдана";
  return "нет данных";
}

export function AggregationTab({
  backend,
  busy,
  selection,
  options,
  results,
  onParentChange,
  onEidChange,
  onTargetZidChange,
  onToggleChild,
  onSelectAllChildren,
  onSelectIncludedChildren,
  onClearChildren,
  onColorModeChange,
  onRequireAllChange,
  onRecalcChange,
  onReorgChange,
  onUpdateCorrChange,
  onFillBalanceModeChange,
  onIncludeDraftSourcesChange,
  onOverwriteSubmittedChange,
  onCreateCorrSet,
  onPreview,
  onAggregate,
  onCheckRelations,
  onFillBalance,
  onClearPreview,
  onSyncWithWorkContext,
  workContext,
}: AggregationTabProps) {
  const { parentZid, eid, targetZid, parents, periods, corrSets, childEntries, selectedChildren } =
    selection;
  const {
    colorMode,
    requireAll,
    recalc,
    reorg,
    updateCorr,
    fillBalanceMode,
    includeDraftSources,
    overwriteSubmitted,
  } = options;
  const {
    preview,
    aggrChecks,
    reorgChecks,
    accountRows,
    relations,
    fillBalance,
  } = results;

  const contextMismatch =
    workContext &&
    parentZid !== "" &&
    eid !== "" &&
    (workContext.zid !== parentZid || workContext.eid !== eid);
  const selectedSet = new Set(selectedChildren);
  const previewByChild = new Map<
    number,
    { present: number; missing: number; draftOnly: number }
  >();
  if (preview) {
    for (const childZid of preview.children) {
      previewByChild.set(childZid, { present: 0, missing: 0, draftOnly: 0 });
    }
    for (const form of preview.forms) {
      for (const childZid of form.presentChildZids) {
        const stat = previewByChild.get(childZid);
        if (stat) stat.present += 1;
      }
      for (const childZid of form.missingChildZids) {
        const stat = previewByChild.get(childZid);
        if (stat) stat.missing += 1;
      }
      for (const childZid of form.draftChildZids ?? []) {
        const stat = previewByChild.get(childZid);
        if (stat) stat.draftOnly += 1;
      }
    }
  }
  const emptyPreview =
    preview != null &&
    preview.children.length > 0 &&
    preview.forms.every((form) => form.presentChildZids.length === 0);

  return (
    <section className="tools-section">
      <CampaignAggregationFlow current="svod" />
      <h2>Мастер свода кампании</h2>
      <p className="tools-hint">
        Сценарий: выбрать кампанию, проверить участников, указать цель и выполнить свод.
        Правила parent → child настраиваются в{" "}
        <Link to="/admin/aggregation">правилах агрегации</Link>. По умолчанию в свод
        входят только <strong>сданные</strong> формы участников.
      </p>
      {contextMismatch && (
        <p className="warn-bar">
          Свод: орг. {parentZid}, период {eid} — отличается от рабочего комплекта (орг.{" "}
          {workContext.zid ?? "—"}, период {workContext.eid ?? "—"}).
          {onSyncWithWorkContext && (
            <>
              {" "}
              <button type="button" className="btn btn-secondary" onClick={onSyncWithWorkContext}>
                Синхронизировать с комплектом
              </button>
            </>
          )}
        </p>
      )}
      {backend ? (
        <>
          <div className="aggregation-steps">
          <div className="aggregation-step">
            <h3>1. Кампания и сводная организация</h3>
            <p className="tools-hint">
              Выберите сводную организацию и её период. Если вы пришли из рабочего
              комплекта, используйте синхронизацию выше.
            </p>
          <div className="tools-grid">
            <label>
              Сводная организация
              <select
                value={parentZid}
                onChange={(e) => void onParentChange(Number(e.target.value))}
              >
                <option value="">— выберите —</option>
                {parents.map((p) => (
                  <option key={p.zid} value={p.zid}>
                    {p.name}
                    {p.code ? ` (${p.code})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Период
              <select
                value={eid}
                disabled={parentZid === ""}
                onChange={(e) => {
                  onEidChange(Number(e.target.value));
                  onClearPreview();
                }}
              >
                <option value="">— выберите —</option>
                {periods.map((p) => (
                  <option key={p.eid} value={p.eid}>
                    {p.name} (код {p.eid})
                  </option>
                ))}
              </select>
            </label>
          </div>
          </div>

          <div className="aggregation-step">
            <h3>2. Участники свода</h3>
            {childEntries.length > 0 ? (
            <div>
              <p className="tools-hint">
                Галочка задаёт участников текущего прогона. По умолчанию выбраны связи,
                где в правилах агрегации стоит «включено» (
                {childEntries.filter((e) => e.included).length}).
              </p>
              <ul className="aggr-list">
                {childEntries.map((e) => {
                  const stat = previewByChild.get(e.childZid);
                  return (
                  <li key={e.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedSet.has(e.childZid)}
                        onChange={() => onToggleChild(e.childZid)}
                      />
                      <span>
                        {e.childName ?? `Организация ${e.childZid}`}
                        {e.childCode ? ` (${e.childCode})` : ""}
                        {!e.included ? " — по умолчанию выкл." : ""}
                        {stat ? (
                          <span className="table-sub">
                            {" "}
                            · найдено {stat.present}, нет {stat.missing}
                            {stat.draftOnly ? `, только черновики ${stat.draftOnly}` : ""}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                  );
                })}
              </ul>
              <div className="toolbar-actions" style={{ gap: "0.5rem", marginBottom: "0.5rem" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onSelectAllChildren}
                >
                  Все
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onSelectIncludedChildren}
                >
                  Только включённые
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onClearChildren}
                >
                  Снять все
                </button>
              </div>
            </div>
            ) : (
              <p className="tools-hint">
                Для выбранной сводной организации нет участников. Добавьте связи в{" "}
                <Link to="/admin/aggregation">правилах агрегации</Link>.
              </p>
            )}
          </div>

          <div className="aggregation-step">
            <h3>3. Цель и режим</h3>
            <p className="tools-hint">
              Обычный свод пишет результат в сводную организацию. Для реорганизации или
              масочных обновлений выберите корректирующий набор или зеркало.
            </p>
          <div className="tools-grid" style={{ marginTop: "0.5rem" }}>
            <label>
              Куда писать свод
              <select
                value={targetZid === "" ? parentZid || "" : targetZid}
                disabled={parentZid === ""}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onTargetZidChange(parentZid !== "" && v === parentZid ? "" : v);
                  onClearPreview();
                }}
                title="Целевой комплект / корректирующий набор"
              >
                <option value={parentZid === "" ? "" : parentZid}>
                  Сводная организация (как есть)
                </option>
                {corrSets.map((s) => (
                  <option key={s.id} value={s.corrZid}>
                    {s.kind === "mirror" ? "Зеркало" : "Корр."}:{" "}
                    {s.corrName ?? `ZID ${s.corrZid}`}
                    {s.corrCode ? ` (${s.corrCode})` : ""} · форм {s.formCount ?? 0}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Режим свода
              <select
                value={colorMode}
                onChange={(e) => onColorModeChange(e.target.value as AggregationColorMode)}
                title="Полный свод или маска по соответствию форм"
              >
                <option value="full">Обычный свод (все ячейки)</option>
                <option value="green">Корректировка — зелёная маска</option>
                <option value="yellow">Корректировка — жёлтая маска</option>
                <option value="red">Корректировка — красная маска</option>
                <option value="blue">Корректировка — синяя маска</option>
              </select>
            </label>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={requireAll}
                onChange={(e) => onRequireAllChange(e.target.checked)}
              />
              Строгий режим: форма только если есть у всех участников
            </label>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={recalc}
                onChange={(e) => onRecalcChange(e.target.checked)}
              />
              Пересчитать итоги после свода
            </label>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={includeDraftSources}
                onChange={(e) => onIncludeDraftSourcesChange(e.target.checked)}
              />
              Включать черновики участников
            </label>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={overwriteSubmitted}
                onChange={(e) => onOverwriteSubmittedChange(e.target.checked)}
              />
              Перезаписывать уже сданные целевые формы
            </label>
            <label className="checkbox-inline" title="Создание корректирующего набора">
              <input
                type="checkbox"
                checked={reorg}
                disabled={colorMode === "full" || updateCorr}
                onChange={(e) => onReorgChange(e.target.checked)}
              />
              Режим реорганизации (только формы с разрешённым обновлением)
            </label>
            <label className="checkbox-inline" title="Обновить маску, сохранив остальные ячейки">
              <input
                type="checkbox"
                checked={updateCorr}
                disabled={colorMode === "full"}
                onChange={(e) => onUpdateCorrChange(e.target.checked)}
              />
              Обновить корректирующий набор
            </label>
          </div>
          {parentZid !== "" && eid !== "" && (
            <div className="toolbar-actions" style={{ marginTop: "0.5rem", gap: "0.5rem" }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void onCreateCorrSet("correct")}
                title="Пустой корректирующий набор"
              >
                Создать корр. набор
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void onCreateCorrSet("mirror")}
                title="Копия форм сводной"
              >
                Создать зеркало
              </button>
            </div>
          )}
          </div>

          <div className="aggregation-step">
            <h3>4. Превью и запуск</h3>
            <p className="tools-hint">
              Сначала запустите превью: оно покажет, какие формы будут сведены и почему
              часть данных может быть пропущена.
            </p>
          <div className="toolbar-actions" style={{ marginTop: "0.75rem", gap: "0.5rem" }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || parentZid === "" || eid === "" || selectedChildren.length === 0}
              onClick={() => void onPreview()}
            >
              {busy ? "…" : "Превью свода"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || parentZid === "" || eid === "" || selectedChildren.length === 0}
              onClick={() => void onAggregate()}
            >
              {busy ? "Свод…" : "Выполнить свод"}
            </button>
          </div>

          {preview && (
            <div style={{ marginTop: "1rem", overflowX: "auto" }}>
              <p className="tools-hint">
                Готовность: сведётся <strong>{preview.willAggregate}</strong>, пропуск{" "}
                <strong>{preview.willSkip}</strong> (участников: {preview.children.length})
              </p>
              {emptyPreview ? (
                <p className="warn-bar">
                  По выбранному коду периода данные участников не найдены. Если комплекты
                  открывались массово, у организаций может быть тот же квартал, но другой
                  внутренний EID; проверьте кампанию в «Комплектах».
                </p>
              ) : null}
              <table className="checks-table">
                <thead>
                  <tr>
                    <th>Форма</th>
                    <th>Есть</th>
                    <th>Нет</th>
                    <th>Свод</th>
                    <th>Причина</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.forms
                    .filter((f) => f.presentChildZids.length > 0 || f.missingChildZids.length > 0 || f.skippedReason)
                    .slice(0, 80)
                    .map((f) => (
                      <tr key={f.formId}>
                        <td>
                          {f.formId}
                          {f.title ? ` — ${f.title.slice(0, 40)}` : ""}
                        </td>
                        <td>
                          {f.presentChildZids.length}/{preview.children.length}
                        </td>
                        <td>{f.missingChildZids.length || "—"}</td>
                        <td>{f.willAggregate ? "да" : "нет"}</td>
                        <td>
                          {f.willAggregate ? "—" : skippedReasonLabel(f.skippedReason)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {preview.forms.length > 80 && (
                <p className="tools-hint">Показаны первые 80 форм…</p>
              )}
            </div>
          )}
          </div>

          <div className="aggregation-step">
            <h3>После свода: проверки</h3>
            <p className="tools-hint">
              Эти действия не запускают новый свод: они помогают проверить результат и
              дозаполнить балансные строки.
            </p>

          {aggrChecks && (
            <div style={{ marginTop: "0.75rem" }}>
              <p className="tools-hint">Увязки только для агрегации:</p>
              <CheckResultsPanel result={aggrChecks} />
            </div>
          )}

          {reorgChecks && (
            <div style={{ marginTop: "0.75rem" }}>
              <p className="tools-hint">
                Увязки реорганизации: {reorgChecks.passed}/{reorgChecks.total} пройдено
                {reorgChecks.skipped
                  ? `, пропуск/ошибка разбора: ${reorgChecks.skipped}`
                  : ""}
              </p>
              <CheckResultsPanel result={reorgChecks} />
            </div>
          )}

          {accountRows && (
            <div style={{ marginTop: "0.75rem" }}>
              <p className="tools-hint">
                Соответствие счетов и строк
                {accountRows.message
                  ? `: ${accountRows.message}`
                  : `: пар ${accountRows.totals.tempRows}, замечаний ${
                      accountRows.totals.unusedAccounts +
                      accountRows.totals.missingRowMappings +
                      accountRows.totals.blankAccountCells +
                      accountRows.totals.orphanAmounts
                    }`}
              </p>
              {!accountRows.message && (
                <table className="checks-table">
                  <thead>
                    <tr>
                      <th>Форма</th>
                      <th>Вид</th>
                      <th>Счёт</th>
                      <th>Стр.</th>
                      <th>Деталь</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountRows.forms.flatMap((f) =>
                      f.issues.slice(0, 40).map((issue, i) => (
                        <tr key={`${f.formId}-${issue.kind}-${i}`}>
                          <td>{f.formId}</td>
                          <td>
                            {issue.kind === "missing_row"
                              ? "нет строки"
                              : issue.kind === "unused_account"
                                ? "неисп. счёт"
                                : issue.kind === "blank_account"
                                  ? "пустой счёт"
                                  : "сумма без Стр."}
                          </td>
                          <td>{issue.account ?? "—"}</td>
                          <td>{issue.row ?? "—"}</td>
                          <td>{issue.detail ?? issue.name ?? "—"}</td>
                        </tr>
                      ))
                    )}
                    {accountRows.ok && (
                      <tr>
                        <td colSpan={5}>Замечаний нет</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="toolbar-actions" style={{ marginTop: "0.75rem", gap: "0.5rem" }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || parentZid === "" || eid === ""}
              onClick={() => void onCheckRelations()}
            >
              Проверить суммы (баланс)
            </button>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={fillBalanceMode === "overwrite"}
                onChange={(e) =>
                  onFillBalanceModeChange(e.target.checked ? "overwrite" : "ifEmpty")
                }
              />
              Перезаписать H (иначе только пустые)
            </label>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || parentZid === "" || eid === ""}
              onClick={() => void onFillBalance()}
              title="Заполнить N01_1.H из N01_02"
            >
              Заполнить баланс из N01_02
            </button>
          </div>

          {fillBalance && (
            <p className="tools-hint" style={{ marginTop: "0.5rem" }}>
              Заполнение баланса ({fillBalance.mode}): обновлено {fillBalance.updated}
              {fillBalance.skippedNonEmpty
                ? `, пропущено непустых ${fillBalance.skippedNonEmpty}`
                : ""}
              {fillBalance.message ? ` — ${fillBalance.message}` : ""}
            </p>
          )}

          {relations && (
            <div style={{ marginTop: "0.75rem" }}>
              <p className="tools-hint">
                Сверка сумм счетов и баланса — N01_02 → H
                {relations.message
                  ? `: ${relations.message}`
                  : `: расхождений ${relations.mismatched} из ${relations.compared}, пропуск итогов ${relations.skipped}`}
              </p>
              {!relations.message && (
                <table className="checks-table">
                  <thead>
                    <tr>
                      <th>Стр.</th>
                      <th>Дебет Σ</th>
                      <th>Кредит Σ</th>
                      <th>|Д−К|</th>
                      <th>H</th>
                      <th>Δ</th>
                      <th>ОК</th>
                    </tr>
                  </thead>
                  <tbody>
                    {relations.rows
                      .filter((r) => !r.matched)
                      .slice(0, 50)
                      .map((r) => (
                        <tr key={r.row}>
                          <td>
                            {r.row}
                            {r.name ? ` — ${r.name.slice(0, 30)}` : ""}
                          </td>
                          <td>{r.debit}</td>
                          <td>{r.credit}</td>
                          <td>{Math.abs(r.balance)}</td>
                          <td>{r.balanceH}</td>
                          <td>{r.delta}</td>
                          <td>{r.matched ? "да" : "нет"}</td>
                        </tr>
                      ))}
                    {relations.ok && (
                      <tr>
                        <td colSpan={7}>Расхождений нет</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          )}
          </div>
          </div>
        </>
      ) : (
        <p className="tools-hint">Требуется API-сервер.</p>
      )}
    </section>
  );
}
