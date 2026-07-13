/** Cell reference: Cell("FormId","Column",RowNo) */
export interface CellRef {
  form: string;
  column: string;
  row: number;
}

export interface CellKRef {
  form: string;
  column: string;
  condition: string;
  rowKey: string;
}

export type Expr =
  | { kind: "cell"; ref: CellRef }
  | { kind: "cellk"; ref: CellKRef }
  | { kind: "total"; form: string; column: string }
  | { kind: "number"; value: number }
  | { kind: "binop"; op: "+" | "-" | "*"; left: Expr; right: Expr }
  | { kind: "clng"; inner: Expr };

export type CellGetter = (form: string, column: string, row: number) => number;

export interface EvalContext {
  getCell: CellGetter;
  getCellK: (form: string, column: string, condition: string, rowKey: string) => number;
  getTotal: (form: string, column: string) => number;
}

export function cellGetterToContext(get: CellGetter): EvalContext {
  return { getCell: get, getCellK: () => 0, getTotal: () => 0 };
}

export class CheckParseError extends Error {
  readonly userMessage: string;
  constructor(userMessage: string, detail?: string) {
    super(detail ?? userMessage);
    this.name = "CheckParseError";
    this.userMessage = userMessage;
  }
}

const CELL_RE =
  /Cell\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*("?)(\d+)\3\s*\)/g;
const CELLK_RE = /CellK\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g;

export function parseCellCall(raw: string): CellRef | null {
  const m = /^Cell\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*("?)(\d+)\3\s*\)$/.exec(
    raw.trim()
  );
  if (!m) return null;
  return { form: m[1], column: m[2], row: parseInt(m[4], 10) };
}

function parseTotalCall(raw: string): { form: string; column: string } | null {
  const m = /^TOTAL\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)$/i.exec(raw.trim());
  if (!m) return null;
  return { form: m[1], column: m[2] };
}

function parseCellKCall(raw: string): CellKRef | null {
  const m =
    /^CellK\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)$/.exec(
      raw.trim()
    );
  if (!m) return null;
  return { form: m[1], column: m[2], condition: m[3], rowKey: m[4] };
}

/** Normalize VBA-style keywords and spacing quirks from MDB export. */
export function normalizeCheckExpression(expr: string): string {
  let s = expr.trim();
  s = s.replace(/\bAND\b/gi, " and ");
  s = s.replace(/\bOR\b/gi, " or ");
  s = s.replace(/\band\b/gi, " and ");
  s = s.replace(/\bor\b/gi, " or ");
  s = s.replace(/\s+/g, " ");
  s = s.replace(/(\d)and /gi, "$1 and ");
  s = s.replace(/(\d)or /gi, "$1 or ");
  return s.trim();
}

type Tok =
  | { t: "cell"; ref: CellRef }
  | { t: "cellk"; ref: CellKRef }
  | { t: "total"; form: string; column: string }
  | { t: "num"; v: number }
  | { t: "op"; op: "+" | "-" | "*" }
  | { t: "lp" }
  | { t: "rp" };

function sliceBalancedCall(s: string, start: number): string {
  let depth = 0;
  for (let j = start; j < s.length; j++) {
    if (s[j] === "(") depth++;
    if (s[j] === ")") {
      depth--;
      if (depth === 0) return s.slice(start, j + 1);
    }
  }
  throw new CheckParseError(
    "Незакрытая скобка в выражении",
    `Unclosed call at ${start}`
  );
}

function tokenizeArithmetic(expr: string): Tok[] {
  const tokens: Tok[] = [];
  let i = 0;
  const s = expr.trim();

  while (i < s.length) {
    if (/\s/.test(s[i])) {
      i++;
      continue;
    }
    if (s[i] === "(") {
      tokens.push({ t: "lp" });
      i++;
      continue;
    }
    if (s[i] === ")") {
      tokens.push({ t: "rp" });
      i++;
      continue;
    }
    if (s[i] === "+" || s[i] === "-" || s[i] === "*") {
      tokens.push({ t: "op", op: s[i] as "+" | "-" | "*" });
      i++;
      continue;
    }
    if (s.startsWith("TOTAL(", i) || s.startsWith("total(", i)) {
      const chunk = sliceBalancedCall(s, i);
      const ref = parseTotalCall(chunk);
      if (!ref) {
        throw new CheckParseError(
          "Некорректный вызов TOTAL",
          `Invalid TOTAL: ${chunk}`
        );
      }
      tokens.push({ t: "total", form: ref.form, column: ref.column });
      i += chunk.length;
      continue;
    }
    if (s.startsWith("CellK(", i)) {
      const chunk = sliceBalancedCall(s, i);
      const ref = parseCellKCall(chunk);
      if (!ref) {
        throw new CheckParseError(
          "Некорректный вызов CellK",
          `Invalid CellK: ${chunk}`
        );
      }
      tokens.push({ t: "cellk", ref });
      i += chunk.length;
      continue;
    }
    if (s.startsWith("Cell(", i)) {
      const chunk = sliceBalancedCall(s, i);
      const ref = parseCellCall(chunk);
      if (!ref) {
        throw new CheckParseError(
          "Некорректный вызов Cell",
          `Invalid Cell: ${chunk}`
        );
      }
      tokens.push({ t: "cell", ref });
      i += chunk.length;
      continue;
    }
    const numM = /^[\d.]+/.exec(s.slice(i));
    if (numM) {
      tokens.push({ t: "num", v: parseFloat(numM[0]) });
      i += numM[0].length;
      continue;
    }
    throw new CheckParseError(
      "Выражение содержит неподдерживаемую конструкцию",
      `Unexpected at ${i}: ${s.slice(i, i + 30)}`
    );
  }
  return tokens;
}

function parseArithmeticFromTokens(tokens: Tok[]): Expr {
  if (tokens.length === 0) return { kind: "number", value: 0 };
  const [node, p] = parseAdd(tokens, 0);
  if (p !== tokens.length) {
    throw new CheckParseError(
      "Лишние символы в арифметическом выражении",
      "Trailing tokens"
    );
  }
  return node;
}

function parseAdd(tokens: Tok[], pos: number): [Expr, number] {
  let [node, p] = parseMul(tokens, pos);
  while (p < tokens.length && tokens[p].t === "op") {
    const opTok = tokens[p] as { t: "op"; op: "+" | "-" | "*" };
    if (opTok.op === "*") break;
    const [right, p2] = parseMul(tokens, p + 1);
    node = { kind: "binop", op: opTok.op, left: node, right };
    p = p2;
  }
  return [node, p];
}

function parseMul(tokens: Tok[], pos: number): [Expr, number] {
  let [node, p] = parseUnary(tokens, pos);
  while (p < tokens.length && tokens[p].t === "op") {
    const opTok = tokens[p] as { t: "op"; op: "+" | "-" | "*" };
    if (opTok.op !== "*") break;
    const [right, p2] = parseUnary(tokens, p + 1);
    node = { kind: "binop", op: "*", left: node, right };
    p = p2;
  }
  return [node, p];
}

function parseUnary(tokens: Tok[], pos: number): [Expr, number] {
  if (pos < tokens.length && tokens[pos].t === "op") {
    const op = (tokens[pos] as { t: "op"; op: "+" | "-" | "*" }).op;
    if (op === "-") {
      const [inner, p] = parseUnary(tokens, pos + 1);
      return [
        {
          kind: "binop",
          op: "-",
          left: { kind: "number", value: 0 },
          right: inner,
        },
        p,
      ];
    }
  }
  return parsePrimary(tokens, pos);
}

function parsePrimary(tokens: Tok[], pos: number): [Expr, number] {
  if (pos >= tokens.length) {
    throw new CheckParseError("Незавершённое выражение", "Unexpected end");
  }
  const tok = tokens[pos];
  if (tok.t === "cell") return [{ kind: "cell", ref: tok.ref }, pos + 1];
  if (tok.t === "cellk") return [{ kind: "cellk", ref: tok.ref }, pos + 1];
  if (tok.t === "total")
    return [{ kind: "total", form: tok.form, column: tok.column }, pos + 1];
  if (tok.t === "num") return [{ kind: "number", value: tok.v }, pos + 1];
  if (tok.t === "lp") {
    const [inner, p] = parseAdd(tokens, pos + 1);
    if (tokens[p]?.t !== "rp") {
      throw new CheckParseError("Ожидалась закрывающая скобка", "Expected )");
    }
    return [inner, p + 1];
  }
  throw new CheckParseError(
    "Некорректное выражение",
    `Unexpected token ${JSON.stringify(tok)}`
  );
}

/** Parse arithmetic; supports Clng(...), *, +, -, Cell(), CellK(), numbers. */
export function parseArithmetic(expr: string): Expr {
  const trimmed = expr.trim();
  const clngM = /^Clng\s*\((.*)\)$/is.exec(trimmed);
  if (clngM) {
    return { kind: "clng", inner: parseArithmetic(clngM[1]) };
  }
  return parseArithmeticFromTokens(tokenizeArithmetic(trimmed));
}

export function evaluateExpr(expr: Expr, ctx: EvalContext): number {
  switch (expr.kind) {
    case "number":
      return expr.value;
    case "cell":
      return ctx.getCell(expr.ref.form, expr.ref.column, expr.ref.row);
    case "cellk":
      return ctx.getCellK(
        expr.ref.form,
        expr.ref.column,
        expr.ref.condition,
        expr.ref.rowKey
      );
    case "total":
      return ctx.getTotal(expr.form, expr.column);
    case "clng":
      return Math.round(evaluateExpr(expr.inner, ctx));
    case "binop": {
      const l = evaluateExpr(expr.left, ctx);
      const r = evaluateExpr(expr.right, ctx);
      if (expr.op === "+") return l + r;
      if (expr.op === "-") return l - r;
      return l * r;
    }
  }
}

type CompareOp = "=" | "<>" | ">=" | "<=" | ">" | "<";

export interface CheckEvalResult {
  ok: boolean;
  left: number;
  right: number;
  failedClause?: string;
  failedOp?: CompareOp;
}

type BoolNode =
  | { kind: "cmp"; op: CompareOp; left: string; right: string }
  | { kind: "and"; parts: BoolNode[] }
  | { kind: "or"; parts: BoolNode[] };

function isWordBoundary(s: string, i: number, word: string): boolean {
  const before = i === 0 || /\s/.test(s[i - 1]);
  const after = i + word.length >= s.length || /\s/.test(s[i + word.length]);
  return before && after && s.slice(i, i + word.length).toLowerCase() === word;
}

function splitTopLevelBool(input: string, word: "and" | "or"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr = false;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && isWordBoundary(input, i, word)) {
      parts.push(input.slice(start, i).trim());
      start = i + word.length;
      i += word.length - 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts.filter(Boolean);
}

function parseBoolExpr(input: string): BoolNode {
  const trimmed = input.trim();
  if (trimmed.startsWith("(") && matchingCloseParen(trimmed, 0) === trimmed.length - 1) {
    return parseBoolExpr(trimmed.slice(1, -1).trim());
  }

  const orParts = splitTopLevelBool(trimmed, "or");
  if (orParts.length > 1) {
    return { kind: "or", parts: orParts.map(parseBoolExpr) };
  }

  const andParts = splitTopLevelBool(trimmed, "and");
  if (andParts.length > 1) {
    return { kind: "and", parts: andParts.map(parseBoolExpr) };
  }

  const cmp = splitCompare(trimmed);
  if (!cmp) {
    throw new CheckParseError(
      "Не найдено сравнение в части выражения",
      `No comparison in: ${trimmed}`
    );
  }
  return { kind: "cmp", ...cmp };
}

function matchingCloseParen(s: string, openIdx: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitCompare(input: string): { op: CompareOp; left: string; right: string } | null {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth !== 0) continue;

    if (input.slice(i, i + 2) === "<=") {
      return { op: "<=", left: input.slice(0, i).trim(), right: input.slice(i + 2).trim() };
    }
    if (input.slice(i, i + 2) === ">=") {
      return { op: ">=", left: input.slice(0, i).trim(), right: input.slice(i + 2).trim() };
    }
    if (input.slice(i, i + 2) === "<>") {
      return { op: "<>", left: input.slice(0, i).trim(), right: input.slice(i + 2).trim() };
    }
    if (ch === "<") {
      return { op: "<", left: input.slice(0, i).trim(), right: input.slice(i + 1).trim() };
    }
    if (ch === ">") {
      return { op: ">", left: input.slice(0, i).trim(), right: input.slice(i + 1).trim() };
    }
    if (ch === "=") {
      return { op: "=", left: input.slice(0, i).trim(), right: input.slice(i + 1).trim() };
    }
  }
  return null;
}

function compareValues(
  op: CompareOp,
  left: number,
  right: number,
  tolerance = 0.005
): boolean {
  switch (op) {
    case "=":
      return Math.abs(left - right) <= tolerance;
    case "<>":
      return Math.abs(left - right) > tolerance;
    case ">=":
      return left >= right - tolerance;
    case "<=":
      return left <= right + tolerance;
    case ">":
      return left > right + tolerance;
    case "<":
      return left < right - tolerance;
  }
}

function evaluateBoolNode(
  node: BoolNode,
  ctx: EvalContext,
  tolerance: number
): CheckEvalResult {
  if (node.kind === "and") {
    let last: CheckEvalResult = { ok: true, left: 0, right: 0 };
    for (const part of node.parts) {
      last = evaluateBoolNode(part, ctx, tolerance);
      if (!last.ok) return last;
    }
    return last;
  }
  if (node.kind === "or") {
    let lastFail: CheckEvalResult = { ok: false, left: 0, right: 0 };
    for (const part of node.parts) {
      const r = evaluateBoolNode(part, ctx, tolerance);
      if (r.ok) return r;
      lastFail = r;
    }
    return lastFail;
  }

  const left = evaluateExpr(parseArithmetic(node.left), ctx);
  const right = evaluateExpr(parseArithmetic(node.right), ctx);
  const ok = compareValues(node.op, left, right, tolerance);
  return {
    ok,
    left,
    right,
    failedClause: ok ? undefined : `${node.left} ${node.op} ${node.right}`,
    failedOp: ok ? undefined : node.op,
  };
}

export function evaluateCondition(
  condition: string,
  ctx: EvalContext,
  tolerance = 0.005
): CheckEvalResult {
  const normalized = normalizeCheckExpression(condition);
  return evaluateBoolNode(parseBoolExpr(normalized), ctx, tolerance);
}

/** Evaluate full check rule (supports and / or / parentheses). */
export function evaluateCheckExpression(
  expression: string,
  ctx: EvalContext | CellGetter,
  tolerance = 0.005
): CheckEvalResult {
  const evalCtx = typeof ctx === "function" ? cellGetterToContext(ctx) : ctx;
  const normalized = normalizeCheckExpression(expression);
  return evaluateBoolNode(parseBoolExpr(normalized), evalCtx, tolerance);
}

/** @deprecated use evaluateCheckExpression */
export function evaluateEquality(
  expression: string,
  ctx: EvalContext | CellGetter,
  tolerance = 0.005
): CheckEvalResult {
  return evaluateCheckExpression(expression, ctx, tolerance);
}

export function extractCellRefs(expression: string): CellRef[] {
  const refs: CellRef[] = [];
  CELL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CELL_RE.exec(expression)) !== null) {
    refs.push({ form: m[1], column: m[2], row: parseInt(m[4], 10) });
  }
  return refs;
}

export function extractCellKRefs(expression: string): CellKRef[] {
  const refs: CellKRef[] = [];
  CELLK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CELLK_RE.exec(expression)) !== null) {
    refs.push({ form: m[1], column: m[2], condition: m[3], rowKey: m[4] });
  }
  return refs;
}

export function expressionUsesForm(expression: string, formId: string): boolean {
  if (extractCellRefs(expression).some((r) => r.form === formId)) return true;
  return extractCellKRefs(expression).some((r) => r.form === formId);
}

/** Join LExpCheck + LExpCheck2 fragments from MDB (long rules split across two fields). */
export function combineCheckExpression(
  expression: string,
  expressionAlt?: string | null
): string {
  const base = expression.trim();
  if (!expressionAlt?.trim()) return base;
  const alt = expressionAlt.replace(/\r\n/g, " ").replace(/\s+/g, " ").trim();
  const isContinuation =
    /Cell\s*\(|CellK\s*\(/i.test(alt) ||
    /^[+(\-]/i.test(alt) ||
    /^(and|or)\b/i.test(alt) ||
    /\b(and|or)\s*$/i.test(base) ||
    /[+\-]$/.test(base);
  if (!isContinuation) return base;
  return `${base} ${alt}`.trim();
}

export function formatCheckErrorMessage(
  ruleNumber: number,
  message: string | null | undefined,
  err: unknown
): string {
  if (err instanceof CheckParseError) {
    return message?.trim()
      ? `${message} (правило №${ruleNumber}: ${err.userMessage})`
      : `Правило №${ruleNumber}: ${err.userMessage}`;
  }
  if (message?.trim()) return message;
  if (err instanceof Error && err.message) {
    return `Правило №${ruleNumber}: ${err.message}`;
  }
  return `Правило №${ruleNumber}: не удалось вычислить выражение`;
}
