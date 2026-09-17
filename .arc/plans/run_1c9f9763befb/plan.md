summary: |
  Replace the static `ResidentDashboardScreen` and `ResidentPaymentsScreen` placeholders with a
  live view of the logged-in resident's own flat's bills and outstanding dues. This mirrors the
  pattern already shipped for `AdminBillingScreen` in STORY-004 (`src/screens/admin/billing/billingClient.ts`
  + `db/services/listBillsForMonth.ts` + `GET /api/bills`), but scoped by flat instead of by
  month, and shared between two screens instead of one. Because there is no real
  session/credential backend yet (`src/auth/credentials.ts` and `src/auth/AuthContext.tsx` both
  say this is deferred, and `server/auth.ts`'s `requireRole` already trusts a caller-asserted
  `X-Demo-Role` header as an explicitly-documented interim stand-in), there is currently no way to
  know which flat a logged-in resident belongs to at all. This plan extends that same interim,
  explicitly-not-a-real-security-boundary trust model one step further: the demo credential store
  gains a `flatId` per user, `AuthContext`/`login()` carries it through, and a new
  `X-Demo-Flat-Id` header (parallel to the existing `X-Demo-Role`) lets a new `GET /api/bills/mine`
  endpoint scope results to that flat. A new `useResidentBills` hook is the single data source
  consumed by both resident screens, so they always render identical live data (AC5) and share one
  loading/error/empty/ready state machine (AC2-AC4).
scope:
  - description: |
      Carry a `flatId` through the existing interim (unverified) auth model so a logged-in
      resident's own flat is knowable at all, exactly as `role` already is.

      `src/auth/AuthContext.tsx` — add `flatId` to the context value and thread it through
      `login`/`logout`:
      ```ts
      export interface AuthContextValue {
        isAuthenticated: boolean;
        role: Role | null;
        flatId: number | null;
        login: (role: Role, flatId?: number | null) => void;
        logout: () => void;
      }
      ```
      `setFlatId` is reset to `null` on `logout` alongside `role`.

      `src/auth/credentials.ts` — each demo user gets a `flatId`, and `authenticate` returns both:
      ```ts
      export interface AuthenticatedDemoUser {
        role: Role;
        flatId: number | null;
      }

      const DEMO_USERS: Array<{ username: string; password: string; role: Role; flatId: number | null }> = [
        { username: 'admin', password: 'admin123', role: 'admin', flatId: null },
        { username: 'resident', password: 'resident123', role: 'resident', flatId: 1 },
      ];

      export function authenticate(username: string, password: string): AuthenticatedDemoUser | null {
        const user = DEMO_USERS.find((u) => u.username === username && u.password === password);
        return user ? { role: user.role, flatId: user.flatId } : null;
      }
      ```

      `src/screens/LoginScreen.tsx` — `handleSubmit` changes from `const role = authenticate(...)`
      / `login(role)` to:
      ```ts
      const authResult = authenticate(username, password);
      if (!authResult) {
        logger.warn('login_failed', { username });
        setError('Invalid username or password.');
        return;
      }
      const { role, flatId } = authResult;
      logger.info('login_succeeded', { username, role });
      login(role, flatId);
      navigate(navConfigByRole[role][0].path, { replace: true });
      ```

      `src/test-utils.tsx` — `renderWithAuth` gains a `flatId` option (default `null`) and passes
      it into the constructed `AuthContext.Provider` value so every existing test that only passes
      `{ role }` keeps compiling and passing unchanged.
    files:
      - src/auth/AuthContext.tsx
      - src/auth/credentials.ts
      - src/screens/LoginScreen.tsx
      - src/test-utils.tsx
    rationale: |
      AC1/AC5 require "their flat's bills" specifically, but nothing in the codebase today
      associates a logged-in resident with a flat — only a bare `role` exists. Real
      credential/session issuance is explicitly deferred (comments in both files point to a
      future session-management story), so this reuses that same interim, client-trusted pattern
      one level deeper rather than building real session infrastructure this story does not own.
  - description: |
      Add a flat-scoped bill listing DB service, mirroring `listBillsForMonth.ts` but filtering by
      `flat_id` instead of `billing_period`, with no `flatLabel` join since the caller already
      knows their own flat.

      `db/services/listBillsForFlat.ts`:
      ```ts
      import type { Knex } from 'knex';

      export interface ResidentBillListItem {
        id: number;
        billingPeriod: string;
        amount: number;
        status: string;
      }

      export async function listBillsForFlat(db: Knex, flatId: number): Promise<ResidentBillListItem[]> {
        const rows = await db('bills')
          .where('flat_id', flatId)
          .orderBy('billing_period', 'desc')
          .select('id', 'billing_period as billingPeriod', 'amount', 'status');
        return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
      }
      ```
    files:
      - db/services/listBillsForFlat.ts
      - db/services/listBillsForFlat.test.ts
    rationale: |
      Keeps the same "one small, directly-testable Knex query function per read" convention as
      `listBillsForMonth.ts`, so the route handler stays a thin HTTP wrapper.
  - description: |
      Expose the flat-scoped bills over HTTP as `GET /api/bills/mine`, gated by
      `requireRole('resident')` (already generic over `'admin' | 'resident'`) plus a new
      `X-Demo-Flat-Id` header check, registered only behind the same
      `unverifiedRoleAuthEnabled` flag as the existing `GET /api/bills` route.

      `server/app.ts` addition inside `createApp`:
      ```ts
      app.get('/api/bills/mine', requireRole('resident'), async (req, res) => {
        const flatId = Number(req.header('x-demo-flat-id'));
        if (!Number.isInteger(flatId) || flatId <= 0) {
          res.status(400).json({ error: 'A valid flat is required.' });
          return;
        }
        try {
          const bills = await listBillsForFlat(db, flatId);
          res.json(bills);
        } catch (err) {
          console.error(`Failed to load bills for flat ${flatId}:`, err);
          res.status(500).json({ error: 'Failed to load bills.' });
        }
      });
      ```
    files:
      - server/app.ts
      - server/app.test.ts
    rationale: |
      Mirrors the existing `GET /api/bills` route's shape (role check, 400 on bad input, 500 on
      DB failure) exactly, so the two routes read the same way to a maintainer; reuses
      `requireRole` unchanged since it is already parameterized by role.
  - description: |
      Add a resident-side fetch client, mirroring `src/screens/admin/billing/billingClient.ts`'s
      `listBillsForMonth` error handling (network failure, 401/403, non-2xx all collapse to a
      user-facing retryable message).

      `src/screens/resident/billing/residentBillingClient.ts`:
      ```ts
      import type { Role } from '../../../auth/AuthContext';

      export interface Bill {
        id: number;
        billingPeriod: string;
        amount: number;
        status: 'unpaid' | 'paid';
      }

      export async function listMyBills(role: Role | null, flatId: number | null): Promise<Bill[]> {
        let response: Response;
        try {
          response = await fetch('/api/bills/mine', {
            headers: {
              ...(role ? { 'X-Demo-Role': role } : {}),
              ...(flatId != null ? { 'X-Demo-Flat-Id': String(flatId) } : {}),
            },
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
    files:
      - src/screens/resident/billing/residentBillingClient.ts
    rationale: |
      Keeps HTTP/error-mapping concerns out of the screens and the hook, matching how
      `AdminBillingScreen` never touches `fetch` directly.
  - description: |
      Add one shared hook that both resident screens call, so AC5 ("both surfaces display the
      same live bills and outstanding dues data") holds by construction rather than by
      coincidence between two separately-written screens.

      `src/screens/resident/billing/useResidentBills.ts`:
      ```ts
      import { useCallback, useEffect, useState } from 'react';
      import { useAuth } from '../../../auth/useAuth';
      import { listMyBills, type Bill } from './residentBillingClient';

      export interface ResidentBillsState {
        status: 'loading' | 'error' | 'ready';
        bills: Bill[];
        errorMessage: string | null;
        reload: () => void;
      }

      export function useResidentBills(): ResidentBillsState {
        const { role, flatId } = useAuth();
        const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
        const [bills, setBills] = useState<Bill[]>([]);
        const [errorMessage, setErrorMessage] = useState<string | null>(null);

        const load = useCallback(async () => {
          setStatus('loading');
          setErrorMessage(null);
          try {
            setBills(await listMyBills(role, flatId));
            setStatus('ready');
          } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Unable to load bills. Please try again.');
            setStatus('error');
          }
        }, [role, flatId]);

        useEffect(() => {
          load();
        }, [load]);

        return { status, bills, errorMessage, reload: load };
      }
      ```
    files:
      - src/screens/resident/billing/useResidentBills.ts
    rationale: |
      A single hook, rather than duplicated `useEffect`/`useState` in each screen, is what
      actually makes "same data on both surfaces" a structural guarantee instead of something two
      independent implementations could silently drift apart on.
  - description: |
      Wire both resident screens to `useResidentBills`, rendering the four required states:
      loading (AC4), error with retry (AC3), empty (AC2), and the live bill list plus an
      outstanding-dues total (AC1/AC5).

      `src/screens/resident/ResidentDashboardScreen.tsx` (and the near-identical
      `ResidentPaymentsScreen.tsx`, differing only in `<h1>` text):
      ```tsx
      export function ResidentDashboardScreen() {
        const { status, bills, errorMessage, reload } = useResidentBills();
        const outstandingTotal = bills
          .filter((bill) => bill.status !== 'paid')
          .reduce((sum, bill) => sum + bill.amount, 0);

        return (
          <section>
            <h1>Resident Dashboard</h1>
            {status === 'loading' && <p role="status">Loading your bills…</p>}
            {status === 'error' && (
              <div role="alert">
                <p>{errorMessage}</p>
                <button type="button" onClick={reload}>Retry</button>
              </div>
            )}
            {status === 'ready' && bills.length === 0 && <p>No bills yet for your flat.</p>}
            {status === 'ready' && bills.length > 0 && (
              <>
                <p>Outstanding dues: {outstandingTotal}</p>
                <ul>
                  {bills.map((bill) => (
                    <li key={bill.id}>{bill.billingPeriod} — {bill.amount} — {bill.status}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        );
      }
      ```
    files:
      - src/screens/resident/ResidentDashboardScreen.tsx
      - src/screens/resident/ResidentPaymentsScreen.tsx
      - src/screens/resident/ResidentDashboardScreen.test.tsx
      - src/screens/resident/ResidentPaymentsScreen.test.tsx
    rationale: |
      Matches `AdminBillingScreen`'s existing `role="status"` / `role="alert"` / plain-text-empty
      conventions (see `AdminBillingScreen.test.tsx`), so resident screens are testable and
      readable the same way admin ones already are.
tests:
  - |
    AC1 (live data, not placeholders) — at every layer:

    `db/services/listBillsForFlat.test.ts`:
    ```ts
    it('returns the bills for the requested flat (AC1)', async () => {
      await db.migrate.latest();
      const flatId = await seedFlat({ flat_number: '101', block: 'A' });
      await seedBill(flatId, { billing_period: '2026-02', amount: 1500, status: 'unpaid' });
      const bills = await listBillsForFlat(db, flatId);
      expect(bills).toEqual([
        expect.objectContaining({ billingPeriod: '2026-02', amount: 1500, status: 'unpaid' }),
      ]);
    });
    ```

    `server/app.test.ts`:
    ```ts
    it('returns only the calling resident flat bills (AC1)', async () => {
      await db.migrate.latest();
      const [flat] = await db('flats').insert({ flat_number: '101', block: 'A', is_active: true }).returning('id');
      await db('bills').insert({ flat_id: flat.id, billing_period: '2026-02', amount: 1500, due_date: '2026-02-28', status: 'unpaid' });
      const app = createApp(db, { unverifiedRoleAuthEnabled: true });
      const response = await request(app).get('/api/bills/mine').set('X-Demo-Role', 'resident').set('X-Demo-Flat-Id', String(flat.id));
      expect(response.status).toBe(200);
      expect(response.body).toEqual([expect.objectContaining({ billingPeriod: '2026-02', status: 'unpaid' })]);
    });
    ```

    `src/screens/resident/ResidentDashboardScreen.test.tsx` (and the payments equivalent):
    ```tsx
    it('shows the resident flat bills and outstanding dues from live data (AC1)', async () => {
      mockedListMyBills.mockResolvedValue([{ id: 1, billingPeriod: '2026-02', amount: 1500, status: 'unpaid' }]);
      renderWithAuth(<ResidentDashboardScreen />, { role: 'resident', flatId: 12 });
      expect(await screen.findByText('2026-02 — 1500 — unpaid')).toBeInTheDocument();
      expect(screen.getByText('Outstanding dues: 1500')).toBeInTheDocument();
      expect(mockedListMyBills).toHaveBeenCalledWith('resident', 12);
    });
    ```
  - |
    AC2 (friendly empty state, no error/blank) — screen-level:
    ```tsx
    it('shows a friendly empty state when the flat has no bills yet (AC2)', async () => {
      mockedListMyBills.mockResolvedValue([]);
      renderWithAuth(<ResidentDashboardScreen />, { role: 'resident', flatId: 12 });
      expect(await screen.findByText('No bills yet for your flat.')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    ```
    Same test (with `<ResidentPaymentsScreen />`) in `ResidentPaymentsScreen.test.tsx`.
  - |
    AC3 (clear, retryable error state) — screen-level:
    ```tsx
    it('shows a retryable error state when bills fail to load (AC3)', async () => {
      mockedListMyBills.mockRejectedValueOnce(new Error('Unable to load bills. Please try again.'));
      renderWithAuth(<ResidentDashboardScreen />, { role: 'resident', flatId: 12 });
      expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load bills. Please try again.');

      mockedListMyBills.mockResolvedValueOnce([{ id: 2, billingPeriod: '2026-03', amount: 1500, status: 'unpaid' }]);
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByText('2026-03 — 1500 — unpaid')).toBeInTheDocument();
    });
    ```
    Same test in `ResidentPaymentsScreen.test.tsx`.
  - |
    AC4 (loading state, not empty/error/stale) — screen-level:
    ```tsx
    it('shows a loading state until the bills request resolves (AC4)', async () => {
      let resolveList: (value: Bill[]) => void = () => {};
      mockedListMyBills.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
      renderWithAuth(<ResidentDashboardScreen />, { role: 'resident', flatId: 12 });
      expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      resolveList([]);
      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    });
    ```
    Same test in `ResidentPaymentsScreen.test.tsx`.
  - |
    AC5 (dashboard and payments show identical live data) — both screen test files assert
    identical rendering from the same mocked fixture, proving they share one data path:
    ```tsx
    // ResidentDashboardScreen.test.tsx
    it('renders the same bills data the payments screen would (AC5)', async () => {
      mockedListMyBills.mockResolvedValue([{ id: 3, billingPeriod: '2026-04', amount: 1800, status: 'paid' }]);
      renderWithAuth(<ResidentDashboardScreen />, { role: 'resident', flatId: 12 });
      expect(await screen.findByText('2026-04 — 1800 — paid')).toBeInTheDocument();
      expect(mockedListMyBills).toHaveBeenCalledWith('resident', 12);
    });
    ```
    ```tsx
    // ResidentPaymentsScreen.test.tsx — identical fixture and assertion, proving both screens
    // render from the same `useResidentBills`/`listMyBills` source rather than diverging copies.
    it('renders the same bills data the dashboard screen would (AC5)', async () => {
      mockedListMyBills.mockResolvedValue([{ id: 3, billingPeriod: '2026-04', amount: 1800, status: 'paid' }]);
      renderWithAuth(<ResidentPaymentsScreen />, { role: 'resident', flatId: 12 });
      expect(await screen.findByText('2026-04 — 1800 — paid')).toBeInTheDocument();
      expect(mockedListMyBills).toHaveBeenCalledWith('resident', 12);
    });
    ```
assumptions_or_open_questions:
  - |
    No story has yet wired a real login session to a specific flat (`users.flat_id` exists in the
    schema per STORY-012 but nothing in `src/` reads it). This plan extends the existing interim,
    explicitly-client-trusted demo model (`DEMO_USERS` in `src/auth/credentials.ts`,
    `X-Demo-Role` in `server/auth.ts`) one step further with a hardcoded `flatId: 1` for the demo
    resident user and a parallel `X-Demo-Flat-Id` header. This is exactly as strong (and as weak)
    a boundary as the role check it sits beside, and is expected to be superseded once a real
    session-management story lands. Please confirm this interim approach is acceptable rather
    than out of scope for this story.
  - |
    The demo resident's `flatId: 1` assumes a flat with database id `1` exists in whatever
    environment this runs against; this plan does not add seed data (no `db/seeds/` directory
    exists yet in this repo), matching how `AdminBillingScreen`'s bill generation already has no
    seeded flats to operate on either. Populating dev/demo data is assumed out of scope here.
  - |
    "Outstanding dues" is computed client-side in the plan as the sum of `amount` for every bill
    whose `status !== 'paid'` (i.e. `'unpaid'`), since the bills table's only observed statuses
    in existing code (`db/services/generateMonthlyBills.ts`) are `'unpaid'` and `'paid'`. No
    design/story text specifies a display format (currency symbol, decimals); this plan renders
    the raw number, matching `AdminBillingScreen`'s existing unformatted `{bill.status}` style.
  - |
    `GET /api/bills/mine` returns all of a flat's bills (all billing periods), not scoped to a
    single month, since "outstanding dues" implies looking across periods rather than one month
    at a time the way the admin billing screen does. Please flag if the dashboard is meant to
    show only the current period's bill instead.
package_dependencies: []
notes: |
  This mirrors the STORY-004 admin billing shape end-to-end: a Knex service
  (`listBillsForMonth.ts` → `listBillsForFlat.ts`), an Express route gated by the same
  `unverifiedRoleAuthEnabled` flag and `requireRole` middleware, and a fetch client with identical
  error-mapping. The one new piece of real design is the shared `useResidentBills` hook, which
  exists specifically so AC5 (dashboard and payments show identical data) is a structural
  guarantee rather than something to keep two screens in sync by hand.

  ```mermaid
  flowchart TD
    LoginScreen["src/screens/LoginScreen.tsx"] --> credentials["src/auth/credentials.ts\nauthenticate()"]
    LoginScreen --> AuthContext["src/auth/AuthContext.tsx\nlogin(role, flatId)"]
    ResidentDashboardScreen["src/screens/resident/ResidentDashboardScreen.tsx"] --> useResidentBills
    ResidentPaymentsScreen["src/screens/resident/ResidentPaymentsScreen.tsx"] --> useResidentBills
    useResidentBills["src/screens/resident/billing/useResidentBills.ts"] --> useAuth["src/auth/useAuth.ts"]
    useResidentBills --> residentBillingClient["src/screens/resident/billing/residentBillingClient.ts\nlistMyBills()"]
    residentBillingClient -->|"GET /api/bills/mine\nX-Demo-Role, X-Demo-Flat-Id"| serverApp["server/app.ts"]
    serverApp --> requireRole["server/auth.ts\nrequireRole('resident')"]
    serverApp --> listBillsForFlat["db/services/listBillsForFlat.ts"]
    listBillsForFlat --> billsTable[("bills table")]
    AdminBillingScreen["src/screens/admin/AdminBillingScreen.tsx\n(existing, untouched)"] -.->|"GET /api/bills\n(existing route, same file)"| serverApp

    classDef touched fill:#f96,color:#000
    class LoginScreen,credentials,AuthContext,ResidentDashboardScreen,ResidentPaymentsScreen,useResidentBills,residentBillingClient,serverApp,listBillsForFlat touched
  ```
