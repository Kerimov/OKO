import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { needsAuthentication } from "../authRouting";
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
  if (needsAuthentication(backend, auth) && location.pathname !== "/") {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
