import { parseRefFilter } from "./rashEngine";

export interface RashRefItem {
  kod: string;
  value: string;
  note?: string | null;
}

export interface RashRefsData {
  version: string;
  source?: string;
  total?: number;
  groups?: number;
  byName: Record<string, RashRefItem[]>;
}

let cached: RashRefsData | null = null;

export async function loadRashRefs(): Promise<RashRefsData> {
  if (cached) return cached;
  try {
    const res = await fetch("/data/rash-refs.json");
    if (res.ok) {
      cached = (await res.json()) as RashRefsData;
      return cached;
    }
  } catch {
    /* fallback */
  }
  cached = { version: "0", byName: {} };
  return cached;
}

export function clearRashRefsCache(): void {
  cached = null;
}

/** Варианты классификатора по спецификации ref_aN_name (напр. «Страна/RU,DE»). */
export function refOptionsForSpec(
  refs: RashRefsData,
  spec: string | null | undefined
): RashRefItem[] {
  const filter = parseRefFilter(spec);
  if (!filter) return [];
  const all = refs.byName[filter.kind] ?? [];
  if (filter.allowedCodes.length === 0) return all;
  const codes = new Set(filter.allowedCodes.map((c) => c.trim()));
  return all.filter((item) => codes.has(item.kod));
}

export function refItemLabel(item: RashRefItem): string {
  if (item.value && item.value !== item.kod) return item.value;
  return item.kod;
}

export function matchRefItem(
  items: RashRefItem[],
  stored: string | null | undefined
): RashRefItem | undefined {
  const s = (stored ?? "").trim();
  if (!s) return undefined;
  const lower = s.toLowerCase();
  return (
    items.find((i) => i.kod === s) ??
    items.find((i) => i.value === s) ??
    items.find((i) => i.value.toLowerCase() === lower)
  );
}
