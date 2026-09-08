import { useCallback, useEffect, useMemo, useState } from "react";
import { loadWorkContext, listOrganizations, listPeriods } from "../packagesApi";
import type { Organization, ReportingPeriod } from "../types";
import { orgOptionLabel, periodOptionLabel } from "../uiLabels";

export type IdOrEmpty = number | "";

export type OrgPeriodValue = {
  zid: IdOrEmpty;
  eid: IdOrEmpty;
};

type Props = {
  zid: IdOrEmpty;
  eid: IdOrEmpty;
  onChange: (next: OrgPeriodValue) => void;
  /** When true, load work-context defaults once on mount if zid/eid empty. */
  useWorkContextDefault?: boolean;
  orgLabel?: string;
  periodLabel?: string;
  disabled?: boolean;
  allowEmptyOrg?: boolean;
  allowEmptyPeriod?: boolean;
  className?: string;
};

/** Cascading organization → period selects with localized labels. */
export function OrgPeriodSelects({
  zid,
  eid,
  onChange,
  useWorkContextDefault = false,
  orgLabel = "Организация",
  periodLabel = "Период",
  disabled = false,
  allowEmptyOrg = false,
  allowEmptyPeriod = true,
  className,
}: Props) {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [periods, setPeriods] = useState<ReportingPeriod[]>([]);
  const [bootstrapped, setBootstrapped] = useState(false);

  const loadPeriods = useCallback(async (orgZid: number, keepEid?: IdOrEmpty) => {
    const list = await listPeriods(orgZid);
    setPeriods(list);
    const keep =
      typeof keepEid === "number" && list.some((p) => p.eid === keepEid)
        ? keepEid
        : list[0]?.eid ?? "";
    return { periods: list, eid: keep as IdOrEmpty };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const orgList = await listOrganizations();
        if (cancelled) return;
        setOrgs(orgList);

        let nextZid = zid;
        let nextEid = eid;

        if (
          useWorkContextDefault &&
          !bootstrapped &&
          nextZid === "" &&
          nextEid === ""
        ) {
          const ctx = await loadWorkContext().catch(() => ({
            zid: null as number | null,
            eid: null as number | null,
          }));
          if (cancelled) return;
          if (ctx.zid != null && orgList.some((o) => o.zid === ctx.zid)) {
            nextZid = ctx.zid;
            nextEid = ctx.eid ?? "";
          } else if (!allowEmptyOrg && orgList[0]) {
            nextZid = orgList[0].zid;
          }
          setBootstrapped(true);
        }

        if (typeof nextZid === "number") {
          const loaded = await loadPeriods(nextZid, nextEid);
          if (cancelled) return;
          nextEid = loaded.eid;
        } else {
          setPeriods([]);
          nextEid = "";
        }

        if (nextZid !== zid || nextEid !== eid) {
          onChange({ zid: nextZid, eid: nextEid });
        }
      } catch {
        /* caller surfaces errors via own flows */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useWorkContextDefault]);

  const onOrgChange = async (raw: string) => {
    const nextZid: IdOrEmpty = raw === "" ? "" : Number(raw);
    if (typeof nextZid !== "number") {
      setPeriods([]);
      onChange({ zid: "", eid: "" });
      return;
    }
    try {
      const loaded = await loadPeriods(nextZid);
      onChange({ zid: nextZid, eid: loaded.eid });
    } catch {
      onChange({ zid: nextZid, eid: "" });
    }
  };

  const selectedOrg = useMemo(
    () => (typeof zid === "number" ? orgs.find((o) => o.zid === zid) : null),
    [orgs, zid]
  );

  return (
    <div className={className ?? "tools-grid"} style={{ display: "contents" }}>
      <label>
        {orgLabel}
        <select
          value={zid === "" ? "" : String(zid)}
          disabled={disabled}
          onChange={(e) => void onOrgChange(e.target.value)}
        >
          {(allowEmptyOrg || orgs.length === 0) && (
            <option value="">— выберите —</option>
          )}
          {orgs.map((o) => (
            <option key={o.zid} value={o.zid}>
              {orgOptionLabel(o)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {periodLabel}
        <select
          value={eid === "" ? "" : String(eid)}
          disabled={disabled || typeof zid !== "number"}
          onChange={(e) =>
            onChange({
              zid,
              eid: e.target.value === "" ? "" : Number(e.target.value),
            })
          }
        >
          {(allowEmptyPeriod || periods.length === 0) && (
            <option value="">— выберите —</option>
          )}
          {periods.map((p) => (
            <option key={p.eid} value={p.eid}>
              {periodOptionLabel(p)}
            </option>
          ))}
        </select>
      </label>
      {selectedOrg && typeof eid === "number" && (
        <span className="tools-hint" style={{ alignSelf: "end" }}>
          {selectedOrg.name}
        </span>
      )}
    </div>
  );
}

/** Org-only select (no period). */
export function OrgSelect({
  value,
  onChange,
  label = "Организация",
  allowEmpty = true,
  emptyLabel = "— нет —",
  disabled = false,
  orgs: orgsProp,
}: {
  value: IdOrEmpty;
  onChange: (zid: IdOrEmpty) => void;
  label?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
  orgs?: Organization[];
}) {
  const [orgsLocal, setOrgsLocal] = useState<Organization[]>([]);
  const orgs = orgsProp ?? orgsLocal;

  useEffect(() => {
    if (orgsProp) return;
    let cancelled = false;
    void listOrganizations()
      .then((list) => {
        if (!cancelled) setOrgsLocal(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgsProp]);

  return (
    <label>
      {label}
      <select
        value={value === "" ? "" : String(value)}
        disabled={disabled}
        onChange={(e) =>
          onChange(e.target.value === "" ? "" : Number(e.target.value))
        }
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {orgs.map((o) => (
          <option key={o.zid} value={o.zid}>
            {orgOptionLabel(o)}
          </option>
        ))}
      </select>
    </label>
  );
}
