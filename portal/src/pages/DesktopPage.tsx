import { useEffect, useMemo, useState } from "react";
import {
  isAuditorReadonly,
  psdRoleLabelRu,
  resolveUiPsdRole,
} from "../auth";
import {
  filterDesktopActions,
  getDesktopConfig,
  type DesktopKpiId,
} from "../desktop/desktopConfig";
import {
  BpQueueWidget,
  DesktopGreeting,
  DesktopKpiRow,
  DesktopQuickActions,
  IntegrationsWidget,
  MyFormsWidget,
  PackageCompletenessWidget,
  PackagesSummaryWidget,
} from "../components/desktop/DesktopWidgets";
import { fetchAggStats } from "../aggregationApi";
import {
  fetchPackageCompleteness,
  fetchPackagesDashboard,
  fetchPackageWorkspace,
  listOrganizations,
  listPeriods,
  loadWorkContext,
} from "../packagesApi";
import { getIntegrationsStatus, type IntegrationStatus } from "../psdApi";
import { isBackendMode, listInstances } from "../storage";
import type {
  InstanceSummary,
  PackageCompleteness,
  PackageDashboardRow,
  PackageWorkspaceRow,
} from "../types";
import { useAuth } from "../useAuth";

type DesktopData = {
  instances: InstanceSummary[];
  completeness: PackageCompleteness | null;
  workspace: PackageWorkspaceRow[];
  dashboard: PackageDashboardRow[];
  integrations: IntegrationStatus | null;
  aggIncluded: number | null;
  orgName: string | null;
  periodName: string | null;
  zid: number | null;
  eid: number | null;
};

const EMPTY: DesktopData = {
  instances: [],
  completeness: null,
  workspace: [],
  dashboard: [],
  integrations: null,
  aggIncluded: null,
  orgName: null,
  periodName: null,
  zid: null,
  eid: null,
};

function avgPercent(
  rows: Array<{ percent: number }>
): number {
  if (!rows.length) return 0;
  return Math.round(rows.reduce((s, r) => s + r.percent, 0) / rows.length);
}

function formatKpi(
  id: DesktopKpiId,
  data: DesktopData
): { label: string; value: string; hint?: string } {
  const drafts = data.instances.filter((i) => i.status !== "submitted").length;
  const submitted = data.instances.filter((i) => i.status === "submitted").length;
  const pending = data.workspace.filter(
    (r) => r.bpStatus === "pending_curator_approval"
  ).length;
  const blockers = data.workspace.filter((r) => r.hasBlockers).length;
  const summaryRows =
    data.dashboard.length > 0
      ? data.dashboard
      : data.workspace.map((r) => ({
          percent: r.percent,
          submitted: r.submitted,
        }));
  const openBp = data.workspace.filter(
    (r) => r.bpStatus && r.bpStatus !== "completed" && r.bpStatus !== "not_started"
  ).length;
  const integOk = data.integrations
    ? [data.integrations.doXml, data.integrations.sap, data.integrations.eds, data.integrations.minfin]
        .filter((x) => x.configured).length
    : 0;
  const completenessPct =
    data.completeness && data.completeness.total > 0
      ? Math.round((data.completeness.filled / data.completeness.total) * 100)
      : 0;
  const perimeterPct = avgPercent(data.workspace);

  switch (id) {
    case "drafts":
      return { label: "Черновики", value: String(drafts) };
    case "submitted":
      return { label: "Сдано", value: String(submitted) };
    case "completenessPct":
      return {
        label: "Полнота",
        value: `${completenessPct}%`,
        hint:
          data.completeness != null
            ? `${data.completeness.filled}/${data.completeness.total}`
            : undefined,
      };
    case "pendingApproval":
      return { label: "На согласовании", value: String(pending) };
    case "withBlockers":
      return { label: "С блокерами", value: String(blockers) };
    case "perimeterPct":
      return { label: "Средняя полнота", value: `${perimeterPct}%` };
    case "packagesCount":
      return {
        label: "Комплектов",
        value: String(summaryRows.length || data.workspace.length),
      };
    case "avgPct":
      return {
        label: "Средний %",
        value: `${avgPercent(
          data.dashboard.length ? data.dashboard : data.workspace
        )}%`,
      };
    case "openBp":
      return { label: "Активные БП", value: String(openBp) };
    case "integrationsOk":
      return { label: "Интеграции", value: `${integOk}/4` };
    case "aggIncluded":
      return {
        label: "В своде",
        value: data.aggIncluded != null ? String(data.aggIncluded) : "—",
      };
  }
}

export function DesktopPage() {
  const auth = useAuth();
  const psdRole = resolveUiPsdRole(auth.user);
  const config = useMemo(() => getDesktopConfig(psdRole), [psdRole]);
  const actions = useMemo(
    () =>
      filterDesktopActions(config.actions, {
        auditorReadonly: isAuditorReadonly(),
      }),
    [config.actions]
  );

  const [data, setData] = useState<DesktopData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const needWorkspace = config.widgets.some((w) =>
          ["bpQueue", "packagesSummary", "packagesReadOnly"].includes(w)
        );
        const needCompleteness = config.widgets.includes("packageCompleteness");
        const needDashboard = config.widgets.includes("packagesSummary") && isBackendMode();
        const needIntegrations = config.widgets.includes("integrations");
        const needInstances =
          config.widgets.includes("myForms") ||
          config.kpis.some((k) => k === "drafts" || k === "submitted");

        const ctx = await loadWorkContext().catch(() => ({ zid: null, eid: null }));
        const userZid = auth.user?.zid ?? null;
        const zid = userZid ?? ctx.zid;
        const eid = ctx.eid;

        const [orgs, periods, instances, workspace, dashboard, completeness, integrations, agg] =
          await Promise.all([
            listOrganizations().catch(() => []),
            zid != null ? listPeriods(zid).catch(() => []) : Promise.resolve([]),
            needInstances
              ? listInstances(zid != null ? { zid } : undefined).catch(() => [])
              : Promise.resolve([]),
            needWorkspace
              ? fetchPackageWorkspace(
                  auth.user?.role === "org" && userZid != null ? userZid : undefined
                ).catch(() => [])
              : Promise.resolve([]),
            needDashboard
              ? fetchPackagesDashboard().catch(() => [])
              : Promise.resolve([]),
            needCompleteness && zid != null && eid != null
              ? fetchPackageCompleteness(zid, eid).catch(() => null)
              : Promise.resolve(null),
            needIntegrations
              ? getIntegrationsStatus().catch(() => null)
              : Promise.resolve(null),
            needIntegrations && isBackendMode()
              ? fetchAggStats().catch(() => null)
              : Promise.resolve(null),
          ]);

        if (cancelled) return;
        const org = zid != null ? orgs.find((o) => o.zid === zid) : null;
        const period = eid != null ? periods.find((p) => p.eid === eid) : null;
        setData({
          instances,
          completeness,
          workspace,
          dashboard,
          integrations,
          aggIncluded: agg?.included ?? null,
          orgName: org?.name ?? auth.user?.organizationName ?? null,
          periodName: period?.name ?? null,
          zid,
          eid,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить рабочий стол");
          setData(EMPTY);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.user?.zid, auth.user?.role, auth.user?.organizationName, config]);

  const displayName =
    auth.user?.displayName?.trim() ||
    auth.user?.username ||
    (auth.role === "admin" ? "администратор" : "");

  const kpiItems = config.kpis.map((id) => ({
    id,
    ...formatKpi(id, data),
  }));

  const recentForms = data.instances.slice(0, 8);

  const pendingQueue = data.workspace
    .filter((r) => r.bpStatus === "pending_curator_approval" || r.hasBlockers)
    .sort((a, b) => a.percent - b.percent)
    .slice(0, 10);

  const openBpRows = data.workspace
    .filter((r) => r.bpStatus && r.bpStatus !== "completed")
    .sort((a, b) => a.percent - b.percent)
    .slice(0, 10);

  const lowPackages = (
    data.dashboard.length
      ? data.dashboard.map((r) => ({
          zid: r.zid,
          eid: r.eid,
          organizationName: r.organizationName,
          periodName: r.periodName,
          percent: r.percent,
          filled: r.filled,
          total: r.total,
          submitted: r.submitted,
        }))
      : data.workspace.map((r) => ({
          zid: r.zid,
          eid: r.eid,
          organizationName: r.organizationName,
          periodName: r.periodName,
          percent: r.percent,
          filled: r.filled,
          total: r.total,
          submitted: r.submitted,
        }))
  )
    .slice()
    .sort((a, b) => a.percent - b.percent)
    .slice(0, 10);

  const queueForRole =
    psdRole === "department_curator" ? pendingQueue : openBpRows;

  return (
    <div className="desktop-page">
      <DesktopGreeting
        displayName={displayName}
        roleLabel={psdRoleLabelRu(psdRole)}
        orgLabel={data.orgName}
        periodLabel={data.periodName}
      />

      {error ? <div className="error-box">{error}</div> : null}
      {loading ? <div className="loading">Загрузка рабочего стола…</div> : null}

      {!loading && <DesktopKpiRow items={kpiItems} />}

      {!loading && (
        <div className="desktop-grid">
          {config.widgets.includes("myForms") && (
            <MyFormsWidget items={recentForms} />
          )}
          {config.widgets.includes("packageCompleteness") && (
            <PackageCompletenessWidget
              completeness={data.completeness}
              zid={data.zid}
              eid={data.eid}
            />
          )}
          {config.widgets.includes("bpQueue") && (
            <BpQueueWidget
              rows={queueForRole}
              title={
                psdRole === "department_curator"
                  ? "Очередь согласования"
                  : "Активные бизнес-процессы"
              }
              emptyHint={
                psdRole === "department_curator"
                  ? "Нет комплектов на согласовании."
                  : "Нет активных бизнес-процессов."
              }
            />
          )}
          {(config.widgets.includes("packagesSummary") ||
            config.widgets.includes("packagesReadOnly")) && (
            <PackagesSummaryWidget
              rows={lowPackages}
              title={
                config.widgets.includes("packagesReadOnly")
                  ? "Обзор полноты комплектов"
                  : "Комплекты с низкой полнотой"
              }
              readOnly={config.widgets.includes("packagesReadOnly")}
            />
          )}
          {config.widgets.includes("integrations") && (
            <IntegrationsWidget
              status={data.integrations}
              aggHint={
                data.aggIncluded != null
                  ? `Агрегация: ${data.aggIncluded} связей включено в свод`
                  : null
              }
            />
          )}
        </div>
      )}

      {!loading && <DesktopQuickActions actions={actions} />}
    </div>
  );
}
