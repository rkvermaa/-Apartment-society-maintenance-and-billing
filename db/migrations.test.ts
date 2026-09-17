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
    pool: {
      afterCreate: (conn: { pragma: (statement: string) => void }, done: (err: Error | null, conn: unknown) => void) => {
        conn.pragma('foreign_keys = ON');
        done(null, conn);
      },
    },
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

type ColumnInfo = { name: string; notnull: number; dflt_value: unknown };

async function columnInfo(table: string): Promise<ColumnInfo[]> {
  return (await db.raw(`PRAGMA table_info(${table})`)) as ColumnInfo[];
}

async function uniqueColumnSets(table: string): Promise<string[][]> {
  const indexes = (await db.raw(`PRAGMA index_list(${table})`)) as Array<{ name: string; unique: number }>;
  const uniqueSets: string[][] = [];
  for (const index of indexes.filter((i) => i.unique)) {
    const columns = (await db.raw(`PRAGMA index_info(${index.name})`)) as Array<{ name: string }>;
    uniqueSets.push(columns.map((c) => c.name));
  }
  return uniqueSets;
}

describe('core domain migrations', () => {
  it('creates all core domain tables (AC1)', async () => {
    await db.migrate.latest();
    expect(await tableNames()).toEqual(expect.arrayContaining(CORE_TABLES));
  });

  it('declares the documented columns and foreign keys (AC2)', async () => {
    await db.migrate.latest();

    const rolesColumns = await columnInfo('roles');
    expect(rolesColumns.map((c) => c.name)).toEqual(expect.arrayContaining(['id', 'name', 'created_at']));
    expect(rolesColumns.find((c) => c.name === 'name')?.notnull).toBe(1);
    expect(await uniqueColumnSets('roles')).toEqual(expect.arrayContaining([['name']]));

    const flatsColumns = await columnInfo('flats');
    expect(flatsColumns.map((c) => c.name)).toEqual(
      expect.arrayContaining(['id', 'flat_number', 'block', 'created_at']),
    );
    expect(flatsColumns.find((c) => c.name === 'flat_number')?.notnull).toBe(1);
    expect(flatsColumns.find((c) => c.name === 'block')?.notnull).toBe(1);
    const flatsUniqueSets = await uniqueColumnSets('flats');
    expect(flatsUniqueSets.some((set) => set.includes('flat_number') && set.includes('block'))).toBe(true);

    const userColumns = await columnInfo('users');
    expect(userColumns.map((c) => c.name)).toEqual(
      expect.arrayContaining(['id', 'name', 'email', 'password_hash', 'role_id', 'flat_id', 'created_at']),
    );
    expect(userColumns.find((c) => c.name === 'email')?.notnull).toBe(1);
    expect(userColumns.find((c) => c.name === 'password_hash')?.notnull).toBe(1);
    expect(userColumns.find((c) => c.name === 'role_id')?.notnull).toBe(1);
    expect(userColumns.find((c) => c.name === 'flat_id')?.notnull).toBe(0);
    expect(await uniqueColumnSets('users')).toEqual(expect.arrayContaining([['email']]));

    const userFks = (await db.raw('PRAGMA foreign_key_list(users)')) as Array<{ table: string; from: string; to: string }>;
    expect(userFks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'roles', from: 'role_id', to: 'id' }),
        expect.objectContaining({ table: 'flats', from: 'flat_id', to: 'id' }),
      ]),
    );

    const billColumns = await columnInfo('bills');
    expect(billColumns.map((c) => c.name)).toEqual(
      expect.arrayContaining(['id', 'flat_id', 'billing_period', 'amount', 'due_date', 'status', 'created_at']),
    );
    expect(billColumns.find((c) => c.name === 'flat_id')?.notnull).toBe(1);
    expect(billColumns.find((c) => c.name === 'billing_period')?.notnull).toBe(1);
    expect(billColumns.find((c) => c.name === 'amount')?.notnull).toBe(1);
    expect(billColumns.find((c) => c.name === 'due_date')?.notnull).toBe(1);
    expect(billColumns.find((c) => c.name === 'status')?.dflt_value).toBe("'pending'");

    const billFks = (await db.raw('PRAGMA foreign_key_list(bills)')) as Array<{ table: string; from: string; to: string }>;
    expect(billFks).toEqual(expect.arrayContaining([expect.objectContaining({ table: 'flats', from: 'flat_id', to: 'id' })]));

    const paymentColumns = await columnInfo('payments');
    expect(paymentColumns.map((c) => c.name)).toEqual(
      expect.arrayContaining(['id', 'bill_id', 'amount', 'paid_at', 'method', 'created_at']),
    );
    expect(paymentColumns.find((c) => c.name === 'bill_id')?.notnull).toBe(1);
    expect(paymentColumns.find((c) => c.name === 'amount')?.notnull).toBe(1);
    expect(paymentColumns.find((c) => c.name === 'paid_at')?.notnull).toBe(1);
    expect(paymentColumns.find((c) => c.name === 'method')?.notnull).toBe(1);

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

  it('enforces declared foreign-key constraints at runtime (AC2)', async () => {
    await db.migrate.latest();

    const [{ foreign_keys: foreignKeysEnabled }] = (await db.raw('PRAGMA foreign_keys')) as Array<{
      foreign_keys: number;
    }>;
    expect(foreignKeysEnabled).toBe(1);

    const [role] = await db('roles').insert({ name: 'resident' }).returning('id');
    const [flat] = await db('flats').insert({ flat_number: '101', block: 'A' }).returning('id');
    await db('users').insert({
      name: 'Jane',
      email: 'jane@example.com',
      password_hash: 'hash',
      role_id: role.id,
      flat_id: flat.id,
    });

    await expect(db('roles').where({ id: role.id }).delete()).rejects.toThrow();

    const [bill] = await db('bills')
      .insert({ flat_id: flat.id, billing_period: '2026-01', amount: '100.00', due_date: '2026-01-31' })
      .returning('id');
    await db('payments').insert({ bill_id: bill.id, amount: '100.00', paid_at: new Date(), method: 'cash' });

    await db('bills').where({ id: bill.id }).delete();
    expect(await db('payments').where({ bill_id: bill.id })).toHaveLength(0);
  });

  it('records applied migrations with identifier and order (AC5)', async () => {
    await db.migrate.latest();
    const history = await db('knex_migrations').select('id', 'name', 'batch').orderBy('id');

    expect(history).toHaveLength(7);
    expect(history[0]).toHaveProperty('name');
    expect(history.every((row) => typeof row.id === 'number')).toBe(true);
  });
});
