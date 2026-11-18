"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api/client";
import { clearAuthToken, getAuthToken, setAuthToken } from "@/lib/session";

export type UserRole = "astronaut" | "officer" | "doctor" | "chief";
export interface AuthUser { login: string; role: UserRole; name: string; astronaut_id: string | null }
/** A demo account offered on the "choose an account" screen. */
export type DemoAccount = AuthUser;
interface SessionResponse extends AuthUser { token: string }
interface AuthContextValue {
  user: AuthUser | null;
  ready: boolean;
  /** Sign in as the chosen account. There are no passwords. */
  select: (login: string) => Promise<AuthUser>;
  logout: () => void;
}
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Already signed in on this browser: go straight in, no picker.
    if (!getAuthToken()) {
      void Promise.resolve().then(() => setReady(true));
      return;
    }
    api.get<AuthUser>("/auth/me").then(setUser).catch((error) => {
      // Only a rejected token ends the session. A sleeping backend must not sign anyone out.
      if (error instanceof ApiError && error.status === 401) clearAuthToken();
    }).finally(() => setReady(true));
  }, []);

  const select = useCallback(async (loginName: string) => {
    const session = await api.post<SessionResponse>("/auth/select", { login: loginName });
    queryClient.clear();
    setAuthToken(session.token, session.login);
    const identity: AuthUser = { login: session.login, role: session.role, name: session.name, astronaut_id: session.astronaut_id };
    setUser(identity);
    return identity;
  }, [queryClient]);

  const logout = useCallback(() => {
    clearAuthToken();
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo(() => ({ user, ready, select, logout }), [user, ready, select, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

/** Accounts of this browser's sandbox, for the picker. */
export function useDemoAccounts() {
  return useQuery({
    queryKey: ["errno-demo-accounts"],
    queryFn: () => api.get<DemoAccount[]>("/auth/accounts"),
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });
}

export function roleHome(role: UserRole) {
  return role === "astronaut" ? "/" : role === "officer" ? "/captain" : "/medic";
}
