import { readPublicJson } from "./db/packageDb.js";

export async function loadChecks() {
  return readPublicJson("data/checks.json");
}

export async function loadRashRules() {
  return readPublicJson("data/rash-rules.json");
}

export async function loadRecalcRules() {
  return readPublicJson("data/recalc-rules.json");
}

export async function loadRowFormulas() {
  return readPublicJson("data/row-formulas.json");
}

export type { ChecksData, RecalcRulesData, RowFormulasData } from "../../portal/src/api";
