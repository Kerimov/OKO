import type { InstanceSummary } from "../../types";

export interface AdvancedTabProps {
  templates: string[];
  byTemplate: Map<string, InstanceSummary[]>;
  templateId: string;
  onTemplateChange: (templateId: string) => void;
  selectedIds: string[];
  onToggleSelected: (instanceId: string) => void;
  busy: boolean;
  ready: boolean;
  onAggregate: () => void;
}

export function AdvancedTab({
  templates,
  byTemplate,
  templateId,
  onTemplateChange,
  selectedIds,
  onToggleSelected,
  busy,
  ready,
  onAggregate,
}: AdvancedTabProps) {
  return (
    <section className="tools-section">
      <h2>Агрегация вручную (один шаблон)</h2>
      <p className="tools-hint">
        Как в Access при варианте «несколько заполнителей одной формы»: сложить выбранные
        экземпляры одного шаблона построчно (числа суммируются). Нужны{" "}
        <strong>минимум 2 сохранённые формы одного шаблона</strong>. Для свода по участникам
        иерархии используйте вкладку «Свод».
      </p>
      <label>
        Шаблон
        <select
          value={templateId}
          onChange={(e) => onTemplateChange(e.target.value)}
        >
          <option value="">— выберите —</option>
          {templates.map((t) => (
            <option key={t} value={t}>
              {t} ({byTemplate.get(t)?.length ?? 0})
            </option>
          ))}
        </select>
      </label>
      {templateId && (
        <ul className="aggr-list">
          {(byTemplate.get(templateId) ?? []).map((s) => (
            <li key={s.instanceId}>
              <label>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(s.instanceId)}
                  onChange={() => onToggleSelected(s.instanceId)}
                />
                {s.displayName}
              </label>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => void onAggregate()}
        disabled={busy}
        title={
          ready
            ? "Суммировать выбранные формы"
            : "Выберите шаблон и отметьте 2+ формы"
        }
      >
        {busy ? "Агрегация…" : "Создать агрегированную форму"}
        {!ready && templateId && (
          <span className="btn-hint"> ({selectedIds.length}/2)</span>
        )}
      </button>
    </section>
  );
}
