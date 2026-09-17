// @vitest-environment node
import express from 'express';
import Knex, { type Knex as KnexType } from 'knex';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireSession } from './requireSession';
import { requireRole } from './requireRole';
import { createSession } from '../auth/sessions';

let db: KnexType;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-middleware-'));
  db = Knex({
    client: 'better-sqlite3',
    connection: { filename: path.join(tmpDir, 'test.sqlite3') },
    useNullAsDefault: true,
    migrations: { directory: path.join(__dirname, '..', '..', 'db', 'migrations'), extension: 'cjs' },
  });
  await db.migrate.latest();
});

afterEach(async () => {
  await db.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function buildTestApp() {
  const app = express();
  app.get('/protected', requireSession(db), (req, res) => res.json({ role: req.user!.role }));
  app.get('/admin-only', requireSession(db), requireRole('admin'), (req, res) => res.json({ ok: true }));
  return app;
}

describe('requireSession + requireRole middleware', () => {
  it('AC5/AC6: authenticates a valid token and rejects an unrecognized one', async () => {
    const adminUser = await db('users').where({ email: 'admin' }).first();
    const { token } = await createSession(db, adminUser.id);
    const app = buildTestApp();

    const authenticated = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(authenticated.status).toBe(200);
    expect(authenticated.body.role).toBe('admin');

    const rejected = await request(app).get('/protected').set('Authorization', 'Bearer nonsense');
    expect(rejected.status).toBe(401);
  });

  it('AC8: denies a valid non-admin session token on an admin-only route', async () => {
    const residentUser = await db('users').where({ email: 'resident' }).first();
    const { token } = await createSession(db, residentUser.id);
    const app = buildTestApp();

    const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('AC8: grants a valid admin session token on an admin-only route', async () => {
    const adminUser = await db('users').where({ email: 'admin' }).first();
    const { token } = await createSession(db, adminUser.id);
    const app = buildTestApp();

    const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
