// @vitest-environment node
import Knex, { type Knex as KnexType } from 'knex';
import bcrypt from 'bcrypt';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetAdminPassword } from './resetAdminPassword.cjs';

let db: KnexType;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-reset-'));
  db = Knex({
    client: 'better-sqlite3',
    connection: { filename: path.join(tmpDir, 'test.sqlite3') },
    useNullAsDefault: true,
    migrations: { directory: path.join(__dirname, '..', 'db', 'migrations'), extension: 'cjs' },
  });
  await db.migrate.latest();
});

afterEach(async () => {
  await db.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function seedAdmin(email: string, passwordHash: string): Promise<number> {
  const [role] = await db('roles').insert({ name: 'admin' }).returning('id');
  const [user] = await db('users')
    .insert({ name: 'Admin', email, password_hash: passwordHash, role_id: role.id })
    .returning('id');
  return user.id as number;
}

describe('resetAdminPassword', () => {
  it('updates the admin password hash so the new password verifies (AC1)', async () => {
    const oldHash = await bcrypt.hash('old-secret', 10);
    await seedAdmin('admin@example.com', oldHash);

    await resetAdminPassword(db, {
      email: 'admin@example.com',
      newPassword: 'new-secret-123',
      performedBy: 'operator',
    });

    const updated = await db('users').where({ email: 'admin@example.com' }).first();
    expect(await bcrypt.compare('new-secret-123', updated.password_hash)).toBe(true);
    expect(await bcrypt.compare('old-secret', updated.password_hash)).toBe(false);
  });

  it('rejects when no admin exists with the given email', async () => {
    await expect(
      resetAdminPassword(db, {
        email: 'missing@example.com',
        newPassword: 'new-secret-123',
        performedBy: 'operator',
      }),
    ).rejects.toThrow('No admin user found with email "missing@example.com"');
  });

  it('stamps password_reset_at as the session-invalidation signal (AC2)', async () => {
    const oldHash = await bcrypt.hash('old-secret', 10);
    await seedAdmin('admin@example.com', oldHash);

    await resetAdminPassword(db, {
      email: 'admin@example.com',
      newPassword: 'new-secret-123',
      performedBy: 'operator',
    });

    const updated = await db('users').where({ email: 'admin@example.com' }).first();
    expect(updated.password_reset_at).not.toBeNull();
  });

  it('creates an audit log entry recording the reset action and timestamp (AC3)', async () => {
    const oldHash = await bcrypt.hash('old-secret', 10);
    const userId = await seedAdmin('admin@example.com', oldHash);

    await resetAdminPassword(db, {
      email: 'admin@example.com',
      newPassword: 'new-secret-123',
      performedBy: 'operator',
    });

    const entries = await db('audit_logs').where({ target_user_id: userId });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'admin_password_reset',
      target_email: 'admin@example.com',
      performed_by: 'operator',
    });
    expect(entries[0].created_at).toBeTruthy();
  });
});
