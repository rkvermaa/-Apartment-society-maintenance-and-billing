import type { Role } from './role';

interface DemoUser {
  username: string;
  password: string;
  role: Role;
}

// Demo credential store for this codebase's shell login. A real deployment
// would replace this with a verified user store (hashed passwords in a
// database, an identity provider, etc.); this is the server-side source of
// truth so that role can only ever come from a credential check the server
// itself performed, never from anything the client asserts.
const DEMO_USERS: DemoUser[] = [
  { username: 'admin', password: 'admin123', role: 'admin' },
  { username: 'resident', password: 'resident123', role: 'resident' },
];

export function authenticate(username: string, password: string): Role | null {
  const user = DEMO_USERS.find(
    (candidate) => candidate.username === username && candidate.password === password,
  );
  return user ? user.role : null;
}
