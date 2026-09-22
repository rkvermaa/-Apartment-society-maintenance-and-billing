import type { NextFunction, Request, Response } from 'express';
import { resolveDemoResidentFlatId } from './demoResidentFlats';

export type DemoRole = 'admin' | 'resident';

export interface ResidentFlatRequest extends Request {
  demoResidentFlatId?: number;
}

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

// Closes the gap `requireRole` alone leaves open: knowing the caller asserts the "resident"
// role says nothing about which flat they may see, and a bare client-supplied flat id would let
// any resident-role caller read any flat's bills just by varying that id. This resolves the
// caller's own flat id from their asserted demo username against a server-held mapping (as
// interim/unverified as the role header, but not additionally attacker-controlled), so a route
// can compare it against what was requested and reject a mismatch.
export function requireResidentFlat() {
  return (req: ResidentFlatRequest, res: Response, next: NextFunction) => {
    const username = req.header('x-demo-username');
    if (!username) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const flatId = resolveDemoResidentFlatId(username);
    if (flatId === null) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }
    req.demoResidentFlatId = flatId;
    next();
  };
}
