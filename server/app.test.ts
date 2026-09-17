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
    const app = createApp(db);

    const response = await request(app).get('/api/bills?month=2026-02').set('X-Demo-Role', 'admin');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({ flatLabel: 'A-101', billingPeriod: '2026-02', status: 'unpaid' }),
    ]);
  });

  it('denies a non-admin authenticated caller (AC5)', async () => {
    await db.migrate.latest();
    const app = createApp(db);

    const response = await request(app).get('/api/bills?month=2026-02').set('X-Demo-Role', 'resident');

    expect(response.status).toBe(403);
  });

  it('denies an unauthenticated caller with no role header (AC6)', async () => {
    await db.migrate.latest();
    const app = createApp(db);

    const response = await request(app).get('/api/bills?month=2026-02');

    expect(response.status).toBe(401);
  });
});
