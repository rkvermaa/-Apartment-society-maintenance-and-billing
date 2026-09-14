const crypto = require('node:crypto');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const sessions = new Map();

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    username: user.username,
    role: user.role,
    issuedAt: Date.now(),
  });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.issuedAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  sessions.delete(token);
}

function reset() {
  sessions.clear();
}

module.exports = { createSession, getSession, destroySession, reset, SESSION_TTL_MS };
