summary: |
  This repo is currently a frontend-only Vite/React/TypeScript SPA (`src/`) with no backend,
  no database client, and no migration tooling anywhere in the tree — `src/auth/credentials.ts`
  and `src/auth/AuthContext.tsx` both carry comments stating that real credential
  verification/persistence is deferred to STORY-013 once a backend exists. This story lays that
  missing foundation: a version-controlled, dialect-portable migration tool (Knex) with five
  ordered migrations creating `roles`, `flats`, `users`, `bills`, and `payments`, each with the
  FK relationships implied by the domain names in the story. Migrations run against
  `better-sqlite3` for now (zero external infra, fast tests) since no server/deployment story has
  picked a production database engine yet; Knex's client is swappable later without touching the
  schema-builder migration files. The plan is purely additive — it does not wire any existing
  `src/` code (auth, screens) to the new schema; that integration is explicitly STORY-013's job
  per the comments already in the codebase.
scope:
  - description: |
      Add Knex + better-sqlite3 as real dependencies and wire up a `knexfile.cjs` config plus
      npm scripts so the migration tool is actually runnable per AC1/AC3/AC5. Config lives in a
      new `db/` directory, sibling to `src/`, so it stays outside `tsconfig.json`'s `"include":
      ["src"]` and is never pulled into the Vite browser bundle.

      `db/knexfile.cjs`:
      ```js
      const path = require('node:path');

      module.exports = {
        client: 'better-sqlite3',
        connection: {
          filename: process.env.DATABASE_FILENAME || path.join(__dirname, 'dev.sqlite3'),
        },
        useNullAsDefault: true,
        migrations: {
          directory: path.join(__dirname, 'migrations'),
          extension: 'cjs',
        },
      };
      ```

      `package.json` scripts added:
      ```json
      "migrate:latest": "knex migrate:latest --knexfile db/knexfile.cjs",
      "migrate:rollback": "knex migrate:rollback --knexfile db/knexfile.cjs",
      "migrate:list": "knex migrate:list --knexfile db/knexfile.cjs"
      ```
    files:
      - package.json
      - db/knexfile.cjs
      - .gitignore
    rationale: |
      Gives the project an actual migration runner. `migrate:latest` / `migrate:rollback` /
      `migrate:list` map directly onto AC1 (run migrations), AC3 (rollback), and AC5 (inspect
      history) without hand-rolled scripting. `.gitignore` gets `db/dev.sqlite3` so the local dev
      database file isn't committed.
  - description: |
      Write the full failing test suite first, against a disposable per-test SQLite file (never
      the checked-in dev db), before any migration file exists. Runs under Node (not jsdom) via a
      per-file Vitest environment override since this exercises a real file-backed database.

      `db/migrations.test.ts`:
      ```ts
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
      ```
    files:
      - db/migrations.test.ts
    rationale: |
      Test-first: this suite fails immediately (no migrations directory contents / tables
      missing) before scope items 3-7 exist, then passes once they're implemented — one failing
      test per acceptance criterion, all sharing one disposable-db harness.
  - description: |
      Implement the `roles` migration — the only core table with no outgoing foreign keys, so it
      must be first in migration order.

      `db/migrations/20260914090001_create_roles_table.cjs`:
      ```js
      exports.up = function up(knex) {
        return knex.schema.createTable('roles', (table) => {
          table.increments('id').primary();
          table.string('name').notNullable().unique();
          table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        });
      };

      exports.down = function down(knex) {
        return knex.schema.dropTableIfExists('roles');
      };
      ```
    files:
      - db/migrations/20260914090001_create_roles_table.cjs
    rationale: |
      `roles` is referenced by `users.role_id`; it has to exist before `users` is created or the
      FK definition in that later migration will fail at `migrate:latest` time.
  - description: |
      Implement the `flats` migration, also dependency-free, second in order.

      `db/migrations/20260914090002_create_flats_table.cjs`:
      ```js
      exports.up = function up(knex) {
        return knex.schema.createTable('flats', (table) => {
          table.increments('id').primary();
          table.string('flat_number').notNullable();
          table.string('block').notNullable();
          table.unique(['flat_number', 'block']);
          table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        });
      };

      exports.down = function down(knex) {
        return knex.schema.dropTableIfExists('flats');
      };
      ```
    files:
      - db/migrations/20260914090002_create_flats_table.cjs
    rationale: |
      `flats` is referenced by both `users.flat_id` and `bills.flat_id`; it must exist before
      either of those tables is created.
  - description: |
      Implement the `users` migration, with FKs to both `roles` and `flats`.

      `db/migrations/20260914090003_create_users_table.cjs`:
      ```js
      exports.up = function up(knex) {
        return knex.schema.createTable('users', (table) => {
          table.increments('id').primary();
          table.string('name').notNullable();
          table.string('email').notNullable().unique();
          table.string('password_hash').notNullable();
          table.integer('role_id').unsigned().notNullable()
            .references('id').inTable('roles').onDelete('RESTRICT');
          table.integer('flat_id').unsigned().nullable()
            .references('id').inTable('flats').onDelete('SET NULL');
          table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        });
      };

      exports.down = function down(knex) {
        return knex.schema.dropTableIfExists('users');
      };
      ```
    files:
      - db/migrations/20260914090003_create_users_table.cjs
    rationale: |
      `flat_id` is nullable because an admin user need not own/occupy a flat; `role_id` is
      required since every user (admin or resident) must have exactly one role per the existing
      `Role = 'admin' | 'resident'` union in `src/auth/AuthContext.tsx`.
  - description: |
      Implement the `bills` migration, FK to `flats`.

      `db/migrations/20260914090004_create_bills_table.cjs`:
      ```js
      exports.up = function up(knex) {
        return knex.schema.createTable('bills', (table) => {
          table.increments('id').primary();
          table.integer('flat_id').unsigned().notNullable()
            .references('id').inTable('flats').onDelete('CASCADE');
          table.string('billing_period').notNullable();
          table.decimal('amount', 10, 2).notNullable();
          table.date('due_date').notNullable();
          table.string('status').notNullable().defaultTo('pending');
          table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        });
      };

      exports.down = function down(knex) {
        return knex.schema.dropTableIfExists('bills');
      };
      ```
    files:
      - db/migrations/20260914090004_create_bills_table.cjs
    rationale: |
      A bill belongs to exactly one flat (not one user), matching real-world billing where
      maintenance is charged per-flat regardless of which resident currently occupies it.
  - description: |
      Implement the `payments` migration, FK to `bills`, last in dependency order.

      `db/migrations/20260914090005_create_payments_table.cjs`:
      ```js
      exports.up = function up(knex) {
        return knex.schema.createTable('payments', (table) => {
          table.increments('id').primary();
          table.integer('bill_id').unsigned().notNullable()
            .references('id').inTable('bills').onDelete('CASCADE');
          table.decimal('amount', 10, 2).notNullable();
          table.timestamp('paid_at').notNullable();
          table.string('method').notNullable();
          table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        });
      };

      exports.down = function down(knex) {
        return knex.schema.dropTableIfExists('payments');
      };
      ```
    files:
      - db/migrations/20260914090005_create_payments_table.cjs
    rationale: |
      A payment is always made against a specific bill; cascading delete keeps the schema
      internally consistent if a bill is ever removed.
tests:
  - |
    AC1 — running the migration tool creates every core table without errors:
    ```ts
    await db.migrate.latest();
    expect(await tableNames()).toEqual(
      expect.arrayContaining(['roles', 'flats', 'users', 'bills', 'payments']),
    );
    ```
  - |
    AC2 — each table has the documented columns and FK relationships:
    ```ts
    const userFks = await db.raw('PRAGMA foreign_key_list(users)');
    expect(userFks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'roles', from: 'role_id', to: 'id' }),
        expect.objectContaining({ table: 'flats', from: 'flat_id', to: 'id' }),
      ]),
    );
    ```
  - |
    AC3 — a rollback returns the database to its prior state without corruption:
    ```ts
    await db.migrate.latest();
    await db.migrate.rollback();
    expect(await tableNames()).not.toEqual(
      expect.arrayContaining(['roles', 'flats', 'users', 'bills', 'payments']),
    );
    await db.migrate.latest();
    expect(await tableNames()).toEqual(
      expect.arrayContaining(['roles', 'flats', 'users', 'bills', 'payments']),
    );
    ```
  - |
    AC4 — running migrations twice on a fresh environment is idempotent (no errors, no duplicate
    schema objects):
    ```ts
    await db.migrate.latest();
    await expect(db.migrate.latest()).resolves.toBeDefined();
    const usersTables = await db('sqlite_master').select('name').where({ type: 'table', name: 'users' });
    expect(usersTables).toHaveLength(1);
    ```
  - |
    AC5 — applied migrations are recorded with identifier and applied order:
    ```ts
    await db.migrate.latest();
    const history = await db('knex_migrations').select('id', 'name', 'batch').orderBy('id');
    expect(history).toHaveLength(5);
    expect(history[0]).toHaveProperty('name');
    ```
assumptions_or_open_questions:
  - |
    The story names only the tables (users, roles, flats, bills, payments); no column list or ERD
    is given anywhere in the repo. I inferred a minimal reasonable schema (see the migration
    snippets in `scope`) — please confirm the column set, especially whether `bills` should be
    per-flat (as planned) vs. per-user, and whether `users.flat_id` should instead be a many-side
    relation (a resident could plausibly own more than one flat).
  - |
    No production database engine has been chosen anywhere in this repo or in prior stories. This
    plan uses `better-sqlite3` so migrations and tests run with zero external infra. Knex's schema
    builder calls used here are dialect-portable, but if Postgres/MySQL is later chosen, the
    `knexfile.cjs` connection config swaps out — the migration files themselves should not need to
    change for the calls used in this plan.
  - |
    This plan does not enable SQLite's `PRAGMA foreign_keys = ON` enforcement pragma. The ACs ask
    for FK relationships to be inspectable (AC2), not necessarily enforced at write time; enabling
    enforcement is a one-line addition (`pool.afterCreate` hook in the knexfile) if the reviewer
    wants it in this story rather than deferred.
  - |
    `users.password_hash` is added as a plain column with no hashing library wired up — nothing in
    this story writes to it. STORY-013 (session-management), per the existing comments in
    `src/auth/credentials.ts` and `src/auth/AuthContext.tsx`, owns real credential verification and
    is expected to be the first consumer of this column.
  - |
    This story does not touch any existing `src/` code (no wiring of `AuthContext`/`credentials.ts`
    to the new `users`/`roles` tables) — that integration is explicitly out of scope per the
    parent epic's story split (STORY-013 owns backend credential verification).
package_dependencies:
  - name: knex
    version: ^3.1.0
    ecosystem: npm
    rationale: |
      Query builder + migration CLI/API (`migrate:latest`, `migrate:rollback`, `migrate:list`,
      the `knex_migrations` history table) that directly implements AC1, AC3, AC4, and AC5, and
      is dialect-portable if the production DB engine changes later.
  - name: better-sqlite3
    version: ^11.3.0
    ecosystem: npm
    rationale: |
      Synchronous, native SQLite driver used as the Knex client for migrations and tests so this
      story needs no external database server; also the dev-time database until a production
      engine is chosen.
  - name: "@types/node"
    version: ^20.14.15
    ecosystem: npm
    rationale: |
      `db/migrations.test.ts` uses Node builtins (`fs`, `os`, `path`) directly; the project has
      no Node type definitions today since it has only ever been a browser/Vite codebase.
notes: |
  No mermaid diagram: this plan is purely additive. It creates a new `db/` directory (config,
  five migration files, one test file) that nothing in `src/` currently imports or calls, and
  nothing in this plan imports from `src/`. The only place this new schema gets wired into
  existing application code is a future story (STORY-013, per the comments already in
  `src/auth/credentials.ts` and `src/auth/AuthContext.tsx`), so there is no real edge to draw yet
  between "touched" and existing nodes.

  Why Knex over Prisma/TypeORM: Knex's migration API maps almost one-to-one onto the five ACs —
  `migrate:latest` (AC1/AC4, since it no-ops cleanly when there's nothing pending), explicit
  hand-written `up`/`down` per migration (AC3, true rollback rather than "restore from backup"),
  and a plain `knex_migrations` table with `id`/`name`/`batch` columns (AC5). Prisma's migrate
  workflow does not support a first-class programmatic rollback the way this story's AC3 needs.

  Migration files are plain CommonJS (`.cjs`), not TypeScript, because the root `package.json` has
  `"type": "module"` and Knex's migration loader is simplest with the classic
  `exports.up`/`exports.down` stub format — this avoids adding a `ts-node`/loader dependency just
  for migration files. `db/` sits outside `tsconfig.json`'s `"include": ["src"]`, so it is never
  pulled into the Vite/browser build; `db/migrations.test.ts` still runs under Vitest (which
  globs test files project-wide, not just `src/`) with `// @vitest-environment node` since it
  exercises a real file-backed SQLite database rather than jsdom.
