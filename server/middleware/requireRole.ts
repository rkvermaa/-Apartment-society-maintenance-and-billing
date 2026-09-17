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
