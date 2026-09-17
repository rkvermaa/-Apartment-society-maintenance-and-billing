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
