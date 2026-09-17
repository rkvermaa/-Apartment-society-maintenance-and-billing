import type { Knex } from 'knex';
import { randomBytes } from 'node:crypto';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface AuthenticatedUser {
  id: number;
  email: string;
  role: string;
}

export async function createSession(db: Knex, userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db('sessions').insert({ token, user_id: userId, expires_at: expiresAt });
  return { token, expiresAt };
}

export async function findUserBySessionToken(db: Knex, token: string): Promise<AuthenticatedUser | null> {
  const row = await db('sessions')
    .join('users', 'users.id', 'sessions.user_id')
    .join('roles', 'roles.id', 'users.role_id')
    .where('sessions.token', token)
    .whereNull('sessions.revoked_at')
    .andWhere('sessions.expires_at', '>', new Date())
    .select('users.id', 'users.email', 'roles.name as role')
    .first();
  return row ?? null;
}

export async function revokeSession(db: Knex, token: string): Promise<void> {
  await db('sessions').where({ token }).update({ revoked_at: new Date() });
}
