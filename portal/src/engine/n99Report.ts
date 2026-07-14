import type { KontrAgent } from "../types";

/** Access N99: agents with «Другое наименование» (OldName) worth reporting to HQ. */
export function isN99Change(agent: KontrAgent): boolean {
  const o = (agent.oldName ?? "").trim();
  if (!o) return false;
  if (o === "~" || o === "-" || o === ".") return false;
  return true;
}

export function listN99Changes(agents: KontrAgent[]): KontrAgent[] {
  return agents
    .filter(isN99Change)
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ru"));
}

export function n99Csv(agents: KontrAgent[]): string {
  const rows = listN99Changes(agents);
  const esc = (v: string | number | null | undefined) => {
    const s = String(v ?? "");
    if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [
    ["id", "name", "oldName", "inn", "kpp", "orgType", "orgForm"].join(";"),
  ];
  for (const a of rows) {
    lines.push(
      [
        a.id,
        a.name,
        a.oldName ?? "",
        a.inn ?? "",
        a.kpp ?? "",
        a.orgType ?? "",
        a.orgForm ?? "",
      ]
        .map(esc)
        .join(";")
    );
  }
  return lines.join("\n");
}

export function downloadN99Csv(agents: KontrAgent[], filename?: string): number {
  const rows = listN99Changes(agents);
  if (rows.length === 0) return 0;
  const blob = new Blob(["\uFEFF" + n99Csv(agents)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `N99-kontr-changes-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return rows.length;
}
