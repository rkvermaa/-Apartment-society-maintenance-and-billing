import express, { type NextFunction, type Request, type Response } from 'express';
import type { Knex } from 'knex';
import { InvalidFlatUpdateError, listFlats, updateFlat } from '../db/services/flats';
import { loginWithCredentials, verifySessionToken, type SessionPayload } from './session';

function bearerToken(req: Request): string | undefined {
  const header = req.header('authorization');
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
}

export function createApp(db: Knex) {
  const app = express();
  app.use(express.json());

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
