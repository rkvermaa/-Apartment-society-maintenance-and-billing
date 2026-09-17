import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext, type Role } from './auth/AuthContext';

interface RenderWithAuthOptions {
  role?: Role | null;
  token?: string | null;
  initialEntries?: string[];
}

export function renderWithAuth(ui: ReactElement, options: RenderWithAuthOptions = {}) {
  const { role = null, token = null, initialEntries = ['/'] } = options;

  const authValue = {
    isAuthenticated: role !== null,
    role,
    token,
    login: () => {},
    logout: () => {},
  };

  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
    </AuthContext.Provider>,
  );
}
