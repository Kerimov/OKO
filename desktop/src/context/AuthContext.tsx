import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthUser } from "../types";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  needsSetup: boolean;
  isAdmin: boolean;
  isCoordinatorRole: boolean;
  login: (login: string, password: string) => Promise<void>;
  createInitialAdmin: (login: string, displayName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  const refresh = useCallback(async () => {
    if (!window.oko) {
      setLoading(false);
      return;
    }
    const setup = await window.oko.authNeedsSetup();
    setNeedsSetup(setup);
    if (setup) {
      setUser(null);
      setLoading(false);
      return;
    }
    const session = await window.oko.authGetSession();
    setUser(session);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (loginName: string, password: string) => {
    const u = await window.oko.authLogin(loginName, password);
    setUser(u);
    setNeedsSetup(false);
  }, []);

  const createInitialAdmin = useCallback(
    async (loginName: string, displayName: string, password: string) => {
      const u = await window.oko.authCreateInitialAdmin(loginName, displayName, password);
      setUser(u);
      setNeedsSetup(false);
    },
    []
  );

  const logout = useCallback(async () => {
    await window.oko.authLogout();
    setUser(null);
  }, []);

  const isAdmin = user?.role === "admin";
  const isCoordinatorRole = user?.role === "admin" || user?.role === "coordinator";

  const value = useMemo(
    () => ({
      user,
      loading,
      needsSetup,
      isAdmin,
      isCoordinatorRole,
      login,
      createInitialAdmin,
      logout,
      refresh,
    }),
    [
      user,
      loading,
      needsSetup,
      isAdmin,
      isCoordinatorRole,
      login,
      createInitialAdmin,
      logout,
      refresh,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
