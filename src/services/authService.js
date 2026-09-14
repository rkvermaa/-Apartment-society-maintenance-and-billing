const userStore = require('./userStore');
const passwordService = require('./passwordService');

function verifyCredentials(username, password) {
  const user = userStore.findByUsername(username);
  if (!user) return null;
  if (!passwordService.verify(password, user.passwordHash)) return null;
  return { username: user.username, role: user.role };
}

module.exports = { verifyCredentials };
