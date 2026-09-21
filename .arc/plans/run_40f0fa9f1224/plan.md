summary: |
  This repo has no HTTP/API layer at all today: `src/screens/admin/billing/billingClient.ts` is a
  placeholder that always throws (per its own comment, deferred because "there is no backend/API
  layer in this codebase yet"), and `src/auth/AuthContext.tsx`/`src/auth/credentials.ts` both carry
  matching comments deferring real session issuance to a future story. `db/services/generateMonthlyBills.ts`
  (STORY-009) already contains real, DB-tested bill-generation logic, but it is a Node-only module
  (`better-sqlite3` is a native addon, unreachable from the browser bundle) that nothing in `src/`
  can call directly. This story stands up the missing piece: a small Express HTTP API
  (`server/`) that wraps `generateMonthlyBills`, enforces admin-only access (AC13) via a
  `requireRole` middleware, and is proxied from the Vite dev server so the browser can reach it.
  `billingClient.ts` is rewritten to make real `fetch` calls against that API, and
  `AdminBillingScreen` is wired to pass the current user's role through. Along the way this plan
  fixes a genuine concurrency gap in `generateMonthlyBills.ts`: its current logic does a
  check-then-insert (`SELECT` then `INSERT`) which is not atomic and would either throw a raw
  constraint-violation error or admit a duplicate under a real two-admin race (AC6/AC7); this is
  replaced with a single atomic `INSERT ... ON CONFLICT (...) DO NOTHING`, which by construction
  can never create two bills for the same flat/month and never needs to distinguish "beat me to
  it" from "unknown error" after the fact.
scope:
  - description: |
      Replace the check-then-insert duplicate-prevention logic in `generateMonthlyBills` with a
      single atomic upsert-style insert, so concurrent callers can never race between "does a bill
      exist" and "insert it".

      Before:
      ```ts
      const existing = await db('bills').where({ flat_id: flat.id, billing_period: billingPeriod }).first();
      if (existing) { result.alreadyExists.push({ flatId: flat.id }); continue; }
      try {
        const [row] = await db('bills').insert({ ... }).returning('id');
        result.created.push({ flatId: flat.id, billId: row.id });
      } catch (error) { result.failed.push({ flatId: flat.id, reason: ... }); }
      ```

      After:
      ```ts
      try {
        const inserted = await db('bills')
          .insert({
            flat_id: flat.id,
            billing_period: billingPeriod,
            amount: flat.monthly_maintenance_amount,
            due_date: dueDate,
            status: 'unpaid',
          })
          .onConflict(['flat_id', 'billing_period'])
          .ignore()
          .returning('id');

        if (inserted.length > 0) {
          result.created.push({ flatId: flat.id, billId: inserted[0].id });
        } else {
          result.alreadyExists.push({ flatId: flat.id });
        }
      } catch (error) {
        result.failed.push({
          flatId: flat.id,
          reason: error instanceof Error ? error.message : 'Unknown error generating bill',
        });
      }
      ```
    files:
      - db/services/generateMonthlyBills.ts
    rationale: |
      The unique index added in STORY-009's `20260917100002_add_unique_flat_period_to_bills_table.cjs`
      migration already exists but today is only a defensive backstop that would surface as an
      uncaught/`failed` constraint-violation error under a real race, which is exactly what AC7
      says must NOT happen. `ON CONFLICT (flat_id, billing_period) DO NOTHING` makes the
      decision atomic at the database engine level: whichever of two concurrent requests wins the
      insert gets `created`, the other gets `alreadyExists` from the same statement, with no
      window where both believe they should insert. This also naturally satisfies AC8/AC9 (a flat
      with an existing bill is skipped without a second insert attempt) and keeps AC10/AC11 true
      by construction (only flats with no existing row are inserted, using the flat's amount at
      the time of that insert; existing rows are never touched).
  - description: |
      Extend the existing service test suite with the scenarios this story's ACs add on top of
      STORY-009's coverage: a true concurrent race for the same flat/month, and a
      partial-failure-then-amount-change retrigger.

      New tests in `db/services/generateMonthlyBills.test.ts`:
      ```ts
      it('creates only one bill and reports consistent already-exists results when two requests race for the same flat/month (AC6, AC7)', async () => {
        await db.migrate.latest();
        const flatId = await seedFlat();

        const [resultA, resultB] = await Promise.all([
          generateMonthlyBills(db, '2026-02'),
          generateMonthlyBills(db, '2026-02'),
        ]);

        const bills = await db('bills').where({ flat_id: flatId, billing_period: '2026-02' });
        expect(bills).toHaveLength(1);
        const createdCount = [resultA, resultB].filter((r) => r.created.some((c) => c.flatId === flatId)).length;
        const alreadyExistsCount = [resultA, resultB].filter((r) => r.alreadyExists.some((a) => a.flatId === flatId)).length;
        expect(createdCount).toBe(1);
        expect(alreadyExistsCount).toBe(1);
        expect(resultA.failed).toHaveLength(0);
        expect(resultB.failed).toHaveLength(0);
      });

      it('on retrigger, only reprocesses previously failed flats and uses their current amount, leaving prior bills untouched (AC8, AC9, AC10, AC11)', async () => {
        await db.migrate.latest();
        const stableFlat = await seedFlat({ flat_number: '101', monthly_maintenance_amount: 1500 });
        const pendingFlat = await seedFlat({ flat_number: '102', monthly_maintenance_amount: null });

        const first = await generateMonthlyBills(db, '2026-02');
        const stableBillId = first.created.find((c) => c.flatId === stableFlat)!.billId;
        expect(first.failed.map((f) => f.flatId)).toContain(pendingFlat);

        await db('flats').where({ id: stableFlat }).update({ monthly_maintenance_amount: 1700 });
        await db('flats').where({ id: pendingFlat }).update({ monthly_maintenance_amount: 2000 });

        const second = await generateMonthlyBills(db, '2026-02');

        expect(second.alreadyExists.map((a) => a.flatId)).toEqual([stableFlat]);
        expect(second.created.map((c) => c.flatId)).toEqual([pendingFlat]);

        const stableBillAfter = await db('bills').where({ id: stableBillId }).first();
        expect(Number(stableBillAfter.amount)).toBe(1500);
        const pendingBill = await db('bills').where({ flat_id: pendingFlat, billing_period: '2026-02' }).first();
        expect(Number(pendingBill.amount)).toBe(2000);
      });
      ```
    files:
      - db/services/generateMonthlyBills.test.ts
    rationale: |
      The race test does not depend on true OS-thread concurrency (better-sqlite3 is
      single-connection/serialized); its correctness comes from the atomicity of
      `ON CONFLICT DO NOTHING` itself; regardless of statement ordering, exactly one of the two
      calls will see its insert succeed and the other will see zero rows returned, so the
      assertions hold deterministically. The second test packs AC8/9/10/11 into one scenario
      because they describe the same retrigger: a flat that already has a bill must come back as
      `alreadyExists` with its original amount untouched, while a flat whose bill previously
      failed must be the only one (re)inserted, using whatever amount is current at retrigger time.
  - description: |
      Add the Express HTTP API layer the parent epic calls for: a small app factory, a billing
      router, and a role-enforcing middleware, all parameterized over a `Knex` instance so tests
      run against a disposable SQLite file exactly like `db/migrations.test.ts` already does.

      `server/middleware/requireRole.ts`:
      ```ts
      import type { NextFunction, Request, Response } from 'express';

      export type Role = 'admin' | 'resident';

      export function requireRole(allowedRoles: Role[]) {
        return (req: Request, res: Response, next: NextFunction) => {
          const role = req.header('x-user-role') as Role | undefined;
          if (!role) {
            res.status(401).json({ error: 'Authentication required.' });
            return;
          }
          if (!allowedRoles.includes(role)) {
            res.status(403).json({ error: 'You do not have permission to perform this action.' });
            return;
          }
          next();
        };
      }
      ```

      `server/routes/billing.ts` (signature):
      ```ts
      export function createBillingRouter(db: Knex): Router {
        const router = Router();
        router.post('/generate', requireRole(['admin']), async (req, res) => { /* ... */ });
        router.get('/bills', requireRole(['admin']), async (req, res) => { /* ... */ });
        return router;
      }
      ```
      `POST /generate` validates `req.body.billingPeriod` matches `/^\d{4}-\d{2}$/`, calls
      `generateMonthlyBills(db, billingPeriod)`, looks up flat labels (`` `${block}-${flat_number}` ``)
      for the `failed` entries, and responds with
      `{ billingPeriod, createdCount, alreadyExistingCount, failures: [{ flatId, flatLabel, reason }] }`.
      `GET /bills?month=YYYY-MM` joins `bills` to `flats` and returns
      `[{ id, flatLabel, billingPeriod, amount, status }]`.

      `server/app.ts`:
      ```ts
      export function createApp(db: Knex): Express {
        const app = express();
        app.use(express.json());
        app.use('/api/billing', createBillingRouter(db));
        return app;
      }
      ```

      `server/index.ts` (real runtime entrypoint, run via `tsx`):
      ```ts
      import Knex from 'knex';
      import knexConfig from '../db/knexfile.cjs';
      import { createApp } from './app';

      const db = Knex(knexConfig);
      const port = Number(process.env.ARC_DEV_PORT) || 8003;
      createApp(db).listen(port, () => {
        console.log(`Billing API listening on port ${port}`);
      });
      ```
    files:
      - server/app.ts
      - server/routes/billing.ts
      - server/middleware/requireRole.ts
      - server/index.ts
    rationale: |
      Mirrors this repo's existing `db/` convention (plain Knex-instance-parameterized modules,
      tested against a disposable file-backed SQLite DB, no mocking of the query layer) rather than
      inventing a new pattern. `requireRole` reads a client-supplied `x-user-role` header rather
      than a verified session token — see `assumptions_or_open_questions` for why, and the
      limitation this carries.
  - description: |
      Write the failing API integration test suite first, against a disposable SQLite file and a
      real (in-process, no network) Express app via `supertest`.

      `server/app.test.ts` (key cases):
      ```ts
      // @vitest-environment node
      it('returns per-flat created results for an admin (AC1)', async () => {
        const response = await request(app).post('/api/billing/generate').set('x-user-role', 'admin').send({ billingPeriod: '2026-02' });
        expect(response.status).toBe(200);
        expect(response.body.createdCount).toBe(1);
      });

      it('returns already-exists results on a repeat trigger for the same month (AC4, AC5)', async () => {
        await request(app).post('/api/billing/generate').set('x-user-role', 'admin').send({ billingPeriod: '2026-02' });
        const second = await request(app).post('/api/billing/generate').set('x-user-role', 'admin').send({ billingPeriod: '2026-02' });
        expect(second.body.alreadyExistingCount).toBe(1);
        expect(second.body.createdCount).toBe(0);
      });

      it('creates only one bill and both responses agree when two requests race (AC6, AC7)', async () => {
        const [first, second] = await Promise.all([
          request(app).post('/api/billing/generate').set('x-user-role', 'admin').send({ billingPeriod: '2026-02' }),
          request(app).post('/api/billing/generate').set('x-user-role', 'admin').send({ billingPeriod: '2026-02' }),
        ]);
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(first.body.createdCount + second.body.createdCount).toBe(1);
        expect(first.body.alreadyExistingCount + second.body.alreadyExistingCount).toBe(1);
      });

      it('denies a non-admin caller and a caller with no role header (AC13)', async () => {
        const resident = await request(app).post('/api/billing/generate').set('x-user-role', 'resident').send({ billingPeriod: '2026-02' });
        expect(resident.status).toBe(403);
        const anonymous = await request(app).post('/api/billing/generate').send({ billingPeriod: '2026-02' });
        expect(anonymous.status).toBe(401);
        expect(await db('bills')).toHaveLength(0);
      });

      it('lists bills for a month with a flat label (AC1)', async () => {
        await request(app).post('/api/billing/generate').set('x-user-role', 'admin').send({ billingPeriod: '2026-02' });
        const response = await request(app).get('/api/billing/bills?month=2026-02').set('x-user-role', 'admin');
        expect(response.body).toEqual([expect.objectContaining({ flatLabel: 'A-101', status: 'unpaid' })]);
      });
      ```
    files:
      - server/app.test.ts
    rationale: |
      One `createApp(db)` per test built from a fresh, migrated, disposable SQLite file (same
      `fs.mkdtempSync` harness as `db/migrations.test.ts` / `db/services/generateMonthlyBills.test.ts`),
      exercised with `supertest` rather than starting a real network listener, so these tests are
      fast and hermetic. This is the only place AC13's API-level denial is newly tested; AC13's
      screen-level half ("via the screen") is already covered by `src/auth/ProtectedRoute.test.tsx`,
      which asserts a resident hitting `/admin/billing` never sees the Billing screen at all.
  - description: |
      Rewrite `billingClient.ts` to make real `fetch` calls to the new API instead of always
      throwing, normalizing any failure (bad response or network error) to one generic, retryable
      message rather than leaking raw fetch/HTTP details to the UI.

      ```ts
      import type { Role } from '../../../auth/AuthContext';

      const GENERIC_ERROR_MESSAGE = 'Something went wrong generating bills. Please try again.';

      export async function generateMonthlyBills(billingPeriod: string, role: Role): Promise<BillGenerationSummary> {
        let response: Response;
        try {
          response = await fetch('/api/billing/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-role': role },
            body: JSON.stringify({ billingPeriod }),
          });
        } catch {
          throw new Error(GENERIC_ERROR_MESSAGE);
        }
        if (!response.ok) throw new Error(GENERIC_ERROR_MESSAGE);
        return response.json();
      }

      export async function listBillsForMonth(billingPeriod: string, role: Role): Promise<Bill[]> {
        let response: Response;
        try {
          response = await fetch(`/api/billing/bills?month=${encodeURIComponent(billingPeriod)}`, {
            headers: { 'x-user-role': role },
          });
        } catch {
          throw new Error(GENERIC_ERROR_MESSAGE);
        }
        if (!response.ok) throw new Error(GENERIC_ERROR_MESSAGE);
        return response.json();
      }
      ```
    files:
      - src/screens/admin/billing/billingClient.ts
    rationale: |
      Satisfies AC12 directly: whatever the underlying cause (network failure, 401/403, 500), the
      client always throws the same generic, retryable-sounding message, and `AdminBillingScreen`'s
      existing `catch` block (unchanged) surfaces it via the existing `role="alert"` element rather
      than an unstyled crash. `role` is a required parameter (not read from a hook) since this is a
      plain module, not a component; the screen supplies it from `useAuth()`.
  - description: |
      Add a dedicated unit test for the rewritten `billingClient.ts`, mocking `global.fetch`
      directly (this module has no test file today; it was previously only exercised indirectly via
      `AdminBillingScreen.test.tsx`'s `vi.mock('./billing/billingClient')`).

      ```ts
      it('throws the same generic, retryable error on a failed response and on a network error (AC12)', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
        await expect(generateMonthlyBills('2026-02', 'admin')).rejects.toThrow(
          'Something went wrong generating bills. Please try again.',
        );
        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await expect(generateMonthlyBills('2026-02', 'admin')).rejects.toThrow(
          'Something went wrong generating bills. Please try again.',
        );
      });
      ```
    files:
      - src/screens/admin/billing/billingClient.test.ts
    rationale: |
      Isolates the fetch/error-normalization contract from the screen's rendering behavior, and is
      the only place AC12's "network failure" half is exercised directly (the screen-level test
      exercises AC12 via a mocked rejection, not a real `fetch` failure).
  - description: |
      Wire `AdminBillingScreen` to pass the authenticated admin's role into the now-real
      `billingClient` calls.

      ```tsx
      const { role } = useAuth();
      // ...
      useEffect(() => {
        if (!month || !role) return;
        listBillsForMonth(month, role).then(setBills);
      }, [month, role]);

      async function handleGenerate() {
        if (!role) return;
        setIsGenerating(true);
        setErrorMessage(null);
        try {
          const result = await generateMonthlyBills(month, role);
          setSummary(result);
          setBills(await listBillsForMonth(month, role));
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : 'Bill generation failed.');
        } finally {
          setIsGenerating(false);
        }
      }
      ```
    files:
      - src/screens/admin/AdminBillingScreen.tsx
    rationale: |
      Minimal change: the loading state (AC2), disabled trigger (AC3), already-exists notice
      (part of AC1/AC4), and failure report (part of AC1) are all pre-existing and untouched;
      this only threads `role` through to the two client calls and keeps the existing
      catch-and-display error handling that AC12 depends on.
  - description: |
      Update `AdminBillingScreen.test.tsx` to render through the `renderWithAuth` helper (with
      `role: 'admin'`) instead of bare `render`, since the screen now calls `useAuth()` and would
      otherwise throw "must be used within an AuthProvider"; also update the outright-failure test's
      expected text to the new generic message.

      ```tsx
      // before
      render(<AdminBillingScreen />);
      // after
      renderWithAuth(<AdminBillingScreen />, { role: 'admin' });

      // before
      mockedGenerate.mockRejectedValue(new Error('No backend available to generate bills yet.'));
      expect(await screen.findByRole('alert')).toHaveTextContent('No backend available to generate bills yet.');
      // after
      mockedGenerate.mockRejectedValue(new Error('Something went wrong generating bills. Please try again.'));
      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong generating bills. Please try again.');
      ```
    files:
      - src/screens/admin/AdminBillingScreen.test.tsx
    rationale: |
      Every existing test in this file renders `<AdminBillingScreen />` directly; all of them need
      the `AuthProvider` context now that the component reads `role`. This is a mechanical update to
      an existing file, not new test coverage, except for the literal-text change needed because the
      stub's old error message no longer exists.
  - description: |
      Wire the Vite dev server to proxy `/api` to the new Express server, and add the npm script to
      run that server, using the `ARC_DEV_PORT` / `ARC_WEB_PORT` values already present in this
      worktree's `.env`.

      `vite.config.ts`:
      ```ts
      export default defineConfig(({ mode }) => {
        const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
        const apiPort = Number(env.ARC_DEV_PORT) || 8003;
        return {
          plugins: [react()],
          server: {
            port: Number(env.ARC_WEB_PORT) || 5173,
            proxy: { '/api': `http://localhost:${apiPort}` },
          },
          test: { environment: 'jsdom', globals: true, setupFiles: ['./src/vitest.setup.ts'] },
        };
      });
      ```

      `package.json` scripts:
      ```json
      "dev:server": "tsx server/index.ts"
      ```
    files:
      - vite.config.ts
      - package.json
    rationale: |
      `.env` already defines `ARC_DEV_PORT=8003` and `ARC_WEB_PORT=3003`, unused by any code in
      this tree today; reading them here is the natural place they get consumed once a real backend
      exists. The dev server and the API server remain two separate processes (`npm run dev` and
      `npm run dev:server`) since no process manager/dependency for running them together
      (`concurrently`) is otherwise needed by this story.
tests:
  - |
    AC1 — real per-flat created/already-exists/failed results from the backend, both at the API
    layer and reflected in the screen:
    ```ts
    const response = await request(app).post('/api/billing/generate').set('x-user-role', 'admin').send({ billingPeriod: '2026-02' });
    expect(response.body.createdCount).toBe(1);
    ```
  - |
    AC2 — loading indicator shown during generation (pre-existing behavior, re-verified after
    wiring through `renderWithAuth`):
    ```tsx
    await user.click(screen.getByRole('button', { name: 'Generate bills' }));
    expect(screen.getByRole('status')).toHaveTextContent(/generating/i);
    ```
  - |
    AC3 — trigger button disabled during generation (pre-existing behavior, re-verified):
    ```tsx
    await user.click(button);
    expect(button).toBeDisabled();
    ```
  - |
    AC4/AC5 — a retrigger for an already-generated month returns already-exists results and creates
    no duplicate:
    ```ts
    await generateMonthlyBills(db, '2026-02');
    const secondRun = await generateMonthlyBills(db, '2026-02');
    expect(secondRun.alreadyExists.map((f) => f.flatId)).toContain(flatId);
    expect(await db('bills').where({ flat_id: flatId, billing_period: '2026-02' })).toHaveLength(1);
    ```
  - |
    AC6 — only one set of bills is created when two admins race for the same month:
    ```ts
    const [resultA, resultB] = await Promise.all([generateMonthlyBills(db, '2026-02'), generateMonthlyBills(db, '2026-02')]);
    expect(await db('bills').where({ flat_id: flatId, billing_period: '2026-02' })).toHaveLength(1);
    ```
  - |
    AC7 — the losing concurrent request gets already-exists results, not an error:
    ```ts
    const createdCount = [resultA, resultB].filter((r) => r.created.some((c) => c.flatId === flatId)).length;
    const alreadyExistsCount = [resultA, resultB].filter((r) => r.alreadyExists.some((a) => a.flatId === flatId)).length;
    expect(createdCount).toBe(1);
    expect(alreadyExistsCount).toBe(1);
    expect(resultA.failed).toHaveLength(0);
    ```
  - |
    AC8 — retriggering a partially-failed month returns already-created bills as already-exists:
    ```ts
    expect(second.alreadyExists.map((a) => a.flatId)).toEqual([stableFlat]);
    ```
  - |
    AC9 — only the previously failed flats are (re)processed:
    ```ts
    expect(second.created.map((c) => c.flatId)).toEqual([pendingFlat]);
    ```
  - |
    AC10 — newly created bills use a flat's updated amount:
    ```ts
    const pendingBill = await db('bills').where({ flat_id: pendingFlat, billing_period: '2026-02' }).first();
    expect(Number(pendingBill.amount)).toBe(2000);
    ```
  - |
    AC11 — already-generated bills for that month remain unchanged despite a later amount change:
    ```ts
    const stableBillAfter = await db('bills').where({ id: stableBillId }).first();
    expect(Number(stableBillAfter.amount)).toBe(1500);
    ```
  - |
    AC12 — an API/network failure surfaces a generic, retryable error rather than a silent failure
    or unstyled crash:
    ```ts
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(generateMonthlyBills('2026-02', 'admin')).rejects.toThrow(
      'Something went wrong generating bills. Please try again.',
    );
    ```
  - |
    AC13 — a non-admin is denied via the API (and, already covered by existing
    `src/auth/ProtectedRoute.test.tsx`, via the screen):
    ```ts
    const resident = await request(app).post('/api/billing/generate').set('x-user-role', 'resident').send({ billingPeriod: '2026-02' });
    expect(resident.status).toBe(403);
    const anonymous = await request(app).post('/api/billing/generate').send({ billingPeriod: '2026-02' });
    expect(anonymous.status).toBe(401);
    ```
assumptions_or_open_questions:
  - |
    Biggest open question: there is no real session/authentication mechanism anywhere in this repo
    (`AuthContext.tsx` holds role in unauthenticated client state; `credentials.ts` is a hardcoded
    demo list; both comment that real session issuance is a future story's job). To satisfy AC13 at
    the API layer without that infrastructure, this plan has the server trust a client-supplied
    `x-user-role` header. This mirrors the trust boundary the app already has client-side, and
    correctly makes the server actively deny a mismatched/missing role rather than relying on
    UI-only enforcement — but it is NOT a secure mechanism (a malicious client can forge the
    header). Please confirm this is acceptable scope for this story, or say if a minimal real
    identity check (e.g., a signed cookie/token issued at login) should be pulled into this story
    instead of deferred further.
  - |
    `db('bills').insert(...).onConflict(['flat_id','billing_period']).ignore().returning('id')` is
    assumed to compile correctly for the `better-sqlite3` Knex client (SQLite's
    `INSERT ... ON CONFLICT (...) DO NOTHING ... RETURNING` requires SQLite 3.24+, which
    better-sqlite3 bundles well past). This should be spiked/verified against the actual installed
    `knex`/`better-sqlite3` versions during implementation; if the combination isn't supported, the
    fallback is to catch the specific unique-constraint error (`error.message` containing `UNIQUE
    constraint failed`) and treat it as `alreadyExists`, which is less clean but equivalent.
  - |
    `GET /api/billing/bills` is guarded by the same `requireRole(['admin'])` middleware as the
    trigger endpoint, even though AC13 only names the generation trigger explicitly — this is
    treated as obvious defense-in-depth for an admin-only screen's data endpoint, not scope creep.
  - |
    The dev server and the new Express API are run as two separate processes
    (`npm run dev` / `npm run dev:server`); no process-manager dependency (e.g. `concurrently`) is
    added since nothing in the ACs requires a single-command dev experience.
  - |
    `ARC_DEV_PORT` / `ARC_WEB_PORT` in this worktree's `.env` are not referenced by any existing
    code; this plan infers they are pre-provisioned for exactly this kind of API-server story and
    wires them in as the Express server port and Vite dev server port respectively. Please confirm
    that inference, since it isn't stated in the story or ACs.
  - |
    The generic error message text (`"Something went wrong generating bills. Please try again."`)
    is a placeholder wording choice for AC12 — happy to change it to match any existing UX copy
    convention if the reviewer has one in mind.
package_dependencies:
  - name: express
    version: ^4.19.2
    ecosystem: npm
    rationale: |
      Runtime HTTP framework for the new `server/` API layer (`app.ts`, `routes/billing.ts`,
      `middleware/requireRole.ts`) — nothing in this repo provides an HTTP server today.
  - name: "@types/express"
    version: ^4.17.21
    ecosystem: npm
    rationale: |
      Express 4 ships without bundled TypeScript types; needed for `server/*.ts` to type-check
      request/response/middleware signatures.
  - name: supertest
    version: ^7.0.0
    ecosystem: npm
    rationale: |
      In-process HTTP assertions against the Express app (`server/app.test.ts`) for AC1/AC4/AC5/
      AC6/AC7/AC13, without binding a real network port; ships its own TypeScript types.
  - name: tsx
    version: ^4.19.1
    ecosystem: npm
    rationale: |
      Zero-config TypeScript execution for `server/index.ts` as a real, runnable dev process
      (`npm run dev:server`), consistent with authoring the server in TypeScript like the rest of
      the app rather than dropping to plain `.cjs` the way migrations do.
notes: |
  ```mermaid
  flowchart TD
    Screen[AdminBillingScreen.tsx]
    UseAuth[useAuth / AuthContext]
    Client[billingClient.ts]
    Proxy[/Vite dev proxy: /api -> ARC_DEV_PORT/]
    App[server/app.ts]
    Router[server/routes/billing.ts]
    Guard[server/middleware/requireRole.ts]
    Service[db/services/generateMonthlyBills.ts]
    Flats[(flats table)]
    Bills[(bills table)]
    ProtectedRoute[auth/ProtectedRoute.tsx - already gates /admin/billing]

    ProtectedRoute -->|admin-only route, unchanged| Screen
    UseAuth -->|role| Screen
    Screen -->|generateMonthlyBills/listBillsForMonth + role| Client
    Client -->|fetch POST /api/billing/generate, GET /api/billing/bills| Proxy
    Proxy --> App
    App --> Router
    Router -->|x-user-role header check, AC13| Guard
    Guard -->|401/403 on deny, else next| Router
    Router -->|calls with validated billingPeriod| Service
    Service -->|reads active flats| Flats
    Service -->|atomic INSERT ON CONFLICT DO NOTHING| Bills
    Router -->|joins for flatLabel| Flats

    classDef touched fill:#f96,color:#000
    class Screen,Client,App,Router,Guard,Service touched
  ```

  Why Express over a Vite dev-server middleware plugin: the parent epic frames this as "stand up
  the HTTP API layer" (singular, reusable), and explicitly says a second screen
  (Admin Maintenance) will also be wired to it later — a standalone, independently runnable and
  testable server is a better foundation for that than dev-only Vite middleware, which has no
  equivalent in a production build.

  Why the atomic `ON CONFLICT DO NOTHING` rewrite rather than adding a second
  try/catch branch around the old check-then-insert: the old code's race window is between the
  `SELECT` and the `INSERT`, which no amount of catching after the fact fully closes without also
  changing the insert itself — the unique constraint would already exist as a defensive backstop,
  but hitting it today falls into the `failed` bucket (a raw constraint-violation reason string),
  not `alreadyExists`, which is precisely what AC7 forbids.
