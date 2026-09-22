// @vitest-environment node
import Knex, { type Knex as KnexType } from 'knex';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listBillsForFlat } from './listBillsForFlat';

let db: KnexType;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-bills-for-flat-'));
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

async function seedFlat(overrides: Partial<{ flat_number: string; block: string }> = {}): Promise<number> {
  const [flat] = await db('flats')
    .insert({ flat_number: '101', block: 'A', is_active: true, monthly_maintenance_amount: 1500, ...overrides })
    .returning('id');
  return flat.id as number;
}

async function seedBill(
  flatId: number,
  overrides: Partial<{ billing_period: string; amount: number; status: string }> = {},
) {
  await db('bills').insert({
    flat_id: flatId,
    billing_period: '2026-02',
    amount: 1500,
    due_date: '2026-02-28',
    status: 'unpaid',
    ...overrides,
  });
}

describe('listBillsForFlat', () => {
  it('returns the bills for the requested flat (AC1)', async () => {
    await db.migrate.latest();
    const flatId = await seedFlat({ flat_number: '101', block: 'A' });
    await seedBill(flatId, { billing_period: '2026-02', amount: 1500, status: 'unpaid' });

    const bills = await listBillsForFlat(db, flatId);

    expect(bills).toEqual([
      expect.objectContaining({ billingPeriod: '2026-02', amount: 1500, status: 'unpaid' }),
    ]);
  });

  it('returns an empty array for a flat with no bills yet (AC2)', async () => {
    await db.migrate.latest();
    const flatId = await seedFlat();

    const bills = await listBillsForFlat(db, flatId);

    expect(bills).toEqual([]);
  });

  it('excludes bills from other flats', async () => {
    await db.migrate.latest();
    const flatId = await seedFlat({ flat_number: '101', block: 'A' });
    const otherFlatId = await seedFlat({ flat_number: '102', block: 'A' });
    await seedBill(flatId, { billing_period: '2026-02' });
    await seedBill(otherFlatId, { billing_period: '2026-02' });

    const bills = await listBillsForFlat(db, flatId);

    expect(bills).toHaveLength(1);
  });

  it('orders bills by billing period descending, across multiple periods', async () => {
    await db.migrate.latest();
    const flatId = await seedFlat();
    await seedBill(flatId, { billing_period: '2026-01' });
    await seedBill(flatId, { billing_period: '2026-03' });
    await seedBill(flatId, { billing_period: '2026-02' });

    const bills = await listBillsForFlat(db, flatId);

    expect(bills.map((bill) => bill.billingPeriod)).toEqual(['2026-03', '2026-02', '2026-01']);
  });
});
