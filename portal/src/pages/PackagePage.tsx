import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
import type {
  Organization,
  PackageCompleteness,
  PackageWorkflowStatus,
  ReportingPeriod,
} from "../types";
import { formatPeriod, formStatusLabel, packageWorkflowLabel } from "../utils";
import { useAuth } from "../useAuth";
import { formsListNavLabel } from "../formsListLabels";

export function PackagePage() {
  const auth = useAuth();
  const admin = !auth.authRequired || auth.role === "admin";
  const orgZid = auth.user?.role === "org" ? auth.user.zid ?? null : null;
  const formsLinkLabel = formsListNavLabel(auth);
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
  const [workflowComment, setWorkflowComment] = useState("");

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
    setCompleteness(await fetchPackageCompleteness(z, e));
  }, []);

  const refreshPeriods = useCallback(async (orgZid: number) => {
    setPeriods(await listPeriods(orgZid));
  }, []);

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
        const initialEid: number | "" =
          Number.isFinite(paramEid) && paramEid > 0
            ? paramEid
            : ctx.eid ?? perList[0]?.eid ?? "";
        setEid(initialEid);
        if (typeof initialEid === "number") {
          await refreshCompleteness(initialZid, initialEid);
        }
      }
      setLoading(false);
    })();
  }, [refreshCompleteness, searchParams]);

  const handleZidChange = async (value: number) => {
    setZid(value);
    setEid("");
    setCompleteness(null);
    await refreshPeriods(value);
    const perList = await listPeriods(value);
    if (perList[0]) {
      setEid(perList[0].eid);
      await saveWorkContext({ zid: value, eid: perList[0].eid });
      await refreshCompleteness(value, perList[0].eid);
    } else {
      await saveWorkContext({ zid: value, eid: null });
    }
  };

  const handleEidChange = async (value: number) => {
    setEid(value);
    if (zid !== "") {
      await saveWorkContext({ zid, eid: value });
      await refreshCompleteness(zid, value);
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
    if (zid === "" || !newPeriodName.trim()) return;
    setBusy(true);
    setStatus("");
    try {
      const period = await createPeriod({
        zid,
        name: newPeriodName.trim(),
        periodStart: newPeriodStart || undefined,
        periodEnd: newPeriodEnd || undefined,
      });
      await refreshPeriods(zid);
      setNewPeriodName("");
      setNewPeriodStart("");
      setNewPeriodEnd("");
      await handleEidChange(period.eid);
      setStatus(`Период «${period.name}» создан (код ${period.eid})`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка создания периода");
    } finally {
      setBusy(false);
    }
  };

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
                  {p.name} (код {p.eid})
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

      {admin && (
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

      {admin && (
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
            disabled={busy || zid === "" || !newPeriodName.trim()}
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
                  disabled={busy}
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
              disabled={busy || zid === "" || eid === "" || periodClosed}
              onClick={() => void handleCreatePackage()}
            >
              {busy ? "Создание…" : "Завести пустые формы (комплект)"}
            </button>
            {admin && (
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
            {admin && !periodClosed && wf === "accepted" && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy || zid === "" || eid === ""}
                onClick={() => void handleClosePeriod()}
              >
                Закрыть период
              </button>
            )}
            {admin && periodClosed && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy || zid === "" || eid === ""}
                onClick={() => void handleReopenPeriod()}
              >
                Переоткрыть период
              </button>
            )}
            {canDeletePackage && !periodClosed && (
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
