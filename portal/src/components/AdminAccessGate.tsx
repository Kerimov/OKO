import { Link } from "react-router-dom";
import { isBackendMode } from "../storage";
import { useAuth } from "../useAuth";

export function useAdminAccess(): { ok: boolean; reason: "backend" | "admin" | null } {
  const auth = useAuth();
  if (!isBackendMode()) return { ok: false, reason: "backend" };
  if (auth.authRequired && auth.role !== "admin") return { ok: false, reason: "admin" };
  return { ok: true, reason: null };
}

export function AdminAccessGate({ title }: { title: string }) {
  const access = useAdminAccess();
  const auth = useAuth();
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
        Нужна роль <strong>admin</strong>.{" "}
        {auth.loginAvailable ? (
          <>
            Войдите на <Link to="/">главной странице</Link>.
          </>
        ) : (
          <>
            Укажите admin-токен в <Link to="/settings">настройках</Link>.
          </>
        )}
      </div>
    </div>
  );
}
