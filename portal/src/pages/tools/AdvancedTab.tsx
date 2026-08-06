import { Link } from "react-router-dom";
import type { ExchangeMode, ToolsTabId } from "./tabs";

export interface AdvancedTabProps {
  onNavigateTab: (tab: ToolsTabId, opts?: { exchangeMode?: ExchangeMode }) => void;
}

/**
 * Former “manual aggregation of 2+ instances of one template” was incompatible
 * with unique (zid, eid, template_id): a package can hold only one instance per
 * form. Package-level свод (a_tblAgg_List) is the supported path.
 */
export function AdvancedTab({ onNavigateTab }: AdvancedTabProps) {
  return (
    <section className="tools-section">
      <h2>Служебные заметки</h2>
      <p className="tools-hint">
        Ручное сложение нескольких экземпляров одной формы в одном комплекте
        отключено: в БД действует уникальность{" "}
        <code>(организация, период, шаблон)</code>, поэтому внутри комплекта
        может быть только одна форма каждого типа.
      </p>
      <p className="tools-hint">
        Для промышленного свода используйте вкладку «Свод» (участники из{" "}
        <Link to="/admin/aggregation">конфигурации агрегации</Link>
        ). Выгрузка и приём комплектов — вкладка «Обмен» (внутри: Выгрузить /
        Загрузить).
      </p>
      <div className="toolbar-actions" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onNavigateTab("aggregation")}
        >
          К своду
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onNavigateTab("exchange", { exchangeMode: "export" })}
        >
          К выгрузке
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onNavigateTab("exchange", { exchangeMode: "upload" })}
        >
          К загрузке
        </button>
      </div>
    </section>
  );
}
