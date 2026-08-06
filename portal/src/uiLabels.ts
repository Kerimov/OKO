/** User-facing Russian labels for codes / roles kept as English in the API. */

export function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case "admin":
      return "Администратор";
    case "org":
      return "Организация";
    case "user":
      return "Пользователь";
    case "coordinator":
      return "Координатор";
    case "executor":
      return "Исполнитель";
    default:
      return role?.trim() ? role : "—";
  }
}

export function packageKindLabel(kind: string | null | undefined): string {
  switch (String(kind ?? "").toUpperCase()) {
    case "BALANCE":
      return "Баланс";
    case "OKO":
      return "ОКО";
    default:
      return kind?.trim() ? String(kind) : "ОКО";
  }
}

export function orgOptionLabel(org: {
  name: string;
  zid?: number;
  code?: string | null;
}): string {
  const code = org.code?.trim();
  return code ? `${org.name} (${code})` : org.name;
}

export function periodOptionLabel(period: {
  name: string;
  eid?: number;
  packageKind?: string | null;
}): string {
  const kind = period.packageKind ? packageKindLabel(period.packageKind) : "";
  return kind ? `${period.name} · ${kind}` : period.name;
}

export function zidHint(zid: number | string | null | undefined): string {
  if (zid == null || zid === "") return "";
  return `код организации ${zid}`;
}

export function eidHint(eid: number | string | null | undefined): string {
  if (eid == null || eid === "") return "";
  return `код периода ${eid}`;
}

export function checkRunSummary(input: {
  passed: number;
  failed: number;
  runId?: string | null;
}): string {
  const base = `Проверка выполнена: успешно ${input.passed}, с ошибками ${input.failed}`;
  return input.runId ? `${base} (номер запуска: ${input.runId.slice(0, 8)}…)` : base;
}
