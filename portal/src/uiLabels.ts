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

export function zidHint(zid: number | string | null | undefined): string {
  if (zid == null || zid === "") return "";
  return `код организации ${zid}`;
}

export function eidHint(eid: number | string | null | undefined): string {
  if (eid == null || eid === "") return "";
  return `код периода ${eid}`;
}
