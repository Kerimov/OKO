import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { initAuth } from "../auth";
import { isBackendMode } from "../storage";
import { useAuth } from "../useAuth";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [ready, setReady] = useState(false);
  const auth = useAuth();

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
  const needsLogin = backend && auth.authRequired && !auth.role;
  if (needsLogin && location.pathname !== "/login") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (auth.role && location.pathname === "/login") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
