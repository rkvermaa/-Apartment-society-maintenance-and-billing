// @vitest-environment node
import Knex, { type Knex as KnexType } from 'knex';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AuthorizationError,
  authenticate,
  createResident,
  deactivateResident,
  isSessionActive,
  updateResidentCredentials,
} from './credentialService';

let db: KnexType;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-db-'));
  db = Knex({
    client: 'better-sqlite3',
    connection: { filename: path.join(tmpDir, 'test.sqlite3') },
    useNullAsDefault: true,
    pool: {
      afterCreate: (conn: { pragma: (statement: string) => void }, done: (err: Error | null, conn: unknown) => void) => {
        conn.pragma('foreign_keys = ON');
        done(null, conn);
      },
    },
    migrations: {
      directory: path.join(__dirname, 'migrations'),
      extension: 'cjs',
    },
  });
  await db.migrate.latest();
});

afterEach(async () => {
  await db.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function seedAdmin(): Promise<number> {
  await db('roles').insert([{ name: 'admin' }, { name: 'resident' }]);
  const [{ id }] = await db('users')
    .insert({ name: 'Root Admin', email: 'admin@example.com', username: 'admin', password_hash: 'x', role_id: 1 })
    .returning('id');
  return id;
}

describe('credential management and audit log', () => {
  it('lets a newly created resident log in immediately with the given credentials (AC1)', async () => {
    const adminId = await seedAdmin();
    await createResident(db, adminId, { username: 'jane.doe', password: 'test-password-1' });

    const session = await authenticate(db, 'jane.doe', 'test-password-1');

    expect(session).not.toBeNull();
    expect(session?.role).toBe('resident');
  });

  it('requires the new password on next login after an admin updates it (AC2)', async () => {
    const adminId = await seedAdmin();
    const residentId = await createResident(db, adminId, { username: 'jane.doe', password: 'old-password-1' });

    await updateResidentCredentials(db, { id: adminId, role: 'admin' }, residentId, { password: 'new-password-2' });

    expect(await authenticate(db, 'jane.doe', 'old-password-1')).toBeNull();
    expect(await authenticate(db, 'jane.doe', 'new-password-2')).not.toBeNull();
  });

  it('invalidates all active sessions immediately on deactivation (AC3)', async () => {
    const adminId = await seedAdmin();
    const residentId = await createResident(db, adminId, { username: 'jane.doe', password: 'test-password-1' });
    const sessionA = await authenticate(db, 'jane.doe', 'test-password-1');
    const sessionB = await authenticate(db, 'jane.doe', 'test-password-1');

    await deactivateResident(db, adminId, residentId);

    expect(await isSessionActive(db, sessionA!.token)).toBe(false);
    expect(await isSessionActive(db, sessionB!.token)).toBe(false);
  });

  it('rejects login for a deactivated resident (AC4)', async () => {
    const adminId = await seedAdmin();
    await createResident(db, adminId, { username: 'jane.doe', password: 'test-password-1' });
    const residentId = (await db('users').where({ username: 'jane.doe' }).first('id')).id;

    await deactivateResident(db, adminId, residentId);

    expect(await authenticate(db, 'jane.doe', 'test-password-1')).toBeNull();
  });

  it('rejects a resident changing their own password and makes no change (AC5)', async () => {
    const adminId = await seedAdmin();
    const residentId = await createResident(db, adminId, { username: 'jane.doe', password: 'test-password-1' });

    await expect(
      updateResidentCredentials(db, { id: residentId, role: 'resident' }, residentId, { password: 'hacked-password' }),
    ).rejects.toThrow(AuthorizationError);

    expect(await authenticate(db, 'jane.doe', 'test-password-1')).not.toBeNull();
  });

  it('writes an audit log entry for every credential-management action (AC6)', async () => {
    const adminId = await seedAdmin();
    const residentId = await createResident(db, adminId, { username: 'jane.doe', password: 'test-password-1' });
    await updateResidentCredentials(db, { id: adminId, role: 'admin' }, residentId, { password: 'new-password-2' });
    await deactivateResident(db, adminId, residentId);

    const entries = await db('audit_logs')
      .select('admin_id', 'action_type', 'resident_id', 'created_at')
      .orderBy('id');

    expect(entries.map((e) => e.action_type)).toEqual(['create', 'update', 'deactivate']);
    entries.forEach((entry) => {
      expect(entry.admin_id).toBe(adminId);
      expect(entry.resident_id).toBe(residentId);
      expect(entry.created_at).toBeTruthy();
    });
  });
});
