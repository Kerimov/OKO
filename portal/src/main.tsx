import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initStorage, isBackendMode } from "./storage";
import { getApiRole, isAuthRequired } from "./auth";
import "./index.css";

function Bootstrap() {
  const [ready, setReady] = useState(false);
  const [backend, setBackend] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    initStorage().then((ok) => {
      setBackend(ok && isBackendMode());
      setRole(getApiRole());
      setReady(true);
    });
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
            isAuthRequired()
              ? `SQLite · роль ${role ?? "нет"}`
              : "Данные в SQLite"
          }
        >
          SQLite{role ? ` · ${role}` : ""}
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
