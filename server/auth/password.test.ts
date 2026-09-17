// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('verifies a matching password against its stored hash', () => {
    const stored = hashPassword('demo-admin-password');
    expect(verifyPassword('demo-admin-password', stored)).toBe(true);
  });

  it('rejects a non-matching password', () => {
    const stored = hashPassword('demo-admin-password');
    expect(verifyPassword('wrong-password', stored)).toBe(false);
  });
});
