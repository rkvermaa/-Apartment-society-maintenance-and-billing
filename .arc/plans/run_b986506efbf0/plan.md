summary: |
  There is no backend server or session-management layer in this repo yet: `src/auth/AuthContext.tsx`
  keeps `role` in in-memory React state only, and `src/auth/credentials.ts` authenticates against a
  hardcoded `DEMO_USERS` array, not the `users` table created by STORY-012 — both files carry
  comments stating that real credential verification and session issuance are STORY-013's job and
  it has not landed yet. This story adds the one piece that does NOT depend on that missing layer:
  an operator-only Node CLI script, `scripts/resetAdminPassword.cjs`, that an operator runs directly
  against the SQLite database to (1) hash and overwrite an Admin's `users.password_hash`, (2) stamp a
  new `password_reset_at` timestamp on that user as the durable signal that any previously-issued
  session/token for them must now be treated as stale, and (3) insert a row into a new `audit_logs`
  table recording the reset action, target, operator, and timestamp. It also locks in, via a test,
  that the existing `LoginScreen` still exposes no self-service "forgot password" affordance. The
  plan does not add a login backend, real session store, or session-verification middleware — none
  exist today for this story to invalidate, and building them is explicitly STORY-013's scope; this
  story delivers the operator action, the recorded invalidation signal, and the audit trail so that
  STORY-013 can wire live session checks against `password_reset_at` once sessions themselves exist.
scope:
  - description: |
      Add a `password_reset_at` nullable timestamp column to `users` via a new migration, run before
      the CLI script exists so its test (below) starts red against a missing column.

      `db/migrations/20260917090001_add_password_reset_at_to_users.cjs`:
      ```js
      exports.up = function up(knex) {
        return knex.schema.alterTable('users', (table) => {
          table.timestamp('password_reset_at').nullable();
        });
      };

      exports.down = function down(knex) {
        return knex.schema.alterTable('users', (table) => {
          table.dropColumn('password_reset_at');
        });
      };
      ```
    files:
      - db/migrations/20260917090001_add_password_reset_at_to_users.cjs
    rationale: |
      This column is the durable "invalidate any session issued before this instant" signal
      required by AC2. There is no session/token table anywhere in the schema to delete rows from
      (STORY-013 hasn't built one), so the reset script cannot literally "log out" a live session;
      recording when the password changed is the standard, minimal mechanism a future session check
      (`token.issuedAt < user.password_reset_at` → reject) can key off once STORY-013 adds sessions.
  - description: |
      Add a new `audit_logs` table via migration, required by AC3. `target_user_id` is nullable with
      `onDelete('SET NULL')` and a separate `target_email` column is kept so the audit trail survives
      even if the user row is later deleted — standard audit-log practice.

      `db/migrations/20260917090002_create_audit_logs_table.cjs`:
      ```js
      exports.up = function up(knex) {
        return knex.schema.createTable('audit_logs', (table) => {
          table.increments('id').primary();
          table.string('action').notNullable();
          table.integer('target_user_id').unsigned().nullable()
            .references('id').inTable('users').onDelete('SET NULL');
          table.string('target_email').notNullable();
          table.string('performed_by').notNullable();
          table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        });
      };

      exports.down = function down(knex) {
        return knex.schema.dropTableIfExists('audit_logs');
      };
      ```
    files:
      - db/migrations/20260917090002_create_audit_logs_table.cjs
    rationale: |
      No audit-trail table exists anywhere in the current schema (`roles`, `flats`, `users`,
      `bills`, `payments` only); AC3 explicitly requires one, so this story is the first and only
      consumer/owner of it for now.
  - description: |
      Write the failing test suite first, against a disposable per-test SQLite file, in the same
      style as `db/migrations.test.ts` (STORY-012). This fails immediately because
      `resetAdminPassword` and the new columns/tables don't exist yet.

      `scripts/resetAdminPassword.test.ts`:
      ```ts
      // @vitest-environment node
      import Knex, { type Knex as KnexType } from 'knex';
      import bcrypt from 'bcrypt';
      import fs from 'node:fs';
      import os from 'node:os';
      import path from 'node:path';
      import { afterEach, beforeEach, describe, expect, it } from 'vitest';
      import { resetAdminPassword } from './resetAdminPassword.cjs';

      let db: KnexType;
      let tmpDir: string;

      beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-reset-'));
        db = Knex({
          client: 'better-sqlite3',
          connection: { filename: path.join(tmpDir, 'test.sqlite3') },
          useNullAsDefault: true,
          migrations: { directory: path.join(__dirname, '..', 'db', 'migrations'), extension: 'cjs' },
        });
        await db.migrate.latest();
      });

      afterEach(async () => {
        await db.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });

      async function seedAdmin(email: string, passwordHash: string): Promise<number> {
        const [role] = await db('roles').insert({ name: 'admin' }).returning('id');
        const [user] = await db('users')
          .insert({ name: 'Admin', email, password_hash: passwordHash, role_id: role.id })
          .returning('id');
        return user.id as number;
      }

      describe('resetAdminPassword', () => {
        it('updates the admin password hash so the new password verifies (AC1)', async () => {
          const oldHash = await bcrypt.hash('old-secret', 10);
          await seedAdmin('admin@example.com', oldHash);

          await resetAdminPassword(db, {
            email: 'admin@example.com',
            newPassword: 'new-secret-123',
            performedBy: 'operator',
          });

          const updated = await db('users').where({ email: 'admin@example.com' }).first();
          expect(await bcrypt.compare('new-secret-123', updated.password_hash)).toBe(true);
          expect(await bcrypt.compare('old-secret', updated.password_hash)).toBe(false);
        });

        it('rejects when no admin exists with the given email', async () => {
          await expect(
            resetAdminPassword(db, {
              email: 'missing@example.com',
              newPassword: 'new-secret-123',
              performedBy: 'operator',
            }),
          ).rejects.toThrow('No admin user found with email "missing@example.com"');
        });

        it('stamps password_reset_at as the session-invalidation signal (AC2)', async () => {
          const oldHash = await bcrypt.hash('old-secret', 10);
          await seedAdmin('admin@example.com', oldHash);

          await resetAdminPassword(db, {
            email: 'admin@example.com',
            newPassword: 'new-secret-123',
            performedBy: 'operator',
          });

          const updated = await db('users').where({ email: 'admin@example.com' }).first();
          expect(updated.password_reset_at).not.toBeNull();
        });

        it('creates an audit log entry recording the reset action and timestamp (AC3)', async () => {
          const oldHash = await bcrypt.hash('old-secret', 10);
          const userId = await seedAdmin('admin@example.com', oldHash);

          await resetAdminPassword(db, {
            email: 'admin@example.com',
            newPassword: 'new-secret-123',
            performedBy: 'operator',
          });

          const entries = await db('audit_logs').where({ target_user_id: userId });
          expect(entries).toHaveLength(1);
          expect(entries[0]).toMatchObject({
            action: 'admin_password_reset',
            target_email: 'admin@example.com',
            performed_by: 'operator',
          });
          expect(entries[0].created_at).toBeTruthy();
        });
      });
      ```
    files:
      - scripts/resetAdminPassword.test.ts
    rationale: |
      One failing test per acceptance criterion (plus one guard for the not-found case needed for
      correct minimal behavior), sharing a disposable-db harness identical in shape to
      `db/migrations.test.ts` so the pattern is already familiar in this codebase.
  - description: |
      Implement the CLI script as an exported, directly-testable function plus a thin
      `require.main === module` CLI entrypoint, matching the project's existing `.cjs` convention
      for anything that talks to the database outside the Vite/browser bundle (`db/knexfile.cjs`,
      the migration files).

      `scripts/resetAdminPassword.cjs`:
      ```js
      const bcrypt = require('bcrypt');

      const SALT_ROUNDS = 10;

      async function resetAdminPassword(db, { email, newPassword, performedBy }) {
        const admin = await db('users')
          .join('roles', 'roles.id', 'users.role_id')
          .where({ 'users.email': email, 'roles.name': 'admin' })
          .select('users.id')
          .first();

        if (!admin) {
          throw new Error(`No admin user found with email "${email}"`);
        }

        const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
        const resetAt = new Date();

        await db('users').where({ id: admin.id }).update({
          password_hash: passwordHash,
          password_reset_at: resetAt,
        });

        await db('audit_logs').insert({
          action: 'admin_password_reset',
          target_user_id: admin.id,
          target_email: email,
          performed_by: performedBy,
          created_at: resetAt,
        });

        return { userId: admin.id, resetAt };
      }

      module.exports = { resetAdminPassword };

      if (require.main === module) {
        (async () => {
          const [, , email, newPassword] = process.argv;
          if (!email || !newPassword) {
            console.error('Usage: node scripts/resetAdminPassword.cjs <admin-email> <new-password>');
            process.exitCode = 1;
            return;
          }

          const os = require('node:os');
          const knex = require('knex')(require('../db/knexfile.cjs'));
          try {
            const { userId, resetAt } = await resetAdminPassword(knex, {
              email,
              newPassword,
              performedBy: os.userInfo().username,
            });
            console.log(JSON.stringify({ event: 'admin_password_reset', userId, resetAt, timestamp: new Date().toISOString() }));
          } catch (err) {
            console.error(JSON.stringify({ event: 'admin_password_reset_failed', error: err.message }));
            process.exitCode = 1;
          } finally {
            await knex.destroy();
          }
        })();
      }
      ```

      `package.json` script added:
      ```json
      "admin:reset-password": "node scripts/resetAdminPassword.cjs"
      ```
    files:
      - scripts/resetAdminPassword.cjs
      - package.json
    rationale: |
      Satisfies AC1 (operator runs the script with a new password, the stored hash updates so a
      subsequent credential check succeeds) directly, and AC2/AC3 as side effects of the same
      transaan operator invocation performs. Business logic is an exported function so the test
      suite calls it directly against an in-memory-fast SQLite file rather than shelling out to a
      child process, matching how `db/migrations.test.ts` already tests migration behavior without
      spawning the `knex` CLI.
  - description: |
      Add one regression-guard test to the existing login test file locking in AC4: no self-service
      recovery affordance is rendered anywhere on the login screen.

      Addition to `src/screens/LoginScreen.test.tsx`:
      ```tsx
      it('presents no self-service password recovery option (AC4)', () => {
        render(
          <AuthProvider>
            <MemoryRouter initialEntries={['/login']}>
              <App />
            </MemoryRouter>
          </AuthProvider>,
        );

        expect(screen.queryByText(/forgot.*password/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /reset|recover/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /reset|recover/i })).not.toBeInTheDocument();
      });
      ```
    files:
      - src/screens/LoginScreen.test.tsx
    rationale: |
      `src/screens/LoginScreen.tsx` today renders only username/password fields and a submit
      button — no forgot-password link exists, so this test is a guard against ever adding one
      in-app, not a driver of new production code. It is included because AC4 is a real,
      independently-checkable acceptance criterion for this story and should have its own test
      rather than being asserted only by omission.
tests:
  - |
    AC1 — the CLI-updated hash verifies against the new password and no longer against the old one:
    ```ts
    await resetAdminPassword(db, { email: 'admin@example.com', newPassword: 'new-secret-123', performedBy: 'operator' });
    const updated = await db('users').where({ email: 'admin@example.com' }).first();
    expect(await bcrypt.compare('new-secret-123', updated.password_hash)).toBe(true);
    expect(await bcrypt.compare('old-secret', updated.password_hash)).toBe(false);
    ```
  - |
    AC2 — running the script stamps `password_reset_at`, the session-invalidation signal:
    ```ts
    const updated = await db('users').where({ email: 'admin@example.com' }).first();
    expect(updated.password_reset_at).not.toBeNull();
    ```
  - |
    AC3 — running the script creates exactly one audit log entry with the reset action and a timestamp:
    ```ts
    const entries = await db('audit_logs').where({ target_user_id: userId });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'admin_password_reset', target_email: 'admin@example.com', performed_by: 'operator' });
    expect(entries[0].created_at).toBeTruthy();
    ```
  - |
    AC4 — the login screen presents no in-app recovery affordance:
    ```tsx
    expect(screen.queryByText(/forgot.*password/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /reset|recover/i })).not.toBeInTheDocument();
    ```
assumptions_or_open_questions:
  - |
    No session or token store exists anywhere in this codebase yet — `AuthContext` keeps `role` in
    plain React `useState`, and there is no `sessions` table in the schema. STORY-013
    (session-management, per the comments in `src/auth/AuthContext.tsx` and
    `src/auth/credentials.ts`) has not landed. AC2 therefore cannot be implemented as "terminate a
    live session" today; this plan records the invalidation signal (`password_reset_at`) that a
    future session check can key off, but does not add live session enforcement itself — that is
    STORY-013's scope. Please confirm this split is acceptable, or tell me if this story should
    instead be blocked until STORY-013 lands.
  - |
    `LoginScreen` currently authenticates against a hardcoded `DEMO_USERS` array in
    `src/auth/credentials.ts`, not against the `users` table at all. This means AC1's "the Admin can
    log in with the new password" cannot be demonstrated end-to-end through the real UI in this
    story — I've scoped the test to prove the stored hash verifies correctly via `bcrypt.compare`,
    which is the actual artifact the login flow will check once STORY-013 wires `LoginScreen` to the
    database. Flagging in case the reviewer wants this story to also stub that wiring, though that
    would duplicate STORY-013's scope.
  - |
    The reset script keys the target admin by `email` (unique in the `users` table) rather than
    `username`, since `users` has no username column — `LoginScreen`'s "Username" field only maps
    into the hardcoded demo list today. Please confirm email is the right operator-facing identifier.
  - |
    `performed_by` on the audit log is populated from the OS user running the script
    (`os.userInfo().username`) since there is no authenticated-operator/CLI-identity concept in this
    codebase. This is auditable but spoofable by anyone with shell access to the box — acceptable
    for an operator-only recovery tool, per the story's framing, but flagging the trust boundary.
  - |
    No minimum password-strength/complexity check is enforced by the script since the ACs don't
    specify one; it accepts any non-empty password string.
  - |
    The AC4 test is a regression guard for behavior that is already true today (no forgot-password
    UI exists), not a test that fails before this story and passes after — there is no production
    code change needed to satisfy it, only the test itself is new.
package_dependencies:
  - name: bcrypt
    version: ^5.1.1
    ecosystem: npm
    rationale: |
      `users.password_hash` exists in the schema but nothing hashes or verifies against it yet
      (STORY-012 explicitly deferred this). This story is the first writer to that column via the
      CLI reset script, so it needs a password-hashing library; `bcrypt` is the standard choice and
      the project already tolerates native modules (`better-sqlite3`).
  - name: "@types/bcrypt"
    version: ^5.0.2
    ecosystem: npm
    rationale: |
      `scripts/resetAdminPassword.test.ts` is a TypeScript file (outside `tsconfig.json`'s `src`
      include, run directly by Vitest like `db/migrations.test.ts` already is) that imports
      `bcrypt` for its assertions; type definitions keep it consistent with the rest of the
      TS-authored test suite.
notes: |
  Why a plain exported function + thin CLI wrapper instead of a "real" CLI framework (yargs/commander):
  the script takes exactly two positional arguments and the project has zero CLI-framework
  dependencies anywhere; adding one would be scope beyond what four ACs require. The exported
  `resetAdminPassword(db, opts)` shape mirrors how `db/migrations.test.ts` already tests
  Knex-based behavior directly against a disposable SQLite file instead of shelling out.

  Why `password_reset_at` instead of a new `sessions` table: building real session issuance/storage
  is STORY-013's job per existing in-repo comments, and there is currently nothing to "invalidate" —
  the frontend doesn't persist a session token anywhere (not even localStorage), it's just
  in-memory React state that resets on page reload regardless of this story. Adding a full sessions
  table now would be speculative infrastructure for a session model that doesn't exist yet, and
  risks conflicting with whatever shape STORY-013 chooses. A timestamp column is the minimal,
  standard "invalidate everything issued before now" primitive that composes with any future
  session design (JWT `iat` comparison, DB-backed session `created_at` comparison, etc.).

  ```mermaid
  flowchart TD
    CLI["scripts/resetAdminPassword.cjs"]:::touched
    CLITest["scripts/resetAdminPassword.test.ts"]:::touched
    MigPwd["db/migrations/20260917090001_add_password_reset_at_to_users.cjs"]:::touched
    MigAudit["db/migrations/20260917090002_create_audit_logs_table.cjs"]:::touched
    KnexCfg["db/knexfile.cjs"]
    UsersTable[("users table")]
    AuditTable[("audit_logs table")]
    LoginTest["src/screens/LoginScreen.test.tsx"]:::touched
    LoginScreen["src/screens/LoginScreen.tsx"]
    Credentials["src/auth/credentials.ts"]

    CLITest -->|"calls directly, no CLI spawn"| CLI
    CLI -->|"reuses same connection shape as"| KnexCfg
    CLI -->|"UPDATE password_hash, password_reset_at"| UsersTable
    CLI -->|"INSERT reset entry"| AuditTable
    MigPwd -->|"adds column"| UsersTable
    MigAudit -->|"creates table"| AuditTable
    LoginTest -->|"asserts no recovery link/button rendered"| LoginScreen
    LoginScreen -.->|"still authenticates against in-memory demo list, not DB (STORY-013 gap)"| Credentials

    classDef touched fill:#f96,color:#000
  ```
