import type { Knex } from 'knex';

export interface BillGenerationResult {
  billingPeriod: string;
  created: Array<{ flatId: number; billId: number }>;
  alreadyExists: Array<{ flatId: number }>;
  failed: Array<{ flatId: number; reason: string }>;
}

function lastDayOfMonth(billingPeriod: string): string {
  const [year, month] = billingPeriod.split('-').map(Number);
  const firstOfNextMonth = new Date(Date.UTC(year, month, 1));
  firstOfNextMonth.setUTCDate(firstOfNextMonth.getUTCDate() - 1);
  return firstOfNextMonth.toISOString().slice(0, 10);
}

export async function generateMonthlyBills(
  db: Knex,
  billingPeriod: string,
): Promise<BillGenerationResult> {
  const activeFlats = await db('flats')
    .where({ is_active: true })
    .select<{ id: number; monthly_maintenance_amount: number | null }[]>(
      'id',
      'monthly_maintenance_amount',
    );

  const result: BillGenerationResult = { billingPeriod, created: [], alreadyExists: [], failed: [] };
  const dueDate = lastDayOfMonth(billingPeriod);

  for (const flat of activeFlats) {
    try {
      const inserted = await db('bills')
        .insert({
          flat_id: flat.id,
          billing_period: billingPeriod,
          amount: flat.monthly_maintenance_amount,
          due_date: dueDate,
          status: 'unpaid',
        })
        .onConflict(['flat_id', 'billing_period'])
        .ignore()
        .returning('id');

      if (inserted.length > 0) {
        result.created.push({ flatId: flat.id, billId: inserted[0].id });
      } else {
        result.alreadyExists.push({ flatId: flat.id });
      }
    } catch (error) {
      result.failed.push({
        flatId: flat.id,
        reason: error instanceof Error ? error.message : 'Unknown error generating bill',
      });
    }
  }

  return result;
}
