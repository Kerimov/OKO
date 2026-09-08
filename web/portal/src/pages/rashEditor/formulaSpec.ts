import { parseFormulaColumns, parseTotalColumn } from "../../engine/rashEngine";

export interface FormulaDraft {
  totalCol: string;
  terms: Array<{ sign: "+" | "-"; col: string }>;
  rawMode: boolean;
  raw: string;
}

export function emptyFormula(): FormulaDraft {
  return { totalCol: "", terms: [], rawMode: false, raw: "" };
}

export function parseFormulaDraft(formula: string | null | undefined): FormulaDraft {
  const raw = (formula ?? "").trim();
  if (!raw) return emptyFormula();
  const totalCol = parseTotalColumn(raw) ?? "";
  const eq = raw.indexOf("=");
  const rhs = (eq >= 0 ? raw.slice(eq + 1) : raw).replace(/\s/g, "");
  const terms: FormulaDraft["terms"] = [];
  const re = /([+-]?)([A-ZА-Я])/gi;
  let m: RegExpExecArray | null;
  let first = true;
  while ((m = re.exec(rhs))) {
    const sign = (m[1] === "-" ? "-" : "+") as "+" | "-";
    const col = m[2].toUpperCase();
    if (first && !m[1]) {
      terms.push({ sign: "+", col });
    } else {
      terms.push({ sign, col });
    }
    first = false;
  }
  const rebuilt = buildFormulaString({ totalCol, terms, rawMode: false, raw: "" });
  const normalize = (s: string) => s.replace(/\s/g, "").toUpperCase().replace(/−/g, "-");
  const complex = normalize(raw) !== normalize(rebuilt || "");
  return {
    totalCol,
    terms: terms.length ? terms : parseFormulaColumns(raw).map((col) => ({ sign: "+", col })),
    rawMode: complex,
    raw,
  };
}

export function buildFormulaString(draft: FormulaDraft): string | null {
  if (draft.rawMode) return draft.raw.trim() || null;
  if (!draft.totalCol.trim()) return null;
  const body = draft.terms
    .filter((t) => t.col.trim())
    .map((t, i) => {
      const col = t.col.trim().toUpperCase();
      if (i === 0) return t.sign === "-" ? `-${col}` : col;
      return `${t.sign}${col}`;
    })
    .join("");
  if (!body) return `${draft.totalCol.trim().toUpperCase()}=`;
  return `${draft.totalCol.trim().toUpperCase()}=${body}`;
}
