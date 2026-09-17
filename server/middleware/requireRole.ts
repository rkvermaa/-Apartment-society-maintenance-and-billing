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
