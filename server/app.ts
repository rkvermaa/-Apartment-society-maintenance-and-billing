import express, { type Express } from 'express';
import type { Knex } from 'knex';
import { createBillingRouter } from './routes/billing';

export function createApp(db: Knex): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/billing', createBillingRouter(db));
  return app;
}
