const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');
const sessionStore = require('../src/services/sessionStore');
const loginAttemptTracker = require('../src/services/loginAttemptTracker');

test('AC9: unauthenticated access to protected routes redirects to /login', async (t) => {
  let server;

  t.beforeEach(async () => {
    sessionStore.reset();
    loginAttemptTracker.reset();
    server = await startTestServer();
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test('GET /admin with no session cookie redirects to /login', async () => {
    const response = await fetch(`${server.baseUrl}/admin`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
  });

  await t.test('GET /resident with no session cookie redirects to /login', async () => {
    const response = await fetch(`${server.baseUrl}/resident`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
  });
});
