// The local page's server: a Node script with no dependencies, handed to `node -` on
// stdin, so the mod needs no path to its own folder. It prints one line per event the
// mod reads: `BUSY <port>`, `LISTEN <port> <key>` or `FAILED <port> <code>`.
// POST /state takes the tree as JSON; GET /events streams it (server-sent events); any
// other GET answers the page. Only 127.0.0.1 is bound, a foreign Host is refused, and
// /state and /events need the key the server made when it started (`?t=<key>`): the tree
// holds commands and answers, so another local process or a website must not read or
// replace it. The page itself holds no data, so it is served without the key.

export const FIRST_PORT = 47821
export const PORT_TRIES = 10

export const serverSource = (page: string, icon: string): string => String.raw`
const http = require('http');
const crypto = require('crypto');
const FIRST = ${FIRST_PORT}, LAST = ${FIRST_PORT + PORT_TRIES - 1};
const PAGE = ${JSON.stringify(page)};
const ICON = ${JSON.stringify(icon)};
const KEY = crypto.randomBytes(8).toString('hex');
let state = 'null';
const clients = new Set();

const server = http.createServer((req, res) => {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) { res.writeHead(403); res.end(); return; }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/favicon.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.from(ICON, 'base64')); return; }
  const isData = url.pathname === '/state' || url.pathname === '/events';
  if (isData && url.searchParams.get('t') !== KEY) { res.writeHead(403); res.end(); return; }
  if (req.method === 'POST' && url.pathname === '/state') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      state = body;
      for (const c of clients) c.write('data: ' + state + '\n\n');
      res.end();
    });
    return;
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write('data: ' + state + '\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});

let port = FIRST;
server.on('error', err => {
  if (err.code !== 'EADDRINUSE') { console.log('FAILED ' + port + ' ' + err.code); process.exit(1); }
  console.log('BUSY ' + port);
  if (port === LAST) { console.log('FAILED ' + port + ' EADDRINUSE'); process.exit(1); }
  port++;
  server.listen(port, '127.0.0.1');
});
server.on('listening', () => console.log('LISTEN ' + port + ' ' + KEY));
server.listen(port, '127.0.0.1');
`
