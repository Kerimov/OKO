import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { canMutateData } from "../auth";
import {
  listCollectionUnits,
  upsertCollectionUnit,
  type CollectionUnitDto,
  type CollectionUnitKind,
} from "../psdApi";
import { listOrganizations } from "../packagesApi";
import { OrgSelect, type IdOrEmpty } from "../components/OrgPeriodSelects";
import { isBackendMode } from "../storage";
import type { Organization } from "../types";
import { unitKindLabel } from "../uiLabels";

function previewComposite(parts: {
  headCode: string;
  companyCode: string;
  branchCode: string;
  unitCode: string;
  unitKind: CollectionUnitKind;
}): string {
  const head = parts.headCode.trim() || "head";
  const company = parts.companyCode.trim() || "company";
  const segs = [company];
  if (parts.unitKind !== "organization" && parts.branchCode.trim()) {
    segs.push(parts.branchCode.trim());
  }
  if (parts.unitKind === "unit" && parts.unitCode.trim()) {
    segs.push(parts.unitCode.trim());
  }
  return `${head}@${segs.join(".")}`;
}

function orgNameByZid(
  zid: number | null | undefined,
  orgs: Organization[],
  units: CollectionUnitDto[]
): string {
  if (zid == null) return "—";
  const fromOrg = orgs.find((o) => o.zid === zid);
  if (fromOrg) return fromOrg.name;
  const fromUnit = units.find((u) => u.zid === zid);
  if (fromUnit) return fromUnit.name;
  return `№ ${zid}`;
}

export function CollectionUnitsPage() {
  const backend = isBackendMode();
  const canMutate = canMutateData();
  const [units, setUnits] = useState<CollectionUnitDto[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const [zid, setZid] = useState<IdOrEmpty>("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [unitKind, setUnitKind] = useState<CollectionUnitKind>("branch");
  const [parentZid, setParentZid] = useState<IdOrEmpty>("");
  const [headZid, setHeadZid] = useState<IdOrEmpty>("");
  const [headCode, setHeadCode] = useState("1");
  const [branchCode, setBranchCode] = useState("");
  const [unitCode, setUnitCode] = useState("");

  const load = useCallback(async () => {
    if (!backend) return;
    setError("");
    try {
      const [u, o] = await Promise.all([listCollectionUnits(), listOrganizations()]);
      setUnits(u);
      setOrgs(o);
      if (zid === "" && o[0]) setZid(o[0].zid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    }
  }, [backend, zid]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend]);

  const compositePreview = useMemo(
    () =>
      previewComposite({
        headCode,
        companyCode: code,
        branchCode,
        unitCode,
        unitKind,
      }),
    [headCode, code, branchCode, unitCode, unitKind]
  );

  const onOrgPick = (next: IdOrEmpty) => {
    setZid(next);
    if (typeof next !== "number") return;
    const fromUnits = units.find((u) => u.zid === next);
    const fromOrgs = orgs.find((o) => o.zid === next);
    if (fromUnits) {
      setName(fromUnits.name);
      setCode(fromUnits.code ?? "");
      setUnitKind(fromUnits.unitKind);
      setParentZid(fromUnits.parentZid ?? "");
      setHeadZid(fromUnits.headZid ?? "");
      setBranchCode(fromUnits.branchCode ?? "");
      setUnitCode(fromUnits.unitCode ?? "");
    } else if (fromOrgs) {
      setName(fromOrgs.name);
      setCode(fromOrgs.code ?? "");
    }
  };

  const handleUpsert = async () => {
    if (!canMutate) return;
    if (typeof zid !== "number" || !name.trim()) {
      setError("Выберите организацию и укажите наименование");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const saved = await upsertCollectionUnit(zid, {
        name: name.trim(),
        code: code.trim() || null,
        parentZid: typeof parentZid === "number" ? parentZid : null,
        unitKind,
        headZid: typeof headZid === "number" ? headZid : null,
        branchCode: branchCode.trim() || null,
        unitCode: unitCode.trim() || null,
        headCode: headCode.trim() || null,
      });
      setStatus(`Сохранено: ${saved.name} · ${saved.compositeCode ?? "—"}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  };

  const fillFrom = (u: CollectionUnitDto) => {
    setZid(u.zid);
    setName(u.name);
    setCode(u.code ?? "");
    setUnitKind(u.unitKind);
    setParentZid(u.parentZid ?? "");
    setHeadZid(u.headZid ?? "");
    setBranchCode(u.branchCode ?? "");
    setUnitCode(u.unitCode ?? "");
  };

  if (!backend) {
    return <p className="tools-hint">Единицы сбора доступны только в backend-режиме.</p>;
  }

  return (
    <div className="page">
      <h1>Единицы сбора</h1>
      <p className="tools-hint">
        Иерархия организация / филиал / подразделение. Составной код:
        головная@компания.филиал.подразделение
      </p>
      {error && <p className="error">{error}</p>}
      {status && <p className="ok">{status}</p>}

      <section className="tools-section">
        <h2>Список</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
          Обновить
        </button>
        <table className="data-table" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Наименование</th>
              <th>Вид</th>
              <th>Код</th>
              <th>Составной</th>
              <th>Родитель</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.zid}>
                <td>
                  {u.name}
                  <div className="table-sub">код орг. {u.zid}</div>
                </td>
                <td>{unitKindLabel(u.unitKind)}</td>
                <td>{u.code ?? "—"}</td>
                <td>
                  <code>{u.compositeCode ?? "—"}</code>
                </td>
                <td>{orgNameByZid(u.parentZid, orgs, units)}</td>
                <td>
                  <Link
                    to={`/package?zid=${u.zid}`}
                    className="btn btn-secondary btn-sm"
                  >
                    Выбрать комплект
                  </Link>{" "}
                  {canMutate && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => fillFrom(u)}
                    >
                      В форму
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!units.length && (
              <tr>
                <td colSpan={6}>Нет единиц</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {canMutate && (
        <section className="tools-section">
          <h2>Создать / обновить</h2>
          <div className="tools-grid">
            <OrgSelect
              label="Организация"
              value={zid}
              onChange={onOrgPick}
              allowEmpty
              emptyLabel="— выберите —"
              orgs={orgs}
            />
            <label>
              Наименование
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Вид
              <select
                value={unitKind}
                onChange={(e) => setUnitKind(e.target.value as CollectionUnitKind)}
              >
                <option value="organization">Организация</option>
                <option value="branch">Филиал</option>
                <option value="unit">Подразделение</option>
              </select>
            </label>
            <label>
              Код компании
              <input value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <OrgSelect
              label="Родитель"
              value={parentZid}
              onChange={setParentZid}
              allowEmpty
              emptyLabel="— нет —"
              orgs={orgs}
            />
            <OrgSelect
              label="Головная"
              value={headZid}
              onChange={setHeadZid}
              allowEmpty
              emptyLabel="— нет —"
              orgs={orgs}
            />
            <label>
              Код головной
              <input value={headCode} onChange={(e) => setHeadCode(e.target.value)} />
            </label>
            <label>
              Код филиала
              <input value={branchCode} onChange={(e) => setBranchCode(e.target.value)} />
            </label>
            <label>
              Код подразделения
              <input value={unitCode} onChange={(e) => setUnitCode(e.target.value)} />
            </label>
          </div>
          <p className="tools-hint">
            Предпросмотр составного кода: <code>{compositePreview}</code>
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void handleUpsert()}
          >
            Сохранить
          </button>
        </section>
      )}
    </div>
  );
}
