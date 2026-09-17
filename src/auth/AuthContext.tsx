import { createContext, useMemo, useState, type ReactNode } from 'react';
import { logger } from '../lib/logger';

export type Role = 'admin' | 'resident';

export interface AuthContextValue {
  isAuthenticated: boolean;
  role: Role | null;
  username: string | null;
  login: (role: Role, username: string) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Role and username live in client state for this shell story only because there is no
// backend in this codebase yet; STORY-013 owns credential verification and
// session issuance, and once wired up this provider must derive identity from
// that server-issued session rather than trusting client-set state directly.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: role !== null,
      role,
      username,
      login: (nextRole: Role, nextUsername: string) => {
        logger.info('auth_login', { role: nextRole });
        setRole(nextRole);
        setUsername(nextUsername);
      },
      logout: () => {
        logger.info('auth_logout', { role });
        setRole(null);
        setUsername(null);
      },
    }),
    [role, username],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
