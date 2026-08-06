import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { canMutateData, isAuditorReadonly, type PsdRole } from "../auth";
import {
  createOrganization,
  createPeriod,
  createReportPackage,
  closePeriod,
  reopenPeriod,
  distributePackagesToChildren,
  deleteReportPackage,
  fetchPackageCompleteness,
  listOrganizations,
  listPeriods,
  loadWorkContext,
  saveWorkContext,
  setPackageWorkflowStatus,
} from "../packagesApi";
import {
  ensureBusinessProcess,
  getBpApprovalBlockers,
  transitionBusinessProcess,
  type ApprovalBlockers,
  type BpAction,
  type BpStatus,
  type BusinessProcessDto,
  type PackageKind,
} from "../psdApi";
import { isBackendMode } from "../storage";
import type {
  Organization,
  PackageCompleteness,
  PackageWorkflowStatus,
  ReportingPeriod,
} from "../types";
import { formatPeriod, formStatusLabel, packageWorkflowLabel } from "../utils";
import { useAuth } from "../useAuth";
import { formsListNavLabel } from "../formsListLabels";

const BP_STATUS_LABEL: Record<BpStatus, string> = {
  not_started: "Не начат",
  collecting: "Сбор",
  pending_curator_approval: "На согласовании",
  curator_approved: "Согласован",
  completed: "Завершён",
};

const BP_ACTIONS: Array<{
  action: BpAction;
  label: string;
  from: BpStatus[];
  roles: PsdRole[];
}> = [
  {
    action: "start",
    label: "Запустить",
    from: ["not_started"],
    roles: ["business_process_manager", "support_specialist"],
  },
  {
    action: "submit_for_approval",
    label: "На согласование",
    from: ["collecting"],
    roles: ["subsidiary_specialist", "support_specialist"],
  },
  {
    action: "curator_approve",
    label: "Согласовать",
    from: ["pending_curator_approval"],
    roles: ["department_curator", "support_specialist"],
  },
  {
    action: "curator_return",
    label: "Вернуть",
    from: ["pending_curator_approval"],
    roles: ["department_curator", "support_specialist"],
  },
  {
    action: "complete",
    label: "Завершить",
    from: ["curator_approved"],
    roles: ["business_process_manager", "support_specialist"],
  },
  {
    action: "reopen",
    label: "Открыть снова",
    from: ["completed"],
    roles: ["business_process_manager", "support_specialist"],
  },
];

function resolveUiPsdRole(auth: {
  authRequired: boolean;
  role: string | null;
  user: { role: string; psdRole?: PsdRole } | null;
}): PsdRole {
  if (auth.user?.psdRole) return auth.user.psdRole;
  if (!auth.authRequired || auth.role === "admin" || auth.user?.role === "admin") {
    return "support_specialist";
  }
  return "subsidiary_specialist";
}

export function PackagePage() {
  const auth = useAuth();
  const admin = !auth.authRequired || auth.role === "admin";
  const canMutate = canMutateData();
  const auditorRo = isAuditorReadonly();
  const psdRole = resolveUiPsdRole(auth);
  const orgZid = auth.user?.role === "org" ? auth.user.zid ?? null : null;
  const formsLinkLabel = formsListNavLabel(auth);
  const backend = isBackendMode();
  const [searchParams] = useSearchParams();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [periods, setPeriods] = useState<ReportingPeriod[]>([]);
  const [zid, setZid] = useState<number | "">("");
  const [eid, setEid] = useState<number | "">("");
  const [completeness, setCompleteness] = useState<PackageCompleteness | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgParentZid, setNewOrgParentZid] = useState<number | "">("");
  const [newPeriodName, setNewPeriodName] = useState("");
  const [newPeriodStart, setNewPeriodStart] = useState("");
  const [newPeriodEnd, setNewPeriodEnd] = useState("");
  const [newPackageKind, setNewPackageKind] = useState<PackageKind>("OKO");
  const [workflowComment, setWorkflowComment] = useState("");
  const [bp, setBp] = useState<BusinessProcessDto | null>(null);
  const [bpBlockers, setBpBlockers] = useState<ApprovalBlockers | null>(null);
  const [bpBusy, setBpBusy] = useState(false);

  const selectedOrg = useMemo(
    () => orgs.find((o) => o.zid === zid),
    [orgs, zid]
  );
  const selectedPeriod = useMemo(
    () => periods.find((p) => p.eid === eid),
    [periods, eid]
  );
  const childOrgs = useMemo(
    () => (zid === "" ? [] : orgs.filter((o) => o.parentZid === zid)),
    [orgs, zid]
  );

  const canDeletePackage =
    admin || (orgZid != null && typeof zid === "number" && zid === orgZid);

  const refreshCompleteness = useCallback(async (z: number, e: number) => {
    try {
      setCompleteness(await fetchPackageCompleteness(z, e));
    } catch (err) {
      setCompleteness(null);
      setStatus(err instanceof Error ? err.message : "Не удалось загрузить комплект");
    }
  }, []);

  const refreshPeriods = useCallback(async (orgZid: number) => {
    setPeriods(await listPeriods(orgZid));
  }, []);

  const refreshBp = useCallback(
    async (z: number, e: number, kind: PackageKind) => {
      if (!backend) {
        setBp(null);
        setBpBlockers(null);
        return;
      }
      try {
        const row = await ensureBusinessProcess({ zid: z, eid: e, packageKind: kind });
        setBp(row);
        try {
          setBpBlockers(await getBpApprovalBlockers(row.id));
        } catch {
          setBpBlockers(null);
        }
      } catch {
        setBp(null);
        setBpBlockers(null);
      }
    },
    [backend]
  );

  useEffect(() => {
    (async () => {
      const [orgList, ctx] = await Promise.all([listOrganizations(), loadWorkContext()]);
      setOrgs(orgList);
      const paramZid = Number(searchParams.get("zid"));
      const paramEid = Number(searchParams.get("eid"));
      const initialZid: number | "" =
        Number.isFinite(paramZid) && paramZid > 0
          ? paramZid
          : ctx.zid ?? orgList[0]?.zid ?? "";
      setZid(initialZid);
      if (typeof initialZid === "number") {
        const perList = await listPeriods(initialZid);
        setPeriods(perList);
        const ctxEid =
          ctx.eid != null && perList.some((p) => p.eid === ctx.eid) ? ctx.eid : null;
        const initialEid: number | "" =
          Number.isFinite(paramEid) && paramEid > 0
            ? paramEid
            : ctxEid ?? perList[0]?.eid ?? "";
        setEid(initialEid);
        if (typeof initialEid === "number") {
          await refreshCompleteness(initialZid, initialEid);
          const kind =
            perList.find((p) => p.eid === initialEid)?.packageKind === "BALANCE"
              ? "BALANCE"
              : "OKO";
          await refreshBp(initialZid, initialEid, kind);
        }
      }
      setLoading(false);
    })();
  }, [refreshCompleteness, refreshBp, searchParams]);

  const handleZidChange = async (value: number) => {
    setZid(value);
    setEid("");
    setCompleteness(null);
    setBp(null);
    await refreshPeriods(value);
    const perList = await listPeriods(value);
    if (perList[0]) {
      setEid(perList[0].eid);
      await saveWorkContext({ zid: value, eid: perList[0].eid });
      await refreshCompleteness(value, perList[0].eid);
      await refreshBp(
        value,
        perList[0].eid,
        perList[0].packageKind === "BALANCE" ? "BALANCE" : "OKO"
      );
    } else {
      await saveWorkContext({ zid: value, eid: null });
    }
  };

  const handleEidChange = async (value: number) => {
    setEid(value);
    if (zid !== "") {
      await saveWorkContext({ zid, eid: value });
      await refreshCompleteness(zid, value);
      const kind =
        periods.find((p) => p.eid === value)?.packageKind === "BALANCE"
          ? "BALANCE"
          : "OKO";
      await refreshBp(zid, value, kind);
    }
  };

  const handleCreateOrg = async () => {
    if (!newOrgName.trim()) return;
    setBusy(true);
    setStatus("");
    try {
      const org = await createOrganization({
        name: newOrgName.trim(),
        parentZid: newOrgParentZid === "" ? null : newOrgParentZid,
      });
      const next = [...orgs, org].sort((a, b) => a.name.localeCompare(b.name, "ru"));
      setOrgs(next);
      setNewOrgName("");
      setNewOrgParentZid("");
      await handleZidChange(org.zid);
      setStatus(
        `Организация «${org.name}» создана (код ${org.zid})` +
          (org.parentZid != null ? ` · родитель Z${org.parentZid}` : "")
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка создания организации");
    } finally {
      setBusy(false);
    }
  };

  const handleCreatePeriod = async () => {
    if (zid === "" || !newPeriodName.trim() || !canMutate) return;
    setBusy(true);
    setStatus("");
    try {
      const period = await createPeriod({
        zid,
        name: newPeriodName.trim(),
        periodStart: newPeriodStart || undefined,
        periodEnd: newPeriodEnd || undefined,
        packageKind: newPackageKind,
      });
      await refreshPeriods(zid);
      setNewPeriodName("");
      setNewPeriodStart("");
      setNewPeriodEnd("");
      setNewPackageKind("OKO");
      await handleEidChange(period.eid);
      setStatus(
        `Период «${period.name}» создан (код ${period.eid}, тип ${period.packageKind ?? newPackageKind})`
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка создания периода");
    } finally {
      setBusy(false);
    }
  };

  const handleBpAction = async (action: BpAction) => {
    if (!bp || !canMutate) return;
    setBpBusy(true);
    setStatus("");
    try {
      const updated = await transitionBusinessProcess(bp.id, action);
      setBp(updated);
      try {
        setBpBlockers(await getBpApprovalBlockers(updated.id));
      } catch {
        setBpBlockers(null);
      }
      setStatus(`БП: ${BP_STATUS_LABEL[updated.status]}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка перехода БП");
    } finally {
      setBpBusy(false);
    }
  };

  const bpActions = useMemo(() => {
    if (!bp) return [];
    return BP_ACTIONS.filter(
      (a) => a.from.includes(bp.status) && a.roles.includes(psdRole)
    );
  }, [bp, psdRole]);

  const handleCreatePackage = async () => {
    if (zid === "" || eid === "") return;
    setBusy(true);
    setStatus("");
    try {
      const result = await createReportPackage(zid, eid);
      await refreshCompleteness(zid, eid);
      setStatus(
        `Комплект заведён: создано ${result.created}, пропущено ${result.skipped} (всего шаблонов ${result.total})`
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка создания комплекта");
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePackage = async () => {
    if (zid === "" || eid === "" || !selectedOrg || !selectedPeriod) return;
    const filled = completeness?.filled ?? 0;
    const formsPart =
      filled > 0
        ? `Будут удалены все формы (${filled}).\n`
        : "Форм в комплекте нет.\n";
    if (
      !confirm(
        `Удалить комплект «${selectedOrg.name} — ${selectedPeriod.name}»?\n\n${formsPart}Отчётный период будет удалён. Действие необратимо.`
      )
    ) {
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const result = await deleteReportPackage(zid, eid);
      const perList = await listPeriods(zid);
      setPeriods(perList);
      if (perList[0]) {
        setEid(perList[0].eid);
        await saveWorkContext({ zid, eid: perList[0].eid });
        await refreshCompleteness(zid, perList[0].eid);
      } else {
        setEid("");
        setCompleteness(null);
        await saveWorkContext({ zid, eid: null });
      }
      setStatus(
        `Комплект удалён: форм ${result.deletedInstances}, период снят с учёта`
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка удаления комплекта");
    } finally {
      setBusy(false);
    }
  };

  const handleWorkflow = async (next: PackageWorkflowStatus, force = false) => {
    if (zid === "" || eid === "") return;
    setBusy(true);
    setStatus("");
    try {
      const wf = await setPackageWorkflowStatus(
        zid,
        eid,
        next,
        workflowComment.trim() || null,
        force
      );
      setWorkflowComment("");
      await refreshCompleteness(zid, eid);
      setStatus(
        `Статус комплекта: ${packageWorkflowLabel(wf.status)}${
          force ? " (без проверки полноты)" : ""
        }`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка смены статуса";
      if (
        admin &&
        !force &&
        (next === "submitted" || next === "accepted") &&
        /неполон|не все формы/i.test(msg) &&
        confirm(`${msg}\n\nВсё равно сменить статус (force)?`)
      ) {
        setBusy(false);
        await handleWorkflow(next, true);
        return;
      }
      setStatus(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleClosePeriod = async () => {
    if (zid === "" || eid === "") return;
    if (
      !confirm(
        "Закрыть период? После закрытия формы комплекта нельзя будет редактировать."
      )
    ) {
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      await closePeriod(zid, eid);
      setPeriods(await listPeriods(zid));
      setStatus("Период закрыт");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка закрытия периода");
    } finally {
      setBusy(false);
    }
  };

  const handleReopenPeriod = async () => {
    if (zid === "" || eid === "") return;
    if (!confirm("Переоткрыть закрытый период? Изменения снова будут возможны.")) {
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      await reopenPeriod(zid, eid);
      setPeriods(await listPeriods(zid));
      setStatus("Период переоткрыт");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка переоткрытия");
    } finally {
      setBusy(false);
    }
  };

  const handleDistribute = async () => {
    if (zid === "" || eid === "") return;
    const hasChildren = childOrgs.length > 0;
    const others = orgs.filter((o) => o.zid !== zid).length;
    const useFallback = !hasChildren;
    if (useFallback && others === 0) {
      setStatus(
        "Некому раздавать: создайте дочерние организации (с родителем) или другие org"
      );
      return;
    }
    const msg = hasChildren
      ? `Создать такие же периоды и пустые комплекты у ${childOrgs.length} дочерних org?`
      : `У текущей org нет дочерних (parent_zid). Раздать всем остальным организациям (${others})?`;
    if (!confirm(msg)) return;
    setBusy(true);
    setStatus("");
    try {
      const res = await distributePackagesToChildren({
        parentZid: zid,
        sourceEid: eid,
        fallbackAllOthers: useFallback,
      });
      setStatus(
        `Раздано: периодов ${res.createdPeriods}, комплектов ${res.createdPackages}` +
          (res.children.length
            ? ` → ${res.children.map((c) => c.name).join(", ")}`
            : "")
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка раздачи");
    } finally {
      setBusy(false);
    }
  };

  const periodClosed = selectedPeriod?.periodStatus === "closed";
  const wf = completeness?.workflow?.status ?? "draft";
  const workflowActions = useMemo(() => {
    if (periodClosed) return [];
    const all: Array<{ status: PackageWorkflowStatus; label: string; adminOnly?: boolean }> = [
      { status: "submitted", label: "Сдать на проверку" },
      { status: "returned", label: "Вернуть", adminOnly: true },
      { status: "corrected", label: "Исправлен" },
      { status: "accepted", label: "Принять", adminOnly: true },
      { status: "draft", label: "В черновик" },
    ];
    const allowed: Record<string, PackageWorkflowStatus[]> = {
      draft: ["submitted"],
      submitted: ["returned", "accepted"],
      returned: ["corrected", "draft"],
      corrected: ["submitted"],
      accepted: ["returned"],
    };
    return all.filter(
      (a) =>
        (allowed[wf] ?? []).includes(a.status) && (admin || !a.adminOnly)
    );
  }, [wf, admin, periodClosed]);

  const missing = completeness?.items.filter((i) => !i.filled) ?? [];

  if (loading) {
    return <div className="loading">Загрузка комплекта отчётности…</div>;
  }

  return (
    <div className="package-page">
      <h1>Комплект отчётности</h1>
      <p className="tools-intro">
        Как в Access: выберите организацию и период, затем заведите пустые формы на весь
        каталог (76 шаблонов). Новые формы из каталога привязываются к текущей организации и периоду.
      </p>

      {status && <div className="status-bar">{status}</div>}

      <section className="tools-section">
        <h2>Рабочий контекст</h2>
        <div className="tools-grid">
          <label>
            Организация
            <select
              value={zid}
              disabled={!admin && orgs.length <= 1}
              onChange={(e) => void handleZidChange(Number(e.target.value))}
            >
              <option value="">— выберите —</option>
              {orgs.map((o) => (
                <option key={o.zid} value={o.zid}>
                  {o.name} (код {o.zid})
                </option>
              ))}
            </select>
          </label>
          <label>
            Период
            <select
              value={eid}
              disabled={zid === ""}
              onChange={(e) => void handleEidChange(Number(e.target.value))}
            >
              <option value="">— выберите —</option>
              {periods.map((p) => (
                <option key={p.eid} value={p.eid}>
                  {p.name} (код {p.eid}
                  {p.packageKind ? `, ${p.packageKind}` : ""})
                </option>
              ))}
            </select>
          </label>
        </div>
        {selectedOrg && selectedPeriod && (
          <p className="tools-hint">
            {selectedOrg.name} ·{" "}
            {formatPeriod(
              selectedPeriod.periodStart ?? "",
              selectedPeriod.periodEnd ?? ""
            )}
            {" · "}
            Тип комплекта:{" "}
            <strong>{selectedPeriod.packageKind ?? "OKO"}</strong>
            {" · "}
            Период:{" "}
            <strong>
              {selectedPeriod.periodStatus === "closed" ? "закрыт" : "открыт"}
            </strong>
            {selectedPeriod.formSetCount != null
              ? ` · форм в комплекте: ${selectedPeriod.formSetCount}`
              : ""}
            {selectedPeriod.methodologyReleaseId
              ? ` · методология: ${selectedPeriod.methodologyReleaseId.slice(0, 8)}…`
              : ""}
          </p>
        )}
      </section>

      {backend && typeof zid === "number" && typeof eid === "number" && (
        <section className="tools-section">
          <h2>Бизнес-процесс</h2>
          {auditorRo && (
            <p className="tools-hint">
              Режим аудитора: <strong>только чтение</strong>
            </p>
          )}
          {bp ? (
            <>
              <p className="tools-hint">
                Статус: <strong>{BP_STATUS_LABEL[bp.status]}</strong>
                {" · "}
                Тип: <strong>{bp.packageKind}</strong>
                {" · "}
                Итерация: {bp.iteration}
                {bp.curatorName || bp.curatorUserId != null
                  ? ` · куратор: ${bp.curatorName ?? bp.curatorUserId}`
                  : ""}
                {bp.lastChangedAt
                  ? ` · изменён ${bp.lastChangedAt}${
                      bp.lastChangedBy ? ` (${bp.lastChangedBy})` : ""
                    }`
                  : ""}
              </p>
              {bpBlockers?.blocked && (
                <p className="error">
                  Согласование заблокировано — нет объяснений:{" "}
                  {bpBlockers.missingExplanations
                    .map((m) => `#${m.ruleNumber}`)
                    .join(", ")}
                  .{" "}
                  <Link to="/check-explanations">Объяснения проверок</Link>
                </p>
              )}
              <div className="toolbar-actions" style={{ marginBottom: "0.75rem" }}>
                {bpActions.map((a) => (
                  <button
                    key={a.action}
                    type="button"
                    className="btn btn-secondary"
                    disabled={bpBusy || !canMutate}
                    onClick={() => void handleBpAction(a.action)}
                  >
                    {a.label}
                  </button>
                ))}
                <Link to="/bp" className="btn btn-secondary">
                  Мониторинг БП
                </Link>
              </div>
            </>
          ) : (
            <p className="tools-hint">
              БП не загружен.{" "}
              <Link to="/bp">Открыть мониторинг БП</Link>
            </p>
          )}
        </section>
      )}

      {admin && canMutate && (
        <section className="tools-section">
          <h2>Добавить организацию</h2>
          <div className="tools-grid">
            <label>
              Наименование
              <input
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="ПАО «Газпром»"
              />
            </label>
            <label>
              Головная (parent)
              <select
                value={newOrgParentZid}
                onChange={(e) =>
                  setNewOrgParentZid(
                    e.target.value === "" ? "" : Number(e.target.value)
                  )
                }
              >
                <option value="">— нет (корневая) —</option>
                {orgs.map((o) => (
                  <option key={o.zid} value={o.zid}>
                    {o.name} (Z{o.zid})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="tools-hint">
            Для «Раздать дочкам» укажите головную org у дочерних. Сейчас дочерних у
            выбранной: <strong>{childOrgs.length}</strong>
            {childOrgs.length > 0
              ? ` (${childOrgs.map((c) => c.name).join(", ")})`
              : ""}
            .
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || !newOrgName.trim()}
            onClick={() => void handleCreateOrg()}
          >
            Создать организацию
          </button>
        </section>
      )}

      {admin && canMutate && (
        <section className="tools-section">
          <h2>Добавить период</h2>
          <div className="tools-grid">
            <label>
              Название периода
              <input
                value={newPeriodName}
                onChange={(e) => setNewPeriodName(e.target.value)}
                placeholder="1 квартал 2026"
                disabled={zid === ""}
              />
            </label>
            <label>
              Тип комплекта
              <select
                value={newPackageKind}
                onChange={(e) => setNewPackageKind(e.target.value as PackageKind)}
                disabled={zid === ""}
              >
                <option value="OKO">OKO</option>
                <option value="BALANCE">BALANCE</option>
              </select>
            </label>
            <label>
              Начало
              <input
                type="date"
                value={newPeriodStart}
                onChange={(e) => setNewPeriodStart(e.target.value)}
                disabled={zid === ""}
              />
            </label>
            <label>
              Конец
              <input
                type="date"
                value={newPeriodEnd}
                onChange={(e) => setNewPeriodEnd(e.target.value)}
                disabled={zid === ""}
              />
            </label>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || zid === "" || !newPeriodName.trim() || !canMutate}
            onClick={() => void handleCreatePeriod()}
          >
            Создать период
          </button>
        </section>
      )}

      {completeness && (
        <section className="tools-section">
          <h2>
            Полнота комплекта{" "}
            <span className="cat-count">
              {completeness.filled}/{completeness.total}
            </span>
          </h2>
          <p className="tools-hint">
            Черновики форм: <strong>{completeness.draft}</strong> · Сдано форм:{" "}
            <strong>{completeness.submitted}</strong>
            {" · "}
            Статус комплекта:{" "}
            <strong>{packageWorkflowLabel(completeness.workflow?.status)}</strong>
            {completeness.workflow?.comment ? ` — ${completeness.workflow.comment}` : ""}
          </p>
          {completeness.draft > 0 && completeness.workflow?.status === "draft" && (
            <p className="tools-hint">
              «Сдать на проверку» отправит комплект ЦО. Принять комплект можно будет после
              того, как все формы будут сданы отдельно («Сдать форму» в карточке формы).
            </p>
          )}
          <div className="tools-grid" style={{ marginBottom: "0.75rem" }}>
            <label>
              Комментарий к статусу
              <input
                value={workflowComment}
                onChange={(e) => setWorkflowComment(e.target.value)}
                placeholder="Необязательно"
              />
            </label>
          </div>
          {workflowActions.length > 0 && (
            <div className="toolbar-actions" style={{ marginBottom: "0.75rem" }}>
              {workflowActions.map((a) => (
                <button
                  key={a.status}
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy || !canMutate}
                  onClick={() => void handleWorkflow(a.status)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
          <div className="completeness-bar">
            <div
              className="completeness-fill"
              style={{
                width: `${(completeness.filled / completeness.total) * 100}%`,
              }}
            />
          </div>
          <div className="toolbar-actions" style={{ margin: "0.75rem 0" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || zid === "" || eid === "" || periodClosed || !canMutate}
              onClick={() => void handleCreatePackage()}
            >
              {busy ? "Создание…" : "Завести пустые формы (комплект)"}
            </button>
            {admin && canMutate && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy || zid === "" || eid === "" || periodClosed}
                onClick={() => void handleDistribute()}
                title={
                  childOrgs.length > 0
                    ? `Дочерних: ${childOrgs.length}`
                    : "Нет дочерних — предложит раздать всем остальным org"
                }
              >
                Раздать дочкам
                {childOrgs.length > 0 ? ` (${childOrgs.length})` : ""}
              </button>
            )}
            {admin && canMutate && !periodClosed && wf === "accepted" && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy || zid === "" || eid === ""}
                onClick={() => void handleClosePeriod()}
              >
                Закрыть период
              </button>
            )}
            {admin && canMutate && periodClosed && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy || zid === "" || eid === ""}
                onClick={() => void handleReopenPeriod()}
              >
                Переоткрыть период
              </button>
            )}
            {canDeletePackage && canMutate && !periodClosed && (
              <button
                type="button"
                className="btn btn-danger-outline"
                disabled={busy || zid === "" || eid === ""}
                onClick={() => void handleDeletePackage()}
              >
                {busy ? "Удаление…" : "Удалить комплект"}
              </button>
            )}
            <Link to="/my" className="btn btn-secondary">
              {formsLinkLabel}
            </Link>
          </div>
          {completeness.items.filter((i) => i.filled).length > 0 && (
            <details className="missing-forms">
              <summary>
                Заведено ({completeness.filled}) — черновики {completeness.draft}, сдано{" "}
                {completeness.submitted}
              </summary>
              <ul>
                {completeness.items
                  .filter((i) => i.filled)
                  .map((f) => (
                    <li key={f.formId}>
                      {f.instanceId ? (
                        <Link to={`/my/${f.instanceId}`}>{f.formId}</Link>
                      ) : (
                        f.formId
                      )}{" "}
                      — {f.title}{" "}
                      <span className={`status-badge ${f.status ?? "draft"}`}>
                        {formStatusLabel(f.status)}
                      </span>
                    </li>
                  ))}
              </ul>
            </details>
          )}
          {missing.length > 0 && (
            <details className="missing-forms">
              <summary>Не заведено ({missing.length})</summary>
              <ul>
                {missing.map((f) => (
                  <li key={f.formId}>
                    <Link to="/catalog">{f.formId}</Link> — {f.title}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
