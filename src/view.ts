import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { isPick, optionsFor, parseChoice, QUESTION } from './choice'
import { pageUrl } from './format'
import { INITIAL_VIEW, INITIAL_WEB, PANE } from './state'
import { openWindow } from './web/window'

const KEPT_ANSWER = 'answer' // the key in `$.store` of the last answer to the question
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
  // one window for all the sessions: none when a page is already open on the shared server
  if (v.window && (await openPages($, w.port)) === 0) await openWindow($, url)
}

// how many pages are open on the server; 0 when it cannot tell
async function openPages($: EngineInterface, port: number) {
  const hello = await $.http.fetch(`http://127.0.0.1:${port}/hello`).catch(() => undefined)
  try {
    const pages = (JSON.parse(hello?.text ?? '') as { pages?: unknown }).pages

    return typeof pages === 'number' ? pages : 0
  } catch {
    return 0
  }
}

// applies how to see the agents. With `isAsking` (only `/agent-tree`) it asks first, in the engine's
// own question dialog, and keeps the answer in `$.store`, which outlives the session. Without it
// the kept answer is applied; with none, the pane opens. Only an answer that picks an option is
// kept: free text or a dismissed dialog applies the kept answer again.
export async function choose($: EngineInterface, isAsking: boolean) {
  let answer = ''
  if (isAsking) {
    const options = optionsFor(await isWindows($))
    answer = await $.ui.ask(QUESTION, { options, header: 'Agent Tree', multiSelect: true }).catch(() => '')
  }
  if (isPick(answer)) {
    await $.store.set(KEPT_ANSWER, answer).catch(() => undefined)
  } else {
    const kept = await $.store.get(KEPT_ANSWER).catch(() => undefined)
    answer = typeof kept === 'string' ? kept : ''
  }
  const picked = parseChoice(answer)

  // the title stays: asking again must not take the session title off the header
  await update($, view, x => ({ ...x, ...picked, chosen: true, isShown: false }))
  if (picked.pane) await $.ui.open({ id: PANE, title: (await read($, view)).title })
  await reveal($)
}
