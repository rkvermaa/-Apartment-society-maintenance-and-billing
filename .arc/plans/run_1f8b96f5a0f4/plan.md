summary: |
  This story adds Admin-triggered monthly maintenance bill generation on top of the schema laid
  down in STORY-012. Two gaps block this story as written: (1) the `flats` table (created by
  STORY-012's migrations) has no `is_active` flag or per-flat maintenance amount column, both of
  which AC1/AC10/AC12 require, so this plan adds them via a new migration; and (2) this repo is
  currently a browser-only SPA with a Node-only migration toolchain and no HTTP/API layer at all
  (confirmed by reading `src/auth/credentials.ts` and `src/auth/AuthContext.tsx`, which both defer
  real backend wiring to STORY-013). Bill generation is inherently a server-side, DB-transactional
  operation, so this plan implements the real generation/duplicate-prevention/partial-failure logic
  as a Node-testable service module (`db/services/generateMonthlyBills.ts`), exercised against a
  real disposable SQLite file exactly like `db/migrations.test.ts` already does (no mocks at that
  layer). The Admin-facing screen (`AdminBillingScreen.tsx`) is wired to a thin, currently-stubbed
  `billingClient.ts` module — mirroring the existing `credentials.ts` placeholder-with-a-comment
  pattern — since there is no API for the browser bundle to call yet; UI behavior (loading state,
  disabled trigger, failure report, unpaid-status bill list, empty state) is tested against that
  client with the module mocked, the same way `LoginScreen` is tested today.
scope:
  - description: |
      Add the two `flats` columns this story's ACs depend on but that STORY-012's migration did
      not create.

      `db/migrations/20260917100001_add_billing_fields_to_flats_table.cjs`:
      ```js
      exports.up = function up(knex) {
        return knex.schema.alterTable('flats', (table) => {
          table.boolean('is_active').notNullable().defaultTo(true);
          table.decimal('monthly_maintenance_amount', 10, 2).nullable();
        });
      };

      exports.down = function down(knex) {
        return knex.schema.alterTable('flats', (table) => {
          table.dropColumn('is_active');
          table.dropColumn('monthly_maintenance_amount');
        });
      };
      ```
    files:
      - db/migrations/20260917100001_add_billing_fields_to_flats_table.cjs
    rationale: |
      AC1 needs "that flat's configured monthly maintenance amount"; AC10/AC12 need an
      active/inactive flag to filter on. Neither column exists in the merged STORY-012 schema
      (`db/migrations/20260914090002_create_flats_table.cjs` only has `id`, `flat_number`, `block`,
      `created_at`). `monthly_maintenance_amount` is nullable at the DB level (even though real
      usage always sets it) so a test can seed a data-integrity gap and force a genuine per-flat DB
      failure for AC4/5/6, rather than mocking a failure.
  - description: |
      Add a defensive uniqueness constraint on `bills` so "one bill per flat per month" is also
      enforced at the schema level, not just by the service's check-then-insert logic.

      `db/migrations/20260917100002_add_unique_flat_period_to_bills_table.cjs`:
      ```js
      exports.up = function up(knex) {
        return knex.schema.alterTable('bills', (table) => {
          table.unique(['flat_id', 'billing_period']);
        });
      };

      exports.down = function down(knex) {
        return knex.schema.alterTable('bills', (table) => {
          table.dropUnique(['flat_id', 'billing_period']);
        });
      };
      ```
    files:
      - db/migrations/20260917100002_add_unique_flat_period_to_bills_table.cjs
    rationale: |
      Belt-and-braces for AC2: even if the service's existence check is ever bypassed (e.g. future
      concurrent trigger), the DB itself refuses a second `(flat_id, billing_period)` row.
  - description: |
      Update the existing migration-history assertion so it stays correct once this story's two
      new migrations are added — otherwise this pre-existing test breaks for reasons unrelated to
      its own AC.

      `db/migrations.test.ts`, inside `'records applied migrations with identifier and order (AC5)'`:
      ```ts
      // before
      expect(history).toHaveLength(5);
      // after
      expect(history).toHaveLength(7);
      ```
    files:
      - db/migrations.test.ts
    rationale: |
      That test hard-codes the total migration count for STORY-012's own AC5 ("applied migrations
      recorded"); it is not testing anything about this story, but it will fail the moment this
      story's two new migration files exist unless the literal is updated. All other assertions in
      that file use `expect.arrayContaining(...)` for columns, so they remain valid unmodified.
  - description: |
      Implement the real bill-generation logic as a plain async function over a `Knex` instance:
      fetch active flats, skip flats that already have a bill for the period, insert the rest one
      at a time so one flat's failure cannot affect another's, and collect a structured result.

      `db/services/generateMonthlyBills.ts`:
      ```ts
      import type { Knex } from 'knex';

      export interface BillGenerationResult {
        billingPeriod: string;
        created: Array<{ flatId: number; billId: number }>;
        alreadyExists: Array<{ flatId: number }>;
        failed: Array<{ flatId: number; reason: string }>;
      }

      function lastDayOfMonth(billingPeriod: string): string {
        const [year, month] = billingPeriod.split('-').map(Number);
        const firstOfNextMonth = new Date(Date.UTC(year, month, 1));
        firstOfNextMonth.setUTCDate(firstOfNextMonth.getUTCDate() - 1);
        return firstOfNextMonth.toISOString().slice(0, 10);
      }

      export async function generateMonthlyBills(
        db: Knex,
        billingPeriod: string,
      ): Promise<BillGenerationResult> {
        const activeFlats = await db('flats')
          .where({ is_active: true })
          .select<{ id: number; monthly_maintenance_amount: number | null }[]>(
            'id',
            'monthly_maintenance_amount',
          );

        const result: BillGenerationResult = { billingPeriod, created: [], alreadyExists: [], failed: [] };
        const dueDate = lastDayOfMonth(billingPeriod);

        for (const flat of activeFlats) {
          const existing = await db('bills')
            .where({ flat_id: flat.id, billing_period: billingPeriod })
            .first();
          if (existing) {
            result.alreadyExists.push({ flatId: flat.id });
            continue;
          }

          try {
            const [row] = await db('bills')
              .insert({
                flat_id: flat.id,
                billing_period: billingPeriod,
                amount: flat.monthly_maintenance_amount,
                due_date: dueDate,
                status: 'unpaid',
              })
              .returning('id');
            result.created.push({ flatId: flat.id, billId: row.id });
          } catch (error) {
            result.failed.push({
              flatId: flat.id,
              reason: error instanceof Error ? error.message : 'Unknown error generating bill',
            });
          }
        }

        return result;
      }
      ```
    files:
      - db/services/generateMonthlyBills.ts
    rationale: |
      Per-flat try/catch inside a plain loop (no wrapping transaction across flats) is what makes
      AC4 true by construction: an exception on one insert only appends to `failed` and moves on,
      it cannot undo a prior `INSERT` that already committed. Setting `status: 'unpaid'` explicitly
      on insert (rather than relying on the `bills` table's existing `defaultTo('pending')`)
      satisfies AC9's literal wording — see `assumptions_or_open_questions` for the status-value
      conflict this surfaces with STORY-012's schema.
  - description: |
      Write the failing service-level test suite first, against a disposable per-test SQLite file,
      following the exact harness pattern already used in `db/migrations.test.ts`.

      `db/services/generateMonthlyBills.test.ts`:
      ```ts
      // @vitest-environment node
      import Knex, { type Knex as KnexType } from 'knex';
      import fs from 'node:fs';
      import os from 'node:os';
      import path from 'node:path';
      import { afterEach, beforeEach, describe, expect, it } from 'vitest';
      import { generateMonthlyBills } from './generateMonthlyBills';

      let db: KnexType;
      let tmpDir: string;

      beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-billing-'));
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

      async function seedFlat(overrides: Partial<{
        flat_number: string;
        block: string;
        is_active: boolean;
        monthly_maintenance_amount: number | null;
      }> = {}): Promise<number> {
        const [flat] = await db('flats')
          .insert({
            flat_number: '101',
            block: 'A',
            is_active: true,
            monthly_maintenance_amount: 1500,
            ...overrides,
          })
          .returning('id');
        return flat.id as number;
      }

      describe('generateMonthlyBills', () => {
        it('creates exactly one bill per active flat using its configured amount (AC1)', async () => {
          await db.migrate.latest();
          const flatA = await seedFlat({ flat_number: '101', monthly_maintenance_amount: 1500 });
          const flatB = await seedFlat({ flat_number: '102', monthly_maintenance_amount: 2000 });

          const result = await generateMonthlyBills(db, '2026-02');

          expect(result.created.map((c) => c.flatId).sort()).toEqual([flatA, flatB].sort());
          const bills = await db('bills').select('flat_id', 'amount').where({ billing_period: '2026-02' });
          expect(bills).toHaveLength(2);
          expect(Number(bills.find((b) => b.flat_id === flatA)?.amount)).toBe(1500);
          expect(Number(bills.find((b) => b.flat_id === flatB)?.amount)).toBe(2000);
        });

        it('does not create a duplicate bill on a second run for the same flat/month (AC2)', async () => {
          await db.migrate.latest();
          const flatId = await seedFlat();
          await generateMonthlyBills(db, '2026-02');

          await generateMonthlyBills(db, '2026-02');

          const bills = await db('bills').where({ flat_id: flatId, billing_period: '2026-02' });
          expect(bills).toHaveLength(1);
        });

        it('does not roll back bills already created when another flat fails (AC4)', async () => {
          await db.migrate.latest();
          const goodFlat = await seedFlat({ flat_number: '101' });
          const brokenFlat = await seedFlat({ flat_number: '102', monthly_maintenance_amount: null });

          const result = await generateMonthlyBills(db, '2026-02');

          const goodBill = await db('bills').where({ flat_id: goodFlat, billing_period: '2026-02' }).first();
          expect(goodBill).toBeDefined();
          expect(result.failed.map((f) => f.flatId)).toContain(brokenFlat);
        });

        it('does not create a bill for a deactivated flat (AC10)', async () => {
          await db.migrate.latest();
          const inactiveFlat = await seedFlat({ is_active: false });

          await generateMonthlyBills(db, '2026-02');

          expect(await db('bills').where({ flat_id: inactiveFlat })).toHaveLength(0);
        });

        it('creates no bills when there are no active flats (AC12)', async () => {
          await db.migrate.latest();
          await seedFlat({ is_active: false });

          const result = await generateMonthlyBills(db, '2026-02');

          expect(result.created).toHaveLength(0);
          expect(await db('bills')).toHaveLength(0);
        });
      });
      ```
    files:
      - db/services/generateMonthlyBills.test.ts
    rationale: |
      Mirrors the existing repo convention of testing DB behavior against a real disposable SQLite
      file rather than mocking Knex. The AC4 test forces a genuine `NOT NULL constraint failed`
      error (via a flat seeded with `monthly_maintenance_amount: null`, bypassing normal app-level
      validation) instead of stubbing a throw, so the "no rollback" guarantee is proven against a
      real insert failure, not a simulated one.
  - description: |
      Add a placeholder billing client the screen depends on, mirroring the existing
      `src/auth/credentials.ts` deferred-backend pattern (no HTTP/API layer exists in this repo
      yet, and `better-sqlite3`/Knex cannot run in the browser bundle).

      `src/screens/admin/billing/billingClient.ts`:
      ```ts
      export interface FlatBillFailure {
        flatId: number;
        flatLabel: string;
        reason: string;
      }

      export interface BillGenerationSummary {
        billingPeriod: string;
        createdCount: number;
        alreadyExistingCount: number;
        failures: FlatBillFailure[];
      }

      export interface Bill {
        id: number;
        flatLabel: string;
        billingPeriod: string;
        amount: number;
        status: 'unpaid' | 'paid';
      }

      // Placeholder billing client for the admin billing screen. There is no backend/API layer in
      // this codebase yet (see src/auth/credentials.ts for the same deferral); once one exists,
      // these must call it directly, backed by db/services/generateMonthlyBills.ts.
      export async function generateMonthlyBills(billingPeriod: string): Promise<BillGenerationSummary> {
        throw new Error(`No backend available to generate bills for ${billingPeriod} yet.`);
      }

      export async function listBillsForMonth(_billingPeriod: string): Promise<Bill[]> {
        return [];
      }
      ```
    files:
      - src/screens/admin/billing/billingClient.ts
    rationale: |
      Gives `AdminBillingScreen` a stable import to call and to mock in tests, without pretending a
      backend connection exists. Kept as two named functions (not a class) to match the existing
      `authenticate()` free-function style in `credentials.ts`.
  - description: |
      Implement the Admin billing screen: a month picker, a generate-bills trigger with loading/
      disabled state, a failure report with per-flat reasons, an "already exists" notice, and a
      bill list for the selected month with an empty-state message.

      `src/screens/admin/AdminBillingScreen.tsx`:
      ```tsx
      import { useEffect, useState } from 'react';
      import {
        generateMonthlyBills,
        listBillsForMonth,
        type Bill,
        type BillGenerationSummary,
      } from './billing/billingClient';

      function currentMonth(): string {
        return new Date().toISOString().slice(0, 7);
      }

      export function AdminBillingScreen() {
        const [month, setMonth] = useState(currentMonth);
        const [isGenerating, setIsGenerating] = useState(false);
        const [summary, setSummary] = useState<BillGenerationSummary | null>(null);
        const [bills, setBills] = useState<Bill[]>([]);

        useEffect(() => {
          if (!month) return;
          listBillsForMonth(month).then(setBills);
        }, [month]);

        async function handleGenerate() {
          setIsGenerating(true);
          try {
            const result = await generateMonthlyBills(month);
            setSummary(result);
            setBills(await listBillsForMonth(month));
          } finally {
            setIsGenerating(false);
          }
        }

        return (
          <section>
            <h1>Billing</h1>
            <label htmlFor="billing-month">Month</label>
            <input
              id="billing-month"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
            <button type="button" onClick={handleGenerate} disabled={isGenerating || !month}>
              Generate bills
            </button>
            {isGenerating && <p role="status">Generating bills…</p>}
            {summary && summary.alreadyExistingCount > 0 && (
              <p>{summary.alreadyExistingCount} flat(s) already had a bill generated for this month.</p>
            )}
            {summary && summary.failures.length > 0 && (
              <div role="alert" aria-label="Bill generation failures">
                <h2>Some bills failed to generate</h2>
                <ul>
                  {summary.failures.map((failure) => (
                    <li key={failure.flatId}>
                      {failure.flatLabel}: {failure.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <h2>Bills for {month}</h2>
            {bills.length === 0 ? (
              <p>No bills found for this month.</p>
            ) : (
              <ul>
                {bills.map((bill) => (
                  <li key={bill.id}>
                    {bill.flatLabel} — {bill.status}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      }
      ```
    files:
      - src/screens/admin/AdminBillingScreen.tsx
    rationale: |
      One component, driven entirely by `billingClient`'s two functions, keeps the screen trivially
      testable by mocking that module (same approach `LoginScreen` uses for `credentials.ts`).
      `role="status"` / `disabled` / `role="alert"` are used instead of custom test ids so tests
      read like accessibility assertions, consistent with `LoginScreen.test.tsx`'s use of
      `getByRole('alert')`.
  - description: |
      Write the failing UI test suite first, mocking `billingClient` to control generation timing,
      successes, already-existing flats, and failures.

      `src/screens/admin/AdminBillingScreen.test.tsx`:
      ```tsx
      import { beforeEach, describe, expect, it, vi } from 'vitest';
      import { fireEvent, render, screen, waitFor } from '@testing-library/react';
      import userEvent from '@testing-library/user-event';
      import { AdminBillingScreen } from './AdminBillingScreen';
      import * as billingClient from './billing/billingClient';

      vi.mock('./billing/billingClient');

      const mockedGenerate = vi.mocked(billingClient.generateMonthlyBills);
      const mockedList = vi.mocked(billingClient.listBillsForMonth);

      beforeEach(() => {
        mockedGenerate.mockReset();
        mockedList.mockReset();
        mockedList.mockResolvedValue([]);
      });

      describe('AdminBillingScreen', () => {
        it('informs the admin a bill already exists for a flat (AC3)', async () => {
          const user = userEvent.setup();
          mockedGenerate.mockResolvedValue({
            billingPeriod: '2026-02',
            createdCount: 0,
            alreadyExistingCount: 1,
            failures: [],
          });
          render(<AdminBillingScreen />);
          fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-02' } });

          await user.click(screen.getByRole('button', { name: 'Generate bills' }));

          expect(await screen.findByText(/already had a bill generated/i)).toBeInTheDocument();
        });

        it('shows a report listing which flats failed, with a reason per flat (AC5, AC6)', async () => {
          const user = userEvent.setup();
          mockedGenerate.mockResolvedValue({
            billingPeriod: '2026-02',
            createdCount: 0,
            alreadyExistingCount: 0,
            failures: [{ flatId: 7, flatLabel: 'A-101', reason: 'amount missing' }],
          });
          render(<AdminBillingScreen />);
          fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-02' } });

          await user.click(screen.getByRole('button', { name: 'Generate bills' }));

          expect(await screen.findByText('A-101: amount missing')).toBeInTheDocument();
        });

        it('shows a loading indicator while generation is in progress (AC7)', async () => {
          const user = userEvent.setup();
          let resolveGenerate: (value: billingClient.BillGenerationSummary) => void = () => {};
          mockedGenerate.mockReturnValue(
            new Promise((resolve) => {
              resolveGenerate = resolve;
            }),
          );
          render(<AdminBillingScreen />);
          fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-02' } });

          await user.click(screen.getByRole('button', { name: 'Generate bills' }));
          expect(screen.getByRole('status')).toHaveTextContent(/generating/i);

          resolveGenerate({ billingPeriod: '2026-02', createdCount: 1, alreadyExistingCount: 0, failures: [] });
          await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
        });

        it('disables the trigger action while generation is in progress (AC8)', async () => {
          const user = userEvent.setup();
          let resolveGenerate: (value: billingClient.BillGenerationSummary) => void = () => {};
          mockedGenerate.mockReturnValue(
            new Promise((resolve) => {
              resolveGenerate = resolve;
            }),
          );
          render(<AdminBillingScreen />);
          fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-02' } });
          const button = screen.getByRole('button', { name: 'Generate bills' });

          await user.click(button);
          expect(button).toBeDisabled();

          resolveGenerate({ billingPeriod: '2026-02', createdCount: 1, alreadyExistingCount: 0, failures: [] });
          await waitFor(() => expect(button).not.toBeDisabled());
        });

        it('shows newly generated bills with an unpaid status in the month list (AC9)', async () => {
          const user = userEvent.setup();
          mockedGenerate.mockResolvedValue({
            billingPeriod: '2026-02',
            createdCount: 1,
            alreadyExistingCount: 0,
            failures: [],
          });
          mockedList.mockResolvedValue([
            { id: 1, flatLabel: 'A-101', billingPeriod: '2026-02', amount: 1500, status: 'unpaid' },
          ]);
          render(<AdminBillingScreen />);
          fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-02' } });

          await user.click(screen.getByRole('button', { name: 'Generate bills' }));

          expect(await screen.findByText('A-101 — unpaid')).toBeInTheDocument();
        });

        it('shows an empty-state message for a month with no bills (AC11)', async () => {
          mockedList.mockResolvedValue([]);
          render(<AdminBillingScreen />);

          expect(await screen.findByText('No bills found for this month.')).toBeInTheDocument();
        });
      });
      ```
    files:
      - src/screens/admin/AdminBillingScreen.test.tsx
    rationale: |
      `fireEvent.change` (not `userEvent.type`) is used for the `type="month"` input because jsdom
      does not simulate the native month-picker widget the way it does a plain text input; setting
      `.value` directly via `fireEvent.change` is the standard Testing Library approach for
      date/month/time input types. Mocking `billingClient` rather than rendering against a real DB
      keeps this suite fast and isolates UI behavior (loading/disabled/report rendering) from the
      already-covered service logic.
tests:
  - |
    AC1 — one bill per active flat, using each flat's configured amount:
    ```ts
    const result = await generateMonthlyBills(db, '2026-02');
    expect(result.created.map((c) => c.flatId).sort()).toEqual([flatA, flatB].sort());
    expect(Number(bills.find((b) => b.flat_id === flatA)?.amount)).toBe(1500);
    ```
  - |
    AC2 — a second run for the same flat/month creates no duplicate row:
    ```ts
    await generateMonthlyBills(db, '2026-02');
    await generateMonthlyBills(db, '2026-02');
    expect(await db('bills').where({ flat_id: flatId, billing_period: '2026-02' })).toHaveLength(1);
    ```
  - |
    AC3 — the Admin is informed a bill already exists for a flat:
    ```tsx
    mockedGenerate.mockResolvedValue({ billingPeriod: '2026-02', createdCount: 0, alreadyExistingCount: 1, failures: [] });
    await user.click(screen.getByRole('button', { name: 'Generate bills' }));
    expect(await screen.findByText(/already had a bill generated/i)).toBeInTheDocument();
    ```
  - |
    AC4 — a system error on one flat does not roll back bills already created for other flats:
    ```ts
    const goodBill = await db('bills').where({ flat_id: goodFlat, billing_period: '2026-02' }).first();
    expect(goodBill).toBeDefined();
    expect(result.failed.map((f) => f.flatId)).toContain(brokenFlat);
    ```
  - |
    AC5 — the Admin is shown a report listing which flats failed:
    ```tsx
    mockedGenerate.mockResolvedValue({ billingPeriod: '2026-02', createdCount: 0, alreadyExistingCount: 0, failures: [{ flatId: 7, flatLabel: 'A-101', reason: 'amount missing' }] });
    expect(await screen.findByText('A-101: amount missing')).toBeInTheDocument();
    ```
  - |
    AC6 — each failed flat entry includes the reason it failed (same rendered list item as AC5,
    asserted on the reason text specifically):
    ```tsx
    expect(screen.getByText('A-101: amount missing')).toHaveTextContent('amount missing');
    ```
  - |
    AC7 — a loading indicator is shown while generation is in progress:
    ```tsx
    await user.click(screen.getByRole('button', { name: 'Generate bills' }));
    expect(screen.getByRole('status')).toHaveTextContent(/generating/i);
    ```
  - |
    AC8 — the trigger action is disabled while generation is in progress:
    ```tsx
    await user.click(button);
    expect(button).toBeDisabled();
    ```
  - |
    AC9 — newly generated bills appear in the month's bill list with an unpaid status:
    ```tsx
    mockedList.mockResolvedValue([{ id: 1, flatLabel: 'A-101', billingPeriod: '2026-02', amount: 1500, status: 'unpaid' }]);
    expect(await screen.findByText('A-101 — unpaid')).toBeInTheDocument();
    ```
  - |
    AC10 — no bill is created for a deactivated flat:
    ```ts
    await generateMonthlyBills(db, '2026-02');
    expect(await db('bills').where({ flat_id: inactiveFlat })).toHaveLength(0);
    ```
  - |
    AC11 — an empty-state message is shown for a month with no bills:
    ```tsx
    mockedList.mockResolvedValue([]);
    expect(await screen.findByText('No bills found for this month.')).toBeInTheDocument();
    ```
  - |
    AC12 — no bills are created when there are no active flats:
    ```ts
    const result = await generateMonthlyBills(db, '2026-02');
    expect(result.created).toHaveLength(0);
    expect(await db('bills')).toHaveLength(0);
    ```
assumptions_or_open_questions:
  - |
    `flats` has no `is_active` or `monthly_maintenance_amount` column today (STORY-012's migration
    only created `id`, `flat_number`, `block`, `created_at`). This plan adds both via a new
    migration in this story rather than treating it as a STORY-012 defect to fix separately —
    please confirm that's the right story to carry this schema change.
  - |
    AC9 requires new bills to show an "unpaid" status, but the existing `bills` migration
    (STORY-012) declares `status` with `defaultTo('pending')`. This plan does not change that
    default (out of caution around touching another story's migration semantics) and instead has
    `generateMonthlyBills` set `status: 'unpaid'` explicitly on every insert. Please confirm
    `'unpaid'`/`'paid'` is the intended status vocabulary going forward — if so, a follow-up story
    should probably also rename the column default from `'pending'` for consistency.
  - |
    This repo has no backend/API layer at all yet (confirmed via `src/auth/credentials.ts` and
    `src/auth/AuthContext.tsx`, both explicit about deferring to STORY-013). This plan implements
    real, fully-tested generation logic in `db/services/generateMonthlyBills.ts` (Node-only, real
    SQLite), but `src/screens/admin/billing/billingClient.ts` is a placeholder that throws/returns
    empty data, the same deferral pattern already established for auth. Wiring the two together
    requires a backend/API story that doesn't exist yet — flagged as explicitly out of scope here.
  - |
    Bill due date is computed as the last calendar day of the billing month
    (`lastDayOfMonth` in `generateMonthlyBills.ts`); no ACs or existing code specify a due-date
    rule, so this is a placeholder choice — confirm if a different rule (e.g., a fixed number of
    days after month start) is required.
  - |
    AC4/5/6's "system error" scenario is produced in tests by seeding a flat with
    `monthly_maintenance_amount: null` (allowed at the DB level, though normal app usage always
    sets it), causing a genuine `NOT NULL` constraint failure on that one flat's bill insert. This
    was chosen over mocking Knex to stay consistent with this repo's existing real-SQLite testing
    convention (`db/migrations.test.ts`) rather than because it's the only realistic failure mode
    bill generation could hit in production.
  - |
    The bill-generation trigger is modeled as processing all active flats sequentially in a single
    request/response cycle (no background job/queue). Nothing in the ACs implies async job
    processing, and the existing codebase has no job infrastructure, so this was treated as out of
    scope.
package_dependencies: []
notes: |
  No new third-party packages are needed: Knex, better-sqlite3, Vitest, and Testing Library are
  already dependencies, and this plan's Node-side test harness is a direct copy of the pattern
  already proven in `db/migrations.test.ts`.

  ```mermaid
  flowchart TD
    Flats[(flats table)]
    Bills[(bills table)]
    Migration1[/migration: add is_active +\nmonthly_maintenance_amount/]
    Migration2[/migration: add unique\nflat_id+billing_period/]
    Service[db/services/generateMonthlyBills.ts]
    ServiceTest[db/services/generateMonthlyBills.test.ts]
    Client[src/screens/admin/billing/billingClient.ts]
    Screen[src/screens/admin/AdminBillingScreen.tsx]
    ScreenTest[src/screens/admin/AdminBillingScreen.test.tsx]
    App[src/App.tsx - routes /admin/billing]

    Migration1 -->|alters schema| Flats
    Migration2 -->|alters schema| Bills
    Service -->|reads active flats| Flats
    Service -->|checks/inserts bills| Bills
    ServiceTest -->|exercises real sqlite| Service
    Screen -->|calls generate/list| Client
    ScreenTest -->|mocks module| Screen
    App -->|already routes here| Screen
    Client -.no backend/API yet - manual gap.-> Service

    classDef touched fill:#f96,color:#000
    class Migration1,Migration2,Service,ServiceTest,Client,Screen,ScreenTest touched
  ```

  Why the split between `db/services/` (real DB, Node-tested) and `src/screens/admin/billing/`
  (stubbed client, mocked in UI tests): this exactly mirrors the existing precedent in this repo
  where `src/auth/credentials.ts` is a client-side placeholder with a comment pointing at the story
  that owns the real backend integration (STORY-013), rather than inventing a new pattern for this
  story. Nothing in `src/` currently imports from `db/` (and could not — `better-sqlite3` is a
  native Node addon, not something Vite can put in a browser bundle), so this plan does not attempt
  to wire them together directly.
