import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { canMutateData } from "../auth";
import {
  getCheckApprovalBlockers,
  listCheckExplanations,
  listCheckJournal,
  upsertCheckExplanation,
  type ApprovalBlockers,
  type CheckExplanationDto,
  type CheckJournalEntryDto,
  type PackageKind,
} from "../psdApi";
import { apiFetch } from "../apiClient";
import { isBackendMode } from "../storage";
import { loadWorkContext, listOrganizations, listPeriods } from "../packagesApi";
import type { Organization, ReportingPeriod } from "../types";
import type { IdOrEmpty } from "../components/OrgPeriodSelects";
import {
  checkRunSummary,
  orgOptionLabel,
  packageKindLabel,
  periodOptionLabel,
} from "../uiLabels";

export function CheckExplanationsPage() {
  const [searchParams] = useSearchParams();
  const backend = isBackendMode();
  const canMutate = canMutateData();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [periods, setPeriods] = useState<ReportingPeriod[]>([]);
  const [zid, setZid] = useState<IdOrEmpty>("");
  const [eid, setEid] = useState<IdOrEmpty>("");
  const [packageKind, setPackageKind] = useState<PackageKind>("OKO");
  const [blockers, setBlockers] = useState<ApprovalBlockers | null>(null);
  const [explanations, setExplanations] = useState<CheckExplanationDto[]>([]);
  const [failures, setFailures] = useState<CheckJournalEntryDto[]>([]);
  const [ruleNumber, setRuleNumber] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!backend) return;
    void (async () => {
      try {
        const [orgList, ctx] = await Promise.all([
          listOrganizations(),
          loadWorkContext().catch(() => ({ zid: null, eid: null })),
        ]);
        setOrgs(orgList);
        const qZid = searchParams.get("zid");
        const qEid = searchParams.get("eid");
        const initialZid = qZid
          ? Number(qZid)
          : ctx.zid != null && orgList.some((o) => o.zid === ctx.zid)
            ? ctx.zid
            : orgList[0]?.zid ?? "";
        setZid(typeof initialZid === "number" && Number.isFinite(initialZid) ? initialZid : "");
        if (typeof initialZid === "number" && Number.isFinite(initialZid)) {
          const perList = await listPeriods(initialZid);
          setPeriods(perList);
          const initialEid = qEid
            ? Number(qEid)
            : ctx.eid != null && perList.some((p) => p.eid === ctx.eid)
              ? ctx.eid
              : perList[0]?.eid ?? "";
          setEid(
            typeof initialEid === "number" && Number.isFinite(initialEid) ? initialEid : ""
          );
        }
        if (searchParams.get("packageKind") === "BALANCE") setPackageKind("BALANCE");
      } catch {
        /* ignore */
      }
    })();
  }, [backend, searchParams]);

  const onOrgChange = async (raw: string) => {
    const next = raw === "" ? "" : Number(raw);
    setZid(next);
    setEid("");
    setPeriods([]);
    if (typeof next === "number") {
      try {
        const list = await listPeriods(next);
        setPeriods(list);
        if (list[0]) setEid(list[0].eid);
      } catch {
        /* ignore */
      }
    }
  };

  const load = useCallback(async () => {
    if (typeof zid !== "number" || typeof eid !== "number") {
      setError("Выберите организацию и период");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [b, expl, journal] = await Promise.all([
        getCheckApprovalBlockers(zid, eid, packageKind),
        listCheckExplanations(zid, eid, packageKind),
        listCheckJournal({ zid, eid, packageKind }),
      ]);
      setBlockers(b);
      setExplanations(expl);
      setFailures(journal.filter((j) => !j.passed));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [zid, eid, packageKind]);

  useEffect(() => {
    if (backend && typeof zid === "number" && typeof eid === "number") void load();
  }, [backend, zid, eid, packageKind, load]);

  const failedRules = useMemo(() => {
    const seen = new Set<number>();
    const rows: Array<{ ruleNumber: number; message: string | null }> = [];
    for (const f of failures) {
      if (f.ruleNumber == null || seen.has(f.ruleNumber)) continue;
      seen.add(f.ruleNumber);
      rows.push({ ruleNumber: f.ruleNumber, message: f.message });
    }
    return rows;
  }, [failures]);

  const handleSave = async () => {
    if (!canMutate) return;
    if (typeof zid !== "number" || typeof eid !== "number") {
      setError("Выберите организацию и период");
      return;
    }
    const rn = Number(ruleNumber);
    if (!Number.isFinite(rn) || !text.trim()) {
      setError("Укажите правило и текст объяснения");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await upsertCheckExplanation({
        zid,
        eid,
        packageKind,
        ruleNumber: rn,
        explanation: text.trim(),
      });
      setText("");
      setStatus(`Объяснение для правила #${rn} сохранено`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  };

  if (!backend) {
    return <p className="hint">Объяснения проверок доступны только в backend-режиме.</p>;
  }

  return (
    <div className="page">
      <h1>Объяснения проверок</h1>
      <p className="hint">
        Блокеры согласования и журнал неуспешных проверок по комплекту. Без объяснения куратор не
        сможет согласовать БП.
      </p>
      {error && <p className="error">{error}</p>}
      {status && <p className="ok">{status}</p>}

      <section className="tools-section">
        <div className="tools-grid">
          <label>
            Организация
            <select
              value={zid === "" ? "" : String(zid)}
              onChange={(e) => void onOrgChange(e.target.value)}
            >
              <option value="">— выберите —</option>
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
              value={eid === "" ? "" : String(eid)}
              disabled={typeof zid !== "number"}
              onChange={(e) => setEid(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">— выберите —</option>
              {periods.map((p) => (
                <option key={p.eid} value={p.eid}>
                  {periodOptionLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Тип комплекта
            <select
              value={packageKind}
              onChange={(e) => setPackageKind(e.target.value as PackageKind)}
            >
              <option value="OKO">{packageKindLabel("OKO")}</option>
              <option value="BALANCE">{packageKindLabel("BALANCE")}</option>
            </select>
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? "Загрузка…" : "Обновить"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || loading || !canMutate}
            onClick={async () => {
              if (typeof zid !== "number" || typeof eid !== "number") {
                setError("Выберите организацию и период");
                return;
              }
              setBusy(true);
              setError("");
              try {
                const res = await apiFetch<{
                  runId: string;
                  passed: number;
                  failed: number;
                }>("/api/psd-checks/package-run", {
                  method: "POST",
                  body: JSON.stringify({ zid, eid, packageKind }),
                });
                setStatus(
                  checkRunSummary({
                    passed: res.passed,
                    failed: res.failed,
                    runId: res.runId,
                  })
                );
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Не удалось выполнить проверки");
              } finally {
                setBusy(false);
              }
            }}
          >
            Выполнить проверки
          </button>
        </div>
      </section>

      <section className="tools-section">
        <h2>Блокеры согласования</h2>
        {!blockers && <p className="tools-hint">Загрузите данные</p>}
        {blockers && !blockers.blocked && (
          <p className="ok">Блокеров нет — согласование разрешено</p>
        )}
        {blockers?.blocked && (
          <ul>
            {blockers.missingExplanations.map((m) => (
              <li key={`${m.ruleNumber}-${m.formId ?? ""}`}>
                Правило #{m.ruleNumber}
                {m.message ? ` — ${m.message}` : ""}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ marginLeft: 8 }}
                  onClick={() => setRuleNumber(String(m.ruleNumber))}
                >
                  Объяснить
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="tools-section">
        <h2>Неуспешные проверки (журнал)</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Правило</th>
              <th>Сообщение</th>
              <th>Форма</th>
              <th>Требует объяснения</th>
            </tr>
          </thead>
          <tbody>
            {failedRules.map((f) => (
              <tr key={f.ruleNumber}>
                <td>#{f.ruleNumber}</td>
                <td>{f.message ?? "—"}</td>
                <td>
                  {failures.find((j) => j.ruleNumber === f.ruleNumber)?.formId ?? "—"}
                </td>
                <td>
                  {failures.find((j) => j.ruleNumber === f.ruleNumber)?.requiresExplanation
                    ? "да"
                    : "нет"}
                </td>
              </tr>
            ))}
            {!failedRules.length && (
              <tr>
                <td colSpan={4}>Нет неуспешных проверок</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="tools-section">
        <h2>Сохранённые объяснения</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Правило</th>
              <th>Текст</th>
              <th>Автор</th>
              <th>Обновлено</th>
            </tr>
          </thead>
          <tbody>
            {explanations.map((ex) => (
              <tr key={ex.id}>
                <td>#{ex.ruleNumber}</td>
                <td>{ex.explanation}</td>
                <td>{ex.author ?? "—"}</td>
                <td>{ex.updatedAt}</td>
              </tr>
            ))}
            {!explanations.length && (
              <tr>
                <td colSpan={4}>Пока нет объяснений</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {canMutate && (
        <section className="tools-section">
          <h2>Добавить объяснение</h2>
          <div className="tools-grid">
            <label>
              Номер правила
              {failedRules.length > 0 ? (
                <select value={ruleNumber} onChange={(e) => setRuleNumber(e.target.value)}>
                  <option value="">— выберите —</option>
                  {failedRules.map((f) => (
                    <option key={f.ruleNumber} value={f.ruleNumber}>
                      #{f.ruleNumber}
                      {f.message ? ` — ${f.message.slice(0, 80)}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={ruleNumber}
                  onChange={(e) => setRuleNumber(e.target.value)}
                  inputMode="numeric"
                  placeholder="Нет failed-правил — введите номер"
                />
              )}
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Текст
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                style={{ width: "100%" }}
              />
            </label>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void handleSave()}
          >
            Сохранить
          </button>
        </section>
      )}
    </div>
  );
}
