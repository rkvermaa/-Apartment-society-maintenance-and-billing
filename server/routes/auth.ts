import { Router } from 'express';
import { authenticate } from '../auth/credentials';
import { issueSessionToken } from '../auth/session';

export function createAuthRouter(): Router {
  const router = Router();

  router.post('/login', (req, res) => {
    const { username, password } = req.body as { username?: unknown; password?: unknown };
    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'username and password are required.' });
      return;
    }

    const role = authenticate(username, password);
    if (!role) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    res.status(200).json({ role, token: issueSessionToken(role) });
  });

  return router;
}
