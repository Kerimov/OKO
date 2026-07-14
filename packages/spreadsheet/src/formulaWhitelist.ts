/**
 * Stage-0 function whitelist for Excel-like formulas.
 * Anything outside this set is rejected (no network / volatile / external refs).
 */
export const FORMULA_WHITELIST = [
  "SUM",
  "IF",
  "AND",
  "OR",
  "NOT",
  "ROUND",
  "ABS",
  "MIN",
  "MAX",
  "COUNT",
  "COUNTA",
  "AVERAGE",
  "IFERROR",
  "DATE",
  "YEAR",
  "MONTH",
  "DAY",
] as const;

export type WhitelistedFormulaFn = (typeof FORMULA_WHITELIST)[number];

export const FORBIDDEN_FORMULA_TOKENS = [
  "HYPERLINK",
  "WEBSERVICE",
  "FILTERXML",
  "IMPORTXML",
  "INDIRECT",
  "OFFSET",
  "NOW",
  "TODAY",
  "RAND",
  "RANDBETWEEN",
  "CALL",
  "REGISTER",
  "EVALUATE",
  "SCRIPT",
] as const;

export function isWhitelistedFunction(name: string): boolean {
  return (FORMULA_WHITELIST as readonly string[]).includes(name.toUpperCase());
}

export function assertFormulaAllowed(raw: string): void {
  const upper = raw.toUpperCase();
  for (const bad of FORBIDDEN_FORMULA_TOKENS) {
    if (upper.includes(bad)) {
      throw new Error(`Функция ${bad} запрещена в формах OKO`);
    }
  }
  const calls = upper.matchAll(/\b([A-Z_][A-Z0-9_]*)\s*\(/g);
  for (const m of calls) {
    const fn = m[1];
    if (!isWhitelistedFunction(fn)) {
      throw new Error(`Функция ${fn} не входит в whitelist первой версии`);
    }
  }
}
