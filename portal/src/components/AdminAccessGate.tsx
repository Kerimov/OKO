import { Link } from "react-router-dom";
import { isAdminRole } from "../auth";
import { isBackendMode } from "../storage";

export function useAdminAccess(): { ok: boolean; reason: "backend" | "admin" | null } {
  if (!isBackendMode()) return { ok: false, reason: "backend" };
  if (!isAdminRole()) return { ok: false, reason: "admin" };
  return { ok: true, reason: null };
}

export function AdminAccessGate({ title }: { title: string }) {
  const access = useAdminAccess();
  if (access.ok) return null;
  if (access.reason === "backend") {
    return (
      <div className="admin-page">
        <h1>{title}</h1>
        <div className="error-box">
          Редактирование доступно только при запущенном API-сервере (
          <code>cd server && npm run dev</code>).
        </div>
      </div>
    );
  }
  return (
    <div className="admin-page">
      <h1>{title}</h1>
      <div className="error-box">
        Нужна роль <strong>admin</strong>. Укажите admin-токен в{" "}
        <Link to="/settings">настройках</Link>.
      </div>
    </div>
  );
}
