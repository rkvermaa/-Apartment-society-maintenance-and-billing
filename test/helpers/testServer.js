const { createApp } = require('../../src/app');
const userStore = require('../../src/services/userStore');
const testUsers = require('../fixtures/users');

async function startTestServer() {
  userStore.reset();
  for (const user of testUsers) {
    userStore.seedUser(user);
  }
  const server = createApp();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://localhost:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { startTestServer };
