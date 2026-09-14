const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');
const sessionStore = require('../src/services/sessionStore');
const loginAttemptTracker = require('../src/services/loginAttemptTracker');

test('POST /login rejects oversized request bodies', async (t) => {
  sessionStore.reset();
  loginAttemptTracker.reset();
  const server = await startTestServer();
  t.after(async () => {
    await server.close();
  });

  const oversizedPassword = 'a'.repeat(2 * 1024 * 1024);
  const response = await fetch(`${server.baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: oversizedPassword }),
  });

  assert.equal(response.status, 413);
  const body = await response.json();
  assert.ok(body.error);
});
