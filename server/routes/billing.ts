import { Router } from 'express';
import type { Knex } from 'knex';
import { generateMonthlyBills } from '../../db/services/generateMonthlyBills';
import { requireRole } from '../middleware/requireRole';

const BILLING_PERIOD_PATTERN = /^\d{4}-\d{2}$/;

function flatLabel(flat: { block: string; flat_number: string }): string {
  return `${flat.block}-${flat.flat_number}`;
}

export function createBillingRouter(db: Knex): Router {
  const router = Router();

  router.post('/generate', requireRole(['admin']), async (req, res) => {
    const { billingPeriod } = req.body as { billingPeriod?: unknown };
    if (typeof billingPeriod !== 'string' || !BILLING_PERIOD_PATTERN.test(billingPeriod)) {
      res.status(400).json({ error: 'billingPeriod must be in YYYY-MM format.' });
      return;
    }

    const result = await generateMonthlyBills(db, billingPeriod);

    const failedFlatIds = result.failed.map((failure) => failure.flatId);
    const flats = failedFlatIds.length
      ? await db('flats').whereIn('id', failedFlatIds).select('id', 'block', 'flat_number')
      : [];
    const flatsById = new Map(flats.map((flat) => [flat.id, flat]));

    res.status(200).json({
      billingPeriod: result.billingPeriod,
      createdCount: result.created.length,
      alreadyExistingCount: result.alreadyExists.length,
      failures: result.failed.map((failure) => {
        const flat = flatsById.get(failure.flatId);
        return {
          flatId: failure.flatId,
          flatLabel: flat ? flatLabel(flat) : `Flat ${failure.flatId}`,
          reason: failure.reason,
        };
      }),
    });
  });

  router.get('/bills', requireRole(['admin']), async (req, res) => {
    const month = req.query.month;
    if (typeof month !== 'string' || !BILLING_PERIOD_PATTERN.test(month)) {
      res.status(400).json({ error: 'month must be in YYYY-MM format.' });
      return;
    }

    const bills = await db('bills')
      .join('flats', 'flats.id', 'bills.flat_id')
      .where({ 'bills.billing_period': month })
      .select(
        'bills.id as id',
        'flats.block as block',
        'flats.flat_number as flat_number',
        'bills.billing_period as billingPeriod',
        'bills.amount as amount',
        'bills.status as status',
      );

    res.status(200).json(
      bills.map((bill) => ({
        id: bill.id,
        flatLabel: flatLabel(bill),
        billingPeriod: bill.billingPeriod,
        amount: Number(bill.amount),
        status: bill.status,
      })),
    );
  });

  return router;
}
