// @vitest-environment node
import Knex, { type Knex as KnexType } from 'knex';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';

let db: KnexType;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-auth-'));
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

describe('auth API', () => {
  it('AC1: issues a session token for valid admin credentials', async () => {
    const res = await request(createApp(db)).post('/api/auth/login').send({ username: 'admin', password: 'demo-admin-password' });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);
  });

  it('AC3/AC4: rejects invalid credentials and issues no session token', async () => {
    const res = await request(createApp(db)).post('/api/auth/login').send({ username: 'admin', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    expect(await db('sessions')).toHaveLength(0);
  });

  it('AC5: authenticates a subsequent request using the issued token', async () => {
    const app = createApp(db);
    const loginRes = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'demo-admin-password' });
    const sessionRes = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${loginRes.body.token}`);
    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.role).toBe('admin');
  });

  it('AC6: rejects a request with an unrecognized or expired token', async () => {
    const app = createApp(db);
    const unrecognized = await request(app).get('/api/auth/session').set('Authorization', 'Bearer not-a-real-token');
    expect(unrecognized.status).toBe(401);

    const adminUser = await db('users').where({ email: 'admin' }).first();
    await db('sessions').insert({ token: 'expired-token', user_id: adminUser.id, expires_at: new Date(Date.now() - 1000) });
    const expired = await request(app).get('/api/auth/session').set('Authorization', 'Bearer expired-token');
    expect(expired.status).toBe(401);
  });

  it('AC9: rejects a request with a token after logout', async () => {
    const app = createApp(db);
    const loginRes = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'demo-admin-password' });
    const token = loginRes.body.token;
    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`).expect(204);
    const res = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
