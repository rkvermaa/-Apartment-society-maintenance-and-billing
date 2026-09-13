const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');
const sessionStore = require('../src/services/sessionStore');
const loginAttemptTracker = require('../src/services/loginAttemptTracker');

test('Protected routes enforce role-based access control', async (t) => {
  let server;

  t.beforeEach(async () => {
    sessionStore.reset();
    loginAttemptTracker.reset();
    server = await startTestServer();
  });

  t.afterEach(async () => {
    await server.close();
  });

  async function login(username, password) {
    const response = await fetch(`${server.baseUrl}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return response.headers.get('set-cookie');
  }

  await t.test('a Resident session cannot access GET /admin', async () => {
    const cookieHeader = await login('resident', 'test-resident-pass');
    const response = await fetch(`${server.baseUrl}/admin`, {
      redirect: 'manual',
      headers: { Cookie: cookieHeader },
    });
    assert.equal(response.status, 403);
  });

  await t.test('an Admin session cannot access GET /resident', async () => {
    const cookieHeader = await login('admin', 'test-admin-pass');
    const response = await fetch(`${server.baseUrl}/resident`, {
      redirect: 'manual',
      headers: { Cookie: cookieHeader },
    });
    assert.equal(response.status, 403);
  });

  await t.test('an Admin session can still access GET /admin', async () => {
    const cookieHeader = await login('admin', 'test-admin-pass');
    const response = await fetch(`${server.baseUrl}/admin`, {
      redirect: 'manual',
      headers: { Cookie: cookieHeader },
    });
    assert.equal(response.status, 200);
  });

  await t.test('a Resident session can still access GET /resident', async () => {
    const cookieHeader = await login('resident', 'test-resident-pass');
    const response = await fetch(`${server.baseUrl}/resident`, {
      redirect: 'manual',
      headers: { Cookie: cookieHeader },
    });
    assert.equal(response.status, 200);
  });
});
