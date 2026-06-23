import { loadChecks, loadRashRules, loadRecalcRules, loadRowFormulas } from "../api";
import type { ChecksData, RecalcRulesData, RowFormulasData } from "../api";
import { loadKontrAgents } from "../storage";
import type { KontrAgent, RashRulesData } from "../types";

/** Правила и справочники, выгружаемые ЦО вместе с комплектом для дочки. */
export interface PackageRulesBundle {
  exportedAt: string;
  checks?: ChecksData;
  rash?: RashRulesData;
  recalc?: RecalcRulesData;
  rowFormulas?: RowFormulasData;
  kontr?: { items: KontrAgent[] };
}

/** Актуальные правила с портала (БД или JSON-фолбэк). */
export async function loadPackageRulesBundle(): Promise<PackageRulesBundle> {
  const [checks, rash, recalc, rowFormulas, kontrItems] = await Promise.all([
    loadChecks(),
    loadRashRules(),
    loadRecalcRules(),
    loadRowFormulas(),
    loadKontrAgents(),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    checks,
    rash,
    recalc,
    rowFormulas,
    kontr: { items: kontrItems },
  };
}
