export const FORMULA_LIMITS = {
  maxLength: 2_000,
  maxRefs: 200,
  maxDepth: 32,
  maxEvalMs: 250,
  maxCellsPerPatch: 5_000,
} as const;

export function assertFormulaLimits(formula: string, refCount: number): void {
  if (formula.length > FORMULA_LIMITS.maxLength) {
    throw new Error(
      `Формула слишком длинная (${formula.length} > ${FORMULA_LIMITS.maxLength})`
    );
  }
  if (refCount > FORMULA_LIMITS.maxRefs) {
    throw new Error(
      `Слишком много ссылок в формуле (${refCount} > ${FORMULA_LIMITS.maxRefs})`
    );
  }
}
