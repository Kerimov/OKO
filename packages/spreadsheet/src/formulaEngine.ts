import { assertFormulaAllowed } from "./formulaWhitelist.js";
import { assertFormulaLimits } from "./formulaLimits.js";
import type { SpreadsheetValue } from "./types.js";

export type CellResolver = (a1: string) => SpreadsheetValue;

export interface EvalResult {
  value: SpreadsheetValue;
  error?: string;
}

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "ref"; v: string }
  | { t: "range"; v: string }
  | { t: "fn"; v: string }
  | { t: "op"; v: string }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" };

function toNum(v: SpreadsheetValue): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function truthy(v: SpreadsheetValue): boolean {
  if (typeof v === "boolean") return v;
  if (v === null || v === "") return false;
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (s === "false" || s === "0") return false;
  return s.length > 0;
}

/** Safe arithmetic without Function()/eval — used by rash formulas too. */
export function evalArithmetic(expr: string): number {
  const cleaned = expr.replace(/\s/g, "");
  if (!cleaned) return 0;
  if (!/^[\d.+\-*/()]+$/.test(cleaned)) {
    throw new Error("Недопустимые символы в арифметике");
  }
  let i = 0;
  const peek = () => cleaned[i];
  const take = () => cleaned[i++];

  const parseExpr = (): number => {
    let left = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = take();
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };
  const parseTerm = (): number => {
    let left = parseUnary();
    while (peek() === "*" || peek() === "/") {
      const op = take();
      const right = parseUnary();
      left = op === "*" ? left * right : right === 0 ? NaN : left / right;
    }
    return left;
  };
  const parseUnary = (): number => {
    if (peek() === "+") {
      take();
      return parseUnary();
    }
    if (peek() === "-") {
      take();
      return -parseUnary();
    }
    return parsePrimary();
  };
  const parsePrimary = (): number => {
    if (peek() === "(") {
      take();
      const v = parseExpr();
      if (peek() !== ")") throw new Error("Ожидалась )");
      take();
      return v;
    }
    let start = i;
    if (peek() === ".") {
      /* fraction */
    }
    while ((peek() >= "0" && peek() <= "9") || peek() === ".") take();
    if (start === i) throw new Error("Ожидалось число");
    const n = Number(cleaned.slice(start, i));
    if (!Number.isFinite(n)) throw new Error("Нечисло");
    return n;
  };

  const value = parseExpr();
  if (i !== cleaned.length) throw new Error("Хвост выражения");
  return value;
}

/**
 * Evaluate `M=B+C-D` style rash formulas without Function().
 */
export function evalColumnLetterFormula(
  formula: string,
  getCol: (letter: string) => number
): number {
  const eq = formula.indexOf("=");
  const rhs = (eq >= 0 ? formula.slice(eq + 1) : formula).replace(/\s/g, "");
  if (!rhs) return 0;
  let expr = "";
  for (let i = 0; i < rhs.length; i++) {
    const ch = rhs[i];
    if (/[A-Za-zА-Яа-я]/.test(ch)) {
      const letter = ch.toUpperCase();
      expr += String(getCol(letter));
    } else {
      expr += ch;
    }
  }
  try {
    const n = evalArithmetic(expr);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function tokenize(src: string): Tok[] {
  const s = src.trim().startsWith("=") ? src.trim().slice(1) : src.trim();
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(") {
      out.push({ t: "lp" });
      i++;
      continue;
    }
    if (c === ")") {
      out.push({ t: "rp" });
      i++;
      continue;
    }
    if (c === ",") {
      out.push({ t: "comma" });
      i++;
      continue;
    }
    if ("+-*/^=<>&".includes(c)) {
      let op = c;
      i++;
      if ((c === "<" || c === ">") && (s[i] === "=" || (c === "<" && s[i] === ">"))) {
        op += s[i++];
      }
      out.push({ t: "op", v: op === "=" ? "==" : op });
      continue;
    }
    if (c === '"') {
      i++;
      let str = "";
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length) {
          str += s[++i];
          i++;
        } else str += s[i++];
      }
      if (s[i] === '"') i++;
      out.push({ t: "str", v: str });
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let start = i;
      while (i < s.length && /[0-9.]/.test(s[i])) i++;
      out.push({ t: "num", v: Number(s.slice(start, i)) });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let start = i;
      while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) i++;
      const word = s.slice(start, i);
      // range like A1:B10 or single ref A1
      if (/^[A-Z]+\d+$/i.test(word) && s[i] === ":") {
        i++;
        let start2 = i;
        while (i < s.length && /[A-Za-z0-9]/.test(s[i])) i++;
        out.push({ t: "range", v: `${word}:${s.slice(start2, i)}` });
        continue;
      }
      if (/^[A-Z]+\d+$/i.test(word)) {
        out.push({ t: "ref", v: word.toUpperCase() });
        continue;
      }
      if (word.toUpperCase() === "TRUE") {
        out.push({ t: "bool", v: true });
        continue;
      }
      if (word.toUpperCase() === "FALSE") {
        out.push({ t: "bool", v: false });
        continue;
      }
      out.push({ t: "fn", v: word.toUpperCase() });
      continue;
    }
    throw new Error(`Неожиданный символ «${c}»`);
  }
  return out;
}

function expandRange(range: string, resolve: CellResolver): SpreadsheetValue[] {
  const [a, b] = range.split(":");
  const parse = (addr: string) => {
    const m = addr.match(/^([A-Z]+)(\d+)$/i);
    if (!m) throw new Error(`Плохой адрес ${addr}`);
    return { col: colToIndex(m[1].toUpperCase()), row: Number(m[2]) };
  };
  const A = parse(a);
  const B = parse(b);
  const r0 = Math.min(A.row, B.row);
  const r1 = Math.max(A.row, B.row);
  const c0 = Math.min(A.col, B.col);
  const c1 = Math.max(A.col, B.col);
  const vals: SpreadsheetValue[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      vals.push(resolve(`${indexToCol(c)}${r}`));
    }
  }
  return vals;
}

export function colToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

export function indexToCol(index: number): string {
  let n = index;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || "A";
}

function callFn(
  name: string,
  args: SpreadsheetValue[][],
  _resolve: CellResolver
): SpreadsheetValue {
  void _resolve;
  const flat = args.flat();
  switch (name) {
    case "SUM":
      return flat.reduce<number>((a, v) => a + toNum(v), 0);
    case "MIN":
      return flat.length ? Math.min(...flat.map(toNum)) : 0;
    case "MAX":
      return flat.length ? Math.max(...flat.map(toNum)) : 0;
    case "ABS":
      return Math.abs(toNum(flat[0]));
    case "ROUND": {
      const digits = flat[1] == null ? 0 : toNum(flat[1]);
      const f = 10 ** digits;
      return Math.round(toNum(flat[0]) * f) / f;
    }
    case "COUNT":
      return flat.filter((v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(toNum(v)))).length;
    case "COUNTA":
      return flat.filter((v) => v !== null && v !== "").length;
    case "AVERAGE": {
      const nums = flat.map(toNum).filter((n) => Number.isFinite(n));
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    }
    case "IF":
      return truthy(flat[0]) ? (flat[1] ?? true) : (flat[2] ?? false);
    case "AND":
      return flat.every(truthy);
    case "OR":
      return flat.some(truthy);
    case "NOT":
      return !truthy(flat[0]);
    case "IFERROR":
      try {
        return flat[0];
      } catch {
        return flat[1] ?? 0;
      }
    case "DATE": {
      const y = toNum(flat[0]);
      const m = toNum(flat[1]);
      const d = toNum(flat[2]);
      return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    case "YEAR":
    case "MONTH":
    case "DAY": {
      const raw = String(flat[0] ?? "");
      const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return 0;
      if (name === "YEAR") return Number(m[1]);
      if (name === "MONTH") return Number(m[2]);
      return Number(m[3]);
    }
    default:
      throw new Error(`Функция ${name} не поддержана`);
  }
}

/**
 * Evaluate a whitelist Excel-like formula.
 * Cell values come from `resolve("A1")`. Ranges expand to value lists.
 */
export function evaluateFormula(formula: string, resolve: CellResolver): EvalResult {
  try {
    assertFormulaAllowed(formula);
    const tokens = tokenize(formula);
    let refCount = 0;
    for (const t of tokens) {
      if (t.t === "ref" || t.t === "range") refCount++;
    }
    assertFormulaLimits(formula, refCount);

    let pos = 0;
    const peek = () => tokens[pos];
    const take = () => tokens[pos++];

    const parseEquality = (): SpreadsheetValue => {
      let left = parseAdd();
      while (peek()?.t === "op" && ["==", "<>", "<", ">", "<=", ">="].includes((peek() as { v: string }).v)) {
        const op = (take() as { v: string }).v;
        const right = parseAdd();
        const ln = toNum(left);
        const rn = toNum(right);
        if (op === "==") left = Math.abs(ln - rn) < 1e-9;
        else if (op === "<>") left = Math.abs(ln - rn) >= 1e-9;
        else if (op === "<") left = ln < rn;
        else if (op === ">") left = ln > rn;
        else if (op === "<=") left = ln <= rn;
        else left = ln >= rn;
      }
      return left;
    };

    const parseAdd = (): SpreadsheetValue => {
      let left = parseMul();
      while (peek()?.t === "op" && ((peek() as { v: string }).v === "+" || (peek() as { v: string }).v === "-")) {
        const op = (take() as { v: string }).v;
        const right = parseMul();
        left = op === "+" ? toNum(left) + toNum(right) : toNum(left) - toNum(right);
      }
      return left;
    };

    const parseMul = (): SpreadsheetValue => {
      let left = parseUnary();
      while (peek()?.t === "op" && ((peek() as { v: string }).v === "*" || (peek() as { v: string }).v === "/")) {
        const op = (take() as { v: string }).v;
        const right = parseUnary();
        left = op === "*" ? toNum(left) * toNum(right) : toNum(right) === 0 ? NaN : toNum(left) / toNum(right);
      }
      return left;
    };

    const parseUnary = (): SpreadsheetValue => {
      if (peek()?.t === "op" && (peek() as { v: string }).v === "-") {
        take();
        return -toNum(parseUnary());
      }
      if (peek()?.t === "op" && (peek() as { v: string }).v === "+") {
        take();
        return parseUnary();
      }
      return parsePrimary();
    };

    const parsePrimary = (): SpreadsheetValue => {
      const tok = peek();
      if (!tok) throw new Error("Пустое выражение");
      if (tok.t === "num") {
        take();
        return tok.v;
      }
      if (tok.t === "str") {
        take();
        return tok.v;
      }
      if (tok.t === "bool") {
        take();
        return tok.v;
      }
      if (tok.t === "ref") {
        take();
        return resolve(tok.v);
      }
      if (tok.t === "range") {
        take();
        const vals = expandRange(tok.v, resolve);
        return vals.reduce<number>((a, v) => a + toNum(v), 0);
      }
      if (tok.t === "fn") {
        const name = tok.v;
        take();
        if (peek()?.t !== "lp") throw new Error(`Ожидалась ( после ${name}`);
        take();
        const argGroups: SpreadsheetValue[][] = [];
        if (peek()?.t !== "rp") {
          for (;;) {
            if (peek()?.t === "range") {
              const r = take() as { v: string };
              argGroups.push(expandRange(r.v, resolve));
            } else {
              argGroups.push([parseEquality()]);
            }
            if (peek()?.t === "comma") {
              take();
              continue;
            }
            break;
          }
        }
        if (peek()?.t !== "rp") throw new Error("Ожидалась )");
        take();
        return callFn(name, argGroups, resolve);
      }
      if (tok.t === "lp") {
        take();
        const v = parseEquality();
        if (peek()?.t !== "rp") throw new Error("Ожидалась )");
        take();
        return v;
      }
      throw new Error("Синтаксическая ошибка");
    };

    const value = parseEquality();
    if (pos !== tokens.length) throw new Error("Хвост выражения");
    return { value: typeof value === "number" && !Number.isFinite(value) ? null : value };
  } catch (e) {
    return {
      value: null,
      error: e instanceof Error ? e.message : "Ошибка формулы",
    };
  }
}
