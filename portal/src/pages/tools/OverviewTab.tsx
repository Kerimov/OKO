import { Link } from "react-router-dom";
import type { CompletenessItem } from "../../engine/completeness";
import type { ToolsTabId } from "./tabs";

export interface OverviewTabProps {
  work: {
    zid: number | null;
    eid: number | null;
    formCount: number;
  };
  completeness: {
    total: number;
    filled: number;
    items: CompletenessItem[];
  } | null;
  missingForms: CompletenessItem[];
  onNavigateTab: (tab: ToolsTabId) => void;
}

export function OverviewTab({
  work,
  completeness,
  missingForms,
  onNavigateTab,
}: OverviewTabProps) {
  return (
    <>
      <section className="tools-section">
        <h2>Рабочий комплект</h2>
        <p>
          Все операции обмена, контроля и сальдо используют формы организации и периода
          из раздела <Link to="/package">Комплект</Link>. Если форм нет — сначала
          заведите пустой комплект.
        </p>
        {work.zid == null || work.eid == null ? (
          <p className="warn-bar">
            Организация или период не заданы. Выберите их в{" "}
            <Link to="/package">Комплекте</Link>.
          </p>
        ) : work.formCount === 0 ? (
          <p className="warn-bar">
            Формы для организации {work.zid}, периода {work.eid} не найдены. Заведите
            пустые формы в <Link to="/package">Комплекте</Link>.
          </p>
        ) : (
          <p className="hint-text">
            Готово к работе: {work.formCount} форм. Дальше — вкладка «Обмен»
            (принять/выгрузить) или «Контроль» (пересчёт и увязки).
          </p>
        )}
        <div className="toolbar-actions" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onNavigateTab("exchange")}
          >
            К обмену комплектами
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onNavigateTab("quality")}
          >
            К контролю качества
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onNavigateTab("aggregation")}
          >
            К своду
          </button>
        </div>
      </section>

      {completeness && (
        <section className="tools-section">
          <h2>
            Полнота комплекта{" "}
            <span className="cat-count">
              {completeness.filled}/{completeness.total}
            </span>
          </h2>
          <div className="completeness-bar">
            <div
              className="completeness-fill"
              style={{
                width: `${(completeness.filled / Math.max(completeness.total, 1)) * 100}%`,
              }}
            />
          </div>
          {missingForms.length > 0 && (
            <details className="missing-forms">
              <summary>Не заполнено ({missingForms.length})</summary>
              <ul>
                {missingForms.map((f) => (
                  <li key={f.formId}>
                    <Link to="/catalog">{f.formId}</Link> — {f.title}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </>
  );
}
