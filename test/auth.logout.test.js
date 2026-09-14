const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');
const sessionStore = require('../src/services/sessionStore');
const loginAttemptTracker = require('../src/services/loginAttemptTracker');

test('POST /logout', async (t) => {
  let server;
  let cookieHeader;

  t.beforeEach(async () => {
    sessionStore.reset();
    loginAttemptTracker.reset();
    server = await startTestServer();
    const loginResponse = await fetch(`${server.baseUrl}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test-admin-pass' }),
    });
    cookieHeader = loginResponse.headers.get('set-cookie');
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test('AC10: logging out invalidates the session token', async () => {
    await fetch(`${server.baseUrl}/logout`, {
      method: 'POST',
      redirect: 'manual',
      headers: { Cookie: cookieHeader },
    });

    const protectedResponse = await fetch(`${server.baseUrl}/admin`, {
      redirect: 'manual',
      headers: { Cookie: cookieHeader },
    });

    assert.equal(protectedResponse.status, 302);
    assert.equal(protectedResponse.headers.get('location'), '/login');
  });

  await t.test('AC11: logging out redirects to the login screen', async () => {
    const response = await fetch(`${server.baseUrl}/logout`, {
      method: 'POST',
      redirect: 'manual',
      headers: { Cookie: cookieHeader },
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
  });
});
