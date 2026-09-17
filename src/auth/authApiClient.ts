import type { Role } from './AuthContext';

export interface LoginResult {
  token: string;
  role: Role;
}

export interface SessionResult {
  role: Role;
}

export async function login(username: string, password: string): Promise<LoginResult | null> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) return null;
  return (await response.json()) as LoginResult;
}

export async function fetchSession(token: string): Promise<SessionResult | null> {
  const response = await fetch('/api/auth/session', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  return (await response.json()) as SessionResult;
}

export async function logout(token: string): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}
