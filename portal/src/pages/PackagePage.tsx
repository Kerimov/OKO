import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  createOrganization,
  createPeriod,
  createReportPackage,
  deleteReportPackage,
  fetchPackageCompleteness,
  listOrganizations,
  listPeriods,
  loadWorkContext,
  saveWorkContext,
} from "../packagesApi";
import type { Organization, PackageCompleteness, ReportingPeriod } from "../types";
import { formatPeriod, formStatusLabel } from "../utils";
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
  const [newPeriodName, setNewPeriodName] = useState("");
  const [newPeriodStart, setNewPeriodStart] = useState("");
  const [newPeriodEnd, setNewPeriodEnd] = useState("");

  const selectedOrg = useMemo(
    () => orgs.find((o) => o.zid === zid),
    [orgs, zid]
  );
  const selectedPeriod = useMemo(
    () => periods.find((p) => p.eid === eid),
    [periods, eid]
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
      const org = await createOrganization({ name: newOrgName.trim() });
      const next = [...orgs, org].sort((a, b) => a.name.localeCompare(b.name, "ru"));
      setOrgs(next);
      setNewOrgName("");
      await handleZidChange(org.zid);
      setStatus(`Организация «${org.name}» создана (ZID=${org.zid})`);
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
      setStatus(`Период «${period.name}» создан (EID=${period.eid})`);
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

  const missing = completeness?.items.filter((i) => !i.filled) ?? [];

  if (loading) {
    return <div className="loading">Загрузка комплекта отчётности…</div>;
  }

  return (
    <div className="package-page">
      <h1>Комплект отчётности (ZID / EID)</h1>
      <p className="tools-intro">
        Как в Access: выберите организацию и период, затем заведите пустые формы на весь
        каталог (76 шаблонов). Новые формы из каталога привязываются к текущему ZID+EID.
      </p>

      {status && <div className="status-bar">{status}</div>}

      <section className="tools-section">
        <h2>Рабочий контекст</h2>
        <div className="tools-grid">
          <label>
            Организация (ZID)
            <select
              value={zid}
              disabled={!admin && orgs.length <= 1}
              onChange={(e) => void handleZidChange(Number(e.target.value))}
            >
              <option value="">— выберите —</option>
              {orgs.map((o) => (
                <option key={o.zid} value={o.zid}>
                  {o.name} (ZID={o.zid})
                </option>
              ))}
            </select>
          </label>
          <label>
            Период (EID)
            <select
              value={eid}
              disabled={zid === ""}
              onChange={(e) => void handleEidChange(Number(e.target.value))}
            >
              <option value="">— выберите —</option>
              {periods.map((p) => (
                <option key={p.eid} value={p.eid}>
                  {p.name} (EID={p.eid})
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
          </div>
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
            Черновики: <strong>{completeness.draft}</strong> · Сдано:{" "}
            <strong>{completeness.submitted}</strong>
          </p>
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
              disabled={busy || zid === "" || eid === ""}
              onClick={() => void handleCreatePackage()}
            >
              {busy ? "Создание…" : "Завести пустые формы (комплект)"}
            </button>
            {canDeletePackage && (
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
