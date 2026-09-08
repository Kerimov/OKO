import { Link } from "react-router-dom";
import type { CompletenessItem } from "../../engine/completeness";
import type { ExchangeMode, ToolsTabId } from "./tabs";

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
  onNavigateTab: (tab: ToolsTabId, opts?: { exchangeMode?: ExchangeMode }) => void;
}

const SCENARIOS: Array<{
  title: string;
  description: string;
  tab: ToolsTabId;
  exchangeMode?: ExchangeMode;
  action: string;
}> = [
  {
    title: "Отправить дочкам",
    description:
      "Отметьте комплекты в списке и скачайте ZIP — один файл или архив с несколькими пакетами.",
    tab: "exchange",
    exchangeMode: "export",
    action: "К выгрузке",
  },
  {
    title: "Принять от дочек",
    description:
      "В «Обмен → Загрузить» перетащите JSON/ZIP — система разберёт файлы и примет комплекты по zid/eid.",
    tab: "exchange",
    exchangeMode: "upload",
    action: "К загрузке",
  },
  {
    title: "Проверить комплект",
    description:
      "Пересчёт формул и увязки по формам текущего комплекта (организация и период сверху).",
    tab: "quality",
    action: "К контролю",
  },
  {
    title: "Собрать свод",
    description:
      "Суммировать формы участников в сводную организацию за период (нужна конфигурация агрегации).",
    tab: "aggregation",
    action: "К своду",
  },
  {
    title: "Сальдо",
    description:
      "Перенести остатки между формами одного шаблона (прошлый период → текущий).",
    tab: "saldo",
    action: "К сальдо",
  },
];

export function OverviewTab({
  work,
  completeness,
  missingForms,
  onNavigateTab,
}: OverviewTabProps) {
  return (
    <>
      <section className="tools-section">
        <h2>Что делать в этом разделе</h2>
        <p>
          Здесь операции над комплектами: обмен файлами с дочками, контроль, сальдо и
          свод. Создание и настройка комплектов — в{" "}
          <Link to="/package">Комплектах</Link>.
        </p>
        {work.zid == null || work.eid == null ? (
          <p className="warn-bar">
            Для контроля и сальдо выберите организацию и период в{" "}
            <Link to="/package">Комплектах</Link>. Обмен файлами — вкладка «Обмен», без
            привязки к рабочему контексту.
          </p>
        ) : work.formCount === 0 ? (
          <p className="warn-bar">
            В рабочем комплекте (орг. {work.zid}, период {work.eid}) нет форм. Заведите
            их в <Link to="/package">Комплектах</Link> или примите файл в «Обмен →
            Загрузить».
          </p>
        ) : (
          <p className="hint-text">
            Рабочий комплект: {work.formCount} форм
            {completeness
              ? ` · полнота ${completeness.filled}/${completeness.total}`
              : ""}
            .
          </p>
        )}

        <div className="tools-scenario-grid">
          {SCENARIOS.map((s) => (
            <div key={s.title} className="tools-scenario-card">
              <h3>{s.title}</h3>
              <p>{s.description}</p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  onNavigateTab(
                    s.tab,
                    s.exchangeMode ? { exchangeMode: s.exchangeMode } : undefined
                  )
                }
              >
                {s.action}
              </button>
            </div>
          ))}
        </div>
      </section>

      {completeness && (
        <section className="tools-section">
          <h2>
            Полнота текущего комплекта{" "}
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
