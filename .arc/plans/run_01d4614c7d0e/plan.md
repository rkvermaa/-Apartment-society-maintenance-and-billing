summary: |
  This repo has no backend/HTTP layer at all today: `db/services/generateMonthlyBills.ts` is a
  Node-only knex function invoked directly from tests, and `src/screens/admin/billing/billingClient.ts`
  is an explicit stub ("no backend/API layer in this codebase yet") that `AdminBillingScreen` calls
  and mocks in tests. `AdminMaintenanceScreen.tsx` is currently a bare heading with no data at all.
  This story's parent epic explicitly calls for standing up the HTTP API layer, and AC1 explicitly
  requires the Admin Maintenance screen to show "real stored data, not a placeholder" — a stronger
  bar than the prior stub pattern, and one that can't be met by a browser-only stub since
  `better-sqlite3`/knex are native Node code that cannot run inside the Vite browser bundle. This
  plan therefore adds a small Express server (`server/app.ts`) over a new `db/services/flats.ts`
  knex service (mirroring the existing `generateMonthlyBills.ts` split of "plain function over a
  `Knex` instance, Node-tested with a real disposable SQLite file"), fronted by a `fetch`-based
  `flatsClient.ts` that `AdminMaintenanceScreen` calls, proxied through Vite dev in `/api/*`. Because
  there is still no real login/session story (STORY-013 has not landed — `AuthContext` only ever
  held an in-memory `role`, no user identity), this plan makes the smallest addition needed to
  attribute edits for AC7: `AuthContext`/`login()` also carries the logged-in `username`, and every
  API call sends the caller's role and username as request headers, which the server uses both to
  gate admin-only access (AC6) and to stamp `updated_by`/`updated_at` on writes (AC7). This protects
  against a genuinely non-admin authenticated resident hitting the API directly (AC6's literal
  scenario), but — same as every other role check in this codebase today (`ProtectedRoute`,
  `GuardedActionButton`) — it still trusts a client-asserted identity rather than a cryptographic
  session; hardening that is explicitly STORY-013's job, flagged again below.
scope:
  - description: |
      Add an `updated_by`/`updated_at` audit pair to `flats`, needed for AC7 ("recorded with the
      acting admin and a timestamp"). Neither column exists on the table created by STORY-012 and
      extended by STORY-009.

      `db/migrations/20260917100003_add_audit_fields_to_flats_table.cjs`:
      ```js
      exports.up = function up(knex) {
        return knex.schema.alterTable('flats', (table) => {
          table.string('updated_by').nullable();
          table.timestamp('updated_at').nullable();
        });
      };

      exports.down = function down(knex) {
        return knex.schema.alterTable('flats', (table) => {
          table.dropColumn('updated_by');
          table.dropColumn('updated_at');
        });
      };
      ```
    files:
      - db/migrations/20260917100003_add_audit_fields_to_flats_table.cjs
    rationale: |
      `updated_by` is a plain string (the acting admin's username), not a FK to `users.id`: the
      hardcoded `DEMO_USERS` in `src/auth/credentials.ts` are not rows in the real `users` table
      anywhere in this codebase (no seed script exists), so a FK would either be unenforceable or
      require inventing user-seeding work outside this story's scope. `updated_at` is nullable
      since existing rows (and rows never edited via this API) legitimately have no edit history.
  - description: |
      Update the existing migration-count assertion so it stays correct once this story's new
      migration exists — this is STORY-012's own AC5 test, not one of this story's ACs, but it
      hard-codes a count that this story's new migration file changes.

      `db/migrations.test.ts`, inside `'records applied migrations with identifier and order (AC5)'`:
      ```ts
      // before
      expect(history).toHaveLength(7);
      // after
      expect(history).toHaveLength(8);
      ```
    files:
      - db/migrations.test.ts
    rationale: |
      Mirrors the exact precedent already set by the STORY-009 plan when it added two migrations
      and bumped this same literal from 5 to 7; all other assertions in that file use
      `expect.arrayContaining(...)` for columns and remain valid unmodified.
  - description: |
      Add the flats master-data service: list all flats, and update a single flat's `is_active`
      and/or `monthly_maintenance_amount` with server-side non-negative validation and audit
      stamping. Plain functions over a `Knex` instance, exactly mirroring
      `db/services/generateMonthlyBills.ts`'s style so it stays Node-testable against a real
      disposable SQLite file with no mocking.

      `db/services/flats.ts`:
      ```ts
      import type { Knex } from 'knex';

      export interface FlatRecord {
        id: number;
        flatNumber: string;
        block: string;
        isActive: boolean;
        monthlyMaintenanceAmount: number | null;
        updatedBy: string | null;
        updatedAt: string | null;
      }

      export interface UpdateFlatInput {
        isActive?: boolean;
        monthlyMaintenanceAmount?: number;
      }

      export class InvalidFlatUpdateError extends Error {}

      function toFlatRecord(row: Record<string, unknown>): FlatRecord {
        return {
          id: row.id as number,
          flatNumber: row.flat_number as string,
          block: row.block as string,
          isActive: Boolean(row.is_active),
          monthlyMaintenanceAmount:
            row.monthly_maintenance_amount === null ? null : Number(row.monthly_maintenance_amount),
          updatedBy: (row.updated_by as string | null) ?? null,
          updatedAt: (row.updated_at as string | null) ?? null,
        };
      }

      export async function listFlats(db: Knex): Promise<FlatRecord[]> {
        const rows = await db('flats').select('*').orderBy(['block', 'flat_number']);
        return rows.map(toFlatRecord);
      }

      export async function updateFlat(
        db: Knex,
        flatId: number,
        input: UpdateFlatInput,
        actingUsername: string,
      ): Promise<FlatRecord> {
        if (
          input.monthlyMaintenanceAmount !== undefined &&
          (typeof input.monthlyMaintenanceAmount !== 'number' ||
            Number.isNaN(input.monthlyMaintenanceAmount) ||
            input.monthlyMaintenanceAmount < 0)
        ) {
          throw new InvalidFlatUpdateError('Monthly maintenance amount must not be negative.');
        }

        const patch: Record<string, unknown> = {
          updated_by: actingUsername,
          updated_at: db.fn.now(),
        };
        if (input.isActive !== undefined) patch.is_active = input.isActive;
        if (input.monthlyMaintenanceAmount !== undefined) {
          patch.monthly_maintenance_amount = input.monthlyMaintenanceAmount;
        }

        await db('flats').where({ id: flatId }).update(patch);
        const row = await db('flats').where({ id: flatId }).first();
        return toFlatRecord(row);
      }
      ```
    files:
      - db/services/flats.ts
    rationale: |
      Validation throws a typed `InvalidFlatUpdateError` (rather than a generic `Error`) so the
      HTTP layer can distinguish "bad input" (400) from an unexpected failure (500) without string
      matching, the same separation `generateMonthlyBills.ts` gets for free by returning a
      structured `failed[]` array instead of throwing.
  - description: |
      Write the failing service-level test suite first, against a disposable per-test SQLite file,
      following the exact harness already used by `db/services/generateMonthlyBills.test.ts`.

      `db/services/flats.test.ts`:
      ```ts
      // @vitest-environment node
      import Knex, { type Knex as KnexType } from 'knex';
      import fs from 'node:fs';
      import os from 'node:os';
      import path from 'node:path';
      import { afterEach, beforeEach, describe, expect, it } from 'vitest';
      import { InvalidFlatUpdateError, listFlats, updateFlat } from './flats';

      let db: KnexType;
      let tmpDir: string;

      beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-flats-'));
        db = Knex({
          client: 'better-sqlite3',
          connection: { filename: path.join(tmpDir, 'test.sqlite3') },
          useNullAsDefault: true,
          migrations: { directory: path.join(__dirname, '..', 'migrations'), extension: 'cjs' },
        });
        await db.migrate.latest();
      });

      afterEach(async () => {
        await db.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });

      async function seedFlat(overrides: Partial<{
        flat_number: string; block: string; is_active: boolean; monthly_maintenance_amount: number | null;
      }> = {}): Promise<number> {
        const [flat] = await db('flats')
          .insert({ flat_number: '101', block: 'A', is_active: true, monthly_maintenance_amount: 1500, ...overrides })
          .returning('id');
        return flat.id as number;
      }

      describe('flats service', () => {
        it('lists flats with their real active flag and maintenance amount (AC1)', async () => {
          await seedFlat({ flat_number: '101', is_active: true, monthly_maintenance_amount: 1500 });

          const flats = await listFlats(db);

          expect(flats).toEqual([
            expect.objectContaining({ flatNumber: '101', isActive: true, monthlyMaintenanceAmount: 1500 }),
          ]);
        });

        it('rejects a negative monthly maintenance amount without writing (AC2)', async () => {
          const flatId = await seedFlat({ monthly_maintenance_amount: 1500 });

          await expect(updateFlat(db, flatId, { monthlyMaintenanceAmount: -1 }, 'admin')).rejects.toThrow(
            InvalidFlatUpdateError,
          );
          const row = await db('flats').where({ id: flatId }).first();
          expect(Number(row.monthly_maintenance_amount)).toBe(1500);
        });

        it('accepts zero as a valid monthly maintenance amount (AC4)', async () => {
          const flatId = await seedFlat({ monthly_maintenance_amount: 1500 });

          const updated = await updateFlat(db, flatId, { monthlyMaintenanceAmount: 0 }, 'admin');

          expect(updated.monthlyMaintenanceAmount).toBe(0);
        });

        it('stamps the acting admin and a timestamp on a successful edit (AC7)', async () => {
          const flatId = await seedFlat();

          const updated = await updateFlat(db, flatId, { monthlyMaintenanceAmount: 1800 }, 'admin-jane');

          expect(updated.updatedBy).toBe('admin-jane');
          expect(updated.updatedAt).not.toBeNull();
        });

        it('toggles the active flag (AC8)', async () => {
          const flatId = await seedFlat({ is_active: true });

          const updated = await updateFlat(db, flatId, { isActive: false }, 'admin');

          expect(updated.isActive).toBe(false);
        });
      });
      ```
    files:
      - db/services/flats.test.ts
    rationale: |
      Test-first: fails on import of `./flats` until the scope item above exists, then passes.
      Covers AC1, AC2, AC4, AC7, AC8 at the service layer with a real SQLite file (no mocking),
      matching this repo's established DB-testing convention.
  - description: |
      Add the HTTP API layer: an Express app factory (constructor-injected `Knex`, so tests use a
      disposable SQLite file the same way `db/services/*.test.ts` already do) exposing
      `GET /api/flats` and `PATCH /api/flats/:id`, gated by an admin-only header check before any
      flats data is read or written (AC6), and a thin `server/index.ts` that wires the real dev
      database and starts listening.

      `server/app.ts`:
      ```ts
      import express, { type NextFunction, type Request, type Response } from 'express';
      import type { Knex } from 'knex';
      import { InvalidFlatUpdateError, listFlats, updateFlat } from '../db/services/flats';

      export function createApp(db: Knex) {
        const app = express();
        app.use(express.json());

        function requireAdmin(req: Request, res: Response, next: NextFunction) {
          if (req.header('x-actor-role') !== 'admin') {
            res.status(403).json({ error: 'Admin role required.' });
            return;
          }
          next();
        }

        app.get('/api/flats', requireAdmin, async (_req, res) => {
          res.json(await listFlats(db));
        });

        app.patch('/api/flats/:id', requireAdmin, async (req, res) => {
          const actingUsername = req.header('x-actor-username') ?? 'unknown';
          try {
            const updated = await updateFlat(db, Number(req.params.id), req.body, actingUsername);
            res.json(updated);
          } catch (error) {
            if (error instanceof InvalidFlatUpdateError) {
              res.status(400).json({ error: error.message });
              return;
            }
            throw error;
          }
        });

        return app;
      }
      ```

      `server/index.ts`:
      ```ts
      import Knex from 'knex';
      import { createApp } from './app';
      import knexConfig from '../db/knexfile.cjs';

      const db = Knex(knexConfig);
      const port = Number(process.env.PORT) || 4000;
      createApp(db).listen(port, () => {
        console.log(`Flats API listening on port ${port}`);
      });
      ```
    files:
      - server/app.ts
      - server/index.ts
    rationale: |
      The role check runs as Express middleware ahead of both routes, so a rejected request never
      reaches `listFlats`/`updateFlat` — satisfying AC6's "without returning or modifying any flat
      data" literally, not just returning an error after the fact. `server/index.ts` is the only
      place a real (non-test) `Knex` instance is constructed, reusing `db/knexfile.cjs` so dev/
      prod connection config isn't duplicated.
  - description: |
      Write the failing HTTP-level test suite first, using `supertest` against `createApp(db)`
      directly (no real port bound), with the same disposable-SQLite harness as the service tests.

      `server/app.test.ts`:
      ```ts
      // @vitest-environment node
      import Knex, { type Knex as KnexType } from 'knex';
      import fs from 'node:fs';
      import os from 'node:os';
      import path from 'node:path';
      import request from 'supertest';
      import { afterEach, beforeEach, describe, expect, it } from 'vitest';
      import { createApp } from './app';

      let db: KnexType;
      let tmpDir: string;

      beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-server-'));
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

      async function seedFlat(): Promise<number> {
        const [flat] = await db('flats')
          .insert({ flat_number: '101', block: 'A', is_active: true, monthly_maintenance_amount: 1500 })
          .returning('id');
        return flat.id as number;
      }

      describe('flats API', () => {
        it('returns real stored flats to an admin, not a placeholder (AC1)', async () => {
          await seedFlat();
          const app = createApp(db);

          const res = await request(app).get('/api/flats').set('x-actor-role', 'admin');

          expect(res.status).toBe(200);
          expect(res.body).toEqual([
            expect.objectContaining({ flatNumber: '101', isActive: true, monthlyMaintenanceAmount: 1500 }),
          ]);
        });

        it('rejects a negative monthly maintenance amount (AC2)', async () => {
          const flatId = await seedFlat();
          const app = createApp(db);

          const res = await request(app)
            .patch(`/api/flats/${flatId}`)
            .set('x-actor-role', 'admin')
            .set('x-actor-username', 'admin')
            .send({ monthlyMaintenanceAmount: -100 });

          expect(res.status).toBe(400);
          const row = await db('flats').where({ id: flatId }).first();
          expect(Number(row.monthly_maintenance_amount)).toBe(1500);
        });

        it('rejects a non-admin caller without returning or modifying any flat data (AC6)', async () => {
          const flatId = await seedFlat();
          const app = createApp(db);

          const listRes = await request(app).get('/api/flats').set('x-actor-role', 'resident');
          const patchRes = await request(app)
            .patch(`/api/flats/${flatId}`)
            .set('x-actor-role', 'resident')
            .send({ monthlyMaintenanceAmount: 2000 });

          expect(listRes.status).toBe(403);
          expect(listRes.body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: flatId })]));
          expect(patchRes.status).toBe(403);
          const row = await db('flats').where({ id: flatId }).first();
          expect(Number(row.monthly_maintenance_amount)).toBe(1500);
        });

        it('records the acting admin and a timestamp on a successful edit (AC7)', async () => {
          const flatId = await seedFlat();
          const app = createApp(db);

          await request(app)
            .patch(`/api/flats/${flatId}`)
            .set('x-actor-role', 'admin')
            .set('x-actor-username', 'admin-jane')
            .send({ monthlyMaintenanceAmount: 1800 });

          const row = await db('flats').where({ id: flatId }).first();
          expect(row.updated_by).toBe('admin-jane');
          expect(row.updated_at).not.toBeNull();
        });

        it('accepts toggling the active flag (AC8)', async () => {
          const flatId = await seedFlat();
          const app = createApp(db);

          const res = await request(app)
            .patch(`/api/flats/${flatId}`)
            .set('x-actor-role', 'admin')
            .set('x-actor-username', 'admin')
            .send({ isActive: false });

          expect(res.status).toBe(200);
          expect(res.body.isActive).toBe(false);
        });
      });
      ```
    files:
      - server/app.test.ts
    rationale: |
      This is the authoritative "real data, not a placeholder" proof for AC1 and the authoritative
      security boundary proof for AC2/AC6/AC7/AC8: it exercises the actual Express app and a real
      SQLite-backed `flats` table end to end via `supertest`, with no mocking, the same no-mock
      discipline `db/migrations.test.ts` and `generateMonthlyBills.test.ts` already established.
  - description: |
      Proxy the browser's `/api/*` calls to the new server in dev, so `AdminMaintenanceScreen` can
      reach it without hardcoding a cross-origin URL or adding a CORS dependency.

      `vite.config.ts` addition:
      ```ts
      server: {
        proxy: {
          '/api': process.env.API_PROXY_TARGET || 'http://localhost:4000',
        },
      },
      ```
    files:
      - vite.config.ts
    rationale: |
      Same-origin proxying avoids introducing a `cors` dependency purely for local dev, and keeps
      the browser client's fetch calls as plain relative paths (`/api/flats`).
  - description: |
      Widen `AuthContext` to also carry the logged-in `username`, the minimum addition needed for
      AC7 ("recorded with the acting admin"): there is no other place in this codebase today that
      remembers who logged in beyond the momentary `authenticate()` call in `LoginScreen`.

      `src/auth/AuthContext.tsx`, interface and provider changes:
      ```ts
      export interface AuthContextValue {
        isAuthenticated: boolean;
        role: Role | null;
        username: string | null;
        login: (role: Role, username: string) => void;
        logout: () => void;
      }
      ```
      `login` becomes `(nextRole: Role, nextUsername: string) => { setRole(nextRole); setUsername(nextUsername); ... }`,
      and `logout` resets both to `null`.

      `src/screens/LoginScreen.tsx`, one-line call-site change:
      ```ts
      // before
      login(role);
      // after
      login(role, username);
      ```
    files:
      - src/auth/AuthContext.tsx
      - src/screens/LoginScreen.tsx
    rationale: |
      `login`'s new second parameter is required (not optional) so every call site is forced to
      supply an identity rather than silently defaulting to an empty/placeholder username that
      would make AC7's audit trail meaningless. The only production call site is
      `LoginScreen.tsx:26`, already holding the typed username in local state.
  - description: |
      Update the shared test helper so tests can render with both a role and a username, mirroring
      the existing `role` option.

      `src/test-utils.tsx`, `RenderWithAuthOptions` and `authValue`:
      ```ts
      interface RenderWithAuthOptions {
        role?: Role | null;
        username?: string | null;
        initialEntries?: string[];
      }
      // ...
      const { role = null, username = role ? 'test-user' : null, initialEntries = ['/'] } = options;
      const authValue = { isAuthenticated: role !== null, role, username, login: () => {}, logout: () => {} };
      ```
    files:
      - src/test-utils.tsx
    rationale: |
      Defaulting `username` to `'test-user'` whenever a `role` is provided (and `null` otherwise)
      keeps every existing `renderWithAuth(..., { role: 'admin' })` call site in the current test
      suite compiling and passing unchanged, since none of them currently pass `username`.
  - description: |
      Add the browser-side flats client: two `fetch`-based functions taking the caller's role and
      username explicitly (there is still no ambient session to read them from), mirroring the
      existing `billingClient.ts` two-function shape but backed by a real endpoint instead of a
      stub.

      `src/screens/admin/maintenance/flatsClient.ts`:
      ```ts
      export interface Flat {
        id: number;
        flatNumber: string;
        block: string;
        isActive: boolean;
        monthlyMaintenanceAmount: number | null;
      }

      export interface Actor {
        role: string;
        username: string;
      }

      function actorHeaders(actor: Actor): HeadersInit {
        return {
          'Content-Type': 'application/json',
          'x-actor-role': actor.role,
          'x-actor-username': actor.username,
        };
      }

      export async function listFlats(actor: Actor): Promise<Flat[]> {
        const res = await fetch('/api/flats', { headers: actorHeaders(actor) });
        if (!res.ok) throw new Error('Failed to load flats.');
        return res.json();
      }

      export async function updateFlat(
        actor: Actor,
        flatId: number,
        patch: Partial<Pick<Flat, 'isActive' | 'monthlyMaintenanceAmount'>>,
      ): Promise<Flat> {
        const res = await fetch(`/api/flats/${flatId}`, {
          method: 'PATCH',
          headers: actorHeaders(actor),
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}) as { error?: string });
          throw new Error(body.error ?? 'Failed to update flat.');
        }
        return res.json();
      }
      ```
    files:
      - src/screens/admin/maintenance/flatsClient.ts
    rationale: |
      Taking `Actor` as an explicit parameter (rather than reading `useAuth()` inside the client
      module) keeps this module framework-agnostic and trivially mockable in
      `AdminMaintenanceScreen.test.tsx`, the same way `billingClient` is mocked in
      `AdminBillingScreen.test.tsx`.
  - description: |
      Replace the placeholder `AdminMaintenanceScreen` with a real screen: loads flats on mount,
      shows each flat's real active flag and amount, lets the admin toggle active and edit/save
      the amount, and surfaces the API's validation error inline.

      `src/screens/admin/AdminMaintenanceScreen.tsx`:
      ```tsx
      import { useEffect, useState } from 'react';
      import { useAuth } from '../../auth/useAuth';
      import { listFlats, updateFlat, type Flat } from './maintenance/flatsClient';

      export function AdminMaintenanceScreen() {
        const { role, username } = useAuth();
        const actor = { role: role ?? '', username: username ?? '' };
        const [flats, setFlats] = useState<Flat[]>([]);
        const [drafts, setDrafts] = useState<Record<number, string>>({});
        const [errors, setErrors] = useState<Record<number, string>>({});

        useEffect(() => {
          listFlats(actor).then(setFlats);
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);

        function label(flat: Flat) {
          return `${flat.block}-${flat.flatNumber}`;
        }

        async function handleSaveAmount(flat: Flat) {
          const raw = drafts[flat.id] ?? String(flat.monthlyMaintenanceAmount ?? '');
          try {
            const updated = await updateFlat(actor, flat.id, { monthlyMaintenanceAmount: Number(raw) });
            setFlats((prev) => prev.map((f) => (f.id === flat.id ? updated : f)));
            setErrors((prev) => ({ ...prev, [flat.id]: '' }));
          } catch (error) {
            setErrors((prev) => ({
              ...prev,
              [flat.id]: error instanceof Error ? error.message : 'Update failed.',
            }));
          }
        }

        async function handleToggleActive(flat: Flat) {
          const updated = await updateFlat(actor, flat.id, { isActive: !flat.isActive });
          setFlats((prev) => prev.map((f) => (f.id === flat.id ? updated : f)));
        }

        return (
          <section>
            <h1>Maintenance</h1>
            <table>
              <tbody>
                {flats.map((flat) => (
                  <tr key={flat.id}>
                    <td>{label(flat)}</td>
                    <td>
                      <button type="button" onClick={() => handleToggleActive(flat)}>
                        {flat.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td>
                      <input
                        aria-label={`Monthly amount for ${label(flat)}`}
                        type="number"
                        value={drafts[flat.id] ?? String(flat.monthlyMaintenanceAmount ?? '')}
                        onChange={(event) =>
                          setDrafts((prev) => ({ ...prev, [flat.id]: event.target.value }))
                        }
                      />
                      <button type="button" onClick={() => handleSaveAmount(flat)}>
                        {`Save ${label(flat)}`}
                      </button>
                      {errors[flat.id] && <p role="alert">{errors[flat.id]}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      }
      ```
    files:
      - src/screens/admin/AdminMaintenanceScreen.tsx
    rationale: |
      `aria-label`-per-row (`Monthly amount for A-101`, `Save A-101`) keeps every row's controls
      individually addressable by Testing Library's role/label queries without introducing test
      ids, consistent with this repo's existing accessibility-first query convention
      (`AdminBillingScreen.test.tsx`, `LoginScreen.test.tsx`).
  - description: |
      Write the failing screen test suite first, mocking `flatsClient` the same way
      `AdminBillingScreen.test.tsx` mocks `billingClient`, plus one routing test reusing `App` for
      AC5.

      `src/screens/admin/AdminMaintenanceScreen.test.tsx`:
      ```tsx
      import { beforeEach, describe, expect, it, vi } from 'vitest';
      import { screen, waitFor } from '@testing-library/react';
      import userEvent from '@testing-library/user-event';
      import { AdminMaintenanceScreen } from './AdminMaintenanceScreen';
      import { App } from '../../App';
      import { renderWithAuth } from '../../test-utils';
      import * as flatsClient from './maintenance/flatsClient';

      vi.mock('./maintenance/flatsClient');

      const mockedList = vi.mocked(flatsClient.listFlats);
      const mockedUpdate = vi.mocked(flatsClient.updateFlat);

      const flatA: flatsClient.Flat = {
        id: 1,
        flatNumber: '101',
        block: 'A',
        isActive: true,
        monthlyMaintenanceAmount: 1500,
      };

      beforeEach(() => {
        mockedList.mockReset();
        mockedUpdate.mockReset();
        mockedList.mockResolvedValue([flatA]);
      });

      describe('AdminMaintenanceScreen', () => {
        it('AC1: lists flats with their real active flag and monthly maintenance amount', async () => {
          renderWithAuth(<AdminMaintenanceScreen />, { role: 'admin', username: 'admin-jane' });

          expect(await screen.findByText('A-101')).toBeInTheDocument();
          expect(screen.getByRole('button', { name: 'Active' })).toBeInTheDocument();
          expect(screen.getByLabelText('Monthly amount for A-101')).toHaveValue(1500);
        });

        it('AC3: shows a validation error when the API rejects a negative amount', async () => {
          const user = userEvent.setup();
          mockedUpdate.mockRejectedValue(new Error('Monthly maintenance amount must not be negative.'));
          renderWithAuth(<AdminMaintenanceScreen />, { role: 'admin', username: 'admin-jane' });
          await screen.findByText('A-101');

          await user.clear(screen.getByLabelText('Monthly amount for A-101'));
          await user.type(screen.getByLabelText('Monthly amount for A-101'), '-50');
          await user.click(screen.getByRole('button', { name: 'Save A-101' }));

          expect(await screen.findByRole('alert')).toHaveTextContent(
            'Monthly maintenance amount must not be negative.',
          );
        });

        it('AC4: saves an accepted non-negative amount and reflects it with no error', async () => {
          const user = userEvent.setup();
          mockedUpdate.mockResolvedValue({ ...flatA, monthlyMaintenanceAmount: 0 });
          renderWithAuth(<AdminMaintenanceScreen />, { role: 'admin', username: 'admin-jane' });
          await screen.findByText('A-101');

          await user.clear(screen.getByLabelText('Monthly amount for A-101'));
          await user.type(screen.getByLabelText('Monthly amount for A-101'), '0');
          await user.click(screen.getByRole('button', { name: 'Save A-101' }));

          await waitFor(() => expect(screen.getByLabelText('Monthly amount for A-101')).toHaveValue(0));
          expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('AC7: attributes a saved edit to the logged-in admin', async () => {
          const user = userEvent.setup();
          mockedUpdate.mockResolvedValue({ ...flatA, monthlyMaintenanceAmount: 1800 });
          renderWithAuth(<AdminMaintenanceScreen />, { role: 'admin', username: 'admin-jane' });
          await screen.findByText('A-101');

          await user.clear(screen.getByLabelText('Monthly amount for A-101'));
          await user.type(screen.getByLabelText('Monthly amount for A-101'), '1800');
          await user.click(screen.getByRole('button', { name: 'Save A-101' }));

          await waitFor(() =>
            expect(mockedUpdate).toHaveBeenCalledWith(
              { role: 'admin', username: 'admin-jane' },
              1,
              { monthlyMaintenanceAmount: 1800 },
            ),
          );
        });

        it('AC8: toggles the active flag and saves it', async () => {
          const user = userEvent.setup();
          mockedUpdate.mockResolvedValue({ ...flatA, isActive: false });
          renderWithAuth(<AdminMaintenanceScreen />, { role: 'admin', username: 'admin-jane' });
          await screen.findByText('A-101');

          await user.click(screen.getByRole('button', { name: 'Active' }));

          expect(await screen.findByRole('button', { name: 'Inactive' })).toBeInTheDocument();
          expect(mockedUpdate).toHaveBeenCalledWith(
            { role: 'admin', username: 'admin-jane' },
            1,
            { isActive: false },
          );
        });

        it('AC5: blocks a non-admin from navigating to Admin Maintenance', () => {
          renderWithAuth(<App />, { role: 'resident', initialEntries: ['/admin/maintenance'] });

          expect(screen.getByRole('heading', { name: 'Resident Dashboard' })).toBeInTheDocument();
          expect(screen.queryByRole('heading', { name: 'Maintenance' })).not.toBeInTheDocument();
        });
      });
      ```
    files:
      - src/screens/admin/AdminMaintenanceScreen.test.tsx
    rationale: |
      AC5 needs no new production code — `src/App.tsx:18` already routes `/admin/maintenance`
      through `<ProtectedRoute allowedRoles={['admin']}>`, the identical mechanism already proven
      for `/admin/billing` in `src/auth/ProtectedRoute.test.tsx`. This test adds the one case
      specific to this screen's exact path, rather than only citing the generic mechanism, since
      AC5 names this screen explicitly.
tests:
  - |
    AC1 — real stored flats (active flag + amount), not a placeholder, proven twice: at the HTTP
    boundary against a real SQLite file (`server/app.test.ts`), and at the screen boundary against
    a mocked client (`AdminMaintenanceScreen.test.tsx`):
    ```ts
    const res = await request(app).get('/api/flats').set('x-actor-role', 'admin');
    expect(res.body).toEqual([
      expect.objectContaining({ flatNumber: '101', isActive: true, monthlyMaintenanceAmount: 1500 }),
    ]);
    ```
  - |
    AC2 — the API rejects a negative monthly maintenance amount and does not write it:
    ```ts
    const res = await request(app).patch(`/api/flats/${flatId}`).set('x-actor-role', 'admin')
      .send({ monthlyMaintenanceAmount: -100 });
    expect(res.status).toBe(400);
    expect(Number((await db('flats').where({ id: flatId }).first()).monthly_maintenance_amount)).toBe(1500);
    ```
  - |
    AC3 — the screen shows a validation error surfaced from the API's rejection:
    ```tsx
    mockedUpdate.mockRejectedValue(new Error('Monthly maintenance amount must not be negative.'));
    await user.click(screen.getByRole('button', { name: 'Save A-101' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Monthly maintenance amount must not be negative.');
    ```
  - |
    AC4 — zero or a non-negative amount is accepted and saved, reflected with no error:
    ```tsx
    mockedUpdate.mockResolvedValue({ ...flatA, monthlyMaintenanceAmount: 0 });
    await waitFor(() => expect(screen.getByLabelText('Monthly amount for A-101')).toHaveValue(0));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    ```
  - |
    AC5 — a non-admin is blocked from navigating to Admin Maintenance:
    ```tsx
    renderWithAuth(<App />, { role: 'resident', initialEntries: ['/admin/maintenance'] });
    expect(screen.getByRole('heading', { name: 'Resident Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Maintenance' })).not.toBeInTheDocument();
    ```
  - |
    AC6 — a non-admin authenticated caller is rejected without any flat data being returned or
    modified, checked on both the read and write endpoints:
    ```ts
    const listRes = await request(app).get('/api/flats').set('x-actor-role', 'resident');
    const patchRes = await request(app).patch(`/api/flats/${flatId}`).set('x-actor-role', 'resident')
      .send({ monthlyMaintenanceAmount: 2000 });
    expect(listRes.status).toBe(403);
    expect(patchRes.status).toBe(403);
    expect(Number((await db('flats').where({ id: flatId }).first()).monthly_maintenance_amount)).toBe(1500);
    ```
  - |
    AC7 — a successful edit is recorded with the acting admin and a timestamp:
    ```ts
    await request(app).patch(`/api/flats/${flatId}`).set('x-actor-role', 'admin')
      .set('x-actor-username', 'admin-jane').send({ monthlyMaintenanceAmount: 1800 });
    const row = await db('flats').where({ id: flatId }).first();
    expect(row.updated_by).toBe('admin-jane');
    expect(row.updated_at).not.toBeNull();
    ```
  - |
    AC8 — toggling the active flag is accepted and saved:
    ```ts
    const res = await request(app).patch(`/api/flats/${flatId}`).set('x-actor-role', 'admin')
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
    ```
assumptions_or_open_questions:
  - |
    This story stands up an actual Express HTTP server (`server/app.ts` + `server/index.ts`) rather
    than extending the deferred-stub pattern STORY-009 used for billing. This follows directly from
    the parent epic's own wording ("Stand up the HTTP API layer...") and AC1's explicit "not a
    placeholder" bar, which the stub pattern cannot satisfy since `better-sqlite3`/knex cannot run
    in the browser bundle. Please confirm this is the story meant to carry that infrastructure
    (rather than, e.g., a dedicated "API layer" story earlier in the epic that hasn't been written
    yet) — if not, this plan's `server/` scope should move there and this story would fall back to
    the same stub-and-defer pattern as `billingClient.ts`, failing AC1 as literally worded.
  - |
    Caller identity/authorization is asserted via `x-actor-role`/`x-actor-username` request headers
    populated from `AuthContext`'s in-memory role/username, because no session/token mechanism
    exists anywhere in this codebase yet (`AuthContext.tsx`'s own comment: STORY-013 owns real
    credential verification and session issuance). This correctly rejects AC6's literal scenario —
    a genuinely non-admin authenticated resident calling the API — the same way `ProtectedRoute`
    and `GuardedActionButton` already trust the in-memory role for routing/action gating. It does
    not defend against a client that forges the header to claim `admin` while unauthenticated;
    closing that gap requires STORY-013's server-issued session and is out of scope here, consistent
    with every prior story's deferral of the same gap.
  - |
    `AuthContext`/`login()` is widened to also carry `username` (previously discarded after
    `authenticate()`), since AC7 requires attributing an edit to a specific acting admin and no
    other identity exists in the app today. `login`'s new second parameter is required, not
    optional, so this can't silently regress into an empty audit value.
  - |
    `updated_by` on `flats` is a plain string column (the acting admin's username), not a FK to
    `users.id`, because `credentials.ts`'s `DEMO_USERS` are not linked to any row in the real
    `users` table anywhere in this codebase. Confirm this is acceptable, or whether `users` should
    be seeded with matching rows in a future story so this can become a real FK.
  - |
    Only `is_active` and `monthly_maintenance_amount` are editable through `PATCH /api/flats/:id`;
    `flat_number`/`block` are treated as immutable master data since no AC mentions editing them.
  - |
    Running this end-to-end in dev requires two processes (`npm run server` for the API,
    `npm run dev` for Vite) plus `npm run migrate:latest` having been run at least once first. No
    process-manager dependency (e.g. `concurrently`) is added since it's a minor dev-ergonomics
    nicety, not something any AC requires.
package_dependencies:
  - name: express
    version: ^4.21.0
    ecosystem: npm
    rationale: |
      HTTP framework for the new admin flat master data API (`server/app.ts`); nothing in this
      codebase depends on it today since there has never been a backend server here.
  - name: "@types/express"
    version: ^4.17.21
    ecosystem: npm
    rationale: |
      TypeScript types for `express`, required to satisfy this project's `strict` compiler options
      when writing `server/app.ts`.
  - name: supertest
    version: ^7.0.0
    ecosystem: npm
    rationale: |
      HTTP-assertion testing library used in `server/app.test.ts` to exercise `createApp(db)`
      end-to-end (status codes, headers, response bodies) without binding a real network port.
  - name: "@types/supertest"
    version: ^6.0.2
    ecosystem: npm
    rationale: |
      TypeScript types for `supertest`, needed under this project's `strict` compiler options.
  - name: tsx
    version: ^4.19.2
    ecosystem: npm
    rationale: |
      Runs `server/index.ts` directly in dev without a separate build step. Existing tooling only
      compiles `src/` via Vite/tsc; `db/` migrations run as plain `.cjs` via the knex CLI. Neither
      mechanism can start a long-running TypeScript HTTP server, so a small TS-execution runtime is
      needed for the new `npm run server` script.
notes: |
  ```mermaid
  flowchart TD
    LoginScreen[src/screens/LoginScreen.tsx]
    AuthContext[src/auth/AuthContext.tsx]
    ProtectedRoute[src/auth/ProtectedRoute.tsx]
    AppRoutes[src/App.tsx]
    Screen[src/screens/admin/AdminMaintenanceScreen.tsx]
    Client[src/screens/admin/maintenance/flatsClient.ts]
    ViteProxy[vite.config.ts - proxy /api]
    ServerApp[server/app.ts]
    ServerIndex[server/index.ts]
    Service[db/services/flats.ts]
    Migration[db/migrations/..._add_audit_fields_to_flats_table.cjs]
    FlatsTable[(flats table)]

    LoginScreen -->|login role + username| AuthContext
    AuthContext -->|role + username via useAuth| Screen
    AppRoutes -->|already routes /admin/maintenance through| ProtectedRoute
    ProtectedRoute -->|renders on admin match| Screen
    Screen -->|listFlats / updateFlat actor, ...| Client
    Client -->|fetch /api/flats| ViteProxy
    ViteProxy -->|proxies to localhost:4000| ServerApp
    ServerIndex -->|creates real-db app, listens| ServerApp
    ServerApp -->|requireAdmin gate, then| Service
    Service -->|reads/writes| FlatsTable
    Migration -->|adds updated_by/updated_at| FlatsTable

    classDef touched fill:#f96,color:#000
    class LoginScreen,AuthContext,Screen,Client,ViteProxy,ServerApp,ServerIndex,Service,Migration,FlatsTable touched
  ```

  Why a real Express server instead of extending the `billingClient.ts` stub pattern: `better-sqlite3`
  is a native Node addon and cannot be bundled into the Vite browser build, so "real stored data,
  not a placeholder" (AC1) is unreachable from the browser without a network hop to some Node
  process. `db/services/flats.ts` mirrors `generateMonthlyBills.ts`'s existing shape (plain function
  over a `Knex` instance) precisely so the DB logic stays testable the same way; `server/app.ts` is
  the minimal addition on top that makes it reachable over HTTP, gated and audited per AC6/AC7.

  Why headers instead of a body field for actor identity: keeps `GET /api/flats` (which has no
  body) able to carry the same identity contract as `PATCH`, and keeps the admin gate enforceable
  in one piece of middleware ahead of both routes.
