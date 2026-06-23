import { Navigate, useLocation } from "react-router-dom";
import { defaultAppPath, needsAuthentication } from "../authRouting";
import { isBackendMode } from "../storage";
import { useAuth } from "../useAuth";
import { LoginPage } from "./LoginPage";

export function EntryPage() {
  const auth = useAuth();
  const location = useLocation();
  const backend = isBackendMode();

  if (needsAuthentication(backend, auth)) {
    return <LoginPage />;
  }

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const dest =
    from && from !== "/" && from !== "/login" ? from : defaultAppPath(auth);
  return <Navigate to={dest} replace />;
}
