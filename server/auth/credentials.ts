import { compareSync, hashSync } from 'bcrypt';
import type { Role } from './role';

const BCRYPT_SALT_ROUNDS = 10;

interface DemoUser {
  username: string;
  passwordHash: string;
  role: Role;
}

// Demo credential store for this codebase's shell login. A real deployment
// would replace this with a verified user store (a database of salted,
// slow-hashed passwords, an identity provider, etc.); this is the server-side
// source of truth so that role can only ever come from a credential check the
// server itself performed, never from anything the client asserts. Passwords
// are kept only as bcrypt hashes (salted, deliberately slow), never in
// plaintext or as a fast unsalted digest, even in this demo store.
const DEMO_USERS: DemoUser[] = [
  { username: 'admin', passwordHash: hashSync('admin123', BCRYPT_SALT_ROUNDS), role: 'admin' },
  { username: 'resident', passwordHash: hashSync('resident123', BCRYPT_SALT_ROUNDS), role: 'resident' },
];

export function authenticate(username: string, password: string): Role | null {
  const user = DEMO_USERS.find((candidate) => candidate.username === username);
  if (!user || !compareSync(password, user.passwordHash)) {
    return null;
  }
  return user.role;
}
