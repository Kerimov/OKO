import type { OkoFormInstance } from "../types";
import type { ReportPackage } from "./packageExport";

export type PackageDiffVerdict = "new" | "same" | "changed" | "only-local";

export interface PackageDiffRow {
  templateId: string;
  title: string;
  verdict: PackageDiffVerdict;
  selectedDefault: boolean;
  pkgStatus?: string;
  pkgRows?: number;
  pkgHash?: string;
  pkgUpdatedAt?: string;
  localStatus?: string;
  localRows?: number;
  localHash?: string;
  localUpdatedAt?: string;
  submittedLocal?: boolean;
}

/** Stable fingerprint of numeric/text cells for change detection. */
export function instanceContentHash(inst: OkoFormInstance): string {
  const parts: string[] = [];
  const rows = [...(inst.rows ?? [])].sort((a, b) =>
    String(a.num ?? "").localeCompare(String(b.num ?? ""), undefined, { numeric: true })
  );
  for (const row of rows) {
    const keys = Object.keys(row)
      .filter((k) => !["name"].includes(k))
      .sort();
    for (const k of keys) {
      const v = row[k];
      if (v === undefined || v === null || v === "") continue;
      parts.push(`${row.num ?? ""}:${k}=${String(v).trim()}`);
    }
  }
  const raw = parts.join("|");
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function buildPackageDiff(
  pkg: ReportPackage,
  localInstances: OkoFormInstance[],
  options?: { zid?: number | null; eid?: number | null }
): PackageDiffRow[] {
  const zid = options?.zid;
  const eid = options?.eid;
  const localByTpl = new Map<string, OkoFormInstance>();
  for (const inst of localInstances) {
    if (zid != null && inst.zid != null && inst.zid !== zid) continue;
    if (eid != null && inst.eid != null && inst.eid !== eid) continue;
    localByTpl.set(inst.templateId, inst);
  }

  const rows: PackageDiffRow[] = [];
  const seen = new Set<string>();

  for (const inst of pkg.instances) {
    if (!inst.templateId) continue;
    seen.add(inst.templateId);
    const local = localByTpl.get(inst.templateId);
    const pkgHash = instanceContentHash(inst);
    const pkgRows = inst.rows?.length ?? 0;
    if (!local) {
      rows.push({
        templateId: inst.templateId,
        title: inst.templateTitle || inst.displayName || inst.templateId,
        verdict: "new",
        selectedDefault: true,
        pkgStatus: inst.status,
        pkgRows,
        pkgHash,
        pkgUpdatedAt: inst.updatedAt,
      });
      continue;
    }
    const localHash = instanceContentHash(local);
    const same =
      pkgHash === localHash &&
      (inst.status === "submitted" ? "submitted" : "draft") ===
        (local.status === "submitted" ? "submitted" : "draft");
    rows.push({
      templateId: inst.templateId,
      title: inst.templateTitle || local.templateTitle || inst.templateId,
      verdict: same ? "same" : "changed",
      selectedDefault: !same,
      pkgStatus: inst.status,
      pkgRows,
      pkgHash,
      pkgUpdatedAt: inst.updatedAt,
      localStatus: local.status,
      localRows: local.rows?.length ?? 0,
      localHash,
      localUpdatedAt: local.updatedAt,
      submittedLocal: local.status === "submitted",
    });
  }

  for (const [templateId, local] of localByTpl) {
    if (seen.has(templateId)) continue;
    rows.push({
      templateId,
      title: local.templateTitle || local.displayName || templateId,
      verdict: "only-local",
      selectedDefault: false,
      localStatus: local.status,
      localRows: local.rows?.length ?? 0,
      localHash: instanceContentHash(local),
      localUpdatedAt: local.updatedAt,
      submittedLocal: local.status === "submitted",
    });
  }

  return rows.sort((a, b) => a.templateId.localeCompare(b.templateId));
}

export function verdictLabel(v: PackageDiffVerdict): string {
  switch (v) {
    case "new":
      return "новая";
    case "same":
      return "совпадает";
    case "changed":
      return "изменена";
    case "only-local":
      return "только локально";
  }
}

export interface PackageCellDiff {
  templateId: string;
  rowNum: string;
  column: string;
  packageValue: string | number | null;
  localValue: string | number | null;
}

function cellEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const empty = (v: unknown) => v === undefined || v === null || v === "";
  if (empty(a) && empty(b)) return true;
  if (empty(a) || empty(b)) return false;
  return String(a).trim() === String(b).trim();
}

/** Access frmCompare-style: differing cells for forms present in both kits. */
export function buildPackageCellDiffs(
  pkg: ReportPackage,
  localInstances: OkoFormInstance[],
  templateIds?: string[]
): PackageCellDiff[] {
  const allow = templateIds?.length ? new Set(templateIds) : null;
  const localByTpl = new Map(localInstances.map((i) => [i.templateId, i]));
  const diffs: PackageCellDiff[] = [];

  for (const pkgInst of pkg.instances) {
    if (!pkgInst.templateId) continue;
    if (allow && !allow.has(pkgInst.templateId)) continue;
    const local = localByTpl.get(pkgInst.templateId);
    if (!local) continue;

    const localByNum = new Map<string, (typeof local.rows)[0]>();
    for (const r of local.rows ?? []) {
      const n = String(r.num ?? "").trim();
      if (n) localByNum.set(n, r);
    }

    for (const row of pkgInst.rows ?? []) {
      const num = String(row.num ?? "").trim();
      if (!num) continue;
      const loc = localByNum.get(num);
      const keys = new Set([
        ...Object.keys(row),
        ...(loc ? Object.keys(loc) : []),
      ]);
      for (const col of keys) {
        if (col === "num" || col === "name") continue;
        const pv = row[col];
        const lv = loc?.[col];
        if (cellEq(pv, lv)) continue;
        if (
          (pv === undefined || pv === null || pv === "") &&
          (lv === undefined || lv === null || lv === "")
        ) {
          continue;
        }
        diffs.push({
          templateId: pkgInst.templateId,
          rowNum: num,
          column: col,
          packageValue:
            pv === undefined || pv === "" ? null : (pv as string | number),
          localValue:
            lv === undefined || lv === "" ? null : (lv as string | number),
        });
      }
    }
  }

  return diffs;
}

