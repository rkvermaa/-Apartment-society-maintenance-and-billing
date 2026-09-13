const test = require('node:test');
const assert = require('node:assert/strict');
const userStore = require('../src/services/userStore');
const authService = require('../src/services/authService');

test('production user store ships with no hardcoded default credentials', () => {
  userStore.reset();
  assert.equal(authService.verifyCredentials('admin', 'test-admin-pass'), null);
  assert.equal(authService.verifyCredentials('resident', 'test-resident-pass'), null);
  assert.equal(userStore.findByUsername('admin'), null);
});

test('users can be seeded from environment configuration instead of source code', () => {
  userStore.reset();
  userStore.seedFromEnvironment({
    ADMIN_USERNAME: 'env-admin',
    ADMIN_PASSWORD: 'env-admin-pass',
    RESIDENT_USERNAME: 'env-resident',
    RESIDENT_PASSWORD: 'env-resident-pass',
  });

  const admin = authService.verifyCredentials('env-admin', 'env-admin-pass');
  assert.ok(admin);
  assert.equal(admin.role, 'admin');

  const resident = authService.verifyCredentials('env-resident', 'env-resident-pass');
  assert.ok(resident);
  assert.equal(resident.role, 'resident');
});
