import type { Knex } from 'knex';

export interface BillListItem {
  id: number;
  flatLabel: string;
  billingPeriod: string;
  amount: number;
  status: string;
}

export async function listBillsForMonth(db: Knex, billingPeriod: string): Promise<BillListItem[]> {
  const rows = await db('bills')
    .join('flats', 'flats.id', 'bills.flat_id')
    .where('bills.billing_period', billingPeriod)
    .select(
      'bills.id as id',
      'bills.billing_period as billingPeriod',
      'bills.amount as amount',
      'bills.status as status',
      db.raw("flats.block || '-' || flats.flat_number as flatLabel"),
    );
  return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}
