import { Link } from "react-router-dom";
import type { DesktopQuickAction } from "../../desktop/desktopConfig";
import type { IntegrationStatus } from "../../psdApi";
import type {
  InstanceSummary,
  PackageCompleteness,
  PackageDashboardRow,
  PackageWorkspaceRow,
} from "../../types";
import { StatusBadge } from "../ui";

export function DesktopGreeting({
  displayName,
  roleLabel,
  orgLabel,
  periodLabel,
}: {
  displayName: string;
  roleLabel: string;
  orgLabel: string | null;
  periodLabel: string | null;
}) {
  return (
    <header className="desktop-greeting">
      <div className="desktop-greeting-text">
        <p className="desktop-eyebrow">Рабочий стол</p>
        <h1>{displayName ? `Здравствуйте, ${displayName}` : "Здравствуйте"}</h1>
        <p className="desktop-lead">
          {roleLabel}
          {orgLabel ? ` · ${orgLabel}` : ""}
          {periodLabel ? ` · ${periodLabel}` : ""}
        </p>
      </div>
    </header>
  );
}

export function DesktopKpiRow({
  items,
}: {
  items: Array<{ id: string; label: string; value: string; hint?: string }>;
}) {
  if (!items.length) return null;
  return (
    <div className="desktop-kpi" role="list">
      {items.map((it) => (
        <div key={it.id} className="desktop-kpi-item" role="listitem">
          <span className="desktop-kpi-value">{it.value}</span>
          <span className="desktop-kpi-label">{it.label}</span>
          {it.hint ? <span className="desktop-kpi-hint">{it.hint}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function DesktopQuickActions({ actions }: { actions: DesktopQuickAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="desktop-panel desktop-actions" aria-label="Быстрые переходы">
      <h2>Быстрые переходы</h2>
      <div className="desktop-actions-row">
        {actions.map((a) => (
          <Link key={a.to} to={a.to} className="btn btn-secondary btn-sm">
            {a.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

export function MyFormsWidget({ items }: { items: InstanceSummary[] }) {
  return (
    <section className="desktop-panel" aria-label="Мои формы">
      <div className="desktop-panel-head">
        <h2>Недавние формы</h2>
        <Link to="/my" className="desktop-panel-link">
          Все формы
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="desktop-empty">Пока нет экземпляров форм.</p>
      ) : (
        <ul className="desktop-list">
          {items.map((it) => (
            <li key={it.instanceId}>
              <Link to={`/my/${it.instanceId}`} className="desktop-list-main">
                <span className="desktop-list-title">{it.displayName || it.templateTitle}</span>
                <span className="desktop-list-meta">{it.templateId}</span>
              </Link>
              <StatusBadge
                status={it.status === "submitted" ? "submitted" : "draft"}
                label={it.status === "submitted" ? "Сдано" : "Черновик"}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PackageCompletenessWidget({
  completeness,
  zid,
  eid,
}: {
  completeness: PackageCompleteness | null;
  zid: number | null;
  eid: number | null;
}) {
  const pct =
    completeness && completeness.total > 0
      ? Math.round((completeness.filled / completeness.total) * 100)
      : 0;
  return (
    <section className="desktop-panel" aria-label="Полнота комплекта">
      <div className="desktop-panel-head">
        <h2>Полнота комплекта</h2>
        {zid != null && eid != null ? (
          <Link to="/package" className="desktop-panel-link">
            Открыть
          </Link>
        ) : null}
      </div>
      {!completeness || zid == null || eid == null ? (
        <p className="desktop-empty">Выберите организацию и период в комплектах.</p>
      ) : (
        <>
          <div className="desktop-progress">
            <div className="desktop-progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <p className="desktop-progress-caption">
            {completeness.filled} / {completeness.total} форм · {pct}% · черновики{" "}
            {completeness.draft}, сдано {completeness.submitted}
          </p>
        </>
      )}
    </section>
  );
}

function bpStatusLabel(status: string | null): string {
  if (status === "pending_curator_approval") return "На согласовании";
  if (status === "collecting") return "Сбор";
  if (status === "curator_approved") return "Согласовано";
  if (status === "completed") return "Завершено";
  if (status === "not_started") return "Не начат";
  return status || "—";
}

export function BpQueueWidget({
  rows,
  title = "Очередь согласования",
  emptyHint = "Нет комплектов на согласовании.",
}: {
  rows: PackageWorkspaceRow[];
  title?: string;
  emptyHint?: string;
}) {
  return (
    <section className="desktop-panel" aria-label={title}>
      <div className="desktop-panel-head">
        <h2>{title}</h2>
        <Link to="/bp" className="desktop-panel-link">
          Мониторинг БП
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="desktop-empty">{emptyHint}</p>
      ) : (
        <div className="desktop-table-wrap">
          <table className="desktop-table">
            <thead>
              <tr>
                <th>Организация</th>
                <th>Период</th>
                <th>БП</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.zid}-${r.eid}-${r.packageKind}`}>
                  <td>
                    <Link to={`/package?zid=${r.zid}&eid=${r.eid}`}>
                      {r.organizationName}
                    </Link>
                    {r.hasBlockers ? (
                      <span className="desktop-blocker-flag"> блокеры</span>
                    ) : null}
                  </td>
                  <td>{r.periodName}</td>
                  <td>{bpStatusLabel(r.bpStatus)}</td>
                  <td>{r.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function PackagesSummaryWidget({
  rows,
  title = "Комплекты с низкой полнотой",
  readOnly = false,
}: {
  rows: Array<
    Pick<
      PackageDashboardRow | PackageWorkspaceRow,
      | "zid"
      | "eid"
      | "organizationName"
      | "periodName"
      | "percent"
      | "filled"
      | "total"
      | "submitted"
    >
  >;
  title?: string;
  readOnly?: boolean;
}) {
  return (
    <section className="desktop-panel" aria-label={title}>
      <div className="desktop-panel-head">
        <h2>{title}</h2>
        <Link to="/package" className="desktop-panel-link">
          {readOnly ? "Обзор" : "Комплекты"}
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="desktop-empty">Нет данных по комплектам.</p>
      ) : (
        <div className="desktop-table-wrap">
          <table className="desktop-table">
            <thead>
              <tr>
                <th>Организация</th>
                <th>Период</th>
                <th>Заполнено</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.zid}-${r.eid}`}>
                  <td>
                    {readOnly ? (
                      r.organizationName
                    ) : (
                      <Link to={`/package?zid=${r.zid}&eid=${r.eid}`}>
                        {r.organizationName}
                      </Link>
                    )}
                  </td>
                  <td>{r.periodName}</td>
                  <td>
                    {r.filled}/{r.total}
                    {typeof r.submitted === "number" ? ` · сдано ${r.submitted}` : ""}
                  </td>
                  <td>{r.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function IntegrationsWidget({
  status,
  aggHint,
}: {
  status: IntegrationStatus | null;
  aggHint?: string | null;
}) {
  const entries = status
    ? [
        ["ДО XML", status.doXml],
        ["SAP", status.sap],
        ["ЭДО", status.eds],
        ["Минфин", status.minfin],
      ] as const
    : [];
  return (
    <section className="desktop-panel" aria-label="Интеграции">
      <div className="desktop-panel-head">
        <h2>Интеграции</h2>
        <Link to="/integrations" className="desktop-panel-link">
          Статус
        </Link>
      </div>
      {!status ? (
        <p className="desktop-empty">Статус интеграций недоступен.</p>
      ) : (
        <ul className="desktop-integ-list">
          {entries.map(([label, item]) => (
            <li key={label}>
              <span>{label}</span>
              <span className={item.configured ? "is-ok" : "is-off"}>
                {item.configured ? "настроено" : "не настроено"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {aggHint ? <p className="desktop-kpi-hint">{aggHint}</p> : null}
    </section>
  );
}
