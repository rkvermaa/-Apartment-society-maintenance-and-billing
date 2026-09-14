const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');
const sessionStore = require('../src/services/sessionStore');
const loginAttemptTracker = require('../src/services/loginAttemptTracker');

test('Session cookies carry a SameSite attribute to mitigate CSRF', async (t) => {
  let server;
  let cookieHeader;

  t.beforeEach(async () => {
    sessionStore.reset();
    loginAttemptTracker.reset();
    server = await startTestServer();
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test('POST /login sets SameSite=Lax on the session cookie', async () => {
    const response = await fetch(`${server.baseUrl}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test-admin-pass' }),
    });

    cookieHeader = response.headers.get('set-cookie');
    assert.match(cookieHeader, /SameSite=Lax/i);
    assert.match(cookieHeader, /;\s*Secure/i);
  });

  await t.test('POST /logout sets SameSite=Lax on the cleared cookie', async () => {
    const loginResponse = await fetch(`${server.baseUrl}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test-admin-pass' }),
    });

    const response = await fetch(`${server.baseUrl}/logout`, {
      method: 'POST',
      redirect: 'manual',
      headers: { Cookie: loginResponse.headers.get('set-cookie') },
    });

    const clearedCookie = response.headers.get('set-cookie');
    assert.match(clearedCookie, /SameSite=Lax/i);
    assert.match(clearedCookie, /;\s*Secure/i);
  });
});
