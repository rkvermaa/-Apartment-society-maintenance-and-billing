// @vitest-environment node
import Knex, { type Knex as KnexType } from 'knex';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';

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

describe('flats API', () => {
  it('returns real stored flats to an admin, not a placeholder (AC1)', async () => {
    await seedFlat();
    const app = createApp(db, { unverifiedRoleAuthEnabled: false });

    const res = await request(app).get('/api/flats').set('x-actor-role', 'admin');

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
      .set('x-actor-role', 'admin')
      .set('x-actor-username', 'admin')
      .send({ monthlyMaintenanceAmount: -100 });

    expect(res.status).toBe(400);
    const row = await db('flats').where({ id: flatId }).first();
    expect(Number(row.monthly_maintenance_amount)).toBe(1500);
  });

  it('rejects a non-admin caller without returning or modifying any flat data (AC6)', async () => {
    const flatId = await seedFlat();
    const app = createApp(db, { unverifiedRoleAuthEnabled: false });

    const listRes = await request(app).get('/api/flats').set('x-actor-role', 'resident');
    const patchRes = await request(app)
      .patch(`/api/flats/${flatId}`)
      .set('x-actor-role', 'resident')
      .send({ monthlyMaintenanceAmount: 2000 });

    expect(listRes.status).toBe(403);
    expect(listRes.body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: flatId })]));
    expect(patchRes.status).toBe(403);
    const row = await db('flats').where({ id: flatId }).first();
    expect(Number(row.monthly_maintenance_amount)).toBe(1500);
  });

  it('records the acting admin and a timestamp on a successful edit (AC7)', async () => {
    const flatId = await seedFlat();
    const app = createApp(db, { unverifiedRoleAuthEnabled: false });

    await request(app)
      .patch(`/api/flats/${flatId}`)
      .set('x-actor-role', 'admin')
      .set('x-actor-username', 'admin-jane')
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
      .set('x-actor-role', 'admin')
      .set('x-actor-username', 'admin')
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });
});
