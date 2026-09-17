import type { Role } from './AuthContext';

interface DemoUser {
  username: string;
  password: string;
  role: Role;
}

// Demo credential store, verified server-side only (see server/session.ts) so that role
// can never be asserted by the client. A real `users`-table-backed credential store is
// STORY-013's job; once that lands, this lookup is replaced without changing any caller
// of authenticate(), since verification already happens exclusively on the server.
const DEMO_USERS: DemoUser[] = [
  { username: 'admin', password: 'admin123', role: 'admin' },
  { username: 'resident', password: 'resident123', role: 'resident' },
];

export function authenticate(username: string, password: string): Role | null {
  const user = DEMO_USERS.find((candidate) => candidate.username === username && candidate.password === password);
  return user ? user.role : null;
}
