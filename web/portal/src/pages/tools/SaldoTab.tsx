import type {
  SaldoCompareResult,
  SaldoPhase,
  SaldoTransferMode,
} from "../../engine/saldoEngine";
import type { InstanceSummary } from "../../types";

export interface SaldoTabProps {
  summaries: InstanceSummary[];
  sourceId: string;
  onSourceChange: (id: string) => void;
  targetId: string;
  onTargetChange: (id: string) => void;
  mode: SaldoTransferMode;
  onModeChange: (mode: SaldoTransferMode) => void;
  phase: SaldoPhase;
  onPhaseChange: (phase: SaldoPhase) => void;
  detailedType: "t" | "s" | "g";
  onDetailedTypeChange: (type: "t" | "s" | "g") => void;
  ruleCount: number | null;
  dryRun: boolean;
  onDryRunChange: (value: boolean) => void;
  compare: SaldoCompareResult | null;
  onClearCompare: () => void;
  onTransfer: () => void;
}

export function SaldoTab({
  summaries,
  sourceId,
  onSourceChange,
  targetId,
  onTargetChange,
  mode,
  onModeChange,
  phase,
  onPhaseChange,
  detailedType,
  onDetailedTypeChange,
  ruleCount,
  dryRun,
  onDryRunChange,
  compare,
  onClearCompare,
  onTransfer,
}: SaldoTabProps) {
  return (
    <section className="tools-section">
      <h2>Перенос сальдо</h2>
      <p className="tools-hint">
        Как в исходном ОКО: этап 1 — по соответствию граф форм (пред. период / аналог. год);
        этап 2 — по детальным правилам (текущий / сальдо / год). Исходная и целевая формы — один
        шаблон. Обычно источник — прошлый период, цель — текущий; в списке указаны ZID/EID.
      </p>
      <div className="tools-grid">
        <label>
          Способ
          <select
            value={mode}
            onChange={(e) => onModeChange(e.target.value as SaldoTransferMode)}
          >
            <option value="columns">Соответствие форм (пред. период / аналог. год)</option>
            <option value="detailed">Детальные правила (Т / С / Г)</option>
          </select>
        </label>
        <label>
          Исходная форма
          <select value={sourceId} onChange={(e) => onSourceChange(e.target.value)}>
            <option value="">— выберите —</option>
            {summaries.map((s) => (
              <option key={s.instanceId} value={s.instanceId}>
                {s.displayName}
                {s.zid != null || s.eid != null
                  ? ` · Z${s.zid ?? "?"}/E${s.eid ?? "?"}`
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Целевая форма
          <select value={targetId} onChange={(e) => onTargetChange(e.target.value)}>
            <option value="">— выберите —</option>
            {summaries.map((s) => (
              <option key={s.instanceId} value={s.instanceId}>
                {s.displayName}
                {s.zid != null || s.eid != null
                  ? ` · Z${s.zid ?? "?"}/E${s.eid ?? "?"}`
                  : ""}
              </option>
            ))}
          </select>
        </label>
        {mode === "columns" ? (
          <label>
            Этап
            <select
              value={phase}
              onChange={(e) => onPhaseChange(e.target.value as SaldoPhase)}
            >
              <option value="previous_period">Предыдущий период</option>
              <option value="analog_period">Аналог. период прошлого года</option>
            </select>
          </label>
        ) : (
          <label>
            Тип правила
            <select
              value={detailedType}
              onChange={(e) => onDetailedTypeChange(e.target.value as "t" | "s" | "g")}
            >
              <option value="t">Текущий период</option>
              <option value="s">Сальдо / входящие</option>
              <option value="g">Год / аналог</option>
            </select>
          </label>
        )}
      </div>
      {mode === "detailed" && targetId && ruleCount !== null && (
        <p className="tools-hint">
          Правил для{" "}
          {summaries.find((s) => s.instanceId === targetId)?.templateId}:{" "}
          <strong>{ruleCount}</strong> (тип {detailedType.toUpperCase()})
        </p>
      )}
      <label className="checkbox-inline" style={{ display: "block", marginBottom: "0.5rem" }}>
        <input
          type="checkbox"
          checked={dryRun}
          onChange={(e) => {
            onDryRunChange(e.target.checked);
            if (!e.target.checked) onClearCompare();
          }}
        />
        Только проверить данные (сверка ячеек без записи)
      </label>
      <button type="button" className="btn btn-secondary" onClick={() => void onTransfer()}>
        {dryRun ? "Сверить сальдо" : "Перенести сальдо"}
      </button>
      {compare && compare.diffs.length > 0 && (
        <div className="table-wrap" style={{ marginTop: "0.75rem", maxHeight: "16rem", overflow: "auto" }}>
          <table className="form-table" style={{ minWidth: "24rem" }}>
            <thead>
              <tr>
                <th>Строка</th>
                <th>Графа</th>
                <th>Источник</th>
                <th>Цель</th>
              </tr>
            </thead>
            <tbody>
              {compare.diffs.slice(0, 200).map((d, i) => (
                <tr key={`${d.rowNum}-${d.column}-${i}`}>
                  <td>{d.rowNum}</td>
                  <td>{d.column}</td>
                  <td>{d.sourceValue ?? "—"}</td>
                  <td>{d.targetValue ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {compare.diffs.length > 200 && (
            <p className="hint-text">Показаны первые 200 из {compare.diffs.length}.</p>
          )}
        </div>
      )}
    </section>
  );
}
