const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');
const sessionStore = require('../src/services/sessionStore');
const loginAttemptTracker = require('../src/services/loginAttemptTracker');

test('AC8: a session older than 24h is rejected and redirects to /login', async (t) => {
  sessionStore.reset();
  loginAttemptTracker.reset();
  const server = await startTestServer();
  t.after(async () => {
    t.mock.timers.reset();
    await server.close();
  });

  const loginResponse = await fetch(`${server.baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-admin-pass' }),
  });
  const cookieHeader = loginResponse.headers.get('set-cookie');
  assert.ok(cookieHeader, 'expected login to issue a session cookie');

  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  t.mock.timers.tick(24 * 60 * 60 * 1000 + 1000);

  const protectedResponse = await fetch(`${server.baseUrl}/admin`, {
    redirect: 'manual',
    headers: { Cookie: cookieHeader },
  });

  assert.equal(protectedResponse.status, 302);
  assert.equal(protectedResponse.headers.get('location'), '/login');
});
