summary: |
  Admin Billing's bill listing (`src/screens/admin/AdminBillingScreen.tsx`, backed by
  `GET /api/bills` -> `db/services/listBillsForMonth.ts`) already renders whatever `bills.status`
  value is stored, so once a bill's status is `'paid'`, AC1 ("that bill shows as paid") is already
  true by construction of the existing pass-through query. What's missing is AC2's audit trail: the
  `payments` table (`db/migrations/20260914090005_create_payments_table.cjs`) records `amount`,
  `paid_at`, and `method` but has no column identifying which user recorded the payment, so there is
  no way to answer "which resident, and when" from the schema today. This plan adds a
  `recorded_by_user_id` FK column to `payments`, extends `listBillsForMonth` to left-join the most
  recent payment (and its recording user) per bill, threads `paidByResidentName`/`paidAt` through
  the API response and `billingClient.Bill` type, and renders that audit line in
  `AdminBillingScreen` only when a bill is paid and has a linked payment. This story does not build
  a resident-facing "record a payment" flow — `src/screens/resident/ResidentPaymentsScreen.tsx` is
  still an empty placeholder today, and no session/identity backend exists yet to tie an HTTP
  request to a specific resident user (only an unverified `role` is known, per
  `src/auth/AuthContext.tsx` and `server/auth.ts`). That is a separate, not-yet-scoped story in the
  "Resident dues & payments" epic; this plan proves AC1/AC2 by seeding `bills`/`payments` rows
  directly in tests (exactly as sibling stories already seed `flats`/`bills` directly), matching the
  ACs' "GIVEN a resident has recorded a payment" precondition without inventing that flow.
scope:
  - description: |
      Add the missing audit column to `payments`: which user recorded the payment. This is a
      required FK (every real payment row going forward is written by an authenticated user
      performing the "record payment" action), matching the existing not-null FK style already used
      for `users.role_id` and `bills.flat_id`.

      `db/migrations/20260917100003_add_recorded_by_user_id_to_payments_table.cjs`:
      ```js
      exports.up = function up(knex) {
        return knex.schema.alterTable('payments', (table) => {
          table.integer('recorded_by_user_id').unsigned().notNullable()
            .references('id').inTable('users').onDelete('RESTRICT');
        });
      };

      exports.down = function down(knex) {
        return knex.schema.alterTable('payments', (table) => {
          table.dropColumn('recorded_by_user_id');
        });
      };
      ```
    files:
      - db/migrations/20260917100003_add_recorded_by_user_id_to_payments_table.cjs
    rationale: |
      AC2 requires showing "the acting resident" for a payment, which is impossible with the current
      `payments` schema (no user reference at all). `onDelete('RESTRICT')` matches `users.role_id`'s
      existing convention of refusing to silently orphan an audit record. Mirrors how STORY-004
      added `flats.is_active`/`monthly_maintenance_amount` via a new migration when its ACs needed
      columns the original STORY-012 schema didn't have.
  - description: |
      Fix the two existing, currently-passing tests in `db/migrations.test.ts` that this new
      migration would otherwise break for reasons unrelated to their own ACs: the hard-coded
      migration count, and the payments insert in the FK-enforcement test (which will now fail a
      `NOT NULL` constraint without a `recorded_by_user_id`).

      `db/migrations.test.ts`, in `'enforces declared foreign-key constraints at runtime (AC2)'`:
      ```ts
      // before
      await db('users').insert({
        name: 'Jane',
        email: 'jane@example.com',
        password_hash: 'hash',
        role_id: role.id,
        flat_id: flat.id,
      });
      // ...
      await db('payments').insert({ bill_id: bill.id, amount: '100.00', paid_at: new Date(), method: 'cash' });

      // after
      const [user] = await db('users')
        .insert({
          name: 'Jane',
          email: 'jane@example.com',
          password_hash: 'hash',
          role_id: role.id,
          flat_id: flat.id,
        })
        .returning('id');
      // ...
      await db('payments').insert({
        bill_id: bill.id,
        amount: '100.00',
        paid_at: new Date(),
        method: 'cash',
        recorded_by_user_id: user.id,
      });
      ```
      And in `'records applied migrations with identifier and order (AC5)'`:
      ```ts
      // before
      expect(history).toHaveLength(7);
      // after
      expect(history).toHaveLength(8);
      ```
    files:
      - db/migrations.test.ts
    rationale: |
      Neither change tests this story's own behavior; both are pre-existing STORY-012/STORY-004
      assertions that hard-code details this story's migration count/column changes touch. This is
      the same kind of unrelated-test upkeep the STORY-004 plan already performed on this same file
      when it added its own migrations (bumping the count from 5 to 7).
  - description: |
      Extend `listBillsForMonth` to left-join each bill's most recent payment (there is currently no
      partial-payment model — at most one payment per bill in practice) and that payment's recording
      user, exposing the acting resident's name and the payment timestamp alongside the existing
      fields. A subquery picks the latest payment id per `bill_id` so the join can't fan out a bill
      into duplicate rows if more than one payment row ever exists for it.

      `db/services/listBillsForMonth.ts`, before -> after:
      ```ts
      // before
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

      // after
      export interface BillListItem {
        id: number;
        flatLabel: string;
        billingPeriod: string;
        amount: number;
        status: string;
        paidByResidentName: string | null;
        paidAt: string | null;
      }

      export async function listBillsForMonth(db: Knex, billingPeriod: string): Promise<BillListItem[]> {
        const latestPayments = db('payments')
          .select('bill_id')
          .max('id as latest_payment_id')
          .groupBy('bill_id')
          .as('latest_payments');

        const rows = await db('bills')
          .join('flats', 'flats.id', 'bills.flat_id')
          .leftJoin(latestPayments, 'latest_payments.bill_id', 'bills.id')
          .leftJoin('payments', 'payments.id', 'latest_payments.latest_payment_id')
          .leftJoin('users', 'users.id', 'payments.recorded_by_user_id')
          .where('bills.billing_period', billingPeriod)
          .select(
            'bills.id as id',
            'bills.billing_period as billingPeriod',
            'bills.amount as amount',
            'bills.status as status',
            db.raw("flats.block || '-' || flats.flat_number as flatLabel"),
            'users.name as paidByResidentName',
            'payments.paid_at as paidAt',
          );
        return rows.map((row) => ({
          ...row,
          amount: Number(row.amount),
          paidByResidentName: row.paidByResidentName ?? null,
          paidAt: row.paidAt ?? null,
        }));
      }
      ```
    files:
      - db/services/listBillsForMonth.ts
    rationale: |
      Keeps the audit join entirely inside the one service that already owns "list bills for a
      month" rather than adding a second query the route would need to combine — `server/app.ts`
      needs zero changes since it already just forwards this function's return value via
      `res.json(bills)`. `?? null` normalizes SQLite's `undefined`-for-no-match into an explicit
      `null` the frontend can check.
  - description: |
      Write the failing service tests first, before the migration/service changes above exist,
      proving both ACs at the data layer.

      `db/services/listBillsForMonth.test.ts`, new helpers and tests:
      ```ts
      async function seedResident(flatId: number, overrides: Partial<{ name: string; email: string }> = {}): Promise<number> {
        const [role] = await db('roles').insert({ name: 'resident' }).returning('id');
        const [user] = await db('users')
          .insert({
            name: 'Jane Doe',
            email: 'jane@example.com',
            password_hash: 'hash',
            role_id: role.id,
            flat_id: flatId,
            ...overrides,
          })
          .returning('id');
        return user.id as number;
      }

      it('shows a bill as paid once a resident has recorded a payment on it (AC1)', async () => {
        await db.migrate.latest();
        const flatId = await seedFlat();
        const residentId = await seedResident(flatId);
        const [bill] = await db('bills')
          .insert({ flat_id: flatId, billing_period: '2026-02', amount: 1500, due_date: '2026-02-28', status: 'paid' })
          .returning('id');
        await db('payments').insert({
          bill_id: bill.id,
          amount: 1500,
          paid_at: '2026-02-15T10:00:00.000Z',
          method: 'cash',
          recorded_by_user_id: residentId,
        });

        const bills = await listBillsForMonth(db, '2026-02');

        expect(bills).toEqual([expect.objectContaining({ status: 'paid' })]);
      });

      it('includes the acting resident and payment timestamp for audit purposes (AC2)', async () => {
        await db.migrate.latest();
        const flatId = await seedFlat();
        const residentId = await seedResident(flatId, { name: 'Jane Doe', email: 'jane2@example.com' });
        const [bill] = await db('bills')
          .insert({ flat_id: flatId, billing_period: '2026-02', amount: 1500, due_date: '2026-02-28', status: 'paid' })
          .returning('id');
        await db('payments').insert({
          bill_id: bill.id,
          amount: 1500,
          paid_at: '2026-02-15T10:00:00.000Z',
          method: 'cash',
          recorded_by_user_id: residentId,
        });

        const bills = await listBillsForMonth(db, '2026-02');

        expect(bills[0]).toEqual(
          expect.objectContaining({ paidByResidentName: 'Jane Doe', paidAt: '2026-02-15T10:00:00.000Z' }),
        );
      });

      it('returns null audit fields for a bill with no recorded payment', async () => {
        await db.migrate.latest();
        const flatId = await seedFlat();
        await seedBill(flatId, { status: 'unpaid' });

        const bills = await listBillsForMonth(db, '2026-02');

        expect(bills[0]).toEqual(expect.objectContaining({ paidByResidentName: null, paidAt: null }));
      });
      ```
    files:
      - db/services/listBillsForMonth.test.ts
    rationale: |
      These fail immediately against the current schema/service (no `recorded_by_user_id` column,
      no join, no `paidByResidentName`/`paidAt` fields) until the two scope items above are
      implemented, then pass — one test per acceptance criterion plus a regression test for the
      unpaid/no-payment case so the left join is proven not to hide bills with no payment.
  - description: |
      Extend the `Bill` type the frontend consumes with the two new, optional audit fields (optional
      so the many existing test fixtures across `AdminBillingScreen.test.tsx` that construct a
      `Bill` without them keep compiling unchanged).

      `src/screens/admin/billing/billingClient.ts`, before -> after:
      ```ts
      // before
      export interface Bill {
        id: number;
        flatLabel: string;
        billingPeriod: string;
        amount: number;
        status: 'unpaid' | 'paid';
      }

      // after
      export interface Bill {
        id: number;
        flatLabel: string;
        billingPeriod: string;
        amount: number;
        status: 'unpaid' | 'paid';
        paidByResidentName?: string | null;
        paidAt?: string | null;
      }
      ```
      (`listBillsForMonth`'s `fetch` call and error handling are unchanged — the new fields simply
      flow through the existing `response.json()` pass-through.)
    files:
      - src/screens/admin/billing/billingClient.ts
    rationale: |
      No behavioral change to the client function itself; this only widens the shape it already
      returns so `AdminBillingScreen` can read the new fields with type safety.
  - description: |
      Render the audit line in the bill list, only when a bill is paid and has linked payment data,
      so AC2's "acting resident and timestamp" is actually visible to the admin.

      `src/screens/admin/AdminBillingScreen.tsx`, bill list item before -> after:
      ```tsx
      // before
      <li key={bill.id}>
        {bill.flatLabel} — {bill.status}
      </li>

      // after
      <li key={bill.id}>
        {bill.flatLabel} — {bill.status}
        {bill.status === 'paid' && bill.paidByResidentName && bill.paidAt && (
          <p>Paid by {bill.paidByResidentName} on {bill.paidAt}</p>
        )}
      </li>
      ```
    files:
      - src/screens/admin/AdminBillingScreen.tsx
    rationale: |
      Keeps the existing `{flatLabel} — {status}` text exactly as-is (so every currently-passing
      test asserting on that text, e.g. `'B-202 — paid'`, keeps working unmodified) and adds a
      second line only for bills that actually carry payment audit data, so an admin-triggered
      "generate bills" run (no payment yet) never shows a misleading audit line. The raw ISO
      timestamp is rendered as-is rather than locale-formatted, to keep this deterministic in tests
      and defer a nicer human-readable format to a follow-up (see
      assumptions_or_open_questions).
  - description: |
      Write the failing UI tests first, before the render change above exists, plus one API-layer
      test proving the new fields travel end-to-end through `GET /api/bills`.

      `src/screens/admin/AdminBillingScreen.test.tsx`, new tests:
      ```tsx
      it('shows the acting resident and payment timestamp for a paid bill (AC1, AC2)', async () => {
        mockedList.mockResolvedValue([
          {
            id: 3,
            flatLabel: 'A-101',
            billingPeriod: '2026-02',
            amount: 1500,
            status: 'paid',
            paidByResidentName: 'Jane Doe',
            paidAt: '2026-02-15T10:00:00.000Z',
          },
        ]);
        renderWithAuth(<AdminBillingScreen />, { role: 'admin' });

        expect(await screen.findByText('A-101 — paid')).toBeInTheDocument();
        expect(screen.getByText('Paid by Jane Doe on 2026-02-15T10:00:00.000Z')).toBeInTheDocument();
      });

      it('does not show payment audit info for an unpaid bill', async () => {
        mockedList.mockResolvedValue([
          { id: 4, flatLabel: 'B-202', billingPeriod: '2026-02', amount: 1500, status: 'unpaid' },
        ]);
        renderWithAuth(<AdminBillingScreen />, { role: 'admin' });

        expect(await screen.findByText('B-202 — unpaid')).toBeInTheDocument();
        expect(screen.queryByText(/Paid by/)).not.toBeInTheDocument();
      });
      ```

      `server/app.test.ts`, new test proving the API response carries the audit fields:
      ```ts
      it('includes resident payment audit fields when a bill has been paid (AC1, AC2)', async () => {
        await db.migrate.latest();
        const [role] = await db('roles').insert({ name: 'resident' }).returning('id');
        const [flat] = await db('flats')
          .insert({ flat_number: '101', block: 'A', is_active: true, monthly_maintenance_amount: 1500 })
          .returning('id');
        const [resident] = await db('users')
          .insert({ name: 'Jane Doe', email: 'jane@example.com', password_hash: 'hash', role_id: role.id, flat_id: flat.id })
          .returning('id');
        const [bill] = await db('bills')
          .insert({ flat_id: flat.id, billing_period: '2026-02', amount: 1500, due_date: '2026-02-28', status: 'paid' })
          .returning('id');
        await db('payments').insert({
          bill_id: bill.id,
          amount: 1500,
          paid_at: '2026-02-15T10:00:00.000Z',
          method: 'cash',
          recorded_by_user_id: resident.id,
        });
        const app = createApp(db, { unverifiedRoleAuthEnabled: true });

        const response = await request(app).get('/api/bills?month=2026-02').set('X-Demo-Role', 'admin');

        expect(response.body).toEqual([
          expect.objectContaining({ status: 'paid', paidByResidentName: 'Jane Doe', paidAt: '2026-02-15T10:00:00.000Z' }),
        ]);
      });
      ```
    files:
      - src/screens/admin/AdminBillingScreen.test.tsx
      - server/app.test.ts
    rationale: |
      The UI tests fail against the current render (no audit `<p>` at all) until the scope item
      above exists; the API test fails against the current service/route (no `paidByResidentName`/
      `paidAt` in the response) until the migration + service scope items above exist. Together with
      the service-level tests, this proves the audit trail end-to-end: DB -> service -> HTTP
      response -> screen.
tests:
  - |
    AC1 — a bill a resident has paid shows as paid in Admin Billing's listing (service layer,
    proven against a real seeded payment rather than a bare status flag):
    ```ts
    const bills = await listBillsForMonth(db, '2026-02');
    expect(bills).toEqual([expect.objectContaining({ status: 'paid' })]);
    ```
    and UI layer:
    ```tsx
    expect(await screen.findByText('A-101 — paid')).toBeInTheDocument();
    ```
  - |
    AC2 — the acting resident and payment timestamp are visible for audit purposes (service layer):
    ```ts
    expect(bills[0]).toEqual(
      expect.objectContaining({ paidByResidentName: 'Jane Doe', paidAt: '2026-02-15T10:00:00.000Z' }),
    );
    ```
    API layer:
    ```ts
    expect(response.body).toEqual([
      expect.objectContaining({ status: 'paid', paidByResidentName: 'Jane Doe', paidAt: '2026-02-15T10:00:00.000Z' }),
    ]);
    ```
    and UI layer:
    ```tsx
    expect(screen.getByText('Paid by Jane Doe on 2026-02-15T10:00:00.000Z')).toBeInTheDocument();
    ```
assumptions_or_open_questions:
  - |
    No resident-facing "record a payment" flow exists anywhere in this codebase yet —
    `src/screens/resident/ResidentPaymentsScreen.tsx` is a bare placeholder (`<h1>Payments</h1>`,
    nothing else), and there is no POST endpoint for creating a payment or flipping a bill's status.
    Per the epic split already visible in this codebase's other plans (each story owns one thin
    slice), I've treated "a resident records a payment" as a precondition owned by a separate,
    not-yet-written story, and proven this story's ACs by seeding `bills`/`payments` rows directly
    in tests — the same pattern already used by `listBillsForMonth.test.ts` and
    `server/app.test.ts` to seed `bills`/`flats` directly. Please confirm this split is correct, or
    say if this story should also build the resident payment-recording endpoint/UI (materially
    larger scope).
  - |
    There is no server-issued session or identity mechanism yet that ties an HTTP request to a
    specific resident user — `src/auth/AuthContext.tsx` and `server/auth.ts`'s `requireRole` only
    know an unverified `role` ('admin'/'resident'), never a specific user id. This means the not-yet-
    built "record a payment" story will itself need to solve "which user is making this request"
    before it can populate `payments.recorded_by_user_id` for real; this plan only adds the column
    and proves it can be joined/displayed, seeding the id directly in tests.
  - |
    At most one payment is assumed per bill in practice (no partial-payment/refund model exists in
    the schema); `listBillsForMonth` defensively takes the latest payment by `id` per bill via a
    subquery so a future multi-payment scenario wouldn't silently duplicate a bill row, but this
    plan does not build UI/tests for a bill with more than one payment since nothing in the schema
    or ACs suggests that's possible yet.
  - |
    The payment timestamp is rendered as the raw ISO string returned by the API (e.g.
    `2026-02-15T10:00:00.000Z`) rather than locale-formatted, to keep the new UI test deterministic
    and avoid a timezone-dependent assertion. A more human-readable format is a reasonable follow-up
    but wasn't required by either AC.
  - |
    `payments.recorded_by_user_id` is added as `notNullable`, meaning any *existing* payment row
    created before this migration (none exist in this repo today — no seed data — but a real
    deployed environment could have some) would need a backfill before this migration could run
    against it. Since this codebase has no production data yet, this plan does not add a backfill
    step; flagging in case that assumption is wrong.
package_dependencies: []
notes: |
  ```mermaid
  flowchart TD
    Migration[migration: add recorded_by_user_id]
    Payments[(payments table)]
    Users[(users table)]
    Bills[(bills table)]
    Flats[(flats table)]
    Service[db/services/listBillsForMonth.ts]
    ServiceTest[db/services/listBillsForMonth.test.ts]
    ServerApp[server/app.ts - GET /api/bills, unchanged]
    ServerAppTest[server/app.test.ts]
    Client[src/screens/admin/billing/billingClient.ts]
    Screen[src/screens/admin/AdminBillingScreen.tsx]
    ScreenTest[src/screens/admin/AdminBillingScreen.test.tsx]

    Migration -->|adds FK column, AC2| Payments
    Service -->|latest payment per bill, left join| Payments
    Service -->|resolves recording user's name, AC2| Users
    Service -->|existing join, unchanged| Bills
    Service -->|existing join, unchanged| Flats
    ServiceTest -->|seeds payments+users, asserts paidByResidentName/paidAt| Service
    ServerApp -->|calls, response shape widens automatically| Service
    ServerAppTest -->|asserts audit fields in JSON, AC1/AC2| ServerApp
    Client -->|widened Bill type, no logic change| Service
    Screen -->|reads paidByResidentName/paidAt, renders audit line, AC2| Client
    ScreenTest -->|asserts audit line shown only when paid, AC1/AC2| Screen

    classDef touched fill:#f96,color:#000
    class Migration,Payments,Service,ServiceTest,ServerAppTest,Client,Screen,ScreenTest touched
  ```

  Why extend `listBillsForMonth` rather than add a second endpoint/service for payment history:
  Admin Billing's bill listing is already the one place AC1/AC2 need to show up together ("that
  bill shows as paid" + "the acting resident and timestamp are visible") on the same screen, so a
  single enriched row per bill is simpler than the screen having to fetch and correlate two
  separate lists itself.

  Why a `LEFT JOIN` (not `INNER JOIN`) against the latest-payment subquery: an unpaid bill (the
  common case for most of a billing period) has no payment row at all, and must still appear in the
  list per the already-passing empty/unpaid-bill tests in `listBillsForMonth.test.ts` and
  `AdminBillingScreen.test.tsx` — an inner join would silently drop every unpaid bill from the
  admin's listing, which is a regression, not a feature of this story.
