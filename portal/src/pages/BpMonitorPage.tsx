import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../apiClient";
import {
  canMutateData,
  psdRoleLabelRu,
  resolveUiPsdRole,
  type UserDto,
} from "../auth";
import { useAuth } from "../useAuth";
import { isBackendMode } from "../storage";
import { listOrganizations, listPeriods } from "../packagesApi";
import type { Organization, ReportingPeriod } from "../types";
import type { IdOrEmpty } from "../components/OrgPeriodSelects";
import { orgOptionLabel, packageKindLabel, periodOptionLabel, BP_STATUS_LABEL, formatDateTimeRu } from "../uiLabels";
import { CollapsibleFilters, countActiveFilters } from "../components/CollapsibleFilters";
import { StatusBadge } from "../components/ui";

type BpStatus =
  | "not_started"
  | "collecting"
  | "pending_curator_approval"
  | "curator_approved"
  | "completed";

interface BusinessProcess {
  id: string;
  eid: number;
  zid: number;
  packageKind: "OKO" | "BALANCE";
  status: BpStatus;
  curatorUserId: number | null;
  deadlineAt: string | null;
  iteration: number;
  note: string | null;
  lastChangedAt: string | null;
  lastChangedBy: string | null;
  organizationName?: string | null;
  periodName?: string | null;
  curatorName?: string | null;
}

const ACTIONS: Array<{ action: string; label: string; from: BpStatus[] }> = [
  { action: "start", label: "Запустить", from: ["not_started"] },
  { action: "submit_for_approval", label: "На согласование", from: ["collecting"] },
  {
    action: "curator_approve",
    label: "Согласовать",
    from: ["pending_curator_approval"],
  },
  {
    action: "curator_return",
    label: "Вернуть",
    from: ["pending_curator_approval"],
  },
  { action: "complete", label: "Завершить", from: ["curator_approved"] },
  { action: "reopen", label: "Открыть снова", from: ["completed"] },
];

export function BpMonitorPage() {
  const backend = isBackendMode();
  const auth = useAuth();
  const canMutate = canMutateData();
  const roleLabel = psdRoleLabelRu(resolveUiPsdRole(auth.user));
  const [items, setItems] = useState<BusinessProcess[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterKind, setFilterKind] = useState<string>("");
  const [selected, setSelected] = useState<BusinessProcess | null>(null);
  const [blockers, setBlockers] = useState<{
    blocked: boolean;
    missingExplanations: Array<{ ruleNumber: number; message: string | null }>;
  } | null>(null);
  const [curatorId, setCuratorId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [curators, setCurators] = useState<UserDto[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [periods, setPeriods] = useState<ReportingPeriod[]>([]);
  const [filterZid, setFilterZid] = useState<IdOrEmpty>("");
  const [filterEid, setFilterEid] = useState<IdOrEmpty>("");

  const load = useCallback(async () => {
    if (!backend) return;
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams();
      if (filterStatus) q.set("status", filterStatus);
      if (filterKind) q.set("packageKind", filterKind);
      if (typeof filterZid === "number") q.set("zid", String(filterZid));
      if (typeof filterEid === "number") q.set("eid", String(filterEid));
      const list = await apiFetch<BusinessProcess[]>(
        `/api/business-processes?${q.toString()}`
      );
      setItems(list);
      setSelected((prev) => (prev ? list.find((b) => b.id === prev.id) ?? null : null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [backend, filterStatus, filterKind, filterZid, filterEid]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!backend) return;
    void Promise.all([
      apiFetch<UserDto[]>("/api/users").catch(() => [] as UserDto[]),
      listOrganizations().catch(() => [] as Organization[]),
    ]).then(([users, orgList]) => {
      setCurators(
        users.filter(
          (u) =>
            u.active &&
            (u.psdRole === "department_curator" ||
              u.psdRole === "support_specialist" ||
              u.role === "admin")
        )
      );
      setOrgs(orgList);
    });
  }, [backend]);

  const onFilterOrg = async (raw: string) => {
    const next = raw === "" ? "" : Number(raw);
    setFilterZid(next);
    setFilterEid("");
    setPeriods([]);
    if (typeof next === "number") {
      try {
        const list = await listPeriods(next);
        setPeriods(list);
      } catch {
        /* ignore */
      }
    }
  };

  const selectBp = async (bp: BusinessProcess) => {
    setSelected(bp);
    setStatus("");
    setError("");
    setCuratorId(bp.curatorUserId != null ? String(bp.curatorUserId) : "");
    setDeadline(bp.deadlineAt?.slice(0, 10) ?? "");
    try {
      const b = await apiFetch<{
        blocked: boolean;
        missingExplanations: Array<{ ruleNumber: number; message: string | null }>;
      }>(`/api/business-processes/${encodeURIComponent(bp.id)}/approval-blockers`);
      setBlockers(b);
    } catch {
      setBlockers(null);
    }
  };

  const runAction = async (action: string) => {
    if (!selected) return;
    setError("");
    setStatus("");
    try {
      const updated = await apiFetch<BusinessProcess>(
        `/api/business-processes/${encodeURIComponent(selected.id)}/transition`,
        { method: "POST", body: JSON.stringify({ action }) }
      );
      setStatus(`Статус: ${BP_STATUS_LABEL[updated.status]}`);
      await load();
      await selectBp(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка перехода");
    }
  };

  const saveCurator = async () => {
    if (!selected) return;
    try {
      const updated = await apiFetch<BusinessProcess>(
        `/api/business-processes/${encodeURIComponent(selected.id)}/curator`,
        {
          method: "PUT",
          body: JSON.stringify({
            curatorUserId: curatorId.trim() ? Number(curatorId) : null,
            deadlineAt: deadline || null,
          }),
        }
      );
      setStatus("Куратор сохранён");
      await load();
      await selectBp(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка назначения куратора");
    }
  };

  const availableActions = useMemo(() => {
    if (!selected) return [];
    return ACTIONS.filter((a) => a.from.includes(selected.status));
  }, [selected]);

  if (!backend) {
    return <p className="hint">Мониторинг БП доступен только в backend-режиме.</p>;
  }

  return (
    <div className="page">
      <h1>Мониторинг бизнес-процессов</h1>
      <p className="tools-hint">
        Ваша роль: <strong>{roleLabel}</strong>. Здесь видны статусы сбора и согласования
        комплектов ОКО и Баланс.
      </p>

      <section className="tools-section">
        <CollapsibleFilters
          activeCount={countActiveFilters(
            filterStatus !== "",
            filterKind !== "",
            typeof filterZid === "number",
            typeof filterEid === "number"
          )}
          bodyClassName="tools-grid"
        >
          <label>
            Статус
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">Все</option>
              {Object.entries(BP_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Тип комплекта
            <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)}>
              <option value="">Все</option>
              <option value="OKO">{packageKindLabel("OKO")}</option>
              <option value="BALANCE">{packageKindLabel("BALANCE")}</option>
            </select>
          </label>
          <label>
            Организация
            <select
              value={filterZid === "" ? "" : String(filterZid)}
              onChange={(e) => void onFilterOrg(e.target.value)}
            >
              <option value="">Все</option>
              {orgs.map((o) => (
                <option key={o.zid} value={o.zid}>
                  {orgOptionLabel(o)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Период
            <select
              value={filterEid === "" ? "" : String(filterEid)}
              disabled={typeof filterZid !== "number"}
              onChange={(e) =>
                setFilterEid(e.target.value === "" ? "" : Number(e.target.value))
              }
            >
              <option value="">Все</option>
              {periods.map((p) => (
                <option key={p.eid} value={p.eid}>
                  {periodOptionLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <div style={{ alignSelf: "end" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? "Загрузка…" : "Обновить"}
            </button>
          </div>
        </CollapsibleFilters>
      </section>

      {error && <p className="error">{error}</p>}
      {status && <p className="ok">{status}</p>}

      <div className="bp-monitor-layout">
        <section className="tools-section">
          <h2>Комплекты</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Организация</th>
                  <th>Период</th>
                  <th>Тип</th>
                  <th>Статус</th>
                  <th>Итерация</th>
                  <th>Куратор</th>
                </tr>
              </thead>
              <tbody>
                {items.map((bp) => (
                  <tr
                    key={bp.id}
                    className={selected?.id === bp.id ? "is-selected" : undefined}
                    onClick={() => void selectBp(bp)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>{bp.organizationName ?? `Организация ${bp.zid}`}</td>
                    <td>{bp.periodName ?? `Период ${bp.eid}`}</td>
                    <td>{packageKindLabel(bp.packageKind)}</td>
                    <td>
                      <StatusBadge status={bp.status} label={BP_STATUS_LABEL[bp.status]} />
                    </td>
                    <td>{bp.iteration}</td>
                    <td>{bp.curatorName ?? "—"}</td>
                  </tr>
                ))}
                {!items.length && !loading && (
                  <tr>
                    <td colSpan={6}>Нет бизнес-процессов по выбранным фильтрам</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="tools-section">
          <h2>Действия</h2>
          {!selected && (
            <p className="tools-hint">Выберите комплект в таблице слева.</p>
          )}
          {selected && (
            <>
              <p className="tools-hint" style={{ marginBottom: 12 }}>
                <strong>
                  {selected.organizationName ?? `Организация ${selected.zid}`}
                </strong>
                {" · "}
                {selected.periodName ?? `Период ${selected.eid}`}
                {" · "}
                {packageKindLabel(selected.packageKind)}
                <br />
                <StatusBadge
                  status={selected.status}
                  label={BP_STATUS_LABEL[selected.status]}
                />
                {" · изменён "}
                {formatDateTimeRu(selected.lastChangedAt)}
                {selected.lastChangedBy ? ` (${selected.lastChangedBy})` : ""}
              </p>

              {availableActions.length > 0 && (
                <div className="toolbar-group-actions" style={{ marginBottom: 12 }}>
                  {availableActions.map((a) => (
                    <button
                      key={a.action}
                      type="button"
                      className="btn btn-secondary"
                      disabled={!canMutate}
                      onClick={() => void runAction(a.action)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="tools-grid">
                <label>
                  Куратор
                  <select
                    value={curatorId}
                    onChange={(e) => setCuratorId(e.target.value)}
                    disabled={!canMutate}
                  >
                    <option value="">— не назначен —</option>
                    {curators.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName || u.username}
                        {u.psdRole ? ` · ${psdRoleLabelRu(u.psdRole)}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Срок
                  <input
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    disabled={!canMutate}
                  />
                </label>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: 12 }}
                onClick={() => void saveCurator()}
                disabled={!canMutate}
              >
                Сохранить куратора
              </button>

              {blockers?.blocked && (
                <div className="error" style={{ marginTop: 12 }}>
                  Согласование заблокировано — нет объяснений по проверкам:{" "}
                  {blockers.missingExplanations
                    .map((m) => `правило №${m.ruleNumber}`)
                    .join(", ")}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
