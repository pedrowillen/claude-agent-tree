import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { INITIAL_VIEW, PANE } from './state'

const view = atom({ plugin: 'agent-tree', key: 'view' } as const, INITIAL_VIEW)

const MAX_TITLE = 30 // characters of the session title kept in the pane's tab

// Prints the session's title. A Node script handed to `node -`, because the mod cannot read files.
// The transcript is `<config>/projects/<project>/<session id>.jsonl`; the engine appends its
// `custom-title` (a name the user gave) and `ai-title` entries over and over, so the last
// megabyte is enough. A name the user gave wins over the generated one.
const SCRIPT = String.raw`
const fs = require('fs'), path = require('path'), os = require('os');
const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const titles = {};
try {
  for (const dir of fs.readdirSync(root)) {
    const file = path.join(root, dir, process.env.CLAUDE_CODE_SESSION_ID + '.jsonl');
    if (!fs.existsSync(file)) continue;
    const size = fs.statSync(file).size, len = Math.min(size, 1 << 20), buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    for (const line of buf.toString().split('\n')) {
      if (!line.includes('-title"')) continue;
      try {
        const e = JSON.parse(line);
        if (e.type === 'custom-title') titles.custom = e.customTitle;
        if (e.type === 'ai-title') titles.ai = e.aiTitle;
      } catch {}
    }
    break;
  }
} catch {}
process.stdout.write(titles.custom || titles.ai || '');
`

// reads the title and, when it differs from the pane's label (kept in the `view` atom, which every
// open of the pane uses), opens the pane again under it: the tab label is the title of the pane's
// latest open (function declaration: the engine follows `$` only into those)
export async function showTitle($: EngineInterface) {
  let text = ''
  try {
    for await (const { stream, text: chunk } of $.process.spawn({ argv: ['node', '-'], input: SCRIPT })) {
      if (stream === 'stdout') text += chunk
    }
  } catch {
    return // no node: the pane keeps its title
  }

  const name = text.trim().replace(/\s+/g, ' ')
  const label = name === '' ? 'Agents' : `Agents · ${name.length > MAX_TITLE ? `${name.slice(0, MAX_TITLE - 1)}…` : name}`
  const current = await read($, view)
  if (label === current.title || !current.pane) return

  await update($, view, x => ({ ...x, title: label }))
  await $.ui.open({ id: PANE, title: label })
}
