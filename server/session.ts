import crypto from 'node:crypto';
import { authenticate } from '../src/auth/credentials';
import type { Role } from '../src/auth/AuthContext';

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-insecure-session-secret';

export interface SessionPayload {
  username: string;
  role: Role;
}

function sign(value: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

export function issueSessionToken(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const providedSignature = Buffer.from(signature);
  const expectedSignature = Buffer.from(sign(body));
  if (providedSignature.length !== expectedSignature.length) return null;
  if (!crypto.timingSafeEqual(providedSignature, expectedSignature)) return null;

  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return null;
  }
}

export function loginWithCredentials(
  username: string,
  password: string,
): (SessionPayload & { token: string }) | null {
  const role = authenticate(username, password);
  if (!role) return null;
  return { username, role, token: issueSessionToken({ username, role }) };
}
