import type { Knex } from 'knex';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export type ActorRole = 'admin' | 'resident';

export interface Actor {
  id: number;
  role: ActorRole;
}

export class AuthorizationError extends Error {}

interface AuthenticatedSession {
  userId: number;
  token: string;
  role: ActorRole;
}

const SCRYPT_KEY_LENGTH = 64;

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, derivedKey] = storedHash.split(':');
  if (!salt || !derivedKey) return false;
  const candidateKey = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  const storedKey = Buffer.from(derivedKey, 'hex');
  if (candidateKey.length !== storedKey.length) return false;
  return timingSafeEqual(candidateKey, storedKey);
}

async function recordAuditLog(
  db: Knex,
  entry: { adminId: number; actionType: 'create' | 'update' | 'deactivate'; residentId: number },
): Promise<void> {
  await db('audit_logs').insert({
    admin_id: entry.adminId,
    action_type: entry.actionType,
    resident_id: entry.residentId,
  });
}

async function residentRoleId(db: Knex): Promise<number> {
  const role = await db('roles').where({ name: 'resident' }).first('id');
  return role.id;
}

export async function createResident(
  db: Knex,
  adminId: number,
  input: { username: string; password: string },
): Promise<number> {
  const roleId = await residentRoleId(db);
  const [{ id }] = await db('users')
    .insert({
      name: input.username,
      email: `${input.username}@residents.local`,
      username: input.username,
      password_hash: hashPassword(input.password),
      role_id: roleId,
      is_active: true,
    })
    .returning('id');

  await recordAuditLog(db, { adminId, actionType: 'create', residentId: id });
  return id;
}

export async function updateResidentCredentials(
  db: Knex,
  actor: Actor,
  residentId: number,
  updates: { username?: string; password?: string },
): Promise<void> {
  if (actor.role !== 'admin') {
    throw new AuthorizationError('Only an admin can update resident credentials.');
  }

  const patch: Record<string, unknown> = {};
  if (updates.username) patch.username = updates.username;
  if (updates.password) patch.password_hash = hashPassword(updates.password);
  if (Object.keys(patch).length === 0) return;

  await db('users').where({ id: residentId }).update(patch);
  await recordAuditLog(db, { adminId: actor.id, actionType: 'update', residentId });
}

export async function deactivateResident(db: Knex, adminId: number, residentId: number): Promise<void> {
  await db('users').where({ id: residentId }).update({ is_active: false });
  await db('sessions')
    .where({ user_id: residentId })
    .whereNull('invalidated_at')
    .update({ invalidated_at: db.fn.now() });

  await recordAuditLog(db, { adminId, actionType: 'deactivate', residentId });
}

export async function authenticate(
  db: Knex,
  username: string,
  password: string,
): Promise<AuthenticatedSession | null> {
  const user = await db('users')
    .join('roles', 'roles.id', 'users.role_id')
    .where({ 'users.username': username })
    .first('users.id', 'users.password_hash', 'users.is_active', 'roles.name as role');

  if (!user || !user.is_active) return null;
  if (!verifyPassword(password, user.password_hash)) return null;

  const token = randomBytes(32).toString('hex');
  await db('sessions').insert({ user_id: user.id, token });

  return { userId: user.id, token, role: user.role as ActorRole };
}

export async function isSessionActive(db: Knex, token: string): Promise<boolean> {
  const session = await db('sessions').where({ token }).first('invalidated_at');
  return Boolean(session) && session.invalidated_at === null;
}
