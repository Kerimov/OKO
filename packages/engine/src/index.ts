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
  extractCellSvRefs,
  formatCheckErrorMessage,
  normalizeCheckExpression,
  parseArithmetic,
  parseCellCall,
  parseCellSvCall,
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
  runChecksOnInstances,
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
  cellMaskIsEmpty,
  cellMatchesMask,
  colorFieldKey,
  columnsFromCorrespondenceSpec,
  corrFieldKey,
  emptyCellMask,
  parseCorrespondenceSpec,
  parseReorgUpdateFlag,
  unionCellMasks,
  type CorrespondenceCellMask,
  type CorrespondenceColor,
} from "./correspondenceSpec.js";

export {
  mergeRules,
  recalcRows,
  recalcRowsFull,
  type RecalcRule,
  type RowFormula,
} from "./recalcEngine.js";

export {
  applySaldoDetailedRules,
  compareSaldoDetailedRules,
  ruleMatchesSaldoType,
  applySaldoToTarget,
  compareSaldoColumns,
  compareSaldoWithColumns,
  copySaldoColumns,
  parseSaldoColumnRule,
  transferSaldoWithColumns,
  type SaldoCellDiff,
  type SaldoCompareResult,
  type SaldoDetailedRule,
  type SaldoPhase,
  type SaldoTransferResult,
} from "./saldoEngine.js";

export {
  ACC_FORM_IDS,
  ACC_STR_SLOTS,
  BALANCE_FORM_ID,
  buildTempAccountRows,
  validateAggrAccountPackage,
  validateAggrAccounts,
  type AccFormId,
  type AggrAccountFormReport,
  type AggrAccountIssue,
  type AggrAccountValidation,
  type TempAccountRow,
} from "./aggrSetAccount.js";

export {
  BALANCE_AFTER_COL,
  BALANCE_AGGR_ADJ_COL,
  BALANCE_CLOSING_COL,
  DEFAULT_UNCHECKING_ROWS,
  FILL_BALANCE_SOURCE_FORM,
  aggregateTempByBalanceRow,
  checkRelationsAccRows,
  fillBalanceRows,
  type FillBalanceRowsResult,
  type RelCheckDetail,
  type RelCheckRow,
  type RelationsAccRowsResult,
} from "./balanceRelations.js";

export {
  numVal,
  rashThresholdLevel,
  sumRowNumeric,
  type RashThresholds,
} from "./rashCore.js";
