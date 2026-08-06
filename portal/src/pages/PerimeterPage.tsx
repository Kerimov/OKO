import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  findPerimeterKontrByGuid,
  listPerimeterKontragents,
  listPerimeterOrganizations,
  type PerimeterKontrRow,
  type PerimeterOrgRow,
} from "../psdApi";
import { isBackendMode } from "../storage";

export function PerimeterPage() {
  const backend = isBackendMode();
  const [tab, setTab] = useState<"orgs" | "kontr">("orgs");
  const [q, setQ] = useState("");
  const [orgs, setOrgs] = useState<PerimeterOrgRow[]>([]);
  const [kontr, setKontr] = useState<PerimeterKontrRow[]>([]);
  const [error, setError] = useState("");
  const [guidLookup, setGuidLookup] = useState("");
  const [guidHit, setGuidHit] = useState<PerimeterKontrRow | null>(null);

  const load = useCallback(async () => {
    if (!backend) return;
    setError("");
    try {
      if (tab === "orgs") {
        setOrgs(await listPerimeterOrganizations({ q: q.trim() || undefined }));
      } else {
        setKontr(await listPerimeterKontragents({ q: q.trim() || undefined }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки периметра");
    }
  }, [backend, tab, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const lookupGuid = async () => {
    if (!guidLookup.trim()) return;
    setError("");
    try {
      const hit = await findPerimeterKontrByGuid(guidLookup.trim());
      setGuidHit(hit);
      if (!hit) setError("Контрагент с таким GUID не найден");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка поиска GUID");
    }
  };

  if (!backend) {
    return <div className="page">Периметр доступен только в backend-режиме.</div>;
  }

  return (
    <div className="page">
      <h1>Периметр сбора данных</h1>
      <p className="tools-hint">
        Реестр организаций и контрагентов. Переход по GUID открывает карточку в{" "}
        <Link to="/admin/refs">справочниках</Link>.
      </p>
      {error && <div className="status-bar status-error">{error}</div>}
      <div className="tools-tabs">
        <button
          type="button"
          className={tab === "orgs" ? "active" : ""}
          onClick={() => setTab("orgs")}
        >
          Организации
        </button>
        <button
          type="button"
          className={tab === "kontr" ? "active" : ""}
          onClick={() => setTab("kontr")}
        >
          Контрагенты
        </button>
      </div>
      <div className="tools-row" style={{ gap: 8, margin: "0.75rem 0" }}>
        <input
          placeholder="Фильтр…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 240 }}
        />
        <button type="button" className="btn btn-secondary" onClick={() => void load()}>
          Обновить
        </button>
      </div>
      {tab === "kontr" && (
        <div className="tools-row" style={{ gap: 8, marginBottom: "0.75rem" }}>
          <input
            placeholder="GUID контрагента"
            value={guidLookup}
            onChange={(e) => setGuidLookup(e.target.value)}
            style={{ minWidth: 280 }}
          />
          <button type="button" className="btn btn-secondary" onClick={() => void lookupGuid()}>
            Найти GUID
          </button>
          {guidHit && (
            <Link to={`/admin/refs?kontrId=${guidHit.id}`}>
              {guidHit.name} ({guidHit.guid})
            </Link>
          )}
        </div>
      )}
      {tab === "orgs" ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>ZID</th>
              <th>Наименование</th>
              <th>Код</th>
              <th>Вид</th>
              <th>Head</th>
              <th>GUID</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.zid}>
                <td>{o.zid}</td>
                <td>{o.name}</td>
                <td>{o.code ?? o.compositeCode ?? "—"}</td>
                <td>{o.unitKind ?? "—"}</td>
                <td>{o.headZid ?? "—"}</td>
                <td>{o.guid ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>GUID</th>
              <th>Наименование</th>
              <th>ИНН</th>
              <th>КПП</th>
              <th>Тип</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {kontr.map((k) => (
              <tr key={k.id}>
                <td>{k.id}</td>
                <td>{k.guid ?? "—"}</td>
                <td>{k.name}</td>
                <td>{k.inn ?? "—"}</td>
                <td>{k.kpp ?? "—"}</td>
                <td>{k.orgType ?? "—"}</td>
                <td>
                  <Link to={`/admin/refs?kontrId=${k.id}`}>Карточка</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
