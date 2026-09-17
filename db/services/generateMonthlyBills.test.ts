// @vitest-environment node
import Knex, { type Knex as KnexType } from 'knex';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateMonthlyBills } from './generateMonthlyBills';

let db: KnexType;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-billing-'));
  db = Knex({
    client: 'better-sqlite3',
    connection: { filename: path.join(tmpDir, 'test.sqlite3') },
    useNullAsDefault: true,
    migrations: { directory: path.join(__dirname, '..', 'migrations'), extension: 'cjs' },
  });
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

describe('generateMonthlyBills', () => {
  it('creates exactly one bill per active flat using its configured amount (AC1)', async () => {
    await db.migrate.latest();
    const flatA = await seedFlat({ flat_number: '101', monthly_maintenance_amount: 1500 });
    const flatB = await seedFlat({ flat_number: '102', monthly_maintenance_amount: 2000 });

    const result = await generateMonthlyBills(db, '2026-02');

    expect(result.created.map((c) => c.flatId).sort()).toEqual([flatA, flatB].sort());
    const bills = await db('bills').select('flat_id', 'amount').where({ billing_period: '2026-02' });
    expect(bills).toHaveLength(2);
    expect(Number(bills.find((b) => b.flat_id === flatA)?.amount)).toBe(1500);
    expect(Number(bills.find((b) => b.flat_id === flatB)?.amount)).toBe(2000);
  });

  it('does not create a duplicate bill on a second run for the same flat/month (AC2)', async () => {
    await db.migrate.latest();
    const flatId = await seedFlat();
    await generateMonthlyBills(db, '2026-02');

    const secondRun = await generateMonthlyBills(db, '2026-02');

    const bills = await db('bills').where({ flat_id: flatId, billing_period: '2026-02' });
    expect(bills).toHaveLength(1);
    expect(secondRun.alreadyExists.map((f) => f.flatId)).toContain(flatId);
  });

  it('does not roll back bills already created when another flat fails (AC4)', async () => {
    await db.migrate.latest();
    const goodFlat = await seedFlat({ flat_number: '101' });
    const brokenFlat = await seedFlat({ flat_number: '102', monthly_maintenance_amount: null });

    const result = await generateMonthlyBills(db, '2026-02');

    const goodBill = await db('bills').where({ flat_id: goodFlat, billing_period: '2026-02' }).first();
    expect(goodBill).toBeDefined();
    expect(result.failed.map((f) => f.flatId)).toContain(brokenFlat);
    expect(result.failed.find((f) => f.flatId === brokenFlat)?.reason).toBeTruthy();
  });

  it('does not create a bill for a deactivated flat (AC10)', async () => {
    await db.migrate.latest();
    const inactiveFlat = await seedFlat({ is_active: false });

    await generateMonthlyBills(db, '2026-02');

    expect(await db('bills').where({ flat_id: inactiveFlat })).toHaveLength(0);
  });

  it('creates no bills when there are no active flats (AC12)', async () => {
    await db.migrate.latest();
    await seedFlat({ is_active: false });

    const result = await generateMonthlyBills(db, '2026-02');

    expect(result.created).toHaveLength(0);
    expect(await db('bills')).toHaveLength(0);
  });

  it('creates bills with an unpaid status (AC9)', async () => {
    await db.migrate.latest();
    await seedFlat();

    await generateMonthlyBills(db, '2026-02');

    const [bill] = await db('bills').where({ billing_period: '2026-02' });
    expect(bill.status).toBe('unpaid');
  });
});
