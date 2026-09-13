const requireAuth = require('../middleware/requireAuth');

function handleAdmin(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Welcome to the Admin area', username: session.username }));
}

module.exports = { handleAdmin };
