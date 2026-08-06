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
  type PackageKind,
  type SvodDefinitionDto,
  type TransferMapDto,
} from "../psdApi";
import { isBackendMode } from "../storage";
import { useAuth } from "../useAuth";

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

  const [svodCode, setSvodCode] = useState("");
  const [svodName, setSvodName] = useState("");
  const [svodEid, setSvodEid] = useState("");

  const [srcZid, setSrcZid] = useState("");
  const [srcEid, setSrcEid] = useState("");
  const [tgtZid, setTgtZid] = useState("");
  const [tgtEid, setTgtEid] = useState("");
  const [xferKind, setXferKind] = useState<PackageKind>("OKO");

  const [exportZid, setExportZid] = useState("");
  const [exportEid, setExportEid] = useState("");
  const [exportTemplate, setExportTemplate] = useState("");

  const load = useCallback(async () => {
    if (!backend) return;
    setError("");
    try {
      const [st, sv, tr, mf] = await Promise.all([
        getIntegrationsStatus(),
        listSvods(),
        listTransferMaps(),
        listMinfinMappings(),
      ]);
      setStatus(st);
      setSvods(sv);
      setTransfers(tr);
      const byTpl = new Map<string, number>();
      for (const m of mf) {
        byTpl.set(m.templateName, (byTpl.get(m.templateName) ?? 0) + 1);
      }
      setMinfinCounts(
        [...byTpl.entries()]
          .map(([template, count]) => ({ template, count }))
          .sort((a, b) => a.template.localeCompare(b.template, "ru"))
      );
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

  const handleCreateSvod = async () => {
    if (!canMutate) return;
    const eid = Number(svodEid);
    if (!svodCode.trim() || !svodName.trim() || !Number.isFinite(eid)) {
      setError("Укажите code, name и eid");
      return;
    }
    setBusy(true);
    setError("");
    setStatusMsg("");
    try {
      await createSvod({ eid, code: svodCode.trim(), name: svodName.trim() });
      setSvodCode("");
      setSvodName("");
      setSvodEid("");
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
    const sourceZid = Number(srcZid);
    const sourceEid = Number(srcEid);
    const targetZid = Number(tgtZid);
    const targetEid = Number(tgtEid);
    if (![sourceZid, sourceEid, targetZid, targetEid].every(Number.isFinite)) {
      setError("Укажите source/target zid и eid");
      return;
    }
    setBusy(true);
    setError("");
    setStatusMsg("");
    try {
      const res = await applyTransfers({
        sourceZid,
        sourceEid,
        targetZid,
        targetEid,
        packageKind: xferKind,
      });
      setStatusMsg(res.message ?? `Применено: ${res.applied}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка применения переноса");
    } finally {
      setBusy(false);
    }
  };

  const handleExportMinfin = async (templateName: string) => {
    if (!canMutate) return;
    const zid = Number(exportZid);
    const eid = Number(exportEid);
    if (!Number.isFinite(zid) || !Number.isFinite(eid) || !templateName.trim()) {
      setError("Укажите zid, eid и шаблон");
      return;
    }
    setBusy(true);
    setError("");
    setStatusMsg("");
    try {
      const res = await exportMinfin({ zid, eid, templateName });
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
                EID
                <input
                  value={svodEid}
                  inputMode="numeric"
                  onChange={(e) => setSvodEid(e.target.value)}
                />
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
                <th>EID</th>
                <th>Тип</th>
              </tr>
            </thead>
            <tbody>
              {svods.map((s) => (
                <tr key={s.id}>
                  <td>{s.code}</td>
                  <td>{s.name}</td>
                  <td>{s.eid}</td>
                  <td>{s.packageKind}</td>
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
                <label>
                  Source ZID
                  <input value={srcZid} onChange={(e) => setSrcZid(e.target.value)} />
                </label>
                <label>
                  Source EID
                  <input value={srcEid} onChange={(e) => setSrcEid(e.target.value)} />
                </label>
                <label>
                  Target ZID
                  <input value={tgtZid} onChange={(e) => setTgtZid(e.target.value)} />
                </label>
                <label>
                  Target EID
                  <input value={tgtEid} onChange={(e) => setTgtEid(e.target.value)} />
                </label>
                <label>
                  Тип
                  <select
                    value={xferKind}
                    onChange={(e) => setXferKind(e.target.value as PackageKind)}
                  >
                    <option value="OKO">OKO</option>
                    <option value="BALANCE">BALANCE</option>
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
              <label>
                ZID
                <input value={exportZid} onChange={(e) => setExportZid(e.target.value)} />
              </label>
              <label>
                EID
                <input value={exportEid} onChange={(e) => setExportEid(e.target.value)} />
              </label>
              <label>
                Шаблон
                <input
                  value={exportTemplate}
                  onChange={(e) => setExportTemplate(e.target.value)}
                  list="minfin-templates"
                />
                <datalist id="minfin-templates">
                  {minfinCounts.map((r) => (
                    <option key={r.template} value={r.template} />
                  ))}
                </datalist>
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
