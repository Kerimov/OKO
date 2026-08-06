import { useCallback, useEffect, useMemo, useState } from "react";
import { canMutateData, getCurrentUser } from "../auth";
import { downloadMinfinExport, exportMinfin, listMinfinMappings } from "../psdApi";
import { apiFetch } from "../apiClient";
import { loadWorkContext, listOrganizations, listPeriods } from "../packagesApi";
import { isBackendMode } from "../storage";
import type { Organization, ReportingPeriod } from "../types";
import { orgOptionLabel, periodOptionLabel } from "../uiLabels";

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
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [periods, setPeriods] = useState<ReportingPeriod[]>([]);
  const [zid, setZid] = useState<number | "">("");
  const [eid, setEid] = useState<number | "">("");
  const [templates, setTemplates] = useState<string[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [table, setTable] = useState<ReportResult | null>(null);

  const selectedOrg = useMemo(
    () => (typeof zid === "number" ? orgs.find((o) => o.zid === zid) ?? null : null),
    [orgs, zid]
  );
  const selectedPeriod = useMemo(
    () => (typeof eid === "number" ? periods.find((p) => p.eid === eid) ?? null : null),
    [periods, eid]
  );

  const loadPeriodsForOrg = useCallback(async (orgZid: number) => {
    const list = await listPeriods(orgZid);
    setPeriods(list);
    setEid((prev) => {
      if (typeof prev === "number" && list.some((p) => p.eid === prev)) return prev;
      return list[0]?.eid ?? "";
    });
  }, []);

  useEffect(() => {
    if (!backend) return;
    let cancelled = false;
    (async () => {
      try {
        const [presetList, orgList, ctx, mappings] = await Promise.all([
          apiFetch<ReportPreset[]>("/api/support-reports/presets"),
          listOrganizations(),
          loadWorkContext().catch(() => ({ zid: null, eid: null })),
          listMinfinMappings().catch(() => []),
        ]);
        if (cancelled) return;
        setPresets(presetList);
        if (presetList[0]) setCode(presetList[0].code);
        setOrgs(orgList);

        const names = Array.from(
          new Set(
            mappings
              .map((m) => String(m.templateName ?? "").trim())
              .filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b, "ru"));
        // Built-in workbook used by exporter when mappings are empty / default.
        if (!names.includes("default")) names.unshift("default");
        setTemplates(names);
        setTemplateName(names[0] ?? "default");

        const initialZid =
          ctx.zid != null && orgList.some((o) => o.zid === ctx.zid)
            ? ctx.zid
            : orgList[0]?.zid ?? "";
        setZid(initialZid);
        if (typeof initialZid === "number") {
          const perList = await listPeriods(initialZid);
          if (cancelled) return;
          setPeriods(perList);
          const initialEid =
            ctx.eid != null && perList.some((p) => p.eid === ctx.eid)
              ? ctx.eid
              : perList[0]?.eid ?? "";
          setEid(initialEid);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить списки");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backend]);

  const onOrgChange = async (value: string) => {
    const next = value === "" ? "" : Number(value);
    setZid(next);
    setPeriods([]);
    setEid("");
    if (typeof next === "number") {
      try {
        await loadPeriodsForOrg(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить периоды");
      }
    }
  };

  const runPreset = async () => {
    if (typeof zid !== "number" || typeof eid !== "number") {
      setError("Выберите организацию и период");
      return;
    }
    setBusy(true);
    setError("");
    setTable(null);
    setResult("");
    try {
      const res = await apiFetch<ReportResult>("/api/support-reports/run", {
        method: "POST",
        body: JSON.stringify({
          code,
          zid,
          eid,
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
    if (typeof zid !== "number" || typeof eid !== "number") {
      setError("Выберите организацию и период");
      return;
    }
    if (!templateName.trim()) {
      setError("Выберите шаблон МинФин");
      return;
    }
    setBusy(true);
    setError("");
    setResult("");
    try {
      const res = await exportMinfin({
        zid,
        eid,
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
        <div className="tools-grid" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <label>
            Отчёт
            <select value={code} onChange={(e) => setCode(e.target.value)}>
              {presets.map((p) => (
                <option key={p.code} value={p.code}>
                  {locale === "en" && p.nameEn ? p.nameEn : p.nameRu}
                </option>
              ))}
            </select>
          </label>
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
              onChange={(e) => setEid(e.target.value === "" ? "" : Number(e.target.value))}
              disabled={typeof zid !== "number"}
            >
              <option value="">— выберите —</option>
              {periods.map((p) => (
                <option key={p.eid} value={p.eid}>
                  {periodOptionLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || typeof zid !== "number" || typeof eid !== "number"}
            onClick={() => void runPreset()}
          >
            Сформировать
          </button>
        </div>
        {(selectedOrg || selectedPeriod) && (
          <p className="tools-hint" style={{ marginTop: 8 }}>
            {selectedOrg ? selectedOrg.name : "—"}
            {" · "}
            {selectedPeriod ? selectedPeriod.name : "период не выбран"}
          </p>
        )}
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
        <div className="tools-grid" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <label>
            Шаблон
            <select
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              disabled={!canMutate}
            >
              {templates.map((name) => (
                <option key={name} value={name}>
                  {name === "default" ? "default (ШаблоныФорм-МинФин.xlsx)" : name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={
              busy || !canMutate || typeof zid !== "number" || typeof eid !== "number"
            }
            onClick={() => void handleExport()}
          >
            Экспорт МинФин
          </button>
        </div>
        <p className="tools-hint" style={{ marginTop: 8 }}>
          Используются организация и период из блока выше.
        </p>
      </section>
    </div>
  );
}
