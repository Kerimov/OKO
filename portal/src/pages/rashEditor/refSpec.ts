import { parseRefFilter } from "../../engine/rashEngine";

export const REF_KINDS = [
  "Контрагент",
  "Страна",
  "Валюта",
  "Вид прочей выручки",
  "Кредитор",
  "Прочее",
] as const;

export interface RefSpecDraft {
  kind: string;
  types: number[];
  codes: string[];
  title: string;
  customKind: string;
}

export function emptyRefSpec(kind = "Контрагент"): RefSpecDraft {
  return { kind, types: [], codes: [], title: "", customKind: "" };
}

export function parseRefSpec(
  name: string | null | undefined,
  title: string | null | undefined
): RefSpecDraft {
  // Unused A2–A4 slots must stay empty — do not invent kind «Контрагент».
  if (!name?.trim()) {
    return { ...emptyRefSpec(""), title: title?.trim() || "" };
  }
  const parsed = parseRefFilter(name);
  if (!parsed) {
    return { ...emptyRefSpec(""), title: title?.trim() || "" };
  }
  const known = (REF_KINDS as readonly string[]).includes(parsed.kind);
  return {
    kind: known ? parsed.kind : "Прочее",
    customKind: known ? "" : parsed.kind,
    types: parsed.allowedTypes,
    codes: parsed.allowedCodes,
    title: title ?? "",
  };
}

export function buildRefName(spec: RefSpecDraft): string | null {
  const kind =
    spec.kind === "Прочее" ? spec.customKind.trim() || "Прочее" : spec.kind.trim();
  if (!kind) return null;
  const parts: string[] = [];
  if (spec.types.length) parts.push([...spec.types].sort((a, b) => a - b).join(","));
  if (spec.codes.length) {
    parts.push(
      spec.codes
        .map((c) => c.trim())
        .filter(Boolean)
        .join(",")
    );
  }
  const filter = parts.filter(Boolean).join(",");
  return filter ? `${kind}/${filter}` : kind;
}

export function toggleType(types: number[], t: number): number[] {
  return types.includes(t) ? types.filter((x) => x !== t) : [...types, t].sort((a, b) => a - b);
}
