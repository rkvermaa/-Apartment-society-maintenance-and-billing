import { createContext, useMemo, useState, type ReactNode } from 'react';

export type Role = 'admin' | 'resident';

export interface AuthContextValue {
  isAuthenticated: boolean;
  role: Role | null;
  login: (role: Role) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(null);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: role !== null,
      role,
      login: (nextRole: Role) => setRole(nextRole),
      logout: () => setRole(null),
    }),
    [role],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
