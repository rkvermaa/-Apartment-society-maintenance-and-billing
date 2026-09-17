summary: |
  This repo has no HTTP/API layer at all today — `src/auth/credentials.ts` and
  `src/auth/AuthContext.tsx` both carry comments deferring real credential verification and
  session issuance to this exact story, and `src/screens/admin/billing/billingClient.ts` is a
  stub for the same reason. This plan stands up the first real backend: a small Express app
  (`server/app.ts`) with a `db`-backed `users`/`roles` lookup (from STORY-012's schema),
  scrypt-hashed passwords, and opaque server-side session tokens persisted in a new `sessions`
  table (so logout can truly revoke a token — a stateless JWT could not satisfy AC9 without an
  extra blocklist). `POST /api/auth/login` issues a token on valid credentials and rejects invalid
  ones with no token created; `GET /api/auth/session` and a `requireSession` middleware validate a
  bearer token on every subsequent request; `POST /api/auth/logout` revokes it; a `requireRole`
  middleware (proven with its own tests, not yet wired into a production route, mirroring how
  STORY-014's `GuardedActionButton` shipped ahead of a concrete consumer) provides the admin-only
  gate the parent epic's future billing/maintenance API stories will mount behind. On the frontend,
  `AuthContext` is rewired to call this API through a new `authApiClient` instead of trusting a
  client-supplied role: `login()` now takes credentials and returns the server-issued role, the
  token is persisted in `localStorage` and re-validated against `/api/auth/session` on mount (so a
  refreshed page either restores a still-valid session or is redirected to `/login`), and a new
  `isInitializing` flag on the context stops `ProtectedRoute` from redirecting a valid returning
  session before that check resolves. A "Log out" action is added to `AppShell` (nothing in the
  UI could otherwise trigger AC9's "they log out"), and the demo credentials already used by
  `LoginScreen` (`admin`/`admin123`, `resident`/`resident123`) are preserved by seeding matching
  `users`/`roles` rows via a new data migration, so existing UI behavior for a human tester is
  unchanged even though verification is now fully server-side.
scope:
  - description: |
      Add a `sessions` table so a session token can be looked up, checked for expiry, and truly
      revoked (not just a stateless claim) — required for AC9's "subsequent request using that
      token is rejected" after logout.

      `db/migrations/20260917110001_create_sessions_table.cjs`:
      ```js
      exports.up = function up(knex) {
        return knex.schema.createTable('sessions', (table) => {
          table.increments('id').primary();
          table.string('token').notNullable().unique();
          table.integer('user_id').unsigned().notNullable()
            .references('id').inTable('users').onDelete('CASCADE');
          table.timestamp('expires_at').notNullable();
          table.timestamp('revoked_at').nullable();
          table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        });
      };

      exports.down = function down(knex) {
        return knex.schema.dropTableIfExists('sessions');
      };
      ```
    files:
      - db/migrations/20260917110001_create_sessions_table.cjs
    rationale: |
      `token` is unique so a lookup is a single indexed equality check; `revoked_at` (nullable,
      set on logout) and `expires_at` (checked against `now()`) are the two conditions
      `requireSession` tests for on every request, matching AC6/AC9 exactly.
  - description: |
      Seed the `users`/`roles` tables with the same demo identities `LoginScreen` already uses
      (`admin`/`admin123`, `resident`/`resident123`), as a data migration rather than a new
      `knex seed:run` subsystem, so it runs automatically with the existing `migrate:latest`
      workflow. Password hashing here is a small, deliberately duplicated copy of
      `server/auth/password.ts`'s scrypt logic (see `notes` for why it isn't shared).

      `db/migrations/20260917110002_seed_demo_users.cjs`:
      ```js
      const crypto = require('node:crypto');

      function hashPassword(password) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.scryptSync(password, salt, 64).toString('hex');
        return `${salt}:${hash}`;
      }

      const DEMO_USERS = [
        { name: 'Demo Admin', email: 'admin', password: 'admin123', role: 'admin' },
        { name: 'Demo Resident', email: 'resident', password: 'resident123', role: 'resident' },
      ];

      exports.up = async function up(knex) {
        const roleIds = {};
        for (const user of DEMO_USERS) {
          let role = await knex('roles').where({ name: user.role }).first();
          if (!role) {
            const [inserted] = await knex('roles').insert({ name: user.role }).returning('id');
            role = { id: inserted.id };
          }
          roleIds[user.role] = role.id;
        }

        for (const user of DEMO_USERS) {
          const existing = await knex('users').where({ email: user.email }).first();
          if (!existing) {
            await knex('users').insert({
              name: user.name,
              email: user.email,
              password_hash: hashPassword(user.password),
              role_id: roleIds[user.role],
            });
          }
        }
      };

      exports.down = function down(knex) {
        return knex('users').whereIn('email', DEMO_USERS.map((u) => u.email)).del();
      };
      ```
    files:
      - db/migrations/20260917110002_seed_demo_users.cjs
    rationale: |
      Using `email` (the existing unique `users` column) to hold the plain demo username string
      ('admin'/'resident') keeps `LoginScreen`'s existing input values and its two passing tests'
      credentials working end-to-end against the real backend, instead of introducing a
      separate "username" column or changing the demo values. Insert is guarded by an existence
      check (not `.del()` + reinsert) so re-running migrations is non-destructive to any other
      data.
  - description: |
      Update the one pre-existing assertion in `db/migrations.test.ts` that hard-codes the total
      applied-migration count for STORY-012's own AC5 — it is not testing anything this story
      owns, but it will fail once the two migrations above exist, exactly as STORY-009's plan had
      to do the same thing for its own two added migrations.

      `db/migrations.test.ts`, inside `'records applied migrations with identifier and order (AC5)'`:
      ```ts
      // before
      expect(history).toHaveLength(7);
      // after
      expect(history).toHaveLength(9);
      ```
    files:
      - db/migrations.test.ts
    rationale: |
      All other assertions in that file use `expect.arrayContaining(...)` for tables/columns, so
      they remain valid unmodified; only this literal count needs updating.
  - description: |
      Implement scrypt-based password hashing as a small, dependency-free module (Node's built-in
      `node:crypto`, no bcrypt/argon2) so `password_hash` values are salted and never stored or
      compared in plaintext.

      `server/auth/password.ts`:
      ```ts
      import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

      const KEY_LENGTH = 64;

      export function hashPassword(password: string): string {
        const salt = randomBytes(16).toString('hex');
        const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
        return `${salt}:${hash}`;
      }

      export function verifyPassword(password: string, stored: string): boolean {
        const [salt, hash] = stored.split(':');
        if (!salt || !hash) return false;
        const candidate = scryptSync(password, salt, KEY_LENGTH);
        const expected = Buffer.from(hash, 'hex');
        return candidate.length === expected.length && timingSafeEqual(candidate, expected);
      }
      ```
    files:
      - server/auth/password.ts
    rationale: |
      `timingSafeEqual` avoids a timing side-channel on hash comparison; `better-sqlite3` is
      already a native dependency in this project, so avoiding a second native module (bcrypt) by
      using Node's built-in `scrypt` keeps the dependency surface smaller.
  - description: |
      Write the failing unit test for password hashing first, before `password.ts` exists.

      `server/auth/password.test.ts`:
      ```ts
      // @vitest-environment node
      import { describe, expect, it } from 'vitest';
      import { hashPassword, verifyPassword } from './password';

      describe('password hashing', () => {
        it('verifies a matching password against its stored hash', () => {
          const stored = hashPassword('admin123');
          expect(verifyPassword('admin123', stored)).toBe(true);
        });

        it('rejects a non-matching password', () => {
          const stored = hashPassword('admin123');
          expect(verifyPassword('wrong-password', stored)).toBe(false);
        });
      });
      ```
    files:
      - server/auth/password.test.ts
    rationale: |
      Fails on the import of `./password` until the module above exists; isolates the
      security-critical hash/verify logic from the HTTP layer so it's independently proven.
  - description: |
      Implement session issuance, lookup, and revocation against the `sessions` table as a plain
      module over a `Knex` instance (same style as `db/services/generateMonthlyBills.ts`).

      `server/auth/sessions.ts`:
      ```ts
      import type { Knex } from 'knex';
      import { randomBytes } from 'node:crypto';

      const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

      export interface AuthenticatedUser {
        id: number;
        email: string;
        role: string;
      }

      export async function createSession(db: Knex, userId: number): Promise<{ token: string; expiresAt: Date }> {
        const token = randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
        await db('sessions').insert({ token, user_id: userId, expires_at: expiresAt });
        return { token, expiresAt };
      }

      export async function findUserBySessionToken(db: Knex, token: string): Promise<AuthenticatedUser | null> {
        const row = await db('sessions')
          .join('users', 'users.id', 'sessions.user_id')
          .join('roles', 'roles.id', 'users.role_id')
          .where('sessions.token', token)
          .whereNull('sessions.revoked_at')
          .andWhere('sessions.expires_at', '>', new Date())
          .select('users.id', 'users.email', 'roles.name as role')
          .first();
        return row ?? null;
      }

      export async function revokeSession(db: Knex, token: string): Promise<void> {
        await db('sessions').where({ token }).update({ revoked_at: new Date() });
      }
      ```
    files:
      - server/auth/sessions.ts
    rationale: |
      `findUserBySessionToken` is the single source of truth `requireSession` calls on every
      request: a token that is unrecognized, revoked, or past `expires_at` all resolve to `null`
      here, giving AC6/AC9 one implementation to get right rather than three.
  - description: |
      Implement `requireSession` (attaches the authenticated user or rejects with 401) and
      `requireRole` (403s a request whose authenticated role isn't in an allow-list) as composable
      Express middleware, so future admin-only API routes (the parent epic's billing/maintenance
      API story) can mount `requireSession(db), requireRole('admin')` directly.

      `server/middleware/requireSession.ts`:
      ```ts
      import type { NextFunction, Request, Response } from 'express';
      import type { Knex } from 'knex';
      import { findUserBySessionToken, type AuthenticatedUser } from '../auth/sessions';

      declare module 'express-serve-static-core' {
        interface Request {
          user?: AuthenticatedUser;
        }
      }

      export function requireSession(db: Knex) {
        return async function requireSessionMiddleware(req: Request, res: Response, next: NextFunction) {
          const header = req.header('authorization') ?? '';
          const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
          if (!token) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
          }
          const user = await findUserBySessionToken(db, token);
          if (!user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
          }
          req.user = user;
          next();
        };
      }
      ```

      `server/middleware/requireRole.ts`:
      ```ts
      import type { NextFunction, Request, Response } from 'express';

      export function requireRole(...allowedRoles: string[]) {
        return function requireRoleMiddleware(req: Request, res: Response, next: NextFunction) {
          if (!req.user || !allowedRoles.includes(req.user.role)) {
            res.status(403).json({ error: 'Forbidden' });
            return;
          }
          next();
        };
      }
      ```
    files:
      - server/middleware/requireSession.ts
      - server/middleware/requireRole.ts
    rationale: |
      Splitting authentication (`requireSession`, "who are you") from authorization
      (`requireRole`, "are you allowed here") lets a route require just the former (e.g.
      `GET /api/auth/session`, any authenticated user) or both (a future admin-only endpoint)
      without duplicating the token-validation logic.
  - description: |
      Write the failing middleware test suite first, against a disposable per-test SQLite file
      (same harness as `db/services/generateMonthlyBills.test.ts`), mounting the middleware on
      throwaway test routes — mirroring how STORY-014 proved `GuardedActionButton` with direct
      component tests before any real screen consumed it.

      `server/middleware/auth.test.ts`:
      ```ts
      // @vitest-environment node
      import express from 'express';
      import Knex, { type Knex as KnexType } from 'knex';
      import fs from 'node:fs';
      import os from 'node:os';
      import path from 'node:path';
      import request from 'supertest';
      import { afterEach, beforeEach, describe, expect, it } from 'vitest';
      import { requireSession } from './requireSession';
      import { requireRole } from './requireRole';
      import { createSession } from '../auth/sessions';

      let db: KnexType;
      let tmpDir: string;

      beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-middleware-'));
        db = Knex({
          client: 'better-sqlite3',
          connection: { filename: path.join(tmpDir, 'test.sqlite3') },
          useNullAsDefault: true,
          migrations: { directory: path.join(__dirname, '..', '..', 'db', 'migrations'), extension: 'cjs' },
        });
        await db.migrate.latest();
      });

      afterEach(async () => {
        await db.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });

      function buildTestApp() {
        const app = express();
        app.get('/protected', requireSession(db), (req, res) => res.json({ role: req.user!.role }));
        app.get('/admin-only', requireSession(db), requireRole('admin'), (req, res) => res.json({ ok: true }));
        return app;
      }

      describe('requireSession + requireRole middleware', () => {
        it('AC5/AC6: authenticates a valid token and rejects an unrecognized one', async () => {
          const adminUser = await db('users').where({ email: 'admin' }).first();
          const { token } = await createSession(db, adminUser.id);
          const app = buildTestApp();

          const authenticated = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
          expect(authenticated.status).toBe(200);
          expect(authenticated.body.role).toBe('admin');

          const rejected = await request(app).get('/protected').set('Authorization', 'Bearer nonsense');
          expect(rejected.status).toBe(401);
        });

        it('AC8: denies a valid non-admin session token on an admin-only route', async () => {
          const residentUser = await db('users').where({ email: 'resident' }).first();
          const { token } = await createSession(db, residentUser.id);
          const app = buildTestApp();

          const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(403);
        });

        it('AC8: grants a valid admin session token on an admin-only route', async () => {
          const adminUser = await db('users').where({ email: 'admin' }).first();
          const { token } = await createSession(db, adminUser.id);
          const app = buildTestApp();

          const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(200);
        });
      });
      ```
    files:
      - server/middleware/auth.test.ts
    rationale: |
      No production route is admin-gated yet outside the still-stubbed billing client, so this
      proves `requireRole` directly on throwaway routes rather than inventing a speculative
      production endpoint — the parent epic's next (billing API) story is expected to mount real
      routes behind this same middleware.
  - description: |
      Implement the auth HTTP routes (login/logout/session) and the Express app factory that
      mounts them.

      `server/routes/auth.ts`:
      ```ts
      import { Router } from 'express';
      import type { Knex } from 'knex';
      import { verifyPassword } from '../auth/password';
      import { createSession, revokeSession } from '../auth/sessions';
      import { requireSession } from '../middleware/requireSession';

      export function createAuthRouter(db: Knex): Router {
        const router = Router();

        router.post('/login', async (req, res) => {
          const { username, password } = req.body ?? {};
          if (typeof username !== 'string' || typeof password !== 'string') {
            res.status(400).json({ error: 'username and password are required' });
            return;
          }

          const userWithRole = await db('users')
            .join('roles', 'roles.id', 'users.role_id')
            .where('users.email', username)
            .select('users.id', 'users.password_hash', 'roles.name as role')
            .first();

          if (!userWithRole || !verifyPassword(password, userWithRole.password_hash)) {
            res.status(401).json({ error: 'Invalid username or password' });
            return;
          }

          const { token } = await createSession(db, userWithRole.id);
          res.status(200).json({ token, role: userWithRole.role });
        });

        router.post('/logout', requireSession(db), async (req, res) => {
          const token = (req.header('authorization') ?? '').slice('Bearer '.length);
          await revokeSession(db, token);
          res.status(204).end();
        });

        router.get('/session', requireSession(db), (req, res) => {
          res.status(200).json({ role: req.user!.role });
        });

        return router;
      }
      ```

      `server/app.ts`:
      ```ts
      import express, { type Express } from 'express';
      import type { Knex } from 'knex';
      import { createAuthRouter } from './routes/auth';

      export function createApp(db: Knex): Express {
        const app = express();
        app.use(express.json());
        app.use('/api/auth', createAuthRouter(db));
        return app;
      }
      ```
    files:
      - server/routes/auth.ts
      - server/app.ts
    rationale: |
      `createApp(db)` takes a `Knex` instance rather than constructing its own connection, so
      tests can pass a disposable per-test database (same pattern as
      `generateMonthlyBills(db, billingPeriod)`) and supertest can exercise the app in-process
      with no port bound.
  - description: |
      Write the failing route-level test suite first, against a disposable per-test SQLite file
      with migrations (including the two new ones) applied, using `supertest` against
      `createApp(db)`.

      `server/routes/auth.test.ts`:
      ```ts
      // @vitest-environment node
      import Knex, { type Knex as KnexType } from 'knex';
      import fs from 'node:fs';
      import os from 'node:os';
      import path from 'node:path';
      import request from 'supertest';
      import { afterEach, beforeEach, describe, expect, it } from 'vitest';
      import { createApp } from '../app';

      let db: KnexType;
      let tmpDir: string;

      beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartment-auth-'));
        db = Knex({
          client: 'better-sqlite3',
          connection: { filename: path.join(tmpDir, 'test.sqlite3') },
          useNullAsDefault: true,
          migrations: { directory: path.join(__dirname, '..', '..', 'db', 'migrations'), extension: 'cjs' },
        });
        await db.migrate.latest();
      });

      afterEach(async () => {
        await db.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });

      describe('auth API', () => {
        it('AC1: issues a session token for valid admin credentials', async () => {
          const res = await request(createApp(db)).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
          expect(res.status).toBe(200);
          expect(typeof res.body.token).toBe('string');
          expect(res.body.token.length).toBeGreaterThan(0);
        });

        it('AC3/AC4: rejects invalid credentials and issues no session token', async () => {
          const res = await request(createApp(db)).post('/api/auth/login').send({ username: 'admin', password: 'wrong-password' });
          expect(res.status).toBe(401);
          expect(res.body.token).toBeUndefined();
          expect(await db('sessions')).toHaveLength(0);
        });

        it('AC5: authenticates a subsequent request using the issued token', async () => {
          const app = createApp(db);
          const loginRes = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
          const sessionRes = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${loginRes.body.token}`);
          expect(sessionRes.status).toBe(200);
          expect(sessionRes.body.role).toBe('admin');
        });

        it('AC6: rejects a request with an unrecognized or expired token', async () => {
          const app = createApp(db);
          const unrecognized = await request(app).get('/api/auth/session').set('Authorization', 'Bearer not-a-real-token');
          expect(unrecognized.status).toBe(401);

          const adminUser = await db('users').where({ email: 'admin' }).first();
          await db('sessions').insert({ token: 'expired-token', user_id: adminUser.id, expires_at: new Date(Date.now() - 1000) });
          const expired = await request(app).get('/api/auth/session').set('Authorization', 'Bearer expired-token');
          expect(expired.status).toBe(401);
        });

        it('AC9: rejects a request with a token after logout', async () => {
          const app = createApp(db);
          const loginRes = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
          const token = loginRes.body.token;
          await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`).expect(204);
          const res = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(401);
        });
      });
      ```
    files:
      - server/routes/auth.test.ts
    rationale: |
      Fails immediately (no `../app` module, no seeded users) before the scope items above exist;
      end-to-end covers AC1/AC3/AC4/AC5/AC6/AC9 through the real HTTP surface rather than mocking
      any layer.
  - description: |
      Add a dev entrypoint that runs the Express app as its own process, and wire the Vite dev
      server to proxy `/api` to it, reusing the two ports already reserved in `.env`
      (`ARC_DEV_PORT` for this API server, `ARC_WEB_PORT` implicitly for Vite's own dev server).

      `server/index.ts`:
      ```ts
      import Knex from 'knex';
      import knexConfig from '../db/knexfile.cjs';
      import { createApp } from './app';

      const db = Knex(knexConfig);
      const app = createApp(db);
      const port = Number(process.env.ARC_DEV_PORT) || 8001;

      app.listen(port, () => {
        console.log(`API server listening on port ${port}`);
      });
      ```

      `vite.config.ts` addition:
      ```ts
      server: {
        proxy: {
          '/api': {
            target: `http://localhost:${process.env.ARC_DEV_PORT || 8001}`,
            changeOrigin: true,
          },
        },
      },
      ```
    files:
      - server/index.ts
      - vite.config.ts
    rationale: |
      Keeps the API server a separate Node process from Vite (no native `better-sqlite3` binding
      loaded into Vite's config/plugin process) while still letting the frontend call same-origin
      relative paths (`fetch('/api/auth/login')`) in `npm run dev`, with the proxy forwarding to
      wherever the API process is actually listening.
  - description: |
      Add `express`/`supertest` dependencies and a `dev:api` script to run the new server.

      `package.json` dependencies added: `express`.
      `package.json` devDependencies added: `@types/express`, `supertest`, `@types/supertest`, `tsx`.
      `package.json` scripts added:
      ```json
      "dev:api": "tsx server/index.ts"
      ```
    files:
      - package.json
    rationale: |
      `tsx` runs the TypeScript entrypoint directly in dev with no separate build step, matching
      how this repo already runs TS test files directly under Vitest without a compile step.
  - description: |
      Add a thin frontend client wrapping `fetch` calls to the three auth endpoints, replacing
      `src/auth/credentials.ts`'s synchronous, client-only `authenticate()`.

      `src/auth/authApiClient.ts`:
      ```ts
      import type { Role } from './AuthContext';

      export interface LoginResult {
        token: string;
        role: Role;
      }

      export interface SessionResult {
        role: Role;
      }

      export async function login(username: string, password: string): Promise<LoginResult | null> {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        if (!response.ok) return null;
        return (await response.json()) as LoginResult;
      }

      export async function fetchSession(token: string): Promise<SessionResult | null> {
        const response = await fetch('/api/auth/session', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return null;
        return (await response.json()) as SessionResult;
      }

      export async function logout(token: string): Promise<void> {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      ```
    files:
      - src/auth/authApiClient.ts
    rationale: |
      Named functions returning `null` on failure (not throwing) mirror `credentials.ts`'s
      `authenticate()` return-`null`-on-failure shape, so callers (`AuthContext`) branch on a
      value rather than a try/catch.
  - description: |
      Write the failing unit test for the client first, stubbing the global `fetch`.

      `src/auth/authApiClient.test.ts`:
      ```ts
      import { afterEach, describe, expect, it, vi } from 'vitest';
      import { fetchSession, login, logout } from './authApiClient';

      describe('authApiClient', () => {
        afterEach(() => {
          vi.unstubAllGlobals();
        });

        it('AC1/AC2: returns the issued token and role on a successful login', async () => {
          vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'abc123', role: 'admin' }) }));
          const result = await login('admin', 'admin123');
          expect(result).toEqual({ token: 'abc123', role: 'admin' });
        });

        it('AC3/AC4: returns null and surfaces no token when the API rejects credentials', async () => {
          vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Invalid username or password' }) }));
          const result = await login('admin', 'wrong-password');
          expect(result).toBeNull();
        });

        it('AC6: returns null when the session token is rejected', async () => {
          vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Unauthorized' }) }));
          const result = await fetchSession('bad-token');
          expect(result).toBeNull();
        });

        it('AC9: sends the bearer token when logging out', async () => {
          const fetchMock = vi.fn().mockResolvedValue({ ok: true });
          vi.stubGlobal('fetch', fetchMock);
          await logout('abc123');
          expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({
            headers: { Authorization: 'Bearer abc123' },
          }));
        });
      });
      ```
    files:
      - src/auth/authApiClient.test.ts
    rationale: |
      Isolates fetch/response-shape handling from component-level tests, which mock this whole
      module instead of stubbing `fetch` themselves (consistent with how `AdminBillingScreen.test.tsx`
      mocks `billingClient` rather than the network).
  - description: |
      Rewrite `AuthContext` so `login` takes credentials and calls the API instead of accepting a
      client-supplied role, and so a token found in `localStorage` on mount is re-validated against
      `/api/auth/session` before the context reports itself authenticated.

      `src/auth/AuthContext.tsx` — signature change:
      ```ts
      // before
      login: (role: Role) => void;
      // after
      login: (username: string, password: string) => Promise<Role | null>;
      ```

      Full file:
      ```tsx
      import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react';
      import { logger } from '../lib/logger';
      import { fetchSession, login as requestLogin, logout as requestLogout } from './authApiClient';

      export type Role = 'admin' | 'resident';

      export interface AuthContextValue {
        isAuthenticated: boolean;
        role: Role | null;
        isInitializing: boolean;
        login: (username: string, password: string) => Promise<Role | null>;
        logout: () => void;
      }

      export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

      const SESSION_STORAGE_KEY = 'sessionToken';

      export function AuthProvider({ children }: { children: ReactNode }) {
        const [token, setToken] = useState<string | null>(() => localStorage.getItem(SESSION_STORAGE_KEY));
        const [role, setRole] = useState<Role | null>(null);
        const [isInitializing, setIsInitializing] = useState(true);

        useEffect(() => {
          let cancelled = false;
          if (!token) {
            setIsInitializing(false);
            return;
          }
          fetchSession(token).then((session) => {
            if (cancelled) return;
            if (session) {
              setRole(session.role);
            } else {
              localStorage.removeItem(SESSION_STORAGE_KEY);
              setToken(null);
            }
            setIsInitializing(false);
          });
          return () => {
            cancelled = true;
          };
        }, [token]);

        const value = useMemo<AuthContextValue>(
          () => ({
            isAuthenticated: role !== null,
            role,
            isInitializing,
            login: async (username: string, password: string) => {
              const result = await requestLogin(username, password);
              if (!result) {
                logger.warn('auth_login_failed', { username });
                return null;
              }
              logger.info('auth_login', { role: result.role });
              localStorage.setItem(SESSION_STORAGE_KEY, result.token);
              setToken(result.token);
              setRole(result.role);
              return result.role;
            },
            logout: () => {
              if (token) {
                void requestLogout(token);
              }
              logger.info('auth_logout', { role });
              localStorage.removeItem(SESSION_STORAGE_KEY);
              setToken(null);
              setRole(null);
            },
          }),
          [role, token, isInitializing],
        );

        return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
      }
      ```
    files:
      - src/auth/AuthContext.tsx
    rationale: |
      Returning the resolved `Role` from `login()` (not just a boolean) lets `LoginScreen` navigate
      immediately using that value, without waiting on a second render to read updated context
      state. `isInitializing` exists specifically so `ProtectedRoute` doesn't redirect a valid
      returning session to `/login` before the async `fetchSession` check resolves (see next item).
  - description: |
      Make `ProtectedRoute` wait on `isInitializing` before deciding to redirect, so a page load
      with a still-valid stored token isn't kicked to `/login` while that token is being validated.

      `src/auth/ProtectedRoute.tsx` — add before the existing authentication check:
      ```tsx
      const { isAuthenticated, isInitializing, role } = useAuth();
      const location = useLocation();

      if (isInitializing) {
        return null;
      }
      ```
    files:
      - src/auth/ProtectedRoute.tsx
    rationale: |
      Existing `ProtectedRoute.test.tsx`/`App.test.tsx`/`Navigation.test.tsx` tests all render via
      `renderWithAuth`, which injects a fake context directly (never through `AuthProvider`), so
      adding `isInitializing: false` to that fake context (next item) makes this branch a no-op for
      every currently-passing test — zero regression risk.
  - description: |
      Update the shared test fake context to include the two new `AuthContextValue` fields so
      every existing test that uses it keeps compiling and passing unmodified.

      `src/test-utils.tsx` — the constructed auth value:
      ```ts
      const authValue = {
        isAuthenticated: role !== null,
        role,
        isInitializing: false,
        login: async () => null,
        logout: () => {},
      };
      ```
    files:
      - src/test-utils.tsx
    rationale: |
      `isInitializing: false` matches "already resolved," the same state every existing test
      implicitly assumed before this story; `login`'s new async signature is filled with a no-op
      matching its new return type so any test that happens to call it still type-checks.
  - description: |
      Write the failing test suite for session restoration/expiry/logout (AC5, AC7, AC9's frontend
      half), rendering the real `AuthProvider` (not the `renderWithAuth` fake) with
      `authApiClient` mocked.

      `src/auth/AuthContext.test.tsx`:
      ```tsx
      import { beforeEach, describe, expect, it, vi } from 'vitest';
      import { render, screen } from '@testing-library/react';
      import userEvent from '@testing-library/user-event';
      import { MemoryRouter } from 'react-router-dom';
      import { AuthProvider } from './AuthContext';
      import { App } from '../App';
      import * as authApiClient from './authApiClient';

      vi.mock('./authApiClient');

      function renderApp(initialEntries: string[]) {
        return render(
          <AuthProvider>
            <MemoryRouter initialEntries={initialEntries}>
              <App />
            </MemoryRouter>
          </AuthProvider>,
        );
      }

      describe('AuthProvider session restoration', () => {
        beforeEach(() => {
          localStorage.clear();
          vi.mocked(authApiClient.login).mockReset();
          vi.mocked(authApiClient.fetchSession).mockReset();
          vi.mocked(authApiClient.logout).mockReset();
        });

        it('AC5: restores an authenticated session from a valid stored token without re-login', async () => {
          localStorage.setItem('sessionToken', 'valid-token');
          vi.mocked(authApiClient.fetchSession).mockResolvedValue({ role: 'admin' });

          renderApp(['/admin/dashboard']);

          expect(await screen.findByRole('heading', { name: 'Admin Dashboard' })).toBeInTheDocument();
          expect(screen.queryByRole('heading', { name: 'Log in' })).not.toBeInTheDocument();
        });

        it('AC7: redirects to login when the stored token is invalid or expired', async () => {
          localStorage.setItem('sessionToken', 'expired-token');
          vi.mocked(authApiClient.fetchSession).mockResolvedValue(null);

          renderApp(['/admin/billing']);

          expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
          expect(localStorage.getItem('sessionToken')).toBeNull();
        });

        it('AC9: logging out clears the session so the protected route requires login again', async () => {
          localStorage.setItem('sessionToken', 'admin-token');
          vi.mocked(authApiClient.fetchSession).mockResolvedValue({ role: 'admin' });
          vi.mocked(authApiClient.logout).mockResolvedValue(undefined);
          const user = userEvent.setup();

          renderApp(['/admin/dashboard']);
          await screen.findByRole('heading', { name: 'Admin Dashboard' });

          await user.click(screen.getByRole('button', { name: 'Log out' }));

          expect(authApiClient.logout).toHaveBeenCalledWith('admin-token');
          expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
          expect(localStorage.getItem('sessionToken')).toBeNull();
        });
      });
      ```
    files:
      - src/auth/AuthContext.test.tsx
    rationale: |
      Fails against the current synchronous `AuthContext` (no `isInitializing`, no
      `authApiClient` import, `login` takes a `Role` not credentials) until the prior two scope
      items exist; this is the one place a "Log out" button is exercised (added to `AppShell`
      below), and the one place the redirect-on-invalid-token behavior (AC7) is proven with the
      real provider rather than the bypassed test fixture.
  - description: |
      Add a "Log out" action to `AppShell` — nothing in the current UI can trigger AC9's "they log
      out" otherwise, since no logout control exists anywhere in the tree today.

      `src/shell/AppShell.tsx`:
      ```tsx
      import { Outlet } from 'react-router-dom';
      import { Navigation } from './Navigation';
      import { useAuth } from '../auth/useAuth';

      export function AppShell() {
        const { logout } = useAuth();

        return (
          <div data-testid="app-shell">
            <header>
              <Navigation />
              <button type="button" onClick={logout}>
                Log out
              </button>
            </header>
            <main>
              <Outlet />
            </main>
          </div>
        );
      }
      ```
    files:
      - src/shell/AppShell.tsx
    rationale: |
      Placed in the shared shell (not per-screen) so it's available from every admin and resident
      screen alike, matching how `Navigation` is already shared shell chrome rather than
      per-screen.
  - description: |
      Rewrite `LoginScreen` to call the new async `login(username, password)` and navigate using
      the role it returns, instead of the removed synchronous `authenticate()` lookup.

      `src/screens/LoginScreen.tsx`:
      ```tsx
      import { useState, type FormEvent } from 'react';
      import { useNavigate } from 'react-router-dom';
      import { useAuth } from '../auth/useAuth';
      import { navConfigByRole } from '../shell/navConfig';
      import { logger } from '../lib/logger';

      export function LoginScreen() {
        const { login } = useAuth();
        const navigate = useNavigate();
        const [username, setUsername] = useState('');
        const [password, setPassword] = useState('');
        const [error, setError] = useState<string | null>(null);

        async function handleSubmit(event: FormEvent<HTMLFormElement>) {
          event.preventDefault();

          const resolvedRole = await login(username, password);
          if (!resolvedRole) {
            logger.warn('login_failed', { username });
            setError('Invalid username or password.');
            return;
          }

          navigate(navConfigByRole[resolvedRole][0].path, { replace: true });
        }

        return (
          <div>
            <h1>Log in</h1>
            <form onSubmit={handleSubmit}>
              <label htmlFor="username">Username</label>
              <input
                id="username"
                name="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {error && <p role="alert">{error}</p>}
              <button type="submit">Log in</button>
            </form>
          </div>
        );
      }
      ```
    files:
      - src/screens/LoginScreen.tsx
    rationale: |
      Keeps the same labels/markup/`role="alert"` error pattern already covered by
      `LoginScreen.test.tsx`; only the submit handler becomes async and delegates entirely to
      `AuthContext.login`, which now owns the real API call.
  - description: |
      Update `LoginScreen.test.tsx` to mock `authApiClient` (replacing the removed
      `src/auth/credentials.ts`) and assert against the async flow.

      `src/screens/LoginScreen.test.tsx`:
      ```tsx
      import { beforeEach, describe, expect, it, vi } from 'vitest';
      import { render, screen } from '@testing-library/react';
      import userEvent from '@testing-library/user-event';
      import { MemoryRouter } from 'react-router-dom';
      import { AuthProvider } from '../auth/AuthContext';
      import { App } from '../App';
      import * as authApiClient from '../auth/authApiClient';

      vi.mock('../auth/authApiClient');

      beforeEach(() => {
        localStorage.clear();
        vi.mocked(authApiClient.fetchSession).mockResolvedValue(null);
      });

      describe('LoginScreen', () => {
        it('AC1/AC2: authenticates via the session API on submit and navigates into the shell', async () => {
          vi.mocked(authApiClient.login).mockResolvedValue({ token: 'session-token-abc', role: 'admin' });
          const user = userEvent.setup();
          render(
            <AuthProvider>
              <MemoryRouter initialEntries={['/login']}>
                <App />
              </MemoryRouter>
            </AuthProvider>,
          );

          await user.type(screen.getByLabelText('Username'), 'admin');
          await user.type(screen.getByLabelText('Password'), 'admin123');
          await user.click(screen.getByRole('button', { name: 'Log in' }));

          expect(await screen.findByTestId('app-shell')).toBeInTheDocument();
          expect(screen.getByRole('heading', { name: 'Admin Dashboard' })).toBeInTheDocument();
          expect(localStorage.getItem('sessionToken')).toBe('session-token-abc');
        });

        it('AC3: rejects invalid credentials and keeps the user on the login screen with no auth granted', async () => {
          vi.mocked(authApiClient.login).mockResolvedValue(null);
          const user = userEvent.setup();
          render(
            <AuthProvider>
              <MemoryRouter initialEntries={['/login']}>
                <App />
              </MemoryRouter>
            </AuthProvider>,
          );

          await user.type(screen.getByLabelText('Username'), 'admin');
          await user.type(screen.getByLabelText('Password'), 'wrong-password');
          await user.click(screen.getByRole('button', { name: 'Log in' }));

          expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password.');
          expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
        });
      });
      ```
    files:
      - src/screens/LoginScreen.test.tsx
    rationale: |
      Renders through the real `AuthProvider` (not `renderWithAuth`) since this test now exercises
      the full login round-trip through `AuthContext`; `authApiClient.fetchSession` is mocked to
      resolve `null` so the pre-login `isInitializing` check resolves immediately with no stored
      token, matching a fresh visit to `/login`.
  - description: |
      Delete the now-unused client-only credential store; its `authenticate()` lookup is fully
      replaced by the real API (`server/routes/auth.ts` + `src/auth/authApiClient.ts`).
    files:
      - src/auth/credentials.ts
    rationale: |
      Nothing imports `credentials.ts` once `LoginScreen.tsx` is updated (verified: it was the
      only importer); leaving it in place would be a second, now-fictional source of truth for
      "who can log in."
  - description: |
      Update the stale comment in `billingClient.ts` that pointed at `credentials.ts` (now
      deleted) as an example of the "no backend yet" deferral pattern.

      `src/screens/admin/billing/billingClient.ts` — comment only:
      ```ts
      // before
      // Placeholder billing client for the admin billing screen. There is no backend/API layer in
      // this codebase yet (see src/auth/credentials.ts for the same deferral); once one exists,
      // these must call it directly, backed by db/services/generateMonthlyBills.ts.
      // after
      // Placeholder billing client for the admin billing screen. This story added a real HTTP API
      // layer (server/app.ts) for authentication only; billing has no API yet — once one exists,
      // these must call it directly, backed by db/services/generateMonthlyBills.ts.
      ```
    files:
      - src/screens/admin/billing/billingClient.ts
    rationale: |
      Comment-only change so a future reader isn't pointed at a file this story deletes; no
      functional change, and wiring `billingClient` to a real billing API stays out of scope (the
      parent epic's separate, not-yet-started billing API story).
tests:
  - |
    AC1 — a valid admin login issues a session token:
    ```ts
    const res = await request(createApp(db)).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    ```
  - |
    AC2 — the frontend authenticates using the issued token, not a client-set role (asserted by the
    new async `login` signature and by the token landing in storage):
    ```tsx
    vi.mocked(authApiClient.login).mockResolvedValue({ token: 'session-token-abc', role: 'admin' });
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByTestId('app-shell')).toBeInTheDocument();
    expect(localStorage.getItem('sessionToken')).toBe('session-token-abc');
    ```
  - |
    AC3 — invalid credentials are rejected by the API:
    ```ts
    const res = await request(createApp(db)).post('/api/auth/login').send({ username: 'admin', password: 'wrong-password' });
    expect(res.status).toBe(401);
    ```
  - |
    AC4 — invalid credentials issue no session token:
    ```ts
    expect(res.body.token).toBeUndefined();
    expect(await db('sessions')).toHaveLength(0);
    ```
  - |
    AC5 — a subsequent API request with the issued token is authenticated without re-entering
    credentials:
    ```ts
    const sessionRes = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${token}`);
    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.role).toBe('admin');
    ```
  - |
    AC6 — an invalid or expired token is rejected as unauthorized:
    ```ts
    const unrecognized = await request(app).get('/api/auth/session').set('Authorization', 'Bearer not-a-real-token');
    expect(unrecognized.status).toBe(401);
    // and, with a session row whose expires_at is already in the past:
    expect(expired.status).toBe(401);
    ```
  - |
    AC7 — an invalid/expired token redirects a protected page to login:
    ```tsx
    localStorage.setItem('sessionToken', 'expired-token');
    vi.mocked(authApiClient.fetchSession).mockResolvedValue(null);
    renderApp(['/admin/billing']);
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    ```
  - |
    AC8 — a valid non-admin token is denied on an admin-only route:
    ```ts
    const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${residentToken}`);
    expect(res.status).toBe(403);
    ```
    (the screen-level half of AC8 — a resident deep-linking into `/admin/billing` lands on their
    own dashboard, not "Billing" — is already covered by the existing, unmodified
    `src/auth/ProtectedRoute.test.tsx`, whose fake context now also carries `isInitializing: false`.)
  - |
    AC9 — logging out invalidates the token so a subsequent request is rejected:
    ```ts
    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`).expect(204);
    const res = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    ```
    and on the frontend:
    ```tsx
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(authApiClient.logout).toHaveBeenCalledWith('admin-token');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    ```
assumptions_or_open_questions:
  - |
    No HTTP server exists anywhere in this repo before this story. I chose Express for
    `server/app.ts` (small surface, easy to test with `supertest`, no new native dependency beyond
    what `better-sqlite3` already requires) — please confirm that's an acceptable choice, since the
    parent epic's next story (a real billing/maintenance API) is expected to build directly on
    this app and its `requireSession`/`requireRole` middleware.
  - |
    Demo credentials (`admin`/`admin123`, `resident`/`resident123`) are preserved by seeding
    matching `users`/`roles` rows via a new data migration, using the existing `email` column to
    hold the plain username string. This keeps `LoginScreen`'s existing UI values working
    end-to-end against the real backend without inventing a separate username column or changing
    the demo values — confirm this is acceptable rather than wanting a distinct admin-provisioning
    story.
  - |
    Session tokens are opaque random values in a new `sessions` table (not JWTs), with a fixed
    24-hour TTL and revocation via `revoked_at`, because AC9 needs true server-side revocation,
    which a stateless JWT can't do without an extra blocklist. Nothing in the ACs specifies a TTL;
    24 hours is a placeholder — confirm it, or say what it should be.
  - |
    Dev wiring runs the API as its own process (`npm run dev:api`, listening on `ARC_DEV_PORT`,
    default 8001) alongside Vite's own dev server (`npm run dev`), bridged by a new Vite
    `server.proxy` entry for `/api`. This reuses the two ports already reserved in `.env`
    (`ARC_DEV_PORT` / `ARC_WEB_PORT`), though nothing in the repo previously documented their
    intended purpose — confirm this interpretation, or say if a single combined dev process is
    preferred instead. No production/build-time serving of the API is set up (`vite build` still
    only produces static frontend assets) since no deployment story exists yet in this repo.
  - |
    Password hashing uses Node's built-in `crypto.scryptSync` (salt+hash stored as `salt:hash` hex
    in the existing `password_hash` column) rather than adding bcrypt/argon2, to avoid a second
    native-module dependency beyond `better-sqlite3`. Confirm this is acceptable for this stage.
  - |
    `requireRole` is proven with its own middleware-level tests (mounted on throwaway test routes
    in `server/middleware/auth.test.ts`) but is not wired into any real production API route yet,
    since no admin-only business endpoint exists outside the still-stubbed `billingClient.ts` —
    this mirrors the precedent set by STORY-014's `GuardedActionButton`, which shipped as a tested,
    reusable primitive ahead of any concrete screen consuming it. Wiring a real admin-only API
    behind `requireRole('admin')` belongs to the parent epic's billing/maintenance API story.
  - |
    `server/**.ts` sits outside `tsconfig.json`'s `"include": ["src"]`, so — like the existing
    `db/**.ts` files — it is exercised by Vitest but not type-checked by `npm run build`'s `tsc`
    step. This matches existing precedent in this repo and is not a gap introduced by this plan.
package_dependencies:
  - name: express
    version: ^4.21.2
    ecosystem: npm
    rationale: |
      Runtime HTTP framework for the new `server/app.ts` — routing (`Router`), JSON body parsing,
      and middleware composition (`requireSession`, `requireRole`) for the login/logout/session
      endpoints this story adds.
  - name: "@types/express"
    version: ^4.17.21
    ecosystem: npm
    rationale: |
      TypeScript type definitions for `express`, used throughout `server/**.ts` (`Request`,
      `Response`, `NextFunction`, `Express`, `Router`).
  - name: supertest
    version: ^7.0.0
    ecosystem: npm
    rationale: |
      Exercises `createApp(db)` over HTTP in-process in `server/routes/auth.test.ts` and
      `server/middleware/auth.test.ts` without binding a real port, mirroring how this repo already
      tests DB-backed code against a real disposable SQLite file rather than mocking.
  - name: "@types/supertest"
    version: ^6.0.2
    ecosystem: npm
    rationale: |
      TypeScript type definitions for `supertest`, used in the two new server-side test files.
  - name: tsx
    version: ^4.19.2
    ecosystem: npm
    rationale: |
      Runs the TypeScript dev entrypoint `server/index.ts` directly (`npm run dev:api`) with no
      separate compile step, the same way this repo runs TypeScript test files directly today.
notes: |
  ```mermaid
  flowchart TD
    subgraph FrontendSrc[src]
      LoginScreen[screens/LoginScreen.tsx]
      AuthContext[auth/AuthContext.tsx]
      AuthApiClient[auth/authApiClient.ts]
      ProtectedRoute[auth/ProtectedRoute.tsx]
      AppShell[shell/AppShell.tsx]
      Navigation[shell/Navigation.tsx]
    end
    subgraph BackendServer[server]
      App[app.ts]
      AuthRouter[routes/auth.ts]
      ReqSession[middleware/requireSession.ts]
      ReqRole[middleware/requireRole.ts]
      Sessions[auth/sessions.ts]
      Password[auth/password.ts]
      Index[index.ts - dev entrypoint]
    end
    subgraph DataDb[db]
      UsersTable[(users table)]
      RolesTable[(roles table)]
      SessionsTable[(sessions table)]
      SessionsMigration[/migration: create sessions table/]
      SeedMigration[/migration: seed demo users/]
    end

    LoginScreen -->|await login username password| AuthContext
    AppShell -->|onClick logout| AuthContext
    AuthContext -->|login/logout/fetchSession over fetch| AuthApiClient
    AuthApiClient -->|HTTP via Vite proxy /api| AuthRouter
    ProtectedRoute -->|reads isAuthenticated/role/isInitializing| AuthContext
    Navigation -->|reads role, unchanged| AuthContext

    Index --> App
    App --> AuthRouter
    AuthRouter --> ReqSession
    AuthRouter --> Password
    AuthRouter --> Sessions
    AuthRouter --> UsersTable
    ReqSession --> Sessions
    ReqRole -.future admin routes mount this.-> ReqRole
    Sessions --> SessionsTable
    Sessions --> UsersTable
    SessionsMigration --> SessionsTable
    SeedMigration --> UsersTable
    SeedMigration --> RolesTable

    classDef touched fill:#f96,color:#000
    class LoginScreen,AuthContext,AuthApiClient,ProtectedRoute,AppShell,App,AuthRouter,ReqSession,ReqRole,Sessions,Password,Index,SessionsMigration,SeedMigration touched
  ```

  Why session state lives server-side in a `sessions` table rather than a signed/stateless token:
  AC9 requires that logging out makes a previously-valid token stop working on the very next
  request. A stateless JWT (HMAC- or RSA-signed, no server-side record) cannot be individually
  revoked before its own expiry without maintaining a separate blocklist — at which point you have
  reinvented a sessions table anyway. Storing the token server-side from the start is simpler and
  is the same "real DB, no mocks" testing convention already used by
  `db/services/generateMonthlyBills.ts`.

  Why `requireRole` ships untethered to a real production route: no admin-only *business* endpoint
  exists yet in this repo — `billingClient.ts` is still a stub, and wiring it to a real, gated
  billing API is explicitly the parent epic's next story, not this one. This mirrors STORY-014's
  `GuardedActionButton`, which shipped fully tested but with no screen consuming it yet, rather
  than inventing a speculative business endpoint here just to exercise the middleware.

  Why two dev processes (Vite + a separate `server/index.ts`) instead of mounting Express inside a
  Vite plugin: it keeps the native `better-sqlite3` binding and the request-handling code entirely
  out of Vite's own config/plugin process, and keeps `createApp(db)` trivially testable in-process
  via `supertest` with no knowledge of Vite at all.
