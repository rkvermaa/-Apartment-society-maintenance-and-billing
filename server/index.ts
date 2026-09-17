import Knex from 'knex';
import { createApp } from './app';
import knexConfig from '../db/knexfile.cjs';

const db = Knex(knexConfig);
const port = Number(process.env.PORT) || 4000;
createApp(db).listen(port, () => {
  console.log(`Flats API listening on port ${port}`);
});
