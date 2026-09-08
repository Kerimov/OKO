import { loadWorkContext, listOrganizations, listPeriods } from "../packagesApi";
import { loadGlobalMeta, listInstances, loadInstance } from "../storage";
import type { InstanceSummary, OkoFormInstance } from "../types";

function numId(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function summaryMatchesWork(
  s: InstanceSummary,
  zid: number,
  eid: number,
  periodStart: string,
  periodEnd: string,
  orgName: string
): boolean {
  const sz = numId(s.zid);
  const se = numId(s.eid);
  if (sz != null && se != null) return sz === zid && se === eid;
  if (!orgName) return false;
  return (
    s.organization === orgName &&
    (!periodStart || s.periodStart === periodStart) &&
    (!periodEnd || s.periodEnd === periodEnd)
  );
}

async function loadInstancesFromSummaries(
  summaries: InstanceSummary[],
  zid: number | null,
  eid: number | null
): Promise<OkoFormInstance[]> {
  const instances: OkoFormInstance[] = [];
  for (const s of summaries) {
    const inst = await loadInstance(s.instanceId);
    if (!inst) continue;
    instances.push({
      ...inst,
      zid: numId(inst.zid) ?? zid,
      eid: numId(inst.eid) ?? eid,
    });
  }
  return instances;
}

/** Forms of the current work package (ZID/EID from Комплект), for JSON export/import. */
export async function loadWorkPackageInstances(): Promise<{
  instances: OkoFormInstance[];
  zid: number | null;
  eid: number | null;
}> {
  const work = await loadWorkContext();
  const zid = numId(work.zid);
  const eid = numId(work.eid);

  if (zid == null || eid == null) {
    const meta = await loadGlobalMeta();
    const all = await listInstances();
    const filtered = all.filter(
      (s) =>
        (!meta.periodStart || s.periodStart === meta.periodStart) &&
        (!meta.periodEnd || s.periodEnd === meta.periodEnd)
    );
    const instances = await loadInstancesFromSummaries(filtered, null, null);
    return { instances, zid: null, eid: null };
  }

  let summaries = await listInstances({ zid, eid });

  if (summaries.length === 0) {
    const [all, orgs, periods] = await Promise.all([
      listInstances(),
      listOrganizations(),
      listPeriods(zid),
    ]);
    const period = periods.find((p) => numId(p.eid) === eid);
    const org = orgs.find((o) => numId(o.zid) === zid);
    summaries = all.filter((s) =>
      summaryMatchesWork(
        s,
        zid,
        eid,
        period?.periodStart ?? "",
        period?.periodEnd ?? "",
        org?.name ?? ""
      )
    );
  }

  const instances = await loadInstancesFromSummaries(summaries, zid, eid);
  return { instances, zid, eid };
}
