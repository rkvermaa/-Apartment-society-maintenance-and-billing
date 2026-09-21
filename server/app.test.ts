// @vitest-environment node
import Knex, { type Knex as KnexType } from 'knex';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';

let db: KnexType;
let tmpDir: string;
let app: Express;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-billing-api-'));
  db = Knex({
    client: 'better-sqlite3',
    connection: { filename: path.join(tmpDir, 'test.sqlite3') },
    useNullAsDefault: true,
    migrations: { directory: path.join(__dirname, '..', 'db', 'migrations'), extension: 'cjs' },
  });
  await db.migrate.latest();
  app = createApp(db);
});

afterEach(async () => {
  await db.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function seedFlat(
  overrides: Partial<{
    flat_number: string;
    block: string;
    is_active: boolean;
    monthly_maintenance_amount: number | null;
  }> = {},
): Promise<number> {
  const [flat] = await db('flats')
    .insert({
      flat_number: '101',
      block: 'A',
      is_active: true,
      monthly_maintenance_amount: 1500,
      ...overrides,
    })
    .returning('id');
  return flat.id as number;
}

const CREDENTIALS = {
  admin: { username: 'admin', password: 'admin123' },
  resident: { username: 'resident', password: 'resident123' },
};

async function loginAs(role: 'admin' | 'resident'): Promise<string> {
  const response = await request(app).post('/api/auth/login').send(CREDENTIALS[role]);
  return response.body.token as string;
}

function bearer(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

describe('POST /api/auth/login', () => {
  it('returns a role and a session token for valid credentials', async () => {
    const response = await request(app).post('/api/auth/login').send(CREDENTIALS.admin);

    expect(response.status).toBe(200);
    expect(response.body.role).toBe('admin');
    expect(typeof response.body.token).toBe('string');
    expect(response.body.token.length).toBeGreaterThan(0);
  });

  it('rejects invalid credentials without issuing a token', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body.token).toBeUndefined();
  });
});

describe('POST /api/billing/generate', () => {
  it('returns per-flat created results for an admin (AC1)', async () => {
    await seedFlat();
    const token = await loginAs('admin');

    const response = await request(app)
      .post('/api/billing/generate')
      .set(...bearer(token))
      .send({ billingPeriod: '2026-02' });

    expect(response.status).toBe(200);
    expect(response.body.createdCount).toBe(1);
    expect(response.body.alreadyExistingCount).toBe(0);
    expect(response.body.failures).toEqual([]);
  });

  it('returns already-exists results on a repeat trigger for the same month (AC4, AC5)', async () => {
    await seedFlat();
    const token = await loginAs('admin');

    await request(app).post('/api/billing/generate').set(...bearer(token)).send({ billingPeriod: '2026-02' });
    const second = await request(app)
      .post('/api/billing/generate')
      .set(...bearer(token))
      .send({ billingPeriod: '2026-02' });

    expect(second.body.alreadyExistingCount).toBe(1);
    expect(second.body.createdCount).toBe(0);
    expect(await db('bills')).toHaveLength(1);
  });

  it('creates only one bill and both responses agree when two requests race (AC6, AC7)', async () => {
    await seedFlat();
    const token = await loginAs('admin');

    const [first, second] = await Promise.all([
      request(app).post('/api/billing/generate').set(...bearer(token)).send({ billingPeriod: '2026-02' }),
      request(app).post('/api/billing/generate').set(...bearer(token)).send({ billingPeriod: '2026-02' }),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.createdCount + second.body.createdCount).toBe(1);
    expect(first.body.alreadyExistingCount + second.body.alreadyExistingCount).toBe(1);
  });

  it('returns per-flat failures with flat labels for flats missing an amount', async () => {
    const failingFlatId = await seedFlat({ monthly_maintenance_amount: null });
    const token = await loginAs('admin');

    const response = await request(app)
      .post('/api/billing/generate')
      .set(...bearer(token))
      .send({ billingPeriod: '2026-02' });

    expect(response.body.failures).toEqual([
      expect.objectContaining({ flatId: failingFlatId, flatLabel: 'A-101' }),
    ]);
  });

  it('denies a non-admin caller and a caller with no token (AC13)', async () => {
    await seedFlat();
    const residentToken = await loginAs('resident');

    const resident = await request(app)
      .post('/api/billing/generate')
      .set(...bearer(residentToken))
      .send({ billingPeriod: '2026-02' });
    expect(resident.status).toBe(403);

    const anonymous = await request(app).post('/api/billing/generate').send({ billingPeriod: '2026-02' });
    expect(anonymous.status).toBe(401);

    expect(await db('bills')).toHaveLength(0);
  });

  it('denies a request that forges an x-user-role header without a valid session token', async () => {
    await seedFlat();

    const response = await request(app)
      .post('/api/billing/generate')
      .set('x-user-role', 'admin')
      .send({ billingPeriod: '2026-02' });

    expect(response.status).toBe(401);
    expect(await db('bills')).toHaveLength(0);
  });

  it('denies a request with a garbage/tampered bearer token', async () => {
    const response = await request(app)
      .post('/api/billing/generate')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ billingPeriod: '2026-02' });

    expect(response.status).toBe(401);
  });

  it('rejects a malformed billing period', async () => {
    const token = await loginAs('admin');
    const response = await request(app)
      .post('/api/billing/generate')
      .set(...bearer(token))
      .send({ billingPeriod: 'not-a-month' });

    expect(response.status).toBe(400);
  });
});

describe('GET /api/billing/bills', () => {
  it('lists bills for a month with a flat label (AC1)', async () => {
    await seedFlat();
    const token = await loginAs('admin');
    await request(app).post('/api/billing/generate').set(...bearer(token)).send({ billingPeriod: '2026-02' });

    const response = await request(app).get('/api/billing/bills?month=2026-02').set(...bearer(token));

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ flatLabel: 'A-101', status: 'unpaid' })]);
  });

  it('denies a non-admin caller (AC13)', async () => {
    const residentToken = await loginAs('resident');
    const response = await request(app).get('/api/billing/bills?month=2026-02').set(...bearer(residentToken));
    expect(response.status).toBe(403);
  });
});
