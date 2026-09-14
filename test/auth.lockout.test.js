const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');
const sessionStore = require('../src/services/sessionStore');
const loginAttemptTracker = require('../src/services/loginAttemptTracker');
const authService = require('../src/services/authService');

test('POST /login lockout', async (t) => {
  let server;

  t.beforeEach(async () => {
    sessionStore.reset();
    loginAttemptTracker.reset();
    server = await startTestServer();
  });

  t.afterEach(async () => {
    await server.close();
  });

  async function attemptLogin(username, password) {
    return fetch(`${server.baseUrl}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  }

  await t.test('AC6: 6th attempt within 15 minutes is rejected with a lockout message even with correct credentials', async () => {
    for (let i = 0; i < 5; i += 1) {
      const response = await attemptLogin('admin', 'wrong-password');
      assert.equal(response.status, 401);
    }

    const lockedResponse = await attemptLogin('admin', 'test-admin-pass');
    assert.equal(lockedResponse.status, 429);
    const body = await lockedResponse.json();
    assert.match(body.error, /locked/i);
  });

  await t.test('AC7: while locked out, credentials are never evaluated', async (t) => {
    for (let i = 0; i < 5; i += 1) {
      await attemptLogin('resident', 'wrong-password');
    }

    const verifySpy = t.mock.method(authService, 'verifyCredentials');

    const response1 = await attemptLogin('resident', 'test-resident-pass');
    const response2 = await attemptLogin('resident', 'another-wrong-password');

    assert.equal(response1.status, 429);
    assert.equal(response2.status, 429);
    assert.equal(verifySpy.mock.callCount(), 0, 'verifyCredentials must not be called while locked out');
  });
});
