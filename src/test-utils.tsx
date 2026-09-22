import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext, type Role } from './auth/AuthContext';

interface RenderWithAuthOptions {
  role?: Role | null;
  flatId?: number | null;
  initialEntries?: string[];
}

export function renderWithAuth(ui: ReactElement, options: RenderWithAuthOptions = {}) {
  const { role = null, flatId = null, initialEntries = ['/'] } = options;

  const authValue = {
    isAuthenticated: role !== null,
    role,
    flatId,
    login: () => {},
    logout: () => {},
  };

  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
    </AuthContext.Provider>,
  );
}
