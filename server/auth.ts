import type { NextFunction, Request, Response } from 'express';

export type DemoRole = 'admin' | 'resident';

// Interim, NOT a real security boundary: this codebase has no server-issued session or
// credential-verification mechanism yet (src/auth/credentials.ts and src/auth/AuthContext.tsx
// both defer that to the not-yet-built session-management story). Until that exists, the API
// trusts the caller-asserted role via this header exactly as much as the rest of the app
// already trusts an unverified client-held role in AuthContext - it is not stronger or
// weaker than the app's existing trust model, just enforced at one more layer.
export function requireRole(allowedRole: DemoRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.header('x-demo-role');
    if (!role) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (role !== allowedRole) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }
    next();
  };
}
