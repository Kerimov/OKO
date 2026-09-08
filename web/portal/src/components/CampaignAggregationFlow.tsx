import { Link } from "react-router-dom";

export type CampaignAggregationFlowStep = "rules" | "campaign" | "svod";

const STEPS: Array<{
  id: CampaignAggregationFlowStep;
  n: number;
  label: string;
  to: string;
  hint: string;
}> = [
  {
    id: "rules",
    n: 1,
    label: "Правила",
    to: "/admin/aggregation",
    hint: "кто входит в чей свод",
  },
  {
    id: "campaign",
    n: 2,
    label: "Кампания",
    to: "/package",
    hint: "периметр периода и формы",
  },
  {
    id: "svod",
    n: 3,
    label: "Свод",
    to: "/tools?tab=aggregation",
    hint: "превью и запуск",
  },
];

type Props = {
  current: CampaignAggregationFlowStep;
  className?: string;
};

/** Короткая операторская схема: правила → кампания → свод. */
export function CampaignAggregationFlow({ current, className = "" }: Props) {
  return (
    <aside
      className={`campaign-agg-flow ${className}`.trim()}
      aria-label="Схема работы: правила, кампания, свод"
    >
      <p className="campaign-agg-flow-lead">
        Рабочий порядок ЦО: сначала состав свода, затем кампания периода, потом запуск
        свода. Реестр НСИ — справочник, не периметр сбора.
      </p>
      <ol className="campaign-agg-flow-steps">
        {STEPS.map((step, index) => {
          const active = step.id === current;
          return (
            <li
              key={step.id}
              className={`campaign-agg-flow-step${active ? " is-current" : ""}`}
              aria-current={active ? "step" : undefined}
            >
              {index > 0 ? (
                <span className="campaign-agg-flow-arrow" aria-hidden="true">
                  →
                </span>
              ) : null}
              {active ? (
                <span className="campaign-agg-flow-link is-current">
                  <span className="campaign-agg-flow-n">{step.n}</span>
                  <span className="campaign-agg-flow-text">
                    <strong>{step.label}</strong>
                    <span>{step.hint}</span>
                  </span>
                </span>
              ) : (
                <Link to={step.to} className="campaign-agg-flow-link">
                  <span className="campaign-agg-flow-n">{step.n}</span>
                  <span className="campaign-agg-flow-text">
                    <strong>{step.label}</strong>
                    <span>{step.hint}</span>
                  </span>
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
