/** Appendix 12 notation parser: cells are written as {Form;Column;Row}. */
export type Notation12Expr =
  | { type: "number"; value: number }
  | { type: "cell"; formId: string; column: string; row: string }
  | { type: "range"; formId: string; column: string; from: number; to: number }
  | { type: "binary"; op: "+" | "-" | "*" | "/"; left: Notation12Expr; right: Notation12Expr }
  | { type: "round"; value: Notation12Expr; digits: Notation12Expr };

export type Notation12Ast =
  | { type: "comparison"; op: "=" | "<>" | "<" | ">" | "<=" | ">="; left: Notation12Expr; right: Notation12Expr }
  | { type: "logical"; op: "and" | "or" | "xor"; left: Notation12Ast; right: Notation12Ast }
  | { type: "if"; condition: Notation12Ast; then: Notation12Ast; otherwise: Notation12Ast };

export type Notation12CellResolver = (formId: string, column: string, row: string) => number | null;

export interface Notation12ParseResult {
  ok: boolean;
  source: string;
  ast?: Notation12Ast;
  error?: string;
}

type Token = string;
const TOKEN = /\s*(<>|<=|>=|=|<|>|\+|-|\*|\/|\(|\)|;|,|\{[^{}]*\}|\d+(?:[.,]\d+)?|[A-Za-z_][A-Za-z0-9_]*)/gy;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    TOKEN.lastIndex = index;
    const match = TOKEN.exec(source);
    if (!match) throw new Error(`Unexpected character at ${index + 1}`);
    tokens.push(match[1]);
    index = TOKEN.lastIndex;
  }
  return tokens;
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}
  private peek(): Token | undefined { return this.tokens[this.index]; }
  private next(): Token { return this.tokens[this.index++] ?? ""; }
  private accept(value: string): boolean {
    if (this.peek()?.toLowerCase() !== value.toLowerCase()) return false;
    this.index++;
    return true;
  }
  private expect(value: string): void {
    if (!this.accept(value)) throw new Error(`Expected ${value}, got ${this.peek() ?? "EOF"}`);
  }
  done(): boolean { return this.index === this.tokens.length; }
  unexpected(): Token | undefined { return this.peek(); }

  parse(): Notation12Ast { return this.logical(); }
  private logical(): Notation12Ast {
    let left = this.check();
    while (["and", "or", "xor"].includes(this.peek()?.toLowerCase() ?? "")) {
      const op = this.next().toLowerCase() as "and" | "or" | "xor";
      left = { type: "logical", op, left, right: this.check() };
    }
    return left;
  }
  private check(): Notation12Ast {
    if (this.accept("if")) {
      this.expect("(");
      const condition = this.logical();
      this.expect(";");
      const then = this.logical();
      this.expect(";");
      const otherwise = this.logical();
      this.expect(")");
      return { type: "if", condition, then, otherwise };
    }
    if (this.accept("(")) {
      const nested = this.logical();
      this.expect(")");
      return nested;
    }
    const left = this.expression();
    const op = this.next() as Notation12Ast extends { op: infer O } ? O : never;
    if (!["=", "<>", "<", ">", "<=", ">="].includes(op as string)) {
      throw new Error(`Expected comparison operator, got ${op || "EOF"}`);
    }
    return { type: "comparison", op: op as "=" | "<>" | "<" | ">" | "<=" | ">=", left, right: this.expression() };
  }
  private expression(): Notation12Expr {
    let left = this.term();
    while (this.peek() === "+" || this.peek() === "-") {
      const op = this.next() as "+" | "-";
      left = { type: "binary", op, left, right: this.term() };
    }
    return left;
  }
  private term(): Notation12Expr {
    let left = this.factor();
    while (this.peek() === "*" || this.peek() === "/") {
      const op = this.next() as "*" | "/";
      left = { type: "binary", op, left, right: this.factor() };
    }
    return left;
  }
  private factor(): Notation12Expr {
    const token = this.peek();
    if (!token) throw new Error("Unexpected EOF in expression");
    if (this.accept("(")) {
      const value = this.expression();
      this.expect(")");
      return value;
    }
    if (this.accept("round")) {
      this.expect("(");
      const value = this.expression();
      this.expect(";");
      const digits = this.expression();
      this.expect(")");
      return { type: "round", value, digits };
    }
    if (/^\d/.test(token)) {
      this.next();
      return { type: "number", value: Number(token.replace(",", ".")) };
    }
    this.next();
    return parseReference(token);
  }
}

function parseReference(token: string): Notation12Expr {
  const match = /^\{([^;{}]+);([^;{}]+);([^;{}]+)\}$/.exec(token);
  if (!match) throw new Error(`Expected Appendix 12 cell reference, got ${token}`);
  const [, formId, column, rawRow] = match;
  const range = /^(\d+)\s*(?:\.\.|:|-)\s*(\d+)$/.exec(rawRow.trim());
  if (range) return { type: "range", formId: formId.trim(), column: column.trim(), from: Number(range[1]), to: Number(range[2]) };
  return { type: "cell", formId: formId.trim(), column: column.trim(), row: rawRow.trim() };
}

export function parseCheckNotation12(source: string): Notation12ParseResult {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, source, error: "empty expression" };
  try {
    const parser = new Parser(tokenize(trimmed));
    const ast = parser.parse();
    if (!parser.done()) throw new Error(`Unexpected token ${parser.unexpected()}`);
    return { ok: true, source: trimmed, ast };
  } catch (error) {
    return { ok: false, source: trimmed, error: error instanceof Error ? error.message : String(error) };
  }
}

export function evaluateCheckNotation12(
  ast: Notation12Ast,
  resolve: Notation12CellResolver
): { passed: boolean; left?: number | null; right?: number | null; skipped?: boolean } {
  if (ast.type === "if") {
    return evaluateCheckNotation12(ast.condition, resolve).passed
      ? evaluateCheckNotation12(ast.then, resolve)
      : evaluateCheckNotation12(ast.otherwise, resolve);
  }
  if (ast.type === "logical") {
    const left = evaluateCheckNotation12(ast.left, resolve).passed;
    const right = evaluateCheckNotation12(ast.right, resolve).passed;
    return { passed: ast.op === "and" ? left && right : ast.op === "or" ? left || right : left !== right };
  }
  const left = evaluateExpression(ast.left, resolve);
  const right = evaluateExpression(ast.right, resolve);
  if (left == null || right == null) return { passed: false, left, right, skipped: true };
  const equal = Math.abs(left - right) <= 0.01;
  const passed = ast.op === "=" ? equal : ast.op === "<>" ? !equal : ast.op === "<" ? left < right : ast.op === ">" ? left > right : ast.op === "<=" ? left < right || equal : left > right || equal;
  return { passed, left, right };
}

function evaluateExpression(expr: Notation12Expr, resolve: Notation12CellResolver): number | null {
  if (expr.type === "number") return expr.value;
  if (expr.type === "cell") return resolve(expr.formId, expr.column, expr.row);
  if (expr.type === "range") {
    let total = 0;
    for (let row = Math.min(expr.from, expr.to); row <= Math.max(expr.from, expr.to); row++) {
      const value = resolve(expr.formId, expr.column, String(row));
      if (value == null) return null;
      total += value;
    }
    return total;
  }
  if (expr.type === "round") {
    const value = evaluateExpression(expr.value, resolve);
    const digits = evaluateExpression(expr.digits, resolve);
    if (value == null || digits == null) return null;
    const multiplier = 10 ** digits;
    return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
  }
  const left = evaluateExpression(expr.left, resolve);
  const right = evaluateExpression(expr.right, resolve);
  if (left == null || right == null) return null;
  if (expr.op === "+") return left + right;
  if (expr.op === "-") return left - right;
  if (expr.op === "*") return left * right;
  return right === 0 ? null : left / right;
}
