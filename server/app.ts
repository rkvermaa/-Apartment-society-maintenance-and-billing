import express from 'express';
import type { Knex } from 'knex';
import { listBillsForMonth } from '../db/services/listBillsForMonth';
import { listBillsForFlat } from '../db/services/listBillsForFlat';
import { requireRole } from './auth';

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

export interface CreateAppOptions {
  // The `requireRole` middleware currently trusts a caller-asserted `X-Demo-Role` header rather
  // than a server-verified session, because no session/credential-issuing backend exists yet
  // (that is STORY-013's job). Until STORY-013 lands, this must stay `false` in any deployed
  // environment - the route is only registered (and therefore only reachable at all) when this
  // is explicitly turned on, which real deployments must never do.
  unverifiedRoleAuthEnabled: boolean;
}

export function createApp(db: Knex, options: CreateAppOptions) {
  const app = express();

  if (options.unverifiedRoleAuthEnabled) {
    app.get('/api/bills', requireRole('admin'), async (req, res) => {
      const month = String(req.query.month ?? '');
      if (!MONTH_PATTERN.test(month)) {
        res.status(400).json({ error: 'month query parameter must be in YYYY-MM format.' });
        return;
      }

      try {
        const bills = await listBillsForMonth(db, month);
        res.json(bills);
      } catch (err) {
        console.error(`Failed to load bills for month ${month}:`, err);
        res.status(500).json({ error: 'Failed to load bills.' });
      }
    });

    app.get('/api/bills/mine', requireRole('resident'), async (req, res) => {
      const flatId = Number(req.header('x-demo-flat-id'));
      if (!Number.isInteger(flatId) || flatId <= 0) {
        res.status(400).json({ error: 'A valid flat is required.' });
        return;
      }

      try {
        const bills = await listBillsForFlat(db, flatId);
        res.json(bills);
      } catch (err) {
        console.error(`Failed to load bills for flat ${flatId}:`, err);
        res.status(500).json({ error: 'Failed to load bills.' });
      }
    });
  }

  return app;
}
