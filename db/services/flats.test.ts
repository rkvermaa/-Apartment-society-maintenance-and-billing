// @vitest-environment node
import Knex, { type Knex as KnexType } from 'knex';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvalidFlatUpdateError, listFlats, updateFlat } from './flats';

let db: KnexType;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-flats-'));
  db = Knex({
    client: 'better-sqlite3',
    connection: { filename: path.join(tmpDir, 'test.sqlite3') },
    useNullAsDefault: true,
    migrations: { directory: path.join(__dirname, '..', 'migrations'), extension: 'cjs' },
  });
  await db.migrate.latest();
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

describe('flats service', () => {
  it('lists flats with their real active flag and maintenance amount (AC1)', async () => {
    await seedFlat({ flat_number: '101', is_active: true, monthly_maintenance_amount: 1500 });

    const flats = await listFlats(db);

    expect(flats).toEqual([
      expect.objectContaining({ flatNumber: '101', isActive: true, monthlyMaintenanceAmount: 1500 }),
    ]);
  });

  it('rejects a negative monthly maintenance amount without writing (AC2)', async () => {
    const flatId = await seedFlat({ monthly_maintenance_amount: 1500 });

    await expect(updateFlat(db, flatId, { monthlyMaintenanceAmount: -1 }, 'admin')).rejects.toThrow(
      InvalidFlatUpdateError,
    );
    const row = await db('flats').where({ id: flatId }).first();
    expect(Number(row.monthly_maintenance_amount)).toBe(1500);
  });

  it('accepts zero as a valid monthly maintenance amount (AC4)', async () => {
    const flatId = await seedFlat({ monthly_maintenance_amount: 1500 });

    const updated = await updateFlat(db, flatId, { monthlyMaintenanceAmount: 0 }, 'admin');

    expect(updated.monthlyMaintenanceAmount).toBe(0);
  });

  it('stamps the acting admin and a timestamp on a successful edit (AC7)', async () => {
    const flatId = await seedFlat();

    const updated = await updateFlat(db, flatId, { monthlyMaintenanceAmount: 1800 }, 'admin-jane');

    expect(updated.updatedBy).toBe('admin-jane');
    expect(updated.updatedAt).not.toBeNull();
  });

  it('toggles the active flag (AC8)', async () => {
    const flatId = await seedFlat({ is_active: true });

    const updated = await updateFlat(db, flatId, { isActive: false }, 'admin');

    expect(updated.isActive).toBe(false);
  });
});
