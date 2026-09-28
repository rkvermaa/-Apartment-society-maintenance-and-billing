import type { Knex } from 'knex';

export interface BillListItem {
  id: number;
  flatLabel: string;
  billingPeriod: string;
  amount: number;
  status: string;
  paidByResidentName: string | null;
  paidAt: string | null;
}

export async function listBillsForMonth(db: Knex, billingPeriod: string): Promise<BillListItem[]> {
  const latestPayments = db('payments')
    .select('bill_id')
    .max('id as latest_payment_id')
    .groupBy('bill_id')
    .as('latest_payments');

  const rows = await db('bills')
    .join('flats', 'flats.id', 'bills.flat_id')
    .leftJoin(latestPayments, 'latest_payments.bill_id', 'bills.id')
    .leftJoin('payments', 'payments.id', 'latest_payments.latest_payment_id')
    .leftJoin('users', 'users.id', 'payments.recorded_by_user_id')
    .where('bills.billing_period', billingPeriod)
    .select(
      'bills.id as id',
      'bills.billing_period as billingPeriod',
      'bills.amount as amount',
      'bills.status as status',
      db.raw("flats.block || '-' || flats.flat_number as flatLabel"),
      'users.name as paidByResidentName',
      'payments.paid_at as paidAt',
    );
  return rows.map((row) => ({
    ...row,
    amount: Number(row.amount),
    paidByResidentName: row.paidByResidentName ?? null,
    paidAt: row.paidAt ?? null,
  }));
}
