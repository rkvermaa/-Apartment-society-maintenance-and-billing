const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');
const sessionStore = require('../src/services/sessionStore');
const loginAttemptTracker = require('../src/services/loginAttemptTracker');

test('POST /login', async (t) => {
  let server;

  t.beforeEach(async () => {
    sessionStore.reset();
    loginAttemptTracker.reset();
    server = await startTestServer();
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test('AC1: valid Admin credentials issue a session token', async () => {
    const response = await fetch(`${server.baseUrl}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test-admin-pass' }),
    });

    const setCookie = response.headers.get('set-cookie');
    assert.ok(setCookie, 'expected a Set-Cookie header issuing a session token');
    assert.match(setCookie, /session=[a-f0-9]+/);
  });

  await t.test('AC2: valid Admin credentials redirect to the Admin area', async () => {
    const response = await fetch(`${server.baseUrl}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test-admin-pass' }),
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/admin');
  });

  await t.test('AC3: valid Resident credentials redirect to the Resident area', async () => {
    const response = await fetch(`${server.baseUrl}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'resident', password: 'test-resident-pass' }),
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/resident');
  });

  await t.test('AC4: invalid username or password returns an error message', async () => {
    const response = await fetch(`${server.baseUrl}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
    });

    assert.equal(response.status, 401);
    const body = await response.json();
    assert.ok(body.error, 'expected an error message in the response body');
  });

  await t.test('AC5: invalid credentials create no session', async () => {
    const response = await fetch(`${server.baseUrl}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
    });

    assert.equal(response.headers.get('set-cookie'), null, 'no session cookie should be set');

    const cookieHeader = response.headers.get('set-cookie') || 'session=bogus-token';
    const protectedResponse = await fetch(`${server.baseUrl}/admin`, {
      redirect: 'manual',
      headers: { Cookie: cookieHeader },
    });

    assert.equal(protectedResponse.status, 302);
    assert.equal(protectedResponse.headers.get('location'), '/login');
  });
});
