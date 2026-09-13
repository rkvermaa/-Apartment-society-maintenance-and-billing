const sessionStore = require('../services/sessionStore');
const { parseCookies } = require('../utils/http');

function requireAuth(req, res) {
  const cookies = parseCookies(req);
  const session = sessionStore.getSession(cookies.session);
  if (!session) {
    res.writeHead(302, { Location: '/login' });
    res.end();
    return null;
  }
  return session;
}

module.exports = requireAuth;
