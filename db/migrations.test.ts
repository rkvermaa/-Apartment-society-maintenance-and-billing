// @vitest-environment node
import Knex, { type Knex as KnexType } from 'knex';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CORE_TABLES = ['roles', 'flats', 'users', 'bills', 'payments'];

let db: KnexType;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-db-'));
  db = Knex({
    client: 'better-sqlite3',
    connection: { filename: path.join(tmpDir, 'test.sqlite3') },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, 'migrations'),
      extension: 'cjs',
    },
  });
});

afterEach(async () => {
  await db.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function tableNames(): Promise<string[]> {
  const rows = await db('sqlite_master').select('name').where({ type: 'table' });
  return rows.map((row) => row.name as string);
}

describe('core domain migrations', () => {
  it('creates all core domain tables (AC1)', async () => {
    await db.migrate.latest();
    expect(await tableNames()).toEqual(expect.arrayContaining(CORE_TABLES));
  });

  it('declares the documented columns and foreign keys (AC2)', async () => {
    await db.migrate.latest();

    const userColumns = (await db.raw('PRAGMA table_info(users)')) as Array<{ name: string }>;
    expect(userColumns.map((c) => c.name)).toEqual(
      expect.arrayContaining(['id', 'name', 'email', 'password_hash', 'role_id', 'flat_id', 'created_at']),
    );

    const userFks = (await db.raw('PRAGMA foreign_key_list(users)')) as Array<{ table: string; from: string; to: string }>;
    expect(userFks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'roles', from: 'role_id', to: 'id' }),
        expect.objectContaining({ table: 'flats', from: 'flat_id', to: 'id' }),
      ]),
    );

    const billFks = (await db.raw('PRAGMA foreign_key_list(bills)')) as Array<{ table: string; from: string; to: string }>;
    expect(billFks).toEqual(expect.arrayContaining([expect.objectContaining({ table: 'flats', from: 'flat_id', to: 'id' })]));

    const paymentFks = (await db.raw('PRAGMA foreign_key_list(payments)')) as Array<{ table: string; from: string; to: string }>;
    expect(paymentFks).toEqual(expect.arrayContaining([expect.objectContaining({ table: 'bills', from: 'bill_id', to: 'id' })]));
  });

  it('rolls back cleanly without leaving corrupted schema (AC3)', async () => {
    await db.migrate.latest();
    await db.migrate.rollback();
    expect(await tableNames()).not.toEqual(expect.arrayContaining(CORE_TABLES));

    await db.migrate.latest();
    expect(await tableNames()).toEqual(expect.arrayContaining(CORE_TABLES));
  });

  it('is idempotent when run twice (AC4)', async () => {
    await db.migrate.latest();
    await expect(db.migrate.latest()).resolves.toBeDefined();

    const usersTables = await db('sqlite_master').select('name').where({ type: 'table', name: 'users' });
    expect(usersTables).toHaveLength(1);
  });

  it('records applied migrations with identifier and order (AC5)', async () => {
    await db.migrate.latest();
    const history = await db('knex_migrations').select('id', 'name', 'batch').orderBy('id');

    expect(history).toHaveLength(5);
    expect(history[0]).toHaveProperty('name');
    expect(history.every((row) => typeof row.id === 'number')).toBe(true);
  });
});
