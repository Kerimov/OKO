/**
 * Lightweight DSL for Appendix 12 check notation.
 * Supports expressions used in TZ examples without inventing full VBA semantics.
 *
 * Grammar (subset):
 *   FORM.COL[ROW]                 cell ref
 *   SUM(FORM.COL[ROW..ROW])       range sum
 *   LEFT = RIGHT | LEFT <> RIGHT | LEFT > RIGHT | ...
 *   IF(COND; THEN_CHECK)          conditional check
 *   ABS(expr)
 */

export type CheckDslAst =
  | { type: "cmp"; op: "=" | "<>" | ">" | "<" | ">=" | "<="; left: CheckDslExpr; right: CheckDslExpr }
  | { type: "if"; cond: CheckDslAst; then: CheckDslAst };

export type CheckDslExpr =
  | { type: "number"; value: number }
  | { type: "cell"; formId: string; column: string; row: string }
  | { type: "sum"; formId: string; column: string; rowFrom: string; rowTo: string }
  | { type: "abs"; expr: CheckDslExpr }
  | { type: "binary"; op: "+" | "-" | "*" | "/"; left: CheckDslExpr; right: CheckDslExpr };

export interface CheckDslParseResult {
  ok: boolean;
  ast?: CheckDslAst;
  error?: string;
  source: string;
}

function tokenize(src: string): string[] {
  const tokens: string[] = [];
  const re =
    /\s*(SUM|ABS|IF|<>|>=|<=|=|>|<|\(|\)|;|,|\.\.|[A-Za-zА-Яа-я0-9_]+(?:\.[A-Za-zА-Яа-я0-9_]+)?(?:\[[^\]]+\])?|\+|\-|\*|\/|\d+(?:\.\d+)?)/gy;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    tokens.push(m[1]);
    if (re.lastIndex === src.length) break;
    if (!m[1]) break;
  }
  return tokens;
}

class Parser {
  private i = 0;
  constructor(private readonly tokens: string[]) {}

  peek(): string | undefined {
    return this.tokens[this.i];
  }

  next(): string {
    return this.tokens[this.i++] ?? "";
  }

  expect(v: string): void {
    const t = this.next();
    if (t !== v) throw new Error(`Expected ${v}, got ${t || "EOF"}`);
  }

  parseCheck(): CheckDslAst {
    if (this.peek()?.toUpperCase() === "IF") {
      this.next();
      this.expect("(");
      const cond = this.parseCheck();
      this.expect(";");
      const then = this.parseCheck();
      this.expect(")");
      return { type: "if", cond, then };
    }
    const left = this.parseExpr();
    const op = this.next();
    if (!["=", "<>", ">", "<", ">=", "<="].includes(op)) {
      throw new Error(`Expected comparison operator, got ${op || "EOF"}`);
    }
    const right = this.parseExpr();
    return { type: "cmp", op: op as "=" | "<>" | ">" | "<" | ">=" | "<=", left, right };
  }

  parseExpr(): CheckDslExpr {
    let left = this.parseTerm();
    while (this.peek() === "+" || this.peek() === "-") {
      const op = this.next() as "+" | "-";
      const right = this.parseTerm();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  parseTerm(): CheckDslExpr {
    let left = this.parseFactor();
    while (this.peek() === "*" || this.peek() === "/") {
      const op = this.next() as "*" | "/";
      const right = this.parseFactor();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  parseFactor(): CheckDslExpr {
    const t = this.peek();
    if (!t) throw new Error("Unexpected EOF in expression");
    if (/^\d/.test(t)) {
      this.next();
      return { type: "number", value: Number(t) };
    }
    if (t.toUpperCase() === "ABS") {
      this.next();
      this.expect("(");
      const expr = this.parseExpr();
      this.expect(")");
      return { type: "abs", expr };
    }
    if (t.toUpperCase() === "SUM") {
      this.next();
      this.expect("(");
      const cell = this.next();
      const parsed = parseCellRef(cell);
      if (!parsed || !parsed.row.includes("..")) {
        throw new Error(`SUM expects FORM.COL[FROM..TO], got ${cell}`);
      }
      const [rowFrom, rowTo] = parsed.row.split("..");
      this.expect(")");
      return {
        type: "sum",
        formId: parsed.formId,
        column: parsed.column,
        rowFrom,
        rowTo,
      };
    }
    this.next();
    const cell = parseCellRef(t);
    if (!cell) throw new Error(`Invalid cell ref: ${t}`);
    return { type: "cell", formId: cell.formId, column: cell.column, row: cell.row };
  }
}

function parseCellRef(
  token: string
): { formId: string; column: string; row: string } | null {
  const m = /^([A-Za-zА-Яа-я0-9_]+)\.([A-Za-zА-Яа-я0-9_]+)\[([^\]]+)\]$/.exec(token);
  if (!m) return null;
  return { formId: m[1], column: m[2], row: m[3] };
}

export function parseCheckDsl(source: string): CheckDslParseResult {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, error: "empty expression", source };
  try {
    const tokens = tokenize(trimmed);
    const parser = new Parser(tokens);
    const ast = parser.parseCheck();
    if (parser.peek()) {
      return { ok: false, error: `Unexpected token ${parser.peek()}`, source: trimmed };
    }
    return { ok: true, ast, source: trimmed };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      source: trimmed,
    };
  }
}

export type CellResolver = (formId: string, column: string, row: string) => number;

export function evalCheckDsl(
  ast: CheckDslAst,
  resolve: CellResolver
): { passed: boolean; left?: number; right?: number; skipped?: boolean } {
  if (ast.type === "if") {
    const cond = evalCheckDsl(ast.cond, resolve);
    if (!cond.passed) return { passed: true, skipped: true };
    return evalCheckDsl(ast.then, resolve);
  }
  const left = evalExpr(ast.left, resolve);
  const right = evalExpr(ast.right, resolve);
  let passed = false;
  switch (ast.op) {
    case "=":
      passed = nearlyEqual(left, right);
      break;
    case "<>":
      passed = !nearlyEqual(left, right);
      break;
    case ">":
      passed = left > right;
      break;
    case "<":
      passed = left < right;
      break;
    case ">=":
      passed = left >= right || nearlyEqual(left, right);
      break;
    case "<=":
      passed = left <= right || nearlyEqual(left, right);
      break;
  }
  return { passed, left, right };
}

function evalExpr(expr: CheckDslExpr, resolve: CellResolver): number {
  switch (expr.type) {
    case "number":
      return expr.value;
    case "cell":
      return resolve(expr.formId, expr.column, expr.row);
    case "sum": {
      const from = Number(expr.rowFrom);
      const to = Number(expr.rowTo);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
      let s = 0;
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      for (let r = lo; r <= hi; r++) {
        s += resolve(expr.formId, expr.column, String(r));
      }
      return s;
    }
    case "abs":
      return Math.abs(evalExpr(expr.expr, resolve));
    case "binary": {
      const l = evalExpr(expr.left, resolve);
      const r = evalExpr(expr.right, resolve);
      switch (expr.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return r === 0 ? 0 : l / r;
      }
    }
  }
}

function nearlyEqual(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) <= eps;
}
