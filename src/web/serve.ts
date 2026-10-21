import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { INITIAL_TREE, INITIAL_WEB } from '../state'
import { reveal } from '../view'
import { ICON } from './icon'
import { PAGE } from './page'
import { serverSource } from './server'

const tree = atom({ plugin: 'agent-tree', key: 'tree' } as const, INITIAL_TREE)
const web = atom({ plugin: 'agent-tree', key: 'web' } as const, INITIAL_WEB)

const PUSH_GAP_MS = 100 // at most about ten sends a second, however many events come

// one send at a time: a burst of events (parallel agents) is folded into the next send, and
// what is sent is always the latest tree, so a slow request cannot land after a newer one
let isSending = false
let isDirty = false

// sends the tree to the local page, when its server listens
// (function declarations: the engine follows `$` across files only into those)
export async function push($: EngineInterface) {
  isDirty = true
  if (isSending) return
  isSending = true
  try {
    while (isDirty) {
      isDirty = false
      const w = await read($, web)
      if (w.status !== 'listening') return
      const body = JSON.stringify(await read($, tree))
      await $.http.fetch(`http://127.0.0.1:${w.port}/state?t=${w.token}`, { method: 'POST', body }).catch(() => undefined)
      await $.clock.sleep(PUSH_GAP_MS).catch(() => undefined)
    }
  } finally {
    isSending = false
  }
}

// runs the page's server for the module's life, reading the lines it prints
export async function serve($: EngineInterface) {
  await update($, web, () => INITIAL_WEB)
  try {
    let rest = ''
    for await (const { stream, text } of $.process.spawn({ argv: ['node', '-'], input: serverSource(PAGE, ICON) })) {
      if (stream !== 'stdout') continue
      const lines = (rest + text).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        // BUSY <port>, LISTEN <port> <key>, FAILED <port> <code>
        const [word = '', port = '', code = ''] = line.trim().split(' ')
        if (word === 'BUSY') await update($, web, w => ({ ...w, busy: [...w.busy, Number(port)] }))
        if (word === 'FAILED') await update($, web, w => ({ ...w, status: 'failed', error: code }))
        if (word === 'LISTEN') {
          await update($, web, w => ({ ...w, status: 'listening', port: Number(port), token: code }))
          await push($)
          await reveal($)
        }
      }
    }
    await update($, web, w => (w.status === 'failed' ? w : { ...w, status: 'failed', error: 'server stopped' }))
  } catch {
    await update($, web, w => ({ ...w, status: 'failed', error: 'node not found' })).catch(() => undefined)
  }
}
