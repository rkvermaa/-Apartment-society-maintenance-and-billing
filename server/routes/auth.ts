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
