const sessionStore = require('../services/sessionStore');
const { parseCookies } = require('../utils/http');

function requireAuth(req, res, requiredRole) {
  const cookies = parseCookies(req);
  const session = sessionStore.getSession(cookies.session);
  if (!session) {
    res.writeHead(302, { Location: '/login' });
    res.end();
    return null;
  }
  if (requiredRole && session.role !== requiredRole) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return null;
  }
  return session;
}

module.exports = requireAuth;
