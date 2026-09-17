import jwt from 'jsonwebtoken';
import type { Role } from './role';

const SESSION_SECRET = process.env.AUTH_SESSION_SECRET || 'dev-only-insecure-session-secret';
const SESSION_TTL_SECONDS = 60 * 60;

export interface SessionPayload {
  role: Role;
}

export function issueSessionToken(role: Role): string {
  return jwt.sign({ role }, SESSION_SECRET, { expiresIn: SESSION_TTL_SECONDS });
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, SESSION_SECRET);
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      (decoded.role === 'admin' || decoded.role === 'resident')
    ) {
      return { role: decoded.role };
    }
    return null;
  } catch {
    return null;
  }
}
