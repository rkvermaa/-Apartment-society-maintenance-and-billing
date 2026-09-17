import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { logger } from '../lib/logger';
import { fetchSession, login as requestLogin, logout as requestLogout } from './authApiClient';

export type Role = 'admin' | 'resident';

export interface AuthContextValue {
  isAuthenticated: boolean;
  role: Role | null;
  isInitializing: boolean;
  login: (username: string, password: string) => Promise<Role | null>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const SESSION_STORAGE_KEY = 'sessionToken';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(SESSION_STORAGE_KEY));
  const [role, setRole] = useState<Role | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const storedToken = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!storedToken) {
      setIsInitializing(false);
      return;
    }
    fetchSession(storedToken).then((session) => {
      if (cancelled) return;
      if (session) {
        setRole(session.role);
      } else {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        setToken(null);
      }
      setIsInitializing(false);
    });
    return () => {
      cancelled = true;
    };
    // Only validates the token present at mount; login() already trusts its own response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: role !== null,
      role,
      isInitializing,
      login: async (username: string, password: string) => {
        const result = await requestLogin(username, password);
        if (!result) {
          logger.warn('auth_login_failed', { username });
          return null;
        }
        logger.info('auth_login', { role: result.role });
        localStorage.setItem(SESSION_STORAGE_KEY, result.token);
        setToken(result.token);
        setRole(result.role);
        return result.role;
      },
      logout: () => {
        if (token) {
          void requestLogout(token);
        }
        logger.info('auth_logout', { role });
        localStorage.removeItem(SESSION_STORAGE_KEY);
        setToken(null);
        setRole(null);
      },
    }),
    [role, token, isInitializing],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
