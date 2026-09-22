import { createContext, useMemo, useState, type ReactNode } from 'react';
import { logger } from '../lib/logger';

export type Role = 'admin' | 'resident';

export interface AuthContextValue {
  isAuthenticated: boolean;
  role: Role | null;
  flatId: number | null;
  login: (role: Role, flatId?: number | null) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Role lives in client state for this shell story only because there is no
// backend in this codebase yet; STORY-013 owns credential verification and
// session issuance, and once wired up this provider must derive role from
// that server-issued session rather than trusting client-set state directly.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(null);
  const [flatId, setFlatId] = useState<number | null>(null);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: role !== null,
      role,
      flatId,
      login: (nextRole: Role, nextFlatId: number | null = null) => {
        logger.info('auth_login', { role: nextRole });
        setRole(nextRole);
        setFlatId(nextFlatId);
      },
      logout: () => {
        logger.info('auth_logout', { role });
        setRole(null);
        setFlatId(null);
      },
    }),
    [role, flatId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
