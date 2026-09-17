import { createContext, useMemo, useState, type ReactNode } from 'react';
import { logger } from '../lib/logger';

export type Role = 'admin' | 'resident';

export interface AuthContextValue {
  isAuthenticated: boolean;
  role: Role | null;
  username: string | null;
  token: string | null;
  login: (role: Role, username: string, token: string) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Role, username, and token are populated from the signed session the server issues on
// login (see server/session.ts) rather than trusted client-set state: the server verifies
// credentials and signs the session, so a client can't escalate role by forging state here.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: role !== null,
      role,
      username,
      token,
      login: (nextRole: Role, nextUsername: string, nextToken: string) => {
        logger.info('auth_login', { role: nextRole });
        setRole(nextRole);
        setUsername(nextUsername);
        setToken(nextToken);
      },
      logout: () => {
        logger.info('auth_logout', { role });
        setRole(null);
        setUsername(null);
        setToken(null);
      },
    }),
    [role, username, token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
