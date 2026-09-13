const authService = require('../services/authService');
const sessionStore = require('../services/sessionStore');
const loginAttemptTracker = require('../services/loginAttemptTracker');
const { readJsonBody, parseCookies, PayloadTooLargeError } = require('../utils/http');

const ROLE_REDIRECTS = {
  admin: '/admin',
  resident: '/resident',
};

async function handleLogin(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request body is too large' }));
      return;
    }
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid request body' }));
    return;
  }

  const { username, password } = body;

  if (loginAttemptTracker.isLockedOut(username)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Account temporarily locked due to too many failed login attempts. Try again in 15 minutes.',
    }));
    return;
  }

  const user = authService.verifyCredentials(username, password);
  if (!user) {
    loginAttemptTracker.recordFailure(username);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid username or password' }));
    return;
  }

  loginAttemptTracker.recordSuccess(username);
  const token = sessionStore.createSession(user);
  const maxAgeSeconds = Math.floor(sessionStore.SESSION_TTL_MS / 1000);
  const redirectPath = ROLE_REDIRECTS[user.role] || '/';

  res.writeHead(302, {
    'Set-Cookie': `session=${token}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`,
    Location: redirectPath,
  });
  res.end();
}

function handleLogout(req, res) {
  const cookies = parseCookies(req);
  if (cookies.session) {
    sessionStore.destroySession(cookies.session);
  }
  res.writeHead(302, {
    'Set-Cookie': 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax',
    Location: '/login',
  });
  res.end();
}

function handleLoginPage(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<html><body><h1>Login</h1></body></html>');
}

module.exports = { handleLogin, handleLogout, handleLoginPage };
