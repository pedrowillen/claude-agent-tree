import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { optionsFor, parseChoice, QUESTION } from './choice'
import { pageUrl } from './format'
import { INITIAL_VIEW, INITIAL_WEB, PANE } from './state'
import { openWindow } from './web/window'

const web = atom({ plugin: 'agent-tree', key: 'web' } as const, INITIAL_WEB)
const view = atom({ plugin: 'agent-tree', key: 'view' } as const, INITIAL_VIEW)

async function isWindows($: EngineInterface) {
  const run = await $.process.run(['cmd', '/c', 'ver']).catch(() => undefined)

  return run?.exitCode === 0
}

// Shows the page the way the user chose, once both the choice and the server's port are known:
// whichever comes last calls it, and it acts once. (Function declarations: the engine follows
// `$` across files only into those.)
export async function reveal($: EngineInterface) {
  const w = await read($, web)
  const v = await read($, view)
  if (!v.chosen || v.isShown || w.status !== 'listening') return

  await update($, view, x => ({ ...x, isShown: true }))
  const url = pageUrl(w.port, w.token)
  if (v.web) {
    $.ui.toast(`Agent Tree: ${url}`)
    $.ui.status(`Agent Tree: ${url}`)
  }
  if (v.window) await openWindow($, url)
}

// asks how to see the agents, in the engine's own question dialog, and applies the answer
export async function choose($: EngineInterface) {
  const options = optionsFor(await isWindows($))
  const answer = await $.ui.ask(QUESTION, { options, header: 'Agent Tree', multiSelect: true }).catch(() => '')
  const picked = parseChoice(answer)

  await update($, view, () => ({ ...picked, chosen: true, isShown: false }))
  if (picked.pane) await $.ui.open({ id: PANE, title: 'Agents' })
  await reveal($)
}
