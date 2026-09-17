import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { App } from '../App';
import * as authApiClient from './authApiClient';

vi.mock('./authApiClient');

function renderApp(initialEntries: string[]) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <App />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('AuthProvider session restoration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(authApiClient.login).mockReset();
    vi.mocked(authApiClient.fetchSession).mockReset();
    vi.mocked(authApiClient.logout).mockReset();
  });

  it('AC5: restores an authenticated session from a valid stored token without re-login', async () => {
    localStorage.setItem('sessionToken', 'fake-valid-token');
    vi.mocked(authApiClient.fetchSession).mockResolvedValue({ role: 'admin' });

    renderApp(['/admin/dashboard']);

    expect(await screen.findByRole('heading', { name: 'Admin Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Log in' })).not.toBeInTheDocument();
  });

  it('AC7: redirects to login when the stored token is invalid or expired', async () => {
    localStorage.setItem('sessionToken', 'fake-expired-token');
    vi.mocked(authApiClient.fetchSession).mockResolvedValue(null);

    renderApp(['/admin/billing']);

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(localStorage.getItem('sessionToken')).toBeNull();
  });

  it('AC9: logging out clears the session so the protected route requires login again', async () => {
    localStorage.setItem('sessionToken', 'fake-admin-token');
    vi.mocked(authApiClient.fetchSession).mockResolvedValue({ role: 'admin' });
    vi.mocked(authApiClient.logout).mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderApp(['/admin/dashboard']);
    await screen.findByRole('heading', { name: 'Admin Dashboard' });

    await user.click(screen.getByRole('button', { name: 'Log out' }));

    expect(authApiClient.logout).toHaveBeenCalledWith('fake-admin-token');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(localStorage.getItem('sessionToken')).toBeNull();
  });
});
