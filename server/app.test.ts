// @vitest-environment node
import Knex, { type Knex as KnexType } from 'knex';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { issueSessionToken } from './session';

let db: KnexType;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-server-'));
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

describe('GET /api/bills', () => {
  it('returns bills for an authenticated admin (AC1)', async () => {
    const [flat] = await db('flats')
      .insert({ flat_number: '101', block: 'A', is_active: true, monthly_maintenance_amount: 1500 })
      .returning('id');
    await db('bills').insert({
      flat_id: flat.id,
      billing_period: '2026-02',
      amount: 1500,
      due_date: '2026-02-28',
      status: 'unpaid',
    });
    const app = createApp(db, { unverifiedRoleAuthEnabled: true });

    const response = await request(app).get('/api/bills?month=2026-02').set('X-Demo-Role', 'admin');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({ flatLabel: 'A-101', billingPeriod: '2026-02', status: 'unpaid' }),
    ]);
  });

  it('denies a non-admin authenticated caller (AC5)', async () => {
    const app = createApp(db, { unverifiedRoleAuthEnabled: true });

    const response = await request(app).get('/api/bills?month=2026-02').set('X-Demo-Role', 'resident');

    expect(response.status).toBe(403);
  });

  it('denies an unauthenticated caller with no role header (AC6)', async () => {
    const app = createApp(db, { unverifiedRoleAuthEnabled: true });

    const response = await request(app).get('/api/bills?month=2026-02');

    expect(response.status).toBe(401);
  });

  it('is not reachable at all when unverified role auth is disabled, even for an admin caller', async () => {
    const app = createApp(db, { unverifiedRoleAuthEnabled: false });

    const response = await request(app).get('/api/bills?month=2026-02').set('X-Demo-Role', 'admin');

    expect(response.status).toBe(404);
  });
});

async function seedFlat(): Promise<number> {
  const [flat] = await db('flats')
    .insert({ flat_number: '101', block: 'A', is_active: true, monthly_maintenance_amount: 1500 })
    .returning('id');
  return flat.id as number;
}

const adminToken = (username = 'admin-jane') => issueSessionToken({ username, role: 'admin' });
const residentToken = (username = 'resident-bob') => issueSessionToken({ username, role: 'resident' });

describe('flats API', () => {
  it('issues a signed session token for valid demo credentials', async () => {
    const app = createApp(db, { unverifiedRoleAuthEnabled: false });

    const res = await request(app).post('/api/login').send({ username: 'admin', password: 'admin123' });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
    expect(typeof res.body.token).toBe('string');
  });

  it('rejects a login attempt with invalid credentials', async () => {
    const app = createApp(db, { unverifiedRoleAuthEnabled: false });

    const res = await request(app).post('/api/login').send({ username: 'admin', password: 'wrong-password' });

    expect(res.status).toBe(401);
  });

  it('returns real stored flats to a caller holding a valid admin session token, not a placeholder (AC1)', async () => {
    await seedFlat();
    const app = createApp(db, { unverifiedRoleAuthEnabled: false });

    const res = await request(app).get('/api/flats').set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ flatNumber: '101', isActive: true, monthlyMaintenanceAmount: 1500 }),
    ]);
  });

  it('rejects a negative monthly maintenance amount (AC2)', async () => {
    const flatId = await seedFlat();
    const app = createApp(db, { unverifiedRoleAuthEnabled: false });

    const res = await request(app)
      .patch(`/api/flats/${flatId}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ monthlyMaintenanceAmount: -100 });

    expect(res.status).toBe(400);
    const row = await db('flats').where({ id: flatId }).first();
    expect(Number(row.monthly_maintenance_amount)).toBe(1500);
  });

  it('rejects a caller holding a valid resident session token without returning or modifying any flat data (AC6)', async () => {
    const flatId = await seedFlat();
    const app = createApp(db, { unverifiedRoleAuthEnabled: false });

    const listRes = await request(app).get('/api/flats').set('Authorization', `Bearer ${residentToken()}`);
    const patchRes = await request(app)
      .patch(`/api/flats/${flatId}`)
      .set('Authorization', `Bearer ${residentToken()}`)
      .send({ monthlyMaintenanceAmount: 2000 });

    expect(listRes.status).toBe(403);
    expect(listRes.body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: flatId })]));
    expect(patchRes.status).toBe(403);
    const row = await db('flats').where({ id: flatId }).first();
    expect(Number(row.monthly_maintenance_amount)).toBe(1500);
  });

  it('rejects a request with no session token at all', async () => {
    const app = createApp(db, { unverifiedRoleAuthEnabled: false });

    const res = await request(app).get('/api/flats');

    expect(res.status).toBe(403);
  });

  it('rejects a forged token claiming an admin role, since a spoofed header alone must not grant access', async () => {
    const flatId = await seedFlat();
    const app = createApp(db, { unverifiedRoleAuthEnabled: false });
    const forgedBody = Buffer.from(JSON.stringify({ username: 'attacker', role: 'admin' })).toString(
      'base64url',
    );
    const forgedToken = `${forgedBody}.not-a-real-signature`;

    const listRes = await request(app).get('/api/flats').set('Authorization', `Bearer ${forgedToken}`);
    const patchRes = await request(app)
      .patch(`/api/flats/${flatId}`)
      .set('Authorization', `Bearer ${forgedToken}`)
      .send({ monthlyMaintenanceAmount: 2000 });

    expect(listRes.status).toBe(403);
    expect(patchRes.status).toBe(403);
    const row = await db('flats').where({ id: flatId }).first();
    expect(Number(row.monthly_maintenance_amount)).toBe(1500);
  });

  it('records the acting admin and a timestamp on a successful edit (AC7)', async () => {
    const flatId = await seedFlat();
    const app = createApp(db, { unverifiedRoleAuthEnabled: false });

    await request(app)
      .patch(`/api/flats/${flatId}`)
      .set('Authorization', `Bearer ${adminToken('admin-jane')}`)
      .send({ monthlyMaintenanceAmount: 1800 });

    const row = await db('flats').where({ id: flatId }).first();
    expect(row.updated_by).toBe('admin-jane');
    expect(row.updated_at).not.toBeNull();
  });

  it('accepts toggling the active flag (AC8)', async () => {
    const flatId = await seedFlat();
    const app = createApp(db, { unverifiedRoleAuthEnabled: false });

    const res = await request(app)
      .patch(`/api/flats/${flatId}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });
});
