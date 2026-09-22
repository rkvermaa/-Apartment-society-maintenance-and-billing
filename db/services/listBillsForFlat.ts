import type { Knex } from 'knex';

export interface ResidentBillListItem {
  id: number;
  billingPeriod: string;
  amount: number;
  status: string;
}

export async function listBillsForFlat(db: Knex, flatId: number): Promise<ResidentBillListItem[]> {
  const rows = await db('bills')
    .where('flat_id', flatId)
    .orderBy('billing_period', 'desc')
    .select('id', 'billing_period as billingPeriod', 'amount', 'status');
  return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}
