import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { App } from '../App';
import * as authApiClient from '../auth/authApiClient';

vi.mock('../auth/authApiClient');

beforeEach(() => {
  localStorage.clear();
  vi.mocked(authApiClient.fetchSession).mockResolvedValue(null);
});

describe('LoginScreen', () => {
  it('AC1/AC2: authenticates via the session API on submit and navigates into the shell', async () => {
    vi.mocked(authApiClient.login).mockResolvedValue({ token: 'fake-session-token', role: 'admin' });
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <App />
        </MemoryRouter>
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'admin123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Admin Dashboard' })).toBeInTheDocument();
    expect(localStorage.getItem('sessionToken')).toBe('fake-session-token');
  });

  it('AC3: rejects invalid credentials and keeps the user on the login screen with no auth granted', async () => {
    vi.mocked(authApiClient.login).mockResolvedValue(null);
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <App />
        </MemoryRouter>
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password.');
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
  });
});
