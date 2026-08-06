import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../apiClient";
import { canMutateData, type UserDto } from "../auth";
import { useAuth } from "../useAuth";
import { isBackendMode } from "../storage";
import { listOrganizations, listPeriods } from "../packagesApi";
import type { Organization, ReportingPeriod } from "../types";
import type { IdOrEmpty } from "../components/OrgPeriodSelects";
import { orgOptionLabel, packageKindLabel, periodOptionLabel } from "../uiLabels";

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

const STATUS_LABEL: Record<BpStatus, string> = {
  not_started: "Не начат",
  collecting: "Сбор",
  pending_curator_approval: "На согласовании",
  curator_approved: "Согласован",
  completed: "Завершён",
};

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [backend, filterStatus, filterKind, filterZid, filterEid]);

  useEffect(() => {
    load();
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
      setStatus(`Статус: ${STATUS_LABEL[updated.status]}`);
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
      setStatus("Куратор обновлён");
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
      <p className="hint">
        Роль: {auth.user?.psdRole ?? auth.user?.role ?? "—"} · статусы сбора и согласования по
        комплектам ОКО и Баланс
      </p>

      <div className="toolbar" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label>
          Статус{" "}
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">Все</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Тип комплекта{" "}
          <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)}>
            <option value="">Все</option>
            <option value="OKO">{packageKindLabel("OKO")}</option>
            <option value="BALANCE">{packageKindLabel("BALANCE")}</option>
          </select>
        </label>
        <label>
          Организация{" "}
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
          Период{" "}
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
        <button type="button" onClick={() => load()} disabled={loading}>
          Обновить
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {status && <p className="ok">{status}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        <div className="card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Организация</th>
                <th>Период</th>
                <th>Тип</th>
                <th>Статус</th>
                <th>Итер.</th>
                <th>Куратор</th>
              </tr>
            </thead>
            <tbody>
              {items.map((bp) => (
                <tr
                  key={bp.id}
                  className={selected?.id === bp.id ? "is-selected" : undefined}
                  onClick={() => selectBp(bp)}
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    {bp.organizationName ?? bp.zid} ({bp.zid})
                  </td>
                  <td>
                    {bp.periodName ?? bp.eid} ({bp.eid})
                  </td>
                  <td>{packageKindLabel(bp.packageKind)}</td>
                  <td>{STATUS_LABEL[bp.status]}</td>
                  <td>{bp.iteration}</td>
                  <td>{bp.curatorName ?? bp.curatorUserId ?? "—"}</td>
                </tr>
              ))}
              {!items.length && !loading && (
                <tr>
                  <td colSpan={6}>Нет записей БП</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Действия</h2>
          {!selected && <p className="hint">Выберите строку слева</p>}
          {selected && (
            <>
              <p>
                <strong>{selected.id}</strong>
                <br />
                {STATUS_LABEL[selected.status]} · изменён {selected.lastChangedAt ?? "—"}{" "}
                {selected.lastChangedBy ? `(${selected.lastChangedBy})` : ""}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {availableActions.map((a) => (
                  <button
                    key={a.action}
                    type="button"
                    disabled={!canMutate}
                    onClick={() => runAction(a.action)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              <hr />
              <label>
                Куратор{" "}
                <select
                  value={curatorId}
                  onChange={(e) => setCuratorId(e.target.value)}
                  disabled={!canMutate}
                >
                  <option value="">— не назначен —</option>
                  {curators.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName || u.username}
                      {u.psdRole ? ` (${u.psdRole})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Дедлайн{" "}
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  disabled={!canMutate}
                />
              </label>
              <button type="button" onClick={saveCurator} disabled={!canMutate}>
                Сохранить куратора
              </button>
              {blockers?.blocked && (
                <div className="error" style={{ marginTop: 12 }}>
                  Согласование заблокировано — нет объяснений по проверкам:{" "}
                  {blockers.missingExplanations
                    .map((m) => `#${m.ruleNumber}`)
                    .join(", ")}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
