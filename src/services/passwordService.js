const crypto = require('node:crypto');

const KEY_LENGTH = 64;

function hash(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

function verify(password, storedHash) {
  const [saltHex, key] = storedHash.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, KEY_LENGTH);
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

module.exports = { hash, verify };
