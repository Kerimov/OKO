import {

  createContext,

  useCallback,

  useContext,

  useEffect,

  useMemo,

  useState,

  type ReactNode,

} from "react";

import { usePackage } from "./PackageContext";

import { useAuth } from "./AuthContext";



interface CoordinatorContextValue {

  isCoordinator: boolean;

  hasPin: boolean;

  login: (pin: string) => Promise<boolean>;

  logoutPin: () => void;

  setPin: (pin: string, oldPin?: string) => Promise<void>;

  refreshPinState: () => Promise<void>;

}



const CoordinatorContext = createContext<CoordinatorContextValue | null>(null);



function storageKey(folderPath: string): string {

  return `oko-coordinator:${folderPath}`;

}



export function CoordinatorProvider({ children }: { children: ReactNode }) {

  const { session } = usePackage();

  const { isCoordinatorRole } = useAuth();

  const [isCoordinator, setIsCoordinator] = useState(false);

  const [hasPin, setHasPin] = useState(false);



  const refreshPinState = useCallback(async () => {

    if (!window.oko) return;

    if (!isCoordinatorRole) {

      setIsCoordinator(false);

      setHasPin(false);

      return;

    }

    const pin = await window.oko.hasCoordinatorPin();

    setHasPin(pin);

    if (!pin) {

      setIsCoordinator(true);

      return;

    }

    const folder = session?.folderPath;

    if (folder && sessionStorage.getItem(storageKey(folder)) === "1") {

      setIsCoordinator(true);

    } else {

      setIsCoordinator(false);

    }

  }, [session?.folderPath, isCoordinatorRole]);



  useEffect(() => {

    void refreshPinState();

  }, [refreshPinState]);



  const login = useCallback(

    async (pin: string) => {

      const ok = await window.oko.verifyCoordinatorPin(pin);

      if (ok && session?.folderPath) {

        sessionStorage.setItem(storageKey(session.folderPath), "1");

        setIsCoordinator(true);

      }

      return ok;

    },

    [session?.folderPath]

  );



  const logoutPin = useCallback(() => {

    if (session?.folderPath) {

      sessionStorage.removeItem(storageKey(session.folderPath));

    }

    setIsCoordinator(false);

  }, [session?.folderPath]);



  const setPin = useCallback(

    async (pin: string, oldPin?: string) => {

      await window.oko.setCoordinatorPin({ pin, oldPin });

      await refreshPinState();

      if (session?.folderPath) {

        sessionStorage.setItem(storageKey(session.folderPath), "1");

        setIsCoordinator(true);

      }

    },

    [refreshPinState, session?.folderPath]

  );



  const value = useMemo(

    () => ({ isCoordinator, hasPin, login, logoutPin, setPin, refreshPinState }),

    [isCoordinator, hasPin, login, logoutPin, setPin, refreshPinState]

  );



  return <CoordinatorContext.Provider value={value}>{children}</CoordinatorContext.Provider>;

}



export function useCoordinator() {

  const ctx = useContext(CoordinatorContext);

  if (!ctx) throw new Error("useCoordinator outside provider");

  return ctx;

}

