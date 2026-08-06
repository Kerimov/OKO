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
import { unitKindLabel } from "../uiLabels";

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
      {error && <div className="error-box">{error}</div>}
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

      <section className="tools-section">
        <div className="tools-grid">
          <label>
            Фильтр
            <input
              placeholder="Наименование или код…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ alignSelf: "end" }}
            onClick={() => void load()}
          >
            Обновить
          </button>
        </div>
        {tab === "kontr" && (
          <div className="tools-grid" style={{ marginTop: "0.75rem" }}>
            <label>
              GUID контрагента
              <input
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={guidLookup}
                onChange={(e) => setGuidLookup(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ alignSelf: "end" }}
              onClick={() => void lookupGuid()}
            >
              Найти
            </button>
            {guidHit && (
              <p className="tools-hint" style={{ gridColumn: "1 / -1" }}>
                <Link to={`/admin/refs?kontrId=${guidHit.id}`}>{guidHit.name}</Link>
                {guidHit.guid ? (
                  <span className="table-sub"> · {guidHit.guid}</span>
                ) : null}
              </p>
            )}
          </div>
        )}
      </section>

      {tab === "orgs" ? (
        <section className="tools-section">
          <h2>Организации</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th>Код</th>
                  <th>Вид</th>
                  <th>Головная</th>
                  <th>GUID</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.zid}>
                    <td>
                      {o.name}
                      <div className="table-sub">код орг. {o.zid}</div>
                    </td>
                    <td>{o.code ?? o.compositeCode ?? "—"}</td>
                    <td>{unitKindLabel(o.unitKind)}</td>
                    <td>{o.headZid ?? "—"}</td>
                    <td>
                      <span className="table-sub">{o.guid ?? "—"}</span>
                    </td>
                  </tr>
                ))}
                {!orgs.length && (
                  <tr>
                    <td colSpan={5}>Нет организаций</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="tools-section">
          <h2>Контрагенты</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th>ИНН</th>
                  <th>КПП</th>
                  <th>Тип</th>
                  <th>GUID</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {kontr.map((k) => (
                  <tr key={k.id}>
                    <td>
                      {k.name}
                      <div className="table-sub">№ {k.id}</div>
                    </td>
                    <td>{k.inn ?? "—"}</td>
                    <td>{k.kpp ?? "—"}</td>
                    <td>{k.orgType ?? "—"}</td>
                    <td>
                      <span className="table-sub">{k.guid ?? "—"}</span>
                    </td>
                    <td>
                      <Link
                        to={`/admin/refs?kontrId=${k.id}`}
                        className="btn btn-secondary btn-sm"
                      >
                        Карточка
                      </Link>
                    </td>
                  </tr>
                ))}
                {!kontr.length && (
                  <tr>
                    <td colSpan={6}>Нет контрагентов</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
