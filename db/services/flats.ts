import type { Knex } from 'knex';

export interface FlatRecord {
  id: number;
  flatNumber: string;
  block: string;
  isActive: boolean;
  monthlyMaintenanceAmount: number | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface UpdateFlatInput {
  isActive?: boolean;
  monthlyMaintenanceAmount?: number;
}

export class InvalidFlatUpdateError extends Error {}

function toFlatRecord(row: Record<string, unknown>): FlatRecord {
  return {
    id: row.id as number,
    flatNumber: row.flat_number as string,
    block: row.block as string,
    isActive: Boolean(row.is_active),
    monthlyMaintenanceAmount:
      row.monthly_maintenance_amount === null ? null : Number(row.monthly_maintenance_amount),
    updatedBy: (row.updated_by as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

export async function listFlats(db: Knex): Promise<FlatRecord[]> {
  const rows = await db('flats').select('*').orderBy(['block', 'flat_number']);
  return rows.map(toFlatRecord);
}

export async function updateFlat(
  db: Knex,
  flatId: number,
  input: UpdateFlatInput,
  actingUsername: string,
): Promise<FlatRecord> {
  if (
    input.monthlyMaintenanceAmount !== undefined &&
    (typeof input.monthlyMaintenanceAmount !== 'number' ||
      Number.isNaN(input.monthlyMaintenanceAmount) ||
      input.monthlyMaintenanceAmount < 0)
  ) {
    throw new InvalidFlatUpdateError('Monthly maintenance amount must not be negative.');
  }

  const patch: Record<string, unknown> = {
    updated_by: actingUsername,
    updated_at: db.fn.now(),
  };
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (input.monthlyMaintenanceAmount !== undefined) {
    patch.monthly_maintenance_amount = input.monthlyMaintenanceAmount;
  }

  await db('flats').where({ id: flatId }).update(patch);
  const row = await db('flats').where({ id: flatId }).first();
  return toFlatRecord(row);
}
