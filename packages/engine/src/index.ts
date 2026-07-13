export type { RowData, OkoFormInstance, FormColumn, FormSchema, FormMeta } from "./types.js";

export {
  CheckParseError,
  cellGetterToContext,
  combineCheckExpression,
  evaluateCheckExpression,
  evaluateCondition,
  evaluateEquality,
  evaluateExpr,
  expressionUsesForm,
  extractCellKRefs,
  extractCellRefs,
  formatCheckErrorMessage,
  normalizeCheckExpression,
  parseArithmetic,
  parseCellCall,
  type CellGetter,
  type CellKRef,
  type CellRef,
  type CheckEvalResult,
  type EvalContext,
  type Expr,
} from "./cellExpression.js";

export {
  evalContextFromInstances,
  formsUsedByFormChecks,
  latestInstancePerTemplate,
  runFormChecksWithData,
  type CheckMode,
  type CheckResultItem,
  type CheckRule,
  type CheckRunResult,
} from "./checkRunCore.js";

export { cellErrorKey, failedCellsForForm } from "./cellErrors.js";

export {
  aggregateInstances,
  type AggregateOptions,
  type AggregateResult,
} from "./aggregateEngine.js";

export {
  mergeRules,
  recalcRows,
  recalcRowsFull,
  type RecalcRule,
  type RowFormula,
} from "./recalcEngine.js";

export {
  applySaldoDetailedRules,
  applySaldoToTarget,
  copySaldoColumns,
  parseSaldoColumnRule,
  transferSaldoWithColumns,
  type SaldoDetailedRule,
  type SaldoPhase,
  type SaldoTransferResult,
} from "./saldoEngine.js";

export {
  numVal,
  rashThresholdLevel,
  sumRowNumeric,
  type RashThresholds,
} from "./rashCore.js";
