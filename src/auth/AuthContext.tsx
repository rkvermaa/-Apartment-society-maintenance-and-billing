import { createContext, useMemo, useState, type ReactNode } from 'react';
import { logger } from '../lib/logger';

export type Role = 'admin' | 'resident';

export interface AuthContextValue {
  isAuthenticated: boolean;
  role: Role | null;
  token: string | null;
  login: (role: Role, token: string) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// role/token are populated only from the server's response to POST /api/auth/login
// (see LoginScreen), which itself only issues a token after verifying real
// credentials server-side (server/routes/auth.ts) - never trust a client-asserted role.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: role !== null,
      role,
      token,
      login: (nextRole: Role, nextToken: string) => {
        logger.info('auth_login', { role: nextRole });
        setRole(nextRole);
        setToken(nextToken);
      },
      logout: () => {
        logger.info('auth_logout', { role });
        setRole(null);
        setToken(null);
      },
    }),
    [role, token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
