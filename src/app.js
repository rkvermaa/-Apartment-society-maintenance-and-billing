const http = require('node:http');
const Router = require('./router');
const { handleLogin, handleLogout, handleLoginPage } = require('./routes/auth');
const { handleAdmin } = require('./routes/admin');
const { handleResident } = require('./routes/resident');

function createApp() {
  const router = new Router();
  router.add('GET', '/login', handleLoginPage);
  router.add('POST', '/login', handleLogin);
  router.add('POST', '/logout', handleLogout);
  router.add('GET', '/admin', handleAdmin);
  router.add('GET', '/resident', handleResident);

  return http.createServer((req, res) => router.handle(req, res));
}

module.exports = { createApp };
