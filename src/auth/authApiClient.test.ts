import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSession, login, logout } from './authApiClient';

describe('authApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AC1/AC2: returns the issued token and role on a successful login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'fake-session-token', role: 'admin' }) }));
    const result = await login('admin', 'admin123');
    expect(result).toEqual({ token: 'fake-session-token', role: 'admin' });
  });

  it('AC3/AC4: returns null and surfaces no token when the API rejects credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Invalid username or password' }) }));
    const result = await login('admin', 'wrong-password');
    expect(result).toBeNull();
  });

  it('AC6: returns null when the session token is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Unauthorized' }) }));
    const result = await fetchSession('bad-token');
    expect(result).toBeNull();
  });

  it('AC9: sends the bearer token when logging out', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await logout('fake-session-token');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({
      headers: { Authorization: 'Bearer fake-session-token' },
    }));
  });
});
