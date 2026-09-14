class Router {
  constructor() {
    this.routes = [];
  }

  add(method, path, handler) {
    this.routes.push({ method, path, handler });
  }

  handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    req.pathname = url.pathname;
    const match = this.routes.find((route) => route.method === req.method && route.path === url.pathname);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }
    Promise.resolve(match.handler(req, res)).catch((error) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error', message: error.message }));
    });
  }
}

module.exports = Router;
