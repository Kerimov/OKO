import { useEffect, useState } from "react";
import { canMutateData, getCurrentUser } from "../auth";
import { downloadMinfinExport, exportMinfin } from "../psdApi";
import { apiFetch } from "../apiClient";
import { isBackendMode } from "../storage";

interface ReportPreset {
  code: string;
  nameRu: string;
  nameEn: string | null;
  description: string | null;
}

interface ReportResult {
  code: string;
  title: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

export function PsdReportsPage() {
  const backend = isBackendMode();
  const canMutate = canMutateData();
  const locale = getCurrentUser()?.locale === "en" ? "en" : "ru";
  const [presets, setPresets] = useState<ReportPreset[]>([]);
  const [code, setCode] = useState("package_summary");
  const [zid, setZid] = useState("");
  const [eid, setEid] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [table, setTable] = useState<ReportResult | null>(null);

  useEffect(() => {
    if (!backend) return;
    apiFetch<ReportPreset[]>("/api/support-reports/presets")
      .then((list) => {
        setPresets(list);
        if (list[0]) setCode(list[0].code);
      })
      .catch(() => undefined);
  }, [backend]);

  const runPreset = async () => {
    setBusy(true);
    setError("");
    setTable(null);
    setResult("");
    try {
      const res = await apiFetch<ReportResult>("/api/support-reports/run", {
        method: "POST",
        body: JSON.stringify({
          code,
          zid: zid ? Number(zid) : undefined,
          eid: eid ? Number(eid) : undefined,
          locale,
        }),
      });
      setTable(res);
      setResult(`${res.title}: ${res.rows.length} строк`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка отчёта");
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    if (!canMutate) return;
    const z = Number(zid);
    const e = Number(eid);
    if (!Number.isFinite(z) || !Number.isFinite(e) || !templateName.trim()) {
      setError("Укажите zid, eid и название шаблона МинФин");
      return;
    }
    setBusy(true);
    setError("");
    setResult("");
    try {
      const res = await exportMinfin({
        zid: z,
        eid: e,
        templateName: templateName.trim() || "default",
      });
      if (res.ok && downloadMinfinExport(res)) {
        setResult(`Скачан ${res.filename ?? "minfin.xlsx"} · ${res.message ?? ""}`);
      } else {
        setResult(
          `${res.code ?? (res.ok ? "ok" : "ошибка")}: ${res.message ?? ""}` +
            (res.mappingCount != null ? ` · маппингов: ${res.mappingCount}` : "")
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка экспорта");
    } finally {
      setBusy(false);
    }
  };

  if (!backend) {
    return <p className="hint">Отчёты ПСД доступны только в backend-режиме.</p>;
  }

  return (
    <div className="page">
      <h1>Отчёты ПСД</h1>
      <p className="hint">
        Безопасные предустановки для сопровождения (без произвольного SQL). МинФин: шаблон
        <code> 12345/ШаблоныФорм-МинФин.xlsx</code>, маппинги из БД (или fallback excel_mappings).
      </p>
      {error && <p className="error">{error}</p>}
      {result && <p className="ok">{result}</p>}

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Предустановки</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <label>
            Отчёт{" "}
            <select value={code} onChange={(e) => setCode(e.target.value)}>
              {presets.map((p) => (
                <option key={p.code} value={p.code}>
                  {locale === "en" && p.nameEn ? p.nameEn : p.nameRu}
                </option>
              ))}
            </select>
          </label>
          <label>
            ZID <input value={zid} onChange={(e) => setZid(e.target.value)} />
          </label>
          <label>
            EID <input value={eid} onChange={(e) => setEid(e.target.value)} />
          </label>
          <button type="button" disabled={busy} onClick={runPreset}>
            Сформировать
          </button>
        </div>
        {table && (
          <div style={{ overflow: "auto", marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  {table.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {table.columns.map((c) => (
                      <td key={c}>{String(row[c] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>МинФин export</h2>
        <label>
          Шаблон{" "}
          <input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            disabled={!canMutate}
          />
        </label>
        <button type="button" disabled={busy || !canMutate} onClick={handleExport}>
          Экспорт МинФин
        </button>
      </section>
    </div>
  );
}
