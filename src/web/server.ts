// The local page's server: a Node script with no dependencies, handed to `node -` on
// stdin, so the mod needs no path to its own folder. It prints one line per event the
// mod reads: `BUSY <port>`, `LISTEN <port> <key>`, `SHARED <port>` or `FAILED <port> <code>`.
//
// One server serves every session on the machine. The first session's script listens; a later
// one finds that server on the port (`GET /hello`), prints SHARED and holds a request open to it
// (`/hold`), so the server knows the session is alive; when the session ends, its script dies and
// the hold closes. When the owner's session ends, the holds drop and one of the waiting scripts
// takes the port over. Every session's mod pushes its own tree (`POST /state?s=<session id>`), and
// GET /events streams the list of them all (server-sent events); any other GET answers the page.
//
// Only 127.0.0.1 is bound, a foreign Host is refused, and /state, /events and /hold need the key
// (`?t=<key>`), which the mods share through `$.store`: the trees hold commands and answers, so
// another local process or a website must not read or replace them. The page and /hello hold no
// data, so they are served without it.

export const FIRST_PORT = 47821
export const PORT_TRIES = 10

export const serverSource = (page: string, icon: string, key: string, session: string): string => String.raw`
const http = require('http');
const FIRST = ${FIRST_PORT}, LAST = ${FIRST_PORT + PORT_TRIES - 1};
const PAGE = ${JSON.stringify(page)};
const ICON = ${JSON.stringify(icon)};
const KEY = ${JSON.stringify(key)}, SESSION = ${JSON.stringify(session)};
const sessions = new Map(); // session id -> its JSON ({ id, title, group, tree })
const clients = new Set();
const list = () => '[' + [...sessions.values()].join(',') + ']';
const send = () => { const data = 'data: ' + list() + '\n\n'; for (const c of clients) c.write(data); };

const server = http.createServer((req, res) => {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) { res.writeHead(403); res.end(); return; }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/favicon.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.from(ICON, 'base64')); return; }
  if (url.pathname === '/hello') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ app: 'agent-tree', v: 2, pages: clients.size }));
    return;
  }
  const isData = url.pathname === '/state' || url.pathname === '/events' || url.pathname === '/hold';
  if (isData && url.searchParams.get('t') !== KEY) { res.writeHead(403); res.end(); return; }
  const id = url.searchParams.get('s') || '';
  if (req.method === 'POST' && url.pathname === '/state') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      sessions.set(id, body);
      send();
      res.end();
    });
    return;
  }
  if (url.pathname === '/hold') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.write('\n');
    req.on('close', () => { if (sessions.delete(id)) send(); });
    return;
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write('data: ' + list() + '\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});

// whether an agent-tree server of this kind listens on the port
const hello = p => new Promise(done => {
  const req = http.get({ host: '127.0.0.1', port: p, path: '/hello', timeout: 1000 }, res => {
    let body = '';
    res.on('data', c => { body += c; });
    res.on('end', () => { try { const j = JSON.parse(body); done(j.app === 'agent-tree' && j.v === 2); } catch { done(false); } });
  });
  req.on('timeout', () => req.destroy());
  req.on('error', () => done(false));
});

let port = FIRST;
const next = () => {
  console.log('BUSY ' + port);
  if (port === LAST) { console.log('FAILED ' + port + ' EADDRINUSE'); process.exit(1); }
  port++;
  server.listen(port, '127.0.0.1');
};
// a while after the owner's hold drops, try to take its port; several waiting scripts race and one wins
const retry = () => setTimeout(() => server.listen(port, '127.0.0.1'), 100 + Math.random() * 400);
// shares the server on the port: holds a request open to it while this session lives
const hold = () => {
  let isOver = false; // the response's close and the request's error both end one hold: one retry
  const over = () => { if (!isOver) { isOver = true; retry(); } };
  const req = http.get({ host: '127.0.0.1', port, path: '/hold?t=' + KEY + '&s=' + encodeURIComponent(SESSION) }, res => {
    res.resume();
    // another key (a server from before the key was shared): not ours to share
    if (res.statusCode !== 200) { isOver = true; next(); return; }
    console.log('SHARED ' + port);
    res.on('close', over);
  });
  req.on('error', over);
};
server.on('error', async err => {
  if (err.code !== 'EADDRINUSE') { console.log('FAILED ' + port + ' ' + err.code); process.exit(1); }
  if (await hello(port)) hold(); else next();
});
server.on('listening', () => console.log('LISTEN ' + port + ' ' + KEY));
server.listen(port, '127.0.0.1');
`
