import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getApiRole, initAuth, isAuthRequired } from "../auth";
import { isBackendMode } from "../storage";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initAuth().finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="loading" style={{ padding: "2rem", textAlign: "center" }}>
        Загрузка…
      </div>
    );
  }

  const backend = isBackendMode();
  const needsLogin = backend && isAuthRequired() && !getApiRole();
  if (needsLogin && location.pathname !== "/login") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (getApiRole() && location.pathname === "/login") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
