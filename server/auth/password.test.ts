// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('verifies a matching password against its stored hash', () => {
    const stored = hashPassword('admin123');
    expect(verifyPassword('admin123', stored)).toBe(true);
  });

  it('rejects a non-matching password', () => {
    const stored = hashPassword('admin123');
    expect(verifyPassword('wrong-password', stored)).toBe(false);
  });
});
