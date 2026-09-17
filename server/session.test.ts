// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { issueSessionToken, loginWithCredentials, verifySessionToken } from './session';

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
