import { useState } from "react";
import { MarkdownContent } from "../components/MarkdownContent";
import adminGuide from "../content/instructions-admin.md?raw";
import userGuide from "../content/instructions-user.md?raw";
import appendixGuide from "../content/instructions-appendix.md?raw";
import { isBackendMode } from "../storage";
import { useAuth } from "../useAuth";

type Tab = "user" | "admin";

export function InstructionsPage() {
  const auth = useAuth();
  const isAdmin = isBackendMode() && (!auth.authRequired || auth.role === "admin");
  const [tab, setTab] = useState<Tab>("user");

  return (
    <div className="instructions-page">
      <header className="instructions-header">
        <h1>Инструкция по работе с порталом</h1>
        <p className="instructions-lead">
          Руководство по заполнению форм корпоративной отчётности в системе ОКО.
        </p>
      </header>

      {isAdmin && (
        <div className="instructions-tabs" role="tablist" aria-label="Разделы инструкции">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "user"}
            className={tab === "user" ? "active" : ""}
            onClick={() => setTab("user")}
          >
            Пользователь организации
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "admin"}
            className={tab === "admin" ? "active" : ""}
            onClick={() => setTab("admin")}
          >
            Администратор
          </button>
        </div>
      )}

      <article className="instructions-article">
        {(!isAdmin || tab === "user") && <MarkdownContent source={userGuide} />}
        {isAdmin && tab === "admin" && (
          <>
            <MarkdownContent source={adminGuide} />
            <MarkdownContent source={appendixGuide} />
          </>
        )}
      </article>
    </div>
  );
}
