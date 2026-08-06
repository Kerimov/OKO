import { useCallback, useEffect, useMemo, useState } from "react";
import { canMutateData } from "../auth";
import {
  applyTransfers,
  createSvod,
  downloadMinfinExport,
  exportMinfin,
  getIntegrationsStatus,
  listMinfinMappings,
  listSvods,
  listTransferMaps,
  type IntegrationStatus,
  type SvodDefinitionDto,
  type TransferMapDto,
  type TransferMapKind,
} from "../psdApi";
import {
  OrgPeriodSelects,
  type IdOrEmpty,
} from "../components/OrgPeriodSelects";
import { listOrganizations, listPeriods } from "../packagesApi";
import { isBackendMode } from "../storage";
import { useAuth } from "../useAuth";
import type { Organization, ReportingPeriod } from "../types";
import { orgOptionLabel, packageKindLabel, periodOptionLabel } from "../uiLabels";

type HubTab = "ports" | "svods" | "transfers" | "minfin";

export function IntegrationsPage() {
  const backend = isBackendMode();
  const auth = useAuth();
  const canMutate = canMutateData();
  const [tab, setTab] = useState<HubTab>("ports");
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [svods, setSvods] = useState<SvodDefinitionDto[]>([]);
  const [transfers, setTransfers] = useState<TransferMapDto[]>([]);
  const [minfinCounts, setMinfinCounts] = useState<Array<{ template: string; count: number }>>(
    []
  );

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [allPeriods, setAllPeriods] = useState<ReportingPeriod[]>([]);

  const [svodCode, setSvodCode] = useState("");
  const [svodName, setSvodName] = useState("");
  const [svodZid, setSvodZid] = useState<IdOrEmpty>("");
  const [svodEid, setSvodEid] = useState<IdOrEmpty>("");
  const [svodPeriods, setSvodPeriods] = useState<ReportingPeriod[]>([]);

  const [srcZid, setSrcZid] = useState<IdOrEmpty>("");
  const [srcEid, setSrcEid] = useState<IdOrEmpty>("");
  const [tgtZid, setTgtZid] = useState<IdOrEmpty>("");
  const [tgtEid, setTgtEid] = useState<IdOrEmpty>("");
  const [xferKind, setXferKind] = useState<TransferMapKind>("period_to_period");

  const [exportZid, setExportZid] = useState<IdOrEmpty>("");
  const [exportEid, setExportEid] = useState<IdOrEmpty>("");
  const [exportTemplate, setExportTemplate] = useState("");

  const load = useCallback(async () => {
    if (!backend) return;
    setError("");
    try {
      const [st, sv, tr, mf, orgList] = await Promise.all([
        getIntegrationsStatus(),
        listSvods(),
        listTransferMaps(),
        listMinfinMappings(),
        listOrganizations(),
      ]);
      setStatus(st);
      setSvods(sv);
      setTransfers(tr);
      setOrgs(orgList);
      const byTpl = new Map<string, number>();
      for (const m of mf) {
        byTpl.set(m.templateName, (byTpl.get(m.templateName) ?? 0) + 1);
      }
      const counts = [...byTpl.entries()]
        .map(([template, count]) => ({ template, count }))
        .sort((a, b) => a.template.localeCompare(b.template, "ru"));
      setMinfinCounts(counts);
      setExportTemplate((prev) => prev || counts[0]?.template || "default");

      // Periods for svod create: load for first few orgs as a flat unique list
      const periodLists = await Promise.all(
        orgList.slice(0, 40).map((o) => listPeriods(o.zid).catch(() => [] as ReportingPeriod[]))
      );
      const byEid = new Map<number, ReportingPeriod>();
      for (const list of periodLists) {
        for (const p of list) byEid.set(p.eid, p);
      }
      setAllPeriods([...byEid.values()].sort((a, b) => b.eid - a.eid));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    }
  }, [backend]);

  useEffect(() => {
    void load();
  }, [load]);

  const tabs = useMemo(
    () =>
      [
        { id: "ports" as const, label: "Порты" },
        { id: "svods" as const, label: "Своды" },
        { id: "transfers" as const, label: "Переносы" },
        { id: "minfin" as const, label: "МинФин" },
      ] as const,
    []
  );

  const onSvodOrgChange = async (raw: string) => {
    const next = raw === "" ? "" : Number(raw);
    setSvodZid(next);
    setSvodEid("");
    setSvodPeriods([]);
    if (typeof next === "number") {
      try {
        const list = await listPeriods(next);
        setSvodPeriods(list);
        if (list[0]) setSvodEid(list[0].eid);
      } catch {
        /* ignore */
      }
    }
  };

  const handleCreateSvod = async () => {
    if (!canMutate) return;
    if (!svodCode.trim() || !svodName.trim() || typeof svodEid !== "number") {
      setError("Укажите code, name и период");
      return;
    }
    setBusy(true);
    setError("");
    setStatusMsg("");
    try {
      await createSvod({ eid: svodEid, code: svodCode.trim(), name: svodName.trim() });
      setSvodCode("");
      setSvodName("");
      setStatusMsg("Свод создан");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка создания свода");
    } finally {
      setBusy(false);
    }
  };

  const handleApplyTransfer = async () => {
    if (!canMutate) return;
    if (
      typeof srcZid !== "number" ||
      typeof srcEid !== "number" ||
      typeof tgtZid !== "number" ||
      typeof tgtEid !== "number"
    ) {
      setError("Выберите источник и приёмник (организация и период)");
      return;
    }
    setBusy(true);
    setError("");
    setStatusMsg("");
    try {
      const res = await applyTransfers({
        sourceZid: srcZid,
        sourceEid: srcEid,
        targetZid: tgtZid,
        targetEid: tgtEid,
        kind: xferKind,
      });
      setStatusMsg(
        `Скопировано: ${res.copied}, пропущено: ${res.skipped}` +
          (res.errors.length ? `; ошибок: ${res.errors.length}` : "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка применения переноса");
    } finally {
      setBusy(false);
    }
  };

  const handleExportMinfin = async (templateName: string) => {
    if (!canMutate) return;
    if (typeof exportZid !== "number" || typeof exportEid !== "number" || !templateName.trim()) {
      setError("Выберите организацию, период и шаблон");
      return;
    }
    setBusy(true);
    setError("");
    setStatusMsg("");
    try {
      const res = await exportMinfin({ zid: exportZid, eid: exportEid, templateName });
      if (res.ok && downloadMinfinExport(res)) {
        setStatusMsg(
          `Скачан ${res.filename ?? "minfin.xlsx"} · ${res.message ?? `шаблон «${templateName}»`}`
        );
      } else {
        setStatusMsg(
          `${res.code ?? "ошибка"}: ${res.message ?? "не удалось"} (маппингов: ${res.mappingCount ?? "—"})`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка экспорта МинФин");
    } finally {
      setBusy(false);
    }
  };

  if (!backend) {
    return <p className="hint">Интеграции доступны только в backend-режиме.</p>;
  }

  return (
    <div className="page">
      <h1>Интеграции и своды</h1>
      <p className="hint">
        Админ-хаб ПСД. Реальные адаптеры DO/SAP/ЭЦП — stub до артефактов Заказчика (см.{" "}
        <code>docs/PSD-INTEGRATIONS.md</code>). Роль:{" "}
        {auth.user?.psdRole ?? auth.user?.role ?? "—"}
        {!canMutate ? " · только чтение" : ""}
      </p>

      <div className="tools-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "active" : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button type="button" onClick={() => void load()} disabled={busy}>
          Обновить
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {statusMsg && <p className="ok">{statusMsg}</p>}

      {tab === "ports" && status && (
        <section className="tools-section">
          <h2>Статус портов</h2>
          <p className="tools-hint">
            DO XML / SAP / ЭЦП — заглушки. Не симулируем фиктивные payload.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Порт</th>
                <th>Адаптер</th>
                <th>Сконфигурирован</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["DO XML", status.doXml],
                  ["SAP", status.sap],
                  ["ЭЦП", status.eds],
                  ["МинФин", status.minfin],
                ] as const
              ).map(([label, row]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{row.name}</td>
                  <td>{row.configured ? "да" : "нет (stub)"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "svods" && (
        <section className="tools-section">
          <h2>Реестр сводов</h2>
          {canMutate && (
            <div className="tools-grid" style={{ marginBottom: "0.75rem" }}>
              <label>
                Код
                <input value={svodCode} onChange={(e) => setSvodCode(e.target.value)} />
              </label>
              <label>
                Название
                <input value={svodName} onChange={(e) => setSvodName(e.target.value)} />
              </label>
              <label>
                Организация
                <select
                  value={svodZid === "" ? "" : String(svodZid)}
                  onChange={(e) => void onSvodOrgChange(e.target.value)}
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
                  value={svodEid === "" ? "" : String(svodEid)}
                  disabled={typeof svodZid !== "number"}
                  onChange={(e) =>
                    setSvodEid(e.target.value === "" ? "" : Number(e.target.value))
                  }
                >
                  <option value="">— выберите —</option>
                  {(svodPeriods.length ? svodPeriods : allPeriods).map((p) => (
                    <option key={p.eid} value={p.eid}>
                      {periodOptionLabel(p)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void handleCreateSvod()}
              >
                Создать свод
              </button>
            </div>
          )}
          <table className="data-table">
            <thead>
              <tr>
                <th>Код</th>
                <th>Название</th>
                <th>Период</th>
                <th>Тип комплекта</th>
              </tr>
            </thead>
            <tbody>
              {svods.map((s) => (
                <tr key={s.id}>
                  <td>{s.code}</td>
                  <td>{s.name}</td>
                  <td>{s.eid}</td>
                  <td>{packageKindLabel(s.packageKind)}</td>
                </tr>
              ))}
              {!svods.length && (
                <tr>
                  <td colSpan={4}>Пока пусто</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {tab === "transfers" && (
        <section className="tools-section">
          <h2>Карты переносов</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Вид</th>
                <th>Источник</th>
                <th>Приёмник</th>
                <th>Активна</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id}>
                  <td>{t.kind}</td>
                  <td>
                    {t.sourceForm}
                    {t.sourceColumn ? `.${t.sourceColumn}` : ""}
                    {t.sourceRow ? `[${t.sourceRow}]` : ""}
                  </td>
                  <td>
                    {t.targetForm}
                    {t.targetColumn ? `.${t.targetColumn}` : ""}
                    {t.targetRow ? `[${t.targetRow}]` : ""}
                  </td>
                  <td>{t.active ? "да" : "нет"}</td>
                </tr>
              ))}
              {!transfers.length && (
                <tr>
                  <td colSpan={4}>Нет карт переносов</td>
                </tr>
              )}
            </tbody>
          </table>
          {canMutate && (
            <>
              <h3 style={{ marginTop: "1rem" }}>Применить перенос</h3>
              <div className="tools-grid">
                <OrgPeriodSelects
                  zid={srcZid}
                  eid={srcEid}
                  orgLabel="Источник · организация"
                  periodLabel="Источник · период"
                  useWorkContextDefault
                  onChange={({ zid, eid }) => {
                    setSrcZid(zid);
                    setSrcEid(eid);
                  }}
                />
                <OrgPeriodSelects
                  zid={tgtZid}
                  eid={tgtEid}
                  orgLabel="Приёмник · организация"
                  periodLabel="Приёмник · период"
                  onChange={({ zid, eid }) => {
                    setTgtZid(zid);
                    setTgtEid(eid);
                  }}
                />
                <label>
                  Тип переноса
                  <select
                    value={xferKind}
                    onChange={(e) => setXferKind(e.target.value as TransferMapKind)}
                  >
                    <option value="period_to_period">Период → период</option>
                    <option value="balance_to_oko">Баланс → ОКО</option>
                    <option value="oko_to_balance">ОКО → Баланс</option>
                  </select>
                </label>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void handleApplyTransfer()}
              >
                Применить
              </button>
            </>
          )}
        </section>
      )}

      {tab === "minfin" && (
        <section className="tools-section">
          <h2>Маппинги МинФин</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Шаблон</th>
                <th>Строк маппинга</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {minfinCounts.map((row) => (
                <tr key={row.template}>
                  <td>{row.template}</td>
                  <td>{row.count}</td>
                  <td>
                    {canMutate && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy}
                        onClick={() => {
                          setExportTemplate(row.template);
                          void handleExportMinfin(row.template);
                        }}
                      >
                        Экспорт
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!minfinCounts.length && (
                <tr>
                  <td colSpan={3}>Маппинги не загружены</td>
                </tr>
              )}
            </tbody>
          </table>
          {canMutate && (
            <div className="tools-grid" style={{ marginTop: "0.75rem" }}>
              <OrgPeriodSelects
                zid={exportZid}
                eid={exportEid}
                useWorkContextDefault
                onChange={({ zid, eid }) => {
                  setExportZid(zid);
                  setExportEid(eid);
                }}
              />
              <label>
                Шаблон
                <select
                  value={exportTemplate}
                  onChange={(e) => setExportTemplate(e.target.value)}
                >
                  {!minfinCounts.length && <option value="default">default</option>}
                  {minfinCounts.map((r) => (
                    <option key={r.template} value={r.template}>
                      {r.template} ({r.count})
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void handleExportMinfin(exportTemplate)}
              >
                Экспорт выбранного
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
