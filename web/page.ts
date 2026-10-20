// The page the local server answers: plain HTML, CSS and JS, fed by server-sent events.
// Kept free of backticks and `${`, since it travels inside a template literal.

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Tree</title>
<style>
  :root {
    --bg: #f6f7f9; --card: #fff; --text: #1d2330; --dim: #6b7280; --line: #d9dde3;
    --run: #2563eb; --ok: #16a34a; --err: #dc2626; --abort: #a16207;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1218; --card: #171b23; --text: #e6e8ec; --dim: #8b93a1; --line: #2a303b;
      --run: #60a5fa; --ok: #4ade80; --err: #f87171; --abort: #facc15;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, sans-serif; }
  main { max-width: 1200px; margin: 0 auto; padding: 24px 16px 48px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
  h1 { font-size: 20px; margin: 0; }
  .conn { color: var(--dim); font-size: 12px; }
  .conn.live::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: var(--ok); margin-right: 6px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .name { font-weight: 600; }
  .meta { color: var(--dim); font-size: 13px; }
  .mono { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; }
  .scroll { overflow-x: auto; padding-bottom: 8px; }
  .tree { position: relative; width: max-content; min-width: 100%; }
  .level { display: flex; justify-content: center; gap: 28px; margin-top: 64px; }
  .level:first-of-type { margin-top: 0; }
  .node { display: flex; flex-direction: column; align-items: center; width: 230px; position: relative; z-index: 1; }
  .badge { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center;
    font-size: 18px; font-weight: 700; color: var(--card); background: var(--run); margin-bottom: -12px; z-index: 1;
    border: 3px solid var(--bg); }
  .node .card { width: 100%; padding-top: 18px; }
  .wires { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
  .wires path { fill: none; stroke: var(--line); stroke-width: 3; stroke-linecap: round; }
  .pill { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
    padding: 1px 8px; border-radius: 999px; color: var(--card); }
  .running { background: var(--run); animation: pulse 1.4s ease-in-out infinite; }
  .done { background: var(--ok); }
  .error { background: var(--err); }
  .aborted { background: var(--abort); }
  @keyframes pulse { 50% { opacity: .55; } }
  .summary { margin-top: 6px; color: var(--dim); font-style: italic; overflow-wrap: anywhere; }
  .empty { color: var(--dim); margin-top: 12px; }
  footer { margin-top: 20px; color: var(--dim); font-size: 13px; }
</style>
</head>
<body>
<main>
  <header><h1>Agent Tree</h1><span id="conn" class="conn">connecting…</span></header>
  <div id="root" class="empty">Waiting for the session…</div>
  <footer id="foot"></footer>
</main>
<script>
  const LABEL = { running: 'running', done: 'ok', error: 'error', aborted: 'aborted' };
  const k = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
  const secs = ms => (ms / 1000).toFixed(1) + 's';
  const short = m => (m || '?').replace(/^claude-/, '');
  const tokens = n => k(n.tokensIn) + ' in (' + k(n.cacheRead) + ' cache) / ' + k(n.tokensOut) + ' out';
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const card = (n, isMain) => {
    const c = el('div', 'card');
    const top = el('div', 'row');
    if (!isMain) top.append(el('span', 'pill ' + n.status, LABEL[n.status]));
    top.append(el('span', 'name', isMain ? 'Main session' : n.type));
    top.append(el('span', 'meta', [short(n.model), n.effort].filter(Boolean).join(' · ')));
    c.append(top);
    if (n.description) c.append(el('div', '', n.description));
    const tools = n.tools + ' tool' + (n.tools === 1 ? '' : 's');
    const usage = isMain ? tokens(n) : n.status === 'running' ? tools : [tokens(n), tools, secs(n.durationMs)].join(' · ');
    c.append(el('div', 'meta mono', usage));
    if (n.summary) c.append(el('div', 'summary', n.summary));
    return c;
  };

  const SVG = 'http://www.w3.org/2000/svg';
  let edges = [];
  let treeEl = null;

  // one wire from the bottom of a parent to the top of its child
  const wire = () => {
    if (!treeEl) return;
    const old = treeEl.querySelector('.wires');
    if (old) old.remove();
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'wires');
    const box = treeEl.getBoundingClientRect();
    for (const [from, to] of edges) {
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const x1 = a.left + a.width / 2 - box.left, y1 = a.bottom - box.top;
      const x2 = b.left + b.width / 2 - box.left, y2 = b.top - box.top;
      const mid = (y1 + y2) / 2;
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + mid + ' ' + x2 + ' ' + mid + ' ' + x2 + ' ' + y2);
      svg.append(p);
    }
    treeEl.prepend(svg);
  };

  const draw = t => {
    const root = document.getElementById('root');
    const foot = document.getElementById('foot');
    root.className = '';

    // number the nodes in spawn order; a spawn whose parent is gone hangs from the main session
    const top = Object.assign({}, t.main, { num: 1, depth: 0, parent: null });
    const nodes = [top];
    const byId = {};
    t.agents.forEach((a, i) => {
      const parent = byId[a.parentId] || top;
      const n = Object.assign({}, a, { num: i + 2, depth: parent.depth + 1, parent: parent });
      byId[a.id] = n;
      nodes.push(n);
    });

    // one row per level, children kept under their own parent
    const kids = new Map();
    for (const n of nodes) if (n.parent) kids.set(n.parent, (kids.get(n.parent) || []).concat([n]));
    const levels = [];
    const walk = n => {
      (levels[n.depth] = levels[n.depth] || []).push(n);
      (kids.get(n) || []).forEach(walk);
    };
    walk(top);

    treeEl = el('div', 'tree');
    edges = [];
    for (const row of levels) {
      const level = el('div', 'level');
      for (const n of row) {
        const item = el('div', 'node');
        item.append(el('div', 'badge' + (n.parent ? ' ' + n.status : ''), String(n.num)));
        item.append(card(n, !n.parent));
        n.el = item;
        level.append(item);
        if (n.parent) edges.push([n.parent.el, item]);
      }
      treeEl.append(level);
    }
    const scroll = el('div', 'scroll');
    scroll.append(treeEl);
    root.replaceChildren(scroll);
    if (t.agents.length === 0) {
      root.append(el('div', 'empty', 'No subagents this round.'));
      foot.textContent = '';
    }
    wire();
    if (t.agents.length === 0) return;
    const sumIn = t.agents.reduce((s, a) => s + a.tokensIn, 0);
    const sumOut = t.agents.reduce((s, a) => s + a.tokensOut, 0);
    foot.textContent = 'Subagents: ' + k(sumIn) + ' in / ' + k(sumOut) + ' out · updated ' + new Date().toLocaleTimeString();
  };

  window.addEventListener('resize', wire);
  const conn = document.getElementById('conn');
  const events = new EventSource('/events');
  events.onopen = () => { conn.textContent = 'live'; conn.classList.add('live'); };
  events.onerror = () => { conn.textContent = 'reconnecting…'; conn.classList.remove('live'); };
  events.onmessage = m => { const t = JSON.parse(m.data); if (t) draw(t); };
</script>
</body>
</html>
`
