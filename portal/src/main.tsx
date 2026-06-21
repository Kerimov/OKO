import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initStorage, isBackendMode } from "./storage";
import "./index.css";

function Bootstrap() {
  const [ready, setReady] = useState(false);
  const [backend, setBackend] = useState(false);

  useEffect(() => {
    initStorage().then((ok) => {
      setBackend(ok && isBackendMode());
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
        <div className="backend-badge" title="Данные в SQLite">
          SQLite
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
