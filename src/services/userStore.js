const passwordService = require('./passwordService');
const seedUsers = require('../fixtures/users');

const users = new Map();

for (const seedUser of seedUsers) {
  users.set(seedUser.username, {
    username: seedUser.username,
    passwordHash: passwordService.hash(seedUser.password),
    role: seedUser.role,
  });
}

function findByUsername(username) {
  return users.get(username) || null;
}

module.exports = { findByUsername };
