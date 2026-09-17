import Knex from 'knex';
import knexConfig from '../db/knexfile.cjs';
import { createApp } from './app';

const db = Knex(knexConfig);
const port = Number(process.env.ARC_DEV_PORT) || 8003;

createApp(db).listen(port, () => {
  console.log(`Billing API listening on port ${port}`);
});
