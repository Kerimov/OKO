/** User-facing Russian labels for codes / roles kept as English in the API. */

export type BpStatusUi =
  | "not_started"
  | "collecting"
  | "pending_curator_approval"
  | "curator_approved"
  | "completed";

export const BP_STATUS_LABEL: Record<BpStatusUi, string> = {
  not_started: "Не начат",
  collecting: "Сбор",
  pending_curator_approval: "На согласовании",
  curator_approved: "Согласован",
  completed: "Завершён",
};

export function bpStatusLabel(status: string | null | undefined): string {
  if (status && status in BP_STATUS_LABEL) {
    return BP_STATUS_LABEL[status as BpStatusUi];
  }
  return status?.trim() ? String(status) : "—";
}

export function formatDateTimeRu(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16).replace("T", " ");
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function unitKindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "organization":
      return "Организация";
    case "branch":
      return "Филиал";
    case "unit":
      return "Подразделение";
    default:
      return kind?.trim() ? String(kind) : "—";
  }
}

export function transferKindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "period_to_period":
      return "Период → период";
    case "balance_to_oko":
      return "Баланс → ОКО";
    case "oko_to_balance":
      return "ОКО → Баланс";
    default:
      return kind?.trim() ? String(kind) : "—";
  }
}

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
