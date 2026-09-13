const crypto = require('node:crypto');

const KEY_LENGTH = 64;

function hash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, KEY_LENGTH);
  return `${salt}:${derivedKey.toString('hex')}`;
}

function verify(password, storedHash) {
  const [salt, key] = storedHash.split(':');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, KEY_LENGTH);
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

module.exports = { hash, verify };
