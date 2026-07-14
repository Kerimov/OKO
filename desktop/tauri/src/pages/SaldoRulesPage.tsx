import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadFormCorrespondence, loadSaldoRules } from "@portal/api";
import { ruleMatchesSaldoType } from "@oko/engine";

interface SaldoRuleRow {
  number: number;
  targetForm: string;
  targetColumn: string;
  targetRow: number | null;
  sourceForm: string | null;
  sourceColumn: string | null;
  sourceRow: number | null;
  endForm?: string | null;
  endColumn?: string | null;
  endRow?: number | null;
  saldoT: boolean;
  saldoS: boolean;
  saldoG: boolean;
  name?: string | null;
}

interface CorrRow {
  formId: string;
  saldoYellow?: string | null;
  saldoRed?: string | null;
  saldoBlue?: string | null;
  saldoGreen?: string | null;
}

export function SaldoRulesPage() {
  const [rules, setRules] = useState<SaldoRuleRow[]>([]);
  const [corr, setCorr] = useState<CorrRow[]>([]);
  const [formFilter, setFormFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "t" | "s" | "g">("");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void Promise.all([loadSaldoRules(), loadFormCorrespondence()])
      .then(([saldo, correspondence]) => {
        setRules(((saldo as { rules?: SaldoRuleRow[] }).rules ?? []) as SaldoRuleRow[]);
        setCorr(((correspondence as { forms?: CorrRow[] }).forms ?? []) as CorrRow[]);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const form = formFilter.trim().toLowerCase();
    return rules.filter((r) => {
      if (typeFilter && !ruleMatchesSaldoType(r, typeFilter)) return false;
      if (form) {
        const hit =
          (r.targetForm ?? "").toLowerCase().includes(form) ||
          (r.sourceForm ?? "").toLowerCase().includes(form) ||
          (r.endForm ?? "").toLowerCase().includes(form);
        if (!hit) return false;
      }
      if (!needle) return true;
      const blob = [
        r.number,
        r.targetForm,
        r.targetColumn,
        r.targetRow,
        r.sourceForm,
        r.sourceColumn,
        r.sourceRow,
        r.name,
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(needle);
    });
  }, [rules, formFilter, typeFilter, q]);

  const corrForForm = useMemo(() => {
    const f = formFilter.trim().toLowerCase();
    if (!f) return null;
    return corr.find((c) => (c.formId ?? "").toLowerCase() === f) ?? null;
  }, [corr, formFilter]);

  return (
    <div className="content">
      <header className="page-header compact">
        <div>
          <p className="muted" style={{ marginBottom: "0.35rem" }}>
            <Link to="/package">← Комплект</Link>
            {" · "}
            <Link to="/help">Справка</Link>
          </p>
          <h1>Правила переноса сальдо</h1>
          <p className="muted">
            Просмотр bundled `saldo-rules.json` / соответствия форм (как F1 в Access). Правка
            правил — на портале `/admin/saldo`.
          </p>
        </div>
      </header>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Загрузка…</p>}

      <div
        className="toolbar-actions"
        style={{ flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}
      >
        <input
          type="search"
          placeholder="Поиск…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Поиск по правилам"
        />
        <input
          type="text"
          placeholder="Форма (N01…)"
          value={formFilter}
          onChange={(e) => setFormFilter(e.target.value)}
          aria-label="Фильтр по форме"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as "" | "t" | "s" | "g")}
          aria-label="Тип сальдо"
        >
          <option value="">Все типы</option>
          <option value="t">T</option>
          <option value="s">S</option>
          <option value="g">G</option>
        </select>
        <span className="muted">
          {filtered.length} / {rules.length}
        </span>
      </div>

      {corrForForm && (
        <section className="package-saldo-panel" style={{ marginBottom: "1rem" }}>
          <h2>Соответствие формы {corrForForm.formId}</h2>
          <p className="muted" style={{ margin: 0 }}>
            Yellow: {corrForForm.saldoYellow ?? "—"} · Red: {corrForForm.saldoRed ?? "—"} · Blue:{" "}
            {corrForForm.saldoBlue ?? "—"} · Green: {corrForForm.saldoGreen ?? "—"}
          </p>
        </section>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Цель</th>
              <th>Источник</th>
              <th>Конец</th>
              <th>T/S/G</th>
              <th>Имя</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map((r) => (
              <tr key={r.number}>
                <td>{r.number}</td>
                <td>
                  {r.targetForm}.{r.targetColumn}
                  {r.targetRow != null ? `[${r.targetRow}]` : ""}
                </td>
                <td>
                  {r.sourceForm ?? "—"}
                  {r.sourceColumn ? `.${r.sourceColumn}` : ""}
                  {r.sourceRow != null ? `[${r.sourceRow}]` : ""}
                </td>
                <td>
                  {r.endForm ?? "—"}
                  {r.endColumn ? `.${r.endColumn}` : ""}
                  {r.endRow != null ? `[${r.endRow}]` : ""}
                </td>
                <td>
                  {[r.saldoT && "T", r.saldoS && "S", r.saldoG && "G"].filter(Boolean).join("") ||
                    "—"}
                </td>
                <td>{r.name ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 500 && (
          <p className="muted">Показаны первые 500 — уточните фильтр.</p>
        )}
      </div>
    </div>
  );
}
