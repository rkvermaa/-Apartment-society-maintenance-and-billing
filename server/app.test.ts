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

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-api-'));
  db = Knex({
    client: 'better-sqlite3',
    connection: { filename: path.join(tmpDir, 'test.sqlite3') },
    useNullAsDefault: true,
    migrations: { directory: path.join(__dirname, '..', 'db', 'migrations'), extension: 'cjs' },
  });
});

afterEach(async () => {
  await db.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/bills', () => {
  it('returns bills for an authenticated admin (AC1)', async () => {
    await db.migrate.latest();
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

  it('includes resident payment audit fields when a bill has been paid (AC1, AC2)', async () => {
    await db.migrate.latest();
    const [role] = await db('roles').insert({ name: 'resident' }).returning('id');
    const [flat] = await db('flats')
      .insert({ flat_number: '101', block: 'A', is_active: true, monthly_maintenance_amount: 1500 })
      .returning('id');
    const [resident] = await db('users')
      .insert({
        name: 'Jane Doe',
        email: 'jane@example.com',
        password_hash: 'hash',
        role_id: role.id,
        flat_id: flat.id,
      })
      .returning('id');
    const [bill] = await db('bills')
      .insert({ flat_id: flat.id, billing_period: '2026-02', amount: 1500, due_date: '2026-02-28', status: 'paid' })
      .returning('id');
    await db('payments').insert({
      bill_id: bill.id,
      amount: 1500,
      paid_at: '2026-02-15T10:00:00.000Z',
      method: 'cash',
      recorded_by_user_id: resident.id,
    });
    const app = createApp(db, { unverifiedRoleAuthEnabled: true });

    const response = await request(app).get('/api/bills?month=2026-02').set('X-Demo-Role', 'admin');

    expect(response.body).toEqual([
      expect.objectContaining({ status: 'paid', paidByResidentName: 'Jane Doe', paidAt: '2026-02-15T10:00:00.000Z' }),
    ]);
  });

  it('denies a non-admin authenticated caller (AC5)', async () => {
    await db.migrate.latest();
    const app = createApp(db, { unverifiedRoleAuthEnabled: true });

    const response = await request(app).get('/api/bills?month=2026-02').set('X-Demo-Role', 'resident');

    expect(response.status).toBe(403);
  });

  it('denies an unauthenticated caller with no role header (AC6)', async () => {
    await db.migrate.latest();
    const app = createApp(db, { unverifiedRoleAuthEnabled: true });

    const response = await request(app).get('/api/bills?month=2026-02');

    expect(response.status).toBe(401);
  });

  it('is not reachable at all when unverified role auth is disabled, even for an admin caller', async () => {
    await db.migrate.latest();
    const app = createApp(db, { unverifiedRoleAuthEnabled: false });

    const response = await request(app).get('/api/bills?month=2026-02').set('X-Demo-Role', 'admin');

    expect(response.status).toBe(404);
  });
});
