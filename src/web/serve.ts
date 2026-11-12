import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { INITIAL_TREE, INITIAL_VIEW, INITIAL_WEB } from '../state'
import { reveal } from '../view'
import { ICON } from './icon'
import { PAGE } from './page'
import { serverSource } from './server'

const tree = atom({ plugin: 'agent-tree', key: 'tree' } as const, INITIAL_TREE)
const web = atom({ plugin: 'agent-tree', key: 'web' } as const, INITIAL_WEB)
const view = atom({ plugin: 'agent-tree', key: 'view' } as const, INITIAL_VIEW)

const PUSH_GAP_MS = 100 // at most about ten sends a second, however many events come
const KEY = 'key' // the key in `$.store` of the page's key, shared by every session's server

// this session as the shared page lists it: its id, and the repository it is grouped under
let self = { id: 'session', group: '' }

// one send at a time: a burst of events (parallel agents) is folded into the next send, and
// what is sent is always the latest tree, so a slow request cannot land after a newer one
let isSending = false
let isDirty = false

// sends this session's tree to the page's server, when one listens or is shared
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
      const title = (await read($, view)).title.replace(/^Agents( · )?/, '')
      const body = JSON.stringify({ ...self, title, tree: await read($, tree) })
      const url = `http://127.0.0.1:${w.port}/state?t=${w.token}&s=${encodeURIComponent(self.id)}`
      await $.http.fetch(url, { method: 'POST', body }).catch(() => undefined)
      await $.clock.sleep(PUSH_GAP_MS).catch(() => undefined)
    }
  } finally {
    isSending = false
  }
}

// the key every session's server takes, so one server can carry them all. Two sessions that start
// at the same moment with no key kept may make two; the second then runs a server of its own.
async function sharedKey($: EngineInterface) {
  const kept = await $.store.get(KEY).catch(() => undefined)
  if (typeof kept === 'string' && kept !== '') return kept
  const key = crypto.randomUUID().replace(/-/g, '')
  await $.store.set(KEY, key).catch(() => undefined)

  return key
}

// runs the page's server (or shares another session's) for the module's life, reading the lines it prints
export async function serve($: EngineInterface) {
  await update($, web, () => INITIAL_WEB)
  const key = await sharedKey($)
  const id = await $.session.id().catch(() => 'session')
  // a worktree's repository is its main working tree, so the sessions of one repository sit together
  const repo = await $.session.repo().catch(() => null)
  self = { id, group: repo?.root ?? (await $.session.root().catch(() => '')) }
  try {
    let rest = ''
    for await (const { stream, text } of $.process.spawn({ argv: ['node', '-'], input: serverSource(PAGE, ICON, key, id) })) {
      if (stream !== 'stdout') continue
      const lines = (rest + text).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        // BUSY <port>, LISTEN <port> <key>, SHARED <port>, FAILED <port> <code>
        const [word = '', port = '', code = ''] = line.trim().split(' ')
        if (word === 'BUSY') await update($, web, w => ({ ...w, busy: [...w.busy, Number(port)] }))
        if (word === 'FAILED') await update($, web, w => ({ ...w, status: 'failed', error: code }))
        if (word === 'LISTEN' || word === 'SHARED') {
          const isShared = word === 'SHARED'
          await update($, web, w => ({ ...w, status: 'listening', port: Number(port), token: isShared ? key : code, isShared }))
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
