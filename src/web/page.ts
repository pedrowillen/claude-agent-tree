// The page the local server answers: plain HTML, CSS and JS, fed by server-sent events.
// Kept free of backticks and `${`, since it travels inside a template literal.

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Tree</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
  :root {
    --bg: #f6f7f9; --card: #fff; --text: #1d2330; --dim: #6b7280; --line: #d9dde3;
    --run: #2563eb; --ok: #16a34a; --err: #dc2626; --abort: #a16207; --good: #65a30d; --poor: #ea580c;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1218; --card: #171b23; --text: #e6e8ec; --dim: #8b93a1; --line: #2a303b;
      --run: #60a5fa; --ok: #4ade80; --err: #f87171; --abort: #facc15; --good: #a3e635; --poor: #fb923c;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 13px/1.55 ui-monospace, "Cascadia Mono", "Cascadia Code", "JetBrains Mono", Consolas, "SFMono-Regular", Menlo, monospace; }
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
  .mono { font-size: 12px; }
  .card { overflow-wrap: anywhere; }
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
  /* data flowing down the wire of an agent that is working: dots that travel from parent to child */
  .wires path.flow { stroke: var(--run); stroke-width: 5; stroke-dasharray: 0.1 18; filter: drop-shadow(0 0 3px var(--run));
    animation: flow 1.2s linear infinite; }
  @keyframes flow { to { stroke-dashoffset: -18.1; } }
  @media (prefers-reduced-motion: reduce) { .wires path.flow { animation: none; stroke-dasharray: none; opacity: .6; } }
  .card.click { cursor: pointer; }
  .card.click:hover { border-color: var(--run); }
  .chev { margin-left: auto; color: var(--dim); }
  .node.open { width: 340px; }
  .detail { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--line); cursor: auto; }
  .dh { margin-top: 4px; color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .calls { max-height: 160px; overflow: auto; font-size: 12px; }
  .call { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .answer { margin: 4px 0 0; max-height: 220px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere;
    font: inherit; font-size: 12px; }
  .card.click:focus-visible { outline: 2px solid var(--run); outline-offset: 2px; }
  /* --flash-delay (negative) resumes a flash that a redraw interrupted, where it left off */
  .flash-done .card { animation: flash-done 1.4s ease-out var(--flash-delay, 0ms); }
  .flash-error .card { animation: flash-error 1.4s ease-out var(--flash-delay, 0ms); }
  .flash-aborted .card { animation: flash-aborted 1.4s ease-out var(--flash-delay, 0ms); }
  @keyframes flash-done { from { box-shadow: 0 0 0 4px var(--ok); } to { box-shadow: 0 0 0 0 transparent; } }
  @keyframes flash-error { from { box-shadow: 0 0 0 4px var(--err); } to { box-shadow: 0 0 0 0 transparent; } }
  @keyframes flash-aborted { from { box-shadow: 0 0 0 4px var(--abort); } to { box-shadow: 0 0 0 0 transparent; } }
  .pill { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
    padding: 1px 8px; border-radius: 999px; color: var(--card); }
  .rate { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
    padding: 0 7px; border-radius: 999px; color: var(--card); cursor: help; }
  .rate-perfect { background: var(--ok); }
  .rate-ok { background: var(--good); }
  .rate-fair { background: var(--abort); }
  .rate-poor { background: var(--poor); }
  .rate-awful { background: var(--err); }
  .running { background: var(--run); animation: pulse 1.4s ease-in-out infinite; }
  .done { background: var(--ok); }
  .error { background: var(--err); }
  .aborted { background: var(--abort); }
  @keyframes pulse { 50% { opacity: .55; } }
  .summary { margin-top: 6px; color: var(--dim); font-style: italic; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
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
  const k = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
  const secs = ms => (ms / 1000).toFixed(1) + 's';
  const short = m => (m || '?').replace(/^claude-/, '');
  const tokens = n => k(n.tokensIn) + ' in (' + k(n.cacheRead) + ' cache) / ' + k(n.tokensOut) + ' out';
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const usd = c => '$' + (c < 0.00995 ? c.toFixed(4) : c < 0.9995 ? c.toFixed(3) : c.toFixed(2));
  const RATES = new Set(['perfect', 'ok', 'fair', 'poor', 'awful']);
  const open = new Set(); // ids of the cards opened
  const seen = new Map(); // id -> last status, to flash a card when its agent finishes
  const flashing = new Map(); // id -> { cls, until }: a flash lives through the redraws that follow
  const FLASH_MS = 1400;
  let last = null;

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

    // what it cost (estimated, with a verdict once a subagent ends) and how full its context is
    const spend = el('div', 'meta mono');
    if (n.costUsd !== undefined) {
      spend.append('~' + usd(n.costUsd) + (n.isCostPartial ? '+' : ''));
      if (!isMain && RATES.has(n.rating)) {
        const chip = el('span', 'rate rate-' + n.rating, n.rating);
        chip.title = 'Estimated cost of this agent run, judged against fixed ceilings (see the README)';
        spend.append(' ', chip);
      }
    }
    if (n.contextTokens) spend.append((spend.childNodes.length ? ' · ' : '') + 'ctx ' + k(n.contextTokens)
      + (n.contextWindow ? ' / ' + k(n.contextWindow) + ' (' + Math.max(1, Math.round(n.contextTokens / n.contextWindow * 100)) + '%)' : ''));
    if (spend.childNodes.length) c.append(spend);
    if (n.summary && !open.has(n.id)) c.append(el('div', 'summary', n.summary));

    // an agent with something to show opens on a click: its tool calls and its whole answer
    const calls = n.calls || [];
    if (!isMain && (calls.length > 0 || n.answer)) {
      c.classList.add('click');
      c.dataset.card = n.id;
      c.tabIndex = 0;
      c.setAttribute('role', 'button');
      c.setAttribute('aria-expanded', String(open.has(n.id)));
      top.append(el('span', 'chev', open.has(n.id) ? '▾' : '▸'));
      const toggle = () => {
        if (open.has(n.id)) open.delete(n.id); else open.add(n.id);
        if (last) draw(last);
      };
      c.addEventListener('click', () => { if (!String(window.getSelection())) toggle(); });
      c.addEventListener('keydown', e => {
        if (e.target !== c || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        toggle();
      });
      if (open.has(n.id)) {
        const box = el('div', 'detail');
        box.addEventListener('click', e => e.stopPropagation());
        if (calls.length > 0) {
          box.append(el('div', 'dh', 'Tools (' + n.tools + (n.tools > calls.length ? ', last ' + calls.length : '') + ')'));
          const list = el('div', 'calls');
          list.dataset.keep = n.id + ':calls';
          for (const call of calls) { const row = el('div', 'call', call); row.title = call; list.append(row); }
          box.append(list);
        }
        if (n.answer) {
          box.append(el('div', 'dh', 'Answer'));
          const pre = el('pre', 'answer', n.answer);
          pre.dataset.keep = n.id + ':answer';
          box.append(pre);
        }
        c.append(box);
      }
    }
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
    // the dots keep one phase across redraws, so an update does not restart them
    const phase = '-' + (Date.now() % 1200) + 'ms';
    for (const [from, to, status] of edges) {
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const x1 = a.left + a.width / 2 - box.left, y1 = a.bottom - box.top;
      const x2 = b.left + b.width / 2 - box.left, y2 = b.top - box.top;
      const mid = (y1 + y2) / 2;
      const d = 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + mid + ' ' + x2 + ' ' + mid + ' ' + x2 + ' ' + y2;
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      svg.append(p);
      if (status === 'running') {
        const flow = document.createElementNS(SVG, 'path');
        flow.setAttribute('d', d);
        flow.setAttribute('class', 'flow');
        flow.style.animationDelay = phase;
        svg.append(flow);
      }
    }
    treeEl.prepend(svg);
  };

  const draw = t => {
    last = t;
    const root = document.getElementById('root');
    // a redraw rebuilds the page, so remember where the user had scrolled
    const before = root.querySelector('.scroll');
    const left = before ? before.scrollLeft : null;
    const tops = {};
    for (const box of root.querySelectorAll('[data-keep]')) tops[box.dataset.keep] = box.scrollTop;
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.card : undefined;
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
        const item = el('div', 'node' + (open.has(n.id) ? ' open' : ''));
        if (n.parent) {
          const now = Date.now();
          if (seen.get(n.id) === 'running' && n.status !== 'running') flashing.set(n.id, { cls: 'flash-' + n.status, until: now + FLASH_MS });
          const flash = flashing.get(n.id);
          if (flash && flash.until > now) {
            item.classList.add(flash.cls);
            item.style.setProperty('--flash-delay', '-' + (FLASH_MS - (flash.until - now)) + 'ms');
          } else {
            flashing.delete(n.id);
          }
        }
        seen.set(n.id, n.status);
        item.append(el('div', 'badge' + (n.parent ? ' ' + n.status : ''), String(n.num)));
        item.append(card(n, !n.parent));
        n.el = item;
        level.append(item);
        if (n.parent) edges.push([n.parent.el, item, n.status]);
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
    // the first draw centers a wide tree on the main session; later ones keep the scroll
    scroll.scrollLeft = left === null ? Math.max(0, (scroll.scrollWidth - scroll.clientWidth) / 2) : left;
    for (const box of root.querySelectorAll('[data-keep]')) if (tops[box.dataset.keep] !== undefined) box.scrollTop = tops[box.dataset.keep];
    if (focused !== undefined) {
      const again = root.querySelector('[data-card="' + CSS.escape(focused) + '"]');
      if (again) again.focus({ preventScroll: true });
    }
    wire();
    if (t.agents.length === 0) return;
    const sumIn = t.agents.reduce((s, a) => s + a.tokensIn, 0);
    const sumOut = t.agents.reduce((s, a) => s + a.tokensOut, 0);
    const sumCost = t.agents.reduce((s, a) => s + (a.costUsd || 0), 0);
    foot.textContent = 'Subagents: ' + k(sumIn) + ' in / ' + k(sumOut) + ' out' + (sumCost > 0 ? ' · ~' + usd(sumCost) : '') + ' · updated ' + new Date().toLocaleTimeString();
  };

  window.addEventListener('resize', wire);
  const conn = document.getElementById('conn');
  // the server's data needs its key, which is in this page's address (?t=), put there by the mod
  const key = new URLSearchParams(location.search).get('t');
  if (!key) conn.textContent = 'open the link shown in the Agents pane';
  const events = key ? new EventSource('/events?t=' + encodeURIComponent(key)) : null;
  if (events) {
    events.onopen = () => { conn.textContent = 'live'; conn.classList.add('live'); };
    events.onerror = () => { conn.textContent = 'reconnecting…'; conn.classList.remove('live'); };
    events.onmessage = m => { const t = JSON.parse(m.data); if (t) draw(t); };
  }
</script>
</body>
</html>
`
