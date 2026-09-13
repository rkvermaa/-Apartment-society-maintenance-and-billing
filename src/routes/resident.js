const requireAuth = require('../middleware/requireAuth');

function handleResident(req, res) {
  const session = requireAuth(req, res, 'resident');
  if (!session) return;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Welcome to the Resident area', username: session.username }));
}

module.exports = { handleResident };
