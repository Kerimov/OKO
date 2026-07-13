import {

  createContext,

  useCallback,

  useContext,

  useEffect,

  useMemo,

  useState,

  type ReactNode,

} from "react";

import type { PackageMeta } from "../types";

import { useAuth } from "./AuthContext";



interface SessionInfo {

  folderPath: string;

  meta: PackageMeta;

  instanceCount: number;

  rulesSync?: {

    exportedAt: string | null;

    fromPackage: boolean;

    hasChecks: boolean;

    hasRash?: boolean;

  };

  hasCoordinatorPin?: boolean;

  restrictExecutorsToAssignments?: boolean;

}



interface PackageContextValue {

  session: SessionInfo | null;

  userName: string;

  refreshSession: () => Promise<void>;

  setSession: (s: SessionInfo | null) => void;

}



const PackageContext = createContext<PackageContextValue | null>(null);



export function PackageProvider({ children }: { children: ReactNode }) {

  const { user } = useAuth();

  const [session, setSession] = useState<SessionInfo | null>(null);



  const userName = user?.displayName?.trim() || user?.login || "user";



  const refreshSession = useCallback(async () => {

    if (!window.oko) return;

    const info = await window.oko.getSessionInfo();

    setSession(info);

  }, []);



  useEffect(() => {

    if (!window.oko) return;

    void refreshSession();

  }, [refreshSession]);



  const value = useMemo(

    () => ({ session, userName, refreshSession, setSession }),

    [session, userName, refreshSession]

  );



  return <PackageContext.Provider value={value}>{children}</PackageContext.Provider>;

}



export function usePackage() {

  const ctx = useContext(PackageContext);

  if (!ctx) throw new Error("usePackage outside provider");

  return ctx;

}

