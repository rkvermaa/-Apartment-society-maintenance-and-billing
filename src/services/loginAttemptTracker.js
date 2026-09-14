const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const attempts = new Map();

function isLockedOut(username) {
  const record = attempts.get(username);
  if (!record || !record.lockedUntil) return false;
  if (Date.now() >= record.lockedUntil) {
    attempts.delete(username);
    return false;
  }
  return true;
}

function recordFailure(username) {
  const record = attempts.get(username) || { count: 0, lockedUntil: null };
  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  attempts.set(username, record);
}

function recordSuccess(username) {
  attempts.delete(username);
}

function reset() {
  attempts.clear();
}

module.exports = { isLockedOut, recordFailure, recordSuccess, reset, MAX_ATTEMPTS, LOCKOUT_MS };
