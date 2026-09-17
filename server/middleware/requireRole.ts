import type { NextFunction, Request, Response } from 'express';
import { verifySessionToken } from '../auth/session';
import type { Role } from '../auth/role';

export type { Role };

function extractBearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

export function requireRole(allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const session = verifySessionToken(token);
    if (!session) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    if (!allowedRoles.includes(session.role)) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }

    next();
  };
}
