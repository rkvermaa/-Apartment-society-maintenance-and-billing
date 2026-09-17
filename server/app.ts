import express from 'express';
import type { Knex } from 'knex';
import { listBillsForMonth } from '../db/services/listBillsForMonth';
import { requireRole } from './auth';

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

export function createApp(db: Knex) {
  const app = express();

  app.get('/api/bills', requireRole('admin'), async (req, res) => {
    const month = String(req.query.month ?? '');
    if (!MONTH_PATTERN.test(month)) {
      res.status(400).json({ error: 'month query parameter must be in YYYY-MM format.' });
      return;
    }

    try {
      const bills = await listBillsForMonth(db, month);
      res.json(bills);
    } catch {
      res.status(500).json({ error: 'Failed to load bills.' });
    }
  });

  return app;
}
