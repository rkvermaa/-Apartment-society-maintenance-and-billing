summary: |
  This repo has no HTTP server, no session-transport layer, and no wired-up authentication
  anywhere yet: `src/auth/credentials.ts` is a hardcoded in-memory `DEMO_USERS` array called
  directly and synchronously from `LoginScreen.tsx`, and both `src/auth/credentials.ts` and
  `src/auth/AuthContext.tsx` carry comments explicitly deferring real backend credential
  verification/session issuance to a future "STORY-013" that has not landed in this codebase.
  The only precedent for real persistence is `db/` — a Knex + better-sqlite3 schema
  (STORY-012) exercised directly from Node-environment Vitest tests (`db/migrations.test.ts`),
  with zero HTTP or UI wiring. Given that, this plan implements Admin credential management,
  session invalidation, and the audit trail as a Node-only service module
  (`db/credentialService.ts`) that operates directly on the Knex database, tested the same way
  `db/migrations.test.ts` already is — one failing test per acceptance criterion, backed by three
  new migrations (`users.username`/`users.is_active`, a `sessions` table, an `audit_logs` table).
  It deliberately does not touch `src/` (no Admin UI screen, no wiring into `LoginScreen`/
  `AuthContext`): building a real HTTP/session-transport layer is a materially bigger
  architectural decision than this one story, and is exactly the gap the existing code comments
  already attribute to the still-missing session-management story. This plan builds the backend
  logic those ACs require in a way that is fully testable today and directly pluggable into that
  transport layer once it exists.
scope:
  - description: |
      Add `username` (unique login identifier for residents/admins) and `is_active` (deactivation
      flag) columns to `users`. Both are nullable-safe additions (no backfill required) so the
      existing STORY-012 migration/test suite keeps passing unmodified apart from the count fix
      in the next scope item.

      `db/migrations/20260917100001_add_username_active_to_users.cjs`:
      ```js
      exports.up = function up(knex) {
        return knex.schema.alterTable('users', (table) => {
          table.string('username').unique();
          table.boolean('is_active').notNullable().defaultTo(true);
        });
      };

      exports.down = function down(knex) {
        return knex.schema.alterTable('users', (table) => {
          table.dropColumn('username');
          table.dropColumn('is_active');
        });
      };
      ```
    files:
      - db/migrations/20260917100001_add_username_active_to_users.cjs
    rationale: |
      AC1/AC2/AC5 are all keyed on "username and password", but the STORY-012 `users` table only
      has `email`. Rather than altering `email`'s NOT NULL constraint (a riskier SQLite rebuild
      via Knex `.alter()`), this leaves `email` untouched and adds `username` as the new resident
      login identifier; `is_active` is the flag AC3/AC4 deactivation flips.
  - description: |
      Add the `sessions` table (one row per successful login) so "active session" is a concrete,
      queryable concept for AC3's "all active sessions ... immediately invalidated".

      `db/migrations/20260917100002_create_sessions_table.cjs`:
      ```js
      exports.up = function up(knex) {
        return knex.schema.createTable('sessions', (table) => {
          table.increments('id').primary();
          table.integer('user_id').unsigned().notNullable()
            .references('id').inTable('users').onDelete('CASCADE');
          table.string('token').notNullable().unique();
          table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
          table.timestamp('invalidated_at').nullable();
        });
      };

      exports.down = function down(knex) {
        return knex.schema.dropTableIfExists('sessions');
      };
      ```
    files:
      - db/migrations/20260917100002_create_sessions_table.cjs
    rationale: |
      A row with `invalidated_at IS NULL` is an active session; deactivation sets
      `invalidated_at` on every such row for the affected resident, giving AC3 a real,
      test-observable effect instead of a no-op.
  - description: |
      Add the `audit_logs` table so every create/update/deactivate action has a durable record
      with timestamp, admin ID, action type, and affected resident ID (AC6).

      `db/migrations/20260917100003_create_audit_logs_table.cjs`:
      ```js
      exports.up = function up(knex) {
        return knex.schema.createTable('audit_logs', (table) => {
          table.increments('id').primary();
          table.integer('admin_id').unsigned().notNullable()
            .references('id').inTable('users').onDelete('RESTRICT');
          table.string('action_type').notNullable();
          table.integer('resident_id').unsigned().notNullable()
            .references('id').inTable('users').onDelete('RESTRICT');
          table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        });
      };

      exports.down = function down(knex) {
        return knex.schema.dropTableIfExists('audit_logs');
      };
      ```
    files:
      - db/migrations/20260917100003_create_audit_logs_table.cjs
    rationale: |
      AC6 requires all four fields on every credential-management action; a dedicated table with
      FKs to `users` for both `admin_id` and `resident_id` makes the audit trail queryable and
      keeps it consistent with the existing FK-heavy schema style from STORY-012.
  - description: |
      Fix the pre-existing migration-count assertion in `db/migrations.test.ts`, which currently
      hardcodes exactly 5 applied migrations. Three new migrations bring the total to 8; nothing
      else in that file changes since its other assertions use `expect.arrayContaining`, not exact
      equality, on column/table sets.

      Before → after in `db/migrations.test.ts`:
      ```ts
      // before
      expect(history).toHaveLength(5);
      // after
      expect(history).toHaveLength(8);
      ```
    files:
      - db/migrations.test.ts
    rationale: |
      Without this fix, STORY-012's own AC5 regression test ("records applied migrations with
      identifier and order") would fail the moment this story's migrations are added, for a
      reason unrelated to this story's actual acceptance criteria.
  - description: |
      Write the full failing test suite first, one test per acceptance criterion, against a
      disposable per-test SQLite file — mirroring `db/migrations.test.ts`'s harness exactly
      (`@vitest-environment node`, `fs.mkdtempSync`, `db.migrate.latest()` in `beforeEach`) plus a
      `seedAdmin` helper that inserts the `admin`/`resident` rows into `roles` and one admin user,
      since this repo has no seed-data script yet.

      `db/credentialService.test.ts`:
      ```ts
      // @vitest-environment node
      import Knex, { type Knex as KnexType } from 'knex';
      import fs from 'node:fs';
      import os from 'node:os';
      import path from 'node:path';
      import { afterEach, beforeEach, describe, expect, it } from 'vitest';
      import {
        AuthorizationError,
        authenticate,
        createResident,
        deactivateResident,
        isSessionActive,
        updateResidentCredentials,
      } from './credentialService';

      let db: KnexType;
      let tmpDir: string;

      beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-db-'));
        db = Knex({
          client: 'better-sqlite3',
          connection: { filename: path.join(tmpDir, 'test.sqlite3') },
          useNullAsDefault: true,
          pool: {
            afterCreate: (conn: { pragma: (s: string) => void }, done: (e: Error | null, c: unknown) => void) => {
              conn.pragma('foreign_keys = ON');
              done(null, conn);
            },
          },
          migrations: { directory: path.join(__dirname, 'migrations'), extension: 'cjs' },
        });
        await db.migrate.latest();
      });

      afterEach(async () => {
        await db.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });

      async function seedAdmin(): Promise<number> {
        await db('roles').insert([{ name: 'admin' }, { name: 'resident' }]);
        const [{ id }] = await db('users')
          .insert({ name: 'Root Admin', email: 'admin@example.com', username: 'admin', password_hash: 'x', role_id: 1 })
          .returning('id');
        return id;
      }

      describe('credential management and audit log', () => {
        it('lets a newly created resident log in immediately with the given credentials (AC1)', async () => {
          const adminId = await seedAdmin();
          await createResident(db, adminId, { username: 'jane.doe', password: 'S3cret!23' });

          const session = await authenticate(db, 'jane.doe', 'S3cret!23');

          expect(session).not.toBeNull();
          expect(session?.role).toBe('resident');
        });

        it('requires the new password on next login after an admin updates it (AC2)', async () => {
          const adminId = await seedAdmin();
          const residentId = await createResident(db, adminId, { username: 'jane.doe', password: 'OldPass1!' });

          await updateResidentCredentials(db, { id: adminId, role: 'admin' }, residentId, { password: 'NewPass2!' });

          expect(await authenticate(db, 'jane.doe', 'OldPass1!')).toBeNull();
          expect(await authenticate(db, 'jane.doe', 'NewPass2!')).not.toBeNull();
        });

        it('invalidates all active sessions immediately on deactivation (AC3)', async () => {
          const adminId = await seedAdmin();
          const residentId = await createResident(db, adminId, { username: 'jane.doe', password: 'S3cret!23' });
          const sessionA = await authenticate(db, 'jane.doe', 'S3cret!23');
          const sessionB = await authenticate(db, 'jane.doe', 'S3cret!23');

          await deactivateResident(db, adminId, residentId);

          expect(await isSessionActive(db, sessionA!.token)).toBe(false);
          expect(await isSessionActive(db, sessionB!.token)).toBe(false);
        });

        it('rejects login for a deactivated resident (AC4)', async () => {
          const adminId = await seedAdmin();
          await createResident(db, adminId, { username: 'jane.doe', password: 'S3cret!23' });
          const residentId = (await db('users').where({ username: 'jane.doe' }).first('id')).id;

          await deactivateResident(db, adminId, residentId);

          expect(await authenticate(db, 'jane.doe', 'S3cret!23')).toBeNull();
        });

        it('rejects a resident changing their own password and makes no change (AC5)', async () => {
          const adminId = await seedAdmin();
          const residentId = await createResident(db, adminId, { username: 'jane.doe', password: 'S3cret!23' });

          await expect(
            updateResidentCredentials(db, { id: residentId, role: 'resident' }, residentId, { password: 'Hacked1!' }),
          ).rejects.toThrow(AuthorizationError);

          expect(await authenticate(db, 'jane.doe', 'S3cret!23')).not.toBeNull();
        });

        it('writes an audit log entry for every credential-management action (AC6)', async () => {
          const adminId = await seedAdmin();
          const residentId = await createResident(db, adminId, { username: 'jane.doe', password: 'S3cret!23' });
          await updateResidentCredentials(db, { id: adminId, role: 'admin' }, residentId, { password: 'NewPass2!' });
          await deactivateResident(db, adminId, residentId);

          const entries = await db('audit_logs')
            .select('admin_id', 'action_type', 'resident_id', 'created_at')
            .orderBy('id');

          expect(entries.map((e) => e.action_type)).toEqual(['create', 'update', 'deactivate']);
          entries.forEach((entry) => {
            expect(entry.admin_id).toBe(adminId);
            expect(entry.resident_id).toBe(residentId);
            expect(entry.created_at).toBeTruthy();
          });
        });
      });
      ```
    files:
      - db/credentialService.test.ts
    rationale: |
      Test-first: this file fails to even import (`credentialService` does not exist yet), then
      each `it` fails for its own reason, before the next scope item exists — one failing test per
      acceptance criterion sharing one disposable-db harness, consistent with the
      `db/migrations.test.ts` precedent already in this repo.
  - description: |
      Implement `db/credentialService.ts` to make the above suite pass. Password hashing uses
      Node's built-in `crypto.scryptSync`/`timingSafeEqual` (no new dependency). Authorization for
      AC5 is enforced inside `updateResidentCredentials` by checking `actor.role`.

      Key signatures:
      ```ts
      export type ActorRole = 'admin' | 'resident';
      export interface Actor { id: number; role: ActorRole; }
      export class AuthorizationError extends Error {}

      export async function createResident(
        db: Knex,
        adminId: number,
        input: { username: string; password: string },
      ): Promise<number>;

      export async function updateResidentCredentials(
        db: Knex,
        actor: Actor,
        residentId: number,
        updates: { username?: string; password?: string },
      ): Promise<void>;

      export async function deactivateResident(db: Knex, adminId: number, residentId: number): Promise<void>;

      export async function authenticate(
        db: Knex,
        username: string,
        password: string,
      ): Promise<{ userId: number; token: string; role: ActorRole } | null>;

      export async function isSessionActive(db: Knex, token: string): Promise<boolean>;
      ```

      `updateResidentCredentials` rejects non-admin actors immediately:
      ```ts
      export async function updateResidentCredentials(
        db: Knex,
        actor: Actor,
        residentId: number,
        updates: { username?: string; password?: string },
      ): Promise<void> {
        if (actor.role !== 'admin') {
          throw new AuthorizationError('Only an admin can update resident credentials.');
        }
        const patch: Record<string, unknown> = {};
        if (updates.username) patch.username = updates.username;
        if (updates.password) patch.password_hash = hashPassword(updates.password);
        if (Object.keys(patch).length === 0) return;
        await db('users').where({ id: residentId }).update(patch);
        await recordAuditLog(db, { adminId: actor.id, actionType: 'update', residentId });
      }
      ```

      `deactivateResident` flips `is_active` and invalidates every active session in one call:
      ```ts
      export async function deactivateResident(db: Knex, adminId: number, residentId: number): Promise<void> {
        await db('users').where({ id: residentId }).update({ is_active: false });
        await db('sessions').where({ user_id: residentId }).whereNull('invalidated_at')
          .update({ invalidated_at: db.fn.now() });
        await recordAuditLog(db, { adminId, actionType: 'deactivate', residentId });
      }
      ```

      `authenticate` rejects inactive users and wrong passwords, and issues a fresh session token
      on success; new residents get a synthetic placeholder `email` since `users.email` is still
      NOT NULL/unique from STORY-012 and no AC exposes email at all:
      ```ts
      const [{ id }] = await db('users').insert({
        name: input.username,
        email: `${input.username}@residents.local`,
        username: input.username,
        password_hash: hashPassword(input.password),
        role_id: residentRoleId,
        is_active: true,
      }).returning('id');
      ```
    files:
      - db/credentialService.ts
    rationale: |
      This is the minimal implementation that satisfies all six ACs against the schema added
      above, matching the existing repo convention (plain exported async functions over Knex, no
      class-based repository layer) already used by `src/auth/credentials.ts`'s function-style
      `authenticate`.
tests:
  - |
    AC1 — a newly created resident can log in immediately with the given username/password:
    ```ts
    await createResident(db, adminId, { username: 'jane.doe', password: 'S3cret!23' });
    const session = await authenticate(db, 'jane.doe', 'S3cret!23');
    expect(session).not.toBeNull();
    expect(session?.role).toBe('resident');
    ```
  - |
    AC2 — after an admin updates the password, the resident's next login must use the new one:
    ```ts
    await updateResidentCredentials(db, { id: adminId, role: 'admin' }, residentId, { password: 'NewPass2!' });
    expect(await authenticate(db, 'jane.doe', 'OldPass1!')).toBeNull();
    expect(await authenticate(db, 'jane.doe', 'NewPass2!')).not.toBeNull();
    ```
  - |
    AC3 — deactivation immediately invalidates every active session for that resident:
    ```ts
    const sessionA = await authenticate(db, 'jane.doe', 'S3cret!23');
    const sessionB = await authenticate(db, 'jane.doe', 'S3cret!23');
    await deactivateResident(db, adminId, residentId);
    expect(await isSessionActive(db, sessionA!.token)).toBe(false);
    expect(await isSessionActive(db, sessionB!.token)).toBe(false);
    ```
  - |
    AC4 — a deactivated resident cannot log in:
    ```ts
    await deactivateResident(db, adminId, residentId);
    expect(await authenticate(db, 'jane.doe', 'S3cret!23')).toBeNull();
    ```
  - |
    AC5 — a resident cannot change their own password, and no change is made:
    ```ts
    await expect(
      updateResidentCredentials(db, { id: residentId, role: 'resident' }, residentId, { password: 'Hacked1!' }),
    ).rejects.toThrow(AuthorizationError);
    expect(await authenticate(db, 'jane.doe', 'S3cret!23')).not.toBeNull();
    ```
  - |
    AC6 — every create/update/deactivate action writes an audit log entry with timestamp,
    admin ID, action type, and affected resident ID:
    ```ts
    const entries = await db('audit_logs').select('admin_id', 'action_type', 'resident_id', 'created_at').orderBy('id');
    expect(entries.map((e) => e.action_type)).toEqual(['create', 'update', 'deactivate']);
    entries.forEach((entry) => {
      expect(entry.admin_id).toBe(adminId);
      expect(entry.resident_id).toBe(residentId);
      expect(entry.created_at).toBeTruthy();
    });
    ```
assumptions_or_open_questions:
  - |
    No HTTP server, session-transport (cookie/JWT), or Admin UI screen for credential management
    exists anywhere in this repo, and the existing code comments in `src/auth/credentials.ts` and
    `src/auth/AuthContext.tsx` explicitly defer that wiring to a not-yet-implemented
    "STORY-013". This plan implements the credential-management/audit-log logic as a Node-only
    service module tested directly against Knex (mirroring `db/migrations.test.ts`), and does not
    touch `src/` at all. Wiring `LoginScreen`/`AuthContext` to this backend, or exposing it over
    HTTP, needs that session-transport story first — please confirm this backend-only scope is
    acceptable for STORY-015, or let me know if an Admin UI screen should be added now even
    without a transport layer to call it from a browser.
  - |
    The ACs say "username and password" but the STORY-012 `users` table only has `email` as a
    unique identifier. I added a new `username` column rather than repurposing/renaming `email`,
    and residents created via this service get a synthetic placeholder `email`
    (`${username}@residents.local`) purely to satisfy the existing NOT NULL/unique constraint on
    that column — no AC exposes or depends on email. Please confirm this is acceptable rather than
    relaxing `email`'s constraint instead.
  - |
    AC4's wording ("until the account is reactivated") is treated as descriptive context, not a
    separate requirement — no AC asks for a reactivate action, so this plan does not add one.
    `is_active` is a plain boolean so a future story can add reactivation trivially, but no
    service function or `audit_logs.action_type` value for it exists here.
  - |
    "Session" has no concrete transport in this codebase (no cookies, no JWTs, no HTTP requests at
    all), so it is modeled purely as a `sessions` table row keyed by an opaque token; "active"
    means `invalidated_at IS NULL`. `authenticate` returns this token so a future transport layer
    can hand it to the browser however it chooses.
  - |
    AC2 requires only that the *next* login use the new credentials — it does not ask existing
    sessions to be killed on a credential update the way AC3 explicitly does for deactivation. So
    `updateResidentCredentials` does not invalidate the resident's current sessions; only
    `deactivateResident` does.
  - |
    Password hashing uses Node's built-in `crypto.scryptSync` + `timingSafeEqual` rather than a
    third-party library (bcrypt/argon2), since the project has no existing hashing dependency and
    none of this story's ACs mandate a specific algorithm.
  - |
    `roles` rows (`admin`, `resident`) are assumed pre-seeded in a real deployment; this repo has
    no seed-data script yet, so `db/credentialService.test.ts` inserts them directly in its own
    setup, the same way `db/migrations.test.ts` already seeds `roles`/`flats` inline.
package_dependencies: []
notes: |
  Why no `src/` changes: `LoginScreen.tsx` currently calls `authenticate()` from
  `src/auth/credentials.ts` synchronously in the browser against an in-memory array. Backing that
  with the real `users`/`sessions` tables would require either (a) bundling `better-sqlite3` (a
  native Node addon) into the browser build, which is impossible, or (b) a real HTTP API the SPA
  fetches from, which does not exist in this repo yet and is a bigger architectural decision than
  one story. `db/` is already kept outside `tsconfig.json`'s `"include": ["src"]` for exactly this
  reason (see STORY-012's plan/migrations), so `db/credentialService.ts` follows that same
  boundary — it is reachable by Node-environment tests today and by a real API layer later,
  without ever being pulled into the Vite bundle.

  ```mermaid
  flowchart TD
    M1[db/migrations/2026...100001_add_username_active_to_users.cjs]
    M2[db/migrations/2026...100002_create_sessions_table.cjs]
    M3[db/migrations/2026...100003_create_audit_logs_table.cjs]
    CS[db/credentialService.ts]
    CST[db/credentialService.test.ts]
    MT[db/migrations.test.ts]
    USERS[(users table)]
    SESS[(sessions table)]
    AUDIT[(audit_logs table)]
    LEGACY_AUTH[src/auth/credentials.ts not wired this story]
    LEGACY_CTX[src/auth/AuthContext.tsx not wired this story]

    M1 -->|adds username/is_active| USERS
    M2 -->|new table| SESS
    M3 -->|new table| AUDIT
    CS -->|reads/writes| USERS
    CS -->|issues/invalidates| SESS
    CS -->|inserts audit rows| AUDIT
    CST -->|exercises| CS
    MT -.->|history length 5 to 8| M1
    LEGACY_AUTH -.->|future wiring, out of scope| CS
    LEGACY_CTX -.->|future wiring, out of scope| CS

    classDef touched fill:#f96,color:#000
    class M1,M2,M3,CS,CST,MT touched
  ```

  Migration filenames use `2026091710000{1,2,3}`, later than STORY-012's last migration
  (`20260914090005`), keeping strict chronological/apply order.
