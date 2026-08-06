import { useCallback, useEffect, useMemo, useState } from "react";
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
import { loadWorkContext } from "../packagesApi";

export function CheckExplanationsPage() {
  const backend = isBackendMode();
  const canMutate = canMutateData();
  const [zid, setZid] = useState("");
  const [eid, setEid] = useState("");
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
        const ctx = await loadWorkContext();
        if (ctx.zid != null) setZid(String(ctx.zid));
        if (ctx.eid != null) setEid(String(ctx.eid));
      } catch {
        /* ignore */
      }
    })();
  }, [backend]);

  const load = useCallback(async () => {
    const z = Number(zid);
    const e = Number(eid);
    if (!Number.isFinite(z) || !Number.isFinite(e)) {
      setError("Укажите zid и eid");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [b, expl, journal] = await Promise.all([
        getCheckApprovalBlockers(z, e, packageKind),
        listCheckExplanations(z, e, packageKind),
        listCheckJournal({ zid: z, eid: e, packageKind }),
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
    if (backend && zid && eid) void load();
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
    const z = Number(zid);
    const e = Number(eid);
    const rn = Number(ruleNumber);
    if (!Number.isFinite(z) || !Number.isFinite(e) || !Number.isFinite(rn) || !text.trim()) {
      setError("Укажите правило и текст объяснения");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await upsertCheckExplanation({
        zid: z,
        eid: e,
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
            ZID
            <input value={zid} onChange={(e) => setZid(e.target.value)} />
          </label>
          <label>
            EID
            <input value={eid} onChange={(e) => setEid(e.target.value)} />
          </label>
          <label>
            Тип
            <select
              value={packageKind}
              onChange={(e) => setPackageKind(e.target.value as PackageKind)}
            >
              <option value="OKO">OKO</option>
              <option value="BALANCE">BALANCE</option>
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
              const z = Number(zid);
              const e = Number(eid);
              if (!Number.isFinite(z) || !Number.isFinite(e)) {
                setError("Укажите zid и eid");
                return;
              }
              setBusy(true);
              setError("");
              try {
                const res = await apiFetch<{
                  runId: string;
                  passed: number;
                  failed: number;
                }>("/api/psd-checks/dsl/run", {
                  method: "POST",
                  body: JSON.stringify({ zid: z, eid: e, packageKind }),
                });
                setStatus(
                  `DSL-прогон ${res.runId}: passed=${res.passed}, failed=${res.failed}`
                );
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Ошибка DSL");
              } finally {
                setBusy(false);
              }
            }}
          >
            Прогон DSL
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
              <input
                value={ruleNumber}
                onChange={(e) => setRuleNumber(e.target.value)}
                inputMode="numeric"
              />
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
