import Knex from 'knex';
import knexConfig from '../db/knexfile.cjs';
import { createApp } from './app';

const db = Knex(knexConfig);
const port = Number(process.env.ARC_DEV_PORT) || 8004;

createApp(db).listen(port, () => {
  console.log(`Bills API listening on port ${port}`);
});
