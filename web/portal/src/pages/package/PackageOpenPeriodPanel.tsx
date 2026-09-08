import { quarterDateRange, quarterPeriodName, formatPeriod } from "../../utils";
import type { Organization } from "../../types";
import type { PackageKind } from "../../psdApi";
import { orgOptionLabel } from "../../uiLabels";

type Props = {
  admin: boolean;
  busy: boolean;
  orgsCount: number;
  periodsCreateOrgs: Organization[];
  periodsCreateZid: number | "";
  newPeriodQuarter: number;
  newPeriodYear: number;
  newPackageKind: PackageKind;
  onPeriodsCreateZidChange: (value: number | "") => void;
  onQuarterChange: (value: number) => void;
  onYearChange: (value: number) => void;
  onPackageKindChange: (value: PackageKind) => void;
  onCreatePeriod: () => void;
};

export function PackageOpenPeriodPanel({
  admin,
  busy,
  orgsCount,
  periodsCreateOrgs,
  periodsCreateZid,
  newPeriodQuarter,
  newPeriodYear,
  newPackageKind,
  onPeriodsCreateZidChange,
  onQuarterChange,
  onYearChange,
  onPackageKindChange,
  onCreatePeriod,
}: Props) {
  const range = quarterDateRange(newPeriodQuarter, newPeriodYear);
  return (
    <section className="tools-section">
      <h2>{admin ? "Открыть период для всех организаций" : "Открыть период"}</h2>
      <p className="tools-hint">
        Период — верхний уровень. После открытия внутри периода создаются комплекты по
        организациям.
      </p>
      <div className="tools-grid">
        {!admin ? (
          <label>
            Организация
            <select
              value={periodsCreateZid}
              onChange={(e) =>
                onPeriodsCreateZidChange(e.target.value === "" ? "" : Number(e.target.value))
              }
            >
              <option value="">— выберите —</option>
              {periodsCreateOrgs.map((o) => (
                <option key={o.zid} value={o.zid}>
                  {orgOptionLabel(o)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Квартал
          <select
            value={newPeriodQuarter}
            onChange={(e) => onQuarterChange(Number(e.target.value))}
          >
            <option value={1}>1 квартал</option>
            <option value={2}>2 квартал</option>
            <option value={3}>3 квартал</option>
            <option value={4}>4 квартал</option>
          </select>
        </label>
        <label>
          Год
          <input
            type="number"
            min={2000}
            max={2100}
            value={newPeriodYear}
            onChange={(e) => onYearChange(Number(e.target.value))}
          />
        </label>
        <label>
          Тип комплекта
          <select
            value={newPackageKind}
            onChange={(e) => onPackageKindChange(e.target.value as PackageKind)}
          >
            <option value="OKO">ОКО</option>
            <option value="BALANCE">Баланс</option>
          </select>
        </label>
      </div>
      <p className="tools-hint">
        Будет открыт <strong>{quarterPeriodName(newPeriodQuarter, newPeriodYear)}</strong>
        {" · "}
        {formatPeriod(range.periodStart, range.periodEnd)}
        {admin ? ` · для ${orgsCount} организаций` : ""}
      </p>
      <button
        type="button"
        className="btn btn-primary"
        style={{ marginTop: 8 }}
        disabled={busy || (!admin && typeof periodsCreateZid !== "number")}
        onClick={onCreatePeriod}
      >
        Открыть период
      </button>
    </section>
  );
}
