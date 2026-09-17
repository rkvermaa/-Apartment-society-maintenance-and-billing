summary: |
  This repo has no HTTP/API layer anywhere today — confirmed by reading `src/auth/credentials.ts`,
  `src/auth/AuthContext.tsx`, and the prior STORY-009 plan, all of which explicitly defer backend
  wiring, and by the fact that `src/screens/admin/billing/billingClient.ts#listBillsForMonth`
  is a stub that always resolves `[]`. This story stands up the first real endpoint
  (`GET /api/bills?month=YYYY-MM`), backed by a new Node/Express server (`server/`) that reuses the
  existing Knex/`better-sqlite3` schema from STORY-012/009 via a new, independently-tested service
  module (`db/services/listBillsForMonth.ts`), and wires `AdminBillingScreen` to call it through a
  real (no-longer-stubbed) `billingClient.listBillsForMonth`. Because no session/credential-issuing
  backend exists yet (that is explicitly STORY-013's job per existing code comments), and building
  one is disproportionate to a single listing endpoint, the API's admin-only enforcement (AC5/AC6)
  uses an explicit interim mechanism: the client sends its already-held (unverified) `role` via an
  `X-Demo-Role` request header, and the server's `requireRole` middleware rejects a missing header
  (401, "unauthenticated") or a mismatched role (403, "wrong role") before the request ever reaches
  the database. This is not a stronger trust boundary than the rest of the app has today (the whole
  app already trusts a client-held, unverified role in `AuthContext`) — it is called out plainly as
  an interim measure, not real security, pending STORY-013.
scope:
  - description: |
      Add a Node-testable service that queries bills for exactly one billing period, joined to
      `flats` for a human-readable label, matching the `A-101` label convention already used in
      `db/services/generateMonthlyBills.test.ts` and `AdminBillingScreen.test.tsx` fixtures.

      `db/services/listBillsForMonth.ts`:
      ```ts
      import type { Knex } from 'knex';

      export interface BillListItem {
        id: number;
        flatLabel: string;
        billingPeriod: string;
        amount: number;
        status: string;
      }

      export async function listBillsForMonth(db: Knex, billingPeriod: string): Promise<BillListItem[]> {
        const rows = await db('bills')
          .join('flats', 'flats.id', 'bills.flat_id')
          .where('bills.billing_period', billingPeriod)
          .select(
            'bills.id as id',
            'bills.billing_period as billingPeriod',
            'bills.amount as amount',
            'bills.status as status',
            db.raw("flats.block || '-' || flats.flat_number as flatLabel"),
          );
        return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
      }
      ```
    files:
      - db/services/listBillsForMonth.ts
    rationale: |
      Mirrors the existing `db/services/generateMonthlyBills.ts` pattern (plain async function over
      a `Knex` instance, Node-tested against a real disposable SQLite file, no mocking of the DB
      layer) so this story's data-access code is consistent with the one precedent already in the
      codebase. `amount` is cast to `Number` because `generateMonthlyBills.test.ts` shows
      better-sqlite3/Knex can return `decimal` columns as strings.
  - description: |
      Write the failing service test first, before `listBillsForMonth.ts` exists, using the exact
      disposable-SQLite harness already established in `db/services/generateMonthlyBills.test.ts`.

      `db/services/listBillsForMonth.test.ts`:
      ```ts
      // @vitest-environment node
      import Knex, { type Knex as KnexType } from 'knex';
      import fs from 'node:fs';
      import os from 'node:os';
      import path from 'node:path';
      import { afterEach, beforeEach, describe, expect, it } from 'vitest';
      import { listBillsForMonth } from './listBillsForMonth';

      let db: KnexType;
      let tmpDir: string;

      beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-bills-list-'));
        db = Knex({
          client: 'better-sqlite3',
          connection: { filename: path.join(tmpDir, 'test.sqlite3') },
          useNullAsDefault: true,
          migrations: { directory: path.join(__dirname, '..', 'migrations'), extension: 'cjs' },
        });
      });

      afterEach(async () => {
        await db.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });

      async function seedFlat(overrides: Partial<{ flat_number: string; block: string }> = {}): Promise<number> {
        const [flat] = await db('flats')
          .insert({ flat_number: '101', block: 'A', is_active: true, monthly_maintenance_amount: 1500, ...overrides })
          .returning('id');
        return flat.id as number;
      }

      async function seedBill(
        flatId: number,
        overrides: Partial<{ billing_period: string; amount: number; status: string }> = {},
      ) {
        await db('bills').insert({
          flat_id: flatId,
          billing_period: '2026-02',
          amount: 1500,
          due_date: '2026-02-28',
          status: 'unpaid',
          ...overrides,
        });
      }

      describe('listBillsForMonth', () => {
        it('returns the bills for the requested month, with a flat label and status (AC1)', async () => {
          await db.migrate.latest();
          const flatId = await seedFlat({ flat_number: '101', block: 'A' });
          await seedBill(flatId, { billing_period: '2026-02', amount: 1500, status: 'unpaid' });

          const bills = await listBillsForMonth(db, '2026-02');

          expect(bills).toEqual([
            expect.objectContaining({ flatLabel: 'A-101', billingPeriod: '2026-02', amount: 1500, status: 'unpaid' }),
          ]);
        });

        it('returns an empty array for a month with no bills generated yet (AC2)', async () => {
          await db.migrate.latest();

          const bills = await listBillsForMonth(db, '2026-03');

          expect(bills).toEqual([]);
        });

        it('excludes bills from other months (AC3)', async () => {
          await db.migrate.latest();
          const flatId = await seedFlat();
          await seedBill(flatId, { billing_period: '2026-02' });
          await seedBill(flatId, { billing_period: '2026-03' });

          const bills = await listBillsForMonth(db, '2026-02');

          expect(bills).toHaveLength(1);
          expect(bills[0].billingPeriod).toBe('2026-02');
        });
      });
      ```
    files:
      - db/services/listBillsForMonth.test.ts
    rationale: |
      Test-first, one failing test per data-layer AC (AC1 real data, AC2 empty state, AC3 single-
      month scoping) before the service module exists.
  - description: |
      Add the interim, explicitly-labeled-as-such role-check middleware the new endpoint uses,
      since no server-issued session/credential mechanism exists in this codebase yet.

      `server/auth.ts`:
      ```ts
      import type { NextFunction, Request, Response } from 'express';

      export type DemoRole = 'admin' | 'resident';

      // Interim, NOT a real security boundary: this codebase has no server-issued session or
      // credential-verification mechanism yet (src/auth/credentials.ts and src/auth/AuthContext.tsx
      // both defer that to the not-yet-built session-management story). Until that exists, the API
      // trusts the caller-asserted role via this header exactly as much as the rest of the app
      // already trusts an unverified client-held role in AuthContext - it is not stronger or
      // weaker than the app's existing trust model, just enforced at one more layer.
      export function requireRole(allowedRole: DemoRole) {
        return (req: Request, res: Response, next: NextFunction) => {
          const role = req.header('x-demo-role');
          if (!role) {
            res.status(401).json({ error: 'Authentication required.' });
            return;
          }
          if (role !== allowedRole) {
            res.status(403).json({ error: 'You do not have permission to perform this action.' });
            return;
          }
          next();
        };
      }
      ```
    files:
      - server/auth.ts
    rationale: |
      Isolating this in one small, clearly-commented module makes the interim nature of the check
      impossible to miss for the next reader, and keeps the eventual STORY-013 swap-in (a real,
      server-verified session token) a one-file change.
  - description: |
      Add the Express app factory hosting the bills-listing route, wired to the new service and
      auth middleware. `createApp(db)` (not a bound port) so it is directly testable with
      `supertest` against an in-memory/temp-file database, matching how `generateMonthlyBills`
      is tested against a real Knex instance rather than mocked.

      `server/app.ts`:
      ```ts
      import express from 'express';
      import type { Knex } from 'knex';
      import { requireRole } from './auth';
      import { listBillsForMonth } from '../db/services/listBillsForMonth';

      const MONTH_PATTERN = /^\d{4}-\d{2}$/;

      export function createApp(db: Knex) {
        const app = express();

        app.get('/api/bills', requireRole('admin'), async (req, res) => {
          const month = String(req.query.month ?? '');
          if (!MONTH_PATTERN.test(month)) {
            res.status(400).json({ error: 'month query parameter must be in YYYY-MM format.' });
            return;
          }

          try {
            const bills = await listBillsForMonth(db, month);
            res.json(bills);
          } catch {
            res.status(500).json({ error: 'Failed to load bills.' });
          }
        });

        return app;
      }
      ```
    files:
      - server/app.ts
    rationale: |
      `requireRole('admin')` runs before the DB is ever touched, so a denied caller (AC5/AC6) never
      reaches `listBillsForMonth` - denial and data access are cleanly separated, matching the
      existing `ProtectedRoute`/`GuardedActionButton` "check first, act second" convention already
      used client-side in this codebase.
  - description: |
      Write the failing API test first (supertest against the in-process Express app), covering the
      two ACs that only make sense to test at the HTTP layer: denial of a non-admin caller and
      denial of an unauthenticated caller, plus one authenticated-admin happy path proving the
      route/middleware/service wiring end-to-end.

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

      beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-api-'));
        db = Knex({
          client: 'better-sqlite3',
          connection: { filename: path.join(tmpDir, 'test.sqlite3') },
          useNullAsDefault: true,
          migrations: { directory: path.join(__dirname, '..', 'db', 'migrations'), extension: 'cjs' },
        });
      });

      afterEach(async () => {
        await db.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });

      describe('GET /api/bills', () => {
        it('returns bills for an authenticated admin (AC1)', async () => {
          await db.migrate.latest();
          const [flat] = await db('flats')
            .insert({ flat_number: '101', block: 'A', is_active: true, monthly_maintenance_amount: 1500 })
            .returning('id');
          await db('bills').insert({
            flat_id: flat.id,
            billing_period: '2026-02',
            amount: 1500,
            due_date: '2026-02-28',
            status: 'unpaid',
          });
          const app = createApp(db);

          const response = await request(app).get('/api/bills?month=2026-02').set('X-Demo-Role', 'admin');

          expect(response.status).toBe(200);
          expect(response.body).toEqual([
            expect.objectContaining({ flatLabel: 'A-101', billingPeriod: '2026-02', status: 'unpaid' }),
          ]);
        });

        it('denies a non-admin authenticated caller (AC5)', async () => {
          await db.migrate.latest();
          const app = createApp(db);

          const response = await request(app).get('/api/bills?month=2026-02').set('X-Demo-Role', 'resident');

          expect(response.status).toBe(403);
        });

        it('denies an unauthenticated caller with no role header (AC6)', async () => {
          await db.migrate.latest();
          const app = createApp(db);

          const response = await request(app).get('/api/bills?month=2026-02');

          expect(response.status).toBe(401);
        });
      });
      ```
    files:
      - server/app.test.ts
    rationale: |
      AC2/AC3 (empty-month, single-month scoping) are already proven at the service-test layer
      above; duplicating them here with supertest would be redundant coverage of the same SQL, not
      a new behavior, so this suite is deliberately limited to the HTTP-only concerns (auth
      middleware status codes) plus one wiring smoke test.
  - description: |
      Add a runnable server entrypoint and wire the dev proxy/scripts/dependencies so the endpoint
      is actually reachable, not just unit-tested.

      `server/main.ts`:
      ```ts
      import Knex from 'knex';
      import knexConfig from '../db/knexfile.cjs';
      import { createApp } from './app';

      const db = Knex(knexConfig);
      const port = Number(process.env.ARC_DEV_PORT) || 8004;

      createApp(db).listen(port, () => {
        console.log(`Bills API listening on port ${port}`);
      });
      ```

      `package.json` scripts addition:
      ```json
      "dev:server": "tsx server/main.ts"
      ```

      `vite.config.ts` addition:
      ```ts
      server: {
        proxy: {
          '/api': {
            target: `http://localhost:${process.env.ARC_DEV_PORT || 8004}`,
            changeOrigin: true,
          },
        },
      },
      ```
    files:
      - server/main.ts
      - package.json
      - vite.config.ts
    rationale: |
      `ARC_DEV_PORT` is already reserved for this worktree in `.env` (alongside `ARC_WEB_PORT` for
      Vite itself), so this reuses it rather than inventing a new port convention. The Vite proxy
      lets the browser call the same-origin `/api/bills` path in dev without a CORS setup; `tsx` is
      added as a zero-config TS runner for the server entrypoint since the project's migrations use
      plain `.cjs` (no runner needed) but a long-running server process needs one, and the project
      has no existing TS execution story outside Vite's own bundler/Vitest's esbuild transform.
  - description: |
      Replace the stubbed `listBillsForMonth` in the billing client with a real `fetch` call to the
      new endpoint, translating denial/failure responses into the two user-facing error strings the
      screen (below) matches on.

      `src/screens/admin/billing/billingClient.ts`, replacing the stub:
      ```ts
      import type { Role } from '../../../auth/AuthContext';

      export async function listBillsForMonth(billingPeriod: string, role: Role | null): Promise<Bill[]> {
        let response: Response;
        try {
          response = await fetch(`/api/bills?month=${encodeURIComponent(billingPeriod)}`, {
            headers: role ? { 'X-Demo-Role': role } : {},
          });
        } catch {
          throw new Error('Unable to load bills. Please try again.');
        }
        if (response.status === 401 || response.status === 403) {
          throw new Error('You do not have permission to view bills.');
        }
        if (!response.ok) {
          throw new Error('Unable to load bills. Please try again.');
        }
        return response.json();
      }
      ```
      (`generateMonthlyBills` in this file is unchanged - out of scope for this story, which owns
      only the listing endpoint per the acceptance criteria.)
    files:
      - src/screens/admin/billing/billingClient.ts
    rationale: |
      Every non-2xx path is converted into an `Error` with a message the screen can render via
      `role="alert"`, matching how `generateMonthlyBills`'s existing caller in
      `AdminBillingScreen.tsx` already surfaces thrown errors.
  - description: |
      Wire `AdminBillingScreen` to the real client call, reading the caller's role from the existing
      `useAuth()` hook, and add loading-independent error/retry handling for the bills list (AC4),
      distinct from the existing bill-generation error state.

      `src/screens/admin/AdminBillingScreen.tsx` key changes (before -> after):
      ```tsx
      // before
      useEffect(() => {
        if (!month) return;
        listBillsForMonth(month).then(setBills);
      }, [month]);

      // after
      const { role } = useAuth();
      const [listErrorMessage, setListErrorMessage] = useState<string | null>(null);

      const loadBills = useCallback(
        async (targetMonth: string) => {
          setListErrorMessage(null);
          try {
            setBills(await listBillsForMonth(targetMonth, role));
          } catch (error) {
            setListErrorMessage(error instanceof Error ? error.message : 'Unable to load bills. Please try again.');
          }
        },
        [role],
      );

      useEffect(() => {
        if (!month) return;
        loadBills(month);
      }, [month, loadBills]);
      ```

      And the bill-list render block gets a retryable error branch ahead of the existing
      empty/populated branches:
      ```tsx
      {listErrorMessage ? (
        <div role="alert">
          <p>{listErrorMessage}</p>
          <button type="button" onClick={() => loadBills(month)}>
            Retry
          </button>
        </div>
      ) : bills.length === 0 ? (
        <p>No bills found for this month.</p>
      ) : (
        <ul>{/* unchanged */}</ul>
      )}
      ```

      `handleGenerate`'s call to `listBillsForMonth(month)` after a successful generation becomes
      `await loadBills(month)`, reusing the same load/error path instead of calling the client
      directly.
    files:
      - src/screens/admin/AdminBillingScreen.tsx
    rationale: |
      A separate `listErrorMessage` (vs. the existing `errorMessage` used only for the generate
      action) keeps AC4's failure state from clobbering or being clobbered by an unrelated
      generation error, and keeps both visible independently if both happen to be present.
  - description: |
      Update the existing screen test file so it wraps renders in the app's real auth context
      (required now that the screen calls `useAuth()`), and add new failing tests first for this
      story's ACs before the above two files are implemented.

      `src/screens/admin/AdminBillingScreen.test.tsx`, render calls change from:
      ```tsx
      render(<AdminBillingScreen />);
      ```
      to:
      ```tsx
      renderWithAuth(<AdminBillingScreen />, { role: 'admin' });
      ```
      New test cases:
      ```tsx
      it('lists the real bills for the selected month (AC1)', async () => {
        mockedList.mockResolvedValue([
          { id: 5, flatLabel: 'B-202', billingPeriod: '2026-04', amount: 1800, status: 'paid' },
        ]);
        renderWithAuth(<AdminBillingScreen />, { role: 'admin' });
        fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-04' } });

        expect(await screen.findByText('B-202 — paid')).toBeInTheDocument();
        expect(mockedList).toHaveBeenCalledWith('2026-04', 'admin');
      });

      it('requests bills scoped to only the selected month (AC3)', async () => {
        mockedList.mockResolvedValue([]);
        renderWithAuth(<AdminBillingScreen />, { role: 'admin' });
        fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-05' } });

        await waitFor(() => expect(mockedList).toHaveBeenLastCalledWith('2026-05', 'admin'));
      });

      it('shows a generic, retryable error message when loading bills fails (AC4)', async () => {
        const user = userEvent.setup();
        mockedList.mockRejectedValueOnce(new Error('Unable to load bills. Please try again.'));
        renderWithAuth(<AdminBillingScreen />, { role: 'admin' });

        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load bills. Please try again.');

        mockedList.mockResolvedValueOnce([
          { id: 9, flatLabel: 'C-303', billingPeriod: '2026-02', amount: 1200, status: 'unpaid' },
        ]);
        await user.click(screen.getByRole('button', { name: 'Retry' }));

        expect(await screen.findByText('C-303 — unpaid')).toBeInTheDocument();
      });
      ```
      The existing `'shows an empty-state message for a month with no bills (AC11)'` test is kept
      unchanged in behavior (just re-wrapped in `renderWithAuth`) and now maps to this story's AC2.
    files:
      - src/screens/admin/AdminBillingScreen.test.tsx
    rationale: |
      `renderWithAuth` (already used by `ProtectedRoute.test.tsx`/`App.test.tsx`) is reused rather
      than inventing a second auth-context test helper. AC1 and AC3's assertions on
      `mockedList`'s call arguments are the UI-level half of proof; the server-side half (real
      per-month filtering) is proven by `db/services/listBillsForMonth.test.ts` and
      `server/app.test.ts` above.
  - description: |
      No code changes for the "via the screen" half of AC5/AC6 (non-admin/unauthenticated users
      cannot reach the Admin Billing screen at all) - already implemented and already covered by
      passing tests, verified against the current tree in this planning pass:
      - `src/App.tsx:15` gates `/admin/billing` behind `<ProtectedRoute allowedRoles={['admin']} />`.
      - `src/auth/ProtectedRoute.test.tsx:15-20` already asserts a resident deep-linking into
        `/admin/billing` is redirected to their own dashboard, never seeing the Billing heading.
      - `src/App.test.tsx:7-13` already asserts an unauthenticated visitor sees only the login
        screen.
      This plan does not touch `ProtectedRoute.tsx` or `App.tsx`; it only adds the direct-API-call
      half of AC5/AC6 (`server/app.test.ts` above).
    files: []
    rationale: |
      Re-implementing already-passing coverage would add churn with no behavioral change; citing
      the exact lines keeps this story's ownership of the screen-access half of AC5/AC6 traceable
      without rewriting working code or tests, mirroring how the STORY-014 plan cited existing
      `ProtectedRoute` coverage instead of duplicating it.
tests:
  - |
    AC1 (real bills list, not the empty stub) - service layer:
    ```ts
    const bills = await listBillsForMonth(db, '2026-02');
    expect(bills).toEqual([
      expect.objectContaining({ flatLabel: 'A-101', billingPeriod: '2026-02', amount: 1500, status: 'unpaid' }),
    ]);
    ```
    and UI layer:
    ```tsx
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-04' } });
    expect(await screen.findByText('B-202 — paid')).toBeInTheDocument();
    ```
  - |
    AC2 (empty state for a month with no bills) - service layer:
    ```ts
    expect(await listBillsForMonth(db, '2026-03')).toEqual([]);
    ```
    and UI layer (existing test, kept, re-wrapped in `renderWithAuth`):
    ```tsx
    mockedList.mockResolvedValue([]);
    expect(await screen.findByText('No bills found for this month.')).toBeInTheDocument();
    ```
  - |
    AC3 (only the selected month's bills) - service layer:
    ```ts
    const bills = await listBillsForMonth(db, '2026-02');
    expect(bills).toHaveLength(1);
    expect(bills[0].billingPeriod).toBe('2026-02');
    ```
    and UI layer (proves the screen requests exactly the selected month):
    ```tsx
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-05' } });
    await waitFor(() => expect(mockedList).toHaveBeenLastCalledWith('2026-05', 'admin'));
    ```
  - |
    AC4 (generic, retryable error on API/network failure):
    ```tsx
    mockedList.mockRejectedValueOnce(new Error('Unable to load bills. Please try again.'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load bills. Please try again.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('C-303 — unpaid')).toBeInTheDocument();
    ```
  - |
    AC5 (non-admin denied, screen or API) - screen half already passing
    (`src/auth/ProtectedRoute.test.tsx:15-20`); API half, new:
    ```ts
    const response = await request(app).get('/api/bills?month=2026-02').set('X-Demo-Role', 'resident');
    expect(response.status).toBe(403);
    ```
  - |
    AC6 (unauthenticated denied calling the API directly) - new:
    ```ts
    const response = await request(app).get('/api/bills?month=2026-02');
    expect(response.status).toBe(401);
    ```
assumptions_or_open_questions:
  - |
    No server-issued session/credential mechanism exists anywhere in this repo yet (confirmed via
    `src/auth/credentials.ts`, `src/auth/AuthContext.tsx`, and the STORY-012/014/009 plans, all of
    which explicitly defer this to a future session-management story). Building a real one is out
    of proportion to a single listing endpoint, so this plan's `requireRole` middleware trusts a
    client-asserted `X-Demo-Role` header - denying a missing header (401) or wrong role (403)
    before any DB access, but not cryptographically verifying the caller's identity. This is
    explicitly flagged in code comments as an interim measure matching the app's existing trust
    model (an unverified role already lives in client-side `AuthContext` today), not real security.
    Please confirm this is acceptable for this story, or say if you'd rather this story also stand
    up minimal real session tokens (larger scope, would touch `AuthContext`/`LoginScreen`/
    `credentials.ts` too).
  - |
    `flatLabel` is assumed to be `${block}-${flat_number}` (e.g. `"A-101"`), matching the exact
    fixture strings already used in `AdminBillingScreen.test.tsx` and
    `generateMonthlyBills.test.ts` before this story existed.
  - |
    This plan adds a real, runnable Node/Express server (`server/`) and a Vite dev proxy so the
    endpoint is reachable in local development via the already-reserved `ARC_DEV_PORT` env var, but
    does not address production deployment topology (process manager, reverse proxy, HTTPS,
    building/publishing the server) - no prior story has picked one, and inventing one here would
    be speculative beyond this story's ACs.
  - |
    AC4's "retryable" is implemented as a visible "Retry" button that re-invokes the same load
    function; no automatic retry/backoff is added, since the AC only requires the user be able to
    retry, not that the system retry automatically.
  - |
    The "via the screen" half of AC5/AC6 (a non-admin/unauthenticated user cannot reach the Admin
    Billing screen at all) is already implemented and covered by passing tests from a prior story
    (`ProtectedRoute` + `App.test.tsx`); this plan does not re-test or modify that, only the
    direct-API-call half.
package_dependencies:
  - name: express
    version: ^4.21.2
    ecosystem: npm
    rationale: |
      Hosts the new `GET /api/bills` route with simple query-param access and middleware chaining
      (`requireRole` before the handler) - the epic's explicit ask ("stand up the HTTP API layer")
      needs some HTTP server; Express is the most standard, minimal-boilerplate choice for one
      route plus one auth middleware, and requires no new build-time transform for the frontend.
  - name: "@types/express"
    version: ^4.17.21
    ecosystem: npm
    rationale: |
      Type definitions for `server/app.ts` and `server/auth.ts`'s `Request`/`Response`/`NextFunction`
      types; the project has no Express types today since it has never had a server.
  - name: supertest
    version: ^7.0.2
    ecosystem: npm
    rationale: |
      Lets `server/app.test.ts` issue real HTTP requests against the in-process Express app
      (`createApp(db)`) without binding a port, the standard way to test Express routes/middleware
      status codes (401/403/200) end-to-end.
  - name: "@types/supertest"
    version: ^6.0.2
    ecosystem: npm
    rationale: |
      Type definitions for `supertest`'s `request(app).get(...)` API used in `server/app.test.ts`.
  - name: tsx
    version: ^4.19.2
    ecosystem: npm
    rationale: |
      Zero-config TypeScript runner for `server/main.ts`, the long-running dev server process;
      migrations avoid this need by being plain `.cjs`, but a continuously-running Express server
      is simplest as TypeScript run directly rather than hand-maintaining a compiled `.cjs` twin.
notes: |
  ```mermaid
  flowchart TD
    ProtectedRoute[ProtectedRoute.tsx - existing, unchanged]
    Screen[AdminBillingScreen.tsx]
    Client[billingClient.ts]
    ViteProxy[vite.config.ts dev proxy /api]
    ServerApp[server/app.ts]
    AuthMw[server/auth.ts requireRole]
    Service[db_services/listBillsForMonth.ts]
    Bills[(bills table)]
    Flats[(flats table)]

    ProtectedRoute -->|already gates /admin/billing to role=admin, AC5/AC6 screen half| Screen
    Screen -->|reads role from useAuth| Screen
    Screen -->|listBillsForMonth month, role| Client
    Client -->|fetch /api/bills?month=.. header X-Demo-Role| ViteProxy
    ViteProxy --> ServerApp
    ServerApp --> AuthMw
    AuthMw -->|401 no header / 403 wrong role, AC5/AC6 API half| ServerApp
    ServerApp -->|only on allow| Service
    Service -->|join, filter by billing_period, AC1/AC2/AC3| Bills
    Service --> Flats

    classDef touched fill:#f96,color:#000
    class Screen,Client,ViteProxy,ServerApp,AuthMw,Service touched
  ```

  Why a new `server/` directory rather than putting the route inside `db/services/`: `db/` is
  purely data-access (Knex/migrations/services), already a stable, tested layer from prior stories;
  `server/` is the new HTTP-transport concern (Express app, routing, auth middleware) that consumes
  `db/services/` the same way `AdminBillingScreen` consumes `billingClient` - keeping the layers
  split mirrors the existing `db/` vs `src/` split rather than blurring data access with HTTP
  concerns.

  Why `db/services/listBillsForMonth.ts` is a new file rather than extending
  `generateMonthlyBills.ts`: they serve different operations (write-heavy bill generation vs.
  read-only listing) with no shared logic beyond "query the `bills` table" - a shared file would
  couple two independently-changing concerns for no reuse benefit.
