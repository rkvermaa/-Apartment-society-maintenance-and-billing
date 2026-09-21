// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueSessionToken, loginWithCredentials, verifySessionToken } from './session';

describe('session secret configuration', () => {
  const originalSecret = process.env.SESSION_SECRET;

  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
  });

  it('refuses to sign or verify sessions without a hardcoded fallback secret when SESSION_SECRET is unset', async () => {
    delete process.env.SESSION_SECRET;
    vi.resetModules();

    await expect(import('./session')).rejects.toThrow(
      'SESSION_SECRET environment variable is required',
    );
  });
});

describe('session', () => {
  it('round-trips a signed session token', () => {
    const token = issueSessionToken({ username: 'admin-jane', role: 'admin' });

    expect(verifySessionToken(token)).toEqual({ username: 'admin-jane', role: 'admin' });
  });

  it('rejects a token whose payload was tampered with to escalate its role', () => {
    const token = issueSessionToken({ username: 'attacker', role: 'resident' });
    const [, signature] = token.split('.');
    const tamperedBody = Buffer.from(JSON.stringify({ username: 'attacker', role: 'admin' })).toString(
      'base64url',
    );

    expect(verifySessionToken(`${tamperedBody}.${signature}`)).toBeNull();
  });

  it('rejects a malformed or missing token', () => {
    expect(verifySessionToken('not-a-real-token')).toBeNull();
    expect(verifySessionToken(undefined)).toBeNull();
  });

  it('issues a session only for valid demo credentials', () => {
    expect(loginWithCredentials('admin', 'wrong-password')).toBeNull();

    const session = loginWithCredentials('admin', 'admin123');

    expect(session?.role).toBe('admin');
    expect(typeof session?.token).toBe('string');
  });
});
