import fs from "fs";
import path from "path";
import {
  ACC_FORM_IDS,
  BALANCE_FORM_ID,
  checkRequiredSch,
  runChecksOnInstances,
  type CheckRule,
  type RequiredSchItem,
  type RequiredRowSlotItem,
} from "@oko/engine";
import type { OkoDb } from "./oko-db.js";
import { normalizePackageKind, type PackageKind } from "./businessProcessTypes.js";
import { evaluateCheckNotation12, parseCheckNotation12 } from "./checkNotation12.js";
import { listActivePackageRules } from "./checkRulesRegistry.js";
import { appendCheckRunJournal } from "./checkJournal.js";
import { findInstanceIdByPackageTemplate, loadInstance, loadInstancesForPackage } from "./instances.js";
import { exportChecksPayload } from "./checks.js";
import { ROOT } from "./paths.js";
import type { OkoFormInstance } from "./types.js";

export interface PackageCheckRunResult {
  runId: string;
  packageKind: PackageKind;
  passed: number;
  failed: number;
  results: Array<{
    code: string;
    passed: boolean;
    left?: number | null;
    right?: number | null;
    message: string;
    requiresExplanation: boolean;
    checkType?: string;
  }>;
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(result) ? result : null;
}

async function loadPackageInstances(
  db: OkoDb,
  zid: number,
  eid: number
): Promise<OkoFormInstance[]> {
  return loadInstancesForPackage(db, zid, eid);
}

function loadRequiredSchItems(): RequiredSchItem[] {
  const candidates = [
    path.join(ROOT, "server", "data", "required-sch.json"),
    path.join(ROOT, "portal", "public", "data", "required-sch.json"),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
        items?: RequiredSchItem[];
      };
      if (Array.isArray(raw.items) && raw.items.length) return raw.items;
    } catch {
      /* try next */
    }
  }
  return [];
}

function loadRequiredRowSlots(): RequiredRowSlotItem[] {
  const file = path.join(ROOT, "portal", "public", "data", "rash-refs.json");
  try {
    if (!fs.existsSync(file)) return [];
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      byName?: { tblRequiredRow?: Array<{ kod?: string; value?: string }> };
    };
    const list = raw.byName?.tblRequiredRow;
    if (!Array.isArray(list)) return [];
    return list
      .map((x) => ({
        account: String(x.kod ?? "").trim(),
        slot: Number(x.value),
      }))
      .filter((x) => x.account && Number.isFinite(x.slot) && x.slot > 0);
  } catch {
    return [];
  }
}

function pickAccessPeriodRules(checks: CheckRule[]): CheckRule[] {
  return checks.filter(
    (c) =>
      !!c.expression &&
      !!c.periodActive &&
      !c.forAggrOnly
  );
}

export async function runPackageChecks(
  db: OkoDb,
  input: {
    zid: number;
    eid: number;
    packageKind?: PackageKind;
    actor?: string | null;
    /** Access Cell() mode: period (default) | active | all period+active */
    accessMode?: "period" | "active" | "all";
  }
): Promise<PackageCheckRunResult> {
  const packageKind = normalizePackageKind(input.packageKind);
  const zid = Number(input.zid);
  const eid = Number(input.eid);
  const results: PackageCheckRunResult["results"] = [];

  const instances = await loadPackageInstances(db, zid, eid);

  // ── 1) Access a_tblchecks (period_active) ───────────────────────────
  const accessMode = input.accessMode ?? "period";
  try {
    let checks = (await exportChecksPayload(db)).checks as CheckRule[];
    // Methodology pin for period, if any
    try {
      const { getPeriodRow } = await import("./periodLifecycle.js");
      const { getMethodologyReleaseById } = await import("./methodology.js");
      const period = await getPeriodRow(db, eid, zid);
      if (period?.methodology_release_id) {
        const release = await getMethodologyReleaseById(
          db,
          period.methodology_release_id
        );
        if (release?.checks && Array.isArray(release.checks)) {
          checks = release.checks as CheckRule[];
        }
      }
    } catch {
      /* live checks */
    }

    let accessRules: CheckRule[];
    if (accessMode === "all") {
      accessRules = checks.filter(
        (c) => !!c.expression && !c.forAggrOnly && (c.periodActive || c.active)
      );
    } else if (accessMode === "active") {
      accessRules = checks.filter(
        (c) => !!c.expression && !c.forAggrOnly && (c.active || c.periodActive)
      );
    } else {
      accessRules = pickAccessPeriodRules(checks);
    }

    const accessResult = runChecksOnInstances(accessRules, instances);
    for (const item of accessResult.items) {
      const logicalFail = !item.passed && !item.parseError;
      // Parse/skip (often empty cells) — report but do not count as hard fail for package summary
      // Matching submitInstanceWithChecks: only failed (not parseError) blocks.
      results.push({
        code: `access-${item.number}`,
        passed: !!item.passed,
        left: Number.isFinite(item.left) ? item.left : null,
        right: Number.isFinite(item.right) ? item.right : null,
        message: item.parseError
          ? item.error ?? `Правило ${item.number}: ошибка разбора`
          : item.passed
            ? `OK #${item.number}`
            : `FAIL #${item.number}: ${item.message ?? item.failedClause ?? "увязка"}`,
        requiresExplanation: logicalFail,
        checkType: item.parseError ? "access_parse" : "access_cell",
      });
    }
  } catch (e) {
    results.push({
      code: "access-load",
      passed: false,
      message: e instanceof Error ? e.message : "Не удалось загрузить увязки Access",
      requiresExplanation: false,
      checkType: "access_cell",
    });
  }

  // ── 2) Appendix 12 registry (when imported) ─────────────────────────
  const context = (await db
    .prepare(
      `SELECT p.year, o.guid FROM periods p
       LEFT JOIN organizations o ON o.zid = p.zid
       WHERE p.zid = ? AND p.eid = ? LIMIT 1`
    )
    .get(zid, eid)) as { year: number | null; guid: string | null } | undefined;
  const appendixRules = await listActivePackageRules(db, {
    packageKind,
    year: context?.year == null ? null : Number(context.year),
    organizationGuid: context?.guid ?? null,
  });
  const byTemplate = new Map<string, OkoFormInstance>();
  for (const inst of instances) {
    if (!byTemplate.has(inst.templateId)) byTemplate.set(inst.templateId, inst);
  }
  const resolve = (formId: string, column: string, row: string): number | null => {
    const rows = byTemplate.get(formId)?.rows;
    const rowData = rows?.find((candidate) =>
      [candidate.num, candidate.code, candidate.account, candidate.name].some(
        (value) => String(value ?? "").trim() === row
      )
    );
    return rowData ? numeric(rowData[column]) : null;
  };
  for (const rule of appendixRules) {
    const parsed = parseCheckNotation12(rule.expressionRaw);
    if (!parsed.ok || !parsed.ast) {
      results.push({
        code: rule.code,
        passed: false,
        message: `parse error: ${parsed.error}`,
        requiresExplanation: rule.type === "explain",
        checkType: "appendix12",
      });
      continue;
    }
    const evaluated = evaluateCheckNotation12(parsed.ast, resolve);
    results.push({
      code: rule.code,
      passed: evaluated.passed,
      left: evaluated.left,
      right: evaluated.right,
      message: evaluated.passed
        ? `OK ${rule.code}`
        : `FAIL ${rule.code}: ${evaluated.left ?? "missing"} vs ${evaluated.right ?? "missing"}`,
      requiresExplanation: rule.type === "explain",
      checkType: "appendix12",
    });
  }

  // ── 3) tblRequiredSch + tblRequiredRow ──────────────────────────────
  const schItems = loadRequiredSchItems();
  const rowSlots = loadRequiredRowSlots();
  if (schItems.length || rowSlots.length) {
    const forms: Partial<Record<(typeof ACC_FORM_IDS)[number], OkoFormInstance["rows"]>> =
      {};
    for (const formId of ACC_FORM_IDS) {
      const inst =
        byTemplate.get(formId) ??
        (await (async () => {
          const id = await findInstanceIdByPackageTemplate(db, zid, eid, formId);
          return id ? loadInstance(db, id) : null;
        })());
      if (inst) {
        byTemplate.set(formId, inst);
        forms[formId] = inst.rows;
      }
    }
    let balInst = byTemplate.get(BALANCE_FORM_ID);
    if (!balInst) {
      const id = await findInstanceIdByPackageTemplate(
        db,
        zid,
        eid,
        BALANCE_FORM_ID
      );
      balInst = id ? (await loadInstance(db, id)) ?? undefined : undefined;
      if (balInst) byTemplate.set(BALANCE_FORM_ID, balInst);
    }
    const sch = checkRequiredSch({
      items: schItems,
      requiredRowSlots: rowSlots,
      forms,
      balanceRows: balInst?.rows ?? null,
    });
    if (sch.checkedAccounts === 0 && sch.issues.length === 0) {
      results.push({
        code: "required-sch",
        passed: true,
        message: "Обязательные счета/строки: нет активных счетов для проверки",
        requiresExplanation: false,
        checkType: "required_sch",
      });
    } else if (sch.ok) {
      results.push({
        code: "required-sch",
        passed: true,
        message: `Обязательные счета/строки: OK (${sch.checkedAccounts} сч.)`,
        requiresExplanation: false,
        checkType: "required_sch",
      });
    } else {
      for (const issue of sch.issues) {
        results.push({
          code: `required-sch-${issue.account}-${issue.row ?? "x"}`,
          passed: false,
          message: issue.message,
          requiresExplanation: false,
          checkType: "required_sch",
        });
      }
    }
  }

  const hardResults = results.filter((r) => {
    if (r.checkType === "access_parse") return false;
    return true;
  });
  const failed = hardResults.filter((r) => !r.passed).length;
  const passed = hardResults.filter((r) => r.passed).length;

  const journal = await appendCheckRunJournal(db, {
    zid,
    eid,
    packageKind,
    actor: input.actor ?? null,
    results: [
      {
        checkType: "package_run",
        passed: failed === 0,
        message: `Package run: access+appendix12+required_sch — ${passed} ok / ${failed} fail (всего позиций ${results.length})`,
      },
      ...results.map((result) => ({
        ruleNumber: Number(String(result.code).replace(/\D+/g, "")) || null,
        ruleCode: result.code,
        checkType: result.checkType ?? "package",
        passed: result.passed,
        leftValue: result.left ?? null,
        rightValue: result.right ?? null,
        message: result.message,
        requiresExplanation: !result.passed && result.requiresExplanation,
      })),
    ],
  });

  return {
    runId: journal.runId,
    packageKind,
    passed,
    failed,
    results,
  };
}
