import type { Role } from './AuthContext';

interface DemoUser {
  username: string;
  passphrase: string;
  role: Role;
  flatId: number | null;
}

export interface AuthenticatedDemoUser {
  role: Role;
  flatId: number | null;
}

// Placeholder credential store for the shell demo. The session-management
// story (STORY-013) owns real backend credential verification and
// server-issued session tokens; once that API exists, this lookup must be
// replaced with a call to it and role/flatId must be read only from that response.
const DEMO_USERS: DemoUser[] = [
  { username: 'admin', passphrase: 'admin123', role: 'admin', flatId: null },
  { username: 'resident', passphrase: 'resident123', role: 'resident', flatId: 1 },
];

export function authenticate(username: string, password: string): AuthenticatedDemoUser | null {
  const user = DEMO_USERS.find((candidate) => candidate.username === username && candidate.passphrase === password);
  return user ? { role: user.role, flatId: user.flatId } : null;
}
