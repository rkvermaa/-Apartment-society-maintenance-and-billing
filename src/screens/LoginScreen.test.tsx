import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { App } from '../App';

function fakeLoginResponse(body: unknown, status: number) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const { username, password } = JSON.parse((init?.body as string) ?? '{}');
      if (username === 'admin' && password === 'admin123') {
        return fakeLoginResponse({ token: 'server-issued-test-token', role: 'admin', username }, 200);
      }
      return fakeLoginResponse({ error: 'Invalid username or password.' }, 401);
    }),
  );
});

describe('LoginScreen', () => {
  it('authenticates via AuthContext on submit and navigates into the shell without a page reload', async () => {
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
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(fetch).toHaveBeenCalledWith('/api/login', expect.objectContaining({ method: 'POST' }));
  });

  it('rejects invalid credentials and keeps the user on the login screen with no auth granted', async () => {
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

    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password.');
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
  });
});
