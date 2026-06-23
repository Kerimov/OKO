import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initStorage, isBackendMode } from "./storage";
import { initAuth } from "./auth";
import "./index.css";
import { useAuth } from "./useAuth";

function Bootstrap() {
  const [ready, setReady] = useState(false);
  const [backend, setBackend] = useState(false);
  const auth = useAuth();

  useEffect(() => {
    (async () => {
      const ok = await initStorage();
      setBackend(ok && isBackendMode());
      await initAuth();
      setReady(true);
    })();
  }, []);

  if (!ready) {
    return (
      <div className="loading" style={{ padding: "2rem", textAlign: "center" }}>
        Загрузка…
      </div>
    );
  }

  return (
    <>
      {backend && (
        <div
          className="backend-badge"
          title={
            auth.authRequired
              ? `${auth.backendDb ?? "DB"} · роль ${auth.role ?? "нет"}`
              : `Данные в ${auth.backendDb ?? "DB"}`
          }
        >
          {(auth.backendDb ?? "DB").toUpperCase()}
          {auth.role ? ` · ${auth.role}` : ""}
        </div>
      )}
      <App />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>
);
