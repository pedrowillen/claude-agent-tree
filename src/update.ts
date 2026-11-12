import type { EngineInterface, Register } from 'claude-code'

const LATEST = 'https://api.github.com/repos/pedrowillen/claude-agent-tree/releases/latest'
export const UPDATE = 'Update'

// `0.10.0` is newer than `0.9.1`: compared number by number, a leading `v` dropped
export const isNewer = (latest: string, installed: string): boolean => {
  const parts = (v: string) => v.replace(/^v/, '').split('.').map(n => Number.parseInt(n, 10) || 0)
  const [a, b] = [parts(latest), parts(installed)]
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }

  return false
}

// the version in this folder's manifest (function declarations: the engine follows `$` only into those)
async function installedVersion($: EngineInterface) {
  const manifest = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)

  return String((JSON.parse(String(manifest)) as { version?: unknown }).version ?? '')
}

// the newest release on GitHub, as its tag (`v0.9.0`)
async function latestVersion($: EngineInterface) {
  const res = await $.http.fetch(LATEST, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'agent-tree' } })
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)

  return String((JSON.parse(res.text) as { tag_name?: unknown }).tag_name ?? '')
}

// asks whether to update and, on a yes, fast-forwards the folder the mod is loaded from: a clone with
// changes of its own, or not a clone at all, is left as it is and the error says so
async function offerUpdate($: EngineInterface, latest: string) {
  const answer = await $.ui.ask(`agent-tree ${latest} is out. Update now?`, { options: [UPDATE, 'Not now'], header: 'Agent Tree' })
    .catch(() => '')
  if (answer !== UPDATE) return
  const root = $.plugin.root
  const pulled = await $.process.run(['git', '-C', root, 'pull', '--ff-only']).catch(() => undefined)
  if (pulled?.exitCode === 0) {
    $.ui.toast(`agent-tree updated to ${latest}. Restart the Claude app to load it.`)
    return
  }
  $.ui.toast(`agent-tree could not update itself. Run \`git pull\` in ${root}, then restart the Claude app.`)
}

// `/agent-tree-update` (registered at session start, in session.ts): compares this copy with the
// newest release and offers to pull it
export const registerUpdate: Register = on => {
  on('command.run', { command: 'agent-tree-update' }, async $ => {
    try {
      const [installed, latest] = await Promise.all([installedVersion($), latestVersion($)])
      if (!isNewer(latest, installed)) return { text: `agent-tree ${installed} is up to date.` }
      void offerUpdate($, latest)

      return { text: `agent-tree ${latest} is out (this is ${installed}).` }
    } catch (error) {
      return { text: `Could not check for updates: ${error instanceof Error ? error.message : String(error)}` }
    }
  })
}
