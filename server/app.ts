import express, { type NextFunction, type Request, type Response } from 'express';
import type { Knex } from 'knex';
import { InvalidFlatUpdateError, listFlats, updateFlat } from '../db/services/flats';

export function createApp(db: Knex) {
  const app = express();
  app.use(express.json());

  function requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (req.header('x-actor-role') !== 'admin') {
      res.status(403).json({ error: 'Admin role required.' });
      return;
    }
    next();
  }

  app.get('/api/flats', requireAdmin, async (_req, res) => {
    res.json(await listFlats(db));
  });

  app.patch('/api/flats/:id', requireAdmin, async (req, res) => {
    const actingUsername = req.header('x-actor-username') ?? 'unknown';
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
