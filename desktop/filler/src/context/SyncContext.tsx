import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { SyncStatus } from "../hooks/useCollaborativeForm";

interface SyncContextValue {
  status: SyncStatus;
  message: string;
  setSync: (status: SyncStatus, message?: string) => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

const LABELS: Record<SyncStatus, string> = {
  synced: "Синхронизировано",
  syncing: "Синхронизация…",
  offline: "Нет доступа к папке",
  locked: "База занята, повтор…",
  error: "Ошибка синхронизации",
};

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>("synced");
  const [message, setMessage] = useState("");

  const value = useMemo(
    () => ({
      status,
      message,
      setSync: (s: SyncStatus, msg = "") => {
        setStatus(s);
        setMessage(msg);
      },
    }),
    [status, message]
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSyncStatus() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSyncStatus outside provider");
  return ctx;
}

export function SyncStatusBar() {
  const { status, message } = useSyncStatus();
  const text = message || LABELS[status];
  return (
    <footer className={`sync-status-bar sync-${status}`} role="status">
      <span className="sync-dot" aria-hidden />
      <span>{text}</span>
    </footer>
  );
}
