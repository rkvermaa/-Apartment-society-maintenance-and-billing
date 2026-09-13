const passwordService = require('./passwordService');

const users = new Map();

function seedUser({ username, password, role }) {
  users.set(username, {
    username,
    passwordHash: passwordService.hash(password),
    role,
  });
}

function seedFromEnvironment(env = process.env) {
  const candidates = [
    { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD, role: 'admin' },
    { username: env.RESIDENT_USERNAME, password: env.RESIDENT_PASSWORD, role: 'resident' },
  ];
  for (const candidate of candidates) {
    if (candidate.username && candidate.password) {
      seedUser(candidate);
    }
  }
}

function findByUsername(username) {
  return users.get(username) || null;
}

function reset() {
  users.clear();
}

seedFromEnvironment();

module.exports = { findByUsername, seedUser, seedFromEnvironment, reset };
