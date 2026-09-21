import express, { type NextFunction, type Request, type Response } from 'express';
import type { Knex } from 'knex';
import { listBillsForMonth } from '../db/services/listBillsForMonth';
import { requireRole } from './auth';
import { InvalidFlatUpdateError, listFlats, updateFlat } from '../db/services/flats';
import { loginWithCredentials, verifySessionToken, type SessionPayload } from './session';

function bearerToken(req: Request): string | undefined {
  const header = req.header('authorization');
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
}

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
  app.use(express.json());

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
  }

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body ?? {};
    const session =
      typeof username === 'string' && typeof password === 'string'
        ? loginWithCredentials(username, password)
        : null;
    if (!session) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }
    res.json(session);
  });

  function requireAdmin(req: Request, res: Response, next: NextFunction) {
    const session = verifySessionToken(bearerToken(req));
    if (!session || session.role !== 'admin') {
      res.status(403).json({ error: 'Admin role required.' });
      return;
    }
    res.locals.actor = session;
    next();
  }

  app.get('/api/flats', requireAdmin, async (_req, res) => {
    res.json(await listFlats(db));
  });

  app.patch('/api/flats/:id', requireAdmin, async (req, res) => {
    const actingUsername = (res.locals.actor as SessionPayload).username;
    try {
      const updated = await updateFlat(db, Number(req.params.id), req.body, actingUsername);
      res.json(updated);
    } catch (error) {
      if (error instanceof InvalidFlatUpdateError) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  return app;
}
