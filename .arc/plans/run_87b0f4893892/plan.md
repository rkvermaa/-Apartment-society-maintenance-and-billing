summary: |
  STORY-014 is scoped as "Core Setup & Access" plumbing: enforce that Admin and Resident users
  cannot reach the other role's screens or perform the other role's actions. Reading the current
  tree, screen-level enforcement (AC1, and the screen half of AC3) is already fully implemented
  by the prior shell/nav story: `src/auth/ProtectedRoute.tsx` gates every route in `src/App.tsx`
  by `allowedRoles`, redirecting an unauthenticated user to `/login` and a role-mismatched user to
  their own first nav item (`navConfigByRole[role][0].path`), and this is already covered by
  passing tests in `src/auth/ProtectedRoute.test.tsx` and `src/App.test.tsx`. What does not exist
  yet anywhere in the codebase is action-level enforcement (AC2, and the action half of AC3):
  every screen today (`src/screens/**`) is a static placeholder with no buttons, forms, or
  handlers to restrict, so there is no existing "action" to test against. This plan adds the one
  missing, generic building block — a `GuardedActionButton` component that checks the current
  user's role against an allow-list before invoking its handler, denies with a visible
  `role="alert"` message and a `logger.warn` audit event on mismatch, and invokes the handler
  normally on match — test-first, with no other screen wiring invented, mirroring how the
  STORY-012 migrations plan added purely-additive infrastructure and left consuming stories to
  wire it up later.
scope:
  - description: |
      Add `GuardedActionButton`, a small reusable component that enforces role-based
      authorization at the point an action is invoked (not just at the route level), so that a
      future concrete action (e.g. "record a payment", "approve a maintenance request") gets
      AC2/AC3 enforcement for free just by rendering through it instead of a bare `<button>`.

      `src/auth/GuardedActionButton.tsx`:
      ```tsx
      import { useState } from 'react';
      import { useAuth } from './useAuth';
      import type { Role } from './AuthContext';
      import { logger } from '../lib/logger';

      export interface GuardedActionButtonProps {
        allowedRoles: Role[];
        actionName: string;
        label: string;
        onAction: () => void;
      }

      export function GuardedActionButton({ allowedRoles, actionName, label, onAction }: GuardedActionButtonProps) {
        const { role } = useAuth();
        const [error, setError] = useState<string | null>(null);

        function handleClick() {
          if (!role || !allowedRoles.includes(role)) {
            logger.warn('action_denied_role_mismatch', { actionName, role, allowedRoles });
            setError('You do not have permission to perform this action.');
            return;
          }
          setError(null);
          onAction();
        }

        return (
          <div>
            <button type="button" onClick={handleClick}>
              {label}
            </button>
            {error && <p role="alert">{error}</p>}
          </div>
        );
      }
      ```
    files:
      - src/auth/GuardedActionButton.tsx
    rationale: |
      Mirrors the existing denial pattern already established in this codebase:
      `ProtectedRoute.tsx` logs `auth_redirect_role_mismatch` via the shared `logger` before
      denying route access, and `LoginScreen.tsx` shows a validation error with `<p role="alert">`.
      This component reuses both conventions so action-level denial is audited and visible the
      same way route-level denial and login failure already are, rather than introducing a new
      pattern.
  - description: |
      Write the failing component tests first, before `GuardedActionButton.tsx` exists, covering
      AC2 (cross-role action denied + error shown) and the action half of AC3 (own-role action
      granted). Uses the existing `renderWithAuth` test helper directly (no full `<App />` render
      needed, since this component only depends on `useAuth()`, not routing).

      `src/auth/GuardedActionButton.test.tsx`:
      ```tsx
      import { describe, expect, it, vi } from 'vitest';
      import { screen } from '@testing-library/react';
      import userEvent from '@testing-library/user-event';
      import { GuardedActionButton } from './GuardedActionButton';
      import { renderWithAuth } from '../test-utils';

      describe('GuardedActionButton', () => {
        it('AC2: denies a resident attempting an admin-only action and shows an error', async () => {
          const onAction = vi.fn();
          const user = userEvent.setup();
          renderWithAuth(
            <GuardedActionButton allowedRoles={['admin']} actionName="record_payment" label="Record Payment" onAction={onAction} />,
            { role: 'resident' },
          );

          await user.click(screen.getByRole('button', { name: 'Record Payment' }));

          expect(onAction).not.toHaveBeenCalled();
          expect(screen.getByRole('alert')).toHaveTextContent('You do not have permission to perform this action.');
        });

        it('AC2: denies an admin attempting a resident-only action and shows an error', async () => {
          const onAction = vi.fn();
          const user = userEvent.setup();
          renderWithAuth(
            <GuardedActionButton allowedRoles={['resident']} actionName="submit_payment" label="Submit Payment" onAction={onAction} />,
            { role: 'admin' },
          );

          await user.click(screen.getByRole('button', { name: 'Submit Payment' }));

          expect(onAction).not.toHaveBeenCalled();
          expect(screen.getByRole('alert')).toBeInTheDocument();
        });

        it('AC3: grants a user performing an action restricted to their own role', async () => {
          const onAction = vi.fn();
          const user = userEvent.setup();
          renderWithAuth(
            <GuardedActionButton allowedRoles={['admin']} actionName="record_payment" label="Record Payment" onAction={onAction} />,
            { role: 'admin' },
          );

          await user.click(screen.getByRole('button', { name: 'Record Payment' }));

          expect(onAction).toHaveBeenCalledTimes(1);
          expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
      });
      ```
    files:
      - src/auth/GuardedActionButton.test.tsx
    rationale: |
      Test-first: this file fails on the import of `./GuardedActionButton` (module doesn't exist)
      until the scope item above is implemented, then passes. One test per denial direction plus
      one for the granted case, matching AC2 and the action half of AC3 exactly.
  - description: |
      No code changes for AC1 (screen denied + redirect) or the screen half of AC3 (own-role
      screen access granted) — both are already implemented and already covered by passing tests,
      verified against the current tree in this planning pass:
      - `src/auth/ProtectedRoute.tsx:20-23` redirects a role-mismatched authenticated user to
        `navConfigByRole[role][0].path`, satisfying "denied access and shown an appropriate error
        **or redirect**" (the AC is an explicit either/or).
      - `src/auth/ProtectedRoute.test.tsx:15-27` already asserts both directions: a resident
        deep-linking into `/admin/billing` lands on "Resident Dashboard" (not "Billing"), and an
        admin deep-linking into `/resident/payments` lands on "Admin Dashboard" (not "Payments").
      - `src/App.test.tsx:15-23` and `src/shell/Navigation.test.tsx:8-37` already assert that a
        user landing on their own role's screens is granted access (correct heading renders,
        correct nav highlighted, no cross-role nav items shown).
      This plan does not touch `App.tsx`, `ProtectedRoute.tsx`, or `navConfig.ts`; it only adds
      the net-new action-level primitive above.
    files: []
    rationale: |
      Re-implementing or duplicating already-passing coverage would violate the "no speculative
      work" constraint and add churn with no behavioral change. Citing the exact lines here keeps
      this story's ownership of AC1/AC3-screen traceable without rewriting working code or tests.
tests:
  - |
    AC1 (screen denied, own-role screen granted) — already passing, no new test written; cited
    for traceability:
    ```ts
    // src/auth/ProtectedRoute.test.tsx:15-20 (existing, unchanged)
    renderWithAuth(<App />, { role: 'resident', initialEntries: ['/admin/billing'] });
    expect(screen.getByRole('heading', { name: 'Resident Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Billing' })).not.toBeInTheDocument();
    ```
  - |
    AC2 (cross-role action denied + error shown) — new failing test written first, in
    `src/auth/GuardedActionButton.test.tsx`, against a component that does not yet exist:
    ```tsx
    renderWithAuth(
      <GuardedActionButton allowedRoles={['admin']} actionName="record_payment" label="Record Payment" onAction={onAction} />,
      { role: 'resident' },
    );
    await user.click(screen.getByRole('button', { name: 'Record Payment' }));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have permission to perform this action.');
    ```
  - |
    AC3 (own-role screen granted, cited from existing passing coverage; own-role action granted,
    new failing test):
    ```tsx
    // screen half — src/App.test.tsx:15-23 (existing, unchanged)
    renderWithAuth(<App />, { role: 'admin', initialEntries: ['/admin/billing'] });
    expect(screen.getByRole('heading', { name: 'Billing' })).toBeInTheDocument();

    // action half — new, in GuardedActionButton.test.tsx
    renderWithAuth(
      <GuardedActionButton allowedRoles={['admin']} actionName="record_payment" label="Record Payment" onAction={onAction} />,
      { role: 'admin' },
    );
    await user.click(screen.getByRole('button', { name: 'Record Payment' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    ```
assumptions_or_open_questions:
  - |
    Every screen in `src/screens/**` is currently a static placeholder (a heading and nothing
    else) — there is no real business action anywhere in the app today (no "create bill",
    "record payment", or "submit maintenance request" handler exists yet). This plan therefore
    delivers the generic, reusable enforcement primitive (`GuardedActionButton`) and proves it
    with direct component tests, but does not invent or wire a concrete business action into any
    screen, since that would be speculative work belonging to the future billing/maintenance
    stories that actually implement those actions. Please confirm this scoping is acceptable, or
    say if you'd rather see it wired into one placeholder screen as a live example.
  - |
    AC1's phrasing ("denied access and shown an appropriate error **or** redirect") is read as an
    either/or, matching the already-implemented redirect-only behavior in `ProtectedRoute.tsx`.
    If the reviewer instead wants a visible error message on cross-role screen navigation (in
    addition to the redirect), that would be a small addition to `ProtectedRoute.tsx` — flagging
    here since it changes already-passing STORY-017 behavior rather than being purely additive.
  - |
    `GuardedActionButton` treats an unauthenticated user (`role === null`) as denied for any
    action, matching how `ProtectedRoute` treats `!isAuthenticated` — this case isn't reachable
    through the UI today (unauthenticated users never see a screen with an action button), but
    the guard is defensive rather than assuming the caller always has a valid session.
package_dependencies: []
notes: |
  No mermaid diagram: this plan touches exactly one new file pair
  (`GuardedActionButton.tsx` + its test) that nothing else in `src/` imports yet, plus zero
  changes to existing routing/nav code — there is no multi-file call graph to show.

  Why a component rather than a plain hook/utility function: every existing denial path in this
  repo (`LoginScreen.tsx`'s `role="alert"` on bad credentials, `ProtectedRoute.tsx`'s redirect) is
  expressed as a self-contained UI unit with its own visible feedback, and all existing tests in
  this repo are RTL integration/component tests (no isolated hook-unit-test file exists anywhere
  in `src/`) — a component matches both the existing UI-feedback convention and the existing test
  style, rather than introducing a new pattern for this one story.
