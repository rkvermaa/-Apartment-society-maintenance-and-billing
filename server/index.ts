import Knex from 'knex';
import knexConfig from '../db/knexfile.cjs';
import { createApp } from './app';

const db = Knex(knexConfig);
const app = createApp(db);
const port = Number(process.env.ARC_DEV_PORT) || 8001;

app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});
