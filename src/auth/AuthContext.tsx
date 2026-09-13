import { createContext, useMemo, useState, type ReactNode } from 'react';
import { logger } from '../lib/logger';

export type Role = 'admin' | 'resident';

export interface AuthContextValue {
  isAuthenticated: boolean;
  role: Role | null;
  login: (role: Role) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Role lives in client state for this shell story only because there is no
// backend in this codebase yet; STORY-013 owns credential verification and
// session issuance, and once wired up this provider must derive role from
// that server-issued session rather than trusting client-set state directly.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(null);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: role !== null,
      role,
      login: (nextRole: Role) => {
        logger.info('auth_login', { role: nextRole });
        setRole(nextRole);
      },
      logout: () => {
        logger.info('auth_logout', { role });
        setRole(null);
      },
    }),
    [role],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
