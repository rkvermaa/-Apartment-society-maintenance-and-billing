import { createHash } from 'node:crypto';
import type { Role } from './role';

interface DemoUser {
  username: string;
  passwordHash: string;
  role: Role;
}

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

// Demo credential store for this codebase's shell login. A real deployment
// would replace this with a verified user store (a database of salted,
// slow-hashed passwords, an identity provider, etc.); this is the server-side
// source of truth so that role can only ever come from a credential check the
// server itself performed, never from anything the client asserts. Passwords
// are kept only as hashes, never in plaintext, even in this demo store.
const DEMO_USERS: DemoUser[] = [
  { username: 'admin', passwordHash: hashPassword('admin123'), role: 'admin' },
  { username: 'resident', passwordHash: hashPassword('resident123'), role: 'resident' },
];

export function authenticate(username: string, password: string): Role | null {
  const passwordHash = hashPassword(password);
  const user = DEMO_USERS.find(
    (candidate) => candidate.username === username && candidate.passwordHash === passwordHash,
  );
  return user ? user.role : null;
}
